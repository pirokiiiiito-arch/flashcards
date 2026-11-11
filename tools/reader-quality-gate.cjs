#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..');
const ID='1CngvhZvJPQsGizwmaVKC_old4Vlvxzn2';
const RULES=["G1-01","G1-02","G1-03","G1-04","G1-05","G1-07","G1-08","G1-10","G1-12","G2-01","G2-02","G2-03","G2-04","G2-05","G2-07","G2-11","G3-01","G3-02","G3-03","G3-04","G3-05","G3-06","G3-07","G4-01","G4-02","G4-03","G4-04","G4-05","G4-09","G5-01","G5-02","G5-03","G5-04","G5-05","G5-10","P20","G6-01","G6-02","G6-03","G6-05","G6-09","G6-11","G6-12","P22","P23","G7-01","G7-02","G7-03","G7-04","G7-05","G7-10","G7-12","G8-01","G8-02","G8-03","G8-04","G8-05","G8-07","G8-08","G8-11"];
const STAGES=new Set(['draft','ready_for_publication','completed','iphone_verified']);
const STATES=new Set(['not_run','passed','failed','needs_source_review','not_applicable']);
const NON_NA=new Set(['G1-01','G1-02','G2-05','G3-01','G4-03','G7-01','G7-02','G7-03','G7-04','G8-01','G8-02','G8-03','G8-04','G8-05','G8-07','G8-08']);
function allowed(p){return typeof p==='string'&&/^reader\/[A-Za-z0-9_./-]+$/.test(p)&&!p.includes('..');}
function blobSHA(bytes){const b=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);return crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');}
function read(root,p,errors){if(!allowed(p)){errors.push('INVALID_PATH '+p);return null;}try{return JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));}catch(e){errors.push('MISSING_OR_INVALID_JSON '+p+' '+e.message);return null;}}
function entryPaths(root){
 const out=[],start=path.join(root,'reader');if(!fs.existsSync(start))return out;
 function walk(dir){for(const d of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,d.name);
  if(d.isDirectory()){if(!d.name.startsWith('.'))walk(file);continue;}
  if(!d.isFile())continue;
  const rel=path.relative(root,file).split(path.sep).join('/');
  if(/^reader\/.*\/index\.html$/.test(rel)||rel==='reader/library/read.html')out.push(rel);
 }}walk(start);return out.sort();
}
function standardCheck(s,errors){
 if(!s||s.schema!=='reader-minimum-standard-v1'||s.canonicalGoogleDriveFileId!==ID){errors.push('WRONG_STANDARD');return;}
 const a=s.checkIds;
 if(!Array.isArray(a)||a.length!==60||new Set(a).size!==60||a.some((x,i)=>x!==RULES[i]))errors.push('CANONICAL_60_MISMATCH');
}
function reportCheck(book,rep,errors){
 const prefix='REPORT '+book.id+' ';
 if(!rep||rep.schema!=='reader-quality-report-v1'){errors.push(prefix+'missing');return;}
 if(rep.standardFileId!==ID||rep.bookId!==book.id||rep.entry!==book.entry||rep.stage!==book.stage)errors.push(prefix+'identity mismatch');
 const checks=rep.checks;
 if(!checks||typeof checks!=='object'||Array.isArray(checks)){errors.push(prefix+'check map missing');return;}
 const real=Object.keys(checks).sort(),expected=RULES.slice().sort();
 if(real.length!==60||real.some((x,i)=>x!==expected[i])){errors.push(prefix+'requires all 60 distinct check IDs');return;}
 for(const id of RULES){
  const item=checks[id];if(!item||!STATES.has(item.status)){errors.push(prefix+id+' invalid status');continue;}
  if(item.status==='passed'){
   const p=item.proof;
   if(!p||typeof p.method!=='string'||p.method.trim().length<8||
      typeof p.evidenceRef!=='string'||p.evidenceRef.trim().length<8||
      !/^[0-9a-f]{64}$/.test(p.artifactSha256||'')||
      typeof p.verifiedBy!=='string'||p.verifiedBy.trim().length<2)
     errors.push(prefix+id+' passed without method/evidence/hash/reviewer');
  }
  if(item.status==='not_applicable'&&(NON_NA.has(id)||typeof item.reason!=='string'||
     item.reason.trim().length<12||typeof item.evidenceRef!=='string'||item.evidenceRef.trim().length<8))
    errors.push(prefix+id+' unsupported not_applicable');
  const required=book.stage!=='draft'&&!(book.stage==='ready_for_publication'&&['G8-03','G8-04'].includes(id))&&
    !(book.stage==='completed'&&id==='G8-04');
  if(required&&!['passed','not_applicable'].includes(item.status))
    errors.push(prefix+id+' not passed; cannot be '+book.stage);
 }
 if(book.stage==='draft'&&(rep.claimsCompleted===true||rep.deviceVerification==='passed'))
  errors.push(prefix+'draft cannot claim completion');
 if(book.stage==='iphone_verified'&&rep.deviceVerification!=='passed')
  errors.push(prefix+'real iPhone evidence missing');
 if(book.stage==='completed'&&rep.deviceVerification==='passed')
  errors.push(prefix+'device verification is a separate stage');
 if(!Array.isArray(rep.scanRange)||rep.scanRange.length!==2||!rep.scanRange.every(Number.isInteger)||rep.scanRange[0]<1||rep.scanRange[1]<rep.scanRange[0])
  errors.push(prefix+'invalid scan range');
}
function validate(root=ROOT){
 const errors=[],warnings=[],s=read(root,'reader/quality/standard.json',errors),r=read(root,'reader/quality/registry.json',errors);
 if(!s||!r)return {errors,warnings};
 standardCheck(s,errors);
 if(r.schema!=='reader-release-registry-v1'||r.canonicalGoogleDriveFileId!==ID)errors.push('INVALID_REGISTRY');
 const paths=entryPaths(root),seen=new Set(),legacy=r.legacyFrozenEntries||{},books=r.books||[];
 for(const [p,sha] of Object.entries(legacy)){
  if(!allowed(p)||!/^[0-9a-f]{40}$/.test(sha)){errors.push('INVALID_LEGACY '+p);continue;}
  if(seen.has(p))errors.push('DUPLICATE_ROUTE '+p);seen.add(p);
  if(!paths.includes(p)){errors.push('MISSING_LEGACY '+p);continue;}
  if(blobSHA(fs.readFileSync(path.join(root,p)))!==sha)errors.push('LEGACY_CHANGED '+p+' - migrate to a checked report');
 }
 if(!Array.isArray(books))errors.push('INVALID_BOOKS');
 else for(const b of books){
  if(!b||!allowed(b.entry)||!STAGES.has(b.stage)||!/^[a-z0-9][a-z0-9-]{2,100}$/.test(b.id||'')){
   errors.push('INVALID_BOOK '+JSON.stringify(b||{}).slice(0,150));continue;
  }
  if(seen.has(b.entry))errors.push('DUPLICATE_ROUTE '+b.entry);seen.add(b.entry);
  if(!paths.includes(b.entry)){errors.push('MISSING_ENTRY '+b.entry);continue;}
  const bytes=fs.readFileSync(path.join(root,b.entry));
  if(blobSHA(bytes)!==b.entryBlobSha)errors.push('MANAGED_ENTRY_CHANGED '+b.entry+' - update report and route identity');
  if(b.url!=='https://pirokiiiiito-arch.github.io/flashcards/'+b.entry+'?import=1')
   errors.push('WRONG_IPHONE_WEB_URL '+b.id);
  const html=bytes.toString('utf8');
  if(!/<iframe\b/i.test(html)||!/<input\b[^>]*type=["']file["']/i.test(html))errors.push('BAD_FILE_IMPORT_ENTRY '+b.entry);
  if(/data:image\/(?:jpeg|png|webp);base64,/i.test(html))errors.push('PRIVATE_SOURCE_IN_PUBLIC_WEB '+b.entry);
  if(b.stage==='draft'&&!/制作中|校正中|校正継続|未校正|未完了|未確認/.test(html))
   errors.push('UNLABELLED_DRAFT '+b.entry);
  reportCheck(b,read(root,b.report,errors),errors);
 }
 for(const p of paths)if(!seen.has(p))errors.push('UNREGISTERED_READER '+p);
 const start=path.join(root,'reader');
 function privateScan(dir){for(const d of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,d.name);
  if(d.isDirectory())privateScan(p);
  else if(d.isFile()&&/\.(?:zip|pdf|epub|jpe?g|webp|tiff?)$/i.test(d.name))
   errors.push('PRIVATE_BOOK_BINARY '+path.relative(root,p));
 }}if(fs.existsSync(start))privateScan(start);
 warnings.push('Frozen historical reader routes are NOT certified by this new quality system: '+Object.keys(legacy).length);
 warnings.push('GitHub CI cannot verify private OCR source or an actual iPhone; human/source evidence remains mandatory.');
 return {errors,warnings,legacy:Object.keys(legacy).length,managed:Array.isArray(books)?books.length:0,paths:paths.length};
}
if(require.main===module){
 const r=validate(ROOT);
 for(const x of r.warnings||[])console.log('NOTICE:',x);
 for(const x of r.errors||[])console.error('BLOCK:',x);
 if(r.errors&&r.errors.length)process.exitCode=1;
 else console.log('PASS: canonical sixty-check gate; '+r.paths+' routes, '+r.managed+' managed, '+r.legacy+' frozen legacy');
}
module.exports={validate,standardCheck,reportCheck,blobSHA,entryPaths,RULES,ID};
