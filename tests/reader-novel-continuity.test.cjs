'use strict';
// Synthetic/original text only: tests the exact public novel.js implementation.
// A green test does not certify a private book's OCR or an iPhone browser.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const engine=fs.readFileSync(path.resolve(__dirname,'../templates/reader/v2/novel.js'),'utf8');
const split=x=>Array.from(new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(x),v=>v.segment);
const begin=engine.indexOf('function joinLogicalContinuations(');
const end=engine.indexOf('// G4-04:',begin);
if(begin<0||end<=begin)throw Error('Shared novel engine must define source-continuation mapping');
const {joinLogicalContinuations,textPart}=new Function('verticalReaderSymbols','split',engine.slice(begin,end)+'\nreturn {joinLogicalContinuations,textPart};')(require('../templates/reader/v2/vertical-symbols.js'),split);
const source=(scan,text,sourceJoined=false,type='body')=>({scan,text,type,sourceJoined,units:split(text)});
const same=a=>JSON.parse(JSON.stringify(a));
const paginateBegin=engine.indexOf('function paginateBlocks('),paginateEnd=engine.indexOf('function captionFits(',paginateBegin);
if(paginateBegin<0||paginateEnd<=paginateBegin)throw Error('Novel paginator must be present');
function paginateWithCapacity(group,capacity){
 const fitsParts=(existing,add)=>existing.concat(add?[add]:[]).reduce((n,p)=>n+split(p.text).length,0)<=capacity;
 const g404Select=(b,off,fitCount,remaining)=>({count:fitCount,reason:'synthetic-fit',exception:null,balanced:false});
 const g404Record=()=>{};
 const paginate=new Function('joinLogicalContinuations','textPart','fitsParts','g404Select','g404Record',
  engine.slice(paginateBegin,paginateEnd)+'\nreturn paginateBlocks;')(
   joinLogicalContinuations,textPart,fitsParts,g404Select,g404Record
  );
 return paginate(group,0);
}
test('shared novel program remains syntactically valid and private-book-free',()=>{
 assert.doesNotThrow(()=>new vm.Script(engine,{filename:'novel.js'}));
 assert.doesNotMatch(engine,/data:image\/(?:jpeg|png);base64|バナナフィッシュ日和/);
 assert.match(engine,/group=joinLogicalContinuations\(group\)/);
 assert.match(engine,/sourceJoined:segment\.sourceStart===0&&!!b\.joinPrevious/);
 assert.match(engine,/sourceJoined:b\.sourceStart===0&&!!sourceBlocks\[b\.sourceBlockIndex\]\?\.joinPrevious/);
 assert.match(engine,/if\(item\.kind==='break'\)\{flush\(\);continue\}/);
});
test('original scan text is logically joined when explicitly marked, never rewritten',()=>{
 const a=source(12,'木箱の蓋'),b=source(13,'を閉めた。',true),original=[a,b];
 const expected=a.text+b.text,copy=same(original);
 const merged=joinLogicalContinuations(original);
 assert.equal(merged.length,1);
 assert.equal(merged[0].text,expected);
 assert.equal(merged[0].units.join(''),expected);
 assert.deepEqual(merged[0].sourceRanges,[
  {start:0,end:4,scan:12},{start:4,end:9,scan:13}
 ]);
 assert.deepEqual(original,copy,'original OCR/scan blocks may not be mutated');
});
test('a displayed part crossing scans retains both source offsets',()=>{
 const b=joinLogicalContinuations([source(12,'木箱の蓋'),source(13,'を閉めた。',true)])[0];
 const entire=textPart(b,0,b.units.length);
 assert.equal(entire.scan,12);
 assert.equal(entire.text,'木箱の蓋を閉めた。');
 assert.deepEqual(entire.sourceSpans,[
  {scan:12,sourceStart:0,sourceEnd:4},
  {scan:13,sourceStart:0,sourceEnd:5}
 ]);
 const tail=textPart(b,5,4);
 assert.equal(tail.scan,13);
 assert.equal(tail.text,'閉めた。');
 assert.deepEqual(tail.sourceSpans,[{scan:13,sourceStart:1,sourceEnd:5}]);
});
test('a complete reader page can include source scan 13 instead of flushing after scan 12',()=>{
 const first=source(12,'木箱の蓋'),second=source(13,'を閉めた。',true);
 const pages=paginateWithCapacity([first,second],7);
 assert.equal(pages.length,2);
 assert.equal(pages[0].parts.map(x=>x.text).join(''),'木箱の蓋を閉め');
 assert.deepEqual(pages[0].parts[0].sourceSpans,[
  {scan:12,sourceStart:0,sourceEnd:4},
  {scan:13,sourceStart:0,sourceEnd:3}
 ]);
 assert.equal(pages.flatMap(p=>p.parts).map(p=>p.text).join(''),first.text+second.text);
 assert.equal(pages[1].parts[0].scan,13);
});
test('without an explicit continuation, paragraphs remain separate',()=>{
 const src=[source(12,'木箱の蓋'),source(13,'を閉めた。')];
 assert.equal(joinLogicalContinuations(src).length,2);
 const pages=paginateWithCapacity(src,7);
 assert.equal(pages.length,2,'whole 5-character next paragraph should move to next page');
 assert.equal(pages[0].parts.map(x=>x.text).join(''),'木箱の蓋');
 assert.equal(pages[1].parts.map(x=>x.text).join(''),'を閉めた。');
});
test('heading, TOC and fresh dialogue are hard join barriers',()=>{
 const heading=joinLogicalContinuations([source(11,'第1章',false,'heading'),source(12,'続き',true)]);
 assert.equal(heading.length,2);
 const toc=joinLogicalContinuations([source(8,'目次',false,'toc'),source(9,'次の項目',true)]);
 assert.equal(toc.length,2);
 const fresh=joinLogicalContinuations([source(12,'前の文。'),source(13,'「次のセリフ」',true,'dialogue')]);
 assert.equal(fresh.length,2);
 const newHeading=joinLogicalContinuations([source(12,'前文。'),source(13,'新章',true,'heading')]);
 assert.equal(newHeading.length,2);
});
test('source offsets remain correct when three scans join and page begins in the middle scan',()=>{
 const sourceBlocks=[source(11,'白い'),source(12,'箱の蓋',true),source(13,'を閉じた。',true)];
 const merged=joinLogicalContinuations(sourceBlocks);
 assert.equal(merged.length,1);
 const part=textPart(merged[0],3,7);
 assert.equal(part.text,'の蓋を閉じた。');
 assert.deepEqual(part.sourceSpans,[
  {scan:12,sourceStart:1,sourceEnd:3},
  {scan:13,sourceStart:0,sourceEnd:5}
 ]);
});
test('source scanning metadata survives mixed-mode image and explicit-break barriers',()=>{
 const flow=engine.slice(engine.indexOf('function paginateAll()'),engine.indexOf('function pageAt('));
 assert.match(flow,/if\(item\.kind==='break'\)\{flush\(\);continue\}/);
 const blocks=[source(20,'前の話。'),source(21,'次の話',false,'heading'),source(21,'風が鳴る。')];
 const items=blocks.map((_,block)=>({kind:'text',block}));
 const run=new Function('flow','blocks','paginateBlocks','measureText','$','let g404Audit;'+flow+';return paginateAll();');
 const groups=run(items,blocks,(items)=>paginateWithCapacity(items,1000),{},()=>({}));
 assert.deepEqual(groups.map(page=>page.parts.map(part=>part.text)),[['前の話。'],['次の話','風が鳴る。']]);
 assert.match(flow,/flush\(\);measureText\.hidden=true/);
 assert.match(engine,/pageManifest:.*sourceSpans:/s);
});
