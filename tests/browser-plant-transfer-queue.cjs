/* Isolated editor-to-phone regression. All network replies and images synthetic. */
'use strict';
const fs=require('node:fs'),Module=require('node:module'),path=require('node:path');
let s=fs.readFileSync('tests/browser-plant-source.cjs','utf8');
function one(a,b){if(s.split(a).length!==2)throw Error('Queue browser anchor changed: '+a.slice(0,100));s=s.replace(a,b);}
one('window.__fixture={files,sourceReads:0};',"window.__fixture={files,sourceReads:0,photoData:'data:image/jpeg;base64,'+btoa(String.fromCharCode(...jpeg))};");
one("JSON.stringify([card])","JSON.stringify([card,{id:'zz-poison',name:'元画像が未取得の植物',description:'削除しない',group:'angiosperm',images:['idb:unavailable-source','','']}])");
one("   if(u.pathname==='/auth/v1/user')", "   if(u.pathname.includes('/plant-images/user-one/zz-poison/'))return json({message:'Missing original'},404);\n   if(u.pathname==='/auth/v1/user')");
one('  const editor=width>600;',"  const editor=width>600;if(process.env.EXPECT_BLOCKED==='1'&&!editor)return;");
const wait="  await until(()=>evaluate('Object.keys(PlantDriveSync.view().data).filter(k=>k.startsWith(\"image:\")).length===3'),'three photo references received');";
one(wait,[
"  if(process.env.EXPECT_BLOCKED==='1'){",
"    await until(()=>evaluate('PlantDriveSync.status().status===\"同期エラー\"'),'baseline blocked by an unavailable photo');",
"    assert.equal(await evaluate('Object.values(__fixture.files).filter(f=>f.meta.appProperties.kind===\"journal\").flatMap(f=>JSON.parse(new TextDecoder().decode(Uint8Array.from(f.data))).events).filter(e=>e.key.startsWith(\"image:\")).length'),0,'baseline publishes no photograph assignments');",
"    console.log('REPRODUCED: an unavailable old photo blocks every other image assignment');return;",
"  }",
"  await until(()=>evaluate('Object.entries(PlantDriveSync.view().data).filter(([k,v])=>k.startsWith(\"image:\")&&typeof v===\"string\"&&v.startsWith(\"gdrive:\")).length>=3'),'other photographs transfer despite unavailable original');"
].join('\n'));
one("   await until(()=>evaluate('PlantDriveSync.status().status===\"同期済み\"'),'editor sync completion');", "   await until(()=>evaluate('PlantDriveSync.status().status===\"画像送信待ち\"&&PlantDriveSync.status().pending>0'),'partial completion honestly retains failed photo');");
one("   remoteSnapshot=await evaluate('__fixture.files');",[
"   assert.equal(await evaluate('cards.find(c=>c.id===\"zz-poison\").images[0]'),'idb:unavailable-source','failed original is not deleted');",
"   await evaluate('cards.push({id:\"zz-new-photo\",name:\"後から追加した写真\",description:\"保存後の自動転送\",group:\"angiosperm\",images:[__fixture.photoData,\"\",\"\"]});saveCards()');",
"   await until(()=>evaluate('String(PlantDriveSync.view().data[\"image:zz-new-photo:0\"]||\"\").startsWith(\"gdrive:\")'),'new photo automatically sends without manual sync');",
"   remoteSnapshot=await evaluate('__fixture.files');",
"   const published=Object.values(remoteSnapshot).filter(f=>f.meta.appProperties.kind==='journal').flatMap(f=>JSON.parse(Buffer.from(f.data).toString('utf8')).events);",
"   assert.ok(!published.some(e=>typeof e.value==='string'&&/^(idb:|data:image|blob:)/.test(e.value)),'device-only image references never leak into journals');",
"   assert.ok(published.some(e=>e.key==='image:zz-new-photo:0'));",
"   console.log('PASS newly added photograph automatically transfers while unavailable original remains queued');"
].join('\n'));
one("   assert.equal(await evaluate('document.querySelector(\".front-name\").textContent'),'写真移行確認用植物');",[
"   assert.equal(await evaluate('document.querySelector(\".front-name\").textContent'),'写真移行確認用植物');",
"   assert.equal(await evaluate('getImages(cards.find(c=>c.id===\"zz-new-photo\"))[0].startsWith(\"gdrive:\")'),true,'fresh phone receives the newly registered image');"
].join('\n'));
const m=new Module(path.resolve('tests/.plant-transfer-queue-source.cjs'),module);m.filename=path.resolve('tests/.plant-transfer-queue-source.cjs');m.paths=module.paths;m._compile(s,m.filename);
