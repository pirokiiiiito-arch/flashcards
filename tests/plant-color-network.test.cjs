'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const P=require('../plants/network-support.js'),C=require('../colors/network-support.js');
const hash='a'.repeat(64),ref='gdrive:image_1:'+hash;
const plant=(id,images=['','',''])=>({id,name:'植物 '+id,description:'説明',group:'angiosperm',sort_order:1,images});
const images=c=>c?.images||['','',''];const withImages=(c,v)=>({...c,images:v,imageUrl:v[0]});
test('plant cloud absence is not a local card or photograph deletion',()=>{
 const current=[plant('one',[ref,'https://images.example/photo.jpg','idb:one'])];
 const before=JSON.stringify(current),result=P.plan({data:{},deleted:{}},current,images,withImages);
 assert.equal(result.length,1);assert.deepEqual(result[0].images,current[0].images);assert.equal(JSON.stringify(current),before);
});
test('explicit plant card and slot tombstones remain effective',()=>{
 const result=P.plan({data:{},deleted:{'card:two':{},'image:one:1':{}}},[plant('one',[ref,ref,'']),plant('two')],images,withImages);
 assert.equal(result.length,1);assert.equal(result[0].images[0],ref);assert.equal(result[0].images[1],'');
});
test('plant remote cards and photos can populate a fresh device',()=>{
 const result=P.plan({data:{'card:one':plant('one'),'image:one:2':ref},deleted:{}},[],images,withImages);
 assert.equal(result.length,1);assert.equal(result[0].images[2],ref);
 assert.deepEqual(P.counts({data:{'card:one':plant('one')}},result,images),{local:1,remote:1,photos:1,drivePhotos:1,notCopied:0});
});
test('an unusable foreign-device image reference does not erase a working image',()=>{
 const result=P.plan({data:{'image:one:0':'idb:other-device'},deleted:{}},[plant('one',[ref,'',''])],images,withImages);
 assert.equal(result[0].images[0],ref);
});
test('malformed plant body rejects the apply plan before mutation',()=>{
 assert.throws(()=>P.plan({data:{'card:one':{id:'other',name:'bad'}},deleted:{}},[plant('one')],images,withImages));
});
test('color compact private refs and intentional photo removals survive normalization',()=>{
 const keys=new Set(['color-0001:origin','color-0001:interior']);
 const result=C.normalize({'color-0001:origin':{data_url:ref,sha256:hash,updated_at:'2026-01-01'},'color-0001:interior':{deleted:true,updated_at:'2026-01-02'}},keys,()=>true);
 assert.equal(result['color-0001:origin'].data_url,ref);assert.equal(result['color-0001:origin'].sha256,hash);
 assert.equal(result['color-0001:interior'].deleted,true);
});
test('color mismatching Drive hash is rejected instead of discarding edits',()=>{
 assert.throws(()=>C.normalize({x:{data_url:ref,sha256:'b'.repeat(64)}},new Set(['x']),()=>true));
});
test('color embedded photo input remains supported and unrelated keys stay excluded',()=>{
 const url='data:image/png;base64,aGVsbG8=';
 const result=C.normalize({x:{data_url:url},bad:{data_url:ref}},new Set(['x']),()=>true);
 assert.equal(result.x.data_url,url);assert.equal(Object.keys(result).length,1);
 assert.equal(C.isDrive('javascript:alert(1)'),false);
});
test('plant edit control is above the card while add and delete stay below',()=>{
 const p=fs.readFileSync('plants/index.html','utf8');
 assert.ok(p.includes('.stage{min-height:470px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:10px}'));
 assert.ok(p.includes('editActions.append(edit);actions.append(add,del);'));
 assert.ok(p.includes('card.append(front,back,num);stage.append(editActions,card,actions);'));
 assert.ok(p.includes('.actions{width:min(720px,100%);display:flex;'));
 assert.ok(!p.includes('actions.append(add,edit,del)'));
 assert.ok(!p.includes('cardShell'));
});
test('plant card number stays in the top-right clear of description text',()=>{
 const p=fs.readFileSync('plants/index.html','utf8');
 assert.ok(p.includes('.number{position:absolute;right:24px;top:18px;'));
 assert.ok(p.includes('.number{right:18px;top:14px}'));
 assert.ok(!p.includes('top:68px;color:#b3bcb6'));
});
test('published entry aliases use the new scripts on the same origin',()=>{
 const p=fs.readFileSync('plants/plant-sync-v2.html','utf8'),c=fs.readFileSync('colors/color-sync-v2.html','utf8');
 assert.ok(p.includes('network-support.js?v=2'));assert.ok(p.includes('drive-sync.js?v=network2'));
 assert.ok(c.includes('review47-loader.js?v=network2'));
 assert.equal(p,fs.readFileSync('plants/index.html','utf8'));assert.equal(c,fs.readFileSync('colors/index.html','utf8'));
 for(const text of [p,c])for(const m of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(m[1].trim())new vm.Script(m[1]);
});
test('color support loads before the original app normalizes its saved images',()=>{
 const src=fs.readFileSync('colors/data/review47-loader.js','utf8');
 assert.ok(src.indexOf("'./network-support.js?v=2'")<src.indexOf("'./app-main.js?v=network2'"));
 assert.ok(src.includes('ColorNetworkSupport.installExport()'));
 const app=fs.readFileSync('colors/app-main.js','utf8');
 assert.ok(app.includes('ColorNetworkSupport.normalize(input,VALID_SLOT_KEYS,safeImage)'));
 assert.ok(app.includes('ColorNetworkSupport.isDrive(edit.data_url)'));
 new vm.Script(app);
});
test('color apply plan receives Drive refs without downloading every photograph',async()=>{
 let config,downloads=0;
 const el=()=>({style:{},dataset:{},setAttribute(){},append(){},addEventListener(){},querySelector(){return null;},click(){}});
 const toolbar=el(),storage=new Map();
 const catalogue={counts:{unique_images:940,registrations:1047,suppressed_duplicates:107},registrations:[],files:{}};
 const api={cache:{get:async()=>null,put:async()=>{}},changed(){},getBlob:async()=>{downloads++;throw Error('must not preload');},view:()=>({data:{},deleted:{}}),status:()=>({pending:0}),valid:()=>true};
 const support={...C,note(){},onStatus(){},renderImages:async()=>{}};
 const E={ready:Promise.resolve(),getRecords:()=>({}),validateRecords:x=>x,applyCloudRecords:async()=>{}};
 const ctx={console,structuredClone,Map,Set,Promise,URL,Blob,setTimeout,clearTimeout,
   document:{body:toolbar,createElement:el,querySelector:()=>toolbar,querySelectorAll:()=>[],addEventListener(){},getElementById:()=>null},
   window:{scrollX:0,scrollY:0,scrollTo(){},ColorNetworkSupport:support,ColorOriginEditor:E,FlashcardsDrive:{install:cfg=>{config=cfg;return api;}}},
   localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
   readyImages:Promise.resolve(),CARDS:[{name:'example',hex:'#000000'}],CARD_IDS:['color-0001'],manualEdits:{},progress:{},state:{flipped:false},
   slotPhoto:()=>null,own:(o,k)=>Object.prototype.hasOwnProperty.call(o,k),normalizeEdits:x=>C.normalize(x,new Set(['color-0001:origin']),()=>true),validateStudyProgress:x=>x,
   persistEdits:async()=>{},mark(){},render(){},toast(){},
   ColorAssetMigration:{validate(){},publish:async()=>{},manifest:()=>({})},
   fetch:async()=>({ok:true,json:async()=>catalogue})
 };
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('colors/drive-sync.js','utf8'),ctx);await config.ready;
 const prepared=await config.prepareApply({data:{'photo:color-0001:origin':{data_url:ref,sha256:hash}},deleted:{}},api);
 assert.equal(downloads,0);assert.equal(prepared.photos['color-0001:origin'].data_url,ref);
 await config.apply(prepared);assert.equal(ctx.manualEdits['color-0001:origin'].data_url,ref);
});
test('portable color backup still hydrates Drive images instead of silently dropping them',()=>{
 const src=fs.readFileSync('colors/network-support.js','utf8');
 assert.ok(src.includes('ColorDriveSync.getBlob(record.data_url)'));assert.ok(src.includes('data.manual_origin_edits=root.ColorOriginEditor.getRecords()'));
});
