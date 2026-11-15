'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {inspect,PHASES}=require('../tools/reader-evidence-gate.cjs');
const tmp=[];
const sha='a'.repeat(64),other='b'.repeat(64);
function fixture(){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'reader-evidence-gate-'));tmp.push(folder);
 const file=path.join(folder,'manifest.json');fs.writeFileSync(file,'{"private":"test fixture"}');
 return file;
}
function result(phase){return{eligible:true,errors:[],subjectSha256:sha,subject:{artifactSha256:other},evidenceIndex:{checks:sha,display:other},checks:{'G8-08':{status:phase==='prepare'?'not_run':'passed'}}};}
test.after(()=>{for(const d of tmp)fs.rmSync(d,{recursive:true,force:true});});
test('uses the existing four delivery phases; no extra quality ID',()=>{
 assert.deepEqual(PHASES,['prepare','release','deployed','device']);
});
test('fails closed at first blocked phase and does not even evaluate successors',()=>{
 const calls=[],file=fixture();
 const out=inspect(file,'device',(_,{phase})=>{
  calls.push(phase);
  return phase==='release'?{...result(phase),eligible:false,errors:['G8-08_READBACK_MISSING']}:result(phase);
 });
 assert.deepEqual(calls,['prepare','release']);
 assert.equal(out.eligible,false);
 assert.deepEqual(out.stages.map(x=>x.decision),['passed','blocked','not_evaluated','not_evaluated']);
 assert.match(out.stages[1].errors.join(' '),/G8-08/);
 assert.equal(out.completedDelivery,false);
});
test('prepare pass is staging-only, never proof that URL or device works',()=>{
 const out=inspect(fixture(),'prepare',(_,{phase})=>result(phase));
 assert.equal(out.eligible,true);
 assert.equal(out.classification,'private_staging_only');
 assert.equal(out.publicUrlHttpVerified,false);
 assert.equal(out.completedDelivery,false);
 assert.match(out.manifestSha256,/^[a-f0-9]{64}$/);
});
test('preview requires its own verifier and never certifies OCR',()=>{
 const calls=[],out=inspect(fixture(),'preview',(_,{phase})=>{calls.push(phase);return result(phase)});
 assert.deepEqual(calls,['preview']);
 assert.equal(out.eligible,true);
 assert.equal(out.classification,'unverified_preview_only');
 assert.equal(out.contentCertified,false);
});
test('stale identity across phases blocks advancement',()=>{
 const out=inspect(fixture(),'release',(_,{phase})=>({...result(phase),subjectSha256:phase==='release'?other:sha}));
 assert.equal(out.eligible,false);
 assert.match(out.stages.at(-1).errors.join(' '),/SOURCE_VERSION_CHANGED/);
});
test('status-only true with no subject evidence cannot authorize advancement',()=>{
 const out=inspect(fixture(),'prepare',()=>({eligible:true,errors:[]}));
 assert.equal(out.eligible,false);
 assert.match(out.stages[0].errors.join(' '),/MISSING_VERIFIED_SUBJECT/);
});
test('wrong requested stage cannot bypass prerequisites',()=>{
 assert.throws(()=>inspect(fixture(),'finished',()=>result('prepare')),/INVALID_REQUESTED_PHASE/);
});
