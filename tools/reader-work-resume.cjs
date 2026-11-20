#!/usr/bin/env node
'use strict';
/* Read-only join of the selected production workflow and private quality bundle.
 * Hash consistency is not review authentication, production admission or consent.
 * Nothing is selected by date, directory order, old public receipts or chat text.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {builtinModules}=require('node:module');
const HEX=/^[0-9a-f]{64}$/;
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const BUILTINS=new Set(builtinModules.flatMap(x=>[x,x.replace(/^node:/,''),'node:'+x.replace(/^node:/,'')]));

class ResumeError extends Error{
 constructor(code,detail){super(detail?code+': '+detail:code);this.code=code;this.detail=detail||null;}
}
function need(condition,code,detail){if(!condition)throw new ResumeError(code,detail);}
function noSymlinks(file){
 const absolute=path.resolve(file);
 let cursor=path.parse(absolute).root;
 for(const part of path.relative(cursor,absolute).split(path.sep).filter(Boolean)){
  cursor=path.join(cursor,part);
  need(fs.existsSync(cursor),'MISSING_PATH',cursor);
  need(!fs.lstatSync(cursor).isSymbolicLink(),'SYMLINK_NOT_ALLOWED',cursor);
 }
 return absolute;
}
function relative(value,label,{directory=false}={}){
 need(typeof value==='string'&&value.length>0&&!value.includes('\\')&&!value.includes('\0')&&
  !path.posix.isAbsolute(value)&&!path.win32.isAbsolute(value)&&
  !value.split('/').includes('..')&&path.posix.normalize(value)===value&&
  (directory||value!=='.'),'INVALID_RELATIVE_PATH',label);
 return value;
}
function within(root,value,label,options={}){
 const result=noSymlinks(path.resolve(root,relative(value,label,options)));
 const rel=path.relative(root,result);
 need(rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel)),
  'PATH_OUTSIDE_WORKSPACE',label);
 need(options.directory?fs.statSync(result).isDirectory():fs.statSync(result).isFile(),
  options.directory?'DIRECTORY_REQUIRED':'FILE_REQUIRED',label);
 return result;
}
function isHistoric(value){return value.split(/[\\/]/).some(x=>['retained','history','historical'].includes(x.toLowerCase()));}
function outside(root,file){const rel=path.relative(root,file);return rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel);}
function parseJson(bytes,label){try{return JSON.parse(bytes.toString('utf8'));}catch{throw new ResumeError('INVALID_JSON',label);}}
function snapshotFile(file,expected,label,tracked,bytesExpected){
 need(HEX.test(expected||''),'MISSING_FILE_PIN',label);
 noSymlinks(file);
 const bytes=fs.readFileSync(file);
 need(hash(bytes)===expected,'FILE_HASH_MISMATCH',label);
 if(bytesExpected!==undefined)need(Number.isSafeInteger(bytesExpected)&&bytesExpected===bytes.length,'FILE_SIZE_MISMATCH',label);
 tracked.set(file,expected);
 return bytes;
}
function refFile(root,ref,label,tracked){
 need(object(ref),'MISSING_FILE_REFERENCE',label);
 const file=within(root,ref.path,label);
 return {file,bytes:snapshotFile(file,ref.sha256,label,tracked,ref.bytes),sha256:ref.sha256};
}
function refJson(root,ref,label,tracked){const result=refFile(root,ref,label,tracked);return {...result,data:parseJson(result.bytes,label)};}
function manifestRefs(value,root,tracked,where='quality.manifest'){
 if(Array.isArray(value)){value.forEach((x,i)=>manifestRefs(x,root,tracked,where+'['+i+']'));return;}
 if(!object(value))return;
 if(own(value,'path')||own(value,'sha256')){
  // A literal digest by itself is metadata, not a fabricated file reference.
  if(own(value,'path'))refFile(root,value,where,tracked);
 }
 for(const [key,child]of Object.entries(value))if(object(child)||Array.isArray(child))manifestRefs(child,root,tracked,where+'.'+key);
}
function verifyToolchain(root,chain,tracked){
 need(object(chain)&&Array.isArray(chain.files)&&chain.files.length>0,'TOOLCHAIN_PINS_REQUIRED');
 const codeRoot=within(root,chain.root,'toolchain.root',{directory:true});
 need(noSymlinks(__filename)===within(codeRoot,'tools/reader-work-resume.cjs','resume implementation'),'WRONG_RESUME_IMPLEMENTATION_ROOT');
 const pins=new Map();
 for(const ref of chain.files){
  need(object(ref)&&!pins.has(ref.path),'DUPLICATE_TOOLCHAIN_PIN',ref?.path);
  const f=refFile(codeRoot,ref,'toolchain:'+ref.path,tracked);pins.set(ref.path,f);
 }
 const queue=['tools/reader-work-resume.cjs','tools/reader-repair-plan.cjs','tools/reader-quality-gate.cjs'];
 const visited=new Set();
 while(queue.length){
  const rel=queue.shift();if(visited.has(rel))continue;visited.add(rel);
  need(pins.has(rel),'UNPINNED_EXECUTABLE_DEPENDENCY',rel);
  const code=pins.get(rel).bytes.toString('utf8');
  for(const match of code.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)){
   const target=match[1];if(BUILTINS.has(target))continue;
   need(target.startsWith('./')||target.startsWith('../'),'UNSUPPORTED_EXECUTABLE_DEPENDENCY',target);
   const child=path.posix.normalize(path.posix.join(path.posix.dirname(rel),target));
   relative(child,'executable dependency');
   queue.push(child);
  }
 }
 need(pins.has('reader/quality/standard.json'),'QUALITY_STANDARD_PIN_REQUIRED');
 need(pins.has('reader/quality/work-catalog.json'),'WORK_CATALOG_PIN_REQUIRED');
 return {root:codeRoot,pins,dependencyCount:visited.size};
}
function python(program,args,label){
 const result=spawnSync('python3',['-B',program,...args],{
  encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024,
  env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONPATH:path.dirname(program)}
 });
 need(!result.error,'WORKFLOW_VERIFIER_EXECUTION_FAILED',label+': '+String(result.error?.message||''));
 let parsed;try{parsed=JSON.parse(result.stdout);}catch{parsed=null;}
 need(result.status===0,'WORKFLOW_VERIFIER_REJECTED',label+': '+String(parsed?.reason||result.stderr||result.stdout||result.signal).trim());
 need(object(parsed),'WORKFLOW_VERIFIER_INVALID_OUTPUT',label);
 return parsed;
}
function summarizeAssessment(assessment){
 if(!assessment)return {recordedChecks:0,recordedStates:{},certifiedByResume:false,assessmentSupplied:false};
 const rows=Array.isArray(assessment.checks)?assessment.checks:[];
 const states={};for(const row of rows){const state=row.status||row.state||'unrecorded';states[state]=(states[state]||0)+1;}
 return {recordedChecks:rows.length,recordedStates:states,certifiedByResume:false};
}
function queueSummary(plan){
 const tasks=Array.isArray(plan.tasks)?plan.tasks:[];
 if(plan.schema==='reader-repair-plan-v3')return {
  productionPending:tasks,
  readyTasks:plan.readyTasks||[],deferredTasks:plan.deferredTasks||[],
  externalWaiting:plan.waitingTasks||[],queues:plan.queues||{},
  nextAction:plan.nextAction||null,
  adoptionRequired:plan.adoptionRequired===true,
  noAutomaticRebuild:true
 };
 // Older planners do not distinguish all lanes. Keep their actual tasks;
 // do not guess a quality result or suppress an unresolved prerequisite.
 return {productionPending:tasks,readyTasks:tasks,deferredTasks:[],externalWaiting:plan.waitingTasks||[],
  queues:null,nextAction:plan.nextAction||null,noAutomaticRebuild:true,
  legacyLaneClassification:'not_recorded'};
}

function inspect(entryFile,{expectedEntrySha256,surface='work',requestFile}={}){
 const base={schema:'reader-work-resume-result-v1',status:'blocked',readOnly:true,
  stateChanged:false,artifactChanged:false,workStarted:false,
  productionAdmitted:false,qualityCertified:false,deliveryAuthorized:false,
  consentCreated:false,errors:[],warnings:[]};
 try{
  const {readRequestedScope,matchRequestedScope}=require('./reader-request-scope.cjs');
  const requestedScope=readRequestedScope(requestFile);
  need(['work','chat','other'].includes(surface),'INVALID_SURFACE');
  need(HEX.test(expectedEntrySha256||''),'EXPECTED_ENTRY_SHA_REQUIRED',
   'Supply the adopted entry SHA from the handoff/index, not by selecting the newest local file.');
  const tracked=new Map(),entryPath=noSymlinks(entryFile);
  const entry=parseJson(snapshotFile(entryPath,expectedEntrySha256,'entry',tracked),'entry');
  need(entry.schema==='reader-work-resume-v1'&&entry.purpose==='private_work_resume','INVALID_RESUME_SCHEMA');
  need(typeof entry.workspaceRoot==='string'&&!path.isAbsolute(entry.workspaceRoot)&&
   !path.win32.isAbsolute(entry.workspaceRoot)&&!entry.workspaceRoot.includes('\\')&&!entry.workspaceRoot.includes('\0'),
   'WORKSPACE_ROOT_MUST_BE_RELATIVE');
  const root=noSymlinks(path.resolve(path.dirname(entryPath),entry.workspaceRoot));
  need(fs.statSync(root).isDirectory(),'WORKSPACE_ROOT_MISSING');
  need(/^[a-z0-9-]{3,150}$/.test(entry.bookId||''),'INVALID_BOOK_ID');
  need(Array.isArray(entry.scanRange)&&entry.scanRange.length===2&&entry.scanRange.every(Number.isSafeInteger)&&
   entry.scanRange[0]>0&&entry.scanRange[0]<=entry.scanRange[1],'INVALID_SCAN_RANGE');
  matchRequestedScope(requestedScope,entry.bookId,entry.scanRange);
  const chain=verifyToolchain(root,entry.toolchain,tracked);
  need(outside(chain.root,entryPath),'PRIVATE_ENTRY_INSIDE_PUBLIC_REPOSITORY');
  if(process.env.READER_AUDIT_ROOT)need(path.resolve(process.env.READER_AUDIT_ROOT)===chain.root,'AUDIT_ROOT_OVERRIDE_MISMATCH');
  need(object(entry.workflow)&&object(entry.quality),'MISSING_WORKFLOW_OR_QUALITY_CONTEXT');
  const wf=entry.workflow,quality=entry.quality;
  need(!isHistoric(wf.root)&&!isHistoric(wf.selection?.path||'')&&!isHistoric(wf.state?.path||'')&&
   !isHistoric(wf.handoff?.path||''),'HISTORICAL_STATE_CANNOT_BE_SELECTED');
  const wfRoot=within(root,wf.root,'workflow.root',{directory:true});
  need(outside(chain.root,wfRoot),'PRIVATE_WORKFLOW_INSIDE_PUBLIC_REPOSITORY');
  const selected=refJson(wfRoot,wf.selection,'workflow.selection',tracked);
  const state=refJson(wfRoot,wf.state,'workflow.state',tracked);
  const handoff=refJson(wfRoot,wf.handoff,'workflow.handoff',tracked);
  need(object(handoff.data.binding)&&object(handoff.data.binding.artifacts)&&
   Array.isArray(handoff.data.binding.evidence_files),'HANDOFF_DEPENDENCIES_MISSING');
  for(const [key,ref]of Object.entries(handoff.data.binding.artifacts))refFile(wfRoot,ref,'handoff.artifacts:'+key,tracked);
  for(const ref of handoff.data.binding.evidence_files)refFile(wfRoot,ref,'handoff.evidence:'+ref.purpose,tracked);
  need(selected.data.schema==='selected-workflow-state-v1'&&selected.data.quality_certified===false,
   'INVALID_WORKFLOW_SELECTION');
  need(selected.data.path===wf.state.path&&selected.data.sha256===wf.state.sha256&&
   selected.data.handoff_path===wf.handoff.path,'SELECTED_WORKFLOW_MISMATCH');
  need(state.data.schema==='reader-workflow-state-v9'&&state.data.operation==='reader_production'&&
   state.data.book_id===entry.bookId,'WORKFLOW_BOOK_MISMATCH');
  if(state.data.scan_range!==undefined)need(same(state.data.scan_range,entry.scanRange),'WORKFLOW_RANGE_MISMATCH');
  need(object(wf.runtime),'RUNTIME_REFERENCE_REQUIRED');
  const runtime=within(root,wf.runtime.root,'workflow.runtime.root',{directory:true});
  const active=refJson(runtime,wf.runtime.activeRelease,'runtime.active_release',tracked);
  need(wf.runtime.activeRelease.path==='active_release.json'&&object(active.data.sha256)&&
   active.data.locked_items===Object.keys(active.data.sha256).length,'INVALID_ACTIVE_RELEASE');
  need(active.data.release_id===wf.runtime.releaseId&&active.data.rule_sha256===wf.runtime.ruleSha256,
   'RUNTIME_RULE_OR_RELEASE_MISMATCH');
  for(const required of ['workflow_handoff.py','workflow_run_guard.py','verify_active_release.py','rules_registry.json'])
   need(own(active.data.sha256,required),'RUNTIME_VERIFIER_NOT_REGISTERED',required);
  for(const [rel,sha256]of Object.entries(active.data.sha256))refFile(runtime,{path:rel,sha256},'runtime:'+rel,tracked);
  need(state.data.operating_release?.release_id===wf.runtime.releaseId&&
   state.data.operating_release?.rule_sha256===wf.runtime.ruleSha256&&
   state.data.operating_release?.active_release_sha256===wf.runtime.activeRelease.sha256,
   'WORKFLOW_RUNTIME_BINDING_MISMATCH');
  const registry=parseJson(fs.readFileSync(within(runtime,'rules_registry.json','runtime.rules_registry')),'runtime.rules_registry');
  const standard=parseJson(chain.pins.get('reader/quality/standard.json').bytes,'quality.standard');
  need(Array.isArray(registry.ids_ordered)&&registry.ids_ordered.length===60&&new Set(registry.ids_ordered).size===60&&
   same(registry.ids_ordered,standard.checkIds),'COMMON_SIXTY_ID_MISMATCH');
  const artifact=refFile(root,entry.adoptedArtifact,'adoptedArtifact',tracked);
  need(outside(chain.root,artifact.file),'PRIVATE_ARTIFACT_INSIDE_PUBLIC_REPOSITORY');
  const frozen=state.data.freeze?.artifacts?.[wf.artifactId];
  need(object(frozen)&&['html','reader_html'].includes(frozen.role)&&frozen.sha256===artifact.sha256&&
   within(wfRoot,frozen.path,'workflow frozen HTML')===artifact.file,'WORKFLOW_ADOPTED_ARTIFACT_MISMATCH');
  const qualityRoot=within(root,quality.root,'quality.root',{directory:true});
  need(outside(chain.root,qualityRoot),'PRIVATE_QUALITY_INSIDE_PUBLIC_REPOSITORY');
  need(!isHistoric(quality.root)&&!isHistoric(quality.manifest?.path||'')&&!isHistoric(quality.ledger?.path||''),
   'HISTORICAL_QUALITY_STATE_CANNOT_BE_SELECTED');
  const manifest=refJson(qualityRoot,quality.manifest,'quality.manifest',tracked);
  const ledger=refJson(qualityRoot,quality.ledger,'quality.ledger',tracked);
  need(manifest.data.schema==='reader-private-bundle-v2'&&manifest.data.bookId===entry.bookId&&
   same(manifest.data.range,entry.scanRange),'QUALITY_MANIFEST_IDENTITY_MISMATCH');
  need(manifest.data.standardFileId===standard.canonicalGoogleDriveFileId&&quality.ruleset===ledger.data.ruleset,
   'QUALITY_RULESET_MISMATCH');
  const books=Array.isArray(ledger.data.books)?ledger.data.books.filter(x=>x.bookId===entry.bookId):[];
  need(books.length===1,'QUALITY_LEDGER_BOOK_NOT_UNIQUE');const book=books[0];
  need(same(book.range,entry.scanRange)&&book.profile===entry.profile,'QUALITY_LEDGER_RANGE_OR_PROFILE_MISMATCH');
  need(!(book.pendingDraft&&book.currentWork),'MULTIPLE_ACTIVE_WORK_IDENTITIES');
  const workingSha=book.pendingDraft?.artifactSha256||book.currentWork?.artifactSha256||book.artifactSha256;
  need(workingSha===artifact.sha256&&manifest.data.artifact?.sha256===artifact.sha256,'QUALITY_ADOPTED_ARTIFACT_MISMATCH');
  manifestRefs(manifest.data,qualityRoot,tracked);
  if(manifest.data.profile){
   const profile=refJson(qualityRoot,manifest.data.profile,'quality.profile',tracked).data;
   if(profile.templateProfile!==undefined)need(profile.templateProfile===entry.profile,'QUALITY_MANIFEST_PROFILE_MISMATCH');
  }
  let assessment=null;
  if(quality.assessment||manifest.data.assessment){
   assessment=refJson(qualityRoot,quality.assessment,'quality.assessment',tracked);
   need(quality.assessment.path===manifest.data.assessment?.path&&
    quality.assessment.sha256===manifest.data.assessment?.sha256,'QUALITY_ASSESSMENT_BINDING_MISMATCH');
   if(assessment.data.schema==='private-quality-assessment-60-v1')need(
    assessment.data.scope?.bookId===entry.bookId&&same(assessment.data.scope?.sourceRange,entry.scanRange)&&
    assessment.data.scope?.templateProfile===entry.profile&&assessment.data.artifact?.sha256===artifact.sha256,
    'QUALITY_ASSESSMENT_IDENTITY_MISMATCH');
   if(assessment.data.schema==='private-quality-assessment-60-v1')need(
    Array.isArray(assessment.data.checks)&&same(assessment.data.checks.map(x=>x.id),standard.checkIds),
    'QUALITY_ASSESSMENT_SIXTY_MISMATCH');
  }
  let progress=null;
  if(quality.progress){
   progress=refJson(qualityRoot,quality.progress,'quality.progress',tracked).data;
   need(progress.bookId===entry.bookId&&same(progress.range,entry.scanRange)&&progress.artifactSha256===artifact.sha256,
    'STALE_REPAIR_PROGRESS');
  }
  const activeResult=python(within(runtime,'verify_active_release.py','active verifier'),[],'verify_active_release');
  need(activeResult.status==='passed'&&activeResult.active_release===wf.runtime.releaseId&&
   activeResult.rule_sha256===wf.runtime.ruleSha256&&activeResult.check_count===60,'ACTIVE_RELEASE_CHECK_FAILED');
  const handoffResult=python(within(runtime,'workflow_handoff.py','handoff verifier'),[
   'check','--workflow-state',state.file,'--workflow-root',wfRoot,'--program-root',runtime,
   '--handoff',handoff.file,'--expected-workflow-state-sha256',wf.state.sha256,'--to-surface',surface
  ],'workflow_handoff.check');
  need(handoffResult.status==='handoff_consistent'&&handoffResult.workflow_state_sha256===wf.state.sha256&&
   handoffResult.book_id===entry.bookId&&handoffResult.state_changed===false&&
   handoffResult.production_admitted===false&&handoffResult.quality_certified===false,'HANDOFF_CHECK_FAILED');
  // Reload only the pinned local dependency tree; no connector, child task or write.
  for(const ref of chain.pins.values())if(ref.file.endsWith('.cjs'))delete require.cache[ref.file];
  const legacy=require('./reader-quality-gate.cjs');
  need(same(legacy.RULES,standard.checkIds),'EXECUTABLE_SIXTY_ID_MISMATCH');
  const {plan}=require('./reader-repair-plan.cjs');
  const repair=plan(ledger.data,entry.bookId,progress,{manifestFile:manifest.file});
  need(object(repair)&&Array.isArray(repair.errors)&&repair.errors.length===0&&
   ['work_ready','waiting'].includes(repair.status),'REPAIR_PLANNER_BLOCKED',JSON.stringify(repair.errors||[]));
  need(repair.workingDraftSha256===artifact.sha256&&repair.releaseEligible===false,'REPAIR_PLANNER_ARTIFACT_MISMATCH');
  if(manifest.data.scopedReview)need(repair.schema==='reader-repair-plan-v3','SCOPED_REVIEW_PLANNER_REQUIRED');
  if(repair.schema==='reader-repair-plan-v3')need(repair.manifestSha256===manifest.sha256,'REPAIR_MANIFEST_MISMATCH');
  const requiredFiles=[...tracked].map(([file,sha256])=>({
   path:path.relative(root,file).split(path.sep).join('/'),sha256,bytes:fs.statSync(file).size,
   storage:outside(chain.root,file)?'private':'public_repository'
  })).sort((a,b)=>a.path.localeCompare(b.path));
  for(const [file,sha256]of tracked)need(hash(fs.readFileSync(file))===sha256,'INPUT_CHANGED_DURING_RESUME',path.relative(root,file));
  const queues=queueSummary(repair);
  return {...base,status:'resume_consistent',entrySha256:expectedEntrySha256,bookId:entry.bookId,
   scanRange:entry.scanRange,profile:entry.profile,surface,requestedScope,
   adoptedArtifact:{path:entry.adoptedArtifact.path,sha256:artifact.sha256,bytes:artifact.bytes.length},
   workflow:{phase:handoffResult.phase,blocked:handoffResult.blocked||null,
    stateSha256:wf.state.sha256,activeReleaseId:wf.runtime.releaseId,ruleSha256:wf.runtime.ruleSha256,
    handoffStatus:handoffResult.status,productionAdmissionGate:handoffResult.next_gate},
   quality:{manifestSha256:manifest.sha256,ledgerSha256:ledger.sha256,assessmentSha256:assessment?.sha256||null,
    ruleset:quality.ruleset,standardSha256:chain.pins.get('reader/quality/standard.json').sha256,
    assessmentSummary:summarizeAssessment(assessment?.data),recordedDeliveryState:manifest.data.deliveryState||null},
   restoreRequirements:{requiredFiles,qualityWorkspace:{path:quality.root,mode:'restore_complete_bundle',
    reason:'Nested source/review records remain private. Restore the entire quality workspace, then verify this selected entry again.'},
    publicRepositoryCode:'Restore exact repository bytes listed in toolchain; do not put repository code into the private archive.',
    selectionPolicy:'Only this entry selects current state; retained/history files are evidence, never fallback entry points.'},
   ...queues,repairPlan:repair,
   checks:{selectedWorkflow:true,activeRelease:true,formalHandoff:true,commonSixtyIds:true,
    adoptedArtifactBothSides:true,toolDependenciesPinned:chain.dependencyCount,filesRechecked:tracked.size},
   warnings:[...new Set([...base.warnings,...(repair.warnings||[]),
    'Consistency is not authenticated review. Existing production and delivery gates remain mandatory.'])]};
 }catch(error){
  return {...base,errors:[{code:error.code||'RESUME_INSPECTION_FAILED',detail:error.detail||error.message}],
   nextAction:null,productionPending:[],readyTasks:[],deferredTasks:[],externalWaiting:[]};
 }
}
function main(args){
 const options={};let entryFile=null;
 for(let i=0;i<args.length;i++){
  const key=args[i],value=args[++i];need(value&&!value.startsWith('--'),'MISSING_ARGUMENT_VALUE',key);
  if(key==='--entry')entryFile=value;
  else if(key==='--expected-entry-sha256')options.expectedEntrySha256=value;
  else if(key==='--request'){need(!options.requestFile,'DUPLICATE_WORK_REQUEST');options.requestFile=value;}
  else if(key==='--surface')options.surface=value;
  else throw new ResumeError('UNKNOWN_ARGUMENT',key);
 }
 need(entryFile,'ENTRY_REQUIRED');
 const result=inspect(entryFile,options);process.stdout.write(JSON.stringify(result,null,2)+'\n');
 return result.status==='resume_consistent'?0:2;
}
if(require.main===module){try{process.exitCode=main(process.argv.slice(2));}catch(error){
 process.stdout.write(JSON.stringify({schema:'reader-work-resume-result-v1',status:'blocked',
  readOnly:true,stateChanged:false,workStarted:false,qualityCertified:false,productionAdmitted:false,
  deliveryAuthorized:false,consentCreated:false,errors:[{code:error.code||'RESUME_ARGUMENT_ERROR',detail:error.detail||error.message}]},null,2)+'\n');
 process.exitCode=2;
}}
module.exports={inspect};
