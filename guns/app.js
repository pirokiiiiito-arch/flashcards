/* Local-first categorized firearm flashcards. No private images enter the repository. */
(function(root){
'use strict';
const C=root.GunCatalog;
const STORE='gun-flashcards-cards-v1', DB='gun-flashcards-images-v1', IMG_STORE='photos';
const MAX_IMAGE=25*1024*1024;
const $=id=>document.getElementById(id);
const groups=C.CATEGORIES;
const groupNames=Object.fromEntries(groups.map(c=>[c.id,c.ja]));
const listeners=new Set();
let cards=[],deletedSeeds=new Set(),loaded=false;
let view={category:'all',search:'',index:0,flipped:false,shuffled:false,shuffleOrder:[]};
let editorCard=null,editorIndex=0,photoRefs=['','',''],previewUrls=[],displayUrls=[],toastTimer=null;
let activePaste=0,renderSerial=0,dirtyEditor=false,ignoreClickUntil=0;
const validHttp=v=>/^https?:\/\/[^\s]+$/i.test(String(v||''));
const isDrive=v=>/^gdrive:[\w-]+:[a-f0-9]{64}$/.test(String(v||''));
const isLocal=v=>/^idb:gunimg:[a-zA-Z0-9_-]+:[0-2]:[a-zA-Z0-9_-]+$/.test(String(v||''));
const isImageType=type=>/^image\/(png|jpeg|webp|gif)$/.test(type);
function toast(message){
 const el=$('toast');el.textContent=message;el.hidden=false;
 clearTimeout(toastTimer);toastTimer=setTimeout(()=>{el.hidden=true},5000);
}
function localStatus(message){$('localStatus').textContent=message;}
function safeRead(){
 try{const raw=localStorage.getItem(STORE);return raw?JSON.parse(raw):null;}
 catch(e){localStatus('このブラウザの保存データを読み込めません');return null;}
}
function persist(next,deleted){
 const record={schema:'gun-flashcards-v1',saved_at:new Date().toISOString(),cards:next,deleted_seed_ids:[...deleted]};
 localStorage.setItem(STORE,JSON.stringify(record));
}
function notify(keys,action){
 for(const fn of listeners)try{fn({keys,action})}catch(e){console.error('変更通知',e);}
}
function update(mutator,keys=[],action='update'){
 const next=cards.map(x=>({...x,images:[...x.images]})),removed=new Set(deletedSeeds);
 mutator(next,removed);
 try{persist(next,removed)}
 catch(e){toast('端末に保存できません。バックアップとブラウザの保存容量を確認してください。');return false;}
 cards=next;deletedSeeds=removed;
 localStatus('端末に保存済み');
 notify(keys,action);
 refresh();
 return true;
}
function openDb(){
 return new Promise((resolve,reject)=>{
   if(!root.indexedDB)return reject(Error('ブラウザの画像保存機能が利用できません'));
   const req=indexedDB.open(DB,1);
   req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(IMG_STORE))req.result.createObjectStore(IMG_STORE)};
   req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||Error('画像保存を開けません'));
 });
}
async function storeBlob(blob,cardId,slot){
 if(!(blob instanceof Blob)||!blob.size||blob.size>MAX_IMAGE||!isImageType(blob.type))
   throw Error('写真は25MB以下のPNG・JPEG・WebP・GIFにしてください。');
 const key='idb:gunimg:'+cardId+':'+slot+':'+(root.crypto?.randomUUID?.()||Date.now()+'-'+Math.random().toString(36).slice(2));
 const db=await openDb();
 try{await new Promise((resolve,reject)=>{
   const tx=db.transaction(IMG_STORE,'readwrite');tx.objectStore(IMG_STORE).put(blob,key);
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||Error('画像保存に失敗'));
   tx.onabort=()=>reject(tx.error||Error('画像保存を中止'));
 });}finally{db.close()}
 return key;
}
async function localBlob(ref){
 if(!isLocal(ref))return null;
 const db=await openDb();
 try{return await new Promise((resolve,reject)=>{
   const tx=db.transaction(IMG_STORE,'readonly'),req=tx.objectStore(IMG_STORE).get(ref);
   req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);
 });}finally{db.close()}
}
const blobData=blob=>new Promise((resolve,reject)=>{
 const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(r.error||Error('画像を読めません'));
 r.readAsDataURL(blob);
});
async function resolveSource(value){
 if(isLocal(value)){const blob=await localBlob(value);return blob?blobData(blob):'';}
 if(isDrive(value)){
   const api=root.GunDriveSync;
   if(!api?.valid())return '';
   return blobData(await api.getBlob(value));
 }
 return validHttp(value)?value:'';
}
async function photoUrl(value){
 if(isLocal(value)){const blob=await localBlob(value);return blob?URL.createObjectURL(blob):'';}
 if(isDrive(value)){
   const api=root.GunDriveSync;
   if(!api?.valid())return '';
   return URL.createObjectURL(await api.getBlob(value));
 }
 return validHttp(value)?value:'';
}
function clearUrls(urls){for(const src of urls)if(src?.startsWith('blob:'))URL.revokeObjectURL(src);urls.length=0;}
function getCurrentCards(){return cards.map(c=>({...c,images:[...c.images]}))}
function getImages(card){return Array.from({length:3},(_,i)=>card.images?.[i]||'')}
function replaceIfCurrent(id,slot,oldRef,ref){
 const at=cards.findIndex(c=>c.id===id);
 if(at<0||getImages(cards[at])[slot]!==oldRef||$('editorDialog').open)return false;
 const next=cards.map(c=>({...c,images:[...c.images]}));
 next[at].images[slot]=ref;
 try{persist(next,deletedSeeds)}catch(e){return false;}
 cards=next;refresh();return true;
}
function restoreCloud(prepared){
 if($('editorDialog').open)return false;
 const map=new Map(cards.map(c=>[c.id,c]));
 const remote=prepared.cards||[];
 for(const remoteCard of remote){
   const valid=C.sanitizeCard(remoteCard);if(!valid)continue;
   const local=map.get(valid.id);
   if(local){
     for(let i=0;i<3;i++)if(isLocal(local.images?.[i]))valid.images[i]=local.images[i];
   }
   map.set(valid.id,valid);
 }
 const removed=new Set(deletedSeeds);
 for(const id of prepared.deleted||[]){map.delete(id);if(C.SEEDS.some(x=>x.id===id))removed.add(id);}
 const next=C.mergeCards([...map.values()]).filter(c=>!removed.has(c.id));
 try{persist(next,removed)}catch(e){localStatus('受信内容の端末保存に失敗しました');return false;}
 cards=next;deletedSeeds=removed;
 // Cloud applies are not new local uploads. Prevent a stale preview after sync.
 refresh();return true;
}
function allFiltered(){
 const query=view.search.toLocaleLowerCase('ja-JP');
 const selected=cards.filter(c=>(view.category==='all'||c.category===view.category) &&
  (!query||[c.name,c.description,c.search,groupNames[c.category]].some(v=>String(v||'').toLocaleLowerCase('ja-JP').includes(query))));
 if(view.shuffled){
   const orders=new Map(view.shuffleOrder.map((id,i)=>[id,i]));
   return selected.sort((a,b)=>(orders.get(a.id)??1e9)-(orders.get(b.id)??1e9));
 }
 return selected;
}
function current(){const list=allFiltered();return list.length?list[Math.max(0,Math.min(list.length-1,view.index))]:null;}
function shuffleIds(){
 const ids=allFiltered().map(c=>c.id);
 for(let i=ids.length-1;i>0;i--){
   const r=new Uint32Array(1);root.crypto.getRandomValues(r);const j=r[0]%(i+1);
   [ids[i],ids[j]]=[ids[j],ids[i]];
 }
 view.shuffleOrder=ids;
}
function buildGroups(){
 const grid=$('groupGrid');grid.replaceChildren();
 const allCounts=Object.fromEntries(groups.map(g=>[g.id,cards.filter(c=>c.category===g.id).length]));
 for(const [i,group] of groups.entries()){
   if(group.id==='other'&&!allCounts[group.id])continue;
   const tile=document.createElement('button');tile.type='button';tile.className='category-tile';tile.dataset.group=group.id;
   const count=allCounts[group.id],code=document.createElement('span');code.className='tile-index';code.textContent=String(i+1).padStart(2,'0')+' · '+group.en.toUpperCase();
   const name=document.createElement('span');name.className='tile-name';name.textContent=group.ja;
   const bottom=document.createElement('span');bottom.className='tile-bottom';bottom.textContent=count+'モデル';
   const arrow=document.createElement('span');arrow.className='tile-arrow';arrow.textContent=' →';
   bottom.appendChild(arrow);tile.append(code,name,bottom);
   tile.onclick=()=>openCategory(group.id);
   grid.appendChild(tile);
 }
}
function openCategory(id){
 view.category=id;view.index=0;view.flipped=false;view.search='';view.shuffled=false;view.shuffleOrder=[];
 $('filterInput').value='';$('categorySelect').value=id;
 $('homeView').hidden=true;$('deckView').hidden=false;
 refresh();window.scrollTo({top:0,behavior:'auto'});
}
function refresh(){
 if(!loaded)return;
 if(!$('homeView').hidden)buildGroups();
 if(!$('deckView').hidden)renderDeck();
}
async function renderPhotos(card,serial){
 clearUrls(displayUrls);
 const grid=$('photoGrid');grid.replaceChildren();
 for(let i=0;i<3;i++){
   const figure=document.createElement('figure');figure.className='photo-slot';
   const frame=document.createElement('div');frame.className='photo-frame';
   const source=getImages(card)[i];
   if(source){
     const img=document.createElement('img');img.alt=card.name+' 写真'+(i+1);img.loading='lazy';
     frame.appendChild(img);
     photoUrl(source).then(url=>{
       if(serial!==renderSerial||!img.isConnected){if(url?.startsWith('blob:'))URL.revokeObjectURL(url);return;}
       if(!url){img.replaceWith(document.createTextNode('写真を確認できません。PCでDriveへ接続してください。'));return;}
       if(url.startsWith('blob:'))displayUrls.push(url);
       img.src=url;img.onerror=()=>{img.replaceWith(document.createTextNode('画像を読み込めませんでした'))};
       img.addEventListener('click',event=>{event.stopPropagation();openImage(url,card.name)});
     }).catch(()=>{if(serial===renderSerial&&img.isConnected)img.replaceWith(document.createTextNode('写真を取得できません'))});
   }else{
     const empty=document.createElement('span');empty.className='photo-empty';empty.textContent='写真未登録';frame.appendChild(empty);
   }
   const cap=document.createElement('figcaption');cap.textContent='写真 '+(i+1);
   figure.append(frame,cap);grid.appendChild(figure);
 }
}
function openImage(url,name){
 const dialog=document.createElement('dialog');dialog.style.cssText='padding:12px;border:0;border-radius:12px;max-width:95vw;max-height:95vh;background:#fff';
 const img=document.createElement('img');img.src=url;img.alt=name;img.style.cssText='max-width:90vw;max-height:80vh;object-fit:contain;display:block';
 const close=document.createElement('button');close.className='btn light';close.textContent='閉じる';close.style.marginTop='9px';close.onclick=()=>dialog.close();
 dialog.append(img,close);document.body.appendChild(dialog);dialog.onclose=()=>dialog.remove();
 dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});dialog.showModal();
}
function renderDeck(){
 const list=allFiltered();
 if(view.index>=list.length)view.index=Math.max(0,list.length-1);
 const card=list[view.index]||null;
 const label=view.category==='all'?'全分類':groupNames[view.category];
 $('categoryCaption').textContent=(view.category==='all'?'ALL CATEGORIES':groups.find(x=>x.id===view.category)?.en.toUpperCase()||'OTHER');
 $('deckHeading').textContent=label;
 $('positionLabel').textContent=card?(view.index+1)+' / '+list.length:'0 / 0';
 $('flashCard').hidden=!card;$('emptyMsg').hidden=!!card;
 $('prevBtn').disabled=$('nextBtn').disabled=$('flipBtn').disabled=!card;
 $('deleteCardBtn').hidden=!card;
 $('shuffleBtn').setAttribute('aria-pressed',String(view.shuffled));
 $('shuffleBtn').textContent=view.shuffled?'シャッフル中 · 戻す':'シャッフル';
 if(!card)return;
 $('frontName').textContent=card.name;$('backName').textContent=card.name;
 $('backDescription').textContent=card.description||'説明はまだ登録されていません。「この銃を編集」から入力できます。';
 $('cardFront').hidden=view.flipped;$('cardBack').hidden=!view.flipped;
 $('flipBtn').textContent=view.flipped?'表を見る':'裏を見る';
 $('flashCard').setAttribute('aria-pressed',String(view.flipped));
 if(view.flipped)renderPhotos(card,++renderSerial);
 else{renderSerial++;clearUrls(displayUrls);$('photoGrid').replaceChildren();}
}
function flip(){
 if(!current())return;
 view.flipped=!view.flipped;renderDeck();
}
function move(step){
 const list=allFiltered();if(!list.length)return;
 view.index=(view.index+step+list.length)%list.length;view.flipped=false;renderDeck();
}
function googleQuery(card){
 const category=groups.find(x=>x.id===card.category);
 const base=String(card.search||'').trim()||card.name;
 return base+' '+(category?.en||'firearm')+' images';
}
function englishSearch(query){
 const text=String(query||'').trim();
 if(!/[A-Za-z]/.test(text)){toast('英語の検索キーワードを入力してください。');return;}
 const url='https://www.google.com/search?tbm=isch&q='+encodeURIComponent(text);
 const opened=window.open(url,'_blank','popup=yes,width=1150,height=820');
 if(opened)opened.opener=null;
 if(!opened){
   // Browser policies can force tabs; never try to scrape Google or auto-download.
   const anchor=document.createElement('a');anchor.href=url;anchor.target='_blank';anchor.rel='noopener noreferrer';anchor.click();
 }
}
function makeSelects(){
 for(const el of [$('categorySelect'),$('editCategory')]){
   el.replaceChildren();
   if(el.id==='categorySelect'){
     const option=document.createElement('option');option.value='all';option.textContent='すべての分類';el.appendChild(option);
   }
   for(const group of groups){
     const option=document.createElement('option');option.value=group.id;option.textContent=group.ja;el.appendChild(option);
   }
 }
}
function editorPreview(index){
 const target=$('photoPreview'+index);if(!target)return;
 if(previewUrls[index]?.startsWith('blob:'))URL.revokeObjectURL(previewUrls[index]);
 previewUrls[index]='';target.replaceChildren();
 const ref=photoRefs[index];if(!ref){target.textContent='写真未登録';return;}
 const img=document.createElement('img');img.alt='画像'+(index+1)+'のプレビュー';target.appendChild(img);
 photoUrl(ref).then(url=>{
   if(!$('editorDialog').open||!img.isConnected){if(url?.startsWith('blob:'))URL.revokeObjectURL(url);return;}
   if(!url){img.replaceWith(document.createTextNode('接続時に表示'));return;}
   previewUrls[index]=url;img.src=url;
 }).catch(()=>{if(img.isConnected)img.replaceWith(document.createTextNode('プレビュー不可'))});
}
function editPhotoSlot(index){
 const el=document.createElement('div');el.className='editor-photo';
 const row=document.createElement('div');row.className='editor-photo-row';
 const preview=document.createElement('div');preview.id='photoPreview'+index;preview.className='editor-preview';
 const form=document.createElement('div');form.className='editor-photo-form';
 const heading=document.createElement('div');heading.className='editor-photo-heading';heading.textContent='写真 '+(index+1);
 const controls=document.createElement('div');controls.className='editor-photo-controls';
 const fileLabel=document.createElement('label');fileLabel.className='btn light';fileLabel.textContent='ファイルを選ぶ';
 const file=document.createElement('input');file.type='file';file.accept='image/png,image/jpeg,image/webp,image/gif';
 file.addEventListener('change',async()=>{
   if(!file.files?.length)return;
   await setImage(index,file.files[0]);file.value='';
 });
 fileLabel.appendChild(file);
 const paste=document.createElement('button');paste.className='btn light';paste.type='button';paste.textContent='画像を貼り付け';
 paste.onclick=()=>pasteFromClipboard(index);
 const remove=document.createElement('button');remove.className='btn light';remove.type='button';remove.textContent='画像を外す';
 remove.onclick=()=>{
   photoRefs[index]='';url.value='';activePaste=index;dirtyEditor=true;editorPreview(index);
   $('editorMessage').textContent='写真'+(index+1)+'の登録を解除しました。カード保存で確定します。';
 };
 const search=document.createElement('button');search.type='button';search.className='btn light';search.textContent='英語で探す';
 search.onclick=()=>englishSearch($('editSearch').value||$('editName').value+' firearm photos');
 controls.append(fileLabel,paste,search,remove);
 const url=document.createElement('input');url.type='url';url.className='url-input';url.placeholder='写真のURLを貼り付け（https://...）';
 url.value=validHttp(photoRefs[index])?photoRefs[index]:'';
 url.addEventListener('change',()=>{
   const value=url.value.trim();
   if(value&&!validHttp(value)){toast('https:// または http:// の画像URLを入力してください。');return;}
   photoRefs[index]=value;activePaste=index;dirtyEditor=true;editorPreview(index);
 });
 url.addEventListener('focus',()=>{activePaste=index});
 form.append(heading,controls,url);row.append(preview,form);el.append(row);
 return el;
}
async function setImage(index,blob){
 try{
   const id=editorCard?.id||'gun-custom-'+(root.crypto?.randomUUID?.()||Date.now().toString(36));
   const ref=await storeBlob(blob,id,index);
   if(!$('editorDialog').open)return;
   photoRefs[index]=ref;
   const input=$('editorPhotos').querySelectorAll('.url-input')[index];if(input)input.value='';
   activePaste=index;dirtyEditor=true;editorPreview(index);
   $('editorMessage').textContent='写真'+(index+1)+'をこの端末に保存しました。「カードを保存」で登録が確定します。';
 }catch(e){toast(e.message||'写真の保存に失敗しました');}
}
async function pasteFromClipboard(index){
 activePaste=index;
 try{
   if(!navigator.clipboard?.read)throw Error('画像をコピーした状態で編集画面にCtrl+Vで貼り付けてください。');
   const items=await navigator.clipboard.read();
   for(const item of items){
     const type=item.types.find(t=>isImageType(t));
     if(type){await setImage(index,await item.getType(type));return;}
   }
   throw Error('クリップボードに画像がありません。先にGoogle画像検索などで画像をコピーしてください。');
 }catch(e){$('editorMessage').textContent=e.message||'Ctrl+Vで貼り付けてください。';}
}
function openEditor(card){
 editorCard=card?{...card,images:[...card.images]}:{id:'gun-custom-'+(root.crypto?.randomUUID?.()||Date.now().toString(36)),category:view.category==='all'?'revolver':view.category,name:'',description:'',search:'',images:['','',''],source:'user'};
 dirtyEditor=false;activePaste=0;photoRefs=[...editorCard.images];
 $('editorTitle').textContent=card?'銃のカードを編集':'銃を新しく追加';
 $('editCategory').value=editorCard.category;$('editName').value=editorCard.name;
 $('editSearch').value=editorCard.search;$('editDescription').value=editorCard.description;
 $('editorMessage').textContent='写真を選んだ後、最後に「カードを保存」を押してください。';
 const list=$('editorPhotos');list.replaceChildren();
 for(let i=0;i<3;i++)list.appendChild(editPhotoSlot(i));
 $('editorDialog').showModal();previewUrls=[];
 for(let i=0;i<3;i++)editorPreview(i);
 setTimeout(()=>$('editName').focus(),50);
}
function closeEditor(){
 if(dirtyEditor&&!window.confirm('保存していない写真の変更があります。編集を閉じますか？'))return;
 $('editorDialog').close();clearUrls(previewUrls);editorCard=null;
}
function saveEditor(event){
 event.preventDefault();
 if(!editorCard)return;
 const name=$('editName').value.trim(),search=$('editSearch').value.trim();
 if(!name){$('editorMessage').textContent='銃の名前を入力してください。';return;}
 if(!/[A-Za-z]/.test(search)){$('editorMessage').textContent='Google画像検索用の英語名を入力してください。';$('editSearch').focus();return;}
 const old=cards.find(c=>c.id===editorCard.id);
 const card=C.sanitizeCard({...editorCard,category:$('editCategory').value,name,
   search,description:$('editDescription').value.trim(),images:photoRefs,source:'user'});
 if(!card){$('editorMessage').textContent='入力内容を確認してください。';return;}
 const changedImages=[];
 for(let i=0;i<3;i++)if((old?.images?.[i]||'')!==card.images[i])changedImages.push('image:'+card.id+':'+i);
 const ok=update((arr,deleted)=>{
   const at=arr.findIndex(x=>x.id===card.id);
   if(at<0)arr.push(card);else arr[at]=card;
   deleted.delete(card.id);
 },['card:'+card.id,...changedImages],'save');
 if(!ok)return;
 dirtyEditor=false;closeEditor();
 if($('homeView').hidden===false)openCategory(card.category);
 else{view.category=card.category;$('categorySelect').value=card.category;view.search='';$('filterInput').value='';view.shuffled=false;
   view.index=Math.max(0,allFiltered().findIndex(x=>x.id===card.id));view.flipped=true;renderDeck();}
 toast(changedImages.length?'写真を登録しました。Drive接続時に自動送信されます。':'カードを保存しました。');
}
function deleteCard(){
 const card=current();if(!card)return;
 if(!window.confirm('「'+card.name+'」を削除しますか？写真登録も解除します。'))return;
 const imgKeys=getImages(card).map((_,i)=>'image:'+card.id+':'+i);
 update((arr,removed)=>{
   const at=arr.findIndex(x=>x.id===card.id);if(at>=0)arr.splice(at,1);
   if(C.SEEDS.some(x=>x.id===card.id))removed.add(card.id);
 },['card:'+card.id,...imgKeys],'delete');
 toast('カードを削除しました（バックアップを残すことをおすすめします）');
}
async function exportBackup(){
 $('backupBtn').disabled=true;
 try{
   const output=[],missing=[];
   for(const card of cards){
     const clone={...card,images:[...card.images]};
     for(let i=0;i<clone.images.length;i++){
       const ref=clone.images[i];if(!ref)continue;
       if(isLocal(ref)||isDrive(ref)){
         const data=await resolveSource(ref);
         if(!data){missing.push(card.name+' 写真'+(i+1));continue;}
         clone.images[i]=data;
       }
     }
     output.push(clone);
   }
   if(missing.length){toast('写真'+missing.length+'枠を取得できないため完全なバックアップを作れません。Drive接続後に再試行してください。');return;}
   const body={schema:'gun-flashcards-v1',saved_at:new Date().toISOString(),cards:output,deleted_seed_ids:[...deletedSeeds],note:'外部URL写真は元URLを保持します。データURL写真は画像本体を同梱しています。'};
   download('gun-flashcards-backup.json',new Blob([JSON.stringify(body)],{type:'application/json'}));
   toast('写真を含むバックアップを保存しました。');
 }catch(e){toast('バックアップ失敗：'+(e.message||String(e)));}
 finally{$('backupBtn').disabled=false;}
}
function download(name,blob){
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;
 document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
async function importBackup(file){
 if(!file)return;
 try{
   if(file.size>200*1024*1024)throw Error('ファイルが大きすぎます（200MBまで）');
   const raw=JSON.parse(await file.text());
   if(raw.schema!=='gun-flashcards-v1'||!Array.isArray(raw.cards)||raw.cards.length>5000)
     throw Error('銃器カードのバックアップ形式ではありません');
   if(!window.confirm(raw.cards.length+'件のカードを読み込みます。同じIDのカードはバックアップの内容で更新されます。続けますか？'))return;
   const incoming=[];
   for(const c of raw.cards){
     const row={...c,images:Array.isArray(c.images)?[...c.images]:[]};
     for(let i=0;i<3;i++){
       const value=row.images[i]||'';
       if(typeof value==='string'&&/^data:image\/(png|jpeg|webp|gif);base64,/i.test(value)){
         const blob=await (await fetch(value)).blob();
         row.images[i]=await storeBlob(blob,String(row.id),i);
       }
     }
     const valid=C.sanitizeCard(row);if(!valid)throw Error('カードに無効な名前・ID・画像があります');
     incoming.push(valid);
   }
   const ok=update((arr,deleted)=>{
     const index=new Map(arr.map((row,i)=>[row.id,i]));
     for(const c of incoming){const i=index.get(c.id);
       if(i===undefined){index.set(c.id,arr.length);arr.push(c)}else arr[i]=c;
       deleted.delete(c.id);
     }
   },incoming.flatMap(c=>['card:'+c.id,...getImages(c).map((_,i)=>'image:'+c.id+':'+i)]),'import');
   if(ok)toast(incoming.length+'件を統合しました。既存の別IDのカードは保持しました。');
 }catch(e){toast('読込失敗：'+(e.message||String(e)));}
}
function installListeners(){
 $('allCardsBtn').onclick=()=>openCategory('all');
 $('homeBtn').onclick=()=>{$('deckView').hidden=true;$('homeView').hidden=false;view.flipped=false;refresh()};
 $('categorySelect').onchange=e=>openCategory(e.target.value);
 $('filterInput').oninput=e=>{view.search=e.target.value.trim();view.index=0;view.flipped=false;if(view.shuffled)shuffleIds();refresh()};
 $('shuffleBtn').onclick=()=>{view.shuffled=!view.shuffled;view.index=0;view.flipped=false;if(view.shuffled)shuffleIds();refresh()};
 $('prevBtn').onclick=()=>move(-1);$('nextBtn').onclick=()=>move(1);$('flipBtn').onclick=flip;
 $('flashCard').onclick=e=>{if(Date.now()<ignoreClickUntil||e.target.closest('button,a,input,select,textarea,img'))return;flip()};
 $('flashCard').onkeydown=e=>{if((e.key==='Enter'||e.key===' ')&&e.target===$('flashCard')){e.preventDefault();flip()}};
 $('editCardBtn').onclick=e=>{e.stopPropagation();openEditor(current())};
 $('googleSearchBtn').onclick=e=>{e.stopPropagation();const card=current();if(card)englishSearch(googleQuery(card))};
 $('deleteCardBtn').onclick=deleteCard;
 $('addBtn').onclick=()=>openEditor(null);
 $('closeEditorBtn').onclick=$('cancelEditBtn').onclick=closeEditor;
 $('editorDialog').addEventListener('cancel',e=>{e.preventDefault();closeEditor()});
 $('editorForm').onsubmit=saveEditor;
 $('editGoogleBtn').onclick=()=>englishSearch($('editSearch').value||$('editName').value+' firearm photos');
 $('importBtn').onclick=()=>$('importFile').click();
 $('importFile').onchange=e=>{const file=e.target.files?.[0];importBackup(file);e.target.value=''};
 $('backupBtn').onclick=exportBackup;
 $('syncBtn').onclick=()=>{const api=root.GunDriveSync;if(api?.open)api.open();else toast('Drive同期の読み込みを確認してください。')};
 document.addEventListener('keydown',e=>{
   if($('editorDialog').open||!$('homeView').hidden||e.target.matches('input,textarea,select'))return;
   if($('deckView').hidden)return;
   if(e.key==='ArrowRight')move(1);else if(e.key==='ArrowLeft')move(-1);
   else if(e.key===' '&&e.target===document.body){e.preventDefault();flip();}
 });
 document.addEventListener('paste',async e=>{
   if(!$('editorDialog').open)return;
   const file=[...(e.clipboardData?.files||[])].find(f=>isImageType(f.type));
   if(!file)return;
   e.preventDefault();await setImage(activePaste,file);
 });
 let start=null;
 $('flashCard').addEventListener('touchstart',e=>{if(e.touches.length===1)start={x:e.touches[0].clientX,y:e.touches[0].clientY}},{passive:true});
 $('flashCard').addEventListener('touchend',e=>{
   if(!start||!e.changedTouches.length)return;
   const dx=e.changedTouches[0].clientX-start.x,dy=e.changedTouches[0].clientY-start.y;
   if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.4){ignoreClickUntil=Date.now()+400;move(dx<0?1:-1);}
   start=null;
 },{passive:true});
 const mark=()=>{if($('editorDialog').open)dirtyEditor=true};
 $('editorForm').addEventListener('input',mark);
}
async function start(){
 const saved=safeRead();
 if(saved && saved.schema==='gun-flashcards-v1'){
   deletedSeeds=new Set((saved.deleted_seed_ids||[]).filter(id=>typeof id==='string'));
   cards=C.mergeCards(saved.cards).filter(c=>!deletedSeeds.has(c.id));
 }else cards=C.mergeCards([]);
 makeSelects();installListeners();
 loaded=true;localStatus('端末に保存済み · '+cards.length+'モデル');
 refresh();
}
const ready=start().catch(e=>{console.error(e);localStatus('カードの起動に失敗しました');toast(e.message||String(e))});
root.GunDeck=Object.freeze({
 ready,getCards:getCurrentCards,getImages,replaceIfCurrent,resolveSource,
 restoreCloud,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},
 isEditing:()=>$('editorDialog').open,
 isLocal,isDrive,validHttp,
 notifySyncStatus(message){$('cloudStatus').textContent=message},
 notifyPhotoStatus(message){$('photoStatus').textContent=message},
 refresh,
 backup:exportBackup
});
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js',{updateViaCache:'none'}).then(r=>r.update()).catch(()=>{}));
})(typeof window!=='undefined'?window:globalThis);
