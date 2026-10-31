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
 assert.equal(new Set(C.SEEDS.map(c=>c.id)).size,35);
 for(const c of C.SEEDS){
   assert.ok(c.description.length>10);
   assert.ok(c.images.every(v=>v===''),'Every starter photo must be manually selected');
   assert.ok(/[ァ-ヶー]/.test(c.name)&&!/[A-Za-z]/.test(c.name),'All starter names are katakana');
   assert.ok(/[A-Za-z]/.test(c.search)&&!/[ぁ-んァ-ヶ一-龯]/.test(c.search),'Search terms remain English');
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
 assert.equal(c.description,legacy.description);
 assert.deepEqual(c.images,legacy.images);
 assert.equal(c.source,'user');
 const normalized=C.mergeCards([c]).find(row=>row.id===c.id);
 assert.deepEqual(normalized,c,'Previously normalized names do not change on repeat loads');
 const userRenamed=C.mergeCards([{...legacy,name:'自分で付けた銃名'}]).find(row=>row.id===legacy.id);
 assert.equal(userRenamed.name,'自分で付けた銃名','Do not erase an intentionally renamed user card');
});
test('front is name-only, back displays description and three manual photo slots',()=>{
 const html=read('index.html'),app=read('app.js');
 assert.match(html,/<div id="cardFront"/);
 assert.match(html,/<h3 id="frontName">/);
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
 assert.ok(sw.includes("CACHE='gun-flashcards-static-v1'"));
 assert.ok(sw.includes('url.pathname.startsWith(scope.pathname)'));
 assert.ok(!sw.includes('cache.put(url'));
 assert.ok(!sw.includes('localStorage'));
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
