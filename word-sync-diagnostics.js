/* Opt-in local-only diagnostics; default study UI remains unchanged. */
(function(root){
  'use strict';
  if(!root.document) return;
  let panel, details, showing=false;
  const clean=v=>String(v??'').replace(/Bearer\s+[^\s]+/gi,'Bearer [非表示]').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[メールアドレス非表示]').slice(0,180);
  function update(){
    if(!showing||!details)return;
    try{
      const list=typeof cards==='undefined'?[]:cards;
      const ids=list.map(x=>String(x.id||'')).filter(Boolean);
      const api=root.WordDriveSync,st=api?.status?.()||{},view=api?.view?.()||{data:{},deleted:{}};
      const live=Object.keys(view.data||{}).filter(k=>k.startsWith('card:')).length;
      const removed=Object.keys(view.deleted||{}).filter(k=>k.startsWith('card:')).length;
      const phase=root.PersistentDriveAuth?.state?.().phase||'不明';
      const legacy=root.WordNetworkRecovery?.diagnostics?.().stage||'未確認';
      const enabled=root.localStorage.getItem('word_drive_primary_v1')==='1';
      details.textContent=[
        '端末の単語数：'+list.length+'件',
        '単語IDの重複：'+(ids.length-new Set(ids).size)+'件 ／ IDなし：'+(list.length-ids.length)+'件',
        'Driveへの切替：'+(enabled?'完了':'未完了'),
        '同期プログラム：'+(api?'読込済み':'未読込'),
        '同期コード：'+(root.WordAutoSyncBuild||'旧版または未読込'),
        'Google認証：'+clean(phase),
        'Drive API認証：'+(api?(api.valid()?'利用可能':'未接続'):'確認できない'),
        '同期処理：'+clean(st.status||'未開始'),
        '送信待ちの変更：'+(typeof st.pending==='number'?st.pending:'不明')+'件',
        '取得済みDrive履歴：'+live+'件（この端末のキャッシュ）',
        '取得済み削除履歴：'+removed+'件',
        '旧データ復旧：'+clean(legacy),
        '同期エラー・詳細：'+clean(st.detail||'なし')
      ].join('\n');
    }catch(e){details.textContent='診断表示エラー：'+clean(e?.message||'不明');}
  }
  function show(){
    if(showing){panel?.scrollIntoView?.({block:'nearest'});return;}
    showing=true;
    panel=document.createElement('section');
    panel.style.cssText='background:#fff;border:1px solid #ccd6e2;border-radius:14px;margin:22px 0;padding:16px;line-height:1.6';
    const heading=document.createElement('h2');
    heading.textContent='単語帳の同期診断（読み取り専用）';
    heading.style.cssText='font-size:18px;margin:0 0 8px';
    const note=document.createElement('p');
    note.textContent='単語の内容・認証情報は表示・送信しません。データは変更しません。';
    note.style.cssText='font-size:13px;margin:0 0 10px';
    details=document.createElement('pre');
    details.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.7 system-ui;margin:0';
    panel.append(heading,note,details);
    (document.querySelector('.wrap')||document.body).appendChild(panel);
    update();root.setInterval(update,2000);
    panel.scrollIntoView?.({block:'nearest'});
  }
  const counter=document.getElementById('countText');
  let clicks=0,last=0;
  counter?.addEventListener('click',()=>{
    const now=Date.now();
    clicks=now-last<1800?clicks+1:1;
    last=now;
    if(clicks>=5){clicks=0;show();}
  });
  try{if(new URLSearchParams(root.location.search).has('sync-check'))show();}catch{}
})(typeof window!=='undefined'?window:globalThis);
