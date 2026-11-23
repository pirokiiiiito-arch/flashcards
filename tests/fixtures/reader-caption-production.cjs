'use strict';
// A synthetic one-page fixture with an explicitly reviewed absence of captions.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const sha=b=>createHash('sha256').update(b).digest('hex');

function addCaptionProof(root,manifest,{image,width,height}){
 const base='caption-fixture/',scan=manifest.range[0],sourceSha256=image.sha256;
 const put=(filename,value)=>{
  const name=base+filename;
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));
  fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});
  fs.writeFileSync(path.join(root,name),bytes);
  return {path:filename,sha256:sha(bytes)};
 };
 const workspace=ref=>({...ref,path:base+ref.path});
 const source=put('original.png',fs.readFileSync(path.join(root,image.path)));
 const identity={scan,sourceSha256,wholePage:true};
 const census=put('census.json',{...identity,reviewedBy:'synthetic whole-page inventory',figures:[],captions:[]});
 const review=put('review.json',{...identity,reviewedBy:'synthetic original proof',blindToOutput:true,figureIds:[],captions:[]});
 const ocr=put('raw.json',{scan,source_sha256:sourceSha256,width,height,rows:[]});
 const ocrAudit=put('audit.json',{scan,sourceSha256,reviewedBy:'synthetic OCR audit',rawSha256:ocr.sha256,
  rowCount:0,rowsSha256:sha('[]'),decisions:[]});
 const originalOcrSources=put('ocr-origin.json',{schema:'reader-caption-ocr-origin-v1',bookId:manifest.bookId,range:manifest.range,
  pages:[{scan,sourceSha256,rawSha256:ocr.sha256}]});
 manifest.captionOcrOrigins=workspace(originalOcrSources);
 manifest.captionCensus=workspace(put('index.json',{schema:'reader-caption-census-v1',bookId:manifest.bookId,
  range:manifest.range,originalOcrSources,pages:[{scan,source,census,review,ocr,ocrAudit}]}));
 const zip=path.join(root,base,'edition.zip');
 execFileSync('python3',['-c',[
  'import json,sys,zipfile',
  'with zipfile.ZipFile(sys.argv[1],"w") as z:',
  ' z.write(sys.argv[2],"reader.html")',
  ' z.writestr("manifest.json",sys.argv[3])'
 ].join('\n'),zip,path.join(root,manifest.artifact.path),JSON.stringify({bookId:manifest.bookId,range:manifest.range,entry:'reader.html'})]);
 manifest.captionArchive={path:base+'edition.zip',sha256:sha(fs.readFileSync(zip))};
 const host=put('site/reader/library/read.html',Buffer.from('<main>synthetic shelf shell</main>'));
 manifest.captionSiteRoot=base+'site';
 manifest.captionReadbacks={};
 for(const route of ['part','shelf']){
  const receipt={schema:'reader-proof-readback-v1',route,bookId:manifest.bookId,range:manifest.range,
   artifactSha256:manifest.artifact.sha256,archiveSha256:manifest.captionArchive.sha256,member:'reader.html',
   pages:[{scan,sourceSha256,painted:[],unhandled:[],captures:[{...source,page:0}]}]};
  if(route==='shelf')receipt.hostFiles={'reader/library/read.html':host.sha256};
  manifest.captionReadbacks[route]=[workspace(put(route+'.json',receipt))];
 }
}
module.exports={addCaptionProof};
