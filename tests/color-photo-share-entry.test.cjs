'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');

test('fresh photo entry uses the fully built read-only Drive viewer',()=>{
  const source=read('colors/photo-view.html');
  const shared=read('colors/photo-share-20261106.html');
  const marker='<meta name="color-photo-share-entry" content="20261106">';
  assert.ok(shared.includes(marker));
  assert.equal(shared.replace(marker,'').replace('<head>\n','<head>'),source);
  for(const needle of [
    'window.FLASHCARDS_READONLY_VIEW=true',
    'review47-local-loader-v2.js',
    'auth-only-ui.js',
    'photo-resume-build',
    'id="swatch"'
  ]) assert.ok(shared.includes(needle),needle);
  assert.ok(!shared.includes("location.replace('./index.html"),'viewer must not redirect to editor');
});
test('viewing and editor stay separate while retaining the same Drive namespace',()=>{
  const view=read('colors/photo-share-20261106.html');
  const src=read('colors/data/review47-local-loader-v2.js');
  const support=read('colors/local-adapter.js');
  const editor=read('colors/index.html');
  assert.ok(view.includes('review47-local-loader-v2.js'));
  assert.ok(src.includes('./local-adapter.js'));
  assert.ok(support.includes("namespace:'colors1000-review47'"));
  assert.ok(!editor.includes('FLASHCARDS_READONLY_VIEW=true'));
  assert.ok(src.includes('./nav-top.js?v=4'), 'card fit and navigation remain available in shared viewer');
});
test('no fresh viewer HTML contains embedded private images',()=>{
  const s=read('colors/photo-share-20261106.html');
  assert.ok(!s.includes('data:image/png;base64,'));
  assert.ok(!s.includes('data:image/jpeg;base64,'));
  assert.ok(!s.includes('Google接続を確認／再読込') || s.includes('authStartupFallback'));
});
