/* UI/scheduling only for plants and colors. No credentials, storage migrations,
 * cloud mutation API, new auth flow, or private data in this module. */
(function(root){
  'use strict';
  const stable=value=>JSON.stringify(value,function(k,v){return v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v;});
  const same=(a,b)=>stable(a)===stable(b);
  function plantPlan(current,next,state){
    if(!Array.isArray(next)||next.some(c=>!c||typeof c.id!=='string'||typeof c.name!=='string'||typeof c.description!=='string')||new Set(next.map(c=>c.id)).size!==next.length)throw Error('植物の受信データを確認できません。端末データは保持しています。');
    if(same(current,next))return null;
    const oldIndex=state.order[state.pos]??-1,before=current[oldIndex];
    const indices=new Map(next.map((c,i)=>[c.id,i]));
    const eligible=next.map((c,i)=>({c,i})).filter(x=>x.c.group===state.group).map(x=>x.i);
    let order=eligible;
    if(state.shuffled){order=state.order.map(i=>indices.get(current[i]?.id)).filter(i=>i!==undefined&&next[i].group===state.group);const used=new Set(order);order.push(...eligible.filter(i=>!used.has(i)));}
    const at=before?order.findIndex(i=>next[i].id===before.id):-1;
    const pos=at>=0?at:Math.max(0,Math.min(state.pos,order.length-1)),newIndex=order[pos]??-1,after=next[newIndex];
    // The original edit/delete handlers capture array indices and card values.
    return {order,pos,shuffled:!!state.shuffled,sameCard:!!before&&before.id===after?.id,redraw:oldIndex!==newIndex||!same(before,after)};
  }
  function capture(element){
    const el=element||document.body,active=document.activeElement;
    return {x:root.scrollX||0,y:root.scrollY||0,back:!!el.querySelector('.show-back'),
      scroll:[...el.querySelectorAll('.face,.back-body')].map(x=>[x.scrollTop,x.scrollLeft]),
      focus:el.contains(active)?[...el.querySelectorAll('button,input,textarea')].indexOf(active):-1};
  }
  function restore(element,snapshot,restoreFocus=false){
    const el=element||document.body;
    [...el.querySelectorAll('.face,.back-body')].forEach((node,i)=>{const p=snapshot.scroll[i];if(p){node.scrollTop=p[0];node.scrollLeft=p[1];}});
    if(restoreFocus&&snapshot.focus>=0)el.querySelectorAll('button,input,textarea')[snapshot.focus]?.focus({preventScroll:true});
    if(root.scrollX!==snapshot.x||root.scrollY!==snapshot.y){const html=document.documentElement,old=html.style.scrollBehavior;html.style.scrollBehavior='auto';root.scrollTo(snapshot.x,snapshot.y);html.style.scrollBehavior=old;}
  }
  function createPoller(api,options={}){
    const now=options.now||Date.now,setTimer=options.setTimer||setTimeout,clearTimer=options.clearTimer||clearTimeout;
    const visible=options.visible||(()=>!root.document||root.document.visibilityState==='visible');
    const online=options.online||(()=>root.navigator?.onLine!==false),editing=options.editing||(()=>false);
    const interval=options.interval||15000,minGap=options.minGap||5000;
    let timer=null,running=null,last=-Infinity,failures=0,stopped=true;
    function schedule(){clearTimer(timer);if(!stopped)timer=setTimer(()=>tick().catch(()=>{}),Math.min(120000,interval*Math.pow(2,Math.min(failures,3))));}
    function tick(){
      if(running)return running;
      if(stopped||!visible()||!online()||editing()||!api.valid()||now()-last<minGap){schedule();return Promise.resolve(false);}
      last=now();clearTimer(timer);
      running=Promise.resolve().then(()=>api.sync()).then(()=>{failures=0;return true;}).catch(e=>{failures++;options.onError?.(e);return false;}).finally(()=>{running=null;schedule();});
      return running;
    }
    return {start(){stopped=false;return tick();},stop(){stopped=true;clearTimer(timer);},tick,state:()=>({running:!!running,failures,stopped,last})};
  }
  const entries=new Map(),lastStatus=new Map();
  function status(app,s,message=''){lastStatus.set(app,{s,message});refresh(app);}
  function refresh(app){
    const entry=entries.get(app);if(!entry)return;
    const {api,label,options}=entry,raw=api.status(),notice=lastStatus.get(app)||{s:raw.status,message:raw.detail||''};
    const bad=/エラー|失敗|未完了/.test(notice.s),cacheWarning=document.getElementById('localPhotoStorageStatus')?.textContent||'';
    const warn=options.warning?.()||(/一部の保存に失敗|継続保存できません/.test(cacheWarning)?'端末保存に失敗：詳細を確認':'');
    const text=bad?'同期エラー：詳細を確認':warn?warn:/同期中|受信中|確認中/.test(notice.s)?'自動同期中':!api.valid()?(raw.cached?'保存済みで閲覧・Drive未接続':'端末保存中・Drive未接続'):'自動同期：接続中';
    if(label.textContent!==text)label.textContent=text;
    label.dataset.state=notice.s;label.classList.toggle('sq-error',bad||!!warn);label.title=notice.message||text;
  }
  function attach(api,options){
    const {app,toolbar:selector}=options;if(entries.has(app)||!root.document)return;
    const toolbar=document.querySelector(selector);if(!toolbar)return;
    if(!document.getElementById('studyQuietStyles')){
      const style=document.createElement('style');style.id='studyQuietStyles';style.textContent=`
.study-quiet-row{box-sizing:border-box!important;display:grid!important;grid-template-columns:minmax(0,1fr) 124px!important;gap:8px!important;width:100%!important;height:46px!important;min-height:46px!important;margin:6px 0!important;align-items:center!important;font-size:13px!important}
.study-quiet-row>span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:22px}.study-quiet-row>button{width:124px!important;height:40px!important;min-height:40px!important;margin:0!important;padding:6px!important;white-space:nowrap!important;font-size:13px!important}.sq-error{color:#a32e25;font-weight:700}
.study-quiet-dialog{box-sizing:border-box;width:min(740px,94vw);max-height:85vh;overflow:auto;border:1px solid #cbd1d9;border-radius:16px;padding:20px;background:#fff;color:#1f2937}.study-quiet-dialog:not([open]){display:none}.study-quiet-dialog::backdrop{background:#18233388}.study-quiet-tools{display:flex;flex-wrap:wrap;gap:8px}.study-quiet-tools>p,.study-quiet-tools>section{width:100%;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px!important}.study-quiet-dialog button{font:inherit;cursor:pointer}.study-quiet-dialog h2{font-size:21px}
#imageSyncStatus{display:inline-block!important;visibility:visible!important;opacity:1!important;max-width:100%;min-height:25px;line-height:25px;white-space:normal;overflow:visible}#plantDriveImageCopyStatus{display:block!important;visibility:visible!important;opacity:1!important;width:100%!important;white-space:pre-wrap!important}
`;document.head.appendChild(style);
    }
    const dialog=document.createElement('dialog');dialog.id=app+'QuietDetails';dialog.className='study-quiet-dialog';dialog.setAttribute('aria-label','同期の詳細');
    const title=document.createElement('h2');title.textContent='同期の詳細';
    const hint=document.createElement('p');hint.textContent=options.readonly?'接続中は15秒ごと・画面に戻ったときに変更分を自動確認します。保存済み写真は再利用します。編集は通常版で行ってください。':'接続中は追加・編集の保存後に自動送信します。他の端末の変更も15秒ごとに確認します。編集中は画面を置き換えません。';
    const tools=document.createElement('div');tools.className='study-quiet-tools';
    const close=document.createElement('button');close.type='button';close.className='btn';close.textContent='閉じる';close.dataset.driveReadonlyControls='quiet-close';close.onclick=()=>dialog.close();
    dialog.append(title,hint,tools,close);document.body.appendChild(dialog);
    const row=document.createElement('div');row.className='study-quiet-row';row.dataset.driveReadonlyControls='quiet-summary';row.dataset.build='studyquiet1';
    const label=document.createElement('span');label.setAttribute('role','status');label.setAttribute('aria-live','polite');
    const button=document.createElement('button');button.type='button';button.className='btn';button.textContent='接続・同期の詳細';button.onclick=()=>dialog.showModal();row.append(label,button);toolbar.appendChild(row);
    const ids=new Set(['plantNetworkSync','plantNetworkStatus','plantDriveImageCopyStatus','plantQuietDiagnostics','colorNetworkSync','colorNetworkStatus','colorImageMigrationStatus']);
    const control=/^(Google Drive同期：|全画像をDriveへコピー|画像コピー結果を保存|既存940写真|940写真をDrive|以前追加した写真を復元|写真移行の結果を保存|このPCの通常順をスマホに反映)/;
    const keepPlantDiagnostic=el=>app==='plants'&&(el.id==='plantDriveImageCopyStatus'||(el.tagName==='BUTTON'&&/^(全画像をDriveへコピー|画像コピー結果を保存)/.test(el.textContent)));
    function tidy(){for(const el of [...toolbar.children])if(el!==row&&!keepPlantDiagnostic(el)&&(ids.has(el.id)||el.classList.contains('drive-readonly-controls')||el.matches('p[role="status"]')||(el.tagName==='BUTTON'&&control.test(el.textContent))))tools.appendChild(el);}
    const entry={api,label,dialog,options};entries.set(app,entry);tidy();
    new MutationObserver(()=>{tidy();refresh(app);}).observe(toolbar,{childList:true});
    new MutationObserver(()=>refresh(app)).observe(tools,{childList:true,subtree:true,characterData:true});
    // Existing auth handlers still run directly on user clicks. Never open OAuth
    // dialogs from a timer or keep access tokens beyond their existing lifetime.
    tools.addEventListener('click',event=>{const b=event.target.closest?.('button');if(b&&!options.readonly&&(!api.valid()||b.textContent.startsWith('Google Drive同期：'))&&dialog.open)dialog.close();},true);
    const poller=createPoller(api,{editing:options.editing,onError:e=>status(app,'同期未完了',e.message||String(e))});entry.poller=poller;
    root.addEventListener('focus',()=>poller.tick());root.addEventListener('online',()=>poller.tick());document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')poller.tick();});
    root.addEventListener('pagehide',()=>poller.stop());root.addEventListener('pageshow',()=>poller.start());poller.start();refresh(app);
    return entry;
  }
  const exported=Object.freeze({same,stable,plantPlan,capture,restore,createPoller,status,refresh,attach});root.StudyQuietSync=exported;
  if(typeof module!=='undefined'&&module.exports)module.exports=exported;
})(typeof window!=='undefined'?window:globalThis);
