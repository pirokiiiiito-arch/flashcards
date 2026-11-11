'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const gate=require('../tools/reader-quality-gate.cjs'),root=path.resolve(__dirname,'..');
const std=JSON.parse(fs.readFileSync(path.join(root,'reader/quality/standard.json')));
const reg=JSON.parse(fs.readFileSync(path.join(root,'reader/quality/registry.json')));
const original=JSON.parse(fs.readFileSync(path.join(root,'reader/quality/reports/world-symbols-001-020.json')));
const book=reg.books[0],copy=x=>JSON.parse(JSON.stringify(x));
const proof=()=>({method:'independent source evidence',evidenceRef:'private:book-audit:20261112',artifactSha256:crypto.createHash('sha256').update('fixture').digest('hex'),verifiedBy:'reviewer'});
function run(rep,stage){const r=copy(rep);r.stage=stage;const errors=[];gate.reportCheck({...book,stage},r,errors);return errors.join(' | ');}
test('exact 60 original rules and repository route coverage',()=>{
 const e=[];gate.standardCheck(std,e);assert.deepEqual(e,[]);
 assert.equal(new Set(gate.RULES).size,60);
 const r=gate.validate(root);assert.deepEqual(r.errors,[],r.errors.join('\n'));assert.ok(r.paths>=40);
});
test('draft tracks all sixty without a false completed claim',()=>{
 assert.equal(run(original,'draft'),'');
 const r=copy(original);r.claimsCompleted=true;assert.match(run(r,'draft'),/draft cannot claim/);
});
test('cannot leave a check out',()=>{
 const r=copy(original);delete r.checks['G3-01'];assert.match(run(r,'draft'),/all 60/);
});
test('unverified source or swipe prevents promotion to complete',()=>{
 assert.match(run(original,'ready_for_publication'),/G7-04/);
 assert.match(run(original,'completed'),/G3-01/);
});
test('passed without evidence is not trusted',()=>{
 const r=copy(original);r.checks['G1-02']={status:'passed'};assert.match(run(r,'draft'),/without method/);
});
test('cannot mark mandatory original OCR review as not applicable',()=>{
 const r=copy(original);r.checks['G3-01']={status:'not_applicable',reason:'The scan had no prose in this fixture',evidenceRef:'private:scan:001'};
 assert.match(run(r,'draft'),/unsupported not_applicable/);
});
test('Pages success and device check are separately staged',()=>{
 const r=copy(original);for(const id of gate.RULES)r.checks[id]={status:'passed',proof:proof()};
 r.artifactAudit={schema:'reader-artifact-audit-v1',structuralStatus:'passed',sourceSha256:crypto.createHash('sha256').update('example private HTML').digest('hex'),originals:20,OCRTextPages:17,errors:[]};
 r.checks['G8-03']={status:'not_run'};r.checks['G8-04']={status:'not_run'};
 assert.equal(run(r,'ready_for_publication'),'');assert.match(run(r,'completed'),/G8-03/);
 r.checks['G8-03']={status:'passed',proof:proof()};
 assert.equal(run(r,'completed'),'');assert.match(run(r,'iphone_verified'),/G8-04/);
 r.checks['G8-04']={status:'passed',proof:proof()};r.deviceVerification='passed';
 assert.equal(run(r,'iphone_verified'),'');
});
test('unknown book site cannot enter the Pages artifact',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'reader-gate-'));
 try{
  fs.mkdirSync(path.join(tmp,'reader/quality'),{recursive:true});
  for(const f of ['standard.json','registry.json'])fs.copyFileSync(path.join(root,'reader/quality',f),path.join(tmp,'reader/quality',f));
  fs.mkdirSync(path.join(tmp,'reader/orphan'),{recursive:true});fs.writeFileSync(path.join(tmp,'reader/orphan/index.html'),'<html/>');
  assert.match(gate.validate(tmp).errors.join('|'),/UNREGISTERED_READER/);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
test('historical reader edits cannot pass silently',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'reader-gate-'));
 try{
  fs.mkdirSync(path.join(tmp,'reader/quality'),{recursive:true});
  for(const f of ['standard.json','registry.json'])fs.copyFileSync(path.join(root,'reader/quality',f),path.join(tmp,'reader/quality',f));
  const old=Object.keys(reg.legacyFrozenEntries)[0],file=path.join(tmp,old);
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'modified');
  assert.match(gate.validate(tmp).errors.join('|'),/LEGACY_CHANGED/);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
