/* Isolated real-browser checks. All Google replies are synthetic. */
'use strict';
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
function replace(s,a,b){if(s.split(a).length!==2)throw Error('Auth-only browser anchor changed: '+a.slice(0,100));return s.replace(a,b);}
function run(name,s){const p=path.resolve('tests/.auth-only-'+name+'.cjs');fs.writeFileSync(p,s);try{const r=cp.spawnSync(process.execPath,[p],{stdio:'inherit',timeout:150000});if(r.error)throw r.error;if(r.status!==0)throw Error(name+' browser tests failed');}finally{fs.rmSync(p,{force:true});}}
let s=fs.readFileSync('tests/browser-word-quiet-sync.cjs','utf8');
s=replace(s,"document.querySelector('#wordQuietStatus button').click()","document.querySelector('#wordsAuthRequired button').click()");
s=replace(s,'  await sleep(150);',[
'  assert.equal(await evaluate("document.querySelector(\'#wordsAuthRequired\').hidden"),true,\'auth prompt disappears after login\');',
'  assert.equal(await evaluate("getComputedStyle(document.querySelector(\'#wordQuietStatus\')).display"),\'none\');',
'  assert.equal(await evaluate("getComputedStyle(document.querySelector(\'#syncBtn\')).display"),\'none\');',
'  assert.equal(await evaluate("[...document.querySelectorAll(\'dialog\')].some(d=>d.open)"),false,\'no success dialog\');',
'  await sleep(150);'].join('\n'));
s=replace(s,"  assert.equal(stable.same,true,'no-op sync preserves DOM');",'  assert.equal(await evaluate("document.querySelector(\'#wordsAuthRequired\').hidden"),true,\'no routine sync display\');\n'+"  assert.equal(stable.same,true,'no-op sync preserves DOM');");
s=replace(s,"  assert.deepEqual(errors,[],'no runtime error');",[
'  assert.equal(await evaluate("document.querySelector(\'#wordsAuthRequired\').hidden"),false,\'401 shows authentication prompt\');',
'  await evaluate("__fixture.fail=false;document.querySelector(\'#wordsAuthRequired button\').click()");',
'  await until(()=>evaluate("!document.querySelector(\'dialog [data-connect]\').disabled"),\'reauthentication ready\');',
'  await evaluate("document.querySelector(\'dialog [data-connect]\').click()");',
'  await until(()=>evaluate("WordDriveSync.valid()&&document.querySelector(\'#wordsAuthRequired\').hidden"),\'reauthentication hides prompt\');',
'  assert.equal(await evaluate(\'scrollY\'),y,\'authentication has no layout effect\');',
"  assert.deepEqual(errors,[],'no runtime error');"].join('\n'));
s=replace(s,"'.html':'text/html; charset=utf-8'","'.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8'");
run('word',s);
s=fs.readFileSync('tests/browser-name-retention.cjs','utf8');
s=replace(s,"origin+'/flashcards/'+app+'/saved-view.html'","origin+'/flashcards/'+app+'/photo-view.html'");
s=replace(s,"  await send('Runtime.enable');await send('Page.enable');", "  await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:390,height:760,deviceScaleFactor:1,mobile:true});");
const connect="  if(!legacy)await evaluate(\"[...document.querySelectorAll('[data-drive-readonly-controls] button')].find(b=>b.textContent.includes('初回接続')).click()\");";
s=replace(s,connect,[
'  if(!legacy){',
'    assert.equal(await evaluate("document.getElementById(\'"+app+"AuthRequired\').hidden"),false,\'initial authentication required\');',
'    await evaluate("document.querySelector(\'#"+app+"AuthRequired button\').click()");',
'    await until(()=>evaluate("!document.querySelector(\'#"+app+"AuthDialog button\').disabled"),\'existing auth button ready\');',
'    await evaluate("document.querySelector(\'#"+app+"AuthDialog button\').click()");',
'  }'].join('\n'));
const pic="  await until(()=>evaluate(`!!(${imgExpr}?.naturalWidth>0)`),'saved photograph displayed');";
s=replace(s,pic,pic+'\n'+[
'  assert.equal(await evaluate("document.getElementById(\'"+app+"AuthRequired\').hidden"),true,\'connected viewer is silent\');',
'  assert.equal(await evaluate("document.getElementById(\'"+app+"AuthDialog\').open"),false,\'auth dialog closes\');',
'  assert.equal(await evaluate("getComputedStyle(document.querySelector(\'.study-quiet-row\')).display"),\'none\');',
'  assert.equal(await evaluate("[...document.querySelectorAll(\'[data-sync-build-note]\')].every(p=>getComputedStyle(p).display===\'none\')"),true,\'no version banners\');',
'  const y=await evaluate(\'scrollY\'),node=app===\'plants\'?"document.querySelector(\'#stage .card\')":"document.querySelector(\'#back\').firstElementChild";',
'  await evaluate(\'window.__sameAuthCard=\'+node);',
'  for(let i=0;i<3;i++)await evaluate(api+\'.sync()\');',
'  assert.equal(await evaluate(\'window.__sameAuthCard===\'+node),true,\'no-op sync retains DOM\');',
'  assert.equal(await evaluate(\'scrollY\'),y,\'silent sync retains scroll\');'
].join('\n'));
const dis="  await evaluate(`localStorage.setItem('__test_offline','1');${api}.disconnect();`);await evaluate(show);assert.equal(await evaluate(nameExpr),expected);";
s=replace(s,dis,[
'  await evaluate("localStorage.setItem(\'__test_offline\',\'1\');"+api+\'.disconnect()\');',
'  assert.equal(await evaluate("document.getElementById(\'"+app+"AuthRequired\').hidden"),false,\'disconnected session requires authentication\');',
'  assert.equal(await evaluate(\'scrollY\'),y,\'auth notice does not shift card\');',
'  assert.equal(await evaluate("[...document.querySelectorAll(\'dialog\')].some(d=>d.open)"),false,\'no automatic popup\');',
'  await evaluate("Object.defineProperty(navigator,\'onLine\',{configurable:true,get:()=>false});dispatchEvent(new Event(\'offline\'))");',
'  assert.equal(await evaluate("document.getElementById(\'"+app+"AuthRequired\').hidden"),true,\'offline viewing does not nag for auth\');',
'  await evaluate(show);assert.equal(await evaluate(nameExpr),expected);'
].join('\n'));
s=replace(s,"(async()=>{await scenario('plants');await scenario('colors');await scenario('plants',{cacheOnly:true});await scenario('plants',{legacy:true});await scenario('colors',{legacy:true});})()", "(async()=>{await scenario('plants');await scenario('colors');})()");
s=replace(s,"'.html':'text/html; charset=utf-8'","'.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8'");
run('viewers',s);
console.log('PASS auth-only UI: word desktop/mobile, plant/color mobile, auto-save, stable layout, expiry and offline photographs');
