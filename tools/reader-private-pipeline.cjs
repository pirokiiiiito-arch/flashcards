#!/usr/bin/env node
'use strict';
// All source and canonical text stays in the caller's PRIVATE workspace.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const v=require('./reader-release-control.cjs'),{ID,RULES}=require('./reader-quality-gate.cjs');
const fail=(ok,s)=>{if(!ok)throw Error(s);};
function write(root,name,value){const b=typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n';const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,b,{flag:'wx',mode:0o600});return {path:name,sha256:v.hash(b)};}
function saveManifest(root,m){const b=JSON.stringify(m,null,2)+'\n',tmp=path.join(root,'.manifest-'+crypto.randomUUID());fs.writeFileSync(tmp,b,{flag:'wx',mode:0o600});fs.renameSync(tmp,path.join(root,'manifest.json'));}
function load(file){const root=path.dirname(path.resolve(file)),m=JSON.parse(fs.readFileSync(file));fail(m.schema==='reader-private-bundle-v2','WRONG_MANIFEST');return{root,m};}
function init(htmlFile,root,bookId,loaderFile,sourceIndexFile){
 fail(!fs.existsSync(root),'WORKSPACE_ALREADY_EXISTS');fail(/^[a-z0-9-]{3,100}$/.test(bookId),'BAD_BOOK_ID');
 const input=fs.readFileSync(htmlFile),parsed=v.extract(input),external=JSON.parse(fs.readFileSync(sourceIndexFile));
 const index=Array.isArray(external.pages)?Object.fromEntries(external.pages.filter(x=>parsed.pages.some(p=>p.scan===x.scan)).map(p=>[p.scan,p.sha256])):external;
 fail(v.objHash(v.originals(parsed.pages))===v.objHash(index),'EXTERNAL_ORIGINAL_INDEX_MISMATCH');
 const range=[parsed.pages[0].scan,parsed.pages.at(-1).scan];fail(parsed.pages.every((p,i)=>p.scan===range[0]+i),'BAD_SCAN_ORDER');
 fs.mkdirSync(root,{recursive:true,mode:0o700});
 const m={schema:'reader-private-bundle-v2',bookId,standardFileId:ID,range,firstPassId:'import-'+v.hash(input).slice(0,16),loaderSha256:v.hash(fs.readFileSync(loaderFile)),createdAt:new Date().toISOString()};
 m.raw=write(root,'immutable/raw.json',parsed.data);m.canonical=write(root,'canonical/revision-0000.json',parsed.data);
 m.originalIndex=write(root,'immutable/original-index.json',index);m.template=write(root,'immutable/renderer.html',parsed.shell);
 m.profile=write(root,'immutable/profile.json',{schema:'reader-profile-v2',templateSha256:m.template.sha256,defaultFontPx:20,lineHeight:1.5,digitOrientation:'preserve-approved',gesture:'up-next-down-prev-one-step-native-zoom',note:'Imported engine is preserved, not certified. A profile lock is not a test result.'});
 m.lock=write(root,'immutable/input-lock.json',{schema:'reader-input-lock-v2',raw:m.raw.sha256,originalIndex:m.originalIndex.sha256,template:m.template.sha256,profile:m.profile.sha256});
 m.corrections=write(root,'corrections/revision-0000.json',[]);m.artifact=write(root,'candidates/imported-unverified.html',input);
 m.inventory=write(root,'review/inventory.json',{pages:parsed.pages.map(p=>({scan:p.scan,sourceSha256:p.sha256,reviewedBy:null,secondReviewer:null,edgesChecked:false,regions:[]}))});
 m.second=write(root,'review/second-pass.json',{runId:null,viewedFirst:null,sourceIndexSha256:m.originalIndex.sha256,fields:{}});
 m.resolutions=write(root,'review/resolutions.json',{openIssues:[{kind:'source-review-not-performed',range}],differences:[],numbers:[],alerts:[]});
 m.boundaries=write(root,'review/boundaries.json',{items:[]});m.display=write(root,'review/display.json',{artifactSha256:m.artifact.sha256,actualPixels:false,fields:{},conditions:[]});
 m.checks=write(root,'review/checks.json',Object.fromEntries(RULES.map(id=>[id,{status:'not_run'}])));saveManifest(root,m);return m;
}
function correct(file,eventFile){
 const {root,m}=load(file),raw=v.json(root,m.raw),old=v.json(root,m.canonical),events=v.json(root,m.corrections),e=JSON.parse(fs.readFileSync(eventFile));
 fail(v.objHash(v.replay(raw,events))===v.objHash(old),'PRIOR_CANONICAL_DIVERGED');
 fail(e.expectedCanonicalSha256===m.canonical.sha256,'CANONICAL_VERSION_CONFLICT');
 const p=(Array.isArray(old)?old:old.pages).find(p=>p.scan===e.scan);fail(p,'UNKNOWN_SCAN');
 const parts=String(e.pointer).split('/');fail(/^(reading_text|title|figures\/\d+\/(caption|display_title)|boxed_articles\/\d+\/(text|title)|blocks\/\d+\/text)$/.test(e.pointer),'UNSAFE_TEXT_EDIT');
 const clone=structuredClone(old),pp=(Array.isArray(clone)?clone:clone.pages).find(p=>p.scan===e.scan);let dest=pp;for(const key of parts.slice(0,-1))dest=dest[key];
 fail(dest&&(dest[parts.at(-1)]??null)===e.before&&typeof e.after==='string','EDIT_PRECONDITION');dest[parts.at(-1)]=e.after;
 const record={...e,sourceSha256:p.sha256,beforeDataSha256:v.objHash(old),afterDataSha256:v.objHash(clone)};
 const next=[...events,record];v.replay(raw,next);
 const n=String(next.length).padStart(4,'0');m.canonical=write(root,'canonical/revision-'+n+'.json',clone);m.corrections=write(root,'corrections/revision-'+n+'.json',next);
 // Do not silently carry any old PASS results across a changed revision.
 m.checks=write(root,'review/checks-revision-'+n+'.json',Object.fromEntries(RULES.map(id=>[id,{status:'not_run'}])));
 m.deliveryState='blocked-rebuild-and-review-required';saveManifest(root,m);return m;
}
function build(file){
 const{root,m}=load(file),data=v.json(root,m.canonical),raw=v.json(root,m.raw),events=v.json(root,m.corrections),template=v.bytes(root,m.template).toString();
 fail(v.objHash(v.replay(raw,events))===v.objHash(data),'CANONICAL_NOT_FROM_CORRECTIONS');
 fail(template.split('{{READER_DATA}}').length===2,'ONE_TEMPLATE_SLOT_REQUIRED');
 const html=template.replace('{{READER_DATA}}',JSON.stringify(data).replace(/</g,'\\u003c'));
 fail(v.objHash(v.extract(html).data)===v.objHash(data),'BUILD_ROUNDTRIP_FAILED');
 const stamp=new Date().toISOString().replace(/[^0-9]/g,'');m.artifact=write(root,'candidates/'+stamp+'-'+v.hash(html).slice(0,12)+'-UNVERIFIED.html',html);m.deliveryState='blocked-evidence-required';saveManifest(root,m);return m;
}
function plan(file,request){
 fail(['stage','promote','attach','pages'].includes(request?.operation),'UNKNOWN_DELIVERY_OPERATION');
 const channel=request.channel;fail(['preview','production'].includes(channel),'EXPLICIT_CHANNEL_REQUIRED');
 const phase=channel==='preview'?'preview':request.operation==='stage'?'prepare':request.operation==='pages'?'release':'deployed';
 const result=v.validateBundle(file,{phase});fail(result.eligible,'DELIVERY_BLOCKED: '+result.errors.join('; '));
 fail(request.expectedArtifactSha256===result.subject.artifactSha256,'PLAN_ARTIFACT_CHANGED');
 if(channel==='preview')fail(request.operation!=='promote'&&request.createOnly===true&&!request.normalFileId,'PREVIEW_CANNOT_REPLACE_NORMAL');
 if(request.operation==='promote')fail(request.targetFileId&&/^[a-f0-9]{64}$/.test(request.expectedCurrentSha256||''),'COMPARE_AND_SWAP_REQUIRED');
 return {schema:'reader-delivery-plan-v2',operation:request.operation,channel,artifactSha256:result.subject.artifactSha256,subjectSha256:result.subjectSha256,targetFileId:request.targetFileId||null,expectedCurrentSha256:request.expectedCurrentSha256||null,createOnly:request.createOnly===true,postWriteReadbackRequired:true,expiresAt:new Date(Date.now()+15*60*1000).toISOString(),note:'Plan is not upload completion. Connector adapters must check current bytes before writing, then read back the exact target.'};
}
function exportChecked(file,out,request){
 fail(!fs.existsSync(out),'EXPORT_DESTINATION_EXISTS');const p=plan(file,request),{root,m}=load(file),b=v.bytes(root,m.artifact);
 fs.mkdirSync(out,{recursive:true,mode:0o700});write(out,p.channel==='preview'?'PREVIEW-UNVERIFIED.html':'VERIFIED-READING.html',b);write(out,'delivery-plan.json',p);return p;
}
function issue(file,request,context,keyFile,keyId,policyFile){
 const p=plan(file,request),phase=p.channel==='preview'?'preview':request.operation==='pages'?'release':'deployed',r=v.validateBundle(file,{phase});fail(r.eligible,'RECEIPT_BLOCKED');
 const policy=JSON.parse(fs.readFileSync(policyFile)),priv=fs.readFileSync(keyFile),publicKey=crypto.createPublicKey(priv).export({format:'pem',type:'spki'});
 fail(policy.trustedKeys?.[keyId]===publicKey,'KEY_NOT_APPROVED');
 fail(context.book?.id===r.subject.bookId&&context.book.entry===context.entry&&context.publicFiles?.[context.entry]===r.subject.loaderSha256,'RECEIPT_CONTEXT_MISMATCH');
 const payload={...r,channel:p.channel,entry:context.entry,bookRecordSha256:v.objHash(context.book),reportSha256:context.reportSha256,publicFiles:context.publicFiles,toolSha256:v.hash(fs.readFileSync(path.join(__dirname,'reader-release-control.cjs'))),issuedAt:new Date().toISOString()};
 return {payload,keyId,signature:crypto.sign(null,Buffer.from(v.stable(payload)),priv).toString('base64')};
}
if(require.main===module){
 const[c,...a]=process.argv.slice(2);try{let r;if(c==='init')r=init(...a);else if(c==='correct')r=correct(...a);else if(c==='build')r=build(...a);else if(c==='plan')r=plan(a[0],JSON.parse(fs.readFileSync(a[1])));else if(c==='export')r=exportChecked(a[0],a[1],JSON.parse(fs.readFileSync(a[2])));else if(c==='issue')r=issue(a[0],JSON.parse(fs.readFileSync(a[1])),JSON.parse(fs.readFileSync(a[2])),a[3],a[4],a[5]);else throw Error('Commands: init HTML PRIVATE_DIR BOOK_ID LOADER SOURCE_INDEX | correct MANIFEST EVENT | build MANIFEST | plan MANIFEST REQUEST | export MANIFEST OUT REQUEST | issue MANIFEST REQUEST CONTEXT PRIVATE_KEY KEY_ID POLICY');console.log(JSON.stringify(c==='init'||c==='build'||c==='correct'?{bookId:r.bookId,artifact:r.artifact,deliveryState:r.deliveryState||'blocked-unreviewed'}:r,null,2));}catch(e){console.error('BLOCK: '+e.message);process.exitCode=1;}
}
module.exports={init,correct,build,plan,exportChecked,issue};
