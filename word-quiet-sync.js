/* Word UI only. No authentication, network, persistence, or user-data migration. */
(function(root){
  'use strict';
  const record=c=>c?[c.id,c.word,c.meaning,Number(c.sort_order)||0,c.updated_at||null]:null;
  const signature=list=>JSON.stringify(list.map(record));
  function plan(current,next,state){
    if(!Array.isArray(next)||next.some(c=>!c||typeof c.id!=='string'||typeof c.word!=='string'||typeof c.meaning!=='string')||new Set(next.map(c=>c.id)).size!==next.length)throw Error('受信した単語の形式を確認できません。端末データは保持しています。');
    if(signature(current)===signature(next))return null;
    const oldIndex=state.order[state.pos]??-1,before=current[oldIndex];
    const indices=new Map(next.map((c,i)=>[c.id,i]));
    let order;
    if(state.shuffled){
      order=state.order.map(i=>indices.get(current[i]?.id)).filter(i=>i!==undefined);
      const included=new Set(order);for(let i=0;i<next.length;i++)if(!included.has(i))order.push(i);
    }else order=next.map((_,i)=>i);
    const kept=before?order.findIndex(i=>next[i].id===before.id):-1;
    const pos=kept>=0?kept:Math.max(0,Math.min(state.pos,order.length-1));
    const newIndex=order[pos]??-1,after=next[newIndex];
    // Existing action closures capture an array index. Rebuild only if that
    // index or the visible record changed; otherwise retain the actual DOM.
    const redraw=!before||!after||oldIndex!==newIndex||JSON.stringify(record(before))!==JSON.stringify(record(after));
    return {order,pos,shuffled:!!state.shuffled,redraw,sameCard:!!before&&before.id===after?.id};
  }
  function capture(stage){
    const active=document.activeElement;
    return {x:root.scrollX,y:root.scrollY,back:!!stage.querySelector('.show-back'),
      faceScroll:[...stage.querySelectorAll('.face')].map(el=>({top:el.scrollTop,left:el.scrollLeft})),
      focus:stage.contains(active)?[...stage.querySelectorAll('button')].indexOf(active):-1};
  }
  function restore(stage,before,redraw,sameCard){
    if(sameCard){
      [...stage.querySelectorAll('.face')].forEach((el,i)=>{const p=before.faceScroll[i];if(p){el.scrollTop=p.top;el.scrollLeft=p.left;}});
      if(redraw&&before.focus>=0)stage.querySelectorAll('button')[before.focus]?.focus({preventScroll:true});
    }
    // Restore synchronously, never schedule a later scroll that could fight a swipe.
    if(root.scrollX!==before.x||root.scrollY!==before.y){
      const el=document.documentElement,old=el.style.scrollBehavior;el.style.scrollBehavior='auto';
      root.scrollTo(before.x,before.y);el.style.scrollBehavior=old;
    }
  }
  let active=null;
  const movedIds=['wordNetworkBuild','wordNetworkSync','wordRecoverMissing','wordDriveDataStatus','wordNetworkProgress','wordRecoveryResult','wordRecoveryLoadError'];
  function refresh(status,message){
    if(!active)return;
    const {api,label,button,count}=active,s=api.status(),state=status||s.status||'未接続',detail=message===undefined?s.detail:message;
    const bad=/エラー|未完了|失敗/.test(state),connected=api.valid();
    const text=bad?'同期エラー：詳細を確認':state==='同期中'?'自動同期中':state==='同期済み'?'自動同期：同期済み':connected?'自動同期：待機中':'端末保存中・Driveは未接続';
    if(label.textContent!==text)label.textContent=text;
    label.title=detail||text;label.classList.toggle('word-sync-error',bad);
    label.dataset.state=state;button.textContent=connected?'同期の詳細':'接続・詳細';
    const counter=document.getElementById('countText'),value=count()+'件';
    if(counter&&counter.textContent!==value)counter.textContent=value;
  }
  function attach(api,count){
    if(active)return;
    const toolbar=document.querySelector('.topbar');if(!toolbar)return;
    const coreButton=[...toolbar.querySelectorAll('button')].find(b=>b.textContent.startsWith('Google Drive同期：'));
    const dialog=document.createElement('dialog');dialog.id='wordQuietDetails';dialog.setAttribute('aria-labelledby','wordQuietTitle');
    const title=document.createElement('h2');title.id='wordQuietTitle';title.textContent='同期の詳細';
    const hint=document.createElement('p');hint.textContent='接続中は登録・保存後に自動同期します。通常の学習中はこの画面を開く必要はありません。';
    const tools=document.createElement('div');tools.className='word-sync-tools';
    const close=document.createElement('button');close.type='button';close.className='btn';close.textContent='閉じる';close.onclick=()=>dialog.close();
    dialog.append(title,hint,tools,close);document.body.appendChild(dialog);
    const row=document.createElement('div');row.id='wordQuietStatus';row.dataset.build='quiet1';
    const label=document.createElement('span');label.setAttribute('role','status');label.setAttribute('aria-live','polite');
    const button=document.createElement('button');button.type='button';button.className='btn';button.textContent='接続・詳細';
    button.onclick=()=>{if(!api.valid())api.open();else dialog.showModal();};
    row.append(label,button);toolbar.appendChild(row);
    active={api,label,button,count,dialog};
    if(coreButton){tools.appendChild(coreButton);coreButton.addEventListener('click',()=>{if(dialog.open)dialog.close();},true);}
    function tidy(){
      for(const id of movedIds){const el=document.getElementById(id);if(el&&el.parentNode===toolbar)tools.appendChild(el);}
      // The hidden file picker stays in place; its user-initiated behavior is unchanged.
    }
    const observer=new MutationObserver(tidy);observer.observe(toolbar,{childList:true});tidy();refresh();
    tools.addEventListener('click',event=>{if(event.target.closest('#wordNetworkSync,#wordRecoverMissing')&&!api.valid()&&dialog.open)dialog.close();},true);
  }
  const exported=Object.freeze({plan,signature,capture,restore,attach,refresh});
  root.WordQuietSync=exported;
  if(typeof module!=='undefined'&&module.exports)module.exports=exported;
})(typeof window!=='undefined'?window:globalThis);
