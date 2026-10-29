'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),vm=require('node:vm');
const UI=require('../auth-only-ui.js');
const src=p=>fs.readFileSync(p,'utf8');
test('connected sync, success and non-auth failures do not require authentication display',()=>{
 const api={valid:()=>true};for(const status of ['同期中','同期済み','通信エラー','写真未転送','端末保存失敗']){api.status=()=>({status});assert.equal(UI.required(api,true),false);}
});
test('initial disconnected and expired sessions require authentication, but offline viewing does not',()=>{
 const api={valid:()=>false};assert.equal(UI.required(api,true),true);assert.equal(UI.required(api,false),false);
});
test('UI reuses original user-click buttons without authentication or network work',()=>{
 const s=src('auth-only-ui.js');assert.ok(s.includes('dialog.append(title,description,connect,dismiss)'));assert.ok(s.includes('api.open()'));
 assert.ok(!/\b(fetch|requestAccessToken|initTokenClient|setInterval|setTimeout|localStorage|indexedDB)\s*[.(]/.test(s));
 assert.ok(!/access_token|refresh_token|Authorization:/.test(s));new vm.Script(s);
});
test('all existing URLs load auth-only style before application rendering',()=>{
 const report=JSON.parse(src('auth-only-ui-build.json'));assert.equal(report.new_entry_urls,false);
 for(const file of report.entry_points){const s=src(file);assert.ok(s.includes('data-auth-only-sync="1"'),file);assert.ok(s.indexOf('auth-only-ui.css?v=1')<s.indexOf('<body>'),file);assert.ok(s.indexOf('auth-only-ui.js?v=1')<s.indexOf('<body>'),file);}
});
test('routine indicators reserve no layout space; prompt is fixed-position',()=>{
 const s=src('auth-only-ui.css');assert.ok(s.includes('#wordQuietStatus'));assert.ok(s.includes('.study-quiet-row'));assert.ok(s.includes('[data-sync-build-note]{display:none!important}'));assert.ok(s.includes('.auth-only-prompt{position:fixed;'));assert.ok(s.includes('.auth-only-prompt[hidden]{display:none!important}'));
});
test('workers include new UI assets and versioned modules',()=>{
 for(const p of ['service-worker.js','plants/service-worker.js','colors/service-worker.js','plants/drive-view-worker.js','colors/drive-view-worker.js']){const s=src(p);assert.ok(s.includes('auth-only-ui.js?v=1'),p);assert.ok(s.includes('auth-only-ui.css?v=1'),p);new vm.Script(s);}
 for(const p of ['colors/data/review47-loader.js','colors/data/review47-local-loader-v2.js'])assert.ok(src(p).includes('study-quiet-sync.js?v=authonly1'));
});
test('auth, sync, storage, images, data, order and research are byte-identical',()=>{
 const report=JSON.parse(src('auth-only-ui-build.json'));assert.equal(report.authentication_flow_changed,false);
 for(const [p,expected] of Object.entries(report.protected_sha256))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),expected,p);
});
