/* Register only for drive-view.html; the PC editor remains outside this scope. */
(function(){
  'use strict';
  const output=document.getElementById('cachedViewerShellStatus');
  const say=text=>{if(output)output.textContent=text;};
  if(!('serviceWorker' in navigator)){say('このブラウザでは、通信なしでの画面起動は利用できません。');return;}
  if(!location.pathname.endsWith('/drive-view.html'))return;
  say('画面をオフライン用に保存しています…');
  navigator.serviceWorker.register('./drive-view-worker.js',{scope:'./drive-view.html',updateViaCache:'none'}).then(reg=>{
    const worker=reg.installing||reg.waiting||reg.active;
    if(!worker){say('画面の保存を確認できません。写真の保存状態は上の表示を確認してください。');return;}
    const update=()=>{
      if(worker.state==='activated')say('画面も端末保存済みです。保存済みの写真・文字は通信なしでも開けます。');
      else if(worker.state==='redundant')say('画面のオフライン保存を完了できませんでした。既存の写真は削除していません。');
    };
    worker.addEventListener('statechange',update);update();
    reg.update().catch(()=>{});
  }).catch(()=>say('画面のオフライン保存を完了できません。保存済み写真は保持しています。'));
})();
