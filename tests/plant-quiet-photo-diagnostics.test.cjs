'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('plants/drive-sync.js','utf8');

test('plant photo copy status, manual retry and failure details live only inside an on-demand dialog',()=>{
 const start=source.indexOf("  const diagnostics = document.createElement('dialog');");
 const end=source.indexOf('  let recoveryBusy = false;',start);
 assert.ok(start>0&&end>start,'The photo UI must construct a separate diagnostic dialog');
 const ui=source.slice(start,end);
 for(const expected of [
  "diagnostics.id = 'plantDrivePhotoDiagnostics'",
  "diagnostics.setAttribute('aria-label', '植物の同期・画像コピーの詳細')",
  "copyStatus.id = 'plantDriveImageCopyStatus'",
  "retryFeedback.id = 'plantDriveRetryFeedback'",
  "retry.textContent = '全画像をDriveへコピー／再試行'",
  "reportButton.textContent = '画像コピー結果を保存'",
  'diagnosticActions.append(retry, reportButton);',
  'diagnostics.append(copyStatus, retryFeedback, diagnosticActions, closeDiagnostics);',
  'document.body.appendChild(diagnostics);',
  "detailButton.textContent = '同期の詳細'",
  'detailButton.onclick = () => { if (!diagnostics.open) diagnostics.showModal(); };',
  'controls.append(detailButton);',
  'if (imageSyncStatus) diagnostics.appendChild(imageSyncStatus);'
 ])assert.ok(ui.includes(expected),'Missing diagnostic isolation: '+expected);
 assert.ok(!ui.includes('controls.append(retry, reportButton, copyStatus, retryFeedback)'),
  'The old constantly-changing progress row must not be placed above the cards');
 assert.ok(!ui.includes('controls.append(copyStatus)'),'Automatic status should never appear in the toolbar');
 assert.ok(ui.indexOf('document.body.appendChild(diagnostics)')<ui.indexOf('controls.append(detailButton)'));
});
test('automatic transfer, retained originals, manual retry and exported failure report are not removed',()=>{
 assert.ok(source.includes("const automaticPhotoRegistrations = new Map()"));
 assert.ok(source.includes("const completed = await retryPlantPhotos('自動', batch)"));
 assert.ok(source.includes("scheduleAutomaticPhotoRegistration(650)"));
 assert.ok(source.includes("await copier.sweep()"));
 assert.ok(source.includes("if (republishKeys.length && sync.republish) await sync.republish(republishKeys)"));
 assert.ok(source.includes("retry.onclick = () => retryPlantPhotos('手動')"));
 assert.ok(source.includes("reportButton.onclick = () => {"));
 assert.ok(source.includes("new Blob([JSON.stringify(body,null,2)]"));
 assert.ok(source.includes("元のPCに保持しています"));
 assert.ok(source.includes("copyStatus.textContent = '登録画像 '"));
 assert.ok(source.includes("retryFeedback.textContent = 'コピー再試行結果："));
});
test('plant editor public entry includes the new dialog script version, leaving viewer and other apps alone',()=>{
 for(const path of ['plants/index.html','plants/plant-sync-v2.html']){
  const html=fs.readFileSync(path,'utf8');
  assert.ok(html.includes('./drive-sync.js?v=authsettled13'),path);
  assert.ok(html.includes('id="imageSyncStatus"'),path);
 }
 const sw=fs.readFileSync('plants/service-worker.js','utf8');
 assert.ok(sw.includes('plant-flashcards-v48-quietdiagnostics1'),'New plant cache version');
 assert.ok(sw.includes('./drive-sync.js?v=authsettled13'),'New plant sync script in offline cache');
 const settle=fs.readFileSync('tools/settle-plant-auth-ui.py','utf8');
 assert.ok(settle.includes("authsettled13"));
 assert.ok(settle.includes("plant-flashcards-v48-quietdiagnostics1"));
});
