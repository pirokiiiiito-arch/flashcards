/* Existing end-user authentication only. No privileged server endpoint, service
 * key, public photo URL or new storage permission. Old storage is read-only. */
(function(root){
 'use strict';
 const own=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
 const safeId=x=>typeof x==='string'&&/^[\w-]{1,160}$/.test(x);
 function create(o){
  let lastCheck=0,last={source:0,imported:0,authRequired:false,error:''},sessionPromise=null;
  const now=o.now||Date.now,fetcher=o.fetch||root.fetch.bind(root);
  async function session(){
   if(!sessionPromise)sessionPromise=Promise.resolve().then(o.getSession).finally(()=>{sessionPromise=null;});
   const s=await sessionPromise;
   if(!s?.access_token||!safeId(s.user?.id)){last.authRequired=true;o.onAuthRequired?.();return null;}
   last.authRequired=false;return s;
  }
  async function request(s,path,options={}){
   if(!path.startsWith('/storage/v1/')&&path!=='/auth/v1/user')throw Error('未対応の旧保存先です。');
   const headers={apikey:o.publicKey,Authorization:'Bearer '+s.access_token,'Content-Type':'application/json'};
   const r=await fetcher(o.url+path,{...options,headers,redirect:'error',signal:AbortSignal.timeout(25000)});
   if(r.status===401){last.authRequired=true;o.onAuthRequired?.();throw Error('以前の植物写真へのログインが必要です。');}
   if(!r.ok)throw Error('旧写真を取得できません（HTTP '+r.status+'）。元画像は保持しています。');return r;
  }
  async function verifiedSession(api){
   const s=await session();if(!s)return null;
   const user=await(await request(s,'/auth/v1/user')).json();
   const google=(await(await api.request('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)')).json()).user;
   if(user.id!==s.user.id||!user.email||!google?.emailAddress||user.email.toLowerCase()!==google.emailAddress.toLowerCase())throw Error('旧写真とGoogle Driveのアカウントが異なります。同じ本人のアカウントで接続してください。');
   return s;
  }
  async function readPhoto(s,id,index){
   if(!safeId(id)||![0,1,2].includes(index))throw Error('旧写真の指定が不正です。');
   const path=[s.user.id,id,index+'.jpg'].map(encodeURIComponent).join('/');
   const r=await request(s,'/storage/v1/object/authenticated/plant-images/'+path);
   if(Number(r.headers.get('content-length')||0)>25*1024*1024)throw Error('旧写真が大きすぎます。');
   const b=await r.blob();if(!b.size||b.size>25*1024*1024)throw Error('旧写真のサイズを確認できません。');return o.imageBlob?o.imageBlob(b):b;
  }
  async function resolve(value){
   const local=await o.resolveLocal(value);if(local||!String(value).startsWith('idb:'))return local;
   const rows=[];for(const c of o.getCards())o.getImages(c).forEach((v,i)=>{if(v===value)rows.push([c.id,i]);});
   if(rows.length!==1)return '';
   const s=await verifiedSession(o.getApi());if(!s)return '';
   const blob=await readPhoto(s,rows[0][0],rows[0][1]);return o.toDataURL(blob);
  }
  async function migrate(api,view){
   if(now()-lastCheck<60000)return null;
   try{
    const s=await verifiedSession(api);if(!s)return null;
    const list=async prefix=>{const all=[];for(let offset=0;offset<20000;offset+=1000){const p=await(await request(s,'/storage/v1/object/list/plant-images',{method:'POST',body:JSON.stringify({prefix,offset,limit:1000,sortBy:{column:'name',order:'asc'}})})).json();if(!Array.isArray(p))throw Error('旧写真の一覧を確認できません。');all.push(...p);if(p.length<1000)return all;}throw Error('旧写真の一覧が上限を超えています。');};
    const byId=new Map(o.getCards().map(c=>[c.id,c])),data={},timestamps={};let source=0;
    // Old permanent "migration complete" flags are intentionally not used.
    for(const folder of await list(s.user.id)){
     if(!safeId(folder.name)||folder.id)continue;
     const c=byId.get(folder.name);if(!c||own(view.deleted,'card:'+c.id))continue;
     for(const f of await list(s.user.id+'/'+folder.name)){
      const m=/^([012])\.jpg$/.exec(f.name);if(!m)continue;source++;
      const i=Number(m[1]),key='image:'+c.id+':'+i;
      if(own(view.data,key)||own(view.deleted,key)||o.getImages(c)[i])continue;
      const blob=await readPhoto(s,c.id,i),ref=await api.putBlob(blob);
      const verified=await api.getBlob(ref,{fresh:true});
      if(await api.digest(await blob.arrayBuffer())!==await api.digest(await verified.arrayBuffer()))throw Error('Driveへコピーした写真の一致を確認できません。');
      const current=o.getCards().find(x=>x.id===c.id);if(!current||o.getImages(current)[i])continue;
      data[key]=ref;timestamps[key]=f.updated_at||f.created_at||'';
     }
    }
    lastCheck=now();last={source,imported:Object.keys(data).length,authRequired:false,error:''};o.onAuthenticated?.();
    return Object.keys(data).length?{data,timestamps}:null;
   }catch(e){last.error=String(e.message||e);throw e;}
  }
  return {migrate,resolve,status:()=>({...last}),retry:()=>{lastCheck=0;}};
 }
 const api={create};root.PlantLegacyPhotoSource=Object.freeze(api);if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
