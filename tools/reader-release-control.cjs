#!/usr/bin/env node
'use strict';
// Evidence verifier. No network, OCR, or writes to a user's live reader.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const legacy=require('./reader-quality-gate.cjs');
const ROOT=process.env.READER_AUDIT_ROOT||path.resolve(__dirname,'..'),SCHEMA='reader-release-v2';
const TRUST_ANCHOR='76cf9d19508fcde941c2051f7c8a617e46599abf2116ea42d983150c7f9223ca';
const IMPLEMENTATION=['reader-release-control.cjs','reader-private-pipeline.cjs','reader-publish-stage.cjs','reader-quality-gate.cjs','reader-artifact-audit.cjs','reader-preview-consent.cjs','reader-unified-handoff.cjs','reader-scoped-review.cjs','reader-source-pages.cjs','reader-shelf-prior.cjs','reader-shelf-register.py','reader_shelf_probe.py'];
// Pre-feature identity retained only for old evidence-scoped unverified preview receipts.
const PRE_UI_IMPLEMENTATION_SHA256='ec32213f08ac067016c51c461037feeda1ea5446c64340e82cbd8b6c501618af';
// The 2026-11-15 Nine Stories preview-only receipt was issued before the exact mobile UI pin update.
// It remains an uncertified preview; it is never valid for a production release.
const NINE_STORIES_PREVIEW_ISSUANCE_SHA256='bcfa5f214bc6bb1a0f144cbb231af93cd4dc2f47e53bcdbddf2089c2f66c14d4';
/* Immutable, exact-scope evidence from earlier preview issuances.
   This is NOT a production compatibility bypass. A matching digest alone
   never certifies OCR, and actual loader/report/registry bytes are checked
   later by validateRepository. Keep existing preview evidence unchanged. */
const HISTORIC_DRAFT_PREVIEWS=Object.freeze({
 'nine-stories-001-020-preview':Object.freeze({
  entry:'reader/preview/nine-stories-001-020/index.html',
  issuer:'bcfa5f214bc6bb1a0f144cbb231af93cd4dc2f47e53bcdbddf2089c2f66c14d4',
  receiptDigest:'b65efebaafaa5bff6d071a24821e5f1a91edac030d6cbbc3c03883f12a33b7b1'
 }),
 'nine-stories-021-040-preview':Object.freeze({
  entry:'reader/preview/nine-stories-021-040/index.html',
  issuer:'a55d8e82985dda58db0ca93565ac693fd6375f8c4fa02c2d38bd82912720391b',
  receiptDigest:'4251e36621ec8fda3d3c924bfaf05261c1d3d4c58f9b2bdffd88191f04b12807'
 })
});
function previewIssuerCompatible(p,envelope){
 // Versioned preview-only protocol: existing receipt digest is immutable,
 // all item paths, subject hashes, linked reports and actual public bytes
 // must still match. Issuer changes cannot turn this into production.
 return p.previewProtocol==='reader-immutable-preview-v3'&&
  p.channel==='preview'&&p.phase==='preview'&&p.contentCertified===false&&
  p.eligible===true&&hex(p.implementationSha256)&&
  p.authorization?.explicit===true&&hex(p.authorization.sha256)&&
  /^reader\/preview\/[A-Za-z0-9_./-]+\/index\.html$/.test(p.entry||'')&&
  !p.entry.includes('..')&&p.subject?.bookId===p.bookId&&
  hex(p.subject?.artifactSha256)&&hex(p.subject?.loaderSha256)&&
  hex(p.subjectSha256)&&p.subjectSha256===objHash(p.subject)&&
  hex(envelope.digest);
}

// Exact UI-only byte authorization for the user's 2026-11-14 first-page request.
// No OCR, device, or unscoped compatibility certification is inferred.
const FIRST_PAGE_UI_GIT_BLOBS=Object.freeze({
 'reader/british-interiors/full/index.html':'4e83af9c9caf975ceb28a18f5201bd26ef500ada'
});
// Exact byte-pinned public navigation only. This does not certify OCR or source files.
const BOOKSHELF_NAV_UI_GIT_BLOBS=Object.freeze({
 'reader/furniture/01-20/index.html':'8e3b3fea0cd67d64f8153f163628a0898186d86b',
 'reader/furniture/21-40/index.html':'04ab41fe54d2a7b0363ea2248a07e2f72cfe23f5',
 'reader/furniture/41-60/index.html':'2b1de6206aa96955878fe325d1ffbd889c965157',
 'reader/furniture/61-80/index.html':'66d992182b0b0c8adcf25004acb70e3ea01b17d4',
 'reader/furniture/81-100/index.html':'de367028d3280ea5df0ed0b27a8870ecc023e3c1',
 'reader/furniture/101-120/index.html':'ba2a8368c92648188cad613a958aae282af2335b'
});
// Pin both public WH1 hosts separately from private book content.
const SHARED_SHELF_UI_GIT_BLOBS=Object.freeze({
 'reader/wh1/all/index.html':'1e931004f0a0619cc2940287181fceb8daf5d054',
 'reader/library/read.html':'bf7d17add718dfb56f5968cf1985de7b23cd45fa'
});
// Exact public-only bookshelf ordering assets. Private ZIP/OCR files are never authorized.
const BOOKSHELF_TITLE_ORDER_UI_GIT_BLOBS=Object.freeze({
 'reader/library/app.js':'08047be27b256a5981e805d345a631327a1de623',
 'reader/library/index.html':'5278def2a0ef742bfc416e6461fef5476ee4754c',
 'reader/library/sw.js':'9c08b0509781bcf4c11731d88e2ef0820a1646f5'
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
  for(const [i,r]of(Array.isArray(p.ruby)?p.ruby:[]).entries()){if(r){put('ruby/'+i+'/base',r.base);put('ruby/'+i+'/reading',r.reading??r.rt);}}
  for(const [i,n]of(Array.isArray(p.notes)?p.notes:[]).entries())put('notes/'+i+'/text',typeof n==='string'?n:n?.text);
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
  demand(/^(reading_text|title|(?:figures\/\d+\/(?:caption|display_title))|(?:boxed_articles\/\d+\/(?:text|title))|(?:blocks\/\d+\/text)|(?:ruby\/\d+\/(?:base|reading|rt))|(?:notes\/\d+\/text))$/.test(e.pointer||''),'UNSAFE_CORRECTION_FIELD');
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
function validateSourceEvidence(root,m,pages,index,sourceReview){
  const first=sourceReview.queue[0];
  if(first){
   const issue=first.issues[0];
   throw Error(issue.reason+' '+(issue.field||first.scan));
  }
  const fields=textFields(pages),boundaries=json(root,m.boundaries);
  const expected=[];for(let s=m.range[0]-1;s<=m.range[1];s++)expected.push(s+'>'+String(s+1));
  demand(Array.isArray(boundaries.items)&&objHash(boundaries.items.map(x=>x.id).sort())===objHash(expected.sort()),'BOUNDARY_COVERAGE');
  for(const b of boundaries.items){const [left,right]=b.id.split('>').map(Number);if(index[left])demand(b.leftSourceSha256===index[left],'BOUNDARY_SOURCE_MISMATCH');if(index[right])demand(b.rightSourceSha256===index[right],'BOUNDARY_SOURCE_MISMATCH');demand(b.reviewedBy&&b.reason&&b.resolved===true&&typeof b.leftTail==='string'&&typeof b.rightHead==='string'&&(b.kind==='book_start'?b.leftSourceSha256===null:hex(b.leftSourceSha256))&&(b.kind==='book_end'?b.rightSourceSha256===null:hex(b.rightSourceSha256)),'UNVERIFIED_BOUNDARY');}
  return {fields,boundaries};
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
  const sourceReview=require('./reader-source-pages.cjs').fromBundle(root,m,pages,index,events,raw);
  result.sourceReview=sourceReview;
  if(phase==='preview'){
   const a=json(root,m.previewAuthorization);
   if(a.schema==='reader-preview-consent-v3'){
    const scoped=require('./reader-scoped-review.cjs').validate(root,m,pages,index,legacy.RULES);
    const accepted=require('./reader-preview-consent.cjs').validateV3(a,{subject:result.subject,manifest:m,
     conversation:json(root,a.conversationEvidence),assessment:json(root,a.assessmentEvidence),rules:legacy.RULES,scoped});
    const checks=json(root,m.checks);
    result.checks=Object.fromEntries(legacy.RULES.map(id=>[id,{status:checks[id].status}]));
    result.previewAssessment={sha256:accepted.assessmentSha256,statusCounts:accepted.assessmentStatusCounts,
     unresolvedIds:accepted.unresolvedAssessmentIds,canonicalGateCertified:false};
    result.reviewState=accepted.reviewState;result.reviewScope=accepted.reviewScope;result.previewDisplay=accepted.displayState;
    result.sourceEvidenceIndex=scoped.sourceEvidenceIndex;
    result.canonicalFields=Object.keys(textFields(pages)).length;
    result.authorization={sha256:m.previewAuthorization.sha256,explicit:true,schema:a.schema,
     conversationEvidenceSha256:accepted.conversationEvidenceSha256,assessmentSha256:accepted.assessmentSha256};
   }else if(a.schema==='reader-preview-consent-v2'){
    // Reuse the real source checks, stopping before display and final sixty gates.
    // This certifies their consistency, not completion of every source QA item.
    const {fields}=validateSourceEvidence(root,m,pages,index,sourceReview);
    const accepted=require('./reader-preview-consent.cjs').validateV2(a,{subject:result.subject,manifest:m,
     conversation:json(root,a.conversationEvidence),assessment:json(root,a.assessmentEvidence),rules:legacy.RULES});
    const checks=json(root,m.checks);
    demand(objHash(Object.keys(checks).sort())===objHash(legacy.RULES.slice().sort())&&
     Object.values(checks).every(c=>['not_run','passed','failed','needs_source_review','not_applicable'].includes(c?.status)),
     'PREVIEW_EXACT_60_STATES_REQUIRED');
    // Preserve the formal check states; the limited source assessment is separate.
    result.checks=Object.fromEntries(legacy.RULES.map(id=>[id,{status:checks[id].status}]));
    result.previewAssessment={sha256:accepted.assessmentSha256,statusCounts:accepted.assessmentStatusCounts,
     unresolvedIds:accepted.unresolvedAssessmentIds,canonicalGateCertified:false};
    result.reviewState=accepted.reviewState;
    result.sourceEvidenceIndex=Object.fromEntries(require('./reader-preview-consent.cjs').SOURCE_KEYS.map(k=>[k,m[k].sha256]));
    result.canonicalFields=Object.keys(fields).length;
    result.authorization={sha256:m.previewAuthorization.sha256,explicit:true,schema:a.schema,
     conversationEvidenceSha256:accepted.conversationEvidenceSha256,assessmentSha256:accepted.assessmentSha256};
   }else{
    // Only a named v1 request, or the exact historical five-field v1 shape,
    // is recognized. Unknown schema values must never fall through to v1.
    const legacyKeys=['explicit','requestedBy','requestText','at','artifactSha256'];
    const historicalV1=a.schema===undefined&&Object.keys(a).length===legacyKeys.length&&legacyKeys.every(k=>Object.hasOwn(a,k));
    demand(a.schema==='reader-preview-authorization-v1'||historicalV1,'UNKNOWN_PREVIEW_AUTHORIZATION_SCHEMA');
    // Historical v1 authorization conditions are unchanged.
    demand(a.explicit===true&&a.requestedBy&&a.requestText?.length>=8&&Number.isFinite(Date.parse(a.at))&&a.artifactSha256===m.artifact.sha256,'EXPLICIT_PREVIEW_REQUEST_REQUIRED');
    result.authorization={sha256:m.previewAuthorization.sha256,explicit:true};
    result.checks=Object.fromEntries(legacy.RULES.map(id=>[id,{status:'not_run'}]));
   }
   result.eligible=true;result.contentCertified=false;return result;
  }
  const {fields}=validateSourceEvidence(root,m,pages,index,sourceReview),display=json(root,m.display);
  require('./reader-scoped-review.cjs').verifyNovelStarts(root,m,pages,profile,template,display,fields);
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
  const envelope=JSON.parse(fs.readFileSync(safe(root,rel))),p=verifyEnvelope(envelope);
  const preUiPreview=p.implementationSha256===PRE_UI_IMPLEMENTATION_SHA256&&p.channel==='preview'&&p.entry?.startsWith('reader/preview/');
  const priorNineStoriesPreview=p.implementationSha256===NINE_STORIES_PREVIEW_ISSUANCE_SHA256&&p.channel==='preview'&&p.entry==='reader/preview/nine-stories-001-020/index.html'&&p.subject?.bookId==='nine-stories-001-020-preview';
  const historical=HISTORIC_DRAFT_PREVIEWS[p.bookId];
  const exactHistoric=!!historical&&p.channel==='preview'&&p.phase==='preview'&&p.contentCertified===false&&
    p.entry===historical.entry&&p.implementationSha256===historical.issuer&&envelope.digest===historical.receiptDigest;
  const scopedFuturePreview=previewIssuerCompatible(p,envelope);
  demand(p.eligible===true&&(p.implementationSha256===implementationHash()||preUiPreview||priorNineStoriesPreview||exactHistoric||scopedFuturePreview)&&hex(p.subjectSha256)&&p.subjectSha256===objHash(p.subject),'STALE_RELEASE_RECEIPT');
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
  const shared=fs.readFileSync(safe(root,'reader/library/wh1-exact-pagination.js'),'utf8');
  demand(uk.includes('id="firstPageButton"')&&uk.includes("sendWindow(1,{navigate:true,itemIndex:0,size:current.size})"),'UK_FIRST_PAGE_CONTROL_MISSING');
  demand(uk.includes('uk-wh1-text-geometry-20261115')&&
    uk.includes('#reader-main .sheet,#measure-sheet{padding:10px 12px!important}')&&
    uk.includes('#reader-main .segment,#measure-sheet .segment{padding:0!important}')&&
    uk.includes('#reader-main .text-flow,#measure-sheet .text-flow{width:calc(100% - 30px)!important;padding:0!important}')&&
    uk.includes('uk-continuous-paragraph-flow-v1')&&
    uk.includes('   installUKContinuousParagraphFlow();')&&
    uk.includes('   installUKNearFullTextBoundary();')&&uk.includes('textDepth++')&&
    uk.includes('originalFragments.apply(this,args)')&&
    !uk.includes('installUKColumnWordGuard()')&&!uk.includes('uk-atomic-word'),
    'UK_WH1_MATCHED_TEXT_GEOMETRY_MISMATCH');
  demand(shared.includes("first.textContent='最初へ'")&&shared.includes("type:'bookStart'"),'SHARED_FIRST_PAGE_CONTROL_MISSING');
  demand(uk.includes("const TRUSTED_ENGINE_SHA256='580e233afe48319518b02c1a0c57446f68e339b4fb9c5db43c7a06c909b271ca'"),'UK_PRIVATE_ENGINE_IDENTITY_CHANGED');
 }
 return approved;
}
function admittedBookshelfNavUI(root,policy){
 const approved={};
 for(const [f,pin] of Object.entries(BOOKSHELF_NAV_UI_GIT_BLOBS)){
  const baseline=policy.baseline.files[f];demand(hex(baseline),'BOOKSHELF_NAV_BASELINE_MISSING '+f);
  const data=fs.readFileSync(safe(root,f)),sha=hash(data);
  if(sha===baseline)continue;
  const gitBlob=crypto.createHash('sha1').update('blob '+data.length+String.fromCharCode(0)).update(data).digest('hex');
  demand(gitBlob===pin,'BOOKSHELF_NAV_UI_BYTES_NOT_REVIEWED '+f);
  const html=data.toString('utf8');
  demand(html.includes('id="bookshelfNav"')&&html.includes('id="backToBookshelf" href="../../library/"')&&html.includes('id="bookshelf-nav-ui-v1"'),'BOOKSHELF_NAV_CONTROL_MISSING '+f);
  approved[f]=sha;
 }
 // A layout-only resource: the private original scans and the transcription enter it on the reading device.
 const wh3Layout='reader/library/wh3-format.html';
 if(fs.existsSync(safe(root,wh3Layout))){
  const bytes=fs.readFileSync(safe(root,wh3Layout)),digest=hash(bytes),html=bytes.toString('utf8');
  demand(digest==='092855ad74f192b31b7adbb1c1659a512fc7e5790d6c52ad4b6e3321a51373a1'&&html.includes('<!--WH3_PRIVATE_DATA-->')&&html.includes('<!--WH3_PRIVATE_STRUCTURE-->')&&!/data:image\/[^;]+;base64,/.test(html),'WH3_PUBLIC_LAYOUT_NOT_REVIEWED');
  approved[wh3Layout]=digest;
 }
 let sharedChanged=0;
 for(const [f,pin] of Object.entries(SHARED_SHELF_UI_GIT_BLOBS)){
  const base=policy.baseline.files[f];demand(hex(base),'SHARED_SHELF_BASELINE_MISSING '+f);
  const data=fs.readFileSync(safe(root,f)),sha=hash(data);
  if(sha===base)continue;
  const blob=crypto.createHash('sha1').update('blob '+data.length+String.fromCharCode(0)).update(data).digest('hex');
  demand(blob===pin,'SHARED_SHELF_UI_BYTES_NOT_REVIEWED '+f);
  if(f==='reader/library/read.html'&&data.includes('function wh3FrameDocument('))demand(approved[wh3Layout],'WH3_LAYOUT_MISSING');
  const href=f==='reader/library/read.html'?'./':'../../library/',html=data.toString('utf8');
  demand(html.includes('<nav id="bookshelfNav"')&&html.includes('id="backToBookshelf" href="'+href+'"')&&html.includes('id="bookshelf-nav-ui-v1"'),'SHARED_SHELF_CONTROL_MISSING '+f);
  approved[f]=sha;sharedChanged++;
 }
 demand(sharedChanged===0||sharedChanged===Object.keys(SHARED_SHELF_UI_GIT_BLOBS).length,'SHARED_SHELF_PARTIAL_RELEASE');
 if(sharedChanged){
  // The two public hosts are built into multiple Pages files. Admit ONLY the
  // exact deterministic results of their trusted build scripts, not an arbitrary
  // edit to a generated reader/diagnostic/book-report entry.
  const index=fs.readFileSync(safe(root,'reader/wh1/all/index.html'),'utf8');
  const read=fs.readFileSync(safe(root,'reader/library/read.html'),'utf8');
  // The exact source blob is pinned above: validate the intended
  // furniture-only public start button, never changing private OCR or scans.
  demand(read.includes('id="goToBookStart" type="button"')&&
    read.includes("hidden=!/洋家具の歴史と様式/.test(bookTitle)")&&
    read.includes("if(d.type==='bookStart'){goToBookStart();return;}")&&
    read.includes("if(activeSegment===0)issueChild('goto',{destination:{mode:'first'}})")&&
    read.includes("else openSegment(0,{mode:'first'})")&&
    read.includes("$('goToBookStart').addEventListener('click',goToBookStart)"),
    'FURNITURE_BOOK_START_CONTROL_MISSING');
  const viewport='<script src="./wh1-figure-viewport-v9.js?v=figure-viewport-v9-20261110"></script>';
  const check='<script src="./wh1-display-check-v9.js?revision=display-check-v9-1-20261110"></script>';
  demand(index.includes(viewport)&&index.includes('<body>')&&index.includes('<title>'),'WH1_DERIVATIVE_SOURCE_INVALID');
  const fallback='<aside id="wh1-display-check-fallback" role="status" '+
    'style="position:fixed;z-index:45;right:8px;top:calc(6px + env(safe-area-inset-top));'+
    'max-width:128px;padding:4px 7px;border:1px solid #c6d8d2;border-radius:7px;'+
    'background:#fffdf7;color:#233539;font:11px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;'+
    'pointer-events:none">確認9.1 · 確認待ち</aside>';
  const checkHtml=index.replace(viewport,viewport+'\n'+check)
    .replace('<title>','<title>確認9.1｜')
    .replace('<body>','<body>\n'+fallback);
  const wh1Report={revision:'figure-viewport-v9-20261110',entry:'figure-repair-v9.html',
    aliases:['figure-repair-v8.html'],index_sha256:hash(index),private_book_modified:false,
    verification:'Build checks only. Browser and real-iPhone verification are separate.'};
  const navPager='<script src="./wh1-exact-pagination.js"></script>';
  const libraryScripts='<script src="./wh1-pager-v9.js?v=wh1-library-v9-20261110"></script>\n'+
    '<script src="./wh1-figure-viewport-v9.js?v=wh1-library-v9-20261110"></script>\n'+
    '<script src="./wh1-display-check-v9.js?revision=display-check-v9-1-20261110"></script>';
  demand(read.split(navPager).length===2,'LIBRARY_DERIVATIVE_PAGER_MISSING');
  const library=read.replace(navPager,libraryScripts).replace('<title>','<title>確認9.1｜')
    .replace('<body>','<body>\n'+fallback);
  // Reuse the WH1 pager for an explicitly declared canonical edition. Pin both identical copies.
  const pager='reader/wh1/all/wh1-exact-pagination.js',pagerCopy='reader/library/wh1-pager-v9.js';
  const pagerDigest=hash(fs.readFileSync(safe(root,pager)));
  if(pagerDigest!==policy.baseline.files[pager]){
   demand(pagerDigest==='95ba49ffbf87e8fb9f8e5510a048a71b1019bc759c6dea1bdfa1ec4349a3cc83'&&hash(fs.readFileSync(safe(root,pagerCopy)))===pagerDigest,'PINNED_WH1_PAGER_MISMATCH');
   approved[pager]=pagerDigest;approved[pagerCopy]=pagerDigest;
  }
  const copyPaths=['wh1-exact-pagination.js','wh1-figure-viewport-v9.js','wh1-display-check-v9.js'];
  const copyDests=['wh1-pager-v9.js','wh1-figure-viewport-v9.js','wh1-display-check-v9.js'];
  const copied=Object.fromEntries(copyDests.map((dest,i)=>[dest,hash(fs.readFileSync(safe(root,'reader/wh1/all/'+copyPaths[i])))]));
  const libraryReport={revision:'wh1-library-v9-20261110',entry:'read-wh1-v9.html',
    reader_sha256:hash(library),modules_sha256:copied,private_book_modified:false,
    storage:'Existing LibraryDB and BOOK_POSITION_<original book id> retained',
    verification:'Build checks only. Browser and real-iPhone verification are separate.'};
  const expected={
    'reader/wh1/all/figure-repair-v9.html':index,
    'reader/wh1/all/figure-repair-v8.html':index,
    'reader/wh1/all/figure-check-v9-1.html':checkHtml,
    'reader/wh1/all/figure-repair-v9-build.json':JSON.stringify(wh1Report,null,2)+'\n',
    'reader/wh1/all/figure-repair-v8-build.json':JSON.stringify(wh1Report,null,2)+'\n',
    'reader/library/read-wh1-v9.html':library,
    'reader/library/wh1-library-v9-build.json':JSON.stringify(libraryReport,null,2)+'\n'
  };
  for(const [f,expectedText] of Object.entries(expected)){
   demand(hex(policy.baseline.files[f]),'SHARED_SHELF_DERIVATIVE_BASELINE_MISSING '+f);
   const actual=fs.readFileSync(safe(root,f));
   demand(actual.equals(Buffer.from(expectedText,'utf8')),'SHARED_SHELF_DERIVATIVE_NOT_REPRODUCIBLE '+f);
   if(hash(actual)!==policy.baseline.files[f])approved[f]=hash(actual);
  }
 }
 // The sort revision changes only the publicly served bookshelf UI and cache.
 // Require all three exact files together; never waive frozen book readers.
 let sortChanged=0;
 for(const [f,pin] of Object.entries(BOOKSHELF_TITLE_ORDER_UI_GIT_BLOBS)){
  const baseline=policy.baseline.files[f];demand(hex(baseline),'BOOKSHELF_SORT_BASELINE_MISSING '+f);
  const data=fs.readFileSync(safe(root,f)),sha=hash(data);
  if(sha===baseline)continue;
  const gitBlob=crypto.createHash('sha1').update('blob '+data.length+String.fromCharCode(0)).update(data).digest('hex');
  demand(gitBlob===pin,'BOOKSHELF_SORT_UI_BYTES_NOT_REVIEWED '+f);
  approved[f]=sha;sortChanged++;
 }
 demand(sortChanged===0||sortChanged===Object.keys(BOOKSHELF_TITLE_ORDER_UI_GIT_BLOBS).length,
   'BOOKSHELF_SORT_UI_PARTIAL_RELEASE');
 if(sortChanged){
  const app=fs.readFileSync(safe(root,'reader/library/app.js'),'utf8');
  const index=fs.readFileSync(safe(root,'reader/library/index.html'),'utf8');
  const sw=fs.readFileSync(safe(root,'reader/library/sw.js'),'utf8');
  // Both exact, byte-pinned UI revisions keep the same alphabetized shelf.
  // The November 15 URL refresh updates only cache/version identifiers.
  const oldSortEntry=index.includes('app.js?v=bookshelf-title-order-v2-20261114')&&
    sw.includes('private-bookshelf-shell-v12-title-order')&&
    sw.includes('app.js?v=bookshelf-title-order-v2-20261114');
  const row22Entry=index.includes('app.js?v=bookshelf-uk-row22-20261115')&&
    sw.includes('private-bookshelf-shell-v13-uk-row22-20261115')&&
    sw.includes('app.js?v=bookshelf-uk-row22-20261115');
  const safeBottomEntry=index.includes('app.js?v=bookshelf-uk-safe-bottom-v2-20261115')&&
    sw.includes('private-bookshelf-shell-v14-uk-safe-bottom-v2-20261115')&&
    sw.includes('app.js?v=bookshelf-uk-safe-bottom-v2-20261115')&&
    app.includes('&v=uk-safe-bottom-v2-20261115');
  const columnFit24Entry=index.includes('app.js?v=bookshelf-uk-column-fit24-20261115')&&
    sw.includes('private-bookshelf-shell-v15-uk-column-fit24-20261115')&&
    sw.includes('app.js?v=bookshelf-uk-column-fit24-20261115')&&
    app.includes('&v=uk-column-fit24-20261115');
  // Exact WH1 screenshot geometry, without changing source OCR or figure pager.
  const wh1GeometryEntry=index.includes('app.js?v=bookshelf-uk-wh1-text-geometry-v1-20261115')&&
    sw.includes('private-bookshelf-shell-v20-uk-wh1-text-geometry-v1-20261115')&&
    sw.includes('app.js?v=bookshelf-uk-wh1-text-geometry-v1-20261115')&&
    app.includes('&v=uk-wh1-text-geometry-v1-20261115');
  const nineStoriesEntry=index.includes('app.js?v=bookshelf-nine-stories-286-20261121')&&
    sw.includes('private-bookshelf-shell-v21-nine-stories-286-20261121')&&
    sw.includes('app.js?v=bookshelf-nine-stories-286-20261121')&&app.includes("id:'nine-stories'");
  const inputUpdate=index.includes('app.js?v=bookshelf-reader-input-20261121')&&
    sw.includes('private-bookshelf-shell-v22-reader-input-20261121')&&sw.includes('app.js?v=bookshelf-reader-input-20261121');
  const deviceSave=index.includes('app.js?v=bookshelf-device-save-20261121')&&
    sw.includes('private-bookshelf-shell-v23-device-save-20261121')&&sw.includes('app.js?v=bookshelf-device-save-20261121');
  const registration=index.includes('app.js?v=bookshelf-registration-20261122')&&sw.includes('private-bookshelf-shell-v24-registration-20261122')&&sw.includes('shelf-registration.mjs');
  if(registration){
    const files={
      "reader/library/storage.js": "91f1b91935626c1a33f8c97dab0175c9ddf6cd4a7b98b89798d709ef5b1ce746",
      "reader/library/shelf-registration.mjs": "55e517270784d0861d0f80c16ff117960f577ea9dcba3c464a86c494bfe41621",
      "reader/wh1/full/index.html": "389750d3d6cd32459a8af698595ae1e48e5819aef79aa3c1f8754fa2883ba381"
};
    for(const [name,pin] of Object.entries(files)){
      const bytes=fs.readFileSync(safe(root,name));demand(hash(bytes)===pin,'REGISTRATION_FILE_CHANGED '+name);approved[name]=pin;
    }
    demand(app.includes('await LibraryDB.catalogFilter(')&&app.includes('await writer.commit(done,async blob=>'),'REGISTRATION_ROUTE_MISSING');
    require('node:child_process').execFileSync(process.execPath,['--input-type=module','-e',"import fs from 'node:fs';import {parseLedger} from './reader/library/shelf-registration.mjs';await parseLedger(JSON.parse(fs.readFileSync('reader/quality/shelf-registration.json')));"],{cwd:root,stdio:'pipe'});
  }
  if(inputUpdate||deviceSave){
   const storagePath='reader/library/storage.js',source=fs.readFileSync(safe(root,storagePath));
   const blob=crypto.createHash('sha1').update('blob '+source.length+String.fromCharCode(0)).update(source).digest('hex');
   demand(blob==='5f8cb8637eee1d09363962c24830e02d1b5c556f'&&hex(policy.baseline.files[storagePath]),'BOOKSHELF_EDITION_STORAGE_BYTES_NOT_REVIEWED');
   demand(app.includes('await hasNewEdition(book)')&&app.includes('await writer.commit(done,async blob=>'),'BOOKSHELF_EDITION_REFRESH_MISSING');
   const reader=fs.readFileSync(safe(root,'reader/library/read.html'),'utf8');
   demand(reader.includes("manifest?.readerInteractions==='native-pinch-toc-v1'")&&reader.includes('d.session===inputSession')&&
    reader.includes("type:'reader-viewport-v8'")&&reader.includes("d.type==='navigateScan'"),'BOOKSHELF_READER_INPUT_BRIDGE_MISSING');
   approved[storagePath]=hash(source);
  }
  demand(app.includes('function compareBookTitles(a, b)')&&
    app.includes('const matching=books.filter(b=>b.title.toLowerCase().includes(q)).sort(compareBookTitles)')&&
    (oldSortEntry||row22Entry||safeBottomEntry||columnFit24Entry||wh1GeometryEntry||nineStoriesEntry||inputUpdate||deviceSave||registration),'BOOKSHELF_SORT_UI_CONTROL_MISSING');
 }
 return approved;
}
function validateRepository(root=ROOT){
 const result=legacy.validate(root),errors=result.errors;result.contentCertification=false;
 try{
  const policy=JSON.parse(fs.readFileSync(path.join(root,'reader/quality/release-policy.json'))),reg=JSON.parse(fs.readFileSync(path.join(root,'reader/quality/registry.json')));
  demand(policy.schema==='reader-release-policy-v2'&&policy.standardFileId===legacy.ID,'INVALID_RELEASE_POLICY');
  demand(objHash({baseline:policy.baseline,trustedKeys:policy.trustedKeys})===TRUST_ANCHOR,'TRUST_ANCHOR_CHANGED');
  const current=runtimeFiles(root),{found:certificateMap,authorizedFiles}=receipts(root,policy),authorizedUI=admittedFirstPageUI(root,policy),authorizedNav=admittedBookshelfNavUI(root,policy);
  for(const [f,h]of Object.entries(current))demand(h===policy.baseline.files[f]||h===authorizedFiles[f]||h===authorizedUI[f]||h===authorizedNav[f],'UNAUTHORIZED_READER_CHANGE '+f);
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
module.exports={hash,stable,objHash,safe,bytes,json,extract,textFields,originals,replay,anomalies,validateBundle,validateRepository,verifyEnvelope,runtimeFiles,receipts,admittedFirstPageUI,admittedBookshelfNavUI,implementationHash,SCHEMA};
