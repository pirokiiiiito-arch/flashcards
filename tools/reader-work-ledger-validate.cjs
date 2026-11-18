#!/usr/bin/env node
'use strict';
// Only metadata (book IDs, ranges, hashes and unresolved status) may be shared.
// This check is deliberately NOT OCR certification.
const fs=require('node:fs'),path=require('node:path');
const RULES=require('./reader-quality-gate.cjs').RULES;
const HEX=/^[0-9a-f]{64}$/,allowedDefects=new Set(['open','failed','needs_source_review','resolved']);
function validate(ledger) {
 const errors=[],warnings=[];
 if(RULES.length!==60)errors.push('CANONICAL_SIXTY_CHANGED');
 if(ledger?.schema!=='reader-work-ledger-v1'||ledger.ruleset!=='20261116_0654_60-items'||
  !Array.isArray(ledger.books))errors.push('INVALID_CENTRAL_LEDGER_SCHEMA');
 const seen=new Set();
 for(const b of ledger?.books||[]){
  const id=String(b.bookId||'')+':'+(b.range||[]).join('-');
  if(seen.has(id))errors.push('DUPLICATED_BOOK_RANGE');seen.add(id);
  if(!/^[a-z0-9-]{5,150}$/.test(b.bookId||'')||
     !Array.isArray(b.range)||b.range.length!==2||
     !b.range.every(Number.isSafeInteger)||b.range[0]<1||b.range[0]>b.range[1])
   errors.push('BAD_BOOK_ID_OR_RANGE '+id);
  if(!HEX.test(b.sourceArchiveSha256||'')||!HEX.test(b.artifactSha256||''))
   errors.push('MISSING_PINNED_SOURCE_OR_ARTIFACT '+id);
  if(!['novel','world_history_1','text','image','mixed'].includes(b.profile))
   errors.push('UNKNOWN_PROFILE '+id);
  if(!['unverified','reviewed'].includes(b.qualityState))
   errors.push('INVALID_QUALITY_STATE '+id);
  if(!['blocked','candidate'].includes(b.releaseStatus))
   errors.push('INVALID_RELEASE_STATE '+id);
  if(!Array.isArray(b.knownDefects))errors.push('DEFECT_LEDGER_MISSING '+id);
  else {
   const defects=new Set();
   for(const x of b.knownDefects){
    if(!x||typeof x.id!=='string'||x.id.length<6||!allowedDefects.has(x.status)||
     defects.has(x.id))errors.push('INVALID_OR_DUPLICATED_DEFECT '+id);
    defects.add(x.id);
   }
  }
  if(b.releaseStatus==='candidate'&&b.qualityState!=='reviewed')
   errors.push('UNREVIEWED_RELEASE_CANDIDATE '+id);
  if((b.knownDefects||[]).some(x=>x.status!=='resolved')&&b.releaseStatus==='candidate')
   errors.push('UNRESOLVED_DEFECT_IN_CANDIDATE '+id);
 }
 if(!seen.size)warnings.push('WORK_LEDGER_EMPTY');
 // Prevent OCR and originals from being accidentally committed in this public index.
 const raw=JSON.stringify(ledger||{});
 if(/"(?:(?:dataUrl)|(?:ocrRaw)|(?:reading_text)|(?:original)|(?:sourceZipEntryName)|(?:bodyText))"\s*:/.test(raw))
  errors.push('PRIVATE_BOOK_FIELDS_IN_PUBLIC_LEDGER');
 if(/data:image\/(?:jpe?g|png);base64,[A-Za-z0-9+/]{32,}/i.test(raw))
  errors.push('EMBEDDED_SOURCE_IMAGE_LEAK');
 return{schema:'reader-ledger-validation-v1',errors,warnings,entries:seen.size,qualityIDsPreserved:RULES.length===60,metadataOnly:errors.length===0};
}
if(require.main===module){
 const rel=process.argv[2]||'reader/quality/work-ledger.json';
 try{
  const p=path.resolve(rel);const r=validate(JSON.parse(fs.readFileSync(p)));
  console.log(JSON.stringify(r,null,2));if(r.errors.length)process.exitCode=1;
 }catch(e){console.error('WORK_LEDGER_BLOCKED '+e.message);process.exitCode=2;}
}
module.exports={validate};
