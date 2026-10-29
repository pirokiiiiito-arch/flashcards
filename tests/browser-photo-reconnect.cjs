/* Full browser regression: metadata stays identical while image access recovers.
 * Only loopback and synthetic Google responses are used. No real user data. */
'use strict';
const fs=require('node:fs'),Module=require('node:module'),path=require('node:path');
let s=fs.readFileSync('tests/browser-name-retention.cjs','utf8');
function one(a,b){if(s.split(a).length!==2)throw Error('Photo reconnect test anchor changed: '+a.slice(0,100));s=s.replace(a,b);}
one('window.__fixture={events,picture,png,hash};','window.__fixture={events,picture,png,hash,blockPhoto:true,photoFailures:0};');
one("   if(url.pathname.endsWith('/test-picture'))return new Response", "   if(url.pathname.endsWith('/test-picture')&&__fixture.blockPhoto){__fixture.photoFailures++;return new Response('Synthetic temporary failure',{status:503});}\n   if(url.pathname.endsWith('/test-picture'))return new Response");
one("origin+'/flashcards/'+app+'/saved-view.html'","origin+'/flashcards/'+app+'/auto-view.html'");
one("  if(!legacy)await evaluate(\"[...document.querySelectorAll('[data-drive-readonly-controls] button')].find(b=>b.textContent.includes('初回接続')).click()\");", "  if(!legacy)await evaluate(\"document.getElementById((window.PlantDriveSync?'plants':'colors')+'QuietDetails').showModal();[...document.querySelectorAll('[data-drive-readonly-controls] button')].find(b=>b.textContent.includes('初回接続')).click();document.getElementById((window.PlantDriveSync?'plants':'colors')+'QuietDetails').close()\");");
const before="  await until(()=>evaluate(`!!(${imgExpr})`),'image element');await evaluate(`(${imgExpr}).scrollIntoView({block:'center'})`);\n  await until(()=>evaluate(`!!(${imgExpr}?.naturalWidth>0)`),'saved photograph displayed');";
const after=[
"  await until(()=>evaluate('__fixture.photoFailures>0'),'initial image request fails');",
"  await sleep(300);",
"  const node=app==='plants'?\"document.querySelector('#stage .card')\":\"document.querySelector('#back').firstElementChild\";",
"  await evaluate(`window.__samePhotoCard=${node};window.__photoScroll=scrollY;__fixture.blockPhoto=false;`);",
"  // Reconnect/sync with exactly the SAME journal and image reference. No flip",
"  // or navigation is allowed to mask a missing retry of the visible image.",
"  await evaluate(`${api}.sync()`);",
"  await until(()=>evaluate(`!!(${imgExpr}?.naturalWidth>0)`),'same-metadata sync recovers the failed photo');",
"  assert.equal(await evaluate(`window.__samePhotoCard===${node}`),true,'retry must not rebuild the card');",
"  assert.ok(await evaluate('Math.abs(scrollY-window.__photoScroll)<2'),'retry preserves page scroll');",
"  assert.equal(await evaluate(nameExpr),expected,'retry preserves the current name');",
"  await evaluate(`(${imgExpr}).scrollIntoView({block:'center'})`);",
"  await until(()=>evaluate(`${api}.status().stats.savedImages>0`),'recovered photo is persistently cached');",
"  console.log('PASS unchanged-metadata image recovery:',app);"
].join('\n');
one(before,after);
one("(async()=>{await scenario('plants');await scenario('colors');await scenario('plants',{cacheOnly:true});await scenario('plants',{legacy:true});await scenario('colors',{legacy:true});})()", "(async()=>{const failures=[];for(const app of ['plants','colors']){try{await scenario(app);}catch(e){failures.push(app+': '+e.message);}}if(failures.length)throw Error(failures.join('\\n'));})()");
const m=new Module(path.resolve('tests/.browser-photo-reconnect-generated.cjs'),module);m.filename=path.resolve('tests/.browser-photo-reconnect-generated.cjs');m.paths=module.paths;m._compile(s,m.filename);
