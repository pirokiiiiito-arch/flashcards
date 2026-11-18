#!/usr/bin/env node
'use strict';
// PRIVATE, fail-closed candidate creation after the real canonical 60/device
// and public HTTP gate. Never edits GitHub, Drive or a published book.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const core=require('./reader-unified-handoff.cjs');
const {validate}=require('./reader-work-ledger-validate.cjs');
const hex=/^[a-f0-9]{64}$/;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function finalize(ledger,bookId,options){
 const errors=[],blocked=()=>({ok:false,errors,ledger:null,completedDelivery:false});
 if(validate(ledger).errors.length){errors.push('INVALID_SHARED_LEDGER');return blocked();}
 const matches=ledger.books.filter(x=>x.bookId===bookId);
 if(matches.length!==1){errors.push('UNKNOWN_OR_AMBIGUOUS_BOOK_ID');return blocked();}
 const entry=matches[0],draft=entry.pendingDraft;
 if(!draft||draft.reviewStatus!=='awaiting_canonical_60'){
  errors.push('DRAFT_NOT_READY_FOR_FINAL_CANONICAL_GATE');return blocked();
 }
 const priorUnverified=entry.releaseStatus==='blocked'&&entry.qualityState==='unverified';
 const priorReviewed=entry.releaseStatus==='candidate'&&entry.qualityState==='reviewed';
 if(!priorUnverified&&!priorReviewed){
  errors.push('EXISTING_RELEASE_STATE_NOT_ALLOWED');return blocked();
 }
 // The published old version is NEVER changed by this function. A validated
 // replacement remains a private candidate until the release system promotes it.
 if((entry.knownDefects||[]).some(x=>x.status!=='resolved')){
  errors.push('UNRESOLVED_SOURCE_DEFECTS');return blocked();
 }
 if(!Number.isSafeInteger(options?.expectedRevision)||options.expectedRevision!==ledger.version){
  errors.push('STALE_SHARED_LEDGER_REVISION');return blocked();
 }
 if(!Number.isFinite(Date.parse(options?.at||''))){errors.push('INVALID_CANDIDATE_TIME');return blocked();}
 const required=['artifact','manifest','sourceProof','publicEvidence'];
 for(const k of required)if(!options[k]||!fs.existsSync(options[k])){
  errors.push('MISSING_FINAL_EVIDENCE_'+k.toUpperCase());
 }
 if(errors.length)return blocked();
 const bytes=fs.readFileSync(options.artifact),actualSha=sha(bytes);
 if(actualSha!==draft.artifactSha256){errors.push('DRAFT_HTML_SHA_CHANGED');return blocked();}
 const manifest=JSON.parse(fs.readFileSync(options.manifest,'utf8'));
 if(manifest.bookId!==bookId||
   JSON.stringify(manifest.range)!==JSON.stringify(entry.range)||
   manifest.artifact?.sha256!==actualSha||
   !hex.test(manifest.loaderSha256||'')){
  errors.push('FINAL_MANIFEST_OR_LOADER_MISMATCH');return blocked();
 }
 const publicEvidence=JSON.parse(fs.readFileSync(options.publicEvidence,'utf8'));
 const checks=Array.isArray(publicEvidence.checks)?publicEvidence.checks:[];
 const served=checks.filter(c=>c.bookId===bookId&&
  c.status==='verified'&&c.httpStatus===200&&
  c.expectedSha256===manifest.loaderSha256&&
  c.observedSha256===manifest.loaderSha256&&
  typeof c.entry==='string'&&
  c.entry.startsWith('reader/')&&!c.entry.startsWith('reader/preview/')&&
  !c.entry.includes('..')&&
  typeof c.url==='string'&&c.url.startsWith('https://'));
 if(publicEvidence.schema!=='reader-public-delivery-evidence-v1'||
    publicEvidence.eligible!==true||served.length!==1){
  errors.push('VERIFIED_NON_PREVIEW_PRODUCTION_HTTP_REQUIRED');return blocked();
 }
 const next=structuredClone(ledger),candidate=next.books.find(x=>x.bookId===bookId);
 const oldArtifactSha=candidate.artifactSha256;
 delete candidate.pendingDraft;
 candidate.artifactSha256=actualSha;
 candidate.qualityState='reviewed';
 candidate.releaseStatus='candidate';
 candidate.publishedLoaderStatus='production_candidate_not_promoted';
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'reader-private-gate-'));
 let verdict=null;
 try{
  const file=path.join(tmp,'provisional-ledger.json');
  fs.writeFileSync(file,JSON.stringify(next),{mode:0o600,flag:'wx'});
  verdict=core.inspect({mode:'normal',artifact:options.artifact,manifest:options.manifest,
   ledger:file,sourceProof:options.sourceProof,
   ocrReview:options.ocrReview||undefined,publicEvidence:options.publicEvidence});
 }catch(_){errors.push('FINAL_CANONICAL_VERIFIER_UNAVAILABLE');}
 finally{fs.rmSync(tmp,{recursive:true,force:true});}
 if(!verdict?.handoffAllowed||verdict?.status!=='verified_release'){
  errors.push('FORMAL_SIXTY_DEVICE_AND_OCR_GATE_NOT_PASSED');
  // Error codes only; no OCR or original book bytes in the result.
  return blocked();
 }
 next.version++;
 next.history=Array.isArray(next.history)?next.history:[];
 next.history.push({bookId,action:'private_production_candidate_certified',
  oldArtifactSha256:oldArtifactSha,candidateArtifactSha256:actualSha,
  publicLoaderSha256:manifest.loaderSha256,publicEntry:served[0].entry,
  publicUrl:served[0].url,finalVerdictSha256:sha(Buffer.from(JSON.stringify(verdict))),
  at:options.at,ledgerVersion:next.version,remotelyPublishedByThisTool:false});
 return{ok:true,errors:[],ledger:next,version:next.version,
  completedDelivery:false,privateCandidateVerified:true,publicUrl:served[0].url};
}
function main(argv){
 const keys=['ledger','book','artifact','manifest','source-proof','ocr-review','public-evidence',
  'output','expected-revision','at'],args={};
 for(let i=0;i<argv.length;i++){
  const a=argv[i];if(!a?.startsWith('--')||!keys.includes(a.slice(2))||i+1>=argv.length)
   throw Error('BAD_ARGUMENT');
  args[a.slice(2).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=argv[++i];
 }
 if(!args.ledger||!args.book||!args.output)throw Error('Usage: reader-repair-finalize.cjs --ledger PRIVATE/ledger.json --book ID --artifact PRIVATE/book.html --manifest PRIVATE/manifest.json --source-proof PRIVATE/source-proof.json --public-evidence PRIVATE/http.json --expected-revision N --output PRIVATE/next-ledger.json');
 const current=JSON.parse(fs.readFileSync(args.ledger,'utf8'));
 args.expectedRevision=Number(args.expectedRevision);
 args.at=args.at||new Date().toISOString();
 const result=finalize(current,args.book,args);
 if(!result.ok){console.log(JSON.stringify({ok:false,errors:result.errors}));process.exitCode=1;return;}
 const dst=path.resolve(args.output),repo=path.resolve(__dirname,'..');
 if(dst===repo||dst.startsWith(repo+path.sep))throw Error('PRIVATE_CANDIDATE_LEDGER_MUST_NOT_BE_PUBLIC');
 fs.mkdirSync(path.dirname(dst),{recursive:true});
 fs.writeFileSync(dst,JSON.stringify(result.ledger,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({ok:true,status:'PRIVATE_CANDIDATE_ONLY_NOT_PUBLISHED',version:result.version,completedDelivery:false}));
}
if(require.main===module){try{main(process.argv.slice(2));}catch(e){console.error('FINAL_CANDIDATE_BLOCKED '+e.message);process.exitCode=2;}}
module.exports={finalize};
