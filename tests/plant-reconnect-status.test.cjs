'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('plants/reconnect-check.html','utf8');
const match=html.match(/<script>\s*(\(function\(\)\{[\s\S]*?\}\)\(\);)\s*<\/script>/);
assert.ok(match,'connection checker inline controller must exist');
function page(initialPhase,overrides={}){
  let phase=initialPhase, opened=0;
  const events={},timers=[];
  const nodes=Object.fromEntries(['connectionState','connectionDetail','checkConnection','openAuthentication','persistentDriveDialog'].map(key=>[key,{textContent:'',open:false,disabled:false,addEventListener(event,fn){events[key+':'+event]=fn;}}]));
  const api={state:()=>({phase}),message:code=>'Reason: '+code,getToken:async()=>({token:'synthetic-private-token'}),open:()=>{opened++;nodes.persistentDriveDialog.open=true;}};
  Object.assign(api,overrides);
  const window={PersistentDriveAuth:api,setInterval:()=>0,setTimeout:fn=>{timers.push(fn);return 1;},addEventListener:()=>{}};
  const document={getElementById:key=>nodes[key]||null};
  vm.runInNewContext(match[1],{window,document,console});
  return {nodes,events,timers,api,setPhase:value=>{phase=value;},get opened(){return opened;}};
}
test('already-connected Google Drive shows verified status instead of a false login dialog',async()=>{
  const p=page('connected');
  assert.match(p.nodes.connectionState.textContent,/接続済み/);
  p.events['openAuthentication:click']();
  assert.equal(p.opened,0);
  assert.match(p.nodes.connectionDetail.textContent,/既に認証済み/);
  await p.events['checkConnection:click']();
  assert.match(p.nodes.connectionDetail.textContent,/認証を確認できました/);
});
test('auth dialog that closes after automatic connection never claims it remains visible',()=>{
  const p=page('google_auth_required');
  p.api.open=()=>{p.nodes.persistentDriveDialog.open=true;p.setPhase('connected');p.nodes.persistentDriveDialog.open=false;};
  p.events['openAuthentication:click']();
  assert.equal(p.timers.length,1);
  p.timers.shift()();
  assert.match(p.nodes.connectionState.textContent,/接続済み/);
  assert.match(p.nodes.connectionDetail.textContent,/接続を確認しました/);
  assert.doesNotMatch(p.nodes.connectionDetail.textContent,/ダイアログが開いています/);
});
test('auth dialog that remains open gives instructions while not claiming connection',()=>{
  const p=page('google_auth_required');
  p.events['openAuthentication:click']();
  p.timers.shift()();
  assert.match(p.nodes.connectionState.textContent,/再接続が必要/);
  assert.match(p.nodes.connectionDetail.textContent,/認証ダイアログが開いています/);
});
test('authentication errors remain explicit and do not alter photo storage',async()=>{
  const p=page('app_login_required',{getToken:async()=>{const e=Error('test');e.code='app_login_required';throw e;}});
  await p.events['checkConnection:click']();
  assert.match(p.nodes.connectionState.textContent,/アプリのログインが必要/);
  assert.match(p.nodes.connectionDetail.textContent,/app_login_required/);
  assert.equal(p.nodes.checkConnection.disabled,false);
  assert.doesNotMatch(match[1],/localStorage\.(?:clear|removeItem)|indexedDB\.deleteDatabase|delete\s+cards\b/);
});
test('PC entry and former reconnect route point to the new no-cache-path checker',()=>{
  const pc=fs.readFileSync('plants/index.html','utf8');
  const old=fs.readFileSync('plants/reconnect.html','utf8');
  assert.ok(pc.includes('href="./reconnect-check.html"'));
  assert.ok(old.includes('location.replace("./reconnect-check.html")'));
  assert.ok(html.includes('persistent-drive-auth.js?v=1'));
});
