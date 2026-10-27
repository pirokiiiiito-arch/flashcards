/* Private authenticated vocabulary recovery. No vocabulary or bearer tokens are embedded. */
(function(root){
  'use strict';
  const VERSION=2;
  const ENDPOINT='https://himtyybslzzwsfmgdivx.supabase.co/functions/v1/word-drive-recovery';
  const MARKER='migration:word-network-recovery:v1';
  const EXPECTED_SHA='e876542cb106f90253cf5b9fed225334646ec5265a2eb808ffdff5e91a69c612';
  const EXPECTED_COUNT=59;
  const textKey=c=>JSON.stringify([c.word,c.meaning]);
  const canonical=list=>list.map(c=>[c.id,c.word,c.meaning,String(c.sort_order)].join('\x1f')+'\x1e').join('');
  const own=(object,key)=>Object.prototype.hasOwnProperty.call(object||{},key);
  let last={version:VERSION,stage:'未実行',received:0,added:0,kept:0,deletedSkipped:0,error:''};
  function announce(stage,extra={}){
    last={...last,...extra,stage};
    if(!root.document)return;
    let p=document.getElementById('wordNetworkProgress');
    if(!p){p=document.createElement('p');p.id='wordNetworkProgress';p.setAttribute('role','status');p.style.cssText='width:100%;white-space:pre-wrap;line-height:1.6';(document.querySelector('.topbar')||document.body).appendChild(p);}
    p.textContent='ネット同期 v2：'+stage+(last.received?'\n取得・内容検証 '+last.received+'件 ／ 追加対象 '+last.added+'件 ／ 既存 '+last.kept+'件 ／ 削除履歴 '+last.deletedSkipped+'件':'')+(last.error?'\n'+last.error:'');
  }
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
    const texts=new Map(live.map(([k,c])=>[textKey(c),k]));
    for(const [k,event] of Object.entries(view.deleted||{}))if(event?.value?.word)texts.set(textKey(event.value),k);
    const data={},timestamps={},coveredKeys=[];let kept=0,deletedSkipped=0;
    for(const c of incoming){
      const k='card:'+c.id;
      if(own(view.deleted,k)){deletedSkipped++;coveredKeys.push(k);continue;}
      if(own(current,k)){kept++;coveredKeys.push(k);continue;}
      if(texts.has(textKey(c))){kept++;coveredKeys.push(texts.get(textKey(c)));continue;}
      data[k]={...c};texts.set(textKey(c),k);coveredKeys.push(k);
      const t=String(c.updated_at||'').replace(' ','T').replace(/\+00$/,'Z').replace(/\.(\d{3})\d+(?=Z|[+-])/,'愛$1').replace('愛','.');
      timestamps[k]=Number.isFinite(Date.parse(t))?t:'1970-01-01T00:00:00.000Z';
    }
    return {data,timestamps,added:Object.keys(data).length,kept,deletedSkipped,coveredKeys};
  }
  function markerCovers(view){
    const p=view.data?.[MARKER];
    return p?.schema==='word-network-migration-v2'&&p.source_sha256===EXPECTED_SHA&&p.source_count===EXPECTED_COUNT&&Array.isArray(p.covered_keys)&&p.covered_keys.length===EXPECTED_COUNT&&p.covered_keys.every(k=>typeof k==='string'&&k.startsWith('card:')&&(own(view.data,k)||own(view.deleted,k)));
  }
  async function prepare(api,view,local){
    if(markerCovers(view)){
      const p=view.data[MARKER];
      announce('Driveの復元記録を確認しました',{received:EXPECTED_COUNT,added:0,kept:p.kept||0,deletedSkipped:p.deleted_skipped||0,error:''});
      return null;
    }
    if(!api.valid()||!api.account)throw Error('Google Driveへ接続してから単語を同期してください。');
    announce('サーバーから単語を取得中',{received:0,added:0,kept:0,deletedSkipped:0,error:''});
    api.setStatus('同期中','ネット経由で単語を取得しています（修正版 v2）。ファイル選択は不要です。');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    try{
      // Only this fixed owner-controlled endpoint receives the Drive bearer.
      const response=await api.request(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:controller.signal});
      const raw=await response.json();
      if(raw.google_permission_id!==api.account)throw Error('取得した単語とDriveのアカウントが一致しません。');
      const incoming=validate(raw);
      if(await api.digest(canonical(incoming))!==EXPECTED_SHA)throw Error('救出単語の内容の一致を確認できません。取り込みを中止しました。');
      const backupKey='word-network-before-v2:'+api.account;
      if(!await api.cache.get('states',backupKey))await api.cache.put('states',backupKey,{saved_at:new Date().toISOString(),local:structuredClone(local),view:structuredClone(view),source:raw});
      const plan=buildPlan(view,local,incoming);
      plan.data[MARKER]={schema:'word-network-migration-v2',source_sha256:EXPECTED_SHA,source_count:EXPECTED_COUNT,added:plan.added,kept:plan.kept,deleted_skipped:plan.deletedSkipped,covered_keys:plan.coveredKeys,source:'private-authenticated-snapshot',prepared_at:new Date().toISOString()};
      plan.timestamps[MARKER]=new Date().toISOString();
      announce('取得成功・Driveへ送信中',{received:EXPECTED_COUNT,added:plan.added,kept:plan.kept,deletedSkipped:plan.deletedSkipped});
      api.setStatus('同期中','単語'+EXPECTED_COUNT+'件を取得・検証しました。不足'+plan.added+'件をDriveへ送信しています。');
      return {data:plan.data,timestamps:plan.timestamps};
    }catch(e){
      const message=e?.name==='AbortError'?'単語取得が時間内に完了しませんでした。元データは保持しています。':String(e?.message||'単語を取得できませんでした。');
      announce('取得未完了',{error:message});
      throw e;
    }finally{clearTimeout(timer);}
  }
  function verifyApplied(view,local){
    const keys=Object.keys(view.data||{}).filter(k=>k.startsWith('card:'));
    const localKeys=Object.keys(local||{}).filter(k=>k.startsWith('card:'));
    if(!markerCovers(view))throw Error('単語の復元記録とデータの一致を確認できません。接続成功だけでは復旧完了になりません。');
    if(!keys.length){
      announce('単語0件・復旧未完了',{error:'削除履歴を保持しています。単語は表示できていないため復旧完了とはしていません。'});
      throw Error('単語は0件です。削除履歴を保持して停止しました。画面の「ネット同期 v2」の表示をお知らせください。');
    }
    if(keys.some(k=>!own(local,k)))throw Error('Driveには単語がありますが、端末への反映が完了していません。カード編集中なら保存してください。');
    announce('端末へ反映しました（最終送信確認中）',{error:''});
    return {drive:keys.length,local:localKeys.length};
  }
  const exported=Object.freeze({version:VERSION,prepare,buildPlan,validate,canonical,markerCovers,verifyApplied,diagnostics:()=>({...last}),marker:MARKER,expectedSha:EXPECTED_SHA,expectedCount:EXPECTED_COUNT,endpoint:ENDPOINT});
  root.WordNetworkRecovery=exported;
  if(typeof module!=='undefined'&&module.exports)module.exports=exported;
})(typeof window!=='undefined'?window:globalThis);
