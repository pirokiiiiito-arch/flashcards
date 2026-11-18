#!/usr/bin/env node
'use strict';
// PRIVATE metadata-only optimistic-lock stage transition. Does not edit GitHub,
// deliver reader HTML, or claim a 60-item pass.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {plan}=require('./reader-repair-plan.cjs');
const {advance,startDraft,reviseDraft}=require('./reader-repair-state.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function transition(args){
 const ledgerBytes=fs.readFileSync(args.ledger),ledger=JSON.parse(ledgerBytes);
 if(!Number.isSafeInteger(args.expectedRevision)||args.expectedRevision!==ledger.version)
  return{ok:false,errors:['STALE_SHARED_LEDGER_REVISION'],ledger:null};
 const now=args.at||new Date().toISOString();
 if(args.action==='start'){
  if(args.progress)return{ok:false,errors:['NEW_DRAFT_CANNOT_REUSE_OLD_PROGRESS'],ledger:null};
  return startDraft(ledger,args.book,args.newSha,args.firstPassReportSha,
   args.sourceImageCount,now);
 }
 if(args.action==='revise'){
  if(args.progress)return{ok:false,errors:['REVISION_CANNOT_REUSE_OLD_PROGRESS'],ledger:null};
  return reviseDraft(ledger,args.book,args.priorSha,args.newSha,args.firstPassReportSha,now);
 }
 if(args.action!=='advance')return{ok:false,errors:['INVALID_TRANSITION_ACTION'],ledger:null};
 if(!args.progress)return{ok:false,errors:['PRIVATE_PROGRESS_FILE_REQUIRED'],ledger:null};
 const progressBytes=fs.readFileSync(args.progress),progress=JSON.parse(progressBytes);
 const result=plan(ledger,args.book,progress);
 if(result.status!=='work_ready')return{ok:false,errors:['REPAIR_QUEUE_NOT_READY',...result.errors],ledger:null};
 return advance(ledger,args.book,result,hash(progressBytes),args.to,now);
}
function main(argv){
 const keys=['ledger','book','action','progress','to','prior-sha','new-sha','first-pass-report-sha','source-image-count','expected-revision','output','at'];
 const args={};
 for(let i=0;i<argv.length;i++){
  const flag=argv[i];
  if(!flag?.startsWith('--')||!keys.includes(flag.slice(2))||i+1>=argv.length)throw Error('INVALID_ARGUMENT');
  const k=flag.slice(2).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
  args[k]=argv[++i];
 }
 if(!args.ledger||!args.book||!args.action||!args.output)throw Error('Usage: node tools/reader-repair-transition.cjs --action advance|start|revise --book BOOK_ID --ledger PRIVATE/ledger.json --expected-revision N --progress PRIVATE/progress.json --to STAGE --output PRIVATE/next-ledger.json');
 args.expectedRevision=Number(args.expectedRevision);
 if(args.sourceImageCount!==undefined)args.sourceImageCount=Number(args.sourceImageCount);
 const outcome=transition(args);
 const repo=path.resolve(__dirname,'..'),out=path.resolve(args.output);
 if(out===repo||out.startsWith(repo+path.sep))throw Error('PRIVATE_LEDGER_OUTPUT_MUST_NOT_LIVE_IN_PUBLIC_REPO');
 if(!outcome.ok){console.log(JSON.stringify({ok:false,errors:outcome.errors}));process.exitCode=1;return;}
 fs.mkdirSync(path.dirname(out),{recursive:true});
 fs.writeFileSync(out,JSON.stringify(outcome.ledger,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({ok:true,status:'PRIVATE_METADATA_ONLY_NO_DELIVERY',
   nextStage:outcome.stage,newLedgerRevision:outcome.version,
   outputSha256:hash(fs.readFileSync(out))}));
}
if(require.main===module){try{main(process.argv.slice(2));}catch(e){console.error('REPAIR_TRANSITION_BLOCKED: '+e.message);process.exitCode=2;}}
module.exports={transition};
