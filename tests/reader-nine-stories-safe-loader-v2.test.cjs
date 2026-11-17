'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..');
const ENTRY='reader/preview/nine-stories-021-040-safe-v2/index.html';
const OLD='reader/preview/nine-stories-021-040/index.html';
const html=fs.readFileSync(path.join(ROOT,ENTRY),'utf8');
const script=html.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/i)?.[1]||'';
const readJson=r=>JSON.parse(fs.readFileSync(path.join(ROOT,r),'utf8'));
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const pinned='55c1f0c18a441937560b6f7eaaa3a469b7885b371bbc319d891281f20b00a609';
test('versioned public importer keeps previous route byte-pinned and contains no OCR/images',()=>{
 assert.ok(html.includes('ナイン・ストーリーズ'));
 assert.match(html,/<input type="file" id="file" accept="\.html,text\/html">/);
 assert.match(html,/<iframe[^>]+sandbox="allow-scripts allow-downloads"/);
 assert.doesNotMatch(html,/sandbox="[^"]*allow-same-origin/);
 assert.doesNotMatch(html,/data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]{64}/);
 assert.equal(sha(fs.readFileSync(path.join(ROOT,OLD))),
 '66b7f53a4425a2315cc889acae1ec0549ab2517dd9fb28a31d1d712febf1eff3');
});
test('reader loader runs valid JavaScript with the expected SHA/date and book identity',()=>{
 assert.ok(script.length>2500);
 assert.doesNotThrow(()=>new vm.Script(script,{filename:'nine-stories-safe-v2.js'}));
 assert.match(script,new RegExp(pinned));
 assert.match(script,/bookId:'salinger-nine-stories-shibata-021-040'/);
 assert.match(script,/range:\[21,40\]/);
 assert.match(script,/builtAt:'2026-11-17T20:18:44\+09:00'/);
});
test('old and wrong source bytes are rejected before saving or opening',()=>{
 assert.match(script,/if\(sha!==EXPECTED\.sha256\)throw Error/);
 assert.match(script,/古いファイルを誤表示しないため、保存も表示もしていません/);
 assert.match(script,/data\.bookId!==EXPECTED\.bookId/);
 assert.match(script,/data\.pages\.length!==20/);
});
test('saved data never autoloads, even when import=1 is absent',()=>{
 const block=script.slice(script.indexOf("window.addEventListener('pageshow'"));
 assert.ok(block.includes("'openSaved').hidden=false"));
 assert.ok(!/await openItem\(/.test(block),'pageshow must not automatically open any saved HTML');
 assert.match(html,/保存済みの旧HTMLを<strong>自動で開くことはありません/);
});
test('candidate is read back with a hash and old active is saved before promotion',()=>{
 assert.match(script,/store\.put\(item,STAGED\)/);
 assert.match(script,/await getSaved\(STAGED\)/);
 assert.match(script,/await digest\(staged\.blob\)!==EXPECTED\.sha256/);
 assert.match(script,/if\(old\?\.blob\)store\.put\(old,BACKUP\)/);
 assert.match(script,/store\.put\(item,ACTIVE\)/);
 assert.match(script,/await getSaved\(ACTIVE\)/);
 assert.match(script,/以前の版へ戻しました/);
 assert.match(script,/store\.put\(old,ACTIVE\)/);
});
test('positions remain SHA-scoped and legacy device stores are not modified',()=>{
 assert.match(script,/position:'\+EXPECTED\.sha256/);
 assert.match(script,/validPosition\(storedPosition\?\.position\)/);
 assert.match(script,/writeSaved\(store=>store\.put\(\{position:m\.position,sha:EXPECTED\.sha256\}/);
 assert.doesNotMatch(script,/indexedDB\.deleteDatabase/);
 assert.doesNotMatch(script,/localStorage\.clear\(/);
 assert.match(script,/Deliberately never auto-open a saved book/);
});
test('frame handshake is checked and timed out instead of claiming success on mere iframe load',()=>{
 assert.match(script,/event\.source!==frame\.contentWindow/);
 assert.match(script,/m\.session!==session/);
 assert.match(script,/reader-ready-v8/);
 assert.match(script,/12000\)/);
 assert.match(script,/読書画面から起動完了の応答がありません/);
 assert.match(script,/reader-viewport-v8/);
});
test('registered receipt is preview-only and all original sixty check statuses remain not_run',()=>{
 const registry=readJson('reader/quality/registry.json'),policy=readJson('reader/quality/release-policy.json');
 const book=registry.books.find(x=>x.entry===ENTRY);
 assert.ok(book);assert.equal(book.stage,'draft');assert.equal(book.id,'nine-stories-021-040-safe-v2-preview');
 const report=readJson(book.report);
 assert.equal(report.claimsCompleted,false);assert.equal(report.contentCertified,false);
 assert.equal(report.privateArtifact.sha256,pinned);
 assert.equal(Object.keys(report.checks).length,60);
 assert.ok(Object.values(report.checks).every(x=>x.status==='not_run'));
 const file='reader/quality/receipts/nine-stories-021-040-safe-v2-preview.json';
 assert.ok(policy.receipts.includes(file));
 const receipt=readJson(file).payload;
 assert.equal(receipt.channel,'preview');assert.equal(receipt.phase,'preview');
 assert.equal(receipt.contentCertified,false);
 assert.equal(receipt.subject.loaderSha256,sha(html));
 assert.equal(receipt.subject.artifactSha256,pinned);
 assert.equal(receipt.authorization.explicit,true);
});
