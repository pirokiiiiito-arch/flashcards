/* Read-only color adapter. Applies received data to page memory only. */
(function(root){
  'use strict';
  const E=root.ColorOriginEditor,N=root.ColorNetworkSupport;
  let catalogue,refs={},slots=new Map(),counts={builtin:0,manual:0,origins:0};
  const originalSlot=slotPhoto;
  slotPhoto=function(index,role){
    const key=CARD_IDS[index]+':'+role,current=originalSlot(index,role);
    if(own(manualEdits,key))return current;
    const row=slots.get(key);return row&&!row.suppressed_duplicate?{...(current||{}),url:row.original_asset_path,manifest_asset:true}:current;
  };
  const nativeRender=render;
  render=function(){const result=nativeRender.apply(this,arguments);if(root.ColorDriveSync)N.renderImages(root.ColorDriveSync,refs).catch(e=>N.onStatus('画像取得エラー',e.message));return result;};
  const ready=(async()=>{
    await readyImages;await E.ready;
    const r=await fetch('./private-assets-manifest.json?v=2',{cache:'no-store'});
    if(!r.ok)throw Error('元の写真割当を取得できません。');
    catalogue=await r.json();
    if(catalogue.counts?.unique_images!==940||catalogue.counts?.registrations!==1047||catalogue.counts?.suppressed_duplicates!==107||!Array.isArray(catalogue.registrations))throw Error('元の写真割当の件数を確認できません。');
    slots=new Map(catalogue.registrations.map(row=>[row.photo_id,row]));render();
  })();
  const api=root.DriveReadOnly.install({namespace:'colors1000-review47',toolbar:'.toolbar .controls',ready,
    onStatus:(s,m)=>N.onStatus(s,m),
    apply:async result=>{
      const photos={},origins={},study={};
      for(const [key,value] of Object.entries(result.view.data)){
        if(key.startsWith('photo:'))photos[key.slice(6)]=value;
        else if(key.startsWith('origin:'))origins[key.slice(7)]=value;
        else if(key.startsWith('study:'))study[key.slice(6)]=value;
      }
      const clean=normalizeEdits(photos),cleanOrigins=E.validateRecords(origins);
      if(Object.keys(photos).some(k=>VALID_SLOT_KEYS.has(k)&&!own(clean,k)))throw Error('手動写真の形式を確認できません。元データは変更していません。');
      const byHash=new Map();
      for(const f of result.imageFiles){const h=f.appProperties?.sha256;if(/^[a-f0-9]{64}$/.test(h||'')&&(!f.sha256Checksum||f.sha256Checksum===h))byHash.set(h,f);}
      const nextRefs={};
      for(const [path,spec] of Object.entries(catalogue.files)){const f=byHash.get(spec.sha256);if(f)nextRefs[path]='gdrive:'+f.id+':'+spec.sha256;}
      refs=nextRefs;manualEdits=clean;progress=validateStudyProgress(study);
      E.previewRecords(cleanOrigins);
      counts={builtin:Object.keys(refs).length,manual:Object.values(clean).filter(x=>!x.deleted).length,origins:Object.values(cleanOrigins).filter(x=>x.mode==='manual').length};
      N.note({cards:CARDS.length,expected:940,...counts});render();
    },
    summary:result=>'色名 '+CARDS.length+'件 ／ 元写真のDrive参照 '+counts.builtin+'/940枚\n手動写真 '+counts.manual+'枚 ／ 手動由来 '+counts.origins+'件\n'+
      (counts.builtin<940?'不足する写真はDriveから取得できていません。再アップロードや削除はせず、PC側の保存状況を確認してください。':'写真は表示する欄から取得・SHA照合します。全写真を取得済みという意味ではありません。')+
      '\nこの画面では端末保存・Driveへの書込みを行いません。'
  });
  root.ColorDriveSync=api;
  const button=document.getElementById('colorNetworkSync');if(button)button.textContent='Driveから色名・写真を再取得';
  ready.catch(e=>api.setStatus('読込エラー',e.message));
})(window);
