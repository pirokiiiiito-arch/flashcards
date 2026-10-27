/* Browser-side recovery plan only. No private vocabulary or OAuth secrets here.
 * The fixed owner-controlled endpoint validates the current Google Drive identity. */
(function(root){
  'use strict';
  const ENDPOINT='https://himtyybslzzwsfmgdivx.supabase.co/functions/v1/word-drive-recovery';
  const MARKER='migration:word-network-recovery:v1';
  const EXPECTED_SHA='e876542cb106f90253cf5b9fed225334646ec5265a2eb808ffdff5e91a69c612';
  const EXPECTED_COUNT=59;
  const textKey=c=>JSON.stringify([c.word,c.meaning]);
  const canonical=list=>list.map(c=>[c.id,c.word,c.meaning,String(c.sort_order)].join('\x1f')+'\x1e').join('');
  const own=(object,key)=>Object.prototype.hasOwnProperty.call(object||{},key);
  function validate(raw){
    if(raw?.schema!=='word-flashcards-recovery-v1'||!Array.isArray(raw.cards)||raw.source_record_count!==EXPECTED_COUNT||raw.cards.length!==EXPECTED_COUNT||raw.content_sha256!==EXPECTED_SHA)throw Error('ネット上の救出データの形式・件数が一致しません。保存データは変更していません。');
    const ids=new Set();
    return raw.cards.map(c=>{
      if(!c||typeof c.id!=='string'||!/^[-\w]{1,128}$/.test(c.id)||ids.has(c.id)||typeof c.word!=='string'||!c.word.trim()||c.word.length>10000||typeof c.meaning!=='string'||c.meaning.length>100000||!Number.isSafeInteger(c.sort_order)||(c.updated_at!==null&&typeof c.updated_at!=='string'))throw Error('救出データの単語形式を確認できません。');
      ids.add(c.id);return {id:c.id,word:c.word,meaning:c.meaning,sort_order:c.sort_order,updated_at:c.updated_at};
    });
  }
  function buildPlan(view,local,incoming){
    const current={...(view.data||{}),...(local||{})};
    const live=Object.entries(current).filter(([k,v])=>k.startsWith('card:')&&v&&typeof v.word==='string'&&typeof v.meaning==='string');
    const texts=new Set(live.map(([,c])=>textKey(c)));
    // A concurrent edit to a deleted card must not be bypassed with a new ID.
    for(const event of Object.values(view.deleted||{}))if(event?.value?.word)texts.add(textKey(event.value));
    const data={},timestamps={};let kept=0,deletedSkipped=0;
    for(const c of incoming){
      const k='card:'+c.id;
      if(own(current,k)||texts.has(textKey(c))){kept++;continue;}
      if(own(view.deleted,k)){deletedSkipped++;continue;}
      data[k]={...c};texts.add(textKey(c));
      // SQL timestamps are normalized only for event ordering; card text/data stay exact.
      const t=String(c.updated_at||'').replace(' ','T').replace(/\+00$/,'Z').replace(/\.(\d{3})\d+(?=Z|[+-])/,'着$1').replace('着','.');
      timestamps[k]=Number.isFinite(Date.parse(t))?t:'1970-01-01T00:00:00.000Z';
    }
    return {data,timestamps,added:Object.keys(data).length,kept,deletedSkipped};
  }
  async function prepare(api,view,local){
    const prior=view.data?.[MARKER];
    if(prior?.schema==='word-network-migration-v1'&&prior.source_sha256===EXPECTED_SHA&&prior.source_count===EXPECTED_COUNT)return null;
    if(!api.valid()||!api.account)throw Error('Google Driveへ接続してから単語を同期してください。');
    api.setStatus('同期中','ネット経由で救出済みの単語を取得しています。ファイル選択は不要です。');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    let raw;
    try{
      // request() attaches the Google token ONLY to this fixed, owner-controlled
      // authenticated migration endpoint. The token is never stored or logged.
      const response=await api.request(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:controller.signal});
      raw=await response.json();
    }finally{clearTimeout(timer);}
    if(raw.google_permission_id!==api.account)throw Error('取得した単語とDriveのアカウントが一致しません。');
    const incoming=validate(raw);
    if(await api.digest(canonical(incoming))!==EXPECTED_SHA)throw Error('救出単語の内容の一致を確認できません。取り込みを中止しました。');
    const backupKey='word-network-before-v1:'+api.account;
    if(!await api.cache.get('states',backupKey))await api.cache.put('states',backupKey,{saved_at:new Date().toISOString(),local:structuredClone(local),view:structuredClone(view),source:raw});
    const plan=buildPlan(view,local,incoming);
    plan.data[MARKER]={schema:'word-network-migration-v1',source_sha256:EXPECTED_SHA,source_count:EXPECTED_COUNT,added:plan.added,kept:plan.kept,deleted_skipped:plan.deletedSkipped,source:'private-authenticated-snapshot',prepared_at:new Date().toISOString()};
    plan.timestamps[MARKER]=new Date().toISOString();
    api.setStatus('同期中','救出単語'+EXPECTED_COUNT+'件を検証しました。不足'+plan.added+'件をDriveへ送信しています。');
    return {data:plan.data,timestamps:plan.timestamps};
  }
  const exported=Object.freeze({prepare,buildPlan,validate,canonical,marker:MARKER,expectedSha:EXPECTED_SHA,expectedCount:EXPECTED_COUNT,endpoint:ENDPOINT});
  root.WordNetworkRecovery=exported;
  if(typeof module!=='undefined'&&module.exports)module.exports=exported;
})(typeof window!=='undefined'?window:globalThis);
