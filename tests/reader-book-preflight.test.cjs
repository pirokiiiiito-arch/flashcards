'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),SCRIPT=path.join(ROOT,'tools/reader-book-preflight.cjs');
function run(args,root=ROOT){return spawnSync(process.execPath,[SCRIPT,...args],{cwd:ROOT,env:{...process.env,READER_AUDIT_ROOT:root},encoding:'utf8'});}
test('new-book preflight reports 60 statuses per registered draft and never certifies OCR',()=>{
 const r=run(['--all']);
 assert.equal(r.status,0,r.stderr+'\n'+r.stdout);
 const j=JSON.parse(r.stdout);
 assert.equal(j.schema,'book-create-preflight-v1');
 assert.equal(j.sourcePublicOnly,true);assert.equal(j.contentCertification,false);
 assert.ok(j.checkedBooks>0);
 assert.ok(j.books.every(b=>b.status!=='completed'&&Number.isInteger(b.formalChecksNotRun)));
});
test('synthetic public source leak and changed preview bytes are rejected',t=>{
 const registry=JSON.parse(fs.readFileSync(path.join(ROOT,'reader/quality/registry.json'),'utf8'));
 const src=registry.books.find(b=>b.id==='nine-stories-001-020-preview');
 if(!src)return t.skip('original preview missing');
 const p=path.join(ROOT,'reader/quality/release-policy.json');
 const policy=JSON.parse(fs.readFileSync(p,'utf8'));
 const receiptPath=policy.receipts.find(f=>f.endsWith('nine-stories-001-020-preview.json'));
 assert.ok(receiptPath);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'book-preflight-'));
 try{
  function put(rel,data){
   const out=path.join(dir,rel);fs.mkdirSync(path.dirname(out),{recursive:true});
   fs.writeFileSync(out,data);
  }
  put('reader/quality/registry.json',JSON.stringify({books:[src]}));
  put('reader/quality/release-policy.json',JSON.stringify({...policy,receipts:[receiptPath]}));
  for(const rel of [receiptPath,src.report,src.entry]){
   put(rel,fs.readFileSync(path.join(ROOT,rel)));
  }
  const ok=run([src.id],dir);
  assert.equal(ok.status,0,ok.stderr+'\n'+ok.stdout);
  const input=path.join(dir,src.entry);
  fs.appendFileSync(input,'\n<script>const leaked="data:image/jpeg;base64,'+'A'.repeat(100)+'"</script>\n');
  const result=run([src.id],dir);
  assert.notEqual(result.status,0);
  const j=JSON.parse(result.stdout);
  assert.ok(j.issues.some(e=>e.includes('SOURCE_IMAGE_EMBEDDED_IN_PUBLIC_LOADER')),result.stdout);
  assert.ok(j.issues.some(e=>e.includes('LOADER_SHA_MISMATCH')),result.stdout);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
