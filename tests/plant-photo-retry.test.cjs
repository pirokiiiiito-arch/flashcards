'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync('plants/drive-sync.js','utf8');
const beginning=code.indexOf('  async function retryPlantPhotos(origin = ');
const ending=code.indexOf('\n  retry.onclick =',beginning);
assert.ok(beginning>0&&ending>beginning,'safe retry handler must be published');
const fn=code.slice(beginning,ending);
const ref='gdrive:123:'+'a'.repeat(64);
function rig({valid=true,account='owner',remote='owner',pending=0,fail=false}={}) {
 let sweeps=0,syncs=0,republished=[],tokens=0;
 const cards=[{id:'plant',images:['idb:plantimg:plant:0','']}];
 const retryFeedback={textContent:''},retry={disabled:false};
 const sync={account,valid:()=>valid,request:async()=>({json:async()=>({user:{permissionId:remote}})}),sync:async()=>{syncs++;if(fail)throw Error('simulated-sync-error')},republish:async keys=>{republished.push(...keys)},status:()=>({pending,detail:'同期テスト'}),pendingKeys:()=>[]};
 const copier={busy:false,retry(){},summary:()=>({drive:sweeps?1:0,pending:sweeps?0:1,failed:0}),async sweep(){sweeps++;cards[0].images[0]=ref;}};
 const ctx={window:{PersistentDriveAuth:{state:()=>({phase:'connected'}),getToken:async()=>{tokens++;valid=true}}},sync,copier,P:{isDrive:v=>v===ref},cards,
  getImages:c=>c.images,imageKey:(c,i)=>'image:'+c.id+':'+i,editing:false,recoveryBusy:false,retry,retryFeedback,Promise,Map};
 return {ctx,run:()=>vm.runInNewContext('('+fn+')(\"手動\")',ctx),count:()=>({sweeps,syncs,republished,tokens}),cards,retryFeedback,retry};
}
test('PC manual retry explicitly copies photos and republishes current registration key',async()=>{
 const r=rig();await r.run();assert.equal(r.count().sweeps,1);assert.equal(r.count().syncs,1);
 assert.deepEqual(r.count().republished,['image:plant:0']);assert.match(r.retryFeedback.textContent,/未コピー 0枠/);assert.equal(r.retry.disabled,false);
});
test('mismatched Drive account cannot upload or mutate local card photo',async()=>{
 const r=rig({remote:'other'});await r.run();assert.equal(r.count().sweeps,0);assert.equal(r.cards[0].images[0],'idb:plantimg:plant:0');
 assert.match(r.retryFeedback.textContent,/異なるGoogleアカウント/);assert.equal(r.retry.disabled,false);
});
test('auth token reactivation is attempted before retrying a known account',async()=>{
 const r=rig({valid:false});await r.run();assert.equal(r.count().tokens,1);assert.equal(r.count().sweeps,1);
});
test('failed remote journal sync preserves completed local photo and gives visible error',async()=>{
 const r=rig({fail:true});await r.run();assert.equal(r.cards[0].images[0],ref);assert.match(r.retryFeedback.textContent,/simulated-sync-error/);assert.equal(r.retry.disabled,false);
});
