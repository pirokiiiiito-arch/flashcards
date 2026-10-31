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
 assert.equal(C.SEEDS.length,35);
 assert.equal(C.CATEGORIES.length,10);
 for(const category of ['shotgun','revolver','pistol','bolt','semi-rifle','lever','assault','smg','machine-gun'])
   assert.ok(C.SEEDS.some(c=>c.category===category),'Missing category '+category);
 assert.ok(C.SEEDS.some(c=>c.name==='コルト・パイソン'&&c.category==='revolver'));
 assert.ok(C.SEEDS.some(c=>c.name==='レミントン・モデル870'&&c.category==='shotgun'));
 assert.equal(C.SEEDS[0].name_en,'Remington Model 870');
 assert.equal(C.SEEDS.find(c=>c.name==='コルト・パイソン').name_en,'Colt Python');
 assert.equal(new Set(C.SEEDS.map(c=>c.id)).size,35);
 for(const c of C.SEEDS){
   assert.ok(c.description.length>10);
   assert.ok(c.images.every(v=>v===''),'Every starter photo must be manually selected');
   assert.ok(/[ァ-ヶー]/.test(c.name)&&!/[A-Za-z]/.test(c.name),'All starter names are katakana');
   assert.ok(/[A-Za-z]/.test(c.search)&&!/[ぁ-んァ-ヶ一-龯]/.test(c.search),'Search terms remain English');
   assert.ok(/[A-Za-z]/.test(c.name_en)&&!/[ぁ-んァ-ヶ一-龯]/.test(c.name_en),'Exact model label is English');
   assert.ok(!c.name_en.endsWith(' photos'),'Product name is not the entire Google search query');
 }
});
test('user entries remain separately editable and allow only expected image references',()=>{
 const extra={id:'gun-custom-abc123',name:'My historical example',category:'revolver',
   search:'historical revolver photograph',description:'A user note',
   images:['https://example.org/a.jpg','idb:gunimg:gun-custom-abc123:1:testref',
     'gdrive:picture-id:'+('a'.repeat(64))]};
 const merged=C.mergeCards([extra]);assert.equal(merged.length,36);
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
test('front contains only katakana and a small English model label; back keeps description and three photo slots',()=>{
 const html=read('index.html'),app=read('app.js');
 assert.match(html,/<div id="cardFront"/);
 assert.match(html,/<h3 id="frontName">/);
 assert.match(html,/<p id="frontEnglish" class="front-english" lang="en"><\/p>/);
 const front=html.slice(html.indexOf('<div id="cardFront"'),html.indexOf('<div id="cardBack"'));
 assert.ok(!front.includes('FIREARM NAME'));
 assert.ok(!front.includes('クリック・タップで裏面へ'));
 assert.ok(app.includes("$('frontEnglish').textContent=card.name_en||''"));
 assert.ok(app.includes("$('frontEnglish').hidden=!card.name_en"));
 assert.match(html,/id="editEnglishName"/);
 assert.match(html,/class="navigation" aria-label="カードの移動と表示順"/);
 assert.match(html,/id="shuffleBtn"[^>]*>通常<\/button>/);
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
test('vertical categories and large word-style bilingual card with plant-style photo reverse',()=>{
 const css=read('style.css');
 const plants=fs.readFileSync('plants/index.html','utf8');
 assert.ok(css.includes('width:min(90%,420px);margin:0 auto'),'Category container must be centered');
 assert.ok(css.includes('justify-items:center'),'Every category tile must center its visible labels');
 assert.ok(css.includes('min-height:72px'),'Desktop tiles should be compact');
 assert.ok(css.includes('min-height:68px'),'Small mobile tiles should be compact');
 assert.ok(css.includes('text-align:center;border:1px solid var(--stroke)'),'Category name must be centered');
 assert.ok(css.includes('.front-english{font-size:clamp(12px,1.5vw,16px)'),'English subtitle must be small');
 assert.match(css,/\.category-grid\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
 assert.match(css,/\.category-grid\{grid-template-columns:minmax\(0,1fr\)/);
 assert.match(css,/#frontName\{font-size:clamp\(23px,3\.5vw,34px\)/);
 assert.match(css,/#frontName\{font-size:clamp\(21px,5\.6vw,29px\)/);
 assert.match(css,/\.photo-grid\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
 assert.match(css,/\.photo-grid\{grid-template-columns:minmax\(0,1fr\)/);
 assert.ok(css.includes('.photo-frame{display:flex')&&css.includes('aspect-ratio:16/9'));
 assert.ok(plants.includes('.image-box{width:100%;aspect-ratio:16/9'));
 assert.match(css,/#cardBack\{cursor:default;display:block;height:auto;overflow:visible\}/);
 assert.ok(css.includes('/* Word-card reference layout v8'),'The actual firearm UI must adopt the supplied word-card layout');
 assert.ok(css.includes('#flashCard,#flashCard.front-compact{position:relative;width:100%;max-width:none;min-height:520px'),'Both sides must use a large common frame');
 assert.ok(css.includes('#cardFront,#flashCard.front-compact #cardFront{display:flex;align-items:center;justify-content:center;flex-direction:column;min-height:520px'),'Front should center bilingual title in large card');
 assert.ok(css.includes('#cardBack{min-height:520px;padding:154px 32px 35px'),'Back remains large for three independent photographs');
 assert.ok(css.includes('.navigation{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))'),'The navigation is now three equal large controls');
 assert.ok(css.includes('.navigation>#shuffleBtn{background:#2d9d58'),'Normal mode must use the green word-card button');
 assert.ok(css.includes('.card-chrome{position:absolute;top:30px'),'Add/edit/delete belong inside the card');
 assert.ok(css.includes('.card-number.counter{position:absolute;right:36px;top:108px'),'Card count belongs inside the card');
 assert.ok(read('app.js').includes("classList.remove('front-compact')"),'The old small front must be deactivated');
 assert.ok(read('app.js').includes("view.shuffled?'シャッフル':'通常'"),'Default normal mode must be labeled 通常');
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
 assert.ok(sw.includes("CACHE='gun-flashcards-static-v8'"));
 assert.ok(sw.includes('url.pathname.startsWith(scope.pathname)'));
 assert.ok(!sw.includes('cache.put(url'));
 assert.ok(!sw.includes('localStorage'));
 assert.ok(html.includes('./style.css?v=8'));
 assert.ok(sw.includes('./style.css?v=8'));
 assert.ok(html.includes('./data.js?v=3'));
 assert.ok(html.includes('./app.js?v=7'));
 assert.ok(sw.includes('./data.js?v=3'));
 assert.ok(sw.includes('./app.js?v=7'));
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
