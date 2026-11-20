'use strict';
// Synthetic API/DOM regressions for the QA program, never a real-book layout PASS.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const sourceRoot=path.resolve(__dirname,'..'),root=process.env.READER_AUDIT_ROOT||sourceRoot;
const entry='templates/reader/v2/layout-qa.html',html=fs.readFileSync(path.join(root,entry),'utf8');
const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const plain=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?
 '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const box=(left=0,top=0,width=300,height=600)=>({left,top,width,height,right:left+width,bottom:top+height});

function fixture(options={}){
 const text='検査本文',count=options.pages||1,model={
  model_schema:'reader-logical-stream-v1',book_id:'synthetic-qa-only',
  heading_inventory_binding:{inventory_sha256:'a'.repeat(64),approval_sha256:'b'.repeat(64)},
  layout_events:[{type:'heading',text:'試験見出し',heading_id:'heading-1'}],
  segments:[{id:'body-1',text,logical_start_offset:0}],body_char_count:Array.from(text).length
 };
 if(options.ambiguous)model.layout_events.push({type:'heading',text:'別の試験見出し',heading_id:'heading-2'});
 if(options.invalidBinding)delete model.heading_inventory_binding.approval_sha256;
 const elements=new Map(),listeners=new Map(),downloads=[];
 const element=id=>{
  if(!elements.has(id))elements.set(id,{id,disabled:false,value:'',textContent:'',style:{},
   classList:{toggle(){}},files:[],addEventListener(type,handler){listeners.set(id+':'+type,handler);},
   append(){},click(){},remove(){}});
  return elements.get(id);
 };
 const click=id=>{
  const handler=listeners.get(id+':click');assert.ok(handler,'missing UI handler '+id);return handler();
 };
 let pageIndex=0,font=20;
 const chunks=count===2?['検査','本文']:[text];
 const ranges=count===2?[[0,2],[2,4]]:[[0,4]];
 const pages=chunks.map((part,index)=>({kind:options.figure?'figure':'text',unitId:'unit-1',figureId:'figure-1',scan:1,text:part,start:ranges[index][0],end:ranges[index][1]}));
 const body=()=>{
  const [from,to]=ranges[pageIndex],shown=options.missingText?chunks[pageIndex].slice(1):chunks[pageIndex];
  return {dataset:{bodyId:'body-1',bodyFrom:String(from),bodyTo:String(to),logicalFrom:String(from),logicalTo:String(to)},
   cloneNode:()=>({textContent:shown,querySelectorAll:()=>[]})};
 };
 const image={src:'blob:synthetic-original',complete:true,naturalWidth:100,naturalHeight:100,
  decode:async()=>{},getBoundingClientRect:()=>box(options.clippedFigure?-8:10,10,100,100)};
 const inner={dataset:{crop:'[0,0,100,100]',sourceSha256:'c'.repeat(64)},
  getBoundingClientRect:()=>box(options.clippedFigure?-8:10,10,100,100)};
 const figureFrame={getBoundingClientRect:()=>box(0,0,280,200)};
 const caption={caption:true};
 const readingRoot={dataset:{figureKey:'synthetic-figure'},nodeType:1,parentElement:null,hidden:false,
  getBoundingClientRect:()=>box(),querySelectorAll(selector){
   if(selector==='[data-body-id]')return [body()];
   if(selector==='.ws-figure-title,.ws-figure-caption-label')return [];
   return [];
  },querySelector(selector){
   if(!options.figure)return null;
   return ({img:image,'.figure-inner':inner,'.figure-frame':figureFrame,'.figure-caption':caption})[selector]||null;
  },closest:()=>null};
 const textNode={nodeValue:text,parentElement:readingRoot};
 let captures=0;
 const session={
  beginCondition(id){this.id=id;},capturePage(){captures++;},finishCondition(){},
  exportObservations:()=>({schema:'reader-heading-dom-observations-v1',offset_unit:'unicode_codepoint',synthetic_test_only:true})
 };
 const R={
  version:'synthetic-reader-v11',setMode(){},setFont(value){font=value;},goto(index){pageIndex=index;},
  position:()=>({font,anchor:null}),restoreAnchor(){},pageState:()=>({pageIndex,pageCount:pages.length}),
  pages:()=>pages,probeRoot:()=>readingRoot,visibleText:()=>pages[pageIndex].text,
  measure(){if(options.stopOnFirstPage&&captures===1)click('stopButton');return {overflow:!!options.overflow};},
  units:()=>[{id:'unit-1',segments:[{headingId:'heading-1',start:0}]}]
 };
 const win={ReaderV11:R,readerReady:Promise.resolve(),readerVerifiedStructure:{model:options.modelMismatch?{...model,body_char_count:999}:model},
  navigator:{userAgent:'synthetic-test-no-browser'},devicePixelRatio:1,
  NodeFilter:{SHOW_TEXT:4},HeadingDOMProbe:{createSession:()=>session},
  requestAnimationFrame:fn=>queueMicrotask(fn),
  getComputedStyle:node=>({display:'block',visibility:options.hiddenText?'hidden':'visible',opacity:'1',
   overflowX:'visible',overflowY:'visible',writingMode:node.caption&&options.verticalCaption?'vertical-rl':'horizontal-tb',fontSize:'20px'}),
  document:{fonts:{ready:Promise.resolve()},getElementById:()=>readingRoot,
   querySelectorAll:()=>options.figure?[image]:[],
   createTreeWalker(){let used=false;return {nextNode(){if(used)return null;used=true;return textNode;}};},
   createRange:()=>({selectNodeContents(){},getClientRects:()=>[box(10,10,40,20)]})}
 };
 const frame=element('readerFrame');frame.contentWindow=win;
 Object.defineProperties(win,{innerWidth:{get:()=>options.wrongViewport?399:parseInt(frame.style.width)||390},
  innerHeight:{get:()=>parseInt(frame.style.height)||844}});
 Object.defineProperty(frame,'srcdoc',{set(value){this.lastHTML=value;queueMicrotask(()=>this.onload());}});
 const originalHTML=Buffer.from('<!doctype html><title>Synthetic QA input</title>');
 const modelBytes=Buffer.from(JSON.stringify(model,null,2)+'\n');
 element('htmlFile').files=[{name:'synthetic.html',bytes:originalHTML}];
 element('modelFile').files=[{name:'synthetic-model.json',bytes:modelBytes}];
 const document={getElementById:element,body:{append(){}},createElement:()=>({href:'',download:'',click(){},remove(){}})};
 class FileReader{readAsArrayBuffer(file){const bytes=file.bytes;this.result=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);queueMicrotask(()=>this.onload());}}
 const sandbox={window:{},document,FileReader,TextDecoder,TextEncoder,Blob,crypto:crypto.webcrypto,
  URL:{createObjectURL(blob){downloads.push(blob);return 'blob:synthetic-download';},revokeObjectURL(){}},
  setTimeout(fn,ms){const id=setTimeout(fn,ms>=30000?ms:0);if(ms>=30000)id.unref();return id;},clearTimeout};
 vm.createContext(sandbox);vm.runInContext(scripts[0],sandbox,{filename:entry});
 return {model,modelBytes,originalHTML,win,R,frame,element,click,downloads,get state(){return plain(sandbox.window.ReaderQAHarness.state);},
  get report(){return plain(sandbox.window.ReaderQAHarness.report);},get plan(){return plain(sandbox.window.ReaderQAHarness.plan);},
  get observations(){return plain(sandbox.window.ReaderQAHarness.observations);},get captures(){return captures;}};
}

test('the exact staged QA program matches the reviewed source and contains only local file UI',()=>{
 assert.equal(digest(html),digest(fs.readFileSync(path.join(sourceRoot,entry))));
 assert.equal(scripts.length,1);assert.doesNotThrow(()=>new vm.Script(scripts[0]));
 assert.equal((html.match(/type="file"/g)||[]).length,2);
 assert.doesNotMatch(html,/<script\b[^>]*\bsrc=|<(?:img|link|iframe)\b[^>]*\b(?:src|href)=/i);
 assert.doesNotMatch(html,/(?:https?:\/\/|data:image\/|;base64,|\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bsendBeacon\b|\bindexedDB\b|\blocalStorage\b|\bserviceWorker\b)/);
 assert.doesNotMatch(html,/<script\b[^>]*(?:application\/json|id=["'](?:embedded-data|bookdata))/i);
 assert.doesNotMatch(html,/\b(?:fileId|folderId|access_token|refresh_token|client_secret)\s*[:=]\s*["']/);
 assert.match(html,/frame\.srcdoc=htmlText/);
 assert.match(html,/source_review_truth_authenticated:false/);
 assert.match(html,/iphone_real_device_test:'not_run'/);
 assert.match(html,/public_url_access_test:'not_run'/);
});
test('the unchanged 24-condition plan covers every width and font once',()=>{
 const f=fixture();assert.equal(f.plan.length,24);assert.equal(new Set(f.plan.map(x=>x.id)).size,24);
 for(const [width,height]of [[320,740],[390,844],[430,930]])
  assert.deepEqual(f.plan.filter(x=>x.viewport_width===width).map(x=>[x.viewport_height,x.body_font_px]),
   [16,18,20,22,24,26,28,30].map(font=>[height,font]));
 assert.equal(f.state.phase,'awaiting_files');assert.equal(f.element('runButton').disabled,true);
});
test('actual selected byte SHA and canonical Unicode model SHA remain distinct',async()=>{
 const f=fixture();await f.click('loadButton');assert.equal(f.state.phase,'ready');await f.click('runButton');
 const report=f.report;assert.equal(report.schema,'reader-browser-qa-v1');assert.equal(report.completed_conditions,24);assert.equal(report.issue_count,0);
 assert.equal(report.files.html.sha256,digest(f.originalHTML));
 assert.equal(report.files.model.sha256,digest(f.modelBytes));
 assert.equal(report.binding.model_sha256,digest(Buffer.from(canonical(f.model))));
 assert.notEqual(report.files.model.sha256,report.binding.model_sha256);
 assert.equal(report.source_review_truth_authenticated,false);assert.equal(report.iphone_real_device_test,'not_run');
 assert.equal(report.public_url_access_test,'not_run');assert.equal(f.captures,24);
});
test('missing source binding or a different model stops before tests can run',async()=>{
 for(const options of [{invalidBinding:true},{modelMismatch:true}]){
  const f=fixture(options);await f.click('loadButton');assert.equal(f.state.phase,'error');assert.equal(f.element('runButton').disabled,true);
  assert.equal(f.report,null);assert.equal(f.captures,0);
 }
});
test('all pages are visited in every condition and observations retain the heading gate schema',async()=>{
 const f=fixture({pages:2});await f.click('loadButton');await f.click('runButton');
 assert.equal(f.report.completed_conditions,24);assert.equal(f.captures,48);
 for(const condition of f.report.conditions){assert.deepEqual(condition.visited_pages,[0,1]);assert.equal(condition.completed,true);}
 assert.equal(f.observations.schema,'reader-heading-dom-observations-v1');assert.equal(f.observations.offset_unit,'unicode_codepoint');
 await f.click('downloadObservationsButton');
 assert.deepEqual(JSON.parse(await f.downloads.at(-1).text()),f.observations);
});
test('missing text, hidden text, and overflow remain detected failures',async()=>{
 for(const options of [{missingText:true},{hiddenText:true},{overflow:true}]){
  const f=fixture(options);await f.click('loadButton');await f.click('runButton');
  assert.equal(f.report.completed_conditions,24);assert.ok(f.report.issue_count>0);
  assert.ok(f.report.conditions.every(c=>c.status==='issues_detected'));
 }
});
test('clipped figures and vertical captions are rejected by the same observation loop',async()=>{
 for(const options of [{figure:true,clippedFigure:true},{figure:true,verticalCaption:true}]){
  const f=fixture(options);await f.click('loadButton');await f.click('runButton');
  assert.ok(f.report.issue_count>0);assert.equal(f.report.conditions[0].image_pages.length,1);
  assert.ok(f.report.conditions[0].image_pages[0].issues.length>0);
 }
});
test('a changed model or wrong actual iframe viewport stops instead of recording a completed run',async()=>{
 const changed=fixture();await changed.click('loadButton');changed.win.readerVerifiedStructure.model={...changed.model,body_char_count:999};await changed.click('runButton');
 assert.equal(changed.report.status,'stopped_on_error');assert.equal(changed.report.completed_conditions,0);
 const dimensions=fixture({wrongViewport:true});await dimensions.click('loadButton');await dimensions.click('runButton');
 assert.equal(dimensions.report.status,'stopped_on_error');assert.equal(dimensions.report.completed_conditions,0);
 assert.equal(dimensions.captures,0);
});
test('stopping during a multi-page condition preserves incomplete state',async()=>{
 const f=fixture({pages:2,stopOnFirstPage:true});await f.click('loadButton');await f.click('runButton');
 assert.equal(f.report.status,'interrupted');assert.equal(f.report.completed_conditions,0);
 assert.equal(f.report.conditions[0].status,'incomplete');assert.deepEqual(f.report.conditions[0].visited_pages,[0]);
 assert.equal(f.element('runButton').disabled,false);
});
test('generic heading search uses selected model text and rejects ambiguous matches',async()=>{
 const f=fixture({ambiguous:true});await f.click('loadButton');f.element('headingQuery').value='試験';
 await f.click('previewHeadingButton');assert.equal(f.state.phase,'error');assert.match(f.state.last_error,/複数/);
 f.element('headingQuery').value='試験見出し';await f.click('previewHeadingButton');
 assert.match(f.element('status').textContent,/試験見出し/);assert.match(f.element('status').textContent,/1 \/ 1/);
});
test('Pages retains existing release gates, checks the final stage, and verifies the deployed QA asset',()=>{
 const workflow=fs.readFileSync(path.join(sourceRoot,'.github/workflows/pages.yml'),'utf8');
 const stage=workflow.indexOf('node tools/reader-publish-stage.cjs .');
 const qa=workflow.indexOf('node --test tests/reader-layout-qa.test.cjs tests/reader-layout-qa-pages.test.cjs');
 const upload=workflow.indexOf('uses: actions/upload-pages-artifact@v3');
 assert.ok(stage>=0&&qa>stage&&upload>qa);
 assert.match(workflow,/READER_AUDIT_ROOT: \$\{\{ runner\.temp \}\}\/reader-pages/);
 for(const command of ['node tools/reader-book-preflight.cjs --all','node tools/reader-release-control.cjs repo "$READER_AUDIT_ROOT"',
  'node tools/reader-verify-pages.cjs .','node tools/reader-issue-verified-links.cjs .'])
  assert.ok(workflow.includes(command),'existing gate missing: '+command);
 const deploy=workflow.indexOf('uses: actions/deploy-pages@v4');
 assert.ok(workflow.indexOf('node tools/verify-layout-qa-pages.cjs',deploy)>deploy);
 assert.match(workflow,/name: reader-layout-qa-public-evidence/);
});
test('the unchanged stage copies common QA code while quarantining an unapproved synthetic reader',t=>{
 // A synthetic policy tests stage routing only. Production evidence remains
 // checked by the unmodified release-control gate in the full Pages checkout.
 const temp=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'reader-qa-stage-'));
 t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const source=path.join(temp,'source'),destination=path.join(temp,'published');
 const write=(name,value)=>{const file=path.join(source,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
 const baselinePath='reader/synthetic-existing/index.html',candidatePath='reader/synthetic-new/index.html';
 const baseline='<title>Synthetic existing entry</title>',candidate='<title>Synthetic unapproved entry</title>';
 write(baselinePath,baseline);write(candidatePath,candidate);write(entry,html);
 write('reader/quality/release-policy.json',JSON.stringify({baseline:{files:{[baselinePath]:digest(baseline)},books:{}}}));
 write('reader/quality/registry.json',JSON.stringify({books:[{id:'synthetic-unapproved',entry:candidatePath}]}));
 const files={[baselinePath]:digest(baseline),[candidatePath]:digest(candidate)};
 const verifier={receipts:()=>({authorizedFiles:{},found:new Map()}),
  admittedFirstPageUI:()=>({}),admittedBookshelfNavUI:()=>({}),runtimeFiles:()=>files,
  validateRepository(staged){
   assert.equal(fs.existsSync(path.join(staged,candidatePath)),false);
   assert.equal(digest(fs.readFileSync(path.join(staged,baselinePath))),files[baselinePath]);
   assert.deepEqual(JSON.parse(fs.readFileSync(path.join(staged,'reader/quality/registry.json'))).books,[]);
   return {errors:[]};
  }};
 const module={exports:{}},context={module,exports:module.exports,__dirname:path.join(sourceRoot,'tools'),process,
  require(name){return name==='./reader-release-control.cjs'?verifier:require(name);}};
 const stageCode=fs.readFileSync(path.join(sourceRoot,'tools/reader-publish-stage.cjs'),'utf8');
 vm.runInNewContext(stageCode,context,{filename:'reader-publish-stage.cjs'});
 const result=module.exports.stage(source,destination);
 assert.equal(result.ready,true);assert.equal(result.contentCertification,false);
 assert.deepEqual(plain(result.quarantined),[candidatePath]);
 assert.equal(digest(fs.readFileSync(path.join(destination,entry))),digest(html));
 assert.equal(fs.readFileSync(path.join(source,candidatePath),'utf8'),candidate);
 assert.equal(fs.readFileSync(path.join(source,entry),'utf8'),html);
});
