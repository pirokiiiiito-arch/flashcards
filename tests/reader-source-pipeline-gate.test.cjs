'use strict';
// The new-book source gate rejects forged/misaligned receipts before workspace init.
// No real book scans, private metadata or credentials appear in this test.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHash}=require('node:crypto');
const {bindCaptions,checkSourcePreflight}=require('../tools/reader-private-pipeline.cjs');
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

test('a private whole-book draft can bind a partial caption batch for its own pages',t=>{
 const {file}=fixture(t),dir=path.dirname(file);
 const manifest=path.join(dir,'manifest.json'),selection=path.join(dir,'selection.json');
 const bookId='sample-novel',range=[1,40];
 fs.writeFileSync(manifest,JSON.stringify({schema:'reader-private-bundle-v2',bookId,range}));
 const origin=Buffer.from(JSON.stringify({schema:'reader-caption-ocr-origin-v1',bookId,range:[21,40],pages:[]}));
 fs.writeFileSync(path.join(dir,'ocr.json'),origin);
 const index={schema:'reader-caption-census-v1',bookId,range:[21,40],pages:[],
   originalOcrSources:{path:'ocr.json',sha256:createHash('sha256').update(origin).digest('hex')}};
 const indexPath=path.join(dir,'census.json');
 fs.writeFileSync(indexPath,JSON.stringify(index));
 fs.writeFileSync(selection,JSON.stringify({bookId,range,captionCensusPath:'census.json'}));
 assert.ok(bindCaptions(manifest,selection).captionCensus.sha256);
 index.range=[41,60];fs.writeFileSync(indexPath,JSON.stringify(index));
 assert.throws(()=>bindCaptions(manifest,selection),/CAPTION_INDEX_SCOPE_MISMATCH/);
});
