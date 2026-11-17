'use strict';
// Synthetic-only WH1/standard template regression. Does not certify the
// contents of a private scan, page attribution, or an iPhone browser.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const engine=fs.readFileSync(path.resolve(__dirname,'../templates/reader/v2/standard.js'),'utf8');
const split=x=>Array.from(new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(x),v=>v.segment);
function code(from,to){
 const a=engine.indexOf(from),b=engine.indexOf(to,a);
 if(a<0||b<=a)throw Error('Missing exact standard-engine function: '+from+' -> '+to);
 return engine.slice(a,b);
}
const bootstrap=new Function('book','mode','split',code('const sourceKind=','const main=')+'\nreturn {blocks,figures,flow};');
const helpers=new Function(code('function joinLogicalContinuations(', 'function protectedPageBoundary(')+
 '\nreturn {joinLogicalContinuations,textPart};')();
const {joinLogicalContinuations,textPart}=helpers;
const protectedPageBoundary=new Function(code('function protectedPageBoundary(', 'function paginateBlocks(')+
 '\nreturn protectedPageBoundary;')();
function createBook(book){return bootstrap(book,book.kind,split);}
const source=(scan,text,sourceJoined=false,type='body',sourceBlock=0)=>({
 scan,text,type,semanticType:type,sourceJoined,sourceBlock,units:split(text)
});
function parts(group,limit=1000){
 const fitsParts=(existing,extra)=>existing.concat(extra?[extra]:[]).reduce((n,x)=>n+split(x.text).length,0)<=limit;
 const paginate=new Function('joinLogicalContinuations','textPart','fitsParts','protectedPageBoundary',
  code('function paginateBlocks(', 'function captionFits(')+'\nreturn paginateBlocks;')(
   joinLogicalContinuations,textPart,fitsParts,protectedPageBoundary);
 return paginate(group,0);
}
function all(book){
 const {blocks,figures,flow}=createBook(book),measureText={hidden:false};
 const fit=(existing,extra)=>existing.concat(extra?[extra]:[]).reduce((n,x)=>n+split(x.text).length,0)<=500;
 const paginator=new Function('joinLogicalContinuations','textPart','fitsParts','protectedPageBoundary',
  code('function paginateBlocks(', 'function captionFits(')+'\nreturn paginateBlocks;')(
   joinLogicalContinuations,textPart,fit,protectedPageBoundary);
 const measureFigure={hidden:false};
 const paginateOneFigure=(i,start)=>[{kind:'image',figure:i,start,end:start+1,scan:figures[i].scan,subpage:1}];
 const paginateAll=new Function('flow','blocks','measureText','$','paginateBlocks','paginateOneFigure',
  code('function paginateAll()', 'function pageAt(')+'\nreturn paginateAll;')(
   flow,blocks,measureText,()=>measureFigure,paginator,paginateOneFigure);
 return {pages:paginateAll(),blocks,figures,flow};
}
test('public standard template still parses without private source scans',()=>{
 assert.doesNotThrow(()=>new vm.Script(engine));
 assert.match(engine,/group=joinLogicalContinuations\(group\)/);
 assert.match(engine,/deferUntilContinuation:entry\.deferUntilContinuation===true/);
 assert.match(engine,/sourceSpans:p\.kind==='text'/);
 assert.doesNotMatch(engine,/data:image\/(?:png|jpeg);base64|バナナフィッシュ日和|ブルクハルト/);
});
test('explicitly joined consecutive scans preserve full text and per-scan offsets',()=>{
 const src=[source(163,'青い旗を揚げよう',false,'body',4),source(165,'今日は晴れている。',true,'body',5)];
 const old=JSON.stringify(src),merged=joinLogicalContinuations(src);
 assert.equal(merged.length,1);
 assert.equal(merged[0].text,src.map(x=>x.text).join(''));
 assert.equal(merged[0].units.join(''),src.map(x=>x.text).join(''));
 assert.equal(JSON.stringify(src),old,'do not mutate registered originals');
 const full=textPart(merged[0],0,merged[0].units.length);
 assert.deepEqual(full.sourceSpans,[
  {scan:163,sourceBlock:4,sourceStart:0,sourceEnd:src[0].units.length},
  {scan:165,sourceBlock:5,sourceStart:0,sourceEnd:src[1].units.length}
 ]);
});
test('new page beginning in the later scan uses its original scan number',()=>{
 const joined=joinLogicalContinuations([source(163,'町に行く',false,'body',2),source(165,'新しい道を探す。',true,'body',3)]);
 const first=textPart(joined[0],0,2),second=textPart(joined[0],6,3);
 assert.equal(first.scan,163);
 assert.equal(second.scan,165);
 assert.deepEqual(second.sourceSpans,[{scan:165,sourceBlock:3,sourceStart:2,sourceEnd:5}]);
});
test('no marker means no automatic join, even when scan number changes',()=>{
 const src=[source(12,'最初の段落。'),source(13,'次の段落。')];
 assert.equal(joinLogicalContinuations(src).length,2);
 assert.deepEqual(parts(src).flatMap(p=>p.parts).map(p=>p.text),src.map(x=>x.text));
});
test('headings, footnotes, captions and TOC are hard barriers to continuation',()=>{
 for(const type of ['heading','note','caption','toc']){
  const src=[source(163,'説明',false,type),source(165,'次の本文',true)];
  assert.throws(()=>joinLogicalContinuations(src),/G402_SOURCE_CONTINUATION_BARRIER/);
  const next=[source(163,'説明'),source(165,'別項目',true,type)];
  assert.throws(()=>joinLogicalContinuations(next),/G402_SOURCE_CONTINUATION_BARRIER/);
 }
 assert.throws(()=>joinLogicalContinuations([source(165,'始まり',true)]),/G402_SOURCE_CONTINUATION_BARRIER/);
});
test('mixed mode keeps a figure separate after a source-verified nonadjacent continuation',()=>{
 const {pages,flow,figures}=all({kind:'mixed',entries:[
  {kind:'text',scan:163,blocks:[{type:'body',text:'青い鳥たち'}]},
  {kind:'image',scan:164,caption:'図版は独立表示',deferUntilContinuation:true},
  {kind:'text',scan:165,blocks:[{type:'body',text:'は空を飛んでいた。',joinPrevious:true}]},
  {kind:'text',scan:165,blocks:[{type:'body',text:'次の説明。'}]},
 ]});
 assert.deepEqual(pages.map(p=>p.kind),['text','image','text']);
 assert.equal(pages[0].parts.map(p=>p.text).join(''),'青い鳥たちは空を飛んでいた。');
 assert.deepEqual(pages[0].parts[0].sourceSpans.map(x=>x.scan),[163,165]);
 assert.equal(pages[1].scan,164);
 assert.equal(pages[2].parts[0].text,'次の説明。');
 assert.equal(figures.length,1);
 assert.equal(flow.filter(x=>x.kind==='image').length,1,'picture must not be dropped');
 assert.deepEqual(pages.map(x=>[x.start,x.end]),[[0,14],[14,15],[15,20]]);
});
test('image remains a hard barrier unless explicit deferral is verified',()=>{
 assert.throws(()=>all({kind:'mixed',entries:[
  {kind:'text',scan:163,blocks:[{type:'body',text:'前半'}]},
  {kind:'image',scan:164,caption:'保存する写真'},
  {kind:'text',scan:165,blocks:[{type:'body',text:'続き',joinPrevious:true}]}
 ]}),/G402_SOURCE_CONTINUATION_BARRIER/);
});
test('deferred figure without a following verified continuation must fail, not disappear',()=>{
 assert.throws(()=>all({kind:'mixed',entries:[
  {kind:'text',scan:163,blocks:[{type:'body',text:'前半'}]},
  {kind:'image',scan:164,deferUntilContinuation:true}
 ]}),/G402_DEFERRED_IMAGE_WITHOUT_CONTINUATION/);
 assert.throws(()=>all({kind:'mixed',entries:[
  {kind:'text',scan:163,blocks:[{type:'body',text:'前半'}]},
  {kind:'image',scan:164,deferUntilContinuation:true},
  {kind:'text',scan:165,blocks:[{type:'body',text:'別の段落'}]}
 ]}),/G402_DEFERRED_IMAGE_WITHOUT_CONTINUATION/);
});
test('standard text mode permits continuity, preserves absence of special novel style',()=>{
 const book=createBook({kind:'text',blocks:[
  {scan:10,type:'body',text:'何よりも'},
  {scan:11,type:'body',text:'大切だ。',joinPrevious:true}
 ]});
 assert.equal(book.blocks[1].sourceJoined,true);
 assert.equal(book.blocks[0].semanticType,'body');
 assert.equal(book.blocks.map(x=>x.text).join(''),'何よりも大切だ。');
 const merged=joinLogicalContinuations(book.blocks);
 assert.equal(merged.length,1);
 assert.equal(merged[0].text,'何よりも大切だ。');
 assert.doesNotMatch(engine,/NovelDialogue|novel-dialogue|\\.novel-paragraph/);
});
test('figure-only mode keeps its original picture sequence and unchanged sources',()=>{
 const {pages,figures}=all({kind:'image',figures:[
  {id:'a',scan:1,src:'blob:illustration-a',caption:''},
  {id:'b',scan:2,src:'blob:illustration-b',caption:''}
 ]});
 assert.deepEqual(pages.map(x=>x.kind),['image','image']);
 assert.deepEqual(figures.map(x=>x.source),['blob:illustration-a','blob:illustration-b']);
});
