'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {audit,scopes}=require('../tools/reader-proof-batches.cjs');
const {spawnSync}=require('node:child_process');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=','base64');

function fixture(t,count=21) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'private-proof-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  function put(name,val) {
    const bytes=Buffer.isBuffer(val)?val:Buffer.from(typeof val==='string'?val:JSON.stringify(val));
    fs.writeFileSync(path.join(root,name),bytes);
    return {path:name,sha256:sha(bytes)};
  }
  const image=put('scan.png',pixel), capture=put('capture.png',pixel), bookId='private-test';
  const range=[1,count], artifact=put('candidate.html','<html>synthetic reader</html>');
  const inv={schema:'reader-proof-inventory-v1',bookId,range,pages:[]};
  const dom={schema:'reader-proof-readback-v1',bookId,range,artifactSha256:artifact.sha256,pages:[]};
  const evidence=[];
  for(let scan=1;scan<=count;scan++) {
    const common={scan,sourceSha256:image.sha256,completeScopes:[...scopes]};
    const region={id:'line',scope:'body',box:[0,0,1,1]};
    const value={text:'星17。'};
    const census={...common,reviewedBy:'area reviewer',edgesChecked:true,regions:[region]};
    const review={...common,reviewedBy:'independent transcription',blindToOutput:true,regions:[{id:'line',state:'matched',value}]};
    const actual={...common,capture,regions:[{id:'line',scope:'body',value:{...value}}]};
    evidence.push({census,review,actual});
    inv.pages.push({scan,image,census:put('census-'+scan,census),review:put('reading-'+scan,review)});
    dom.pages.push(actual);
  }
  function save(scan=0) {
    if(scan){const {census,review}=evidence[scan-1];
      inv.pages[scan-1].census=put('census-'+scan,census);inv.pages[scan-1].review=put('reading-'+scan,review);}
    inv.readback=put('readback.json',dom);return put('inventory.json',inv);
  }
  save();
  function report(){return audit({bookId,range,artifactSha256:artifact.sha256,inventoryFile:path.join(root,'inventory.json')});}
  return {root,range,bookId,artifact,inv,dom,evidence,put,save,report};
}

test('source-free preview can report all missing pages, full target fails with exit 2',t=>{
  const x=fixture(t,20);x.inv.pages=[];x.save();
  const args=[require.resolve('../tools/reader-proof-batches.cjs'),'--artifact',path.join(x.root,'candidate.html'),'--inventory',
    path.join(x.root,'inventory.json'),'--book-id',x.bookId,'--start','1','--end','20'];
  const partial=spawnSync(process.execPath,args);assert.equal(partial.status,0);
  assert.equal(JSON.parse(partial.stdout).pendingScans,20);
  assert.equal(spawnSync(process.execPath,[...args,'--require-complete']).status,2);
});

test('every requested scan in finite batches; completed caption and note scopes survive a pending body',t=>{
  const x=fixture(t), before=x.report();
  assert.equal(before.status,'complete');assert.equal(before.matchedRegions,21);
  x.dom.pages[0].regions[0].value.text='星。';x.save();
  const r=x.report();assert.equal(r.pendingScans,1);assert.equal(r.batches[1].status,'complete');
  assert.deepEqual(r.batches[0].scopeStatus.body.remainingScans,[1]);
  for(const scope of ['caption','note'])assert.equal(r.batches[0].scopeStatus[scope].status,'complete');
});

test('source proofs survive changed HTML: old render expires, fresh capture reopens only the changed region',t=>{
  const x=fixture(t);
  const sourceReceipts=x.inv.pages.map(p=>p.review.sha256);
  x.artifact.sha256=x.put('candidate.html','<html>changed output</html>').sha256;
  assert.equal(x.report().globalIssues[0],'STALE_OR_WRONG_READBACK');
  x.dom.artifactSha256=x.artifact.sha256;x.dom.pages[2].regions[0].value.text='星1717。';x.save();
  const r=x.report();assert.deepEqual(r.queue.map(p=>p.scan),[3]);assert.equal(r.matchedRegions,20);
  assert.deepEqual(x.inv.pages.map(p=>p.review.sha256),sourceReceipts);
  x.dom.pages[2].regions[0].value.text='星17。';x.save();
  assert.equal(x.report().status,'complete');
});

test('duplicates, surplus output, missing source regions and omitted scope attestations hold just their scans',t=>{
  const x=fixture(t);
  x.dom.pages[0].regions.push({...x.dom.pages[0].regions[0],id:'extra',scope:'note'});
  x.dom.pages[1].regions.push({...x.dom.pages[1].regions[0]});
  x.dom.pages[2].regions=[];
  x.evidence[3].review.completeScopes=scopes.filter(s=>s!=='caption');x.save(4);
  x.inv.pages.push({...x.inv.pages[4]});x.dom.pages.push({...x.dom.pages[5]});
  x.save();
  const r=x.report();assert.deepEqual(r.queue.map(p=>p.scan),[1,2,3,4,5,6]);
  assert.deepEqual(r.queue[3].pendingScopes,['caption']);assert.equal(r.batches[1].pendingScans,0);
});

test('one originally illegible region retained as original image crop and note; both source decisions required',t=>{
  const x=fixture(t,1), {census,review,actual}=x.evidence[0];
  const value={originalSha256:census.sourceSha256,box:[0,0,1,1],note:'汚損のため判読不能'};
  review.regions=[{id:'line',state:'illegible',reason:'汚損箇所を拡大して確認',value}];
  actual.regions[0].value=value;x.save(1);assert.equal(x.report().status,'partial');
  census.regions[0].illegible=true;x.save(1);assert.equal(x.report().status,'complete');
  actual.regions[0].value={...value,note:''};x.save();assert.equal(x.report().status,'partial');
});

test('partial reading and suppressed ornament need real evidence of the two adjacent anchors',t=>{
  const x=fixture(t,1), {census,review,actual}=x.evidence[0];
  census.regions[0].partial=true;
  const value={disposition:'source-only',before:'前。',after:'後。'};
  census.regions.push({id:'rule',scope:'other',box:[0,0,1,1]});
  review.regions.push({id:'rule',state:'corrected',value});
  actual.regions.push({id:'rule',scope:'other',value,observedWindow:'前。XXXXX後。'});
  x.save(1);let r=x.report();assert.equal(r.matchedRegions,1);assert.deepEqual(r.queue[0].pendingScopes,['body','other']);
  actual.regions[1].observedWindow='前。後。';x.save();r=x.report();
  assert.equal(r.matchedRegions,2);assert.equal(r.batches[0].scopeStatus.other.status,'complete');assert.equal(r.status,'partial');
});

test('ruby must be printed, painted on correct parent, and bound to its codepoint offsets',t=>{
  const x=fixture(t,1),{census,review,actual}=x.evidence[0];
  census.regions.push({id:'ruby',scope:'ruby',box:[0,0,1,1]});
  const value={parent:'line',start:0,end:1,base:'星',reading:'ほし'};
  review.regions.push({id:'ruby',state:'matched',value});actual.regions.push({id:'ruby',scope:'ruby',value});
  x.save(1);assert.equal(x.report().status,'complete');actual.regions[1].value={...value,start:1,end:2};x.save();
  assert.equal(x.report().pendingScans,1);review.regions[1].value=actual.regions[1].value;x.save(1);
  assert.equal(x.report().queue[0].issues[0].reason,'RUBY_PARENT_OR_RANGE_DIFFERS');
});

test('changed or missing original evidence/file hash holds only its page',t=>{
  const x=fixture(t);
  x.inv.pages[6].image=x.put('not-source','copied words');x.save();
  let r=x.report();assert.deepEqual(r.queue.map(p=>p.scan),[7]);
  x.inv.pages[6].image=x.inv.pages[5].image;x.dom.pages[9].capture={path:'missing.png',sha256:'a'.repeat(64)};x.save();
  r=x.report();assert.deepEqual(r.queue.map(p=>p.scan),[10]);
});

test('a second untranscribed scope and misplaced heading never borrow the body pass',t=>{
  const x=fixture(t,1),{census,review,actual}=x.evidence[0];
  census.regions.push({id:'h',scope:'heading',box:[0,0,1,1]},{id:'cap',scope:'caption',box:[0,0,1,1]});
  review.regions.push({id:'h',state:'matched',value:{text:'序',startsPage:true}},{id:'cap',state:'matched',value:{text:'解説'}});
  actual.regions.push({id:'h',scope:'heading',value:{text:'序',startsPage:false}},{id:'cap',scope:'caption',value:{text:''}});
  x.save(1);const r=x.report();assert.equal(r.matchedRegions,1);
  assert.deepEqual(r.queue[0].pendingScopes,['heading','caption']);
});

test('native original mode: retain source coordinates and private note, require actual original and no guessed text',t=>{
  const x=fixture(t,1), {census,review,actual}=x.evidence[0];
  const imageSha256=census.sourceSha256, box=[0,0,1,1], note='汚損による原本判読不能';
  const anchors={kind:'source-only',before:'星。',after:'次の行。'};
  census.regions[0].illegible=true;
  review.regions=[{id:'line',state:'illegible',reason:'同じ原本箇所を拡大して再読',value:{originalSha256:imageSha256,box,note},
    legibilityDisplay:anchors}];
  const stored={id:'line',scope:'body',value:{originalSha256:imageSha256,box},
    originalObservation:{mode:'reader-original',scan:1,imageSha256,box,dimensions:[1,1],screenBox:[0,0,1,1],capture:actual.capture},
    legibilityDisplay:{...anchors,observedWindow:anchors.before+anchors.after}};
  actual.regions=[stored];x.save(1);
  assert.equal(x.report().status,'complete');
  const failures=[
    {legibilityDisplay:{...anchors,observedWindow:'星。推測字次の行。'}},
    {legibilityDisplay:{...anchors,before:'別',observedWindow:'別次の行。'}},
    {originalObservation:{...stored.originalObservation,scan:2}},
    {originalObservation:{...stored.originalObservation,imageSha256:'a'.repeat(64)}},
    {originalObservation:{...stored.originalObservation,box:[0,0,2,1]}},
    {originalObservation:{...stored.originalObservation,dimensions:[2,2]}},
    {originalObservation:{...stored.originalObservation,capture:null}},
    {originalObservation:{...stored.originalObservation,screenBox:[3,3,4,4]}},
    {legibilityDisplay:{kind:'note',text:'別の注記'}}
  ];
  for(const change of failures){actual.regions=[{...stored,...change}];x.save();assert.equal(x.report().status,'partial');}
  actual.regions=[{...stored,legibilityDisplay:{kind:'note',text:note}}];x.save();
  assert.equal(x.report().status,'complete');
  delete review.regions[0].reason;x.save(1);assert.equal(x.report().status,'partial');
});

test('an independently-starting heading cannot be redefined as mid-page by both the reader and a copied review',t=>{
  const x=fixture(t,1),{census,review,actual}=x.evidence[0];
  census.regions[0].scope='heading';const value={text:'序',startsPage:false};
  review.regions[0].value=value;actual.regions[0]={id:'line',scope:'heading',value};x.save(1);
  assert.equal(x.report().status,'partial');
  census.regions[0].placement='inline';x.save(1);assert.equal(x.report().status,'partial');
  census.regions[0].placementReason='原本の段落内小見出しと採用書式を照合';x.save(1);assert.equal(x.report().status,'complete');
});
