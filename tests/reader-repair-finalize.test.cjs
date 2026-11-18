'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const base=require('../reader/quality/work-ledger.json');
const {finalize}=require('../tools/reader-repair-finalize.cjs');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const H='a'.repeat(64),L='b'.repeat(64),E='c'.repeat(64);
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'reader-finalize-fixture-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const bookId='synthetic-final-test-book';
 const html='<html><head><meta name="viewport" content="width=device-width"></head><body>'+
  '<script id="embedded-data" type="application/json">'+JSON.stringify({bookId,range:[1,1],
  pages:[{scan:1,sha256:H,reading_text:'これは合成データです。'}]})+'</script></body></html>';
 const artifact=path.join(root,'book.html');fs.writeFileSync(artifact,html);
 const artifactSha256=sha(html);
 const ledger=structuredClone(base);
 const b={bookId,range:[1,1],profile:'novel',artifactSha256:E,
  sourceArchiveSha256:H,qualityState:'unverified',releaseStatus:'blocked',
  knownDefects:[],pendingDraft:{
    artifactSha256,reviewStatus:'awaiting_canonical_60',
    deliveryStatus:'private_staging_blocked',independentSecondPass:'complete',
    realIPhone:'not_run',privateProgressReportSha256:E,
    latestPrivateRepairProgressSha256:E,secondPassEvidenceSha256:E,
    sourceResolutionEvidenceSha256:E,canonicalPreparationEvidenceSha256:E,
    sourceJPEGSHAverified:1,chromiumLayoutChecksPassed:29
  }};
 ledger.books.push(b);
 const manifest={schema:'reader-private-bundle-v2',bookId,range:[1,1],
  artifact:{sha256:artifactSha256,path:'book.html'},loaderSha256:L};
 const manifestFile=path.join(root,'manifest.json');
 fs.writeFileSync(manifestFile,JSON.stringify(manifest));
 const sourceFile=path.join(root,'source.json');
 fs.writeFileSync(sourceFile,JSON.stringify({schema:'reader-source-preflight-v1',
  bookId,range:[1,1],sourceArchiveSha256:H,status:'source_ready_for_ocr',
  sourceArchiveSha256MatchesPinned:true,rangeImages:[{scan:1,sha256:H}]}));
 const publicFile=path.join(root,'public.json');
 const publicReport={schema:'reader-public-delivery-evidence-v1',eligible:true,
  checks:[{bookId,status:'verified',httpStatus:200,
    entry:'reader/synthetic-production/index.html',url:'https://example.org/reader/synthetic-production',
    expectedSha256:L,observedSha256:L}]};
 fs.writeFileSync(publicFile,JSON.stringify(publicReport));
 const opts={artifact,manifest:manifestFile,sourceProof:sourceFile,publicEvidence:publicFile,
  expectedRevision:ledger.version,at:'2026-11-19T00:00:00Z'};
 return{ledger,b,opts,publicFile,publicReport,artifact,bookId};
}
test('candidate finalization cannot skip the awaiting-canonical-sixty stage',t=>{
 const x=fixture(t);x.b.pendingDraft.reviewStatus='second_pass_completed';
 const r=finalize(x.ledger,x.bookId,x.opts);
 assert.equal(r.ok,false);assert.ok(r.errors.includes('DRAFT_NOT_READY_FOR_FINAL_CANONICAL_GATE'));
});
test('source defects must be resolved before final formal release checks',t=>{
 const x=fixture(t);x.b.knownDefects.push({id:'synthetic-unresolved',status:'needs_source_review'});
 const r=finalize(x.ledger,x.bookId,x.opts);
 assert.equal(r.ok,false);assert.ok(r.errors.includes('UNRESOLVED_SOURCE_DEFECTS'));
});
test('stale revision and changed actual bytes are blocked',t=>{
 const x=fixture(t);
 let r=finalize(x.ledger,x.bookId,{...x.opts,expectedRevision:x.ledger.version+1});
 assert.ok(r.errors.includes('STALE_SHARED_LEDGER_REVISION'));
 fs.appendFileSync(x.artifact,'modified');
 r=finalize(x.ledger,x.bookId,x.opts);
 assert.ok(r.errors.includes('DRAFT_HTML_SHA_CHANGED'));
});
test('a preview/uncertified loader URL is never a normal production release',t=>{
 const x=fixture(t);
 x.publicReport.checks[0].entry='reader/preview/synthetic/index.html';
 fs.writeFileSync(x.publicFile,JSON.stringify(x.publicReport));
 const r=finalize(x.ledger,x.bookId,x.opts);
 assert.equal(r.ok,false);assert.ok(r.errors.includes('VERIFIED_NON_PREVIEW_PRODUCTION_HTTP_REQUIRED'));
});
test('plausible but self-declared HTTP/SHA does not substitute real sixty/iPhone proof',t=>{
 const x=fixture(t);
 const r=finalize(x.ledger,x.bookId,x.opts);
 assert.equal(r.ok,false);
 assert.ok(r.errors.includes('FORMAL_SIXTY_DEVICE_AND_OCR_GATE_NOT_PASSED')||
   r.errors.includes('FINAL_CANONICAL_VERIFIER_UNAVAILABLE'),r.errors.join(','));
 assert.equal(x.ledger.books.at(-1).releaseStatus,'blocked');
 assert.ok(x.ledger.books.at(-1).pendingDraft);
});
test('no evidence file can produce a private candidate',t=>{
 const x=fixture(t);
 const r=finalize(x.ledger,x.bookId,{...x.opts,manifest:'/nonexistent'});
 assert.equal(r.ok,false);assert.ok(r.errors.includes('MISSING_FINAL_EVIDENCE_MANIFEST'));
});
