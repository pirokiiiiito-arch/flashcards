/* Presentation only. Reuse the existing user-click authentication controls.
 * No tokens, network requests, timers, storage writes or automatic popups. */
(function(root){
  'use strict';
  const entries=new Map();
  function required(api,online=true){return online!==false&&!api.valid();}
  function close(dialog){
    if(!dialog?.open)return;
    if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');
  }
  function refresh(api){
    const entry=entries.get(api);if(!entry)return;
    const needed=required(api,root.navigator?.onLine);
    entry.prompt.hidden=!needed;
    entry.prompt.setAttribute('aria-hidden',String(!needed));
    if(!needed){close(entry.dialog);close(entry.coreDialog);}
  }
  function attach(api,{app,readonly=false}={}){
    if(!root.document||entries.has(api))return entries.get(api);
    const prompt=document.createElement('div');prompt.className='auth-only-prompt';prompt.id=app+'AuthRequired';prompt.hidden=true;
    // The viewer guard permits these buttons, but no editing is enabled.
    prompt.dataset.driveReadonlyControls='authentication';
    const button=document.createElement('button');button.type='button';button.className='btn auth-only-button';
    button.textContent='Google認証が必要です — 接続する';
    prompt.appendChild(button);document.body.appendChild(prompt);
    const entry={api,app,prompt,dialog:null,coreDialog:null};entries.set(api,entry);
    if(readonly){
      const controls=document.querySelector('.drive-readonly-controls');
      const connect=controls?.querySelector('button');
      if(!connect)throw Error('既存のGoogle接続ボタンを確認できません。');
      const dialog=document.createElement('dialog');dialog.id=app+'AuthDialog';dialog.className='auth-only-dialog';
      dialog.dataset.driveReadonlyControls='authentication-dialog';
      dialog.setAttribute('aria-labelledby',app+'AuthTitle');
      const title=document.createElement('h2');title.id=app+'AuthTitle';title.textContent='Google Driveへ接続';
      const description=document.createElement('p');description.textContent='いつものGoogleアカウントで認証してください。接続後は自動で同期し、この案内は消えます。';
      const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='btn';dismiss.textContent='閉じる';dismiss.onclick=()=>close(dialog);
      // Move the original node: retain its direct user-gesture OAuth handler.
      dialog.append(title,description,connect,dismiss);document.body.appendChild(dialog);entry.dialog=dialog;
      button.onclick=()=>{
        if(!required(api,root.navigator?.onLine)){refresh(api);return;}
        if(dialog.showModal){if(!dialog.open)dialog.showModal();}else dialog.setAttribute('open','');
      };
    }else{
      button.onclick=()=>{
        if(!required(api,root.navigator?.onLine)){refresh(api);return;}
        api.open();entry.coreDialog=document.querySelector('dialog [data-connect]')?.closest('dialog')||null;
      };
    }
    const update=()=>refresh(api);
    root.addEventListener('online',update);root.addEventListener('offline',update);root.addEventListener('focus',update);root.addEventListener('pageshow',update);
    document.addEventListener('visibilitychange',update);
    refresh(api);return entry;
  }
  const exported=Object.freeze({required,attach,refresh});root.AuthOnlySync=exported;
  if(typeof module!=='undefined'&&module.exports)module.exports=exported;
})(typeof window!=='undefined'?window:globalThis);
