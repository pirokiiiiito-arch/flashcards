'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const v=require('../tools/reader-release-control.cjs');
const g=require('../tools/reader-unified-delivery-gate.cjs');
const {ID}=require('../tools/reader-quality-gate.cjs');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
function file(dir,name,obj){
 const f=path.join(dir,name);
 fs.mkdirSync(path.dirname(f),{recursive:true});
 const data=typeof obj==='string'?obj:JSON.stringify(obj,null,2)+'\n';
 fs.writeFileSync(f,data);return {path:name,sha256:v.hash(data)};
}
function fixture(t,badOCR='原本を照合してから公開する。'){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'unified-reader-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const image='data:image/png;base64,'+png;
 const page={scan:1,reading_text:badOCR,original:image,sha256:v.hash(Buffer.from(png,'base64'))};
 const pages=[page],renderer='<html><head></head><body><script id="bookdata" type="application/json">{{READER_DATA}}</script></body></html>';
 const m={schema:'reader-private-bundle-v2',bookId:'synthetic-reader',standardFileId:ID,range:[1,1],
  loaderSha256:v.hash('synthetic-public-loader'),firstPassId:'run-1'};
 m.raw=file(dir,'raw.json',pages);m.canonical=file(dir,'canonical.json',pages);
 m.originalIndex=file(dir,'index.json',{'1':page.sha256});
 m.template=file(dir,'template.html',renderer);m.corrections=file(dir,'events.json',[]);
 m.profile=file(dir,'profile.json',{templateSha256:m.template.sha256,defaultFontPx:20,
  lineHeight:1.5,digitOrientation:'preserve-approved',gesture:'up-next-down-prev-one-step-native-zoom'});
 m.lock=file(dir,'lock.json',{schema:'reader-input-lock-v2',raw:m.raw.sha256,originalIndex:m.originalIndex.sha256,
  template:m.template.sha256,profile:m.profile.sha256});
 const html=renderer.replace('{{READER_DATA}}',JSON.stringify(pages));
 m.artifact=file(dir,'candidate.html',html);
 m.previewAuthorization=file(dir,'preview-authorization.json',{explicit:true,requestedBy:'synthetic-user',
  requestText:'校正前の確認用プレビューを明示的に希望します',at:'2026-11-18T00:00:00Z',
  artifactSha256:m.artifact.sha256});
 const manifest=file(dir,'manifest.json',m);
 const entry={bookId:m.bookId,range:m.range,profile:'novel',artifactSha256:m.artifact.sha256,
  originalIndexSha256:m.originalIndex.sha256,canonicalSha256:m.canonical.sha256,
  ledgerState:'active',
  quality:{status:'blocked',openFindings:[{id:'test',status:'unresolved'}],independentReviewSha256:null,
    anomalyResolutions:[]}};
 const ledger=file(dir,'central-ledger.json',{schema:'reader-central-quality-ledger-v1',revision:1,entries:[entry]});
 const consent={schema:'reader-unverified-preview-consent-v1',bookId:m.bookId,artifactSha256:m.artifact.sha256,
  userExplicitlyRequestedUnverifiedPreview:true,confirmedOCRMayContainErrors:true,
  allowedChannel:'preview',scope:'this-exact-artifact',
  literalUserRequest:'この未校正OCR一次稿を確認用プレビューとして表示してください',
  at:'2026-11-18T00:00:00Z',expiresAt:'2026-12-18T00:00:00Z'};
 const consentFile=file(dir,'consent.json',consent);
 return{dir,m,entry,manifest,ledger,consent,consentFile,
 opts:{manifest:path.join(dir,manifest.path),artifact:path.join(dir,m.artifact.path),
  ledger:path.join(dir,ledger.path),consentFile:path.join(dir,consentFile.path),channel:'preview',step:'stage'},
  updateLedger:()=>file(dir,ledger.path,{schema:'reader-central-quality-ledger-v1',revision:1,entries:[entry]})};
}
test('new source junk is flagged without silently modifying OCR or excluding legitimate spaced Latin',()=>{
 const fields={'41/body':'ペっつに|he。二十入キ+ロ。','42/body':'C. G. Jung と書かれている。'};
 const snapshot=JSON.stringify(fields),out=g.captureAlerts(fields,'novel');
 assert.ok(out.some(x=>x.kind==='vertical-pipe'));
 assert.ok(out.some(x=>x.kind==='ocr-plus-kana'));
 assert.ok(out.some(x=>x.kind==='latin-japanese-join'));
 assert.equal(out.some(x=>x.field==='42/body'),false,'separated Latin is not automatically an OCR error');
 assert.equal(JSON.stringify(fields),snapshot,'never auto-correct source');
 assert.equal(out.some(x=>Object.hasOwn(x,'text')),false,'private text never emitted');
});
test('ledger requires unique artifact SHA and range',()=>{
 const x={schema:'reader-central-quality-ledger-v1',revision:1,entries:[{bookId:'novel',range:[41,60],artifactSha256:'a'.repeat(64)}]};
 assert.equal(g.ledgerEntry(x,'novel',[41,60],'a'.repeat(64)).bookId,'novel');
 assert.throws(()=>g.ledgerEntry(x,'novel',[21,40],'a'.repeat(64)),/ARTIFACT_NOT_REGISTERED/);
 assert.throws(()=>g.ledgerEntry({...x,entries:x.entries.concat(x.entries)},'novel',[41,60],'a'.repeat(64)),/DUPLICATE_LEDGER_VERSION/);
});
test('unverified normal handoff fails closed even if a ledger claims a completed review',t=>{
 const x=fixture(t,'ペっつに|he。二十入キ+ロ。');
 x.entry.quality={status:'independently_verified',openFindings:[],independentReviewSha256:'a'.repeat(64),anomalyResolutions:[]};
 x.updateLedger();
 const r=g.inspect({...x.opts,channel:'production',step:'stage'});
 assert.equal(r.eligible,false);
 assert.ok(r.errors.includes('CANONICAL_SIXTY_PHASE_BLOCKED'),r.errors.join(','));
 assert.ok(r.errors.includes('SUSPECT_OCR_NOT_SOURCE_VERIFIED'),r.errors.join(','));
});
test('plain build request is not consent to unproofread preview',t=>{
 const x=fixture(t);
 for(const consent of [undefined,{...x.consent,literalUserRequest:'41-60作って'},
   {...x.consent,artifactSha256:'0'.repeat(64)}]){
  if(consent)file(x.dir,'consent.json',consent);
  const r=g.inspect({...x.opts,consentFile:consent?x.opts.consentFile:undefined});
  assert.equal(r.eligible,false);
  assert.ok(r.errors.some(e=>e.includes('PREVIEW_CONSENT')),r.errors.join(','));
 }
});
test('explicit unverified preview only clears preflight, not completion or delivery',t=>{
 const x=fixture(t);
 const r=g.inspect(x.opts);
 assert.equal(r.eligible,true,r.errors.join(','));
 assert.equal(r.status,'explicit_unverified_preview_only');
 assert.equal(r.completedDelivery,false);
 assert.equal(r.core60RequestedPhase,'preview');
 assert.equal(r.actualIPhoneCertified,false);
});
test('explicit preview delivery still blocks without exact Google Drive readback',t=>{
 const x=fixture(t);
 const r=g.inspect({...x.opts,step:'delivery'});
 assert.equal(r.eligible,false);
 assert.ok(r.errors.includes('DRIVE_SAME_ID_READBACK_REQUIRED'));
});
test('old artifact or different canonical revision is rejected',t=>{
 const x=fixture(t);
 x.entry.canonicalSha256='0'.repeat(64);x.updateLedger();
 const r=g.inspect(x.opts);
 assert.equal(r.eligible,false);
 assert.ok(r.errors.includes('CORRECTION_REVISION_MISMATCH'));
 const f=x.opts.artifact;fs.appendFileSync(f,'modified');
 const changed=g.inspect(x.opts);
 assert.ok(changed.errors.includes('ACTUAL_ARTIFACT_NOT_IN_MANIFEST')||changed.errors.includes('ARTIFACT_NOT_REGISTERED_IN_LEDGER'));
});
test('no ledger, no private proof and no direct ChatGPT attachment are normal delivery',()=>{
 const r=g.inspect({manifest:'/does/not/exist',artifact:'/does/not/exist',ledger:'/does/not/exist',channel:'production',step:'delivery'});
 assert.equal(r.eligible,false);assert.equal(r.completedDelivery,false);
});
test('legitimate OCR anomaly can be reviewed by exact alert identity, not a blanket whitelist',()=>{
 const alerts=g.captureAlerts({'1/body':'A|B'},'novel');
 const rec={quality:{status:'independently_verified',openFindings:[],independentReviewSha256:'a'.repeat(64),
  anomalyResolutions:alerts.map(a=>({id:a.id,decision:'source_confirmed',reviewedBy:'real-source-review',
   sourceRegionId:'region-1',sourceSha256:'f'.repeat(64),reason:'Checked against the original page'}))}};
 assert.deepEqual(g.validateLedgerReview(rec,alerts),[]);
 rec.quality.anomalyResolutions=[];
 assert.ok(g.validateLedgerReview(rec,alerts).includes('SUSPECT_OCR_NOT_SOURCE_VERIFIED'));
});
