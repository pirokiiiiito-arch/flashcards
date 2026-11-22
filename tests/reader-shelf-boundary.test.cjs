'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.READER_AUDIT_ROOT || path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'reader/library/wh3-format.html'), 'utf8');

function figureReader({measureOnly = false, host = null} = {}) {
  const created = new Map(), revoked = new Set();
  const page = {scan:21, width:600, height:800, original:'data:image/jpeg;base64,cHJpdmF0ZQ==', blocks:[],
    figures:Array.from({length:8}, (_, i) => ({id:String(i), bbox:[i * 5,20,180,220]}))};
  const input = {bookId:'sample', range:[21,21], pages:[page]};
  if (host) { page.archiveOriginal = true; page.original = ''; }
  const win = {__readerHost:{measureOnly, session:'fixture', segment:1, origin:'https://books.example'}, addEventListener() {}};
  class FileReader {
    async readAsDataURL(blob) {
      this.result = 'data:' + blob.type + ';base64,' + Buffer.from(await blob.arrayBuffer()).toString('base64');
      this.onload();
    }
  }
  const context = vm.createContext({window:win, parent:host, Blob, FileReader, MessageChannel, setTimeout, clearTimeout,
    document:{getElementById:id => id === 'bookdata' ? {textContent:JSON.stringify(input)} : {}},
    URL:{
      createObjectURL(blob) { const url = 'blob:crop-' + created.size; created.set(url, blob); return url; },
      revokeObjectURL(url) { assert.ok(created.has(url)); revoked.add(url); }
    }
  });
  const adapter = html.slice(html.indexOf('const sourceBook=JSON.parse('), html.indexOf('</script>',html.indexOf('const sourceBook=JSON.parse(')));
  vm.runInContext(adapter, context);
  const start = html.indexOf('const book=window.READER_BOOK;',html.indexOf(adapter)+adapter.length);
  const engine = html.slice(start, html.indexOf("const main=$('reader-main')", start));
  const figures = vm.runInContext(engine + '\nfigures;',context);
  return {created,revoked,figures,page};
}

test('opening a section or measuring it does not allocate SVGs for every figure', async () => {
  const {created, revoked, figures, page} = figureReader();
  assert.equal(figures.length,8);
  assert.equal(created.size,0);
  const first = figures[0].source;
  assert.equal(figures[0].source,first);
  assert.equal(created.size,1);
  const image = await created.get(first).text();
  assert.ok(image.includes('viewBox="0 20 180 220"'));
  assert.ok(image.includes(page.original));
  for (const figure of figures.slice(1)) {
    const url = figure.source;
    assert.ok(created.has(url) && !revoked.has(url));
    assert.ok(created.size - revoked.size <= 3);
  }
  assert.ok(revoked.has(first));
  const previous = figures[0].source;
  assert.notEqual(previous,first);
  assert.equal(await created.get(previous).text(),image);
  const measured = figureReader({measureOnly:true});
  assert.ok(measured.figures.every(f => !f.source));
  assert.equal(measured.created.size,0);
});


test('simultaneous figure crops transfer one original and use the original crop coordinates', async () => {
  const requests = [], ports = [];
  const host = {postMessage(message, origin, [port]) {
    assert.equal(origin, 'https://books.example');
    requests.push({...message}); ports.push(port);
  }};
  const {figures, created} = figureReader({host});
  assert.equal(requests.length, 0);
  const crops = [figures[0].source(), figures[1].source()];
  assert.deepEqual(requests, [{wh1bridge:1, type:'sectionOriginal', session:'fixture', segment:1, scan:21}]);
  ports[0].postMessage(new Blob(['private'],{type:'image/jpeg'})); ports[0].close();
  const [first, next] = await Promise.all(crops);
  assert.equal(first.type, 'image/svg+xml');
  assert.ok((await first.text()).includes('viewBox="0 20 180 220"'));
  assert.ok((await next.text()).includes('viewBox="5 20 180 220"'));
  assert.ok((await next.text()).includes('data:image/jpeg;base64,cHJpdmF0ZQ=='));
  assert.equal(created.size,0,'no Blob URL is installed before the image renderer requests one');
  const failed = figures[0].source();
  ports[1].postMessage(null); ports[1].close();
  await assert.rejects(failed);
});

test('the host sends originals only from the requested section and closes each return port', async () => {
  const source = fs.readFileSync(path.join(root,'reader/library/read.html'),'utf8');
  const start = source.indexOf('async function sendSectionOriginal(');
  const send = vm.runInNewContext('(' + source.slice(start,source.indexOf('function wh3Progress(',start)) + ')');
  const returned = [], requested = [];
  const port = {postMessage: value => returned.push(value), close:() => returned.push('closed')};
  const bytes = new Blob(['scan']);
  const book = {wh3Flow:{manifest:{originalScans:{21:{path:'scans/21'}}}}, imageBlob:async path => {requested.push(path);return bytes;}};
  const range = {start:21,end:40};
  for (const scan of [20,41,21.5]) await send({ports:[port],data:{scan}},book,range);
  await send({ports:[],data:{scan:21}},book,range);
  assert.deepEqual(requested,[]);
  assert.deepEqual(returned,[null,'closed',null,'closed',null,'closed']);
  await send({ports:[port],data:{scan:21}},book,range);
  assert.deepEqual(requested,['scans/21']);
  assert.deepEqual(returned.slice(-2),[bytes,'closed']);
});


test('a cached older presentation gets its original inline image source', async () => {
  const source = fs.readFileSync(path.join(root,'reader/library/read.html'),'utf8');
  const start = source.indexOf('async function wh3DisplayArchive(');
  const code = '(' + source.slice(start,source.indexOf('async function sendSectionOriginal(',start)) + ')';
  for (const [layout, requested] of [['<!--WH3_PRIVATE_DATA-->',false], [html,true]]) {
    const open = vm.runInNewContext(code,{wh3Layout:async()=>layout});
    const archive = (...args) => args;
    assert.deepEqual(await open({wh3Flow:{archive}},1),[1,false,requested]);
  }
});

test('a mounted structured page paints its global counter and progress before the host can reply', () => {
  const progress = html.slice(html.indexOf('let shelfProgress='), html.indexOf("window.addEventListener('message',receiveHost)"));
  const rendering = html.slice(html.indexOf('function render(){'), html.indexOf('function menuRefresh(){'));
  const host = {session:'active', origin:'https://shelf.example'}, parent = {}, nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {hidden:true, dataset:{}, style:{
      setProperty(key,value) { this[key]=value; }, removeProperty(key) { delete this[key]; }
    }, setAttribute(key,value) { this[key]=value; }});
    return nodes.get(id);
  }
  const pages = [20,21,22].map(scan=>({scan, kind:'text', parts:[scan]}));
  const context = vm.createContext({
    host, parent, embedded:true, $:node, pages, book:{totalScans:40}, innerWidth:390, innerHeight:800,
    font:20, index:0, selectedOriginal:null, persist(){}, currentSource:()=>true,
    document:{createDocumentFragment:()=>({append(value) { this.scan=value; }})},
    textFlow:{replaceChildren(fragment) { this.scan=fragment.scan; }}, partNode:scan=>scan,
    verticalReaderSymbols:{japanesePunctuation:v=>v}, sectionOf:()=>'', pageArtwork(){},
    waitingForArtwork:()=>false
  });
  vm.runInContext(progress+'\n'+rendering+'\nrender();',context);
  const pagination = {offset:57,total:120,count:3,font:20,width:390,height:800};
  const send = (label,layout=pagination) => context.receiveHost({
    source:parent, origin:host.origin, data:{wh1bridge:1,session:host.session,action:'wh3Progress',label,pagination:layout}
  });
  const shown = () => [context.textFlow.scan,node('page-major').dataset.global,node('page-major')['aria-label']];
  send('58 / 120');
  assert.deepEqual(shown(),[20,'58 / 120','58 / 120']);
  context.gotoPage(1);
  assert.deepEqual(shown(),[21,'59 / 120','59 / 120']);
  send('58 / 120');
  assert.deepEqual(shown(),[21,'59 / 120','59 / 120']);
  assert.equal(node('progress-fill').style['--book-progress'],100*59/120+'%');
  context.waitingForArtwork=()=>true;
  context.gotoPage(2);
  send('60 / 120');
  assert.deepEqual(shown(),[21,'59 / 120','59 / 120']);
  context.waitingForArtwork=()=>false;
  context.render();
  assert.deepEqual(shown(),[22,'60 / 120','60 / 120']);
  context.gotoPage(0);
  assert.deepEqual(shown(),[20,'58 / 120','58 / 120']);
  context.innerHeight=710;
  context.render();
  assert.equal(node('page-major').dataset.global,'全巻ページ数を計測中…');
  assert.equal(node('progress-fill').style['--book-progress'],undefined);
  send('1 / 3（分冊）',{sectionOnly:true});
  context.gotoPage(1);
  assert.deepEqual(shown(),[21,'2 / 3（分冊）','2 / 3（分冊）']);
});
