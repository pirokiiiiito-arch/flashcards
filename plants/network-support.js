/* Plant-only upgrade; no authentication widening or new data service. */
(function(root){
  'use strict';
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
  const isDrive=v=>/^gdrive:[\w-]+:[a-f0-9]{64}$/.test(String(v||''));
  function plan(view,current,getImages,withImages){
    const rows=new Map(current.map(c=>[c.id,{...c}]));
    for(const k of Object.keys(view.deleted||{}))if(k.startsWith('card:'))rows.delete(k.slice(5));
    for(const [k,c] of Object.entries(view.data||{})){
      if(!k.startsWith('card:'))continue;
      if(!c||typeof c.id!=='string'||k!=='card:'+c.id||typeof c.name!=='string'||typeof c.description!=='string')throw Error('Driveの植物カード形式を確認できません。端末データは保持しています。');
      rows.set(c.id,{...c});
    }
    const local=new Map(current.map(c=>[c.id,c]));
    return [...rows.values()].map(c=>withImages(c,[0,1,2].map(i=>{
      const k='image:'+c.id+':'+i,previous=getImages(local.get(c.id)||c)[i]||'';
      if(own(view.deleted,k)){
        if(/^(idb:|data:image\/|blob:)/.test(previous))return previous;
        return '';
      }
      if(!own(view.data,k))return previous;
      const v=view.data[k];
      if(typeof v!=='string')throw Error('Driveの植物写真参照が不正です。端末データは保持しています。');
      // A stale device-only reference from another device must not erase a
      // working photograph. Never infer deletion from missing cloud fields.
      if(v.startsWith('idb:')&&previous&&v!==previous)return previous;
      return v;
    }))).sort((a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0)||a.id.localeCompare(b.id));
  }
  function counts(view,list,getImages){
    const imgs=list.flatMap(c=>getImages(c)).filter(Boolean);
    return {local:list.length,remote:Object.keys(view.data||{}).filter(k=>k.startsWith('card:')).length,photos:imgs.length,drivePhotos:imgs.filter(isDrive).length,notCopied:imgs.filter(v=>!isDrive(v)).length};
  }
  const tools={plan,counts,isDrive};
  if(typeof module!=='undefined'&&module.exports)module.exports=tools;
  if(!root.document)return;
  const toolbar=document.querySelector('.toolbar')||document.body;
  const button=document.createElement('button');button.type='button';button.className='btn';button.id='plantNetworkSync';button.textContent='ネット経由で植物・写真を同期';
  const notice=document.createElement('p');notice.id='plantNetworkStatus';notice.setAttribute('role','status');notice.style.cssText='width:100%;font-size:13px;line-height:1.7;white-space:pre-wrap;margin:8px 0';
  toolbar.append(button,notice);
  let lastStatus='未接続',lastDetail='ファイル選択は不要です。同じGoogleアカウントで接続してください。';
  function update(s,message){
    if(s)lastStatus=s;if(message)lastDetail=message;
    const api=root.PlantDriveSync;
    const list=typeof cards!=='undefined'?cards:[];
    const n=counts(api?.view()||{data:{}},list,getImages);
    notice.textContent='ネット同期 修正版2：'+lastStatus+'\n植物：この端末 '+n.local+'件 ／ Drive履歴 '+n.remote+'件\n登録写真 '+n.photos+'枠 ／ Drive参照 '+n.drivePhotos+'枠 ／ 未コピー '+n.notCopied+'枠\n'+lastDetail;
    if(lastStatus==='同期済み'&&!n.photos)notice.textContent+='\n写真の取得は0枚です。写真が残るPCでもこのページから同期してください。ファイルの保存・選択は不要です。';
    if(lastStatus==='同期済み'&&(!n.local||!n.remote))notice.textContent+='\n接続のみ成功しています。植物データの取得は完了していません。';
    if(lastStatus==='同期済み'&&n.notCopied)notice.textContent+='\n未コピーの写真は元の参照を保持しています。「画像コピー結果を保存」で失敗理由を確認できます。';
  }
  function complete(api){
    const n=counts(api.view(),cards,getImages);
    if(!n.local||!n.remote)throw Error('Driveへの接続は成功しましたが、植物データを取得できていません。元のPCのデータを保持しています。');
    update('確認中','文字データを取得しました。写真のコピー状況を確認しています。');
  }
  button.onclick=async()=>{
    const api=root.PlantDriveSync;
    if(!api){update('読み込み未完了','植物の同期機能が読み込まれていません。画面のエラーを確認してください。');return;}
    if(!api.valid()){api.open();return;}
    if(editing){update(null,'編集中のカードを保存してから同期してください。');return;}
    button.disabled=true;
    try{await api.sync();if(api.status().pending)await api.sync();}
    catch(e){update('同期未完了',e.message||String(e));}
    finally{button.disabled=false;}
  };
  root.PlantNetworkSupport=Object.freeze({...tools,update,complete});
  update();
})(typeof window!=='undefined'?window:globalThis);
