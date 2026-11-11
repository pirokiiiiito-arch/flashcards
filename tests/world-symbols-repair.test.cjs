'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const patch=require('../reader/world-symbols/001-020/reader-repair-v1.js');
const html=fs.readFileSync(require('node:path').join(__dirname,'../reader/world-symbols/001-020/index.html'),'utf8');
test('mobile loader uses the in-memory repair without publishing private book bytes',()=>{
 assert.match(html,/reader-repair-v1\.js/);
 assert.match(html,/WorldSymbolsReaderRepair\.repair\(await blob\.text\(\)\)/);
 assert.doesNotMatch(html,/data:image\/(?:jpeg|png);base64,/);
});
test('blank or wrong source book is refused',()=>{
 assert.throws(()=>patch.inspect('<html></html>'),/原本データ/);
 const fake=Array.from({length:20},(_,i)=>({scan:i+1,dataUrl:'data:image/jpeg;base64,YQ==',blocks:i>2?[{kind:'body',text:'x'}]:[]}));
 const doc='<script id="embedded-data" type="application/json">'+JSON.stringify({bookId:'wrong',pages:fake})+'</script>';
 assert.throws(()=>patch.inspect(doc),/書籍ID|スキャン順/);
 fake.forEach(p=>p.dataUrl='');
 const emptyDoc='<script id="embedded-data" type="application/json">'+JSON.stringify({bookId:'sekai-symbol-jiten',pages:fake})+'</script>';assert.throws(()=>patch.inspect(emptyDoc),/空の読書HTML/);
});
test('the patch includes WH1 swipe thresholds, native zoom and fixed figure DOM',()=>{
 const code=patch.repair.toString();
 for(const word of ['wsSwipeDecision','Math.abs(dy)>14','Math.abs(dx)>65','wheel','touchcancel','keepFigure','wsFigurePages','browser-native pinch','ws-native-whole-screen-pinch'])
  assert.ok(code.includes(word),word);
});

test('single-digit orientation and Japanese word-boundary protection stay in reader patch',()=>{
 const s=patch.repair.toString();
 for(const item of ['wsWriteVertical','ws-one-digit','wsSafeCut','Intl.Segmenter','white-space:normal'])assert.ok(s.includes(item),item);
});

const vm=require('node:vm');
const sourceFixture=fs.readFileSync(require('node:path').join(__dirname,'fixtures/world-symbols-synthetic.html'),'utf8');
test('synthetic non-copyright fixture repairs to a syntax-valid reader without rewriting book bytes',()=>{
 const result=patch.repair(sourceFixture);
 const tag='<script id="embedded-data" type="application/json">';
 const dataOf=doc=>doc.split(tag)[1].split('</script>')[0];
 assert.equal(dataOf(sourceFixture),dataOf(result.html));
 const main=result.html.slice(result.html.lastIndexOf('<script>')+8,result.html.lastIndexOf('</script>'));
 assert.doesNotThrow(()=>new vm.Script(main));
 for(const marker of ['wsWriteVertical','wsSafeCut','Math.abs(dy)>45'])assert.ok(main.includes(marker));
 const again=patch.repair(result.html);assert.equal(result.html,again.html);
});

test('figure frame keeps a fixed caption region on multi-screen descriptions',()=>{
 const s=patch.repair.toString();
 assert.ok(s.includes("cap.style.flex='0 0 '"));
 assert.ok(s.includes('sameFigure')||s.includes('keepFigure'));
});

test('consecutive OCR body fragments are joined for natural continuous reading without changing stored OCR',()=>{
 const code=patch.repair.toString();
 assert.ok(code.includes('sourceBlocks=pg().blocks.filter'));
 assert.ok(code.includes('wsPrepareText'));
 assert.ok(code.includes("last.text+=normalized"));
 assert.ok(code.includes('font-size:var(--caption-size)!important'));
});

test('candidate regions exist for 20 scans and all sample OCR blocks link back to source regions',()=>{
 const pages=Array.from({length:20},(_,i)=>({
  scan:i+1,width:2890,height:4450,regions:[],pageType:i>=4&&i<=7?'figures':i>=8?'prose':'cover',
  blocks:i===8?[{id:'heading_009',kind:'heading',text:'Heading'},{id:'ocr_009_00',kind:'body',text:'Text'}]:
   i===4?[{id:'caption_01',kind:'caption',text:'Caption'}]:[],
  figures:i===4?[{figureId:'FIG-01',cropNorm:[.045,.025,.52,.46]}]:[]
 }));
 const result=patch.wsSeedRegions({pages});
 assert.equal(result.generated.length,20);assert.equal(result.totalBlocks,3);assert.equal(result.mappedBlocks,3);
 assert.ok(pages.every(p=>p.regions.length>=2 && p.regions.every(r=>r.coordinateStatus==='candidate_needs_source_review')));
 assert.ok(pages[8].blocks.every(b=>b.sourceRegionIds.length>0));
 const b=pages[4].blocks[0];assert.equal(b.sourceRegionIds.length,2);
 assert.ok(pages[4].regions.filter(r=>b.sourceRegionIds.includes(r.regionId)).every(r=>r.linkedBlockIds.includes(b.id)));
 const saved=pages[8].regions;patch.wsSeedRegions({pages});assert.equal(pages[8].regions,saved);
});
test('swipe next/previous is symmetric; diagonal, too slow and zoom are ignored',()=>{
 assert.equal(patch.wsSwipeDecision(2,-100,200,false),1);
 assert.equal(patch.wsSwipeDecision(2,100,200,false),-1);
 assert.equal(patch.wsSwipeDecision(-100,0,200,false),1);
 assert.equal(patch.wsSwipeDecision(100,0,200,false),-1);
 assert.equal(patch.wsSwipeDecision(60,61,200,false),0);
 assert.equal(patch.wsSwipeDecision(0,-100,1800,false),0);
 assert.equal(patch.wsSwipeDecision(0,-100,200,true),0);
});
test('region seeding runs inside patched reader without modifying embedded original data',()=>{
 const fixed=patch.repair(sourceFixture);
 assert.ok(fixed.html.includes('window.wsRegionInventory=wsSeedRegions(book)'));
 assert.ok(fixed.html.includes('world-symbols-wh1-fix-v2'));
 assert.ok(fixed.html.includes('#readingStage,.figure-frame,.figure-inner{touch-action:pan-x pinch-zoom'));
 const tag='<script id="embedded-data" type="application/json">';
 assert.equal(sourceFixture.split(tag)[1].split('</script>')[0],fixed.html.split(tag)[1].split('</script>')[0]);
});
