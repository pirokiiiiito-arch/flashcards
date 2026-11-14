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
const shelfRevision='bookshelf-title-order-v2-20261114';

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
  caches:{open:async name=>{assert.equal(name,'private-bookshelf-shell-v12-title-order');return cache;},
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
