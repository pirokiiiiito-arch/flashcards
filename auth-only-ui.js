/* Authentication presentation only. Never reads credentials or changes data.
 * Readiness is independent of card rendering and optional sync UI callbacks.
 * OAuth stays behind original user-click controls; no automatic popup. */
(function(root){
  'use strict';
  const entries=new Map();let readinessTimer=null;
  function required(api){try{return !api||typeof api.valid!=='function'||!api.valid();}catch{return true;}}
  function close(dialog){if(!dialog?.open)return;if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');}
  function show(dialog){if(dialog.showModal){if(!dialog.open)dialog.showModal();}else dialog.setAttribute('open','');}
  function refresh(api){
    const entry=entries.get(api);if(!entry)return;
    // Connectivity hints cannot prove authentication or hide the reconnect route.
    const needed=required(api);
    entry.prompt.hidden=!needed;entry.prompt.setAttribute('aria-hidden',String(!needed));
    const fallback=document.getElementById('authStartupFallback');if(fallback)fallback.hidden=true;
    if(!needed){close(entry.dialog);close(entry.coreDialog);}
  }
  function viewerDialog(entry){
    if(entry.dialog)return entry.dialog;
    const controls=document.querySelector('.drive-readonly-controls');
    const connect=controls?.querySelector('button');if(!connect)return null;
    const {app}=entry,dialog=document.createElement('dialog');dialog.id=app+'AuthDialog';dialog.className='auth-only-dialog';
    dialog.dataset.driveReadonlyControls='authentication-dialog';dialog.setAttribute('aria-labelledby',app+'AuthTitle');
    const title=document.createElement('h2');title.id=app+'AuthTitle';title.textContent='Google Driveへ接続';
    const description=document.createElement('p');description.textContent='いつものGoogleアカウントで認証してください。接続後は自動で同期し、この案内は消えます。';
    const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='btn';dismiss.textContent='閉じる';dismiss.onclick=()=>close(dialog);
    dialog.append(title,description,connect,dismiss);document.body.appendChild(dialog);entry.dialog=dialog;return dialog;
  }
  function openEntry(entry){
    if(!required(entry.api)){refresh(entry.api);return;}
    if(entry.readonly){
      const dialog=viewerDialog(entry);
      if(dialog){show(dialog);return;}
      entry.button.textContent='接続機能を読み込めません — 再読込';entry.button.onclick=()=>root.location.reload();return;
    }
    entry.api.open();entry.coreDialog=document.querySelector('dialog [data-connect]')?.closest('dialog')||null;
  }
  function attach(api,{app,readonly=false}={}){
    if(!root.document||!document.body)return null;
    if(entries.has(api)){refresh(api);return entries.get(api);}
    const prompt=document.createElement('div');prompt.className='auth-only-prompt';prompt.id=app+'AuthRequired';prompt.hidden=true;
    prompt.dataset.driveReadonlyControls='authentication';
    const button=document.createElement('button');button.type='button';button.className='btn auth-only-button';button.textContent='Google認証が必要です — 接続する';
    prompt.appendChild(button);document.body.appendChild(prompt);
    const entry={api,app,readonly,prompt,button,dialog:null,coreDialog:null};entries.set(api,entry);
    button.onclick=()=>openEntry(entry);if(readonly)viewerDialog(entry);
    // The native status node changes even when an old quiet-UI script lacks hooks.
    // Observe only that node, never our own prompt, to avoid observer feedback.
    const target=readonly?document.querySelector('.drive-readonly-controls'):document.getElementById('wordQuietStatus')||document.querySelector('.study-quiet-row');
    if(target&&root.MutationObserver){entry.observer=new root.MutationObserver(()=>refresh(api));entry.observer.observe(target,{childList:true,subtree:true,characterData:true});}
    refresh(api);return entry;
  }
  function recheck(){
    if(!root.document||!document.body)return null;
    let current=null;
    for(const [app,api] of [['words',root.WordDriveSync],['plants',root.PlantDriveSync],['colors',root.ColorDriveSync]]){
      if(!api||typeof api.valid!=='function'||typeof api.open!=='function')continue;
      current=attach(api,{app,readonly:app!=='words'&&!!root.FLASHCARDS_READONLY_VIEW});refresh(api);
    }
    if(!current){const fallback=document.getElementById('authStartupFallback');if(fallback)fallback.hidden=false;}
    return current;
  }
  function openCurrent(){
    const entry=recheck();if(entry){openEntry(entry);return;}
    const fallback=document.getElementById('authStartupFallback'),button=fallback?.querySelector('button');
    if(button){button.textContent='接続機能を読み込めません — 再読込';button.onclick=()=>root.location.reload();}
  }
  function stop(){if(readinessTimer!==null){root.clearInterval(readinessTimer);readinessTimer=null;}}
  function start(){recheck();if(readinessTimer===null)readinessTimer=root.setInterval(()=>{if(document.visibilityState!=='hidden')recheck();},1000);}
  const exported=Object.freeze({required,attach,refresh,recheck,openCurrent});root.AuthOnlySync=exported;
  if(typeof module!=='undefined'&&module.exports)module.exports=exported;
  if(root.document){
    for(const event of ['online','offline','focus'])root.addEventListener(event,recheck);
    root.addEventListener('pageshow',start);root.addEventListener('pagehide',stop);document.addEventListener('visibilitychange',recheck);
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  }
})(typeof window!=='undefined'?window:globalThis);
