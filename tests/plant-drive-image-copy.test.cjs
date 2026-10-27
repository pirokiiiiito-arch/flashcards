'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const P = require('../plants/drive-image-copy.js');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWRsAAAAASUVORK5CYII=', 'base64');
const digest = async x => createHash('sha256').update(typeof x === 'string' ? x : Buffer.from(x)).digest('hex');
function rig(options = {}) {
  let cards = options.cards || [{id:'plant-1',name:'サクラ',images:['https://images.example/a.png','','']}];
  const stored = new Map(), blobs = new Map(), calls = {upload:0, fresh:0, changed:0, fetch:0};
  const api = {
    account:'account-A', valid:() => true, digest,
    cache:{get:async (_,k) => stored.get(k), put:async (_,k,v) => stored.set(k,structuredClone(v))},
    putBlob:async blob => {calls.upload++;const ref = 'gdrive:file1:' + await digest(await blob.arrayBuffer()); blobs.set(ref,blob);return ref;},
    getBlob:async (ref,o) => {assert.equal(o.fresh,true);calls.fresh++;if(options.badHash)return new Blob(['wrong']);if(!blobs.has(ref))throw Error('404');return blobs.get(ref);},
    list:async () => [], queryKind:() => 'images', create:async (_,b) => ({id:'other'})
  };
  const copier = P.create({
    getCards:() => cards, getImages:c => c.images, resolveImage:async v => options.resolve ? options.resolve(v) : '',
    isEditing:() => !!options.editing,
    fetch:async (url,init) => {calls.fetch++;assert.equal(init.credentials,'omit');assert.equal(init.mode,'cors');assert.equal(init.referrerPolicy,'no-referrer');assert.equal(init.headers,undefined);if(options.fetch)return options.fetch(url,init,() => cards);return new Response(png,{headers:{'content-type':'application/octet-stream'}});},
    replaceIfCurrent:(id,i,src,ref) => {const c = cards.find(c => c.id === id);if(!c || c.images[i] !== src || options.editing)return false;c.images[i] = ref;return true;},
    changed:() => calls.changed++, onProgress:() => {}
  });
  copier.attach(api);
  return {copier,api,calls,stored,blobs,get cards(){return cards;},set cards(v){cards=v;}};
}
test('new external URL copies original bytes to private Drive and freshly verifies SHA', async () => {
  const r = rig();const ref = await r.copier.convert('image:plant-1:0',r.cards[0].images[0]);
  assert.ok(P.isDrive(ref));assert.equal(r.calls.upload,1);assert.equal(r.calls.fresh,1);
  assert.deepEqual(Buffer.from(await r.blobs.get(ref).arrayBuffer()),png);
  const metadata = [...r.stored.values()][0];assert.equal(metadata.source,'https://images.example/a.png');assert.equal(metadata.ref,ref);
});
test('previously synced unchanged URLs are upgraded and captured for a follow-up push', async () => {
  const r = rig();await r.copier.sweep();assert.ok(P.isDrive(r.cards[0].images[0]));assert.equal(r.calls.changed,1);assert.equal(r.copier.summary().pending,0);
  await r.copier.sweep();assert.equal(r.calls.upload,1);
});
test('CORS failure preserves URL, reports incomplete, and does not block the next image', async () => {
  const r = rig({cards:[{id:'p',name:'植物',images:['https://images.example/blocked','https://images.example/good','']}],fetch:async url => {if(url.includes('blocked'))throw new TypeError('Failed to fetch');return new Response(png);}});
  await r.copier.sweep();assert.equal(r.cards[0].images[0],'https://images.example/blocked');assert.ok(P.isDrive(r.cards[0].images[1]));assert.equal(r.copier.summary().failed,1);assert.equal(r.copier.summary().pending,1);assert.match(r.copier.report().images[0].reason,/CORS/);
});
test('HTML pretending to be an image is never uploaded', async () => {
  const r = rig({fetch:async () => new Response('<html>login</html>',{headers:{'content-type':'image/png'}})});
  await r.copier.sweep();assert.equal(r.calls.upload,0);assert.equal(r.copier.summary().pending,1);
});
test('a hash mismatch does not replace the original URL or mark a verified source', async () => {
  const r = rig({badHash:true});await r.copier.sweep();assert.match(r.cards[0].images[0],/^https:/);assert.equal(r.calls.changed,0);assert.equal([...r.stored.keys()].filter(k => k.startsWith('plant-image-source-v1:')).length,0);assert.match(r.copier.report().images[0].reason,/SHA-256/);
});
test('a photo replaced while downloading wins over migration', async () => {
  const r = rig({fetch:async (u,i,get) => {get()[0].images[0]='https://images.example/new';return new Response(png);}});
  await r.copier.sweep();assert.equal(r.cards[0].images[0],'https://images.example/new');assert.equal(r.calls.changed,0);
});
test('a card deleted while downloading is not resurrected', async () => {
  const r = rig({fetch:async (u,i,get) => {get().splice(0,1);return new Response(png);}});
  await r.copier.sweep();assert.equal(r.cards.length,0);assert.equal(r.calls.changed,0);
});
test('three slots with the same URL reuse one verified immutable image', async () => {
  const r = rig({cards:[{id:'p',name:'植物',images:Array(3).fill('https://images.example/a.png')}]});
  await r.copier.sweep();assert.equal(r.calls.upload,1);assert.equal(new Set(r.cards[0].images).size,1);assert.equal(r.copier.summary().drive,3);
});
test('a saved source mapping is checked against Drive again before reuse', async () => {
  const r = rig();const url = r.cards[0].images[0];const ref = await r.copier.convert('image:plant-1:0',url);
  r.copier.retry();assert.equal(await r.copier.convert('image:plant-1:0',url),ref);assert.equal(r.calls.upload,1);assert.equal(r.calls.fresh,2);
});
test('already-Drive images are not downloaded from third parties', async () => {
  const r = rig();const ref = 'gdrive:x:' + 'a'.repeat(64);assert.equal(await r.copier.convert('image:p:0',ref),ref);assert.equal(r.calls.fetch,0);
});
test('retry clears failure cooldown and succeeds without restoring files', async () => {
  let failing = true;const r = rig({fetch:async () => {if(failing)throw new TypeError('offline');return new Response(png);}});
  await r.copier.sweep();failing=false;await r.copier.sweep();assert.equal(r.calls.fetch,1);r.copier.retry();await r.copier.sweep();assert.ok(P.isDrive(r.cards[0].images[0]));
});
test('active card editor prevents the migration sweep', async () => {
  const r = rig({editing:true});await r.copier.sweep();assert.equal(r.calls.fetch,0);assert.equal(r.calls.changed,0);
});
test('authentication failure does not silently become a successful URL sync', async () => {
  const r = rig();r.api.putBlob=async () => {const e=Error('expired');e.auth=true;throw e;};
  await assert.rejects(r.copier.convert('image:p:0','https://images.example/a.png'),/expired/);assert.equal(r.copier.summary().drive,0);
});
test('oversized response is rejected before being copied', async () => {
  const r = rig({fetch:async () => new Response(png,{headers:{'content-length':String(P.MAX_BYTES+1)}})});
  await r.copier.sweep();assert.equal(r.calls.upload,0);assert.match(r.copier.report().images[0].reason,/25MB/);
});
test('device image resolver remains supported', async () => {
  const r = rig({resolve:async () => 'data:image/png;base64,' + png.toString('base64')});const ref = await r.copier.convert('image:p:0','idb:plantimg:p:0');assert.ok(P.isDrive(ref));
});
test('adapter installs without changing other apps and uses safe afterSync migration', async () => {
  let cfg;const nodes=[];const rootNode={append(...n){nodes.push(...n);},appendChild(n){nodes.push(n);}};
  const doc={head:rootNode,body:rootNode,querySelector:()=>rootNode,createElement:() => ({style:{},setAttribute(){},click(){}})};
  const r=rig();const api={...r.api,changed(){},open(){},sync:async()=>{},status:()=>({status:'同期済み'})};
  const context={window:null,document:doc,PlantDriveImageCopy:P,FlashcardsDrive:{digest,install:c=>{cfg=c;return api;}},
    cards:[{id:'p',group:'fern',name:'シダ',description:'',images:['','','']}],getImages:c=>c.images,withImages:(c,i)=>({...c,images:i}),saveCards(){},resolveImageValue:async v=>v,
    plantBootReady:Promise.resolve(),plantDrivePrimary:()=>true,editing:false,STORAGE_KEY:'plants',legacyImageRequests:[],updateImageSyncStatus(){},
    imageSyncStatus:{},localStorage:{getItem:()=>null,setItem(){}},loadCards:()=>[],updateCounts(){},currentGroup:'',rebuildOrder(){},render(){},currentIndex:()=>0,
    stage:{querySelector:()=>null},isShuffled:false,order:[],pos:0,getStoredImage:async()=>'',putStoredImage:async()=>{},blobToDataUrl:async()=>'',
    Blob,URL,structuredClone,setTimeout,clearTimeout,ensureCloudSession:async()=>null};
  context.window=context;vm.createContext(context);
  await vm.runInContext(fs.readFileSync('plants/drive-sync.js','utf8'),context);await cfg.ready;
  assert.equal(cfg.namespace,'plant-flashcards');assert.equal(typeof cfg.afterSync,'function');assert.equal(typeof context.PlantDriveSync.sync,'function');assert.equal(context.cards.length,1);
});
