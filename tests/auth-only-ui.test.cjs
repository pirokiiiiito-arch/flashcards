'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),vm=require('node:vm');
const UI=require('../auth-only-ui.js'),src=p=>fs.readFileSync(p,'utf8');
test('valid authentication never displays routine sync status or asks for authentication',()=>{
 const api={valid:()=>true};for(const status of ['同期中','同期済み','通信エラー','写真未転送','端末保存失敗']){api.status=()=>({status});assert.equal(UI.required(api,true),false);assert.equal(UI.required(api,false),false);}
});
test('an offline hint cannot hide the only reconnect route for an unauthenticated session',()=>{
 const api={valid:()=>false};assert.equal(UI.required(api,true),true);assert.equal(UI.required(api,false),true);
 assert.equal(UI.required(null),true);assert.equal(UI.required({valid(){throw Error('not ready');}}),true);
});
test('UI reuses user-click authentication and never reads credentials, sends network requests or deletes data',()=>{
 const s=src('auth-only-ui.js');assert.ok(s.includes('dialog.append(title,description,connect,dismiss)'));assert.ok(s.includes('entry.api.open()'));
 assert.ok(!/\b(fetch|requestAccessToken|initTokenClient|localStorage|indexedDB)\s*[.(]/.test(s));
 assert.ok(!/access_token|refresh_token|Authorization:/.test(s));assert.ok(s.includes('DOMContentLoaded'));assert.ok(s.includes('root.PlantDriveSync'));assert.ok(s.includes('root.ColorDriveSync'));new vm.Script(s);
});
test('existing URLs include static reconnect fallback before the card code starts',()=>{
 const report=JSON.parse(src('auth-only-ui-build.json'));assert.equal(report.new_entry_urls,false);
 for(const file of report.entry_points){const s=src(file);assert.ok(s.includes('data-auth-only-sync="1"'),file);assert.ok(s.indexOf('auth-only-ui.css?v=2')<s.indexOf('<body>'),file);assert.ok(s.indexOf('auth-only-ui.js?v=2')<s.indexOf('<body>'),file);assert.ok(s.includes('id="authStartupFallback"'),file);assert.ok(s.includes('window.AuthOnlySync.openCurrent()'),file);}
});
test('routine UI takes no space and reconnect has a fixed safe position',()=>{
 const s=src('auth-only-ui.css');assert.ok(s.includes('#wordQuietStatus'));assert.ok(s.includes('.study-quiet-row'));assert.ok(s.includes('[data-sync-build-note]{display:none!important}'));assert.ok(s.includes('.auth-only-prompt{position:fixed;'));assert.ok(s.includes('.auth-only-prompt[hidden]{display:none!important}'));assert.ok(s.includes('z-index:2147483000'));
});
test('public offline shells include fresh auth scripts without clearing private caches',()=>{
 for(const p of ['service-worker.js','plants/service-worker.js','colors/service-worker.js','plants/drive-view-worker.js','colors/drive-view-worker.js']){const s=src(p);assert.ok(s.includes('auth-only-ui.js?v=2'),p);assert.ok(s.includes('auth-only-ui.css?v=2'),p);new vm.Script(s);}
 for(const p of ['colors/data/review47-loader.js','colors/data/review47-local-loader-v2.js'])assert.ok(src(p).includes('study-quiet-sync.js?v=authentry2'));
});
test('auth, sync, photo data, private cache, order and research are byte-identical',()=>{
 const report=JSON.parse(src('auth-only-ui-build.json'));assert.equal(report.authentication_flow_changed,false);
 for(const [p,expected] of Object.entries(report.protected_sha256))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),expected,p);
});
