'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const O=require('../plants/normal-order.js'),sourceIds=require('../plants/source-order.js');
global.PlantNormalOrder=O;const Source=require('../plants/pc-order-source.js');
const text=p=>fs.readFileSync(p,'utf8');
const paths=['plants/data.json',...Array.from({length:5},(_,i)=>'plants/data-angio-extra-'+(i+1)+'.json'),'plants/data-nonangio-extra.json'];
const all=new Map(paths.flatMap(p=>JSON.parse(text(p)).cards).map(c=>[c.id,c]));
const rows=sourceIds.map(id=>({...all.get(id),sort_order:0,images:['gdrive:photo_'+id+':'+'a'.repeat(64),'','']}));
const byId=new Map(rows.map(c=>[c.id,c]));
const record=ids=>({schema:O.SCHEMA,ids,revision:'test-pc-order',updated_at:'2026-10-28T00:00:00Z'});
function storage(){const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v)};}
test('all 9891 registered plants recover the PC boot order, including 8621 angiosperms',()=>{
 const unordered=rows.slice().sort((a,b)=>b.id.localeCompare(a.id)),before=JSON.stringify(unordered);
 const result=O.ordered(unordered,null,{sourceIds});
 assert.deepEqual(result.map(c=>c.id),sourceIds);assert.equal(result.length,9891);
 assert.deepEqual(result.filter(c=>c.group==='angiosperm').slice(0,5).map(c=>c.name),['アイズシモツケ','アイヌタチツボスミレ','アオガシ','アオダモ','アオツヅラフジ']);
 assert.equal(result.filter(c=>c.group==='angiosperm').length,8621);
 assert.equal(JSON.stringify(unordered),before);
 for(const c of result)assert.equal(c,byId.get(c.id));
});
test('seed 2 precedes seed 10 and extensions do not precede the original PC deck',()=>{
 const ids=['greenlist-angio-00001','seed-angiosperm-10','seed-angiosperm-2','seed-angiosperm-1'];
 assert.deepEqual(O.ordered(ids.map(id=>byId.get(id)),null,{sourceIds}).map(c=>c.id),['seed-angiosperm-1','seed-angiosperm-2','seed-angiosperm-10','greenlist-angio-00001']);
});
test('an explicitly shared PC sequence wins over numeric, ID and source order without rewriting photos',()=>{
 const list=rows.slice(0,20),ids=list.map(c=>c.id).reverse(),before=JSON.stringify(list);
 const result=O.ordered(list,record(ids),{sourceIds});assert.deepEqual(result.map(c=>c.id),ids);
 assert.equal(JSON.stringify(list),before);for(const c of result)assert.equal(c,byId.get(c.id));
});
test('first reconciliation preserves the actual PC local sequence when no order has been shared',()=>{
 const list=rows.slice(0,4),ids=[list[2].id,list[0].id,list[3].id,list[1].id];
 assert.deepEqual(O.ordered(list,null,{sourceIds,preferredIds:ids}).map(c=>c.id),ids);
});
test('meaningful old numeric positions remain supported instead of treating absent positions as zero',()=>{
 const list=[{id:'b',sort_order:2},{id:'a',sort_order:1},{id:'c'}];
 assert.deepEqual(O.ordered(list).map(c=>c.id),['a','b','c']);
});
test('order records never resurrect deleted cards; additions are retained',()=>{
 const list=[{id:'b'},{id:'new'}];assert.deepEqual(O.ordered(list,record(['deleted','b'])).map(c=>c.id),['b','new']);
});
test('invalid or duplicate order IDs fail before any mutation',()=>{
 assert.throws(()=>O.ordered(rows.slice(0,2),record(['same','same'])));
 assert.throws(()=>O.ordered(rows.slice(0,2),{schema:'other',ids:[]}));
});
test('PC source publishes only a separate ID list and survives restart',()=>{
 const s=storage(),pc=Source.create({storage:s}),list=rows.slice(0,4),before=JSON.stringify(list);
 assert.equal(pc.read(),null);const value=pc.publish(list);assert.deepEqual(value.ids,list.map(c=>c.id));
 assert.equal(JSON.stringify(list),before);assert.ok(!JSON.stringify(value).includes('gdrive:'));
 const next=Source.create({storage:s});assert.deepEqual(next.read(),value);
 next.capture([list[1],list[0],list[2],list[3]]);assert.deepEqual(next.read().ids,[list[1].id,list[0].id,list[2].id,list[3].id]);
});
test('a receiving editor does not republish its temporary local/shuffled sequence',()=>{
 const receiver=Source.create({storage:storage()}),list=rows.slice(0,3),value=record(list.map(c=>c.id));receiver.accept(value);
 receiver.capture(list.slice().reverse());assert.deepEqual(receiver.read(),value);
});
for(const adapter of ['plants/readonly-adapter.js','plants/local-adapter.js'])test(adapter+' applies PC order to a fresh/offline viewer while leaving image slots attached',async()=>{
 let cfg;const el=()=>({style:{},setAttribute(){},appendChild(){},textContent:''});
 const c={console,Map,Set,URL,Promise,document:{createElement:el,querySelector:el,querySelectorAll:()=>[]},plantBootReady:Promise.resolve(),imageSyncStatus:el(),cards:[],currentGroup:null,
 validCard:x=>typeof x?.name==='string',withImages:(x,v)=>({...x,images:v,imageUrl:v[0]}),updateCounts(){},openGroup(g){c.currentGroup=g;},rebuildOrder(){},render(){},resolveImageValue:async x=>x,resolveCardImage:async()=>''};
 const api={open(){},getBlob:async()=>new Blob()};
 c.window={PlantNormalOrder:{...O,ordered:(list,value)=>O.ordered(list,value,{sourceIds})},DriveReadOnly:{install:x=>{cfg=x;return api;}}};
 vm.createContext(c);vm.runInContext(text(adapter),c);await cfg.ready;
 const list=rows.slice(0,3),ids=[list[2].id,list[0].id,list[1].id],data={[O.KEY]:record(ids)};
 for(const p of list){data['card:'+p.id]=p;data['image:'+p.id+':0']=p.images[0];}
 await cfg.apply({view:{data,deleted:{}},imageFiles:[]});assert.deepEqual(Array.from(c.cards,x=>x.id),ids);
 for(const p of c.cards)assert.equal(p.images[0],byId.get(p.id).images[0]);
 delete data[O.KEY];await cfg.apply({view:{data,deleted:{}},imageFiles:[]});assert.deepEqual(Array.from(c.cards,x=>x.id),list.map(x=>x.id));
});
test('PC writer includes ordering as one separate key and does not rewrite every card rank',()=>{
 const src=text('plants/drive-sync.js');assert.ok(src.includes('result[O.KEY]=normalOrder'));
 assert.ok(src.includes('values(raw.cards,false)'));assert.ok(src.includes('preferredIds:cards.map(c=>c.id)'));
 assert.ok(src.includes('sort_order: Number(c.sort_order) || 0'));assert.ok(src.includes('if(!sync.applying)orderSource.capture(cards)'));
});
test('all active plant entries and offline workers include the same policy and fresh versions',()=>{
 for(const path of ['plants/index.html','plants/plant-sync-v2.html','plants/drive-view.html','plants/saved-view.html']){
  const html=text(path);assert.ok(html.includes('source-order.js?v=pcorder1'),path);assert.ok(html.includes('normal-order.js?v=pcorder1'),path);
  assert.ok(html.includes('PC基準 修正1'),path);
  assert.equal(html.includes('pc-order-source.js'),!path.includes('view.html'),path);
 }
 for(const path of ['plants/service-worker.js','plants/drive-view-worker.js']){
  const src=text(path);assert.ok(src.includes('source-order.js?v=pcorder1'));assert.ok(src.includes('normal-order.js?v=pcorder1'));new vm.Script(src);
 }
});
test('all original plant data, color files, word app and private cache code are byte-identical',()=>{
 const report=JSON.parse(text('plants/order-build-report.json'));
 assert.equal(report.user_pc_sequence_received,false);
 for(const [p,h] of Object.entries(report.protected_sha256))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),h,p);
});
