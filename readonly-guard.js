/* Loaded only by storage-free viewer pages. Never removes saved browser data. */
(function(){
  'use strict';
  const allowed=new Set(['prev','next','flip','shuffle','reset','modeStudy','modeList','pagePrev','pageNext','colorNetworkSync','homeBtn','prevBtn','nextBtn','shuffleBtn','plantNetworkSync','imageSyncStatus']);
  const navigation=b=>allowed.has(b.id)||b.hasAttribute('data-group')||b.hasAttribute('data-cat')||b.hasAttribute('data-index')||!!b.closest('[data-drive-readonly-controls]');
  function lock(){
    for(const b of document.querySelectorAll('button'))if(!navigation(b)&&!b.disabled){b.disabled=true;b.setAttribute('title','閲覧専用です。編集は通常のPC画面で行ってください。');}
    for(const el of document.querySelectorAll('[contenteditable="true"]'))el.contentEditable='false';
    for(const el of document.querySelectorAll('input[type="file"],textarea'))el.disabled=true;
    const storageNotice=document.getElementById('originEditorStorageNotice');if(storageNotice)storageNotice.hidden=true;
    for(const p of document.querySelectorAll('.paste-hint,.paste-note,p.notice'))if(p.textContent.includes('編集')||p.textContent.includes('貼り付け'))p.textContent='閲覧専用です。写真・由来の編集は通常のPC画面で行ってください。';
  }
  document.addEventListener('click',e=>{const b=e.target.closest?.('button');if(b&&!navigation(b)){e.preventDefault();e.stopImmediatePropagation();}},true);
  for(const type of ['paste','drop','beforeinput'])document.addEventListener(type,e=>{if(e.target.closest?.('[data-paste-target],.image-box,textarea,[contenteditable]')){e.preventDefault();e.stopImmediatePropagation();}},true);
  let scheduled=false;
  new MutationObserver(()=>{if(!scheduled){scheduled=true;queueMicrotask(()=>{scheduled=false;lock();});}}).observe(document.body,{subtree:true,childList:true});
  lock();
})();
