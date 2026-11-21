'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const test=require('node:test');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const bytes=p=>fs.readFileSync(path.join(root,p));
const folder='reader/library/';
const revision='wh1-library-v9-20261110';
// The exact release is pinned separately by reader-release-control.
 // This test verifies cross-file cache agreement without a second stale version constant.
 const swCode=read(folder+'sw.js');
 const shelfRevision=swCode.match(/'\.\/app\.js\?v=([^']+)'/)?.[1];
 const shelfCache=swCode.match(/const CACHE='([^']+)'/)?.[1];
 test('bookshelf version and cache are derived from the same source and cannot drift',()=>{
  assert.match(shelfRevision||'',/^bookshelf-[a-z0-9-]+-\d{8}$/);
  assert.match(shelfCache||'',/^private-bookshelf-shell-v\d+-[a-z0-9-]+-\d{8}$/);
  assert.equal(shelfCache.replace(/^private-bookshelf-shell-v\d+-/,''),shelfRevision.slice('bookshelf-'.length));
  assert.ok(read(folder+'index.html').includes('./app.js?v='+shelfRevision));
  assert.ok(swCode.includes("./app.js?v="+shelfRevision));
  assert.ok(read(folder+'app.js').includes('&v=uk-wh1-text-geometry-v1-20261115'));
 });


test('shelf WH1 entry retains every storage/reader operation and only adds current renderer plus static marker',()=>{
 const base=read(folder+'read.html'),html=read(folder+'read-wh1-v9.html');
 const scripts=[
  '<script src="./wh1-pager-v9.js?v='+revision+'"></script>',
  '<script src="./wh1-figure-viewport-v9.js?v='+revision+'"></script>',
  '<script src="./wh1-display-check-v9.js?revision=display-check-v9-1-20261110"></script>'
 ].join('\n');
 assert.ok(html.includes(scripts));
 assert.ok(html.indexOf(scripts)<html.indexOf('const BOOK_ID='));
 assert.doesNotMatch(html,/src="\.\/wh1-exact-pagination\.js/);
 const marker=html.match(/\n<aside id="wh1-display-check-fallback"[^>]*>確認9\.1 · 確認待ち<\/aside>/);
 assert.ok(marker);assert.ok(html.indexOf(marker[0])<html.indexOf('<iframe id="reader"'));
 assert.equal(html.replace(scripts,'<script src="./wh1-exact-pagination.js"></script>').replace('<title>確認9.1｜','<title>').replace(marker[0],''),base);
 assert.match(html,/const POSITION_KEY='BOOK_POSITION_'\+BOOK_ID/);
 assert.match(html,/LibraryDB\.findBlob\(BOOK_ID\)/);
 assert.match(html,/localStorage\.getItem\('WH1_UNIFIED_POSITION'\)/);
 assert.match(html,/size:20/);
 assert.match(html,/\$\('shelfReturn'\)\.onclick/);
 assert.match(html,/#reader\{height:100svh!important/);
});

test('generated renderer files are exact canonical copies and repeated build preserves other books',()=>{
 const originals=['read.html','storage.js','wh1-exact-pagination.js'].map(name=>[name,bytes(folder+name)]);
 const before=bytes(folder+'read-wh1-v9.html');
 execFileSync('python3',[path.join(root,'tools/build-wh1-library-v9.py')],{cwd:root,stdio:'pipe'});
 for(const [name,value]of originals)assert.deepEqual(bytes(folder+name),value);
 assert.deepEqual(bytes(folder+'read-wh1-v9.html'),before);
 const report=JSON.parse(read(folder+'wh1-library-v9-build.json'));
 for(const [dest,source]of [
  ['wh1-pager-v9.js','wh1-exact-pagination.js'],
  ['wh1-figure-viewport-v9.js','wh1-figure-viewport-v9.js'],
  ['wh1-display-check-v9.js','wh1-display-check-v9.js']
 ]){
  assert.deepEqual(bytes(folder+dest),bytes('reader/wh1/all/'+source));
  assert.equal(report.modules_sha256[dest],createHash('sha256').update(bytes(folder+dest)).digest('hex'));
 }
 assert.equal(report.revision,revision);assert.equal(report.private_book_modified,false);
 assert.equal(report.reader_sha256,createHash('sha256').update(before).digest('hex'));
});

test('shelf worker fetches fresh app code and serves the correct reader offline without touching private storage',async()=>{
 const scope='https://reader.example/flashcards/reader/library/';
 const handlers={},entries=new Map(),writes=[],requests=[];let claimed=0,skipped=0;
 const cache={
  async addAll(values){for(const request of values){assert.equal(request.cache,'reload');entries.set(request.url,'current:'+request.url);}},
  async match(url){const value=entries.get(typeof url==='string'?url:url.url);return value?new Response(value):undefined;},
  async put(url,response){writes.push(url);entries.set(url,await response.text());}
 };
 const c={URL,Request,Response,console,
  self:{registration:{scope},addEventListener:(name,fn)=>{handlers[name]=fn;},
   skipWaiting:async()=>{skipped++;},clients:{claim:async()=>{claimed++;}}},
  caches:{open:async name=>{assert.equal(name,shelfCache);return cache;},
   match:()=>{throw Error('Must not read an older named cache');},delete:()=>{throw Error('Must preserve caches');}},
  fetch:async(req,options)=>{requests.push({url:req.url,options});throw Error('Offline fixture');}
 };
 vm.createContext(c);vm.runInContext(read(folder+'sw.js'),c);
 let pending;handlers.install({waitUntil:p=>{pending=p;}});await pending;
 handlers.activate({waitUntil:p=>{pending=p;}});await pending;
 assert.equal(claimed,1);assert.equal(skipped,1);
 assert.ok(entries.has(scope+'app.js?v='+shelfRevision));
 assert.ok(entries.has(scope+'wh1-reader-routing.js?v='+revision));
 async function fetchRoute(relative,mode='navigate'){
  let response;const work=[];
  handlers.fetch({request:{url:scope+relative,method:'GET',mode},respondWith:p=>{response=p;},waitUntil:p=>work.push(p)});
  const result=await response;await Promise.all(work);return result;
 }
 for(const [request,fallback]of [
  ['', 'index.html'],['read.html?id=wh1','read.html'],['read.html?id=another-book','read.html'],
  ['read-wh1-v9.html?id=wh1','read-wh1-v9.html'],['read-wh1-v9.html?id=g_saved_wh1','read-wh1-v9.html'],
  ['app.js','app.js?v='+shelfRevision],['wh1-pager-v9.js?old=1','wh1-pager-v9.js?v='+revision],
  ['wh1-display-check-v9.js?old=1','wh1-display-check-v9.js?revision=display-check-v9-1-20261110']
 ])assert.equal(await (await fetchRoute(request)).text(),'current:'+scope+fallback);
 assert.ok(requests.every(x=>x.options.cache==='no-cache'));
 c.fetch=async(req,options)=>{assert.equal(options.cache,'no-cache');return new Response('fresh app');};
 assert.equal(await (await fetchRoute('app.js','cors')).text(),'fresh app');
 assert.equal(writes.at(-1),scope+'app.js?v='+shelfRevision);
 for(const request of [
  {url:'https://www.googleapis.com/drive/v3/files/private?alt=media',method:'GET'},
  {url:scope+'private-book.zip',method:'GET'},
  {url:scope+'app.js',method:'POST'}
 ])handlers.fetch({request,respondWith:()=>{throw Error('Private or non-GET request intercepted');}});
 assert.doesNotMatch(read(folder+'sw.js'),/caches\.delete\(|indexedDB\.|localStorage\.(?:clear|removeItem)\(/);
});

const source = read('reader/wh1/all/wh1-exact-pagination.js');
const context = vm.createContext({window: {}});
vm.runInContext(source, context);
const decorate = context.window.WH1ExactPager.decorate;

// Use the layout loop and storage key of the shipped archive, with a synthetic
// one-screen text fixture. The real private scans are exercised separately.
function segment(id) {
  return `<html><head></head><body><script>
function paginate(blocks) {
 const pages=[];
 let parts=[];
 function flush(){if(parts.length){pages.push(parts);parts=[];}}
 for(const b of blocks){
  let remain=b.text,offset=0;
  while(remain.length){
   parts.push({type:b.type,text:remain});remain='';
  }
 }
 flush();return pages.map(page=>page.map(part=>part.text));
}
function save(p){
 try{sessionStorage.setItem('${id}-1-20-page',p.key);}catch(e){}
}
function jump(dest,pages){
    let idx=-1;
    if(dest?.key) idx=pages.findIndex(p=>p.key===dest.key);
    return idx;
}
</script></body></html>`;
}

function child(html, expression) {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  return JSON.parse(vm.runInNewContext(script + '\nJSON.stringify(' + expression + ')'));
}
const blocks = [
  {type:'body',text:'Before'}, {type:'heading',text:'Section'},
  {type:'heading',text:'Subheading'}, {type:'body',text:'After'},
  {type:'heading',text:'Next section'}, {type:'body',text:'Next paragraph'},
];
test('saved Presidents sections start on a fresh page with consecutive headings together', () => {
  const document = decorate(segment('us-presidents-south'));
  assert.deepEqual(child(document,'paginate('+JSON.stringify(blocks)+')'),
    [['Before'], ['Section','Subheading','After'], ['Next section','Next paragraph']]);
  assert.deepEqual(child(decorate(segment('wh1')),'paginate('+JSON.stringify(blocks)+')'),
    [blocks.map(part=>part.text)]);
});
test('a saved text position still resolves when its old page-start key falls inside a new page', () => {
  const document = decorate(segment('us-presidents-south'));
  const pages = [
    {key:'text:1:0',parts:[{block:1,offset:0,text:'abc'}]},
    {key:'text:1:3',parts:[{block:1,offset:3,text:'def'}]},
  ];
  const jump = key=>child(document,'jump('+JSON.stringify({key})+','+JSON.stringify(pages)+')');
  assert.equal(jump('text:1:0'),0);
  assert.equal(jump('text:1:3'),1);
  assert.equal(jump('text:1:5'),1);
  assert.equal(jump('text:1:6'),-1);
});

test('only confirmed continuations in a saved Presidents book share one paragraph and retain scan and bookmark targets', async () => {
  const original = [
    [{scan:20,type:'body',text:'前の語と法'}],
    [{scan:21,type:'body',text:'律の続き。',continuedFromPreviousSegment:true}, {scan:30,type:'heading',text:'次の節'}],
    [{scan:41,type:'body',text:'独立した段落。'}],
  ];
  function part(blocks,i){
    return '<script>\nconst blocks='+JSON.stringify(blocks)+';\n'+
      " try{sessionStorage.setItem('us-presidents-south-"+(i*20+1)+"-"+(i*20+20)+"-page',p.key);}catch(e){}\n</script>";
  }
  const docs=original.map(part);
  const manifest={bookId:'us-presidents-south',segments:docs.map((_,i)=>({part:String(i)}))};
  const reader={readText:path=>docs[Number(path)]};
  const layout=await context.window.WH1ExactPager.continuousReading(reader,manifest);
  const blocks=i=>JSON.parse(layout.byPath.get(String(i)).match(/^const blocks=(.*);$/m)[1]);
  assert.equal(blocks(0)[0].text,original[0][0].text+original[1][0].text);
  assert.deepEqual(blocks(0)[0].sourceSpans,[{scan:20,start:0,end:5},{scan:21,start:5,end:10}]);
  assert.equal(blocks(1)[0].text,'');assert.deepEqual(blocks(1)[1],original[1][1]);
  assert.equal(layout.byPath.get('2'),docs[2]);
  assert.equal(layout.locate(1,{scan:21}).index,0);
  assert.equal(layout.locate(1,{key:'text:0:2',scan:21}).destination.key,'text:0:7');
  assert.equal(layout.locate(1,{key:'text:1:0',scan:30}).index,1);
  assert.equal(layout.locate(1,{mode:'first',scan:21}).index,1);
  assert.equal(layout.locate(1,{scan:21,view:'figure'}).index,1);
  assert.equal(layout.locate(1,{scan:21,heading:'次の節'}).index,1);
  assert.equal(await context.window.WH1ExactPager.continuousReading(reader,{...manifest,bookId:'wh1'}),null);
});

test('page cuts prefer punctuation and keep Japanese words, names, and English tokens intact', () => {
  const marker="function keepPunctuationWithPrevious(text,preferred,maxFit){\n return maxFit;\n}";
  const document=segment('us-presidents-south').replace('function paginate(blocks) {',
    "const PAGE_INITIAL_FORBIDDEN=/^[、。]/;\nfunction keepNumericGroup(t,k){return k;}\n"+marker+"\nfunction paginate(blocks) {");
  const cut=(text,max)=>child(decorate(document),'keepPunctuationWithPrevious('+JSON.stringify(text)+','+max+','+max+')');
  const ja='新しい習慣や法律を調べる。';
  assert.ok(cut(ja,ja.indexOf('律'))<=ja.indexOf('法'));
  const punctuation='資料を読み、法律を調べる。';
  assert.equal(cut(punctuation,punctuation.indexOf('律')),punctuation.indexOf('、')+1);
  assert.equal(cut('資料に James を記録する。',7),4);
  const kana='次はジョージ・ワシントンの話。';
  assert.equal(cut(kana,kana.indexOf('ワ')+2),kana.indexOf('ジ'));
  assert.equal(cut('A well-known word',8),2);
  assert.equal(cut('法律',1),0);
  assert.equal(child(decorate(document),"keepPunctuationWithPrevious('abcdefghij',5,6,'abcdefghij',0,true)"),6);
  assert.equal(cut('法律',2),2);
});
