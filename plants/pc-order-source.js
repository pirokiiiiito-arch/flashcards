/* PC editor only. Shares IDs in normal order, not the temporary shuffle order.
 * No names, descriptions or images are copied or rewritten by this control. */
(function(root){
  'use strict';
  const STORAGE='plant_pc_normal_order_v1';
  function create(options={}){
    const O=root.PlantNormalOrder,storage=options.storage||root.localStorage;
    let record=null,leader=false,api=null,button=null,notice=null;
    const raw=storage.getItem(STORAGE);
    if(raw){const saved=JSON.parse(raw);record=O.validate(saved.record);leader=saved.leader===true;}
    function commit(next,isLeader){
      const clean=O.validate(next);
      storage.setItem(STORAGE,JSON.stringify({record:clean,leader:!!isLeader}));
      record=clean;leader=!!isLeader;
    }
    function read(){return record?O.validate(record):null;}
    function accept(value){
      if(!value)return;
      const next=O.validate(value);
      if(record&&record.revision===next.revision&&JSON.stringify(record)!==JSON.stringify(next))throw Error('PC順序の更新IDが一致しません。');
      if(!record||JSON.stringify(record)!==JSON.stringify(next))commit(next,false);
    }
    function publish(list){
      if(!list.length)throw Error('植物が0件のため、PC順序は送信しません。');
      const revision=root.crypto?.randomUUID?.()||'pc-order-'+Date.now()+'-'+Math.random().toString(16).slice(2);
      const next=O.createRecord(list,revision,new Date().toISOString());commit(next,true);return read();
    }
    function capture(list){
      if(!leader||!record)return;
      const ids=list.map(c=>c.id);
      if(JSON.stringify(ids)!==JSON.stringify(record.ids))publish(list);
    }
    function status(s){
      if(!notice)return;
      const received=api?.view()?.data?.[O.KEY];
      if(record&&received?.revision===record.revision&&s==='同期済み')notice.textContent='PCの通常順をDriveへ共有しました。スマホで「変更分だけ同期」を押すと同じ順番になります。';
      else if(record)notice.textContent='PCの通常順 '+record.ids.length+'件を保持しています。'+(s==='未接続'?'接続するとDriveへ共有します。':'');
    }
    function attach(value){
      api=value;
      const toolbar=document.querySelector('.toolbar')||document.body;
      button=document.createElement('button');button.type='button';button.className='btn';button.id='publishPcPlantOrder';button.textContent='このPCの通常順をスマホに反映';
      notice=document.createElement('p');notice.id='plantPcOrderStatus';notice.setAttribute('role','status');notice.style.cssText='width:100%;font-size:13px;line-height:1.7';
      notice.textContent='並び順を変更しているPCでは、このボタンで通常順を共有できます。シャッフルの一時順は送信しません。';toolbar.append(button,notice);
      button.onclick=async()=>{
        button.disabled=true;
        try{
          await api.ready;
          if(editing||api.applying||api.status().status==='同期中')throw Error('カード編集・同期が終わってから押してください。');
          publish(cards);api.changed();
          notice.textContent='PCの通常順 '+record.ids.length+'件を保存しました。Driveへ共有します。';
          if(!api.valid()){api.open();return;}
          await api.sync();status(api.status().status);
        }catch(e){notice.textContent='並び順の共有は未完了です：'+(e.message||String(e));}
        finally{button.disabled=false;}
      };
    }
    return Object.freeze({read,accept,publish,capture,attach,status});
  }
  root.PlantPcOrderSource=Object.freeze({create,storageKey:STORAGE});
  if(typeof module!=='undefined'&&module.exports)module.exports=root.PlantPcOrderSource;
})(typeof window!=='undefined'?window:globalThis);
