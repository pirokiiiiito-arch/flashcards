'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const v=require('../tools/reader-release-control.cjs'),{RULES}=require('../tools/reader-quality-gate.cjs');
const {inspect,findAnomalies}=require('../tools/reader-unified-handoff.cjs');
const BAR='f'.repeat(64),LOADER='b'.repeat(64);
function fixture(t,reading='正常な日本語の縦書き本文。'){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'unified-handoff-synth-'));
 t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 const write=(name,x)=>{
  const p=path.join(tmp,name);fs.writeFileSync(p,typeof x==='string'?x:JSON.stringify(x));return p;
 };
 const book={bookId:'synthetic-novel',range:[41,42],pages:[
  {scan:41,sha256:'1'.repeat(64),blocks:[{text:reading}]},
  {scan:42,sha256:'2'.repeat(64),blocks:[{text:'次のページです。'}]}
 ]};
 const artifact=write('artifact.html','<!doctype html><html lang="ja"><head></head><body>'+
   '<script id="embedded-data" type="application/json">'+JSON.stringify(book)+'</script></body></html>');
 const sha=v.hash(fs.readFileSync(artifact));
 const ledgerRecord={bookId:book.bookId,range:book.range,artifactSha256:sha,
  sourceArchiveSha256:BAR,profile:'novel',qualityState:'reviewed',
  releaseStatus:'candidate',knownDefects:[]};
 const ledger=write('ledger.json',{schema:'reader-work-ledger-v1',ruleset:'20261116_0654_60-items',
  books:[ledgerRecord]});
 const sourceProof=write('source.json',{schema:'reader-source-preflight-v1',
  status:'source_ready_for_ocr',sourceArchiveSha256MatchesPinned:true,
  bookId:book.bookId,range:book.range,sourceArchiveSha256:BAR,
  rangeImages:book.pages.map(p=>({scan:p.scan,sha256:p.sha256}))});
 const manifest=write('manifest.json',{bookId:book.bookId,range:book.range,artifact:{sha256:sha}});
 const consent=write('consent.json',{schema:'reader-preview-consent-v1',
  bookId:book.bookId,range:book.range,artifactSha256:sha,
  confirmedByUser:true,acknowledgesUncorrectedOCR:true,
  requestText:'この未校正のOCR一次稿を明示的に確認用として開きたい',
  requestedAt:'2026-11-18T00:00:00Z'});
 const publicEvidence=write('http.json',{schema:'reader-public-delivery-evidence-v1',eligible:true,
  checkedAt:'2026-11-18T00:00:00Z',checks:[{bookId:book.bookId,
   status:'verified',httpStatus:200,expectedSha256:LOADER,observedSha256:LOADER}]});
 const opts={artifact,ledger,sourceProof,manifest,previewConsent:consent,publicEvidence};
 const fakeValidate=(file,{phase})=>({eligible:true,errors:[],subjectSha256:'a'.repeat(64),
  subject:{bookId:book.bookId,artifactSha256:sha,loaderSha256:LOADER},
  checks:Object.fromEntries(RULES.map(x=>[x,{status:'passed'}]))});
 return{tmp,write,book,sha,ledgerRecord,ledger,opts,sourceProof,consent,fakeValidate};
}
test('all sixty existing IDs retained without new quality rule',()=>assert.equal(RULES.length,60));
test('default is normal and never auto-converts a production request to preview',t=>{
 const f=fixture(t);const result=inspect({artifact:f.opts.artifact});
 assert.equal(result.mode,'normal');assert.equal(result.handoffAllowed,false);
 assert.ok(result.errors.includes('SHARED_LEDGER_READBACK_MISSING'));
});
test('known 41-60 failure shape is detected before any delivery label',t=>{
 const f=fixture(t,'「ペっつに|he 二十入キ+ロ あれ:::」');
 const r=inspect({...f.opts,mode:'audit'});
 assert.equal(r.handoffAllowed,false);assert.ok(r.ocrAnomalyCount>=3);
 assert.ok(r.ocrAnomalyKinds.ocr_pipe>0);
 assert.ok(r.ocrAnomalyKinds.latin_fragment>0);
 assert.ok(r.errors.includes('AUDIT_ONLY_NEVER_AUTHORISES_DELIVERY'));
});
test('wrong source image and independently pinned ZIP block delivery',t=>{
 const f=fixture(t);
 const proof=JSON.parse(fs.readFileSync(f.sourceProof));
 proof.rangeImages[0].sha256='0'.repeat(64);f.write('source.json',proof);
 const r=inspect({...f.opts,mode:'normal'}, {validate:f.fakeValidate});
 assert.ok(r.errors.includes('SOURCE_IMAGES_DO_NOT_MATCH_PRIOR_ZIP'));
 assert.equal(r.handoffAllowed,false);
});
test('ledger SHA mismatch cannot be repaired by the caller choosing an old file',t=>{
 const f=fixture(t);const l=JSON.parse(fs.readFileSync(f.ledger));l.books[0].artifactSha256='0'.repeat(64);
 f.write('ledger.json',l);const r=inspect({...f.opts,mode:'normal'}, {validate:f.fakeValidate});
 assert.ok(r.errors.includes('LEDGER_ARTIFACT_OR_SOURCE_VERSION_MISMATCH'));
 assert.equal(r.handoffAllowed,false);
});
test('known unresolved defect cannot be silently relabelled as an unverified build',t=>{
 const f=fixture(t);const l=JSON.parse(fs.readFileSync(f.ledger));
 l.books[0].knownDefects=[{id:'text-041',status:'needs_source_review'}];f.write('ledger.json',l);
 const r=inspect({...f.opts,mode:'normal'}, {validate:f.fakeValidate});
 assert.ok(r.errors.includes('UNRESOLVED_KNOWN_DEFECT_IN_LEDGER'));
});
test('unverified OCR anomaly always blocks normal handoff even when 60 mock flags say passed',t=>{
 const f=fixture(t,'「ベべらべ|Ihe!?:::」');
 const r=inspect({...f.opts,mode:'normal'}, {validate:f.fakeValidate});
 assert.ok(r.errors.includes('OCR_ANOMALY_REVIEW_MISSING'));
 assert.equal(r.handoffAllowed,false);
});
test('preview cannot be inferred from an ordinary make-the-book request',t=>{
 const f=fixture(t,'未校正の本文|he');
 const r=inspect({...f.opts,mode:'preview',previewConsent:undefined},{validate:f.fakeValidate});
 assert.ok(r.errors.includes('USER_EXPLICIT_UNCORRECTED_PREVIEW_CONSENT_REQUIRED'));
 assert.equal(r.handoffAllowed,false);
});
test('explicit preview with pinned manifest remains PREVIEW ONLY, never normal/complete',t=>{
 const f=fixture(t,'英単語 Hello は原本の一部です。');
 const r=inspect({...f.opts,mode:'preview'},{validate:f.fakeValidate});
 assert.equal(r.status,'unverified_preview_only',JSON.stringify(r.errors));
 assert.equal(r.handoffAllowed,true);
 assert.equal(r.contentCertified,false);
 assert.equal(r.deviceVerified,false);
 assert.equal(r.publicHttpVerified,false);
 assert.ok(r.warnings.includes('PREVIEW_OCR_ANOMALIES_NOT_CERTIFIED'));
});
test('stale preview consent bound to another HTML cannot grant a preview',t=>{
 const f=fixture(t),c=JSON.parse(fs.readFileSync(f.consent));c.artifactSha256='0'.repeat(64);
 f.write('consent.json',c);
 const r=inspect({...f.opts,mode:'preview'},{validate:f.fakeValidate});
 assert.ok(r.errors.includes('USER_EXPLICIT_UNCORRECTED_PREVIEW_CONSENT_REQUIRED'));
});
test('normal handoff rejects missing canonical checks even with mock stage eligible',t=>{
 const f=fixture(t);
 const bad=(_,{phase})=>({eligible:true,errors:[],subjectSha256:'a'.repeat(64),
  subject:{bookId:f.book.bookId,artifactSha256:f.sha,loaderSha256:LOADER},
  checks:phase==='device'?{}:Object.fromEntries(RULES.map(x=>[x,{status:'passed'}]))});
 const r=inspect({...f.opts,mode:'normal'},{validate:bad});
 assert.ok(r.errors.includes('ALL_CANONICAL_60_EVIDENCE_NOT_COMPLETE'));
});
test('normal handoff never accepts HTTP evidence with wrong served bytes',t=>{
 const f=fixture(t),p=JSON.parse(fs.readFileSync(f.opts.publicEvidence));
 p.checks[0].observedSha256='0'.repeat(64);f.write('http.json',p);
 const r=inspect({...f.opts,mode:'normal'},{validate:f.fakeValidate});
 assert.equal(r.handoffAllowed,false);
 assert.ok(r.errors.includes('DEVICE_OR_PUBLIC_HTTP_COMPLETION_REQUIRED'));
});
test('a sealed mock of all prerequisites can permit normal, showing no arbitrary extra rule ID',t=>{
 const f=fixture(t);
 const r=inspect({...f.opts,mode:'normal'},{validate:f.fakeValidate});
 assert.equal(r.handoffAllowed,true,JSON.stringify(r.errors));
 assert.equal(r.status,'verified_release');
 assert.equal(r.canonical60Valid,true);
 assert.equal(r.deviceVerified,true);
 assert.equal(r.publicHttpVerified,true);
});
test('source-reviewed anomaly waivers must bind exact span, artifact, scan and source image',t=>{
 const f=fixture(t,'これは English|Example です。');
 const ann=findAnomalies(f.book);assert.ok(ann.length>=3);
 const review={schema:'reader-ocr-anomaly-review-v1',bookId:f.book.bookId,range:f.book.range,
  artifactSha256:f.sha,items:ann.map(a=>({id:a.id,sourceImageSha256:f.book.pages.find(p=>p.scan===a.sourceScan).sha256,
   spanSha256:a.spanSha256,decision:'source_confirmed',reviewedBy:'別検査者',reason:'原本写真の該当列に存在する記号を独立して確認済み',independentlyChecked:true}))};
 f.opts.ocrReview=f.write('ocr-review.json',review);
 const r=inspect({...f.opts,mode:'normal'},{validate:f.fakeValidate});
 assert.equal(r.ocrSourceConfirmed,ann.length);
 assert.equal(r.handoffAllowed,true,JSON.stringify(r.errors));
 review.items[0].spanSha256='0'.repeat(64);f.write('ocr-review.json',review);
 const denied=inspect({...f.opts,mode:'normal'},{validate:f.fakeValidate});
 assert.equal(denied.handoffAllowed,false);assert.ok(denied.errors.includes('UNRESOLVED_OCR_ANOMALIES'));
});
