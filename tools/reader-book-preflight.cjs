#!/usr/bin/env node
'use strict';
// Book-creation preflight: public preview only. NEVER certifies private OCR.
// Called on each book-manifest/preview change in GitHub Actions.
// Maintains the canonical 60 IDs without adding a 61st quality test.
const fs=require('node:fs'),path=require('node:path');
const v=require('./reader-release-control.cjs');
const {RULES}=require('./reader-quality-gate.cjs');
const ROOT=process.env.READER_AUDIT_ROOT?path.resolve(process.env.READER_AUDIT_ROOT):path.resolve(__dirname,'..');
function read(rel){if(typeof rel!=='string'||!/^reader\/[a-zA-Z0-9_./-]+$/.test(rel)||rel.includes('..'))throw Error('UNSAFE_BOOK_PATH '+rel);return fs.readFileSync(path.join(ROOT,rel));}
const reg=JSON.parse(read('reader/quality/registry.json')),policy=JSON.parse(read('reader/quality/release-policy.json'));
const errors=[],rows=[];
const receipts=new Map();
for(const rel of policy.receipts||[]){
 const env=JSON.parse(read(rel));
 const p=v.verifyEnvelope(env);
 receipts.set(p.bookId,p);
}
const uniqueIds=new Set();
function check(book){
 const issues=[];
 const fail=(condition,label)=>{if(!condition)issues.push(label);};
 const push=(condition,label)=>{if(!condition)issues.push(label);};
 if(uniqueIds.has(book.id))issues.push('DUPLICATE_BOOK_ID');
 uniqueIds.add(book.id);
 const p=receipts.get(book.id);
 if(!p){issues.push('NO_BOOK_SCOPED_RECEIPT');return {bookId:book.id,status:'blocked',issues};}
 const report=JSON.parse(read(book.report)),loader=read(book.entry),actual=v.hash(loader);
 fail(book.stage==='draft'&&p.channel==='preview'&&p.phase==='preview','NOT_DRAFT_PREVIEW');
 fail(p.contentCertified===false&&report.claimsCompleted===false&&report.contentCertified!==true&&(!p.previewProtocol||report.contentCertified===false),'FALSE_CERTIFICATION_OR_CLAIM');
 fail(p.entry===book.entry&&p.subject?.bookId===book.id,'ENTRY_OR_ID_MISMATCH');
 fail(p.subject?.loaderSha256===actual&&p.publicFiles?.[book.entry]===actual,'LOADER_SHA_MISMATCH');
 fail(p.bookRecordSha256===v.objHash(book),'REGISTRY_IDENTITY_MISMATCH');
 fail(p.reportSha256===v.hash(read(book.report)),'REPORT_SHA_MISMATCH');
 fail(p.subject?.artifactSha256===(report.privateArtifact?.sha256||report.artifactAudit?.sourceSha256),'PRIVATE_ARTIFACT_IDENTITY_MISMATCH');
 fail(report.scanRange?.[0]===p.subject?.range?.[0]&&report.scanRange?.[1]===p.subject?.range?.[1],'SCAN_RANGE_MISMATCH');
 const ids=Object.keys(p.checks||{}),known=new Set(RULES);
 fail(ids.length===60&&new Set(ids).size===60&&ids.every(x=>known.has(x)),'NOT_EXACTLY_CANONICAL_60_CHECKS');
 fail(ids.every(x=>['not_run','passed','failed','needs_source_review','not_applicable'].includes(p.checks[x]?.status)),'INVALID_CHECK_STATUS');
 fail(book.entry.startsWith('reader/preview/')&&p.authorization?.explicit===true,'PREVIEW_NOT_EXPLICIT');
 // Public GitHub must never contain a private scan, raw OCR or bookdata.
 const html=loader.toString('utf8');
 fail(!/^\s*<script\b[^>]*id=["'](?:embedded-data|bookdata)["'][^>]*>/im.test(html),'PRIVATE_DATA_SCRIPT_IN_PUBLIC_LOADER');
 fail(!/data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]{48,}/i.test(html),'SOURCE_IMAGE_EMBEDDED_IN_PUBLIC_LOADER');
 fail(!/["'](?:dataUrl|original|reading_text)["']\s*:\s*["']/i.test(html),'PRIVATE_BOOK_FIELDS_IN_PUBLIC_LOADER');
 fail(loader.length<100000,'UNUSUAL_PUBLIC_LOADER_SIZE');
 const fileInput=/<input\b[^>]*type=["']file["'][^>]*>/i.test(html)&&/<input\b[^>]*accept=["'][^"']*(?:html|text\/html)/i.test(html);
 const sandbox=html.match(/<iframe\b[^>]*sandbox=["']([^"']+)["']/i)?.[1]||'';
 const sandboxSafe=sandbox.split(/\s+/).includes('allow-scripts')&&!sandbox.split(/\s+/).includes('allow-same-origin');
 fail(fileInput&&sandboxSafe,'LOCAL_FILE_IMPORT_CONTRACT_MISSING');
 rows.push({bookId:book.id,entry:book.entry,range:p.subject?.range,stage:book.stage,formalChecksNotRun:ids.filter(x=>p.checks[x]?.status==='not_run').length,issues});
 return {bookId:book.id,status:issues.length?'blocked':'draft-preview-preflight-passed',issues};
}
const args=process.argv.slice(2);
if(args.length!==1){console.error('Usage: node tools/reader-book-preflight.cjs --all | BOOK_ID');process.exit(2);}
const selected=args[0]==='--all'?reg.books.filter(b=>b.stage==='draft'&&b.entry?.startsWith('reader/preview/')&&receipts.has(b.id)):reg.books.filter(b=>b.id===args[0]);
if(!selected.length){console.error('BOOK_ID_NOT_IN_REGISTRY_OR_NO_PREVIEW_RECEIPT');process.exit(2);}
for(const book of selected){const result=check(book);errors.push(...result.issues.map(x=>book.id+': '+x));}
const report={schema:'book-create-preflight-v1',checkedBooks:selected.length,issues:errors,books:rows,sourcePublicOnly:true,contentCertification:false};
console.log(JSON.stringify(report,null,2));if(errors.length)process.exitCode=1;
