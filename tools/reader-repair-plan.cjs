#!/usr/bin/env node
'use strict';
/*
 * Reader repair-cycle planner (read only).
 * Converts failed source/OCR/release evidence into FINITE next actions.
 * Never approves proofreading, releases, alters OCR/source, or writes the work ledger.
 * The canonical 60 checks and final delivery verifier remain authoritative.
 */
const fs=require('node:fs'),path=require('node:path');
const {validate}=require('./reader-work-ledger-validate.cjs');
const HEX=/^[a-f0-9]{64}$/;
const hashOK=x=>typeof x==='string'&&HEX.test(x);
const isObject=x=>x&&typeof x==='object'&&!Array.isArray(x);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function plan(ledger,bookId,progress=null){
 const errors=[],warnings=[];
 const validated=validate(ledger);
 if(validated.errors.length)errors.push('INVALID_SHARED_WORK_LEDGER');
 if(typeof bookId!=='string'||!/^[a-z0-9-]{5,150}$/.test(bookId))errors.push('INVALID_BOOK_ID');
 const matches=Array.isArray(ledger?.books)?ledger.books.filter(b=>b.bookId===bookId):[];
 if(matches.length!==1)errors.push(matches.length?'DUPLICATE_BOOK_ID':'BOOK_NOT_REGISTERED');
 if(errors.length)return{schema:'reader-repair-plan-v1',status:'blocked',bookId,
    releaseEligible:false,errors,warnings,tasks:[],nextAction:null};
 const book=matches[0],range=book.range,first=range[0],last=range[1];
 const draft=book.pendingDraft||null,draftSha=draft?.artifactSha256||book.artifactSha256;
 const pendingIsSeparate=!!draft&&hashOK(draftSha)&&draftSha!==book.artifactSha256;
 if(draft&&!pendingIsSeparate)errors.push('INVALID_PENDING_DRAFT_IDENTITY');
 const notReleased=book.releaseStatus==='blocked'&&book.qualityState==='unverified';
 if(!notReleased)warnings.push('VERSION_IS_NOT_RECORDED_AS_BLOCKED_UNVERIFIED');
 let progressOK=false;
 if(progress){
  progressOK=progress.schema==='reader-repair-progress-v1'&&
    progress.bookId===book.bookId&&same(progress.range,range)&&
    progress.artifactSha256===draftSha&&
    Array.isArray(progress.pages)&&Array.isArray(progress.boundaries);
  if(!progressOK)warnings.push('STALE_OR_INVALID_PRIVATE_REPAIR_PROGRESS_IGNORED');
 }else warnings.push('NO_PRIVATE_PAGE_LEVEL_REPAIR_PROGRESS');
 const data=progressOK?progress:{pages:[],boundaries:[]};
 const seenPages=new Set(),seenEdges=new Set(),pages=new Map(),edges=new Map();
 for(const p of data.pages){
  if(!isObject(p)||!Number.isSafeInteger(p.scan)||seenPages.has(p.scan)||p.scan<first||p.scan>last){
   warnings.push('DUPLICATE_OR_OUT_OF_RANGE_PRIVATE_PAGE_EVIDENCE_IGNORED');continue;
  }
  seenPages.add(p.scan);pages.set(p.scan,p);
 }
 for(const e of data.boundaries){
  const key=String(e?.left)+'>'+String(e?.right);
  if(!isObject(e)||!Number.isSafeInteger(e.left)||!Number.isSafeInteger(e.right)||
    e.right!==e.left+1||e.left<first-1||e.right>last+1||seenEdges.has(key)){
   warnings.push('INVALID_PRIVATE_BOUNDARY_EVIDENCE_IGNORED');continue;
  }
  seenEdges.add(key);edges.set(key,e);
 }
 const tasks=[],counts={
  scans:last-first+1,sourceImagesPreviouslyReported:draft?.sourceJPEGSHAverified||0,
  layoutConditionsPreviouslyReported:draft?.chromiumLayoutChecksPassed||0,
  independentPagePassesRecorded:0,comparedPagesRecorded:0,boundariesRecorded:0,
  unresolvedLedgerDefects:(book.knownDefects||[]).filter(d=>d.status!=='resolved').length
 };
 const make=(type,scan,reason,priority)=>({id:type+':'+String(scan),type,
   ...(typeof scan==='number'?{scan}:{edge:scan}),priority,reason,recorded:false});
 if(!pendingIsSeparate){
  tasks.push(make('produce_new_private_first_pass',first,'The old published artifact is not a new corrected draft.',0));
 }else{
  for(let scan=first;scan<=last;scan++){
   const p=pages.get(scan);
   const independent=!!p&&p.scan===scan&&p.firstRunId&&p.secondRunId&&
     p.firstRunId!==p.secondRunId&&p.secondSawFirstPass===false&&
     hashOK(p.sourceImageSha256)&&hashOK(p.firstTextSha256)&&hashOK(p.secondTextSha256);
   if(!independent){
    tasks.push(make('independently_retranscribe_original_scan',scan,
      'Read this original image independently; do not view or copy the first OCR/transcription.',10));
    continue;
   }
   counts.independentPagePassesRecorded++;
   const compared=p.comparison?.status==='resolved_against_source'&&
     hashOK(p.comparison.evidenceSha256)&&p.comparison.sourceImageSha256===p.sourceImageSha256&&
     typeof p.comparison.reviewedBy==='string'&&p.comparison.reviewedBy.length>=2;
   if(!compared)tasks.push(make('compare_and_resolve_text_differences',scan,
     'Compare independent transcription against the first pass and resolve every difference from the original, with evidence.',20));
   else counts.comparedPagesRecorded++;
  }
  for(let left=first-1;left<=last;left++){
   const key=left+'>'+(left+1),e=edges.get(key);
   const good=!!e&&e.status==='source_verified'&&
     hashOK(e.evidenceSha256)&&
     e.left===left&&e.right===left+1&&
     typeof e.reviewedBy==='string'&&e.reviewedBy.length>=2;
   if(!good)tasks.push(make('verify_original_page_boundary',key,
     'Check continuity of prose, notes, dialogue and figures across the two original scans; do not insert forced breaks.',30));
   else counts.boundariesRecorded++;
  }
  for(const issue of book.knownDefects||[]){
   if(issue.status==='resolved')continue;
   tasks.push(make('resolve_known_source_defect',issue.id,
     'Open source-backed findings and mark resolved only after corrected exact-artifact evidence; never silently downgrade to not_run.',40));
  }
  if(tasks.length===0){
   tasks.push(make('run_canonical_60_and_handoff_gate',String(first)+'-'+String(last),
    'With the exact revised HTML, run all existing sixty checks, original byte identity, rendering, Drive same-ID readback and real device verification; only a genuine positive verdict permits delivery.',50));
  }
 }
 tasks.sort((a,b)=>a.priority-b.priority||String(a.id).localeCompare(String(b.id)));
 const primary=tasks[0]||null;
 // Two independent tasks for each scan (blind pass + source-backed comparison),
 // one for each internal and external boundary, known-defect resolutions, and
 // the unchanged canonical release gate. Counts are progress indicators only.
 const allDefects=book.knownDefects||[];
 const totalProofTasks=(last-first+1)*2+(last-first+2)+allDefects.length+1;
 const completedProofTasks=counts.independentPagePassesRecorded+
  counts.comparedPagesRecorded+counts.boundariesRecorded+
  allDefects.filter(d=>d.status==='resolved').length;
 counts.totalProofTasks=totalProofTasks;
 counts.completedProofTasks=completedProofTasks;
 counts.remainingProofTasks=totalProofTasks-completedProofTasks;
 return{
  schema:'reader-repair-plan-v1',status:errors.length?'blocked':'work_ready',
  bookId,range,profile:book.profile,originalPublishedArtifactSha256:book.artifactSha256,
  workingDraftSha256:draftSha,workingDraftIsDistinctFromPublished:pendingIsSeparate,
  originalReaderStillBlocked:notReleased,releaseEligible:false,
  // These numbers are checkpoint claims, not independent proof.
  counts,tasks,remainingWorkItems:tasks.length,nextAction:primary,
  errors,warnings,
  note:'A repair plan is an actionable queue, not proof of independent source review. Never promote/release until the existing sixty-item and verified delivery gates pass.'};
}
function main(args){
 let bookId='',ledgerFile='reader/quality/work-ledger.json',progressFile=null,outFile=null;
 for(let i=0;i<args.length;i++){
  if(args[i]==='--book'){bookId=args[++i];}
  else if(args[i]==='--ledger'){ledgerFile=args[++i];}
  else if(args[i]==='--progress'){progressFile=args[++i];}
  else if(args[i]==='--output'){outFile=args[++i];}
  else throw Error('UNKNOWN_ARGUMENT '+args[i]);
 }
 if(!bookId)throw Error('Usage: node tools/reader-repair-plan.cjs --book BOOK_ID [--ledger CENTRAL.json] [--progress PRIVATE/progress.json] [--output PRIVATE/plan.json]');
 const ledger=JSON.parse(fs.readFileSync(ledgerFile,'utf8'));
 const progress=progressFile?JSON.parse(fs.readFileSync(progressFile,'utf8')):null;
 const report=plan(ledger,bookId,progress),data=JSON.stringify(report,null,2)+'\n';
 if(outFile){
  const f=path.resolve(outFile),repo=path.resolve(__dirname,'..');
  if(f===repo||f.startsWith(repo+path.sep))throw Error('PRIVATE_REPAIR_REPORT_MUST_BE_OUTSIDE_PUBLIC_REPO');
  fs.mkdirSync(path.dirname(f),{recursive:true});
  fs.writeFileSync(f,data,{flag:'wx',mode:0o600});
 }
 process.stdout.write(data);if(report.errors.length)process.exitCode=1;
}
if(require.main===module){try{main(process.argv.slice(2));}catch(e){console.error('REPAIR_PLAN_BLOCKED '+e.message);process.exitCode=2;}}
module.exports={plan};
