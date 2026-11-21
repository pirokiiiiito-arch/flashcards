'use strict';
// Private, read-only page worklist for the existing source-proofreading checks.
// Scan numbers come from the requested range, never from a status-filtered list.
const fs=require('node:fs');
const path=require('node:path');
const api=()=>require('./reader-release-control.cjs');
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const named=x=>typeof x==='string'&&x.trim().length>0;
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const textKinds=new Set(['body','heading','caption','boxed','toc','ruby','note']);
const otherKinds=new Set(['image_label','running_head','page_number','photo']);

function grouped(rows,key){
 const groups=new Map();
 for(const row of rows){const k=key(row);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(row);}
 return groups;
}
function validBox(box,width,height){
 return Array.isArray(box)&&box.length===4&&box.every(Number.isFinite)&&
  box[0]>=0&&box[1]>=0&&box[0]<box[2]&&box[1]<box[3]&&box[2]<=width&&box[3]<=height;
}
function correctionField(event){
 const p=event.pointer;
 if(p==='reading_text')return 'body';
 if(p==='title')return 'title';
 if(/^ruby\/\d+\/(base|reading|rt)$/.test(p))return p.replace(/\/rt$/,'/reading');
 if(/^notes\/\d+\/text$/.test(p))return p;
 if(/^blocks\/\d+\/text$/.test(p))return p.slice(0,-5);
 if(/^figures\/\d+\/(caption|display_title)$/.test(p))return p.replace(/display_title$/,'title');
 if(/^boxed_articles\/\d+\/(text|title)$/.test(p))return p.replace('boxed_articles/','boxed/');
 return null;
}
function coversScan(issue,scan,range){
 if(record(issue)){
  if(Number.isSafeInteger(issue.scan)&&issue.scan>=range[0]&&issue.scan<=range[1])return scan===issue.scan;
  if(Array.isArray(issue.range)&&issue.range.length===2&&issue.range.every(Number.isSafeInteger)&&
    issue.range[0]>=range[0]&&issue.range[1]<=range[1]&&issue.range[0]<=issue.range[1])
   return scan>=issue.range[0]&&scan<=issue.range[1];
 }
 // Old free-form issues remain open throughout their bundle until their scope is recorded.
 return true;
}
function collect(m,pages,index,inventory,second,resolutions,events,rawPages,sourceErrors=[]){
 const v=api(),[start,end]=m.range;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||end<start)throw Error('INVALID_SOURCE_RANGE');
 const pageRows=grouped(pages,p=>p?.scan),inventories=grouped(inventory?.pages||[],p=>p?.scan);
 const seeds=grouped(rawPages||[],p=>p?.scan);
 const originalFields=events?.length&&rawPages?v.textFields(rawPages):null;
 const carried=grouped(resolutions?.carriedIssues||[],r=>r?.scan);
 let pendingImportedFindings=0;
 const differences=grouped(resolutions?.differences||[],d=>d?.field);
 const numbers=grouped(resolutions?.numbers||[],d=>d?.field);
 const alerts=grouped(resolutions?.alerts||[],d=>d?.id);
 const edits=grouped(events||[],e=>e?.scan);
 const secondFields=record(second?.fields)?second.fields:{};
 const fieldScan=k=>Number(k.split('/')[0]);
 const secondByScan=grouped(Object.keys(secondFields),fieldScan);
 const regionCounts=new Map();
 for(const page of inventory?.pages||[])for(const reg of Array.isArray(page?.regions)?page.regions:[]){
  if(reg?.id)regionCounts.set(reg.id,(regionCounts.get(reg.id)||0)+1);
 }
 const unexpected=k=>!Number.isSafeInteger(k)||k<start||k>end;
 const global=new Set(sourceErrors);
 if([...pageRows.keys(),...inventories.keys(),...edits.keys()].some(unexpected))global.add('SOURCE_RANGE_MISMATCH');
 if(Object.keys(index||{}).some(k=>String(Number(k))!==k||unexpected(Number(k))))global.add('SOURCE_INDEX_MISMATCH');
 if(Object.keys(secondFields).some(k=>!/^\d+\/.+/.test(k)||unexpected(fieldScan(k))||!k.startsWith(String(fieldScan(k))+'/')))global.add('SECOND_PASS_FIELD_COVERAGE');
 const blind=named(m.firstPassId)&&named(second?.runId)&&second.runId!==m.firstPassId&&second.viewedFirst===false&&
  named(second.method)&&named(second.reviewedBy)&&record(second.fields)&&hex(m.originalIndex?.sha256)&&second.sourceIndexSha256===m.originalIndex.sha256;
 const queue=[];
 for(let scan=start;scan<=end;scan++){
  const issues=[],add=(reason,field)=>issues.push(field?{reason,field}:{reason});
  for(const code of global)add(code);
  const candidates=pageRows.get(scan)||[],p=candidates[0],maps=inventories.get(scan)||[],map=maps[0];
  const expected=index?.[scan];
  if(candidates.length!==1)add('SCAN_COVERAGE');
  if(!hex(expected)||p?.sha256!==expected)add('SOURCE_INDEX_MISMATCH');
  if(maps.length!==1||!hex(expected)||map?.sourceSha256!==expected||
   !named(map.reviewedBy)||!named(map.secondReviewer)||!named(map.firstPassId)||!named(map.secondPassId)||
   map.firstPassId===map.secondPassId||map.edgesChecked!==true||map.secondViewedFirst!==false)add('INVENTORY_NOT_INDEPENDENT');
  const fields=p?v.textFields([p]):{},regions=Array.isArray(map?.regions)?map.regions:[];
  if(!Number.isInteger(map?.width)||map.width<=0||!Number.isInteger(map?.height)||map.height<=0||!Array.isArray(map?.regions))add('INVALID_REGION_MAP');
  if(!regions.length&&(map?.blankPage!==true||map?.hasReadableText!==false||Object.keys(fields).length))add('BLANK_SOURCE_OBSERVATION_REQUIRED');
  if(regions.length&&map?.blankPage===true)add('BLANK_SOURCE_OBSERVATION_CONFLICT');
  const registered=new Map();
  for(const r of regions){
   if(!named(r?.id)||regionCounts.get(r.id)!==1||(!textKinds.has(r.kind)&&!otherKinds.has(r.kind))){add('INVALID_REGION');continue;}
   if(!validBox(r.box,map.width,map.height)){add('REGION_OUT_OF_BOUNDS');continue;}
   if(textKinds.has(r.kind)){
    if(!Array.isArray(r.fields)||!r.fields.length||r.fields.some(k=>!Object.hasOwn(fields,k))){add('UNREGISTERED_TEXT_REGION');continue;}
   }else if(!named(r.reason)||r.reason.length<=5){add('UNJUSTIFIED_NONPROSE_REGION');continue;}
   registered.set(r.id,r);
  }
  const owns=(id,k)=>registered.has(id)&&textKinds.has(registered.get(id).kind)&&registered.get(id).fields.includes(k);
  const prior=seeds.get(scan)?.[0]?.allScanReview;
  if(prior!==undefined){
   if(!record(prior)||!['pending','extraPending'].every(k=>Number.isSafeInteger(prior[k])&&prior[k]>=0)){
    add('IMPORT_REVIEW_RECORD_INCOMPLETE');
   }else if(prior.pending||prior.extraPending){
    const signature=v.objHash(prior),closed=new Set();
    for(const decision of carried.get(scan)||[]){
     const {group,ordinal,field,regionId}=decision;
     if(!['pending','extraPending'].includes(group)||!Number.isSafeInteger(ordinal)||ordinal<1||ordinal>prior[group]||
       decision.priorReviewSha256!==signature||decision.sourceSha256!==expected||!owns(regionId,field)||
       !named(decision.reviewedBy)||!named(decision.reason)||decision.resolved!==true||
       decision.canonicalSha256!==v.hash(fields[field])||!named(decision.sourceReading))continue;
     const chars=Array.from(fields[field]),offset=decision.offset,length=Array.from(decision.sourceReading).length;
     if(Number.isSafeInteger(offset)&&offset>=0&&offset+length<=chars.length&&
       chars.slice(offset,offset+length).join('')===decision.sourceReading)closed.add(group+'/'+ordinal);
    }
    const pending=prior.pending+prior.extraPending-closed.size;
    if(pending){pendingImportedFindings+=pending;issues.push({reason:'IMPORTED_FINDINGS_REQUIRE_SOURCE',remaining:pending,priorReviewSha256:signature});}
   }
  }
  if(!blind)add('SECOND_PASS_NOT_INDEPENDENT');
  for(const key of secondByScan.get(scan)||[])if(!Object.hasOwn(fields,key))add('SECOND_PASS_FIELD_COVERAGE',key);
  for(const [k,text] of Object.entries(fields)){
   if(![...registered.keys()].some(id=>owns(id,k)))add('TEXT_WITHOUT_SOURCE_REGION',k);
   const other=secondFields[k];
   if(typeof other!=='string'){add('SECOND_PASS_FIELD_COVERAGE',k);continue;}
   const edited=originalFields!==null&&(edits.get(scan)||[]).some(e=>scan+'/'+correctionField(e)===k);
   const first=edited?(originalFields[k]??''):text;
   if(other!==text||first!==text){
    // A blind OCR result is a candidate. Choosing either reading requires a new
    // observation tied to this source, field and both exact candidate strings.
    const decisions=(differences.get(k)||[]).filter(r=>r?.firstSha256===v.hash(first)&&r.secondSha256===v.hash(other));
    if(decisions.length!==1||!decisions.every(r=>r.resolved===true&&r.canonicalSha256===v.hash(text)&&
      r.sourceSha256===expected&&r.sourceReading===text&&owns(r.regionId,k)&&named(r.reviewedBy)&&named(r.reason)))
     add('UNRESOLVED_SECOND_PASS',k);
   }
   for(const n of text.matchAll(/[0-9０-９〇零一二三四五六七八九十百千万億]+/gu)){
    if(!(numbers.get(k)||[]).some(r=>r.offset===n.index&&r.text===n[0]&&named(r.reviewedBy)&&owns(r.regionId,k)))add('UNVERIFIED_NUMBER',k);
   }
  }
  for(const a of v.anomalies(fields))if(!(alerts.get(a.id)||[]).some(r=>r.decision==='source_confirmed'&&
   named(r.reviewedBy)&&named(r.reason)&&owns(r.regionId,a.field)))add('UNRESOLVED_ANOMALY',a.field);
  for(const e of edits.get(scan)||[]){
   const k=correctionField(e);
   if(k&&!Object.hasOwn(fields,scan+'/'+k))add('EDIT_REMOVED_SOURCE_FIELD',scan+'/'+k);
   if(e.sourceSha256!==expected||!registered.has(e.sourceRegion)||(k&&!owns(e.sourceRegion,scan+'/'+k)))add('CORRECTION_REGION_MISSING',k?scan+'/'+k:undefined);
  }
  if(!Array.isArray(resolutions?.openIssues)||resolutions.openIssues.some(x=>coversScan(x,scan,m.range)))add('UNRESOLVED_ISSUES');
  if(issues.length){
   const seen=new Set(),unique=issues.filter(issue=>{
    const key=JSON.stringify(issue);if(seen.has(key))return false;seen.add(key);return true;
   });
   const nextAction=unique.some(issue=>issue.reason==='UNRESOLVED_SECOND_PASS')?
    '該当箇所を原本で読み、初稿・独立転記・採用する全文を同じページの領域に記録する':
    '該当する原本ページを開き、指摘された領域・独立転記・未解決事項を照合する';
   queue.push({scan,issues:unique,nextAction});
  }
 }
 return {bookId:m.bookId,range:[start,end],totalScans:end-start+1,matchedScans:end-start+1-queue.length,
  pendingScans:queue.length,pendingImportedFindings,readyForSourceChecks:queue.length===0,queue};
}

function fromBundle(root,m,pages,index,events,raw){
 const v=api(),errors=[];
 function read(key){try{return v.json(root,m[key]);}catch{errors.push('READ_SOURCE_RECORD_'+key);return null;}}
 const inventory=read('inventory'),second=read('second'),resolutions=read('resolutions');
 if(!Array.isArray(inventory?.pages))errors.push('INVENTORY_PAGE_COUNT');
 if(!Array.isArray(events))errors.push('CORRECTION_LEDGER_REQUIRED');
 for(const key of ['differences','alerts','numbers','carriedIssues'])if(resolutions?.[key]!==undefined&&!Array.isArray(resolutions[key]))errors.push('INVALID_RESOLUTIONS_'+key);
 const clean=Object.fromEntries(['differences','alerts','numbers','openIssues','carriedIssues'].map(k=>[k,Array.isArray(resolutions?.[k])?resolutions[k]:undefined]));
 const seed=raw??read('raw'),seedPages=Array.isArray(seed)?seed:seed?.pages;
 if(!Array.isArray(seedPages))errors.push('ORIGINAL_FIRST_PASS_REQUIRED');
 return collect(m,pages,index,Array.isArray(inventory?.pages)?inventory:null,second,clean,Array.isArray(events)?events:[],seedPages,errors);
}

function pendingRange(bookId,range,reason){
 const nextAction='採用した原本一覧と照合対象のHTML・校正記録を復元し、再照合する';
 const queue=[];
 for(let scan=range[0];scan<=range[1];scan++)queue.push({scan,issues:[{reason}],nextAction});
 return {bookId,range,totalScans:queue.length,matchedScans:0,pendingScans:queue.length,readyForSourceChecks:false,queue,status:'source_records_unavailable'};
}
function fromManifest(file,requestedScope){
 const root=path.dirname(path.resolve(file)),m=JSON.parse(fs.readFileSync(file,'utf8')),v=api();
 if(requestedScope)require('./reader-request-scope.cjs').matchRequestedScope(requestedScope,m.bookId,m.range);
 const parsed=v.extract(v.bytes(root,m.artifact));
 if(!Array.isArray(m.range)||m.schema!=='reader-private-bundle-v2'||!named(m.bookId)||
   (parsed.data.bookId&&parsed.data.bookId!==m.bookId)||(parsed.data.range&&v.objHash(parsed.data.range)!==v.objHash(m.range)))throw Error('SOURCE_WORKLIST_IDENTITY_MISMATCH');
 const index=v.json(root,m.originalIndex),lock=v.json(root,m.lock);
 if(lock.originalIndex!==m.originalIndex.sha256||v.objHash(v.originals(parsed.pages))!==v.objHash(index))throw Error('SOURCE_WORKLIST_ORIGINAL_MISMATCH');
 const raw=v.json(root,m.raw),events=v.json(root,m.corrections),canonical=v.json(root,m.canonical);
 if(lock.raw!==m.raw.sha256||v.objHash(parsed.data)!==v.objHash(canonical)||v.objHash(v.replay(raw,events))!==v.objHash(canonical))
  throw Error('SOURCE_WORKLIST_CANONICAL_MISMATCH');
 return fromBundle(root,m,parsed.pages,index,events,raw);
}

if(require.main===module){
 try{
  if(process.argv.length!==5||process.argv[3]!=='--request')throw Error('Usage: node tools/reader-source-pages.cjs PRIVATE/manifest.json --request PRIVATE/request.json');
  const scope=require('./reader-request-scope.cjs').readRequestedScope(process.argv[4]);
  console.log(JSON.stringify(fromManifest(process.argv[2],scope),null,2));
 }catch(e){console.error(e.message);process.exitCode=1;}
}
module.exports={fromBundle,fromManifest,pendingRange};
