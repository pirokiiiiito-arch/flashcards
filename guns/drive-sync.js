/* Firearm card synchronization: separate namespace and image source cache.
 * No automatic web scraping; only user-entered image sources are published.
 * Device-only photo refs stay in the local journal until the Drive bytes verify.
 */
(async function(root){
'use strict';
const deck=root.GunDeck, Core=root.FlashcardsDrive, P=root.GunDriveImageCopy;
if(!deck||!Core||!P)throw Error('銃器カードの同期機能を読み込めません');
await deck.ready;
const cardKey=c=>'card:'+c.id;
const imageKey=(c,i)=>'image:'+c.id+':'+i;
const clean=c=>({id:c.id,name:c.name,category:c.category,description:c.description,
  search:c.search,source:c.source||'user'});
const isDevice=v=>/^(idb:gunimg:|data:image\/|blob:)/.test(String(v||''));
let sync=null,copyTimer=null,busy=false,delay=30000,nextRetry=0;
const photoQueue=new Map(),POLL_MS=15000;
const controls=document.querySelector('.header-actions')||document.body;
const retry=document.createElement('button');retry.className='btn light';retry.type='button';
retry.textContent='写真コピー再試行';
const reportButton=document.createElement('button');reportButton.className='btn light';reportButton.type='button';
reportButton.textContent='写真コピー結果を保存';
controls.insertBefore(retry,document.getElementById('addBtn')||null);
controls.insertBefore(reportButton,document.getElementById('addBtn')||null);
const copier=P.create({
  getCards:deck.getCards,getImages:deck.getImages,isEditing:deck.isEditing,
  resolveImage:deck.resolveSource,
  replaceIfCurrent:deck.replaceIfCurrent,
  changed:()=>sync?.changed(),
  onProgress:progress=>{
    retry.disabled=progress.busy;
    deck.notifyPhotoStatus('写真：Drive参照 '+progress.drive+' / '+progress.total+
      ' · 未コピー '+progress.pending+(progress.failed?' · 失敗 '+progress.failed:''));
  }
});
function read(){
 const out={};
 for(const c of deck.getCards()){
   out[cardKey(c)]=clean(c);
   deck.getImages(c).forEach((v,i)=>{if(v)out[imageKey(c,i)]=v;});
 }
 return out;
}
async function toCloudValue(key,value){
 if(!key.startsWith('image:')||!value||P.isDrive(value))return value;
 const ref=await copier.convert(key,value);
 if(!P.isDrive(ref)){
   const e=Error('この写真はまだGoogle Driveへ保存できません。PC内の画像を保持して再試行します。');
   e.gunPhotoDeferred=true;throw e;
 }
 return ref;
}
function prepareApply(view){
 const records=[];
 for(const [key,val] of Object.entries(view.data||{})){
   if(!key.startsWith('card:')||!val||typeof val!=='object')continue;
   const record={...val,images:[]};
   for(let i=0;i<3;i++){
     const image=view.data[imageKey(record,i)]||'';
     record.images.push(typeof image==='string'?image:'');
   }
   records.push(record);
 }
 const removed=Object.keys(view.deleted||{}).filter(k=>k.startsWith('card:')).map(k=>k.slice(5));
 return {cards:records,deleted:removed};
}
const cfg={
 namespace:'gun-flashcards-v1',toolbar:'.header-actions',ready:deck.ready,
 primary:()=>localStorage.getItem('gun_drive_primary_v1')==='1',
 enablePrimary:async()=>localStorage.setItem('gun_drive_primary_v1','1'),
 storageKeys:['gun-flashcards-cards-v1'],reload:()=>{},
 read,toCloudValue,
 isEditing:()=>deck.isEditing()||copier.busy,
 prepareApply,
 apply:prepared=>deck.restoreCloud(prepared),
 afterSync:async()=>{
   await copier.sweep();
   resumePending();
   schedule(900);
 },
 onStatus:(state,detail)=>{
   deck.notifySyncStatus('Drive：'+state+(detail?' · '+detail:''));
   if(['同期済み','接続済み','画像送信待ち'].includes(state)){resumePending();schedule(1100);}
 }
};
sync=Core.install(cfg);
root.GunDriveSync=sync;
copier.attach(sync);
function currentPhotoMap(){
 const map=new Map();
 for(const c of deck.getCards())deck.getImages(c).forEach((ref,index)=>{
   if(ref)map.set(imageKey(c,index),ref);
 });
 return map;
}
function resumePending(){
 const current=currentPhotoMap();
 for(const key of sync.pendingKeys?.()||[])
   if(key.startsWith('image:')&&current.has(key)&&!photoQueue.has(key))
     photoQueue.set(key,current.get(key));
 // A new photo can be saved in IndexedDB before its journal is captured;
 // it must still be retried if the PC is online but the push was deferred.
 for(const [key,ref] of current)
   if(isDevice(ref)&&!photoQueue.has(key))photoQueue.set(key,ref);
}
function pruneQueue(){
 const current=currentPhotoMap();
 for(const key of photoQueue.keys())if(!current.has(key))photoQueue.delete(key);
}
function schedule(wait=700){
 pruneQueue();
 if(!photoQueue.size)return;
 if(copyTimer!==null)return;
 const duration=Math.max(0,wait,nextRetry-Date.now());
 copyTimer=setTimeout(async()=>{
   copyTimer=null;
   if(busy||copier.busy||deck.isEditing()||document.visibilityState==='hidden'||navigator.onLine===false){
     schedule(15000);return;
   }
   if(!sync.valid()){
     if(root.PersistentDriveAuth?.state?.().phase==='connected'){
       await root.PersistentDriveAuth.getToken().catch(()=>{});
     }
     if(!sync.valid()){schedule(30000);return;}
   }
   busy=true;retry.disabled=true;
   const batch=new Map(photoQueue);
   try{
     if(!sync.account)await sync.sync();
     if(!sync.account)throw Error('Driveのアカウントをまだ確認できません。');
     const response=await sync.request('https://www.googleapis.com/drive/v3/about?fields=user(permissionId)');
     const account=(await response.json()).user?.permissionId;
     if(!account||account!==sync.account)throw Error('別のGoogleアカウントです。写真は送信せずPCに保持しました。');
     await copier.sweep();
     const local=currentPhotoMap();
     const keys=[...batch].filter(([k,expected])=>{
       const ref=local.get(k)||'';
       return P.isDrive(ref)&&
         (ref===expected||isDevice(expected)||/^https?:\/\//i.test(expected));
     }).map(([k])=>k);
     if(keys.length){
       if(!sync.republish)throw Error('写真の登録情報の再送機能がありません。');
       await sync.republish(keys);
     }
     await sync.sync();
     if(sync.valid()&&sync.status().pending)await sync.sync();
     const pending=new Set(sync.pendingKeys?.()||[]);
     const result=sync.view().data;
     for(const [key,expected] of batch){
       const now=local.get(key)||'';
       const remote=result[key]||'';
       if(!now){photoQueue.delete(key);continue;}
       if(photoQueue.get(key)!==expected)continue;
       if(P.isDrive(now)&&!pending.has(key)&&remote===now)photoQueue.delete(key);
     }
     delay=photoQueue.size?Math.min(300000,Math.max(30000,delay*2)):30000;
   }catch(e){
     console.warn('銃器写真の自動送信は保留しました',e);
     delay=Math.min(300000,Math.max(30000,delay*2));
     deck.notifySyncStatus('Drive：送信保留 · '+(e.message||String(e)));
   }finally{
     busy=false;retry.disabled=copier.busy;
     nextRetry=Date.now()+delay;
     if(photoQueue.size)schedule(delay);
   }
 },duration);
}
function updateQueue(keys,action){
 const current=currentPhotoMap();
 for(const key of keys||[]){
   if(!key.startsWith('image:'))continue;
   const value=current.get(key);
   if(value)photoQueue.set(key,value);else photoQueue.delete(key);
 }
 sync.changed();
 if(photoQueue.size){delay=30000;nextRetry=0;clearTimeout(copyTimer);copyTimer=null;schedule(650);}
 else if(sync.valid())queueMicrotask(()=>sync.sync().catch(()=>{}));
}
deck.subscribe(update=>updateQueue(update.keys,update.action));
retry.onclick=()=>{
 const current=currentPhotoMap();
 for(const [key,ref] of current)if(!P.isDrive(ref))photoQueue.set(key,ref);
 resumePending();copier.retry();delay=30000;nextRetry=0;
 clearTimeout(copyTimer);copyTimer=null;
 if(!sync.valid()){sync.open();return;}
 schedule(0);
};
reportButton.onclick=()=>{
 const body={...copier.report(),sync:sync.status(),queued_photo_keys:[...photoQueue.keys()]};
 const blob=new Blob([JSON.stringify(body,null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download='guns-photo-copy-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
};
resumePending();schedule(800);
window.addEventListener('online',()=>{resumePending();nextRetry=0;schedule(100)});
window.addEventListener('focus',()=>{resumePending();schedule(350)});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){resumePending();schedule(500)}});
setInterval(()=>{
 if(document.visibilityState==='hidden'||deck.isEditing())return;
 resumePending();
 if(photoQueue.size)schedule(900);
 else if(sync.valid())sync.sync().catch(()=>{});
},POLL_MS);
})(window).catch(e=>{
 console.error('銃器カードDrive同期を開始できません',e);
 const node=document.getElementById('cloudStatus');if(node)node.textContent='Drive同期機能を開始できません：'+(e.message||String(e));
});
