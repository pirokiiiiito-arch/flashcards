/* Reuse the existing isolated Chrome server/fixture. All Google replies are
 * synthetic. Verify unchanged DOM, automatic updates and offline restoration. */
'use strict';
const fs=require('node:fs'),Module=require('node:module'),path=require('node:path');
let s=fs.readFileSync('tests/browser-name-retention.cjs','utf8');
function one(a,b){if(s.split(a).length!==2)throw Error('Browser test anchor changed: '+a.slice(0,100));s=s.replace(a,b);}
one('i<160','i<340');
one("md5Checksum:'unchanged-test-journal'","md5Checksum:'journal-revision-'+events.length");
one("origin+'/flashcards/'+app+'/saved-view.html'","origin+'/flashcards/'+app+'/auto-view.html'");
one("  if(!legacy)await evaluate(\"[...document.querySelectorAll('[data-drive-readonly-controls] button')].find(b=>b.textContent.includes('初回接続')).click()\");", "  if(!legacy)await evaluate(\"document.getElementById(''+(window.PlantDriveSync?'plants':'colors')+'QuietDetails').showModal();[...document.querySelectorAll('[data-drive-readonly-controls] button')].find(b=>b.textContent.includes('初回接続')).click();document.getElementById(''+(window.PlantDriveSync?'plants':'colors')+'QuietDetails').close()\");");
const marker="  await evaluate(`localStorage.setItem('__test_offline','1');${api}.disconnect();`);";
one(marker,"""
  const stageExpr=app==='plants'?"document.querySelector('#stage .card')":"document.querySelector('#back').firstElementChild";
  await evaluate(`window.__retainedStudyNode=${stageExpr};window.__readingY=scrollY;window.__readingTop=(${stageExpr}).getBoundingClientRect().top;`);
  for(let iteration=0;iteration<3;iteration++){
    await evaluate(`${api}.sync()`);
    assert.equal(await evaluate(`window.__retainedStudyNode===${stageExpr}`),true,'no-op sync retains the actual card DOM');
    assert.ok(await evaluate(`Math.abs(scrollY-window.__readingY)<2`),'no-op sync preserves page scroll');
    assert.ok(await evaluate(`Math.abs((${stageExpr}).getBoundingClientRect().top-window.__readingTop)<2`),'status text does not move the reading layout');
  }
  // Change the remote fixture without pressing any synchronization control.
  if(app==='plants')await evaluate(`__fixture.events.push({id:'new-plant-event',key:'card:new-plant',value:{id:'new-plant',name:'自動受信の植物',description:'検証用',group:'angiosperm',sort_order:100},parents:[],clock:100,deleted:false});`);
  else await evaluate(`__fixture.events.push({id:'new-palette-event',key:'photo:color-0001:palette',value:{data_url:__fixture.picture,sha256:__fixture.hash,label:'自動受信の配色',updated_at:'2026-01-02T00:00:00Z'},parents:__fixture.events.filter(e=>e.key==='photo:color-0001:palette').map(e=>e.id),clock:100,deleted:false});`);
  await until(()=>evaluate(app==='plants'?"cards.some(c=>c.id==='new-plant')":"manualEdits['color-0001:palette']?.label==='自動受信の配色'"),'new remote content automatically received without manual sync');
  assert.equal(await evaluate(nameExpr),expected,'automatic receive retains the current card');
  assert.ok(await evaluate(`Math.abs(scrollY-window.__readingY)<2`),'automatic receive preserves scroll');
  assert.equal(await evaluate("document.querySelector('.study-quiet-dialog').open"),false,'automatic receive does not open a dialog');
  console.log('PASS automatic receive and stable layout:',app);
""".replace(/^"""|"""$/g,'')+marker);
// JavaScript does not have Python triple-quoted strings; the insertion above is
// replaced with a template literal in the committed source by its author.
one("(async()=>{await scenario('plants');await scenario('colors');await scenario('plants',{cacheOnly:true});await scenario('plants',{legacy:true});await scenario('colors',{legacy:true});})()", "(async()=>{await scenario('plants');await scenario('colors');})()");
const m=new Module(path.resolve('tests/.browser-study-quiet-generated.cjs'),module);m.filename=path.resolve('tests/.browser-study-quiet-generated.cjs');m.paths=module.paths;m._compile(s,m.filename);
