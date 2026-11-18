'use strict';
/*
 * Per-region v2 repair planner. PRIVATE metadata only. No original images or OCR
 * leave this module; no user-provided pass is authoritative for final release.
 * The unchanged sixty rule IDs remain the sole quality standard.
 */
const HEX=/^[0-9a-f]{64}$/;
const hash=s=>typeof s==='string'&&HEX.test(s);
const PROFILES=new Set(['novel','world_history_1','text','image','mixed']);
const TEXT=new Set(['body','dialogue','heading','toc','caption','note','boxed','image_label','figure_text','running_head','page_number']);
const IMAGE=new Set(['figure','photo','image','diagram','map','chart','illustration']);
const allKinds=new Set([...TEXT,...IMAGE]);
const isObj=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const validName=s=>typeof s==='string'&&/^[a-z0-9][a-z0-9-]{0,99}$/.test(s);
function validBox(box,width,height){
 return Array.isArray(box)&&box.length===4&&box.every(Number.isFinite)&&
 box[0]>=0&&box[1]>=0&&box[2]>box[0]&&box[3]>box[1]&&
 box[2]<=width&&box[3]<=height;
}
function passEvidence(x,sha){
 return isObj(x)&&x.status==='source_verified'&&hash(x.evidenceSha256)&&
 typeof x.reviewedBy==='string'&&x.reviewedBy.trim().length>=2&&
 (!sha||x.sourceImageSha256===sha);
}
function textSecond(x,sha){
 return isObj(x)&&x.firstRunId&&x.secondRunId&&x.firstRunId!==x.secondRunId&&
 x.secondSawFirstPass===false&&hash(x.firstTextSha256)&&hash(x.secondTextSha256)&&
 x.sourceImageSha256===sha;
}
function resolvedComparison(x,sha){
 return isObj(x)&&x.status==='resolved_against_source'&&hash(x.evidenceSha256)&&
 x.sourceImageSha256===sha&&typeof x.reviewedBy==='string'&&x.reviewedBy.trim().length>=2;
}
function task(type,scan,priority,detail){
 return {id:type+':'+String(scan),type,scan,priority,reason:detail,recorded:false};
}
function profilesFor(bookProfile,kinds){
 const required=new Set();
 if(bookProfile==='novel'){
  if(kinds.has('dialogue'))required.add('novel_dialogue_column');
  if(kinds.has('illustration'))required.add('novel_illustration_placement');
 }
 if(bookProfile==='world_history_1'){
  if(['figure','map','chart','diagram','caption'].some(k=>kinds.has(k)))required.add('history_figure_caption_relation');
  if(kinds.has('note'))required.add('history_note_body_anchor');
  if(kinds.has('toc'))required.add('history_toc_number_relation');
 }
 if(bookProfile==='mixed'){
  if([...IMAGE].some(k=>kinds.has(k))&&[...TEXT].some(k=>kinds.has(k)))required.add('mixed_image_text_association');
  if(kinds.has('note'))required.add('mixed_note_body_anchor');
 }
 if(bookProfile==='text'&&kinds.has('toc'))required.add('text_toc_entry_number_relation');
 return [...required];
}
function planRegions(book,progress){
 const errors=[],warnings=[],tasks=[],counts={
   scans:book.range[1]-book.range[0]+1,pageInventoriesRecorded:0,
   textRegionsDiscovered:0,nonTextRegionsDiscovered:0,
   independentTextRegionsRecorded:0,comparedTextRegionsRecorded:0,
   verifiedImageRegionsRecorded:0,profileChecksRequired:0,profileChecksRecorded:0,
   boundariesRecorded:0,bridgesRequired:0,bridgesRecorded:0
 };
 if(!PROFILES.has(book.profile))errors.push('UNKNOWN_BOOK_PROFILE');
 if(progress && (progress.schema!=='reader-repair-progress-v2'||progress.bookId!==book.bookId||
  !Array.isArray(progress.range)||progress.range.length!==2||progress.range[0]!==book.range[0]||
  progress.range[1]!==book.range[1]||progress.profile!==book.profile||
  progress.artifactSha256!==(book.pendingDraft?.artifactSha256||book.artifactSha256)))
  errors.push('V2_PROGRESS_IDENTITY_OR_PROFILE_MISMATCH');
 if(progress&&( !Array.isArray(progress.pages)||!Array.isArray(progress.boundaries)||
  (progress.bridges!==undefined&&!Array.isArray(progress.bridges))))
  errors.push('V2_PROGRESS_COLLECTIONS_INVALID');
 if(errors.length)return{errors,warnings,tasks:[],counts};
 const pages=new Map();
 for(const p of progress?.pages||[]){
  if(!isObj(p)||!Number.isSafeInteger(p.scan)||p.scan<book.range[0]||p.scan>book.range[1]||pages.has(p.scan)){
   errors.push('INVALID_OR_DUPLICATE_PAGE_IN_PRIVATE_PROGRESS');continue;
  }
  pages.set(p.scan,p);
 }
 const start=book.range[0],end=book.range[1],inventories=new Map(),needBridge=[];
 for(let scan=start;scan<=end;scan++){
  const page=pages.get(scan),inventory=page?.inventory;
  const complete=page&&hash(page.sourceImageSha256)&&isObj(inventory)&&
   inventory.status==='source_verified'&&inventory.sourceImageSha256===page.sourceImageSha256&&
   hash(inventory.evidenceSha256)&&typeof inventory.reviewedBy==='string'&&inventory.reviewedBy.length>=2&&
   Number.isSafeInteger(inventory.width)&&inventory.width>0&&
   Number.isSafeInteger(inventory.height)&&inventory.height>0&&
   typeof inventory.hasReadableText==='boolean'&&inventory.allRegionsInventoried===true&&
   Array.isArray(page.regions)&&page.regions.length>0;
  if(!complete){
   tasks.push(task('inventory_source_page_regions',scan,10,
    'Identify ALL text, figures, photos, labels, notes, headings, captions and page ornaments in the original image; record boxes and whether text is readable.'));
   continue;
  }
  const kinds=new Set(),seen=new Set();let valid=true;let textCount=0;
  for(const reg of page.regions){
   if(!isObj(reg)||!validName(reg.id)||seen.has(reg.id)||!allKinds.has(reg.kind)||
    reg.sourceImageSha256!==page.sourceImageSha256||
    !validBox(reg.box,inventory.width,inventory.height)){
    valid=false;break;
   }
   seen.add(reg.id);kinds.add(reg.kind);
   if(TEXT.has(reg.kind))textCount++;
  }
  if(inventory.hasReadableText!==(textCount>0))valid=false;
  if(!valid){
   tasks.push(task('reconcile_source_region_coverage',scan,11,
    'Source region types/boxes/text presence are inconsistent; re-inventory from original, never mark image-only by omission.'));
   continue;
  }
  inventories.set(scan,{page,inventory,kinds});
  counts.pageInventoriesRecorded++;
  if(book.profile==='image'&&textCount)warnings.push('IMAGE_PROFILE_CONTAINS_TEXT_REQUIRE_TRANSCRIPTION_'+scan);
  for(const reg of page.regions){
   const ref=scan+'/'+reg.id;
   if(TEXT.has(reg.kind)){
    counts.textRegionsDiscovered++;
    if(!textSecond(reg.transcription,page.sourceImageSha256)){
     tasks.push(task('independently_transcribe_text_region',ref,20,
      'Separately read original text without looking at the first pass; preserve column order and source box.'));
    }else{
     counts.independentTextRegionsRecorded++;
     if(!resolvedComparison(reg.comparison,page.sourceImageSha256))
      tasks.push(task('resolve_text_region_comparison',ref,30,
       'Compare the two transcripts against the exact source region, record differences and evidence.'));
     else counts.comparedTextRegionsRecorded++;
    }
   }else{
    counts.nonTextRegionsDiscovered++;
    if(!passEvidence(reg.imageReview,page.sourceImageSha256)||
      reg.imageReview.originalBytesSha256!==page.sourceImageSha256)
     tasks.push(task('verify_unchanged_original_image_region',ref,25,
      'Verify bytes of source image and the associated region without inventing text.'));
    else counts.verifiedImageRegionsRecorded++;
   }
  }
  const checks=profilesFor(book.profile,kinds);
  counts.profileChecksRequired+=checks.length;
  for(const check of checks){
   const proof=page.profileChecks?.[check];
   if(!passEvidence(proof,page.sourceImageSha256))
    tasks.push(task('verify_'+check,scan,35,
      'Check source-grounded layout/associations under profile '+book.profile+' only.'));
   else counts.profileChecksRecorded++;
  }
  if(page.nonAdjacentContinuation?.length){
   if(!Array.isArray(page.nonAdjacentContinuation)){errors.push('NON_ADJACENT_CONTINUATION_NOT_ARRAY');continue;}
   for(const right of page.nonAdjacentContinuation){
    if(!Number.isSafeInteger(right)||right<=scan+1||right>end){
     errors.push('INVALID_NON_ADJACENT_CONTINUATION');continue;
    }
    needBridge.push([scan,right]);
   }
  }
 }
 const boundarySet=new Map();
 for(const e of progress?.boundaries||[]){
  const key=e?.left+'>'+e?.right;
  if(!isObj(e)||!Number.isSafeInteger(e.left)||!Number.isSafeInteger(e.right)||
   e.right!==e.left+1||e.left<start-1||e.right>end+1||boundarySet.has(key)){
   errors.push('INVALID_OR_DUPLICATE_BOUNDARY');continue;
  }
  boundarySet.set(key,e);
 }
 for(let left=start-1;left<=end;left++){
  const key=left+'>'+(left+1),e=boundarySet.get(key);
  if(!passEvidence(e)||e.left!==left||e.right!==left+1){
   tasks.push(task('verify_original_page_boundary',key,40,
    'Verify prose continuity, captions, notes, or documented no-text boundary; do not invent text for image-only pages.'));
  }else counts.boundariesRecorded++;
 }
 const bridgeSet=new Map();
 for(const b of progress?.bridges||[]){
  const k=b?.left+'>'+b?.right;
  if(!isObj(b)||!Number.isSafeInteger(b.left)||!Number.isSafeInteger(b.right)||
    b.right<=b.left+1||bridgeSet.has(k)){errors.push('INVALID_NON_ADJACENT_BRIDGE');continue;}
  bridgeSet.set(k,b);
 }
 const needSet=new Set(needBridge.map(([a,b])=>a+'>'+b));
 counts.bridgesRequired=needSet.size;
 for(const key of needSet){
  const b=bridgeSet.get(key);
  if(!passEvidence(b)||b.left+'>'+b.right!==key)
   tasks.push(task('verify_nonadjacent_prose_continuity',key,45,
    'Check prose continuity across intervening figure/note scans and keep source associations.'));
  else counts.bridgesRecorded++;
 }
 if(errors.length)return{errors,warnings,tasks:[],counts};
 counts.inventoriesComplete=counts.pageInventoriesRecorded===counts.scans;
 counts.profile=book.profile;
 return{errors,warnings,tasks,counts};
}
module.exports={planRegions,profilesFor,TEXT,IMAGE,PROFILES};
