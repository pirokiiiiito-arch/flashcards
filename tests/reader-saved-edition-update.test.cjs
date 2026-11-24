'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const library = path.resolve(__dirname, '../reader/library');
const src = name => fs.readFileSync(path.join(library, name), 'utf8');
const between = (source, from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
const books = new Map([['fixture', [{chunkRoot:'active', bytes:10}, {chunkRoot:'staged', bytes:15}]]]);
function stateHarness(online=true, networkOK=true){
  const policy={textHash:async id=>id,ledger:async()=>books,parseLedger:async records=>records};
  const requests=[];
  const ctx=vm.createContext({fixturePolicy:policy,rulesURL:'https://shelf.example/reader/library/shelf-registration.mjs',URL,navigator:{onLine:online},
    fetch:async(url,options)=>{requests.push([url.href,options.cache]);return {ok:networkOK,json:async()=>books};}});
  const fn=between(src('storage.js'),'async function savedEditionState(', '  const CHUNK');
  vm.runInContext(fn.replace('import(rulesURL)','Promise.resolve(fixturePolicy)'),ctx);
  return {check:ctx.savedEditionState, requests};
}
test('pending and current verified copies remain readable; obsolete root detected without Drive',async()=>{
  const h=stateHarness();
  for(const root of ['active','staged'])assert.equal(await h.check({id:'fixture',registrationRoot:root}), 'current');
  assert.equal(await h.check({id:'fixture',registrationRoot:'older'}), 'changed');
  assert.equal(await h.check({id:'unknown',registrationRoot:'older'}), 'unknown');
  assert.equal(await h.check({id:'fixture',size:10}), 'unknown');
  assert.equal(await h.check({id:'fixture',size:35}), 'changed');
  assert.deepEqual(h.requests,[]);
});
test('an explicit confirmation requires a live verified ledger response',async()=>{
  const h=stateHarness(),meta={id:'fixture',registrationRoot:'active'};
  assert.equal(await h.check(meta,true), 'current');
  assert.deepEqual(h.requests,[['https://shelf.example/reader/quality/shelf-registration.json?current=1','no-store']]);
  const offline=stateHarness(false);
  assert.equal(await offline.check(meta,true), 'unknown');
  assert.deepEqual(offline.requests,[]);
  assert.equal(await stateHarness(true,false).check(meta,true), 'unknown');
});
test('the service worker cannot certify an old cached ledger as current',async()=>{
  let handler;const url='https://shelf.example/reader/quality/shelf-registration.json?current=1';
  const ctx=vm.createContext({URL,self:{registration:{scope:'https://shelf.example/reader/library/'},location:{origin:'https://shelf.example'},
    addEventListener(name,fn){if(name==='fetch')handler=fn;}},
    fetch:async(req,options)=>{assert.equal(req.url,url);assert.equal(options.cache,'no-store');throw Error('offline');},
    caches:{open(){throw Error('unexpected stale cache read');}}});
  vm.runInContext(src('sw.js'),ctx);
  let response;
  handler({request:{method:'GET',url},respondWith(value){response=value;}});
  await assert.rejects(response,/offline/);
});
