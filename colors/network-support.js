/* Color-only network UI. Existing IDs, research and private Drive history stay intact. */
(function(root){
  'use strict';
  const isDrive=v=>/^gdrive:[\w-]+:[a-f0-9]{64}$/.test(String(v||''));
  function normalize(input,validKeys,safe){
    const out={};if(!input||typeof input!=='object')return out;
    for(const [key,value] of Object.entries(input)){
      if(!validKeys.has(key)||!value||typeof value!=='object')continue;
      if(value.deleted===true){out[key]={deleted:true,updated_at:String(value.updated_at||'')};continue;}
      const data_url=value.data_url||value.url;
      if(!isDrive(data_url)&&!(/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(String(data_url))&&safe(data_url)))continue;
      const refHash=isDrive(data_url)?String(data_url).split(':')[2]:null;
      if(refHash&&value.sha256&&String(value.sha256).toLowerCase()!==refHash)throw Error('写真参照とSHA-256が一致しません。保存データは変更していません。');
      out[key]={data_url,sha256:refHash||(/^[a-f0-9]{64}$/i.test(value.sha256||'')?value.sha256:null),pixel_sha256:/^[a-f0-9]{64}$/i.test(value.pixel_sha256||'')?value.pixel_sha256:null,label:String(value.label||''),updated_at:String(value.updated_at||'')};
    }
    return out;
  }
  const tools={isDrive,normalize};
  if(typeof module!=='undefined'&&module.exports)module.exports=tools;
  if(!root.document)return;
  const toolbar=document.querySelector('.toolbar .controls')||document.body;
  const button=document.createElement('button');button.type='button';button.className='btn';button.id='colorNetworkSync';button.textContent='ネット経由で色名・写真を同期';
  const notice=document.createElement('p');notice.id='colorNetworkStatus';notice.setAttribute('role','status');notice.style.cssText='width:100%;font-size:13px;line-height:1.7;white-space:pre-wrap;margin:8px 0';
  toolbar.append(button,notice);
  let stats=null,status='未接続',detail='ファイル選択は不要です。同じGoogleアカウントで接続してください。';
  const urls=new Map(),pending=new Map(),errors=new Map();let active=0;const waiters=[];
  async function limit(work){if(active>=2)await new Promise(r=>waiters.push(r));active++;try{return await work();}finally{active--;waiters.shift()?.();}}
  function update(){
    const counts=stats?'\n色名 '+stats.cards+'件 ／ 元の写真のDrive参照 '+stats.builtin+'/'+stats.expected+'枚\n手動写真 '+stats.manual+'枚 ／ 手動由来 '+stats.origins+'件':'';
    notice.textContent='ネット同期 修正版2：'+status+counts+'\n'+detail+(errors.size?'\n表示写真の取得失敗 '+errors.size+'件。写真を削除せず、再接続で再取得します。':'');
  }
  function note(value){stats={...value};detail=value.builtin<value.expected?'元の写真のDrive参照が不足しています。写真が残るPCでもこのページから同期してください。': '写真は表示する欄から順にDriveから取得します。';update();}
  function onStatus(s,message){status=s;if(message)detail=message;update();}
  function prune(){
    const visible=new Set([...document.querySelectorAll('img')].map(img=>img.getAttribute('src')));
    for(const [ref,url] of urls){if(urls.size<=8)break;if(!visible.has(url)){URL.revokeObjectURL(url);urls.delete(ref);}}
  }
  async function imageUrl(api,ref){
    if(urls.has(ref)){const value=urls.get(ref);urls.delete(ref);urls.set(ref,value);return value;}
    if(!pending.has(ref))pending.set(ref,limit(async()=>{
      const blob=await api.getBlob(ref);const url=URL.createObjectURL(blob);urls.set(ref,url);return url;
    }).finally(()=>pending.delete(ref)));
    return pending.get(ref);
  }
  async function renderImages(api,refs){
    const jobs=[];
    for(const img of document.querySelectorAll('img[data-color-private-src]')){
      if(img.dataset.resolving)continue;
      const source=img.dataset.colorPrivateSrc;
      const ref=isDrive(source)?source:source.startsWith('assets/')?refs[source]:null;
      if(!ref&&source.startsWith('assets/')){img.alt='この写真のDrive参照はまだ取得できていません';continue;}
      if(!ref){img.dataset.resolving='1';img.src=source;continue;}
      if(!isDrive(ref)){img.alt='写真参照の形式を確認できません';continue;}
      img.dataset.resolving='1';
      jobs.push((async()=>{
        try{const url=await imageUrl(api,ref);errors.delete(ref);if(img.isConnected)img.src=url;}
        catch(e){errors.set(ref,String(e.message||e));img.dataset.resolving='';img.alt='Google Driveに接続するとこの写真を取得します';}
      })());
    }
    await Promise.all(jobs);prune();update();
  }
  button.onclick=async()=>{
    const api=root.ColorDriveSync;
    if(!api){detail='カード機能の読み込みを完了できていません。ページ下部のエラーを確認してください。';update();return;}
    if(!api.valid()){api.open();return;}
    button.disabled=true;
    try{errors.clear();await api.sync();}
    catch(e){onStatus('同期未完了',e.message||String(e));}
    finally{button.disabled=false;}
  };
  // Keep existing portable JSON backup behavior even though the on-device
  // working set now stores immutable Drive references instead of all base64s.
  function installExport(){
    const exportButton=document.getElementById('exportResearch');if(!exportButton)return;
    exportButton.onclick=async()=>{
      exportButton.disabled=true;
      try{
        await readyImages;await root.ColorOriginEditor.ready;
        const data=makeProgressExport();data.manual_origin_edits=root.ColorOriginEditor.getRecords();
        for(const record of Object.values(data.manual_photo_edits||{})){
          if(!record.deleted&&isDrive(record.data_url)){
            const blob=await root.ColorDriveSync.getBlob(record.data_url);
            record.data_url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
          }
        }
        const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
        const a=document.createElement('a');a.href=url;a.download='colors1000_with_edits_network_backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
      }catch(e){toast('バックアップを完了できません：'+(e.message||String(e)));}
      finally{exportButton.disabled=false;}
    };
  }
  root.ColorNetworkSupport=Object.freeze({...tools,note,onStatus,renderImages,installExport});
  update();
})(typeof window!=='undefined'?window:globalThis);
