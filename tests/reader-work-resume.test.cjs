'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const REPO=path.resolve(__dirname,'..');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const json=x=>JSON.stringify(x,null,2)+'\n';
const write=(p,x)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,typeof x==='string'?x:json(x));};
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const pin=(root,rel)=>({path:rel,sha256:digest(fs.readFileSync(path.join(root,rel)))});
function files(root){
 const out=[];for(const d of fs.readdirSync(root,{withFileTypes:true})){
  const p=path.join(root,d.name);if(d.isDirectory())out.push(...files(p));else out.push(p);
 }return out.sort();
}

// Synthetic Python contracts test invocation, selection and byte binding only.
// The actual pinned v9.2 runtime must additionally pass on the private entry.
const ACTIVE_FIXTURE=`import hashlib,json,pathlib,sys
r=pathlib.Path(__file__).parent
m=json.loads((r/'active_release.json').read_text())
for name,sha in m['sha256'].items():
 if hashlib.sha256((r/name).read_bytes()).hexdigest()!=sha: sys.exit('registered runtime changed')
for p in r.glob('*.py'):
 if p.name not in m['sha256']: sys.exit('unregistered executable')
print(json.dumps({'status':'passed','active_release':m['release_id'],'rule_sha256':m['rule_sha256'],'check_count':60}))
`;
const HANDOFF_FIXTURE=`import argparse,hashlib,json,pathlib,sys
p=argparse.ArgumentParser();p.add_argument('command')
for k in ['workflow-state','workflow-root','program-root','handoff','expected-workflow-state-sha256','to-surface']:p.add_argument('--'+k)
a=p.parse_args();raw=pathlib.Path(a.workflow_state).read_bytes();state=json.loads(raw);h=json.loads(pathlib.Path(a.handoff).read_text())
sha=hashlib.sha256(raw).hexdigest()
if h.get('reject') or sha!=a.expected_workflow_state_sha256 or h['binding']['workflow_state']['sha256']!=sha:
 print(json.dumps({'status':'handoff_blocked','reason':'synthetic contract rejected stale handoff'}));sys.exit(2)
print(json.dumps({'status':'handoff_consistent','book_id':state['book_id'],'workflow_state_sha256':sha,'phase':state['phase'],'blocked':None,'state_changed':False,'quality_certified':False,'production_admitted':False,'next_gate':'workflow_run_guard.require_workflow'}))
`;
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'reader-work-resume-test-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.cpSync(path.join(REPO,'tools'),path.join(root,'repo/tools'),{recursive:true});
 fs.mkdirSync(path.join(root,'repo/reader/quality'),{recursive:true});
 for(const f of fs.readdirSync(path.join(REPO,'reader/quality')).filter(x=>x.endsWith('.json')))
  fs.copyFileSync(path.join(REPO,'reader/quality',f),path.join(root,'repo/reader/quality',f));
 const standard=read(path.join(root,'repo/reader/quality/standard.json'));
 const runtime=path.join(root,'runtime'),workflow=path.join(root,'workflow'),quality=path.join(root,'quality');
 write(path.join(runtime,'verify_active_release.py'),ACTIVE_FIXTURE);
 write(path.join(runtime,'workflow_handoff.py'),HANDOFF_FIXTURE);
 write(path.join(runtime,'workflow_run_guard.py'),'# Synthetic production contract; no admission in a resume test.\n');
 write(path.join(runtime,'rules_registry.json'),{ids_ordered:standard.checkIds});
 write(path.join(runtime,'rules/current.md'),'# Synthetic rule text. No source proofreading performed.\n');
 const pins={};for(const f of files(runtime))pins[path.relative(runtime,f).split(path.sep).join('/')]=digest(fs.readFileSync(f));
 write(path.join(runtime,'active_release.json'),{release_id:'synthetic-runtime-test',rule_file:'current.md',
  rule_sha256:pins['rules/current.md'],locked_items:Object.keys(pins).length,sha256:pins});
 const active=read(path.join(runtime,'active_release.json'));
 write(path.join(workflow,'reader.html'),'<!doctype html><title>Synthetic reader</title><p>Synthetic fixture only.</p>\n');
 const artifact=pin(workflow,'reader.html');
 write(path.join(quality,'reader.html'),fs.readFileSync(path.join(workflow,'reader.html'),'utf8'));
 const state={schema:'reader-workflow-state-v9',operation:'reader_production',book_id:'synthetic-book',phase:'required_validation',
  operating_release:{release_id:active.release_id,rule_sha256:active.rule_sha256,active_release_sha256:pin(runtime,'active_release.json').sha256},
  freeze:{artifacts:{reader:{...artifact,domain:'html',role:'reader_html'}}}};
 write(path.join(workflow,'workflow_state.json'),state);
 write(path.join(workflow,'current-handoff.json'),{schema:'reader-workflow-handoff-v1',
  binding:{workflow_state:{sha256:pin(workflow,'workflow_state.json').sha256},artifacts:state.freeze.artifacts,evidence_files:[]}});
 write(path.join(workflow,'workflow_state_selection.json'),{schema:'selected-workflow-state-v1',path:'workflow_state.json',
  sha256:pin(workflow,'workflow_state.json').sha256,handoff_path:'current-handoff.json',quality_certified:false});
 // Existing v1 working drafts use the unchanged pendingDraft route. The old
 // published identity is distinct; this fixture does not pretend to be a
 // legacy reviewed canonical requiring the new context-migration procedure.
 const ledger={schema:'reader-work-ledger-v1',ruleset:'20261116_0654_60-items',books:[{bookId:'synthetic-book',range:[1,2],
  artifactSha256:'9'.repeat(64),sourceArchiveSha256:'a'.repeat(64),profile:'novel',qualityState:'unverified',releaseStatus:'blocked',knownDefects:[],
  pendingDraft:{artifactSha256:artifact.sha256,reviewStatus:'visual_first_pass_only',deliveryStatus:'private_staging_blocked',
   independentSecondPass:'not_run',realIPhone:'not_run',sourceJPEGSHAverified:0,chromiumLayoutChecksPassed:0,
   privateProgressReportSha256:'8'.repeat(64)}}]};
 write(path.join(quality,'ledger.json'),ledger);
 write(path.join(quality,'assessment.json'),{schema:'private-quality-assessment-60-v1',scope:{bookId:'synthetic-book',sourceRange:[1,2],templateProfile:'novel'},
  artifact:{sha256:artifact.sha256},checks:standard.checkIds.map(id=>({id,status:'not_run'}))});
 write(path.join(quality,'manifest.json'),{schema:'reader-private-bundle-v2',bookId:'synthetic-book',standardFileId:standard.canonicalGoogleDriveFileId,
  range:[1,2],artifact:pin(quality,'reader.html'),assessment:pin(quality,'assessment.json'),deliveryState:'blocked_unverified'});
 const entry={schema:'reader-work-resume-v1',purpose:'private_work_resume',workspaceRoot:'..',bookId:'synthetic-book',scanRange:[1,2],profile:'novel',
  workflow:{root:'workflow',selection:pin(workflow,'workflow_state_selection.json'),state:pin(workflow,'workflow_state.json'),
   handoff:pin(workflow,'current-handoff.json'),artifactId:'reader',runtime:{root:'runtime',activeRelease:pin(runtime,'active_release.json'),
    releaseId:active.release_id,ruleSha256:active.rule_sha256}},
  quality:{root:'quality',manifest:pin(quality,'manifest.json'),ledger:pin(quality,'ledger.json'),assessment:pin(quality,'assessment.json'),ruleset:ledger.ruleset},
  adoptedArtifact:{...pin(root,'workflow/reader.html'),bytes:fs.statSync(path.join(workflow,'reader.html')).size},
  toolchain:{root:'repo',files:[]}};
 for(const f of [...files(path.join(root,'repo/tools')),...files(path.join(root,'repo/reader/quality'))])
  if(f.endsWith('.cjs')||f.endsWith('.json'))entry.toolchain.files.push(pin(path.join(root,'repo'),path.relative(path.join(root,'repo'),f).split(path.sep).join('/')));
 const entryFile=path.join(root,'private/current-work.json');write(entryFile,entry);
 return {root,runtime,workflow,quality,entry,entryFile,
  save(){write(entryFile,entry);return digest(fs.readFileSync(entryFile));},
  run(expected=digest(fs.readFileSync(entryFile)),runRoot=root){
   const out=spawnSync(process.execPath,[path.join(runRoot,'repo/tools/reader-work-resume.cjs'),'--entry',path.join(runRoot,'private/current-work.json'),
    '--expected-entry-sha256',expected,'--surface','work'],{encoding:'utf8',env:{...process.env,READER_AUDIT_ROOT:''}});
   assert.ok(out.stdout,'stdout missing: '+out.stderr);return {code:out.status,report:JSON.parse(out.stdout)};
  }};
}
const hasCode=(r,code)=>r.report.errors.some(x=>x.code===code);

test('selected state, quality and pinned code resume read-only without any quality or delivery claim',t=>{
 const f=fixture(t),before=files(f.root).map(p=>[p,digest(fs.readFileSync(p))]);
 const r=f.run();assert.equal(r.code,0,JSON.stringify(r.report.errors));assert.equal(r.report.status,'resume_consistent');
 for(const k of ['stateChanged','artifactChanged','workStarted','productionAdmitted','qualityCertified','deliveryAuthorized','consentCreated'])assert.equal(r.report[k],false,k);
 assert.equal(r.report.workflow.productionAdmissionGate,'workflow_run_guard.require_workflow');
 assert.equal(r.report.quality.assessmentSummary.recordedStates.not_run,60);
 assert.ok(r.report.restoreRequirements.requiredFiles.some(x=>x.path==='workflow/reader.html'&&x.storage==='private'));
 assert.ok(r.report.restoreRequirements.requiredFiles.some(x=>x.path==='repo/tools/reader-work-resume.cjs'&&x.storage==='public_repository'));
 assert.deepEqual(files(f.root).map(p=>[p,digest(fs.readFileSync(p))]),before);
});
test('identical relative entry survives relocation to a different workspace root',t=>{
 const f=fixture(t),other=fs.mkdtempSync(path.join(os.tmpdir(),'reader-relocated-test-'));
 t.after(()=>fs.rmSync(other,{recursive:true,force:true}));fs.cpSync(f.root,other,{recursive:true});
 const r=f.run(digest(fs.readFileSync(f.entryFile)),other);assert.equal(r.code,0,JSON.stringify(r.report.errors));
 assert.equal(r.report.adoptedArtifact.path,'workflow/reader.html');
});
test('external adopted entry pin is mandatory and stale entry bytes stop before any work',t=>{
 const f=fixture(t);const old=f.save();f.entry.profile='image';f.save();
 assert.ok(hasCode(f.run(old),'FILE_HASH_MISMATCH'));
 assert.ok(hasCode(f.run('missing-pin'),'EXPECTED_ENTRY_SHA_REQUIRED'));
});
test('historical/retained workflow can never become the selected current entry',t=>{
 const f=fixture(t);f.entry.workflow.root='quality/retained';f.save();
 assert.ok(hasCode(f.run(),'HISTORICAL_STATE_CANNOT_BE_SELECTED'));
});
test('a private entry cannot redirect the quality workspace into the public repository',t=>{
 const f=fixture(t);f.entry.quality.root='repo/reader/quality';f.save();
 assert.ok(hasCode(f.run(),'PRIVATE_QUALITY_INSIDE_PUBLIC_REPOSITORY'));
});
test('rehashing an entry cannot conceal an internally stale workflow selection',t=>{
 const f=fixture(t),selection=read(path.join(f.workflow,'workflow_state_selection.json'));selection.sha256='0'.repeat(64);
 write(path.join(f.workflow,'workflow_state_selection.json'),selection);f.entry.workflow.selection=pin(f.workflow,'workflow_state_selection.json');f.save();
 assert.ok(hasCode(f.run(),'SELECTED_WORKFLOW_MISMATCH'));
});
test('different ledger artifact or range is rejected even with fresh file pins',t=>{
 const f=fixture(t),ledger=read(path.join(f.quality,'ledger.json'));ledger.books[0].pendingDraft.artifactSha256='b'.repeat(64);
 write(path.join(f.quality,'ledger.json'),ledger);f.entry.quality.ledger=pin(f.quality,'ledger.json');f.save();
 assert.ok(hasCode(f.run(),'QUALITY_ADOPTED_ARTIFACT_MISMATCH'));
 ledger.books[0].pendingDraft.artifactSha256=f.entry.adoptedArtifact.sha256;ledger.books[0].range=[3,4];write(path.join(f.quality,'ledger.json'),ledger);
 f.entry.quality.ledger=pin(f.quality,'ledger.json');f.save();assert.ok(hasCode(f.run(),'QUALITY_LEDGER_RANGE_OR_PROFILE_MISMATCH'));
});
test('changed executable dependency is rejected before loading planner code',t=>{
 const f=fixture(t);fs.appendFileSync(path.join(f.root,'repo/tools/reader-repair-plan.cjs'),'\nthrow Error("must not execute");\n');
 assert.ok(hasCode(f.run(),'FILE_HASH_MISMATCH'));
});
test('the separately read work catalog must be pinned and cannot silently change task order',t=>{
 const f=fixture(t);f.entry.toolchain.files=f.entry.toolchain.files.filter(x=>x.path!=='reader/quality/work-catalog.json');f.save();
 assert.ok(hasCode(f.run(),'WORK_CATALOG_PIN_REQUIRED'));
});
test('formal active-release verifier rejects unregistered executable mixing',t=>{
 const f=fixture(t);write(path.join(f.runtime,'old-generator.py'),'# Old unused generator must not regain the active path.\n');
 assert.ok(hasCode(f.run(),'WORKFLOW_VERIFIER_REJECTED'));
});
test('formal handoff rejection is preserved rather than replaced by hash-only success',t=>{
 const f=fixture(t),handoff=read(path.join(f.workflow,'current-handoff.json'));handoff.reject=true;
 write(path.join(f.workflow,'current-handoff.json'),handoff);f.entry.workflow.handoff=pin(f.workflow,'current-handoff.json');f.save();
 assert.ok(hasCode(f.run(),'WORKFLOW_VERIFIER_REJECTED'));
});
test('quality child evidence hash mismatch blocks resume rather than resetting review',t=>{
 const f=fixture(t);fs.appendFileSync(path.join(f.quality,'reader.html'),'changed');
 assert.ok(hasCode(f.run(),'FILE_HASH_MISMATCH'));
});
test('common rule IDs cannot drift between workflow runtime and quality engine',t=>{
 const f=fixture(t),file=path.join(f.root,'repo/reader/quality/standard.json'),s=read(file);
 [s.checkIds[0],s.checkIds[1]]=[s.checkIds[1],s.checkIds[0]];write(file,s);
 const pinRow=f.entry.toolchain.files.find(x=>x.path==='reader/quality/standard.json');pinRow.sha256=digest(fs.readFileSync(file));f.save();
 assert.ok(hasCode(f.run(),'COMMON_SIXTY_ID_MISMATCH'));
});
test('old progress is explicitly blocked instead of being silently ignored',t=>{
 const f=fixture(t);write(path.join(f.quality,'progress.json'),{schema:'reader-repair-progress-v1',bookId:'synthetic-book',range:[1,2],
  artifactSha256:'c'.repeat(64),pages:[],boundaries:[]});f.entry.quality.progress=pin(f.quality,'progress.json');f.save();
 assert.ok(hasCode(f.run(),'STALE_REPAIR_PROGRESS'));
});
