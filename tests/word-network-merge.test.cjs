'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const recovery=require('../word-network-recovery.js');
const card=(id,word=id)=>({id,word,meaning:'example meaning',sort_order:1,updated_at:'2020-01-01 00:00:00.12345+00'});
test('adds missing records without changing current records',()=>{
 const view={data:{'card:a':card('a')},deleted:{}};
 const local={'card:a':card('a','edited')};
 const input=[card('a'),card('b')];
 const before=JSON.stringify({view,local,input});
 const plan=recovery.buildPlan(view,local,input);
 assert.deepEqual(Object.keys(plan.data),['card:b']);
 assert.equal(plan.kept,1);
 assert.equal(JSON.stringify({view,local,input}),before);
 assert.equal(plan.timestamps['card:b'],'2020-01-01T00:00:00.123Z');
});
test('identical content under a different ID is not duplicated',()=>{
 const plan=recovery.buildPlan({data:{'card:old':card('old','same')},deleted:{}},{},[card('new','same')]);
 assert.equal(plan.added,0);assert.equal(plan.kept,1);
});
test('explicit deletion is preserved',()=>{
 const plan=recovery.buildPlan({data:{},deleted:{'card:a':{deleted:true}}},{},[card('a')]);
 assert.equal(plan.added,0);assert.equal(plan.deletedSkipped,1);
});
test('all missing synthetic records enter the plan',()=>{
 const input=Array.from({length:59},(_,i)=>card('example-'+i));
 const plan=recovery.buildPlan({data:{},deleted:{}},{},input);
 assert.equal(plan.added,59);assert.equal(Object.keys(plan.data).length,59);
});
test('repeating the same plan creates no additions',()=>{
 const input=[card('a'),card('b')];
 const first=recovery.buildPlan({data:{},deleted:{}},{},input);
 const again=recovery.buildPlan({data:first.data,deleted:{}},{},input);
 assert.equal(again.added,0);assert.equal(again.kept,2);
});
test('incomplete response is rejected before a plan is made',()=>{
 assert.throws(()=>recovery.validate({schema:'word-flashcards-recovery-v1',source_record_count:59,content_sha256:recovery.expectedSha,cards:[card('a')]}));
});
