'use strict';
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const host=read('reader/library/read.html');
const factory=new Function(host.slice(host.indexOf('// BEGIN WH3 continuous scan layout'),host.indexOf('// END WH3 continuous scan layout'))+'\nreturn wh3ReadingFlow;')();
const field=(html,id)=>JSON.parse(new RegExp('id="'+id+'">([\\s\\S]*?)</script>').exec(html)[1]);
function source(){
 const pages=Array.from({length:9},(_,i)=>({scan:8+i,width:100,height:200,pageType:'text',
  blocks:[{type:'body',text:'次の段落。'}],figures:[],toc_entries:[],original:''}));
 const page=n=>pages[n-8],edges=[{from:[10,0],to:[11,0]},{from:[13,0],to:[15,0]}];
 page(10).blocks[0].text='新しいエレベー';page(11).blocks[0].text='ターを試した。';
 page(12).blocks=[{type:'heading',text:'次の節'},{type:'body',text:'本文。'}];
 page(14).blocks=[];page(14).figures=[{id:'map',bbox:[2,3,50,60],caption:'図の説明。'}];
 page(16).blocks.unshift({type:'heading',text:'結び'});
 const parts=[[8,10],[11,13],[14,16]].map(([start,end],i)=>({start,end,part:'p'+i}));
 const manifest={range:[8,16],bookId:'wh3',segments:parts};
 const src=(i)=>{const {start,end}=parts[i];return {bookId:'wh3',range:[start,end],pages:pages.filter(p=>p.scan>=start&&p.scan<=end),toc:[],continuations:edges.filter(e=>[e.from[0],e.to[0]].some(n=>n>=start&&n<=end))};};
 const book={async readText(part){const i=parts.findIndex(p=>p.part===part);return '<script type="application/json" id="reader-verified-structure">'+JSON.stringify({model:{part}})+'</script><script type="application/json" id="bookdata">'+JSON.stringify(src(i))+'</script>';}};
 return {manifest,book,pages,edges};
}
test('joined paragraphs across archive files and an intervening figure survive exactly once in natural display sections',async()=>{
 const {manifest,book,pages,edges}=source(),flow=await factory(book,manifest);
 const sections=await Promise.all(flow.sections.map(async(_,i)=>field(await flow.archive(i,true),'bookdata')));
 assert.deepEqual(sections.flatMap(s=>s.pages),pages);
 assert.deepEqual(sections.flatMap(s=>s.continuations),edges);
 for(const e of edges)assert.ok(sections.some(s=>s.range[0]<=e.from[0]&&e.to[0]<=s.range[1]));
 assert.ok(flow.sections.every((s,i)=>!i||[12,16].includes(s.start)));
 assert.deepEqual(manifest.segments.map(s=>s.start),[8,11,14]);
});
test('old local positions, including positions inside a moved paragraph, round-trip to stable source anchors',async()=>{
 const {book,manifest}=source(),flow=await factory(book,manifest);
 const old={segment:1,key:'wh3v2.2',scan:11,size:22};
 const now=flow.restore(old);assert.equal(now.segment,0);assert.equal(now.size,22);
 const key=flow.bookmark(now.segment,now.key);assert.equal(key,'wh3src:11/0:2');
 assert.deepEqual(flow.restore({...old,key}),now);
 assert.equal(flow.restore({segment:0,scan:16,key:'',size:20}).segment,flow.sections.length-1);
});
for(const file of ['reader/library/wh3-format.html','templates/reader/v2/standard.js']){
 const src=read(file),check=new Function(src.slice(src.indexOf('function protectedPageBoundary('),src.indexOf('function paginateBlocks('))+';return protectedPageBoundary;')();
 test(file+' respects word and grapheme boundaries inside a full paragraph',()=>{
  const text=Array.from('青いエレベーターで着いた。');assert.equal(check(text,text.indexOf('タ')),true);
  assert.equal(check(text,text.indexOf('ー')+1),true);assert.equal(check(text,text.indexOf('で')),false);
  const term=Array.from('電気自動車を使う。');assert.equal(check(term,term.indexOf('気')),true);
 });
}

test('an explicitly anchored inset keeps its whole group and stable bookmarks after the reviewed body',async()=>{
 const {book,manifest,pages}=source();
 const sourcePage=pages.find(p=>p.scan===10),next=pages.find(p=>p.scan===11);
 const title={id:'inset-a',type:'heading',readingRole:'aside-heading',insetIndex:0,displayAfterBody:'next-paragraph',text:'表の標題'};
 const row={id:'inset-row',type:'note',readingRole:'aside',insetIndex:0,text:'表の最初の項目。'};
 sourcePage.blocks.push(title,row);
 next.blocks.push({id:'next-paragraph',type:'body',text:'独立した次の段落。'});
 const flow=await factory(book,manifest);
 const keys=['10/0','11/0','11/1','10/1','10/2'].map(id=>'wh3src:'+id+':0');
 const positions=keys.map(key=>flow.restore({key,scan:10,segment:0,size:20}));
 assert.equal(new Set(positions.map(p=>p.segment)).size,1);
 const offsets=positions.map(p=>Number(p.key.split('.')[1]));
 assert.deepEqual([...offsets].sort((a,b)=>a-b),offsets);
 assert.deepEqual(positions.map(p=>flow.bookmark(p.segment,p.key)),keys);
 const child=read('reader/library/wh3-format.html');
 const section=s=>s.slice(s.indexOf('function placeAnchoredInsets('),s.indexOf('\n}',s.indexOf('function placeAnchoredInsets('))+2);
 assert.equal(section(child),section(host));
 assert.match(child,/const ordered=placeAnchoredInsets\(joined,item=>item\.blocks\?\.\[0\]\)/);
 const place=new Function(section(child)+';return placeAnchoredInsets;')();
 const pair=[{scan:10,block:title},{scan:10,block:row}];
 const partial=place(pair,e=>e.block);
 assert.deepEqual(partial,pair);
 // With no explicit placement, even an identified inset keeps its existing order.
 delete title.displayAfterBody;
 assert.equal(place(pair,e=>e.block),pair);
});
