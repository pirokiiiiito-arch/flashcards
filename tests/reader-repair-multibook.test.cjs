'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const base=require('../reader/quality/work-ledger.json');
const {plan}=require('../tools/reader-repair-plan.cjs');
const {profilesFor}=require('../tools/reader-repair-profiles.cjs');
const sha=n=>n.toString(16).slice(-1).repeat(64);
const evidence=(s=sha(1))=>({status:'source_verified',sourceImageSha256:s,evidenceSha256:'a'.repeat(64),reviewedBy:'synthetic-reviewer'});
function create(profile,first=1,last=3){
 const bookId='synthetic-'+profile.replace(/_/g,'-')+'-'+first+'-'+last;
 const l=structuredClone(base);
 const original='b'.repeat(64),draft='c'.repeat(64);
 l.books.push({bookId,range:[first,last],profile,sourceArchiveSha256:'d'.repeat(64),
  artifactSha256:original,qualityState:'unverified',releaseStatus:'blocked',knownDefects:[],
  pendingDraft:{artifactSha256:draft,reviewStatus:'visual_first_pass_only',
   independentSecondPass:'not_run',realIPhone:'not_run',deliveryStatus:'private_staging_blocked',
   privateProgressReportSha256:'e'.repeat(64),sourceJPEGSHAverified:last-first+1,
   chromiumLayoutChecksPassed:0}});
 const progress={schema:'reader-repair-progress-v2',bookId,range:[first,last],profile,
  artifactSha256:draft,pages:[],boundaries:[],bridges:[]};
 for(let left=first-1;left<=last;left++){
  progress.boundaries.push({left,right:left+1,...evidence(),
   leftSourceSha256:left<first?'e'.repeat(64):sha(left),
   rightSourceSha256:left+1>last?'f'.repeat(64):sha(left+1)});
 }
 return{ledger:l,book:l.books.at(-1),progress,run:()=>plan(l,bookId,progress),sha,bookId};
}
function region(kind,scan,{independent=true,compared=true,imageChecked=true}={}){
 const source=sha(scan);
 const r={id:kind+'-'+scan,kind,box:[0,0,100,100],sourceImageSha256:source};
 if(['figure','photo','image','diagram','map','chart','illustration'].includes(kind)){
  if(imageChecked)r.imageReview={...evidence(source),originalBytesSha256:source};
 }else{
  if(independent)r.transcription={firstRunId:'first-'+scan,secondRunId:'second-'+scan,
   firstTextSha256:'1'.repeat(64),secondTextSha256:'2'.repeat(64),
   sourceImageSha256:source,secondSawFirstPass:false};
  if(compared)r.comparison={status:'resolved_against_source',evidenceSha256:'3'.repeat(64),
   sourceImageSha256:source,reviewedBy:'synthetic-reviewer'};
 }
 return r;
}
function page(scan,kinds,{inventory=true,regionOverrides={}}={}){
 const s=sha(scan),regions=kinds.map(k=>region(k,scan,regionOverrides[k]||{}));
 const p={scan,sourceImageSha256:s,regions,profileChecks:{}};
 if(inventory)p.inventory={...evidence(s),width:100,height:100,
  hasReadableText:kinds.some(k=>!['figure','photo','image','diagram','map','chart','illustration'].includes(k)),
  allRegionsInventoried:true};
 return p;
}
function proveProfile(p,profile){
 for(const check of profilesFor(profile,new Set(p.regions.map(r=>r.kind))))
  p.profileChecks[check]=evidence(p.sourceImageSha256);
 return p;
}
test('photo-only image book does not require fabricated OCR, any page count',()=>{
 const f=create('image',1,2);f.progress.pages=[page(1,['photo']),page(2,['photo'])];
 const r=f.run();
 assert.equal(r.status,'work_ready',r.errors.join(','));
 assert.equal(r.schema,'reader-repair-plan-v2');
 assert.equal(r.counts.textRegionsDiscovered,0);
 assert.equal(r.counts.nonTextRegionsDiscovered,2);
 assert.equal(r.counts.verifiedImageRegionsRecorded,2);
 assert.equal(r.counts.pageInventoriesRecorded,2);
 assert.equal(r.counts.boundariesRecorded,3);
 assert.equal(r.remainingWorkItems,1);
 assert.equal(r.nextAction.type,'run_canonical_60_and_handoff_gate');
 assert.equal(r.releaseEligible,false);
});
test('photo page with visible caption must independently transcribe the caption',()=>{
 const f=create('image',1,1);
 f.progress.pages=[page(1,['photo','caption'],{regionOverrides:{caption:{independent:false}}})];
 const r=f.run();assert.equal(r.counts.textRegionsDiscovered,1);
 assert.ok(r.tasks.some(t=>t.type==='independently_transcribe_text_region'&&t.scan==='1/caption-1'));
});
test('novel dialogue-column evidence is required only on dialogue regions',()=>{
 const f=create('novel',11,12);f.progress.pages=[page(11,['dialogue']),page(12,['body'])];
 let r=f.run();
 assert.ok(r.tasks.some(t=>t.type==='verify_novel_dialogue_column'&&t.scan===11));
 assert.equal(r.tasks.filter(t=>t.type==='verify_novel_dialogue_column').length,1);
 proveProfile(f.progress.pages[0],'novel');r=f.run();
 assert.equal(r.remainingWorkItems,1);assert.equal(r.counts.profileChecksRecorded,1);
});
test('history figures, captions, notes and non-adjacent 163->165 continuity have separate work',()=>{
 const f=create('world_history_1',163,165);
 f.progress.pages=[page(163,['body','note']),page(164,['figure','caption']),page(165,['body'])];
 f.progress.pages[0].nonAdjacentContinuation=[165];
 let r=f.run();
 assert.ok(r.tasks.some(t=>t.type==='verify_history_note_body_anchor'));
 assert.ok(r.tasks.some(t=>t.type==='verify_history_figure_caption_relation'));
 assert.ok(r.tasks.some(t=>t.type==='verify_nonadjacent_prose_continuity'&&t.scan==='163>165'));
 f.progress.pages.forEach(p=>proveProfile(p,'world_history_1'));
 f.progress.bridges=[{left:163,right:165,...evidence(),leftSourceSha256:sha(163),rightSourceSha256:sha(165)}];
 r=f.run();assert.equal(r.counts.bridgesRecorded,1);
 assert.equal(r.counts.profileChecksRecorded,2);assert.equal(r.remainingWorkItems,1);
});
test('mixed book links image plus label without novel or history rules',()=>{
 const f=create('mixed',41,41);f.progress.pages=[page(41,['figure','caption'])];
 let r=f.run();assert.ok(r.tasks.some(t=>t.type==='verify_mixed_image_text_association'));
 assert.ok(!r.tasks.some(t=>t.type.includes('history_')||t.type.includes('novel_')));
 proveProfile(f.progress.pages[0],'mixed');r=f.run();assert.equal(r.remainingWorkItems,1);
});
test('general text book checks TOC entries including numbering',()=>{
 const f=create('text',1,1);f.progress.pages=[page(1,['toc'])];
 let r=f.run();assert.ok(r.tasks.some(t=>t.type==='verify_text_toc_entry_number_relation'));
 proveProfile(f.progress.pages[0],'text');r=f.run();assert.equal(r.remainingWorkItems,1);
});
test('missing image page inventory asks for classification rather than OCR',()=>{
 const f=create('image',1,2);f.progress.pages=[page(1,['photo'])];
 const r=f.run();assert.ok(r.tasks.some(t=>t.type==='inventory_source_page_regions'&&t.scan===2));
 assert.ok(!r.tasks.some(t=>t.type==='independently_transcribe_text_region'&&String(t.scan).startsWith('2/')));
 assert.equal(r.counts.inventoriesComplete,false);assert.equal(r.counts.totalProofTasks,null);
});
test('page claiming no readable text despite a caption must be re-inventoried',()=>{
 const f=create('mixed',1,1),p=page(1,['photo','caption']);
 p.inventory.hasReadableText=false;f.progress.pages=[p];
 const r=f.run();assert.ok(r.tasks.some(t=>t.type==='reconcile_source_region_coverage'));
 assert.equal(r.counts.pageInventoriesRecorded,0);
});
test('unknown or out-of-range source region cannot be silently checked',()=>{
 const f=create('image',1,1),p=page(1,['photo']);
 p.regions[0].kind='unknown';f.progress.pages=[p];
 assert.ok(f.run().tasks.some(t=>t.type==='reconcile_source_region_coverage'));
 p.regions[0].kind='photo';p.regions[0].box=[0,0,200,100];
 assert.ok(f.run().tasks.some(t=>t.type==='reconcile_source_region_coverage'));
});
test('profile/SHA mismatch and duplicated scan block v2 evidence',()=>{
 const f=create('mixed',1,2);f.progress.pages=[page(1,['photo']),page(2,['photo'])];
 let p=structuredClone(f.progress);p.profile='novel';
 assert.ok(plan(f.ledger,f.bookId,p).errors.includes('V2_PROGRESS_IDENTITY_OR_PROFILE_MISMATCH'));
 p=structuredClone(f.progress);p.artifactSha256='0'.repeat(64);
 assert.equal(plan(f.ledger,f.bookId,p).status,'blocked');
 p=structuredClone(f.progress);p.pages.push(page(2,['photo']));
 assert.ok(plan(f.ledger,f.bookId,p).errors.includes('INVALID_OR_DUPLICATE_PAGE_IN_PRIVATE_PROGRESS'));
});
test('one and five page books do not assume twenty scans',()=>{
 const one=create('image',90,90);one.progress.pages=[page(90,['image'])];
 assert.equal(one.run().counts.boundariesRecorded,2);
 const five=create('image',1,5);five.progress.pages=[1,2,3,4,5].map(i=>page(i,['photo']));
 const r=five.run();assert.equal(r.counts.scans,5);assert.equal(r.counts.boundariesRecorded,6);
 assert.equal(r.remainingWorkItems,1);
});
test('non-adjacent prose with wrong source SHA remains unresolved',()=>{
 const f=create('world_history_1',163,165);
 f.progress.pages=[page(163,['body']),page(164,['figure']),page(165,['body'])];
 f.progress.pages[0].nonAdjacentContinuation=[165];
 f.progress.bridges=[{left:163,right:165,...evidence(),leftSourceSha256:'0'.repeat(64),rightSourceSha256:sha(165)}];
 assert.ok(f.run().tasks.some(t=>t.type==='verify_nonadjacent_prose_continuity'));
});
test('existing novel v1 queue is still compatible',()=>{
 const r=plan(base,'salinger-nine-stories-shibata-041-060');
 assert.equal(r.schema,'reader-repair-plan-v1');assert.equal(r.counts.scans,20);
 assert.equal(r.nextAction.type,'independently_retranscribe_original_scan');
});
