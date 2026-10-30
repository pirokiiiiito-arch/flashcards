'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const P=require('../plants/photo-resume.js');
function setup(){
 let item={id:'test-plant',name:'検証用植物',images:['gdrive:test:'+'a'.repeat(64),'','']};
 const boxes=Array.from({length:3},()=>({isConnected:true,dataset:{},child:null,textContent:'',querySelector(){return this.child;},replaceChildren(img){this.child=img;}}));
 const options={stage:{querySelectorAll:()=>boxes},getCard:()=>item,getImages:x=>x.images,resolve:async()=> 'blob:synthetic',makeImage:()=>({complete:true,naturalWidth:2,src:''})};
 return {boxes,options,setItem:value=>{item=value;},getItem:()=>item};
}
test('a failed photo retries with the same metadata and becomes visible',async()=>{
 const f=setup();let n=0;f.options.resolve=async()=>{n++;if(n===1)throw Error('synthetic transport failure');return 'blob:ok';};
 await P.retry(f.options);assert.equal(f.boxes[0].dataset.photoState,'failed');assert.equal(f.boxes[0].child,null);
 await P.retry(f.options);assert.equal(f.boxes[0].dataset.photoState,'ready');assert.equal(f.boxes[0].child.src,'blob:ok');assert.equal(n,2);
});
test('already displayed pictures are not fetched or replaced by repeated sync',async()=>{
 const f=setup();let n=0;f.options.resolve=async()=>{n++;return 'blob:ok';};
 await P.retry(f.options);const image=f.boxes[0].child;
 await P.retry(f.options);await P.retry(f.options);assert.equal(f.boxes[0].child,image);assert.equal(n,1);
});
test('zero assigned slots are shown as missing assignments, not successful transfer',async()=>{
 const f=setup();f.getItem().images=['','',''];let n=0;f.options.resolve=async()=>{n++;return '';};
 await P.retry(f.options);assert.equal(n,0);assert.ok(f.boxes.every(b=>b.dataset.photoState==='unassigned'));assert.ok(f.boxes[0].textContent.includes('登録情報'));
});
test('two retries share in-flight loading for the same visible slot',async()=>{
 const f=setup();let finish,n=0;f.options.resolve=()=>{n++;return new Promise(r=>{finish=r;});};
 const a=P.retry(f.options),b=P.retry(f.options);await Promise.resolve();finish('blob:ok');await Promise.all([a,b]);assert.equal(n,1);
});
test('late results cannot replace a newly selected card or resurrect a removed image',async()=>{
 const f=setup();let finish;f.options.resolve=()=>new Promise(r=>{finish=r;});
 const pending=P.retry(f.options);await Promise.resolve();f.getItem().images[0]='';finish('blob:old');await pending;assert.equal(f.boxes[0].child,null);
});
test('editing is never disturbed and data objects are never rewritten',async()=>{
 const f=setup(),before=JSON.stringify(f.getItem());let n=0;f.options.isEditing=()=>true;f.options.resolve=async()=>{n++;return 'blob:ok';};
 await P.retry(f.options);assert.equal(n,0);assert.equal(JSON.stringify(f.getItem()),before);
});
test('viewers and offline asset lists include versioned reconnect repairs',()=>{
 for(const p of ['plants/auto-view.html','plants/photo-view.html']){const s=fs.readFileSync(p,'utf8');assert.ok(s.includes('photo-resume.js?v=1'));assert.ok(s.includes('local-adapter.js?v=photoresume1'));}
 for(const p of ['colors/auto-view.html','colors/photo-view.html'])assert.ok(fs.readFileSync(p,'utf8').includes('review47-local-loader-v2.js?v=photoresume1'));
 for(const app of ['plants','colors']){const s=fs.readFileSync(app+'/drive-view-worker.js','utf8');assert.ok(s.includes('./photo-view.html'));assert.ok(s.includes('flashcards-photo-resume-shell-v7-'));}
 for(const p of ['plants/photo-view.html','colors/photo-view.html']){const s=fs.readFileSync(p,'utf8');assert.ok(s.includes('id="photo-view-zoom-guard"'));assert.ok(s.includes('maximum-scale=1,user-scalable=no'));assert.ok(s.includes('touch-action:pan-y!important'));assert.ok(s.includes("e.touches.length>1"));assert.ok(s.includes("gesturestart"));assert.ok(s.includes("dblclick"));assert.ok(s.includes("activePointers"));}
 assert.ok(fs.readFileSync('colors/local-adapter.js','utf8').includes('N.renderImages(api,refs).catch'));
});
test('source data, photo files, PC editors, ordering, word sync and private storage stay unchanged',()=>{
 const report=JSON.parse(fs.readFileSync('photo-resume-build.json','utf8'));
 assert.equal(report.remote_writes_added,false);
 for(const [file,expected] of Object.entries(report.protected_sha256))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),expected,file);
});
