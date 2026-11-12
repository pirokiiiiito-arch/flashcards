#!/usr/bin/env node
'use strict';
// Evidence verifier. No network, OCR, or writes to a user's live reader.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const legacy=require('./reader-quality-gate.cjs');
const ROOT=path.resolve(__dirname,'..'),SCHEMA='reader-release-v2';
const TRUST_ANCHOR='b67e33e6ec0ff82c2081a24fcabcff667d45fd06912a884d0795e97cbd2c1a86';
const POST=new Set(['G8-03','G8-04','G8-08']);
const REQUIRED=new Set(['G1-01','G1-02','G1-04','G2-04','G2-05','G3-01','G3-03','G3-05','G3-06','G3-07','G4-01','G4-03','G6-02','G6-05','G6-12','G7-01','G7-02','G7-03','G7-04','G8-01','G8-02','G8-03','G8-04','G8-05','G8-07','G8-08','G8-11']);
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function stable(x){if(x===null||typeof x!=='object')return JSON.stringify(x);if(Array.isArray(x))return '['+x.map(stable).join(',')+']';return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';}
const objHash=x=>hash(stable(x)),hex=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
function demand(ok,why){if(!ok)throw Error(why);}
function safe(root,rel){
 demand(typeof rel==='string'&&rel.length>0&&!rel.includes('\\')&&!path.isAbsolute(rel)&&!rel.split('/').some(p=>p==='..'||p==='.'||p===''),'UNSAFE_PATH');
 const base=fs.realpathSync(root),file=path.resolve(base,rel);demand(file.startsWith(base+path.sep),'PATH_ESCAPE');
 let dir=base;for(const part of rel.split('/')){dir=path.join(dir,part);demand(!fs.lstatSync(dir).isSymbolicLink(),'SYMLINK_REJECTED');}
 demand(fs.statSync(file).isFile(),'NOT_FILE');return file;
}
function bytes(root,ref){demand(ref&&hex(ref.sha256),'MISSING_FILE_HASH');const b=fs.readFileSync(safe(root,ref.path));demand(hash(b)===ref.sha256,'FILE_CHANGED '+ref.path);return b;}
function json(root,ref){return JSON.parse(bytes(root,ref).toString('utf8'));}
function extract(input){
 const html=Buffer.isBuffer(input)?input.toString('utf8'):input;
 const matches=[...html.matchAll(/<script\b(?=[^>]*\bid=["'](?:bookdata|embedded-data)["'])[^>]*>([\s\S]*?)<\/script>/gi)];
 demand(matches.length===1,'ONE_BOOK_DATA_REQUIRED');const m=matches[0],data=JSON.parse(m[1]);
 demand(Array.isArray(data)||Array.isArray(data?.pages),'UNSUPPORTED_BOOK_FORMAT');
 const offset=m.index+m[0].indexOf('>')+1;
 return {data,pages:Array.isArray(data)?data:data.pages,shell:html.slice(0,offset)+'{{READER_DATA}}'+html.slice(offset+m[1].length),offset,length:m[1].length};
}
function textFields(pages){
 const out={};
 for(const p of pages){const scan=p.scan;const put=(k,v)=>{if(typeof v==='string'&&v.length)out[scan+'/'+k]=v;};
  put('title',p.title);put('body',p.reading_text??p.ocr);
  for(const [i,b]of(p.blocks||[]).entries())put('blocks/'+i,b.text);
  for(const [i,f]of(p.figures||[]).entries()){put('figures/'+i+'/caption',f.caption);put('figures/'+i+'/title',f.display_title);}
  for(const [i,a]of(p.boxed_articles||[]).entries()){put('boxed/'+i+'/text',a.text);put('boxed/'+i+'/title',a.title);}
  for(const [i,h]of(p.headings||[]).entries())put('headings/'+i,typeof h==='string'?h:h.text||h.title);
  for(const [i,t]of(p.toc_entries||[]).entries()){put('toc/'+i+'/text',t.text||t.name||t.title);put('toc/'+i+'/page',String(t.page??t.number??''));}
 }
 return out;
}
function originals(pages){const out={};for(const p of pages){const s=p.original??p.dataUrl;demand(/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(s||''),'ORIGINAL_MISSING '+p.scan);const b64=s.slice(s.indexOf(',')+1),b=Buffer.from(b64,'base64');demand(b.toString('base64')===b64,'INVALID_BASE64');out[p.scan]=hash(b);demand(out[p.scan]===p.sha256,'EMBEDDED_ORIGINAL_MISMATCH '+p.scan);}return out;}
function replay(raw,events){
 const data=structuredClone(raw),pages=Array.isArray(data)?data:data.pages;let previous=objHash(raw);
 for(const e of events){
  demand(e.beforeDataSha256===previous&&e.actor&&e.reason&&e.sourceRegion&&hex(e.sourceSha256)&&Number.isFinite(Date.parse(e.at)),'BAD_CORRECTION_EVENT');
  const p=pages.find(x=>x.scan===e.scan);demand(p&&p.sha256===e.sourceSha256,'CORRECTION_SOURCE_MISMATCH');
  demand(/^(reading_text|title|(?:figures\/\d+\/(?:caption|display_title))|(?:boxed_articles\/\d+\/(?:text|title))|(?:blocks\/\d+\/text))$/.test(e.pointer||''),'UNSAFE_CORRECTION_FIELD');
  const parts=e.pointer.split('/');let target=p;for(const part of parts.slice(0,-1)){demand(target&&Object.hasOwn(target,part),'CORRECTION_PATH_MISSING');target=target[part];}
  const key=parts.at(-1);demand((target[key]??null)===e.before&&typeof e.after==='string','STALE_CORRECTION');
  target[key]=e.after;previous=objHash(data);demand(previous===e.afterDataSha256,'CORRECTION_CHAIN_BROKEN');
 }
 return data;
}
function anomalies(fields){
 const found=[];for(const [field,text]of Object.entries(fields)){
  const patterns=[['latin',/[A-Za-z]{2,}/g],['replacement',/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/g],['repeat',/(.)\1{4,}/gu],['suspect-year',/[0-9０-９]{2,}[て><][0-9０-９]{2,}/g]];
  for(const [kind,re]of patterns)for(const m of text.matchAll(re))found.push({id:objHash([field,kind,m.index,m[0]]),field,kind,offset:m.index,text:m[0]});
 }return found;
}
function validateBundle(file,{phase='prepare'}={}){
 const errors=[],warnings=['A verifier checks evidence and consistency; it cannot prove that a reviewer actually read a scan.'],result={schema:SCHEMA,phase,errors,warnings,eligible:false};
 try{
  demand(['preview','prepare','release','deployed','device'].includes(phase),'INVALID_PHASE');
  const root=path.dirname(path.resolve(file)),m=JSON.parse(fs.readFileSync(file,'utf8'));result.bookId=m.bookId;
  demand(m.schema==='reader-private-bundle-v2'&&/^[a-z0-9-]{3,100}$/.test(m.bookId||''),'BUNDLE_IDENTITY');
  demand(m.standardFileId===legacy.ID&&Array.isArray(m.range)&&m.range.length===2&&m.range.every(Number.isInteger)&&m.range[0]>0&&m.range[1]>=m.range[0],'RANGE_OR_STANDARD');
  const raw=json(root,m.raw),canonical=json(root,m.canonical),index=json(root,m.originalIndex),events=json(root,m.corrections),profile=json(root,m.profile),lock=json(root,m.lock);
  const artifact=bytes(root,m.artifact),template=bytes(root,m.template).toString('utf8'),parsed=extract(artifact),pages=Array.isArray(canonical)?canonical:canonical.pages;
  demand(Array.isArray(pages)&&pages.length===m.range[1]-m.range[0]+1&&pages.every((p,i)=>p.scan===m.range[0]+i),'SCAN_COVERAGE');
  demand(lock.schema==='reader-input-lock-v2'&&['raw','originalIndex','template','profile'].every(k=>lock[k]===m[k].sha256),'IMMUTABLE_INPUT_CHANGED');
  demand(objHash(replay(raw,events))===objHash(canonical),'CANONICAL_NOT_FROM_CORRECTIONS');
  demand(objHash(parsed.data)===objHash(canonical),'ARTIFACT_NOT_CANONICAL');
  demand(parsed.shell===template,'RENDERER_CHANGED');
  demand(profile.templateSha256===m.template.sha256&&profile.defaultFontPx===20&&profile.lineHeight===1.5&&profile.digitOrientation==='preserve-approved'&&profile.gesture==='up-next-down-prev-one-step-native-zoom','PROFILE_DRIFT');
  demand(objHash(originals(pages))===objHash(index),'SOURCE_INDEX_MISMATCH');
  for(const p of pages)demand(hex(index[p.scan]),'SOURCE_PAGE_MISSING');
  result.subject={bookId:m.bookId,range:m.range,artifactSha256:m.artifact.sha256,canonicalSha256:m.canonical.sha256,rawSha256:m.raw.sha256,originalIndexSha256:m.originalIndex.sha256,templateSha256:m.template.sha256,profileSha256:m.profile.sha256,loaderSha256:m.loaderSha256};
  demand(hex(m.loaderSha256),'LOADER_IDENTITY_REQUIRED');result.subjectSha256=objHash(result.subject);
  if(phase==='preview'){
   const a=json(root,m.previewAuthorization);demand(a.explicit===true&&a.requestedBy&&a.requestText?.length>=8&&Number.isFinite(Date.parse(a.at))&&a.artifactSha256===m.artifact.sha256,'EXPLICIT_PREVIEW_REQUEST_REQUIRED');
   result.authorization={sha256:m.previewAuthorization.sha256,explicit:true};result.eligible=true;result.contentCertified=false;
   result.checks=Object.fromEntries(legacy.RULES.map(id=>[id,{status:'not_run'}]));return result;
  }
  const fields=textFields(pages),inventory=json(root,m.inventory),second=json(root,m.second),resolutions=json(root,m.resolutions),boundaries=json(root,m.boundaries),display=json(root,m.display);
  demand(Array.isArray(inventory.pages)&&inventory.pages.length===pages.length,'INVENTORY_PAGE_COUNT');
  const covered=new Set(),regionIDs=new Set();
  for(let i=0;i<pages.length;i++){
   const p=pages[i],v=inventory.pages[i];demand(v.scan===p.scan&&v.sourceSha256===p.sha256&&v.reviewedBy&&v.secondReviewer&&v.firstPassId&&v.secondPassId&&v.firstPassId!==v.secondPassId&&v.edgesChecked===true&&v.secondViewedFirst===false,'INVENTORY_NOT_INDEPENDENT '+p.scan);
   demand(Number.isInteger(v.width)&&v.width>0&&Number.isInteger(v.height)&&v.height>0&&Array.isArray(v.regions),'INVALID_REGION_MAP');
   for(const r of v.regions){demand(r.id&&!regionIDs.has(r.id)&&['body','heading','caption','boxed','toc','image_label','running_head','page_number','photo'].includes(r.kind),'INVALID_REGION');regionIDs.add(r.id);
    demand(Array.isArray(r.box)&&r.box.length===4&&r.box.every(Number.isFinite)&&r.box[0]>=0&&r.box[1]>=0&&r.box[2]>r.box[0]&&r.box[3]>r.box[1]&&r.box[2]<=v.width&&r.box[3]<=v.height,'REGION_OUT_OF_BOUNDS');
    if(['body','heading','caption','boxed','toc'].includes(r.kind)){demand(Array.isArray(r.fields)&&r.fields.length&&r.fields.every(k=>k.startsWith(p.scan+'/')&&Object.hasOwn(fields,k)),'UNREGISTERED_TEXT_REGION');for(const k of r.fields)covered.add(k);}
    else demand(r.reason&&r.reason.length>5,'UNJUSTIFIED_NONPROSE_REGION');
   }
  }
  demand(Object.keys(fields).every(k=>covered.has(k)),'TEXT_WITHOUT_SOURCE_REGION');
  demand(second.runId&&second.runId!==m.firstPassId&&second.viewedFirst===false&&second.sourceIndexSha256===m.originalIndex.sha256&&second.method&&second.fields&&second.reviewedBy,'SECOND_PASS_NOT_INDEPENDENT');
  demand(objHash(Object.keys(second.fields).sort())===objHash(Object.keys(fields).sort()),'SECOND_PASS_FIELD_COVERAGE');
  for(const [k,v]of Object.entries(fields))if(v!==second.fields[k]){
   const r=resolutions.differences?.find(x=>x.field===k&&x.firstSha256===hash(v)&&x.secondSha256===hash(second.fields[k]));
   demand(r&&r.resolved===true&&r.canonicalSha256===hash(v)&&regionIDs.has(r.regionId)&&r.reviewedBy&&r.reason,'UNRESOLVED_SECOND_PASS '+k);
  }
  for(const e of events)demand(regionIDs.has(e.sourceRegion),'CORRECTION_REGION_MISSING');
  demand(Array.isArray(resolutions.openIssues)&&resolutions.openIssues.length===0,'UNRESOLVED_ISSUES');
  for(const a of anomalies(fields))demand(resolutions.alerts?.some(r=>r.id===a.id&&r.decision==='source_confirmed'&&r.reviewedBy&&regionIDs.has(r.regionId)&&r.reason),'UNRESOLVED_ANOMALY '+a.field);
  for(const [field,text]of Object.entries(fields))for(const n of text.matchAll(/[0-9０-９〇零一二三四五六七八九十百千万億]+/gu))demand(resolutions.numbers?.some(r=>r.field===field&&r.offset===n.index&&r.text===n[0]&&r.reviewedBy&&regionIDs.has(r.regionId)),'UNVERIFIED_NUMBER '+field);
  const expected=[];for(let s=m.range[0]-1;s<=m.range[1];s++)expected.push(s+'>'+String(s+1));
  demand(Array.isArray(boundaries.items)&&objHash(boundaries.items.map(x=>x.id).sort())===objHash(expected.sort()),'BOUNDARY_COVERAGE');
  for(const b of boundaries.items)demand(b.reviewedBy&&b.reason&&b.resolved===true&&typeof b.leftTail==='string'&&typeof b.rightHead==='string'&&hex(b.leftSourceSha256)&&hex(b.rightSourceSha256),'UNVERIFIED_BOUNDARY');
  demand(display.artifactSha256===m.artifact.sha256&&display.actualPixels===true&&objHash(display.fields)===objHash(fields),'DISPLAY_NOT_CANONICAL');
  const conditions=new Set();for(const c of display.conditions||[]){demand(c.passed===true&&c.artifactSha256===m.artifact.sha256&&c.actualPixels===true&&objHash(c.scans)===objHash(pages.map(p=>p.scan))&&c.overflowCount===0&&c.roundTripSha256===objHash(fields),'INCOMPLETE_DISPLAY_CONDITION');conditions.add(c.width+'/'+c.fontPx);}
  for(const w of[320,390,430])for(const f of[16,18,20,22,24,26,28,30])demand(conditions.has(w+'/'+f),'MISSING_24_CONDITION '+w+'/'+f);
  const checks=json(root,m.checks);demand(objHash(Object.keys(checks).sort())===objHash(legacy.RULES.slice().sort()),'EXACT_60_REQUIRED');
  result.checks={};
  for(const id of legacy.RULES){
   const c=checks[id],required=!POST.has(id)||(id==='G8-08'&&phase!=='prepare')||(id==='G8-03'&&['deployed','device'].includes(phase))||(id==='G8-04'&&phase==='device');
   demand(c&&['not_run','passed','failed','needs_source_review','not_applicable'].includes(c.status),'INVALID_CHECK_STATE '+id);
   if(required)demand(['passed','not_applicable'].includes(c.status),'CHECK_NOT_PASSED '+id);
   if(c.status==='not_applicable')demand(!REQUIRED.has(id)&&c.reason?.length>=12,'FORBIDDEN_NA '+id);
   if(['passed','not_applicable'].includes(c.status)){
    const e=json(root,c.evidence);demand(e.checkId===id&&e.artifactSha256===m.artifact.sha256&&e.subjectSha256===result.subjectSha256&&e.reviewedBy&&e.method?.length>=8&&Number.isFinite(Date.parse(e.at))&&Array.isArray(e.scans)&&objHash(e.scans)===objHash(pages.map(p=>p.scan)),'STALE_OR_WRONG_EVIDENCE '+id);
    if(id==='G8-04')demand(e.environment?.realDevice===true&&e.environment?.device==='iPhone'&&e.environment?.browser==='Chrome'&&e.environment?.osVersion,'EMULATION_IS_NOT_IPHONE');
    if(id==='G8-03')demand(e.deployedLoaderSha256===m.loaderSha256&&e.deploymentSucceeded===true,'DEPLOYMENT_NOT_VERIFIED');
    if(id==='G8-08'){const readback=bytes(root,e.readback);demand(hash(readback)===m.artifact.sha256&&e.provider==='google-drive'&&e.fileId,'READBACK_MISMATCH');}
    result.checks[id]={status:c.status,evidenceSha256:c.evidence.sha256};
   }else result.checks[id]={status:c.status};
  }
  result.eligible=true;result.canonicalFields=Object.keys(fields).length;result.scans=pages.length;result.knownSourceDefects=0;
 }catch(e){errors.push(e.message);}
 return result;
}
function verifyEnvelope(envelope,policy){
 demand(envelope?.payload?.schema===SCHEMA&&typeof envelope.keyId==='string','INVALID_RECEIPT');
 const publicKey=policy.trustedKeys?.[envelope.keyId];demand(publicKey,'UNTRUSTED_REVIEW_KEY');
 demand(crypto.verify(null,Buffer.from(stable(envelope.payload)),publicKey,Buffer.from(envelope.signature||'','base64')),'BAD_RECEIPT_SIGNATURE');
 return envelope.payload;
}
function runtimeFiles(root){const out={};function walk(dir){for(const d of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,d.name),p=path.relative(root,f).split(path.sep).join('/');if(p==='reader/quality')continue;demand(!d.isSymbolicLink(),'PUBLIC_SYMLINK');if(d.isDirectory())walk(f);else if(d.isFile())out[p]=hash(fs.readFileSync(f));}}walk(path.join(root,'reader'));return out;}
function validateRepository(root=ROOT){
 const result=legacy.validate(root),errors=result.errors;result.contentCertification=false;
 try{
  const policy=JSON.parse(fs.readFileSync(path.join(root,'reader/quality/release-policy.json'))),reg=JSON.parse(fs.readFileSync(path.join(root,'reader/quality/registry.json')));
  demand(policy.schema==='reader-release-policy-v2'&&policy.standardFileId===legacy.ID,'INVALID_RELEASE_POLICY');
  demand(objHash(policy.baseline)===TRUST_ANCHOR,'TRUST_ANCHOR_CHANGED');
  const current=runtimeFiles(root),authorizedFiles={},receipts=new Map();
  for(const rel of policy.receipts||[]){const p=verifyEnvelope(JSON.parse(fs.readFileSync(safe(root,rel))),policy);
   demand(p.eligible===true&&p.toolSha256===hash(fs.readFileSync(__filename))&&hex(p.subjectSha256)&&p.subjectSha256===objHash(p.subject),'STALE_RELEASE_RECEIPT');
   demand(!receipts.has(p.subject.bookId),'DUPLICATE_RECEIPT');receipts.set(p.subject.bookId,p);
   demand(['preview','production'].includes(p.channel),'BAD_CHANNEL');
   if(p.channel==='preview')demand(p.authorization&&hex(p.authorization.sha256)&&p.authorization.explicit===true&&p.entry.startsWith('reader/preview/'),'PREVIEW_NOT_AUTHORIZED');
   else{demand(['release','deployed','device'].includes(p.phase),'NOT_RELEASE_ELIGIBLE');for(const id of legacy.RULES.filter(x=>!['G8-03','G8-04'].includes(x)))demand(['passed','not_applicable'].includes(p.checks?.[id]?.status),'CERTIFICATE_CHECK_MISSING '+id);}
   for(const [f,h]of Object.entries(p.publicFiles||{})){demand(f.startsWith('reader/')&&!f.startsWith('reader/quality/')&&hex(h),'BAD_PUBLIC_FILE_RECEIPT');demand(!authorizedFiles[f]||authorizedFiles[f]===h,'CONFLICTING_FILE_RECEIPTS');authorizedFiles[f]=h;}
  }
  for(const [f,h]of Object.entries(current))demand(h===policy.baseline.files[f]||h===authorizedFiles[f],'UNAUTHORIZED_READER_CHANGE '+f);
  for(const f of Object.keys(policy.baseline.files))demand(current[f],'FROZEN_READER_REMOVED '+f);
  for(const b of reg.books){const rep=JSON.parse(fs.readFileSync(safe(root,b.report))),identity=objHash({book:b,artifact:rep.privateArtifact||rep.artifactAudit||null});
   if(policy.baseline.books[b.id]===identity&&b.stage==='draft'&&!rep.claimsCompleted)continue;
   const p=receipts.get(b.id);demand(p&&p.entry===b.entry&&p.bookRecordSha256===objHash(b)&&p.reportSha256===hash(fs.readFileSync(safe(root,b.report)))&&p.subject.loaderSha256===current[b.entry],'NO_MATCHING_RELEASE_CERTIFICATE '+b.id);
   demand((rep.privateArtifact?.sha256||rep.artifactAudit?.sourceSha256)===p.subject.artifactSha256,'ARTIFACT_CERTIFICATE_MISMATCH');
   if(p.channel==='preview')demand(b.stage==='draft'&&!rep.claimsCompleted,'PREVIEW_CANNOT_BE_COMPLETE');
   else demand(b.stage!=='draft','PRODUCTION_STAGE_MISMATCH');
   if(['completed','iphone_verified'].includes(b.stage))demand(['deployed','device'].includes(p.phase)&&p.checks['G8-03'].status==='passed','PUBLICATION_NOT_READ_BACK');
   if(b.stage==='iphone_verified')demand(p.phase==='device'&&p.checks['G8-04'].status==='passed','DEVICE_NOT_VERIFIED');
  }
  result.inheritedUnverified=Object.keys(policy.baseline.books).length;
 }catch(e){errors.push(e.message);}
 return result;
}
if(require.main===module){
 const [command,file,phase]=process.argv.slice(2);let result;
 try{result=command==='repo'?validateRepository(file||ROOT):command==='check'?validateBundle(file,{phase:phase||'prepare'}):{errors:['Usage: reader-release-control.cjs repo [root] | check manifest.json [prepare|release|deployed|device]']};}catch(e){result={errors:[e.message]};}
 console.log(JSON.stringify(result,null,2));if(result.errors.length)process.exitCode=1;
}
module.exports={hash,stable,objHash,safe,bytes,json,extract,textFields,originals,replay,anomalies,validateBundle,validateRepository,verifyEnvelope,runtimeFiles,SCHEMA};
