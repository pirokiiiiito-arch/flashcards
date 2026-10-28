'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const Q=require('../word-quiet-sync.js');
const card=(id,n=0)=>({id,word:'単語 '+id,meaning:'意味 '+id,sort_order:n,updated_at:null});
const read=p=>fs.readFileSync(p,'utf8');
test('identical materialized records do not trigger local saving or rendering',()=>{
 const list=[card('a'),card('b',1)];assert.equal(Q.plan(list,structuredClone(list),{order:[0,1],pos:1,shuffled:false}),null);
});
test('property order and an absent nullable timestamp do not cause a rerender',()=>{
 const a=card('a'),b={meaning:a.meaning,sort_order:0,word:a.word,id:a.id};
 assert.equal(Q.plan([a],[b],{order:[0],pos:0}),null);
});
test('other-card updates retain the current card DOM and selection',()=>{
 const a=[card('a'),card('b',1)],b=structuredClone(a);b[1].meaning='更新';
 const p=Q.plan(a,b,{order:[0,1],pos:0});assert.equal(p.redraw,false);assert.equal(p.pos,0);assert.equal(p.sameCard,true);
});
test('new cards are appended to a shuffle without reshuffling existing cards',()=>{
 const a=[card('a'),card('b',1),card('c',2)],b=[...a,card('d',3)];
 const p=Q.plan(a,b,{order:[2,0,1],pos:1,shuffled:true});assert.deepEqual(p.order,[2,0,1,3]);assert.equal(p.redraw,false);assert.equal(p.pos,1);assert.equal(p.shuffled,true);
});
test('reordered array indices rebind existing editor/delete handlers while retaining the visible ID',()=>{
 const a=[card('a'),card('b',1)],b=[a[1],a[0]],p=Q.plan(a,b,{order:[0,1],pos:0});
 assert.equal(p.redraw,true);assert.equal(p.sameCard,true);assert.equal(b[p.order[p.pos]].id,'a');
});
test('changes to the visible text cause a deliberate redraw',()=>{
 const a=[card('a')],b=[{...a[0],meaning:'新しい説明'}],p=Q.plan(a,b,{order:[0],pos:0});assert.equal(p.redraw,true);assert.equal(p.sameCard,true);
});
test('explicit deletion selects a remaining card without resurrecting it',()=>{
 const a=[card('a'),card('b',1)],p=Q.plan(a,[a[1]],{order:[0,1],pos:0});assert.equal(p.sameCard,false);assert.equal(p.pos,0);assert.deepEqual(p.order,[0]);
});
test('malformed and duplicate input is rejected before changing cards',()=>{
 const a=[card('a')],before=JSON.stringify(a);assert.throws(()=>Q.plan(a,[card('a'),card('a')],{order:[0],pos:0}));assert.throws(()=>Q.plan(a,[{}],{order:[0],pos:0}));assert.equal(JSON.stringify(a),before);
});
test('build retains existing URLs and loads quiet UI before the adapter',()=>{
 for(const p of ['index.html','word-sync-v2.html']){const h=read(p);assert.ok(h.includes('id="wordQuietStyle"'));assert.ok(h.indexOf('./word-quiet-sync.js?v=20261028-quiet1')<h.indexOf('./drive-sync.js?v=20261028-quiet1'));assert.ok(h.includes('const KEY="simple_vocab_cards_v1";'));}
 const adapter=read('drive-sync.js');assert.ok(adapter.includes('if(!plan)return;'));assert.ok(adapter.includes('if(editing)throw'));assert.ok(adapter.includes('Q.restore(stage,viewport'));assert.ok(read('word-recovery.js').includes('wordRecoveryResult'));
});
test('shared sync/auth/photo code, all plant/color assets and recovery payload code are byte-identical',()=>{
 const report=JSON.parse(read('word-quiet-build.json'));for(const [p,s]of Object.entries(report.unchanged))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),s,p);
 assert.equal(report.data_migration,false);assert.equal(report.automatic_sync_delay_changed,false);
 assert.ok(read('drive-core.js').includes('setTimeout(() => sync().catch(error), 1500)'));
});
