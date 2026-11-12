#!/usr/bin/env node
'use strict';
// Build an isolated deployment tree. Never delete or edit a source reader.
const fs=require('node:fs'),path=require('node:path');
const v=require('./reader-release-control.cjs');
function stage(root,destination){
 root=fs.realpathSync(root);destination=path.resolve(destination);
 if(fs.existsSync(destination))throw Error('STAGE_DESTINATION_EXISTS');
 if(destination===root||root.startsWith(destination+path.sep)||destination.startsWith(root+path.sep))throw Error('STAGE_MUST_BE_OUTSIDE_SOURCE');
 const policy=JSON.parse(fs.readFileSync(path.join(root,'reader/quality/release-policy.json')));
 const{authorizedFiles,found}=v.receipts(root,policy),current=v.runtimeFiles(root),quarantined=[];
 for(const[f,h]of Object.entries(policy.baseline.files)){
  if(!current[f])throw Error('PUBLISHED_FILE_REMOVED '+f);
  if(current[f]!==h&&authorizedFiles[f]!==current[f])throw Error('PUBLISHED_FILE_CHANGED_WITHOUT_EVIDENCE '+f);
 }
 for(const[f,h]of Object.entries(current))if(policy.baseline.files[f]!==h&&authorizedFiles[f]!==h)quarantined.push(f);
 for(const f of Object.keys(authorizedFiles))if(current[f]!==authorizedFiles[f])throw Error('RECEIPT_ASSET_MISSING '+f);
 const blocked=new Set(quarantined),temp=destination+'.tmp-'+process.pid;
 if(fs.existsSync(temp))throw Error('STALE_STAGE_TEMP');
 try{
  fs.cpSync(root,temp,{recursive:true,filter:src=>{
   const rel=path.relative(root,src).split(path.sep).join('/');
   return !rel.split('/').some(s=>['.git','node_modules','__pycache__'].includes(s))&&!blocked.has(rel);
  }});
  const rp=path.join(temp,'reader/quality/registry.json'),reg=JSON.parse(fs.readFileSync(rp));
  reg.books=reg.books.filter(b=>{
   if(policy.baseline.books[b.id]||found.has(b.id))return true;
   if(!blocked.has(b.entry))throw Error('UNCERTIFIED_BOOK_RECORD '+b.id);
   return false;
  });
  fs.writeFileSync(rp,JSON.stringify(reg,null,2)+'\n');
  // Check final bytes, not just the pre-generator sources.
  const result=v.validateRepository(temp);
  if(result.errors.length)throw Error(result.errors.join('\n'));
  fs.renameSync(temp,destination);
  return {schema:'reader-public-stage-v1',ready:true,sourceUnchanged:true,quarantined,preservedFiles:Object.keys(policy.baseline.files).length,contentCertification:false,destination};
 }catch(e){fs.rmSync(temp,{recursive:true,force:true});throw e;}
}
if(require.main===module){try{const[r,d]=process.argv.slice(2);if(!r||!d)throw Error('Usage: reader-publish-stage.cjs SOURCE NEW_DEST');console.log(JSON.stringify(stage(r,d),null,2));}catch(e){console.error('BLOCK:',e.message);process.exitCode=1;}}
module.exports={stage};
