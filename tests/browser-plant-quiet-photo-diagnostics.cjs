/* Full Chrome regression for hidden-by-default PC plant Drive/photo diagnostics.
 * Reuse synthetic Google/Supabase sources; no real user data or live network.
 */
'use strict';
const fs=require('node:fs'),Module=require('node:module'),path=require('node:path');
let s=fs.readFileSync('tests/browser-plant-source.cjs','utf8');
const anchor="   remoteSnapshot=await evaluate('__fixture.files');";
if(s.split(anchor).length!==2)throw Error('Plant browser fixture changed: expected remote-photo checkpoint');
const checks=String.raw`
   await until(()=>evaluate("!!window.PlantDriveSync&&!!document.getElementById('plantDrivePhotoDiagnostics')&&!!document.getElementById('plantDrivePhotoDetailsButton')"),
     'on-demand plant photo diagnostic controls');
   const collapsed=await evaluate("(()=>{const d=document.getElementById('plantDrivePhotoDiagnostics'),toolbar=document.querySelector('.toolbar'),button=document.getElementById('plantDrivePhotoDetailsButton'),copy=document.getElementById('plantDriveImageCopyStatus'),feedback=document.getElementById('plantDriveRetryFeedback'),status=document.getElementById('imageSyncStatus');return {dialogOpen:d.open,dialogHidden:getComputedStyle(d).display==='none',buttonTitle:button.textContent,buttonVisible:button.getBoundingClientRect().width>30,copyInside:d.contains(copy),retryInside:d.contains(feedback),statusInside:d.contains(status),statusNotAbove:!document.querySelector('header').contains(status),noProgressInToolbar:!toolbar.contains(copy)&&!toolbar.contains(feedback),allActionsWithinDialog:[...d.querySelectorAll('button')].some(b=>b.textContent==='全画像をDriveへコピー／再試行')&&[...d.querySelectorAll('button')].some(b=>b.textContent==='画像コピー結果を保存')};})()");
   assert.equal(collapsed.dialogOpen,false,'Plant photo details must start closed');
   assert.equal(collapsed.dialogHidden,true,'Closed diagnostics must consume no layout area');
   assert.equal(collapsed.buttonTitle,'同期の詳細','Only a stable diagnostic button appears during ordinary study');
   assert.equal(collapsed.buttonVisible,true);
   assert.equal(collapsed.copyInside,true);
   assert.equal(collapsed.retryInside,true);
   assert.equal(collapsed.statusInside,true);
   assert.equal(collapsed.statusNotAbove,true);
   assert.equal(collapsed.noProgressInToolbar,true,
     'Image counts, failed retry and conflicts must not appear above plant cards');
   assert.equal(collapsed.allActionsWithinDialog,true,
     'Manual recovery and JSON report saving must remain accessible on request');
   const stable=await evaluate("(()=>{const header=document.querySelector('header'),home=document.getElementById('homeView'),before=header.getBoundingClientRect().height,homeBefore=home.getBoundingClientRect().top;document.getElementById('plantDriveImageCopyStatus').textContent='登録画像 83枠 ／ Drive参照 82枠 ／ 未コピー 1枠 ／ 失敗 1枠';document.getElementById('plantDriveRetryFeedback').textContent='コピー再試行結果：Drive参照 82枠／未コピー 1枠／失敗 1枠。同期済み。競合10件の両方の内容を履歴に保持しました。'.repeat(5);document.getElementById('imageSyncStatus').textContent='画像Drive同期：同期済み（画像コピー未完了 1枠）';return {headerDelta:Math.abs(header.getBoundingClientRect().height-before),homeDelta:Math.abs(home.getBoundingClientRect().top-homeBefore)};})()");
   assert.ok(stable.headerDelta<1&&stable.homeDelta<1,'Changing automatic copy/Drive/conflict logs must not move the ordinary plant layout: '+JSON.stringify(stable));
   await evaluate("document.getElementById('plantDrivePhotoDetailsButton').click()");
   const expanded=await evaluate("(()=>{const d=document.getElementById('plantDrivePhotoDiagnostics');return {open:d.open,progress:d.querySelector('#plantDriveImageCopyStatus').textContent,retry:d.querySelector('#plantDriveRetryFeedback').textContent,buttons:[...d.querySelectorAll('button')].map(b=>b.textContent)};})()");
   assert.equal(expanded.open,true,'User may open details when they want to diagnose the remaining photo');
   assert.ok(expanded.progress.includes('Drive参照 82枠'),'Real image-count data must remain inspectable');
   assert.ok(expanded.retry.includes('競合10件'),'Historical conflict details must not be deleted');
   assert.ok(expanded.buttons.includes('全画像をDriveへコピー／再試行'));
   assert.ok(expanded.buttons.includes('画像コピー結果を保存'));
   await evaluate("[...document.querySelectorAll('#plantDrivePhotoDiagnostics button')].find(b=>b.textContent==='閉じる').click()");
   assert.equal(await evaluate("document.getElementById('plantDrivePhotoDiagnostics').open"),false);
   assert.equal(await evaluate("getImages(cards[0]).every(v=>v.startsWith('gdrive:'))"),true,
     'Hiding progress UI must not change photo upload or user picture assignments');
   console.log('PASS PC plant: 83/82/1 failure and conflicts hidden, report+manual retry available in dialog; synced images preserved');
`;
s=s.replace(anchor,checks+anchor);
const m=new Module(path.resolve('tests/.plant-quiet-photo-diagnostics-browser.cjs'),module);
m.filename=path.resolve('tests/.plant-quiet-photo-diagnostics-browser.cjs');
m.paths=module.paths;
m._compile(s,m.filename);
