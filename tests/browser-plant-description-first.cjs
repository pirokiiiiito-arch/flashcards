/* Layout regression with the existing isolated editor-to-phone fixture.
 * Google/source replies and pictures are synthetic; no user data is touched. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const assert=require('node:assert/strict'),vm=require('node:vm'),crypto=require('node:crypto');
const report=JSON.parse(fs.readFileSync('plants/description-first-build.json','utf8'));
assert.equal(report.new_urls,false);
for(const file of report.entries){
 const html=fs.readFileSync(file,'utf8');
 assert.ok(html.includes('body.append(desc,left);back.append(bl,body);') ||
           html.includes('intro.append(desc,googleTop);\n  body.append(intro,left);back.append(bl,body);'),
           file+' keeps the description before the photos');
 assert.ok(!html.includes('body.append(left,desc);back.append(bl,body);'),file);
 for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(match[1].trim())new vm.Script(match[1],{filename:file});
}
for(const [file,expected] of Object.entries(report.protected_sha256))
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),expected,file+' unchanged');
for(const file of ['plants/service-worker.js','plants/drive-view-worker.js']){
 const text=fs.readFileSync(file,'utf8');assert.ok(text.includes('-description1'));new vm.Script(text,{filename:file});
}
console.log('PASS all existing plant URLs, script syntax, cache versions and protected-file hashes');
let source=fs.readFileSync('tests/browser-plant-source.cjs','utf8');
const anchor="  assert.deepEqual(errors,[],'no runtime errors');";
assert.equal(source.split(anchor).length,2,'exact browser fixture insertion');
const assertions=String.raw`
  await evaluate("currentGroup='angiosperm';rebuildOrder('seed-one');homeView.classList.add('hide');deckView.classList.remove('hide');render(true)");
  const originalCards=await evaluate('JSON.stringify(cards)');
  await until(()=>evaluate('document.querySelectorAll(".image-box img").length===3&&[...document.querySelectorAll(".image-box img")].every(i=>i.naturalWidth>0)'),'all photographs below description');
  const layout=await evaluate('(()=>{const body=document.querySelector(".back-body"),desc=body.querySelector(".desc"),photos=body.querySelector(".image-stack");return {first:body.firstElementChild===desc||(body.firstElementChild.classList.contains("back-intro")&&body.firstElementChild.contains(desc)),text:desc.textContent,descBottom:desc.getBoundingClientRect().bottom,photoTop:photos.getBoundingClientRect().top,slots:[...body.querySelectorAll(".image-slot-title")].map(x=>x.textContent),whiteSpace:getComputedStyle(desc).whiteSpace};})()');
  assert.equal(layout.first,true,'description is first in DOM reading order');
  assert.equal(layout.text,'保存した説明','original description text retained');
  assert.ok(layout.photoTop>=layout.descBottom,'description is visually above all photos');
  assert.deepEqual(layout.slots,['画像1','画像2','画像3'],'three photo slots retain their order');
  assert.equal(layout.whiteSpace,'pre-wrap','description line breaks retained');
  const search=await evaluate('(()=>{const row=document.querySelector(".back-intro"),link=row?.querySelector(".back-search-link"),photo=document.querySelector(".image-box");if(!row||!link||!photo)return null;const r=link.getBoundingClientRect(),outer=row.getBoundingClientRect();return {text:link.textContent,stillInImageHeader:!!document.querySelector(".image-slot-head .linkbtn"),rightGap:outer.right-r.right,abovePhoto:r.bottom<=photo.getBoundingClientRect().top};})()');
  assert.equal(search?.text,'Google画像検索','image search remains available');
  assert.equal(search.stillInImageHeader,false,'search is no longer next to image 1');
  assert.ok(search.rightGap>=-2&&search.rightGap<=2,'search is aligned with the right edge');
  assert.ok(search.abovePhoto,'search appears before the photographs');
  await evaluate('document.querySelector(".desc").textContent=Array(60).fill("長い説明の表示確認").join("\\n")');
  assert.ok(await evaluate('document.querySelector(".desc").getBoundingClientRect().height>200'),'long descriptions remain fully laid out');
  await evaluate('render(true)');
  assert.ok(['desc','back-intro'].includes(await evaluate('document.querySelector(".back-body").firstElementChild.className')),'re-render retains description-first layout');
  assert.equal(await evaluate('JSON.stringify(cards)'),originalCards,'layout never changes stored descriptions or image references');
  assert.equal(await evaluate('document.querySelector(".front-name").textContent'),'写真移行確認用植物','front stays plant-name-only');
  console.log('PASS description above three synced photos:',width+'x'+height,editor?'editor':'phone viewer');
`;
source=source.replace(anchor,assertions+'\n'+anchor);
const filename=path.resolve('tests/.plant-description-first-generated.cjs');
const compiled=new Module(filename,module);compiled.filename=filename;compiled.paths=module.paths;compiled._compile(source,filename);
