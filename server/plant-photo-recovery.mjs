/* The deployed owner mapping and server credential are NOT in this file.
 * Authenticated owner only. Source Storage is read-only. Drive writes create
 * new immutable objects only; existing photos, edits and tombstones are untouched. */
const API='https://www.googleapis.com/drive/v3/';
const NS='plant-flashcards',SCHEMA='flashcards-drive-journal-v3';
const ID=/^[A-Za-z0-9_-]{1,160}$/;
export async function digest(value){const b=typeof value==='string'?new TextEncoder().encode(value):value;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(n=>n.toString(16).padStart(2,'0')).join('');}
function problem(message,status=503){return Object.assign(Error(message),{publicMessage:message,status});}
async function bytes(response,max=20*1024*1024){
 if(Number(response.headers.get('content-length')||0)>max)throw problem('画像が読込上限を超えています。',413);
 if(!response.body?.getReader){const b=await response.arrayBuffer();if(b.byteLength>max)throw problem('画像が大きすぎます。',413);return b;}
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>max){await reader.cancel();throw problem('画像が大きすぎます。',413);}chunks.push(r.value);}}finally{reader.releaseLock();}
 const out=new Uint8Array(size);let at=0;for(const c of chunks){out.set(c,at);at+=c.length;}return out.buffer;
}
export function createHandler({allowedEmail,allowedOwner,allowedOrigin,backendUrl,backendKey,fetcher=globalThis.fetch}){
 const configured=typeof allowedEmail==='string'&&/^[a-f0-9-]{36}$/i.test(allowedOwner||'')&&/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(backendUrl||'')&&!!backendKey;
 return async function handle(req){
  const origin=req.headers.get('Origin'),headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, private','Vary':'Origin','X-Content-Type-Options':'nosniff'};
  if(origin===allowedOrigin)Object.assign(headers,{'Access-Control-Allow-Origin':allowedOrigin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, content-type, apikey'});
  const answer=(status,data)=>new Response(JSON.stringify(data),{status,headers});
  const fail=(status,message)=>answer(status,{error:{message}});
  if(origin&&origin!==allowedOrigin)return fail(403,'このアクセス元は許可されていません。');
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return fail(405,'植物カードの写真復旧ボタンから実行してください。');
  const auth=req.headers.get('Authorization')||'';
  if(!/^Bearer [A-Za-z0-9._~+\/-]{20,4096}={0,2}$/.test(auth))return fail(401,'Google Driveに接続してください。');
  if(!configured)return fail(503,'非公開の画像復旧設定が未完了です。');
  async function google(path,options={}){
   const url=path.startsWith('upload:')?'https://www.googleapis.com/upload/drive/v3/'+path.slice(7):API+path;
   const r=await fetcher(url,{...options,headers:{...options.headers,Authorization:auth},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
   if(r.status===401||r.status===403)throw problem('Google Driveの認証・許可を確認できません。再接続してください。',401);
   if(!r.ok)throw problem('Google Driveの処理に失敗しました（HTTP '+r.status+'）。');return r;
  }
  async function storage(path,options={}){
   const h={apikey:backendKey,'Content-Type':'application/json'};if(!String(backendKey).startsWith('sb_secret_'))h.Authorization='Bearer '+backendKey;
   const r=await fetcher(backendUrl+'/storage/v1/'+path,{...options,headers:h,redirect:'error',signal:AbortSignal.timeout(15000)});
   if(!r.ok)throw problem('旧保存先の写真を読み取れません（HTTP '+r.status+'）。元画像は変更していません。');return r;
  }
  async function listSource(prefix,offset,limit){
   const rows=await (await storage('object/list/plant-images',{method:'POST',body:JSON.stringify({prefix,offset,limit,sortBy:{column:'name',order:'asc'}})})).json();
   if(!Array.isArray(rows))throw problem('旧写真一覧の形式が不正です。');return rows;
  }
  async function find(kind,extra=''){
   const q="appProperties has { key='namespace' and value='"+NS+"' } and appProperties has { key='kind' and value='"+kind+"' } and trashed=false"+extra;
   const p=new URLSearchParams({spaces:'appDataFolder',q,fields:'files(id,appProperties)',pageSize:'100'});
   const data=await (await google('files?'+p)).json();if(!Array.isArray(data.files))throw problem('Drive一覧を確認できません。');return data.files;
  }
  async function create(name,blob,properties){
   const boundary='recovery_'+crypto.randomUUID().replaceAll('-','');
   const meta={name,parents:['appDataFolder'],mimeType:blob.type,appProperties:{namespace:NS,...properties}};
   const body=new Blob(['--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',JSON.stringify(meta),'\r\n--'+boundary+'\r\nContent-Type: '+blob.type+'\r\n\r\n',blob,'\r\n--'+boundary+'--\r\n']);
   const data=await (await google('upload:files?uploadType=multipart&fields=id',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body})).json();
   if(!ID.test(data.id||''))throw problem('Drive保存結果を確認できません。');return data;
  }
  try{
   const user=(await (await google('about?fields=user(emailAddress,permissionId)')).json()).user;
   // No client-supplied email or folder is trusted for authorization.
   if(typeof user?.emailAddress!=='string'||user.emailAddress.toLowerCase()!==allowedEmail.toLowerCase()||!user.permissionId)return fail(403,'元の写真を保存したGoogleアカウントで接続してください。');
   const text=new TextDecoder().decode(await bytes(req,2048));let input;try{input=JSON.parse(text);}catch{return fail(400,'要求の形式が不正です。');}
   if(input?.action==='list'){
    const offset=input.offset??0;if(!Number.isSafeInteger(offset)||offset<0||offset>20000||offset%50)return fail(400,'一覧の位置が不正です。');
    const folders=await listSource(allowedOwner,offset,50),photos=[];
    for(let n=0;n<folders.length;n+=4)await Promise.all(folders.slice(n,n+4).map(async folder=>{
     if(!ID.test(folder.name||'')||folder.id)return;
     for(const f of await listSource(allowedOwner+'/'+folder.name,0,10)){
      const m=/^([012])\.jpg$/.exec(f.name||'');if(m)photos.push({card_id:folder.name,slot:Number(m[1]),updated_at:f.updated_at||f.created_at||'',bytes:Number(f.metadata?.size)||0});
     }
    }));
    photos.sort((a,b)=>a.card_id.localeCompare(b.card_id)||a.slot-b.slot);
    return answer(200,{schema:'plant-photo-source-v1',google_permission_id:user.permissionId,photos,next_offset:folders.length===50?offset+50:null});
   }
   if(input?.action!=='copy'||!ID.test(input.card_id||'')||![0,1,2].includes(input.slot))return fail(400,'写真の指定が不正です。');
   const source=[allowedOwner,input.card_id,input.slot+'.jpg'].map(encodeURIComponent).join('/');
   const original=await storage('object/authenticated/plant-images/'+source),raw=await bytes(original),sha=await digest(raw);
   if(raw.byteLength<3||new Uint8Array(raw)[0]!==255||new Uint8Array(raw)[1]!==216)return fail(422,'元写真のJPEG形式を確認できません。');
   const blob=new Blob([raw],{type:'image/jpeg'}),key='image:'+input.card_id+':'+input.slot;
   const existing=await find('image'," and appProperties has { key='sha256' and value='"+sha+"' }");
   const file=existing[0]||await create('image-'+sha,blob,{kind:'image',sha256:sha});
   if(!ID.test(file.id||''))throw problem('Drive画像IDが不正です。');
   // Verify real Drive bytes before publishing the assignment.
   const verification=await bytes(await google('files/'+encodeURIComponent(file.id)+'?alt=media'));
   if(await digest(verification)!==sha)throw problem('Driveから再取得した写真が元画像と一致しません。登録を中止しました。');
   const ref='gdrive:'+file.id+':'+sha,recoveryKey=await digest(key+'|'+ref);
   const event={id:'plant-photo-rescue:'+recoveryKey,key,value:ref,deleted:false,parents:[],clock:-1,updated_at:'1970-01-01T00:00:00.000Z',device_id:'legacy-plant-photo-rescue'};
   // Low-priority independent history cannot beat an existing edit or deletion.
   const doc={schema:SCHEMA,namespace:NS,device_id:event.device_id,saved_at:new Date().toISOString(),events:[event],data:{[key]:ref},deleted:[]};
   const oldJournals=await find('journal'," and appProperties has { key='recovery_key' and value='"+recoveryKey+"' }");
   let journal=oldJournals[0];
   if(journal){
    const prior=await (await google('files/'+encodeURIComponent(journal.id)+'?alt=media')).json();
    if(prior.schema!==SCHEMA||prior.namespace!==NS||prior.events?.length!==1||JSON.stringify(prior.events[0])!==JSON.stringify(event))throw problem('既存の復旧履歴が一致しません。上書きせず中止しました。');
   }else journal=await create('plant-photo-rescue-'+recoveryKey+'.json',new Blob([JSON.stringify(doc)],{type:'application/json'}),{kind:'journal',recovery_key:recoveryKey});
   return answer(200,{schema:'plant-photo-copied-v1',google_permission_id:user.permissionId,key,ref,sha256:sha,verified:true,journal_id:journal.id});
  }catch(e){return fail(e.status||503,e.publicMessage||'写真復旧中に通信エラーが発生しました。保存済み写真は保持しています。');}
 };
}
