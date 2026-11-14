#!/usr/bin/env node
'use strict';
// Evidence verifier. No network, OCR, or writes to a user's live reader.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const legacy=require('./reader-quality-gate.cjs');
const ROOT=process.env.READER_AUDIT_ROOT||path.resolve(__dirname,'..'),SCHEMA='reader-release-v2';
const TRUST_ANCHOR='76cf9d19508fcde941c2051f7c8a617e46599abf2116ea42d983150c7f9223ca';
const IMPLEMENTATION=['reader-release-control.cjs','reader-private-pipeline.cjs','reader-publish-stage.cjs','reader-quality-gate.cjs','reader-artifact-audit.cjs'];
// Pre-feature identity retained only for old evidence-scoped unverified preview receipts.
const PRE_UI_IMPLEMENTATION_SHA256='ec32213f08ac067016c51c461037feeda1ea5446c64340e82cbd8b6c501618af';
// Exact UI-only byte authorization for the user's 2026-11-14 first-page request.
// No OCR, device, or unscoped compatibility certification is inferred.
const FIRST_PAGE_UI_GIT_BLOBS=Object.freeze({
 'reader/british-interiors/full/index.html':'ec2de52649439cdc869aa3b13b507e39aabda40e',
 'reader/library/read.html':'50e5eac1e53240c7ba9e2b5e0503513534cf6bf6',
 'reader/library/read-wh1-v9.html':'c1caae07ede2e2c9ec8b1d623017ebae23c81dde',
 'reader/library/wh1-library-v9-build.json':'c09f82d0bfd63ec55bf977afcc70763511a95cdc'
});
function implementationHash(){return objHash(Object.fromEntries(IMPLEMENTATION.map(f=>[f,hash(fs.readFileSync(path.join(__dirname,f)))])));}
const POST=new Set(['G8-03','G8-04','G8-08']);
const REQUIRED=new Set(['G1-01','G1-02','G1-04','G2-04','G2-05','G3-01','G3-03','G3-05','G3-06','G3-07','G4-01','G4-03','G6-02','G6-05','G6-12','G7-01','G7-02','G7-03','G7-04','G8-01','G8-02','G8-03','G8-04','G8-05','G8-07','G8-08','G8-11']);
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function stable(x){if(x===null||typeof x!=='object')return JSON.stringify(x);if(Array.isArray(x))return '['+x.map(stable).join(',')+']';return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';}
// Stream the exact stable serialization to avoid allocating the full embedded-image book per hash.
const stableLargeStrings=new Map();
function objHash(x){
 const h=crypto.createHash('sha256');
 function visit(y,context='root'){
  if(y===null||typeof y!=='object'){if(typeof y==='string'&&y.length>16384){let buf=stableLargeStrings.get(y);if(!buf){buf=Buffer.from(JSON.stringify(y));stableLargeStrings.set(y,buf);if(stableLargeStrings.size>128)stableLargeStrings.delete(stableLargeStrings.keys().next().value);}h.update(buf);return;}const s=JSON.stringify(y);if(s===undefined){if(context==='array')return;if(context==='object'){h.update('undefined');return;}}h.update(s);return;}
  if(Array.isArray(y)){h.update('[');y.forEach((z,i)=>{if(i)h.update(',');visit(z,'array');});h.update(']');return;}
  h.update('{');Object.keys(y).sort().forEach((k,i)=>{if(i)h.update(',');h.update(JSON.stringify(k)+':');visit(y[k],'object');});h.update('}');
 } visit(x);return h.digest('hex');
}
const hex=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
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
  put('title',p.title);put('body',p.reading_text??p.ocr);put('manual_heading',p.manual_heading);
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
  if(e.kind==='source-region-classification'){
   const keys=['has_any_text','has_readable_prose','original_only_justification'];
   demand(e.pointer==='classification'&&e.before&&e.after&&objHash(Object.keys(e.after).sort())===objHash(keys.slice().sort()),'CLASSIFICATION_KEYS');
   demand(keys.every(k=>p[k]===e.before[k]),'CLASSIFICATION_PRECONDITION');
   const prose=[p.reading_text,...(p.figures||[]).map(f=>f.caption),...(p.boxed_articles||[]).map(b=>b.text)].some(t=>typeof t==='string'&&t.trim().length>0);
   demand(e.after.has_any_text===true&&e.after.has_readable_prose===prose&&(prose?e.after.original_only_justification===null:typeof e.after.original_only_justification==='string'&&e.after.original_only_justification.length>=20),'CLASSIFICATION_CONTENT_MISMATCH');
   for(const k of keys)p[k]=e.after[k];previous=objHash(data);demand(previous===e.afterDataSha256,'CORRECTION_CHAIN_BROKEN');continue;
  }
  if(e.kind==='register-original-figure'){
   const f=e.after;
   demand(e.before===null&&e.pointer==='figures/-'&&Array.isArray(p.figures)&&p.figures.length===0,'REGISTRATION_REQUIRES_EMPTY_FIGURES');
   demand(f&&f.source_scan===p.scan&&f.caption_source_scan===p.scan&&f.source_sha256===p.sha256&&f.image===p.original&&typeof f.caption==='string'&&f.caption.length>0&&typeof f.id==='string'&&f.id.length>0,'REGISTRATION_SOURCE_MISMATCH');
   demand(f.representation==='original_JPEG_unchanged'&&Array.isArray(f.source_box_xyxy)&&objHash(f.source_box_xyxy)===objHash([0,0,p.source_image_width,p.source_image_height]),'REGISTRATION_NOT_WHOLE_ORIGINAL');
   p.figures.push(structuredClone(f));previous=objHash(data);demand(previous===e.afterDataSha256,'CORRECTION_CHAIN_BROKEN');continue;
  }
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
  const root=path.dirname(path.resolve(file)),m=JSON.parse(fs.readFileSync(file,'utf8'));result.bookId=m.bookId;result.implementationSha256=implementationHash();
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
  demand(m.firstPassId&&second.runId&&second.runId!==m.firstPassId&&second.viewedFirst===false&&second.sourceIndexSha256===m.originalIndex.sha256&&second.method&&second.fields&&second.reviewedBy,'SECOND_PASS_NOT_INDEPENDENT');
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
  for(const b of boundaries.items){const [left,right]=b.id.split('>').map(Number);if(index[left])demand(b.leftSourceSha256===index[left],'BOUNDARY_SOURCE_MISMATCH');if(index[right])demand(b.rightSourceSha256===index[right],'BOUNDARY_SOURCE_MISMATCH');demand(b.reviewedBy&&b.reason&&b.resolved===true&&typeof b.leftTail==='string'&&typeof b.rightHead==='string'&&(b.kind==='book_start'?b.leftSourceSha256===null:hex(b.leftSourceSha256))&&(b.kind==='book_end'?b.rightSourceSha256===null:hex(b.rightSourceSha256)),'UNVERIFIED_BOUNDARY');}
  demand(display.artifactSha256===m.artifact.sha256&&display.actualPixels===true&&objHash(display.fields)===objHash(fields),'DISPLAY_NOT_CANONICAL');
  const conditions=new Set();for(const c of display.conditions||[]){demand(c.passed===true&&c.artifactSha256===m.artifact.sha256&&c.actualPixels===true&&objHash(c.scans)===objHash(pages.map(p=>p.scan))&&c.overflowCount===0&&c.roundTripSha256===objHash(fields),'INCOMPLETE_DISPLAY_CONDITION');conditions.add(c.width+'/'+c.fontPx);}
  for(const w of[320,390,430])for(const f of[16,18,20,22,24,26,28,30])demand(conditions.has(w+'/'+f),'MISSING_24_CONDITION '+w+'/'+f);
  const checks=json(root,m.checks);demand(objHash(Object.keys(checks).sort())===objHash(legacy.RULES.slice().sort()),'EXACT_60_REQUIRED');
  result.checks={};
  for(const id of legacy.RULES){
   const c=checks[id],required=!POST.has(id)||(id==='G8-08'&&phase!=='prepare')||(id==='G8-03'&&['deployed','device'].includes(phase))||(id==='G8-04'&&phase==='device');
   demand(c&&['not_run','passed','failed','needs_source_review','not_applicable'].includes(c.status),'INVALID_CHECK_STATE '+id);
   demand(c.status!=='failed'&&c.status!=='needs_source_review','KNOWN_FAILURE_OR_UNRESOLVED '+id);
   if(required)demand(['passed','not_applicable'].includes(c.status),'CHECK_NOT_PASSED '+id);
   if(c.status==='not_applicable')demand(!REQUIRED.has(id)&&c.reason?.length>=12,'FORBIDDEN_NA '+id);
   if(['passed','not_applicable'].includes(c.status)){
    const e=json(root,c.evidence);demand(e.checkId===id&&e.artifactSha256===m.artifact.sha256&&e.subjectSha256===result.subjectSha256&&e.result===c.status&&e.reviewedBy&&e.method?.length>=8&&Number.isFinite(Date.parse(e.at))&&Array.isArray(e.scans)&&objHash(e.scans)===objHash(pages.map(p=>p.scan)),'STALE_OR_WRONG_EVIDENCE '+id);
    if(id==='G8-04')demand(e.environment?.realDevice===true&&e.environment?.device==='iPhone'&&e.environment?.browser==='Chrome'&&e.environment?.osVersion,'EMULATION_IS_NOT_IPHONE');
    if(id==='G8-03')demand(e.deployedLoaderSha256===m.loaderSha256&&e.deploymentSucceeded===true,'DEPLOYMENT_NOT_VERIFIED');
    if(id==='G8-08'){const readback=bytes(root,e.readback);demand(hash(readback)===m.artifact.sha256&&e.provider==='google-drive'&&e.fileId,'READBACK_MISMATCH');}
    result.checks[id]={status:c.status,evidenceSha256:c.evidence.sha256,reason:c.reason||null};
   }else result.checks[id]={status:c.status};
  }
  result.evidenceIndex=Object.fromEntries(['inventory','second','resolutions','boundaries','display','checks','corrections','lock'].map(k=>[k,m[k].sha256]));
  result.eligible=true;result.canonicalFields=Object.keys(fields).length;result.scans=pages.length;result.knownSourceDefects=0;
 }catch(e){errors.push(e.message);}
 return result;
}
function verifyEnvelope(envelope){
 demand(envelope?.schema==='reader-local-attestation-v1'&&envelope.payload?.schema===SCHEMA,'INVALID_RECEIPT');
 demand(hex(envelope.digest)&&envelope.digest===objHash(envelope.payload),'BAD_RECEIPT_DIGEST');
 return envelope.payload;
}
function receipts(root,policy){
 const found=new Map(),authorizedFiles={};
 for(const rel of policy.receipts||[]){
  const p=verifyEnvelope(JSON.parse(fs.readFileSync(safe(root,rel))));
  const preUiPreview=p.implementationSha256===PRE_UI_IMPLEMENTATION_SHA256&&p.channel==='preview'&&p.entry?.startsWith('reader/preview/');
  demand(p.eligible===true&&(p.implementationSha256===implementationHash()||preUiPreview)&&hex(p.subjectSha256)&&p.subjectSha256===objHash(p.subject),'STALE_RELEASE_RECEIPT');
  demand(p.entry&&/^reader\/[A-Za-z0-9_./-]+\/index\.html$/.test(p.entry)&&!p.entry.includes('..'),'INVALID_RECEIPT_ENTRY');
  demand(!found.has(p.subject.bookId),'DUPLICATE_RECEIPT');found.set(p.subject.bookId,p);
  demand(['preview','production'].includes(p.channel),'BAD_CHANNEL');
  if(p.channel==='preview')demand(p.authorization&&hex(p.authorization.sha256)&&p.authorization.explicit===true&&p.entry.startsWith('reader/preview/'),'PREVIEW_NOT_AUTHORIZED');
  else{
   demand(!p.entry.startsWith('reader/preview/')&&['release','deployed','device'].includes(p.phase),'NOT_RELEASE_ELIGIBLE');
   demand(objHash(Object.keys(p.checks||{}).sort())===objHash(legacy.RULES.slice().sort()),'RECEIPT_EXACT_60_REQUIRED');
   demand(p.scans===p.subject.range[1]-p.subject.range[0]+1&&p.knownSourceDefects===0,'INCOMPLETE_RECEIPT');
   for(const k of ['inventory','second','resolutions','boundaries','display','checks','corrections','lock'])demand(hex(p.evidenceIndex?.[k]),'MISSING_EVIDENCE_DIGEST '+k);
   for(const id of legacy.RULES){const c=p.checks[id];demand(c&&['not_run','passed','not_applicable'].includes(c.status),'BAD_RECEIPT_CHECK '+id);
    if(!['G8-03','G8-04'].includes(id))demand(['passed','not_applicable'].includes(c.status),'CERTIFICATE_CHECK_MISSING '+id);
    if(c.status==='passed'||c.status==='not_applicable')demand(hex(c.evidenceSha256),'RECEIPT_EVIDENCE_MISSING '+id);
    if(c.status==='not_applicable')demand(!REQUIRED.has(id)&&c.reason?.length>=12,'FORBIDDEN_RECEIPT_NA '+id);
   }
  }
  demand(p.publicFiles?.[p.entry]===p.subject.loaderSha256,'LOADER_RECEIPT_MISSING');
  const folder=p.entry.slice(0,p.entry.lastIndexOf('/')+1);
  for(const[f,h]of Object.entries(p.publicFiles||{})){
   demand(f.startsWith(folder)&&!f.includes('..')&&hex(h),'RECEIPT_OUTSIDE_BOOK_SCOPE');
   demand(!authorizedFiles[f]||authorizedFiles[f]===h,'CONFLICTING_FILE_RECEIPTS');authorizedFiles[f]=h;
  }
 }
 return {found,authorizedFiles};
}
function runtimeFiles(root){const out={};function walk(dir){for(const d of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,d.name),p=path.relative(root,f).split(path.sep).join('/');if(p==='reader/quality')continue;demand(!d.isSymbolicLink(),'PUBLIC_SYMLINK');if(d.isDirectory())walk(f);else if(d.isFile())out[p]=hash(fs.readFileSync(f));}}walk(path.join(root,'reader'));return out;}
function admittedFirstPageUI(root,policy){
 const approved={},newFiles=[];
 for(const [f,pinnedBlob] of Object.entries(FIRST_PAGE_UI_GIT_BLOBS)){
  const base=policy.baseline.files[f];demand(hex(base),'FIRST_PAGE_UI_BASELINE_MISSING '+f);
  const data=fs.readFileSync(safe(root,f)),sha=hash(data);
  if(sha===base)continue;
  const gitBlob=crypto.createHash('sha1').update('blob '+data.length+String.fromCharCode(0)).update(data).digest('hex');
  demand(gitBlob===pinnedBlob,'FIRST_PAGE_UI_BYTES_NOT_REVIEWED '+f);
  approved[f]=sha;newFiles.push(f);
 }
 demand(newFiles.length===0||newFiles.length===Object.keys(FIRST_PAGE_UI_GIT_BLOBS).length,'FIRST_PAGE_UI_PARTIAL_RELEASE');
 if(newFiles.length){
  const uk=fs.readFileSync(safe(root,'reader/british-interiors/full/index.html'),'utf8');
  const generic=fs.readFileSync(safe(root,'reader/library/read.html'),'utf8');
  demand(uk.includes('id="firstPageButton"')&&uk.includes("sendWindow(1,{navigate:true,itemIndex:0,size:current.size})"),'UK_FIRST_PAGE_CONTROL_MISSING');
  demand(generic.includes("function goToBeginning()")&&generic.includes("$('firstPageButton').onclick=goToBeginning")&&generic.includes("$('firstPageButton').hidden=BOOK_ID==='wh1'"),'GENERIC_FIRST_PAGE_CONTROL_MISSING');
  demand(uk.includes("const TRUSTED_ENGINE_SHA256='580e233afe48319518b02c1a0c57446f68e339b4fb9c5db43c7a06c909b271ca'"),'UK_PRIVATE_ENGINE_IDENTITY_CHANGED');
 }
 return approved;
}
function validateRepository(root=ROOT){
 const result=legacy.validate(root),errors=result.errors;result.contentCertification=false;
 try{
  const policy=JSON.parse(fs.readFileSync(path.join(root,'reader/quality/release-policy.json'))),reg=JSON.parse(fs.readFileSync(path.join(root,'reader/quality/registry.json')));
  demand(policy.schema==='reader-release-policy-v2'&&policy.standardFileId===legacy.ID,'INVALID_RELEASE_POLICY');
  demand(objHash({baseline:policy.baseline,trustedKeys:policy.trustedKeys})===TRUST_ANCHOR,'TRUST_ANCHOR_CHANGED');
  const current=runtimeFiles(root),{found:certificateMap,authorizedFiles}=receipts(root,policy),authorizedUI=admittedFirstPageUI(root,policy);
  for(const [f,h]of Object.entries(current))demand(h===policy.baseline.files[f]||h===authorizedFiles[f]||h===authorizedUI[f],'UNAUTHORIZED_READER_CHANGE '+f);
  for(const f of Object.keys(policy.baseline.files))demand(current[f],'FROZEN_READER_REMOVED '+f);
  for(const b of reg.books){const rep=JSON.parse(fs.readFileSync(safe(root,b.report))),identity=objHash({book:b,artifact:rep.privateArtifact||rep.artifactAudit||null});
   if(policy.baseline.books[b.id]===identity&&b.stage==='draft'&&!rep.claimsCompleted)continue;
   const p=certificateMap.get(b.id);demand(p&&p.entry===b.entry&&p.bookRecordSha256===objHash(b)&&p.reportSha256===hash(fs.readFileSync(safe(root,b.report)))&&p.subject.loaderSha256===current[b.entry],'NO_MATCHING_RELEASE_CERTIFICATE '+b.id);
   demand((rep.privateArtifact?.sha256||rep.artifactAudit?.sourceSha256)===p.subject.artifactSha256,'ARTIFACT_CERTIFICATE_MISMATCH');
   if(p.channel==='preview')demand(b.stage==='draft'&&!rep.claimsCompleted,'PREVIEW_CANNOT_BE_COMPLETE');
   else demand(b.stage!=='draft','PRODUCTION_STAGE_MISMATCH');
   if(['completed','iphone_verified'].includes(b.stage))demand(['deployed','device'].includes(p.phase)&&p.checks['G8-03'].status==='passed','PUBLICATION_NOT_READ_BACK');
   if(b.stage==='iphone_verified')demand(p.phase==='device'&&p.checks['G8-04'].status==='passed','DEVICE_NOT_VERIFIED');
  }
  for(const f of Object.keys(authorizedFiles))demand(current[f]===authorizedFiles[f],'RECEIPT_ASSET_MISSING '+f);
  result.inheritedUnverified=Object.keys(policy.baseline.books).length;
 }catch(e){errors.push(e.message);}
 return result;
}
if(require.main===module){
 const [command,file,phase]=process.argv.slice(2);let result;
 try{result=command==='repo'?validateRepository(file||ROOT):command==='check'?validateBundle(file,{phase:phase||'prepare'}):{errors:['Usage: reader-release-control.cjs repo [root] | check manifest.json [prepare|release|deployed|device]']};}catch(e){result={errors:[e.message]};}
 console.log(JSON.stringify(result,null,2));if(result.errors.length)process.exitCode=1;
}
module.exports={hash,stable,objHash,safe,bytes,json,extract,textFields,originals,replay,anomalies,validateBundle,validateRepository,verifyEnvelope,runtimeFiles,receipts,admittedFirstPageUI,implementationHash,SCHEMA};
