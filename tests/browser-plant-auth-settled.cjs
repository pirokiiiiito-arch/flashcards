/* Real-browser plant auth regression using only synthetic auth/Drive replies. */
'use strict';
const fs=require('node:fs'),Module=require('node:module'),path=require('node:path');
let s=fs.readFileSync('tests/browser-plant-source.cjs','utf8');
const clockAnchor=" const card={id:'seed-one'";
if(s.split(clockAnchor).length!==2)throw Error('Source clock fixture changed');
s=s.replace(clockAnchor," const authNow=Date.now;window.__authTimeOffset=0;Date.now=()=>authNow()+window.__authTimeOffset;\n"+clockAnchor);
const anchor="   remoteSnapshot=await evaluate('__fixture.files');";
if(s.split(anchor).length!==2)throw Error('Source browser fixture changed');
const extra=String.raw`
   await evaluate("cloudSession=null;localStorage.removeItem(CLOUD_SESSION_KEY);window.__authTimeOffset=61000");
   await evaluate('PlantDriveSync.sync()');
   const authResult=await evaluate("({valid:PlantDriveSync.valid(),photos:getImages(cards[0]),source:PlantLegacyPhotoStatus(),prompts:[...document.querySelectorAll('.auth-only-prompt')].filter(x=>!x.hidden).map(x=>x.textContent)})");
   assert.equal(authResult.valid,true,'Google remains authenticated');
   assert.equal(authResult.photos.filter(x=>x.startsWith('gdrive:')).length,3,'photos stay on Drive');
   if(process.env.EXPECT_STALE==='1'){
    assert.ok(authResult.prompts.some(x=>x.includes('以前の植物写真')),'reproduce obsolete source-auth prompt after all photos synced');
    console.log('REPRODUCED: synced photos plus expired OLD session show unnecessary authentication');
   }else{
    assert.equal(authResult.prompts.length,0,'no obsolete source-auth prompt after all photos synced');
    await evaluate('openGroup("angiosperm");render(true)');
    await until(()=>evaluate('document.querySelectorAll(".image-box img").length===3&&[...document.querySelectorAll(".image-box img")].every(i=>i.naturalWidth>0)'),'photos still displayed');
    await evaluate("document.querySelector('dialog [data-off]').click()");
    await until(()=>evaluate("!document.querySelector('#plantsAuthRequired').hidden"),'genuinely expired Google auth is still requested');
    assert.equal(await evaluate("document.querySelector('#plantSourceAuthRequired').hidden"),true,'Google expiry does not demand old-source login');
    await evaluate("document.querySelector('#plantsAuthRequired button').click()");
    await until(()=>evaluate("!document.querySelector('dialog [data-connect]').disabled"),'Google reconnect ready');
    await evaluate("document.querySelector('dialog [data-connect]').click()");
    await until(()=>evaluate("PlantDriveSync.valid()&&document.querySelector('#plantsAuthRequired').hidden&&PlantDriveSync.status().status==='同期済み'"),'reconnected session becomes silent');
    assert.equal(await evaluate("[...document.querySelectorAll('.auth-only-prompt')].filter(x=>!x.hidden).length"),0);
    console.log('PASS: synced photos remain; obsolete old-source prompt hidden; genuine Google expiry and reconnect still work');
   }
`;
s=s.replace(anchor,extra+anchor);
const m=new Module(path.resolve('tests/.plant-auth-settled-wrapper.cjs'),module);m.filename=path.resolve('tests/.plant-auth-settled-wrapper.cjs');m.paths=module.paths;m._compile(s,m.filename);
