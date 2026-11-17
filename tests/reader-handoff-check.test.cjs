'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {inspect,validateDateTime,urlMatchesEntry}=require('../tools/reader-handoff-check.cjs');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const ID='salinger-nine-stories-shibata-021-040';
const ENTRY='reader/nine-stories/021-040/index.html';
const URL='https://pirokiiiiito-arch.github.io/flashcards/reader/nine-stories/021-040/?import=1';
function fixture(t,modify=()=>{},{profile='novel'}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'reader-handoff-synthetic-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const pages=Array.from({length:20},(_,i)=>{
    const raw=Buffer.from('SYNTHETIC-FIXTURE-ONLY-'+i);
    return {scan:21+i,mimeType:'image/jpeg',dataUrl:'data:image/jpeg;base64,'+raw.toString('base64'),
      sha256:hash(raw),width:1,height:1};
  });
  const book={bookId:ID,title:'ナイン・ストーリーズ',range:[21,40],imageCount:20,pages,
    proofreading:{independentSecondPass:'not_run',iphoneDevice:'not_run'},state:'二次校正待ち'};
  modify(book);
  const html='<!doctype html><html><head><meta name="viewport" content="width=device-width">'+
    '<meta name="template-profile" content="'+profile+'">'+
    '<meta name="built-at" content="2026-11-17T20:18:44+09:00">'+
    '<script id="embedded-data" type="application/json">'+JSON.stringify(book)+'</script></head>'+
    '<body class="'+(profile==='novel'?'novel-reading':'reader')+'"><script>'+
    "'reader-ready-v8';'reader-position-v1';"+'</script></body></html>';
  const file=path.join(dir,'20261117_2018_ナイン・ストーリーズ_021-040_合成テスト.html');
  fs.writeFileSync(file,html);
  return{file,book,options:{start:21,end:40,bookId:ID,title:'ナイン・ストーリーズ',
    profile,chromeUrl:URL,loaderEntry:ENTRY}};
}
test('file timestamp uses a real calendar date and time',()=>{
  assert.equal(validateDateTime('20261117_2018_book.html'),true);
  for(const s of ['20261131_2018_book.html','20261117_2460_book.html','book.html'])
    assert.equal(validateDateTime(s),false);
});
test('ordinary synthetic preview checks structure without pretending to certify reading delivery',t=>{
  const x=fixture(t),r=inspect(x.file,{...x.options,expectedSha:hash(fs.readFileSync(x.file))});
  assert.equal(r.status,'structural_pass_only');
  assert.equal(r.originalImageCount,20);
  assert.equal(r.expectedShaMatched,true);
  assert.equal(r.externalSourceHashesChecked,false);
  assert.equal(r.releaseEligible,false);
  assert.equal(r.contentCertified,false);
  assert.equal(r.chromeImport,'not_run');
  assert.equal(r.iphoneDevice,'not_verified');
});
test('wrong book ID, page range, sequence or page count are all blocked',t=>{
  const x=fixture(t,b=>{b.bookId='wrong';b.range=[22,40];b.pages[4].scan=30;b.imageCount=19;});
  const r=inspect(x.file,x.options);
  for(const error of ['BOOK_ID_MISMATCH','EMBEDDED_RANGE_MISMATCH','SCAN_SEQUENCE_MISMATCH_25','IMAGE_COUNT_MISMATCH'])
    assert.ok(r.errors.includes(error),error);
});
test('both embedded byte integrity and external source comparison detect corruption',t=>{
  const x=fixture(t,b=>{b.pages[0].dataUrl='data:image/jpeg;base64,'+Buffer.from('tampered').toString('base64');});
  const bytes=fs.readFileSync(x.file),r=inspect(x.file,x.options);
  assert.ok(r.errors.includes('EMBEDDED_IMAGE_HASH_MISMATCH_21'));
  assert.deepEqual(bytes,fs.readFileSync(x.file));
  const y=fixture(t),images={};
  for(const p of y.book.pages)images[String(p.scan)]=p.sha256;
  images['21']='0'.repeat(64);
  const external=inspect(y.file,{...y.options,sourceManifest:{schema:'reader-source-hashes-v1',
    bookId:ID,range:[21,40],images}});
  assert.ok(external.errors.includes('SOURCE_IMAGE_HASH_MISMATCH_21'));
  assert.equal(external.embeddedOriginalHashesSelfConsistent,true);
});
test('history profile does not inherit novel-specific conditions',t=>{
  const x=fixture(t,()=>{},{profile:'world_history_1'}),r=inspect(x.file,x.options);
  assert.equal(r.status,'structural_pass_only',r.errors.join(','));
});
test('Chrome import URL is matched to explicit file and not hardcoded to Nine Stories',t=>{
  const x=fixture(t);
  assert.equal(urlMatchesEntry(URL,ENTRY),true);
  assert.equal(urlMatchesEntry('https://pirokiiiiito-arch.github.io/flashcards/'+ENTRY+'?import=1',ENTRY),true);
  assert.equal(urlMatchesEntry('https://example.com/flashcards/'+ENTRY+'?import=1',ENTRY),false);
  assert.ok(inspect(x.file,{...x.options,chromeUrl:'https://example.com/'}).errors.includes('CHROME_URL_NOT_LOADER_ENTRY'));
  assert.ok(inspect(x.file,{...x.options,loaderEntry:null}).errors.includes('EXPECTED_LOADER_ENTRY_REQUIRED'));
});
test('a forged self-declared proofreading PASS never becomes verified production',t=>{
  const x=fixture(t,b=>{b.proofreading.independentSecondPass='passed';b.proofreading.iphoneDevice='passed';});
  const r=inspect(x.file,{...x.options,mode:'production'});
  assert.equal(r.independentProofreading,'not_verified');
  assert.equal(r.iphoneDevice,'not_verified');
  assert.equal(r.releaseEligible,false);
  assert.equal(r.deliveredAndVerified,false);
});
test('missing file timestamp, mismatch with built-at and unpinned bytes are distinguished',t=>{
  const x=fixture(t),wrong=path.join(path.dirname(x.file),'20261117_2019_book_021-040.html');
  fs.renameSync(x.file,wrong);
  let r=inspect(wrong,{...x.options,expectedSha:'0'.repeat(64)});
  assert.ok(r.errors.includes('FILENAME_AND_BUILT_AT_MISMATCH'));
  assert.ok(r.errors.includes('ARTIFACT_SHA256_MISMATCH'));
  const other=path.join(path.dirname(x.file),'book_021-040.html');
  fs.renameSync(wrong,other);r=inspect(other,x.options);
  assert.ok(r.errors.includes('FILENAME_MISSING_VALID_YYYYMMDD_HHMM'));
});
