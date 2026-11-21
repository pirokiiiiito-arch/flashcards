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
