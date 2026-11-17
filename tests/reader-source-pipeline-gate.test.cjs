'use strict';
// The new-book source gate rejects forged/misaligned receipts before workspace init.
// No real book scans, private metadata or credentials appear in this test.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {checkSourcePreflight}=require('../tools/reader-private-pipeline.cjs');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'source-preflight-pipeline-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const pages=Array.from({length:20},(_,i)=>({scan:41+i,sha256:String(i).padStart(64,'0')}));
 const proof={schema:'reader-source-preflight-v1',bookId:'sample-novel',range:[41,60],
   status:'source_ready_for_ocr',sourceArchiveSha256MatchesPinned:true,
   folderListingComplete:true,releaseEligible:false,requestReupload:false,
   canonical60Certified:false,errors:[],
   rangeImages:pages.map(x=>({scan:x.scan,sha256:x.sha256}))};
 const file=path.join(dir,'private-proof.json');
 const save=()=>fs.writeFileSync(file,JSON.stringify(proof));
 save();return{pages,proof,file,save};
}
test('new-book init source check accepts pinned 20-page private provenance only',t=>{
 const f=fixture(t);
 const result=checkSourcePreflight(f.file,'sample-novel',f.pages);
 assert.equal(result.status,'source_ready_for_ocr');
 assert.equal(result.canonical60Certified,false);
});
test('old search-only or unverified source cannot be accepted by init-resolved',t=>{
 const f=fixture(t);
 f.proof.status='unresolved';f.save();
 assert.throws(()=>checkSourcePreflight(f.file,'sample-novel',f.pages),/SOURCE_DISCOVERY_OR_ORIGINAL_ZIP_NOT_VERIFIED/);
 f.proof.status='source_ready_for_ocr';f.proof.sourceArchiveSha256MatchesPinned=false;f.save();
 assert.throws(()=>checkSourcePreflight(f.file,'sample-novel',f.pages),/SOURCE_DISCOVERY_OR_ORIGINAL_ZIP_NOT_VERIFIED/);
});
test('different book or changed original page hash blocks source import',t=>{
 const f=fixture(t);
 assert.throws(()=>checkSourcePreflight(f.file,'other-book',f.pages),/SOURCE_DISCOVERY_OR_ORIGINAL_ZIP_NOT_VERIFIED/);
 f.proof.rangeImages[7].sha256='a'.repeat(64);f.save();
 assert.throws(()=>checkSourcePreflight(f.file,'sample-novel',f.pages),/SOURCE_DISCOVERY_IMAGE_HASH_MISMATCH/);
});
