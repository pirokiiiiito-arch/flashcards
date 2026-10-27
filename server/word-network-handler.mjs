/* Generic handler only. Private recovery data is deployed ONLY inside the
 * owner's Supabase function bundle, never in this public repository. */
export function canonical(cards) {
  return cards.map(c => [c.id,c.word,c.meaning,String(c.sort_order)].join('\x1f')+'\x1e').join('');
}
export async function digest(text) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function createHandler({payload, allowedEmail, allowedOrigin, fetcher=globalThis.fetch}) {
  const ready=(async()=>{
    if(payload?.schema!=='word-flashcards-recovery-v1'||!Array.isArray(payload.cards)||!payload.cards.length||payload.cards.length>10000||payload.source_record_count!==payload.cards.length)return false;
    const ids=new Set();
    for(const c of payload.cards){
      if(!c||typeof c.id!=='string'||!c.id||ids.has(c.id)||typeof c.word!=='string'||typeof c.meaning!=='string'||!Number.isSafeInteger(c.sort_order))return false;
      ids.add(c.id);
    }
    return /^[a-f0-9]{64}$/.test(payload.content_sha256||'')&&await digest(canonical(payload.cards))===payload.content_sha256;
  })().catch(()=>false);
  return async function handle(req){
    const origin=req.headers.get('Origin');
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, private','Pragma':'no-cache','Vary':'Origin','X-Content-Type-Options':'nosniff'};
    if(origin===allowedOrigin){headers['Access-Control-Allow-Origin']=allowedOrigin;headers['Access-Control-Allow-Methods']='GET, POST, OPTIONS';headers['Access-Control-Allow-Headers']='authorization, apikey, content-type, x-client-info';}
    const answer=(status,data)=>new Response(JSON.stringify(data),{status,headers});
    const failure=(status,message)=>answer(status,{error:{message}});
    if(origin&&origin!==allowedOrigin)return failure(403,'このアクセス元は許可されていません。');
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
    // Health reports only bundle integrity. No words, email, tokens or identifiers.
    if(req.method==='GET')return answer(await ready?200:503,{service:'word-drive-recovery',version:1,ready:await ready});
    if(req.method!=='POST')return failure(405,'POSTで接続してください。');
    const authorization=req.headers.get('Authorization')||'';
    if(!/^Bearer [A-Za-z0-9._~+\/-]{20,4096}={0,2}$/.test(authorization))return failure(401,'Google Driveへ接続してください。');
    if(!await ready)return failure(503,'救出データの検証に失敗しました。元データは変更していません。');
    try{
      // Identity comes only from Google's authenticated response, not request body,
      // query parameters, user-editable metadata, or an email supplied by the client.
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),15000);
      let response;
      try{
        response=await fetcher('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,permissionId)',{headers:{Authorization:authorization},cache:'no-store',redirect:'error',signal:controller.signal});
      }finally{clearTimeout(timer);}
      if(response.status===401||response.status===403)return failure(401,'Google Driveへ再接続してください。');
      if(!response.ok)return failure(503,'Googleアカウントの確認を完了できませんでした。');
      const user=(await response.json())?.user;
      if(typeof user?.emailAddress!=='string'||user.emailAddress.toLowerCase()!==allowedEmail.toLowerCase()||typeof user.permissionId!=='string'||!user.permissionId)return failure(403,'救出データを持つGoogleアカウントで接続してください。');
      return answer(200,{...payload,google_permission_id:user.permissionId});
    }catch{
      // Never return or log bearer tokens or provider responses.
      return failure(503,'認証の確認中に通信エラーが起きました。再接続してお試しください。');
    }
  };
}
