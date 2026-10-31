'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const root='guns/';
const read=name=>fs.readFileSync(root+name,'utf8');
const C=require('../guns/data.js');
test('gun-card catalogue provides accurate categorized historical starting models',()=>{
 assert.equal(C.SEEDS.length,2000);
 assert.equal(C.CATEGORIES.length,10);
 for(const category of ['shotgun','revolver','pistol','bolt','semi-rifle','lever','assault','smg','machine-gun'])
   assert.ok(C.SEEDS.some(c=>c.category===category),'Missing category '+category);
 assert.ok(C.SEEDS.some(c=>c.name==='コルト・パイソン'&&c.category==='revolver'));
 assert.ok(C.SEEDS.some(c=>c.name==='レミントン・モデル870'&&c.category==='shotgun'));
 assert.equal(C.SEEDS[0].name_en,'Remington Model 870');
 assert.equal(C.SEEDS.find(c=>c.name==='コルト・パイソン').name_en,'Colt Python');
 assert.equal(new Set(C.SEEDS.map(c=>c.id)).size,2000);
 assert.equal(C.CATALOG_TARGET,2000);
 assert.ok(C.SEEDS.slice(35).every(c=>c.id.startsWith('gun-ext-')));
 assert.equal(new Set(C.SEEDS.map(c=>C.modelIdentity(c.category,c.name_en))).size,C.SEEDS.length);
 for(let i=0;i<35;i++)assert.equal(C.SEEDS[i].id,'gun-'+String(i+1).padStart(4,'0'));

 for(const c of C.SEEDS){
   assert.ok(c.description.length>10);
   assert.ok(c.images.every(v=>v===''),'Every starter photo must be manually selected');
   assert.ok(/[ァ-ヶー]/.test(c.name)&&!/[A-Za-z]/.test(c.name),'All starter names are katakana');
   assert.ok(/[A-Za-z]/.test(c.search)&&!/[ぁ-んァ-ヶ一-龯]/.test(c.search),'Search terms remain English');
   assert.ok(/[A-Za-z]/.test(c.name_en)&&!/[ぁ-んァ-ヶ一-龯]/.test(c.name_en),'Exact model label is English');
   assert.ok(!c.name_en.endsWith(' photos'),'Product name is not the entire Google search query');
 }
});
test('firearm categories follow approximate historical invention order without reassigning model IDs or photo slots',()=>{
 const order=['shotgun','revolver','bolt','lever','machine-gun','semi-rifle','pistol','smg','assault','other'];
 assert.deepEqual(C.CATEGORIES.map(c=>c.id),order);
 assert.deepEqual(C.CATEGORIES.slice(0,9).map(c=>c.ja),[
  'ショットガン','リボルバー','ボルトアクションライフル',
  'レバーアクションライフル','機関銃','半自動ライフル',
  '自動拳銃','サブマシンガン','アサルトライフル'
 ]);
 // The 35 model definitions must not be reordered by historical category:
 // their stable IDs are used by every private photograph reference.
 assert.deepEqual(C.SEEDS.slice(0,5).map(c=>[c.id,c.category]),[
  ['gun-0001','shotgun'],['gun-0002','shotgun'],
  ['gun-0003','shotgun'],['gun-0004','shotgun'],['gun-0005','revolver']
 ]);
 assert.deepEqual(C.SEEDS.slice(32,35).map(c=>[c.id,c.category]),[
  ['gun-0033','machine-gun'],['gun-0034','machine-gun'],['gun-0035','machine-gun']
 ]);
 const ref='gdrive:photo:'+('c'.repeat(64));
 const edited={...C.SEEDS[32],description:'ユーザーが編集した説明',
  images:['idb:gunimg:gun-0033:0:source-photo',ref,'https://example.org/picture.png']};
 const updated=C.mergeCards([edited]).find(c=>c.id==='gun-0033');
 assert.equal(updated.description,edited.description);
 assert.deepEqual(updated.images,edited.images);
 assert.equal(updated.name,edited.name);
 assert.equal(updated.category,'machine-gun');
});
test('all 35 firearms carry a representative manufacturer and a valid present-day country flag without changing stored photos',()=>{
 assert.equal(C.SEEDS.length,2000);
 assert.equal(C.SEEDS[0].maker,'Remington Arms');
 assert.equal(C.SEEDS[0].country,'US');
 assert.equal(C.COUNTRIES.US.image,'./flags/us.svg');
 assert.equal(C.SEEDS.find(c=>c.name_en==='Browning Auto-5').country,'BE');
 for(const card of C.SEEDS.slice(0,35)){
   assert.ok(card.maker.length>3,card.id+' is missing representative manufacturer');
   assert.ok(C.COUNTRIES[card.country]?.image,card.id+' is missing its flag image');
   assert.deepEqual(card.images,['','',''],card.id+' starting photos must stay empty');
 }
 const original=C.SEEDS[0];
 const previous={id:original.id,category:original.category,name:original.name,
   name_en:original.name_en,search:original.search,description:'保存していた個別の説明',
   images:['idb:gunimg:gun-0001:0:old-picture','gdrive:original:'+('a'.repeat(64)),'https://example.org/image.jpg'],
   source:'user'};
 const migrated=C.mergeCards([previous]).find(c=>c.id===previous.id);
 assert.equal(migrated.maker,'Remington Arms','Legacy saved cards recover the maker without overwriting user edits');
 assert.equal(migrated.country,'US');
 assert.equal(migrated.description,previous.description);
 assert.deepEqual(migrated.images,previous.images);
 const edited=C.mergeCards([{...migrated,maker:'自分で編集した製造会社',country:'JP'}])
   .find(c=>c.id===previous.id);
 assert.equal(edited.maker,'自分で編集した製造会社');
 assert.equal(edited.country,'JP');
 assert.deepEqual(edited.images,previous.images);
 const cleared=C.mergeCards([{...migrated,maker:'',country:''}]).find(c=>c.id===previous.id);
 assert.equal(cleared.maker,'','Intentionally blank maker must not be replaced by a default');
 assert.equal(cleared.country,'');
 assert.equal(C.sanitizeCard({...migrated,country:'XX'}).country,'');
});
test('all 13 locally bundled SVG country flags are offline-readable image files, not Unicode emoji',()=>{
 const worker=read('service-worker.js');
 const countries=Object.values(C.COUNTRIES);
 assert.equal(countries.length,13);
 for(const country of countries){
   assert.match(country.image,/^\.\/flags\/[a-z]{2}\.svg$/);
   const filename='guns/'+country.image.slice(2);
   assert.ok(fs.existsSync(filename),'Missing actual flag image: '+filename);
   const picture=fs.readFileSync(filename,'utf8');
   assert.match(picture,/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="/);
   assert.ok(picture.includes('<title>'),'SVG image needs a human-readable label: '+filename);
   assert.ok(!/<script\b/i.test(picture),'Local flag image cannot contain script');
   assert.ok(worker.includes("'"+country.image+"'"),'SW must cache flag image for offline use: '+country.image);
 }
 assert.ok(!Object.values(C.COUNTRIES).some(c=>Object.prototype.hasOwnProperty.call(c,'flag')),
   'No country definition should rely on a text/emoji flag');
});
test('user entries remain separately editable and allow only expected image references',()=>{
 const extra={id:'gun-custom-abc123',name:'My historical example',category:'revolver',
   search:'historical revolver photograph',description:'A user note',
   images:['https://example.org/a.jpg','idb:gunimg:gun-custom-abc123:1:testref',
     'gdrive:picture-id:'+('a'.repeat(64))]};
 const merged=C.mergeCards([extra]);assert.equal(merged.length,2001);
 const restored=merged.find(c=>c.id===extra.id);
 assert.equal(restored.images[0],extra.images[0]);
 assert.equal(restored.images[1],extra.images[1]);
 assert.equal(restored.images[2],extra.images[2]);
 assert.equal(C.sanitizeCard({...extra,category:'unknown'}).category,'other');
 assert.equal(C.sanitizeCard({...extra,images:['javascript:alert(1)','','']}).images[0],'');
 assert.equal(C.sanitizeCard({...extra,name:''}),null);
});
test('legacy English seed labels become katakana without losing edited descriptions or registered pictures',()=>{
 const legacy={id:'gun-0005',category:'revolver',name:'Colt Python',
   search:'Colt Python revolver photos',description:'保存済みの独自説明',
   images:['idb:gunimg:gun-0005:0:myphoto','gdrive:oldphoto:'+('b'.repeat(64)),'https://example.org/photo.jpg'],
   source:'user'};
 const c=C.mergeCards([legacy]).find(c=>c.id==='gun-0005');
 assert.equal(c.name,'コルト・パイソン');
 assert.equal(c.search,'Colt Python revolver photos');
 assert.equal(c.name_en,'Colt Python','Legacy seed recovers English model name without new storage keys');
 assert.equal(c.description,legacy.description);
 assert.deepEqual(c.images,legacy.images);
 assert.equal(c.source,'user');
 const normalized=C.mergeCards([c]).find(row=>row.id===c.id);
 assert.deepEqual(normalized,c,'Previously normalized names do not change on repeat loads');
 const userRenamed=C.mergeCards([{...legacy,name:'自分で付けた銃名'}]).find(row=>row.id===legacy.id);
 assert.equal(userRenamed.name,'自分で付けた銃名','Do not erase an intentionally renamed user card');
});
test('front displays katakana name only while keeping English model for Google image search and back photos',()=>{
 const html=read('index.html'),app=read('app.js');
 assert.ok(html.includes('分類は方式のおおよその発明・登場順です'));
 assert.ok(html.includes('2,000モデルを収録'));
 assert.ok(html.includes('参考候補を含み'));
 assert.ok(html.includes('id="catalogProgress"'));
 assert.ok(app.includes("cards.length.toLocaleString('ja-JP')"));
 assert.match(html,/<div id="cardFront"/);
 assert.match(html,/<h3 id="frontName">/);
 assert.ok(!html.includes('id="frontEnglish"'),'The front must not render a small English subtitle');
 const front=html.slice(html.indexOf('<div id="cardFront"'),html.indexOf('<div id="cardBack"'));
 assert.ok(!front.includes('FIREARM NAME'));
 assert.ok(!front.includes('クリック・タップで裏面へ'));
 assert.ok(!app.includes("frontEnglish"),'The front rendering must not address the old subtitle');
 assert.ok(app.includes("$('frontName').textContent=card.name"),'The katakana name is still rendered');
 assert.ok(app.includes("function googleQuery(card)"),'English Google Images search remains available');
 assert.ok(html.includes('製品名（英語・記録用／表面には表示しません）'),'Editor must explain the retained English record does not show on the front');
 assert.match(html,/id="editEnglishName"/);
 assert.match(html,/id="backMakerMeta" class="back-maker-meta" hidden/);
 assert.match(html,/<img id="backCountryFlag" class="back-country-flag" width="36" height="24" alt="" decoding="async" hidden>/);
 assert.match(html,/id="backMakerCompany"/);
 assert.match(html,/id="backMakerCountry"/);
 assert.match(html,/id="editMaker"/);
 assert.match(html,/id="editMakerCountry"/);
 assert.ok(app.includes("$('backMakerMeta').hidden=!view.flipped"));
 assert.ok(app.includes("const flagImage=$('backCountryFlag')"));
 assert.ok(app.includes("flagImage.setAttribute('src',country.image)"));
 assert.ok(app.includes("flagImage.alt=country.ja+'の国旗'"));
 assert.ok(app.includes("option.textContent=info.ja;makerCountry.append(option)"));
 assert.ok(!app.includes("option.textContent=info.flag"),'Country picker should not render text-emoji flags');
 assert.ok(app.includes("$('backMakerCompany').textContent=card.maker||'製造会社未登録'"));
 assert.ok(app.includes("$('editMaker').value=editorCard.maker||''"));
 assert.ok(app.includes("$('editMakerCountry').value=editorCard.country||''"));
 assert.match(html,/class="navigation" aria-label="カードの移動と表示順"/);
 assert.match(html,/id="normalBtn"[^>]*aria-pressed="true"[^>]*>通常<\/button>/);
 assert.match(html,/id="shuffleBtn"[^>]*aria-pressed="false"[^>]*>シャッフル<\/button>/);
 assert.match(html,/class="card-chrome"/);
 assert.match(html,/id="faceLabel" class="face-label">表・銃名</);
 assert.match(html,/id="cardAddBtn"[^>]*>＋追加<\/button>/);
 assert.match(html,/id="editCardBtn"[^>]*>編集<\/button>/);
 assert.match(html,/id="deleteCardBtn"[^>]*>削除<\/button>/);
 assert.match(html,/id="positionLabel" class="counter card-number"/);
 assert.match(html,/id="flipBtn" class="sr-only"/);
 assert.ok(html.includes('タップで表・裏を切替。スマホは左スワイプで次へ'));
 assert.match(html,/<div id="cardBack"/);
 assert.match(html,/id="backDescription"/);
 assert.match(html,/id="photoGrid"/);
 assert.match(html,/id="editorPhotos"/);
 assert.match(app,/for\(let i=0;i<3;i\+\+\)list\.appendChild\(editPhotoSlot\(i\)\)/);
 assert.match(app,/navigator\.clipboard\?\.read/);
 assert.match(app,/image\/png,image\/jpeg,image\/webp,image\/gif/);
 assert.match(app,/dataTransfer|clipboardData|importBackup/);
});
test('English Google Images opens from a deliberate click and never downloads automatically',()=>{
 const source=read('app.js');
 assert.ok(source.includes('https://www.google.com/search?tbm=isch&q='));
 assert.ok(source.includes('encodeURIComponent(text)'));
 assert.ok(source.includes("popup=yes,width=1150,height=820"));
 assert.ok(source.includes('englishSearchTerm(search)'));
 assert.ok(source.includes("C.SEEDS.find(seed=>seed.id===card.id)?.search"));
 assert.ok(!source.includes("fetch('https://www.google.com/search"));
 assert.ok(source.includes('return query;'));
 assert.ok(source.includes('日本語は検索語に使用しません'));
});
test('vertical categories and root-sized katakana-only word card with plant-style photo reverse',()=>{
 const css=read('style.css');
 const plants=fs.readFileSync('plants/index.html','utf8');
 assert.ok(css.includes('width:min(90%,420px);margin:0 auto'),'Category container must be centered');
 assert.ok(css.includes('justify-items:center'),'Every category tile must center its visible labels');
 assert.ok(css.includes('grid-template-rows:minmax(max-content,1fr) auto minmax(max-content,1fr)'),'The Japanese category name must be exactly between balanced upper and lower tracks');
 assert.ok(css.includes('.tile-index{grid-column:1;grid-row:1;align-self:start'),'English classification stays above');
 assert.ok(css.includes('.tile-name{grid-column:1;grid-row:2;align-self:center'),'The Japanese title is vertically centered');
 assert.ok(css.includes('.tile-bottom{grid-column:1;grid-row:3;align-self:end'),'The model count stays below');
 assert.ok(css.includes('min-height:72px'),'Desktop tiles should be compact');
 assert.ok(css.includes('min-height:68px'),'Small mobile tiles should be compact');
 assert.ok(css.includes('text-align:center;border:1px solid var(--stroke)'),'Category name must be centered');
 assert.ok(!css.includes('.front-english{'),'No obsolete English subtitle style may remain');
 assert.match(css,/\.category-grid\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
 assert.match(css,/\.category-grid\{grid-template-columns:minmax\(0,1fr\)/);
 assert.match(css,/#frontName\{font-size:clamp\(23px,3\.5vw,34px\)/);
 assert.match(css,/#frontName\{font-size:clamp\(21px,5\.6vw,29px\)/);
 assert.match(css,/\.photo-grid\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
 assert.match(css,/\.photo-grid\{grid-template-columns:minmax\(0,1fr\)/);
 assert.ok(css.includes('.photo-frame{display:flex')&&css.includes('aspect-ratio:16/9'));
 assert.ok(plants.includes('.image-box{width:100%;aspect-ratio:16/9'));
 assert.match(css,/#cardBack\{cursor:default;display:block;height:auto;overflow:visible\}/);
 const word=fs.readFileSync('index.html','utf8');
 assert.ok(css.includes('/* Word-card compact reference layout v9'),'Compact gun UI must follow the actual root word-card scale');
 assert.ok(word.includes('.wrap{width:min(820px,calc(100% - 24px))'),'Word app uses an 820px outer width');
 assert.ok(word.includes('.card{width:min(670px,100%);height:360px'),'Word app uses a 670px x 360px card');
 assert.ok(css.includes('.app-shell{width:min(820px,calc(100% - 24px))'),'Gun shell must match root 820px footprint');
 assert.ok(css.includes('.deck-top{width:min(670px,100%);max-width:670px;margin:4px auto 10px'),'Category controls must align with card and navigation left/right corners');
 assert.ok(css.includes('#flashCard,#flashCard.front-compact{position:relative;width:min(670px,100%);max-width:670px;min-height:360px'),'Both gun faces must match root 670px x 360px footprint');
 assert.ok(css.includes('#cardFront,#flashCard.front-compact #cardFront{display:flex;align-items:center;justify-content:center;flex-direction:column;min-height:360px'),'Front must center the single katakana name within the root-size card');
 assert.ok(css.includes('padding:74px 24px'),'Symmetric padding centers the single Japanese title');
 assert.ok(css.includes('#cardBack{min-height:360px;padding:106px 23px 24px'),'Back must use the same outer width and grow for three photographs');
 assert.ok(css.includes('.navigation{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));align-items:stretch;gap:10px;width:min(670px,100%);max-width:670px'),'Four buttons must fit the same 670px deck navigation');
 assert.ok(css.includes('.navigation>.btn{display:grid;place-items:center;min-width:0;min-height:54px'),'Nav height must match root 54px buttons');
 assert.ok(css.includes('.navigation>#normalBtn[aria-pressed="true"]{background:#2d9d58'),'Selected Normal remains green');
 assert.ok(css.includes('.navigation>#shuffleBtn{background:#2f66e8;color:#fff;border:1px solid #2f66e8'),'Shuffle stays blue in both modes');
 assert.ok(css.includes('.card-chrome{position:absolute;top:19px'),'In-card controls stay inside the smaller frame');
 assert.ok(css.includes('.back-maker-meta{display:flex;align-items:center;gap:9px'),'Maker and country flag appear together in the top-left chrome');
 assert.ok(css.includes('.back-country-flag{display:block;width:36px;height:24px;object-fit:contain'),'The flag should be an actual thumbnail image, not an emoji font');
 assert.ok(css.includes('.card-number.counter{position:absolute;right:25px;top:69px'),'Card counter fits smaller frame');
 assert.ok(css.includes('#flashCard,#flashCard.front-compact{min-height:320px;border-radius:21px'),'Mobile frame must be proportional');
 assert.ok(read('app.js').includes("classList.remove('front-compact')"),'Both sides must have equal width');
 assert.ok(read('app.js').includes("$('normalBtn').setAttribute('aria-pressed',String(!view.shuffled))"),'Normal mode must show selected status');
 assert.ok(read('app.js').includes("$('shuffleBtn').setAttribute('aria-pressed',String(view.shuffled))"),'Shuffle mode must show selected status');
 assert.ok(read('app.js').includes("$('normalBtn').onclick=()=>{if(!view.shuffled)return;"),'Normal mode must restore original order explicitly');
 assert.ok(read('app.js').includes("$('shuffleBtn').onclick=()=>{view.shuffled=true;view.index=0;"),'Shuffle button must randomize without toggling text');
});
test('English Google image search is above the pictures and each picture supports direct paste',()=>{
 const html=read('index.html'),app=read('app.js'),css=read('style.css');
 assert.ok(html.indexOf('id="googleSearchBtn"')>html.indexOf('id="backName"'));
 assert.ok(html.indexOf('id="googleSearchBtn"')<html.indexOf('id="photoGrid"'),
   'Search button must not be hidden below three tall images');
 assert.ok(html.includes('Google画像検索（英語）'));
 assert.ok(html.includes('写真1〜3の「画像を貼り付け」'));
 assert.ok(app.includes("frame.contentEditable='true'"),'The picture box must accept Ctrl+V');
 assert.ok(app.includes("frame.addEventListener('paste'"));
 assert.ok(app.includes('clipboardImage(event.clipboardData)'));
 assert.ok(app.includes("paste.textContent='画像を貼り付け'"));
 assert.ok(app.includes("search.textContent='Google画像検索（英語）'"));
 assert.ok(app.includes("searchRow.className='photo-slot-search'"));
 assert.ok(app.includes("searchRow.append(cap,search)"));
 assert.ok(app.includes("figure.append(searchRow,frame,tools,hint)"));
 assert.ok(app.includes("tools.append(paste,fileLabel)"));
 assert.ok(css.includes('.photo-slot-search{display:flex;align-items:center;justify-content:space-between'));
 assert.ok(css.includes('.photo-slot-search .btn{flex:1 1 175px}'));
 assert.ok(app.includes("search.setAttribute('aria-label','写真'+(i+1)+'のGoogle画像検索（英語）')"));
 assert.ok(app.includes("fileLabel.textContent='ファイルから登録'"));
 assert.ok(app.includes("pasteBackPhoto(card.id,i,frame)"));
 assert.ok(app.includes("saveBackPhoto(card.id,i,file)"));
 assert.ok(app.includes("update(arr=>{"));
 assert.ok(app.includes("['image:'+cardId+':'+index],'photo'"));
 assert.ok(app.includes("getImages(latest)[index]!==expected"));
 assert.ok(css.includes(".back-actions{display:flex;flex-wrap:wrap"));
 assert.ok(css.includes(".photo-slot-actions{display:flex;flex-wrap:wrap"));
 assert.ok(css.includes('.photo-frame[contenteditable="true"]'));
});
test('non-editable gun card titles never display a blinking text caret while image paste still works',()=>{
 const css=read('style.css'),html=read('index.html'),app=read('app.js');
 assert.ok(css.includes('/* Gun card read-only caret guard v16'));
 assert.match(css,/#flashCard,\s*#flashCard \*\{\s*caret-color:transparent!important;/);
 assert.match(css,/#flashCard #frontName,\s*#flashCard #backName\{\s*-webkit-user-select:none;\s*user-select:none;\s*cursor:default;/);
 assert.ok(html.includes('id="backName"'),'The read-only title should keep its original text');
 assert.ok(html.includes('id="frontName"'),'The normal front title remains unchanged');
 assert.ok(app.includes("frame.contentEditable='true'"),'Paste into photos is still supported');
 assert.ok(app.includes("frame.addEventListener('paste'"),'Clipboard images still land in a photo slot');
 assert.ok(html.includes('id="editorDialog"'),'Actual editable form inputs remain outside the read-only card');
});
test('moving Drive progress inside a collapsed details panel prevents top-layout jitter',()=>{
 const html=read('index.html'),css=read('style.css');
 assert.ok(html.includes('<details class="sync-strip" id="syncDetails">'));
 assert.ok(html.includes('<summary>同期状況（詳細）</summary>'));
 assert.ok(html.includes('class="sync-content"'));
 for(const id of ['localStatus','cloudStatus','photoStatus'])assert.ok(html.includes('id="'+id+'"'));
 assert.ok(css.includes('.sync-strip>summary{display:table'),'Collapsed details should have a stable small header');
 assert.ok(css.includes('.sync-content{display:flex;flex-wrap:wrap'),'Statuses are still accessible when expanded');
 assert.ok(css.includes('.sync-strip:not([open])>.sync-content{display:none!important}'),'Closed status panel must consume zero extra layout space');
});
test('browser storage and JSON backup preserve manually selected picture bytes',()=>{
 const source=read('app.js');
 for(const part of ["const STORE='gun-flashcards-cards-v1'","DB='gun-flashcards-images-v1'",
   "indexedDB.open(DB,1)","async function storeBlob","async function localBlob",
   "async function exportBackup","async function importBackup",
   "deleted_seed_ids","Array.isArray(raw.cards)"]){assert.ok(source.includes(part),part);}
 assert.ok(!source.includes('localStorage.clear('));
 assert.ok(!source.includes('indexedDB.deleteDatabase('));
});
test('separate authenticated namespace publishes image bytes only after Drive verification',()=>{
 const sync=read('drive-sync.js'),core=read('drive-transfer-core.js'),copy=read('image-copy.js');
 assert.ok(sync.includes("namespace:'gun-flashcards-v1'"));
 assert.ok(sync.includes("name_en:c.name_en||''"),'Save English model name to Drive without changing card IDs or photo keys');
 assert.ok(sync.includes("maker:c.maker||'',country:c.country||''"),'Maker and flag country must sync without re-registering photos');
 assert.ok(sync.includes('await sync.republish(keys)'));
 assert.ok(sync.includes("account!==sync.account"));
 assert.ok(sync.includes('gunPhotoDeferred'));
 assert.ok(sync.includes('await copier.sweep()'));
 assert.ok(core.includes('gunPhotoDeferred'));
 assert.ok(!core.includes('plantPhotoDeferred'));
 assert.ok(core.includes('pendingValues: prefix =>'));
 assert.ok(core.includes('async function republish(keys)'));
 assert.ok(copy.includes('gun-image-source-v1:'));
 assert.ok(copy.includes('gun-before-image-copy:'));
 assert.ok(copy.includes("api.getBlob(ref, {fresh:true})"));
});
test('cached app shell is isolated and does not store remote Google results or user photo bytes',()=>{
 const sw=read('service-worker.js'),html=read('index.html');
 assert.ok(sw.includes("CACHE='gun-flashcards-static-v20'"));
 assert.ok(sw.includes('url.pathname.startsWith(scope.pathname)'));
 assert.ok(!sw.includes('cache.put(url'));
 assert.ok(!sw.includes('localStorage'));
 assert.ok(html.includes('./style.css?v=18'));
 assert.ok(sw.includes('./style.css?v=18'));
 assert.ok(html.includes('./extended-models.js?v=1'));
 assert.ok(html.includes('./extended-variants.js?v=1'));
 assert.ok(sw.includes('./extended-models.js?v=1'));
 assert.ok(sw.includes('./extended-variants.js?v=1'));
 assert.ok(html.includes('./data.js?v=8'));
 assert.ok(html.includes('./app.js?v=12'));
 assert.ok(sw.includes('./data.js?v=8'));
 assert.ok(sw.includes('./app.js?v=12'));
 assert.ok(html.includes('./drive-sync.js?v=2'));
 assert.ok(sw.includes('./drive-sync.js?v=2'));
 assert.ok(html.includes('../persistent-drive-auth.js?v=1'));
 assert.ok(html.includes('./drive-transfer-core.js?v=1'));
 assert.ok(html.includes('./service-worker.js')===false);
});
test('build verifies existing apps and never packages private pictures',()=>{
 const report=JSON.parse(read('build-report.json'));
 assert.equal(report.data_changes,false);
 assert.equal(report.other_apps_modified,false);
 assert.equal(report.namespace,'gun-flashcards-v1');
 for(const [filename,digest] of Object.entries(report.protected_sha256))
   assert.equal(crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'),digest,filename);
});
test('all published scripts parse successfully without a public gun image directory',()=>{
 for(const name of ['data.js','app.js','drive-transfer-core.js','drive-sync.js','image-copy.js','service-worker.js'])
   assert.doesNotThrow(()=>new vm.Script(read(name),{filename:name}));
});
