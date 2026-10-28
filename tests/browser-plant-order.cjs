/* Reuse the existing loopback-only Chrome harness with an ordering fixture.
 * All names, photographs and Drive responses in this test are synthetic. */
'use strict';
const fs=require('node:fs'),Module=require('node:module'),path=require('node:path');
let s=fs.readFileSync('tests/browser-name-retention.cjs','utf8');
function one(a,b){if(s.split(a).length!==2)throw Error('Browser order test anchor changed: '+a.slice(0,80));s=s.replace(a,b);}
one('function bootstrap(app,cacheOnly){','let pcOrderFixture=false;\nfunction bootstrap(app,cacheOnly){');
one("if(app==='plants'){add('card:test-plant',{id:'test-plant',name:'保存確認用の植物名',description:'検証用の説明',group:'angiosperm',sort_order:1});add('image:test-plant:0',ref);}",`if(app==='plants'){
  const rows=[['seed-angiosperm-10','テスト10'],['test-plant','追加確認用'],['seed-angiosperm-2','アイヌタチツボスミレ'],['seed-angiosperm-1','アイズシモツケ']];
  for(const [id,name] of rows){add('card:'+id,{id,name,description:'検証用',group:'angiosperm',sort_order:0});add('image:'+id+':0',ref);}
  if(pcOrderFixture)add('order:normal',{schema:'plant-pc-normal-order-v1',ids:['seed-angiosperm-2','test-plant','seed-angiosperm-10','seed-angiosperm-1'],revision:'fixture-pc',updated_at:'2026-01-01T00:00:00Z'});
 }`);
one("const expected=app==='plants'?'保存確認用の植物名':await evaluate('CARDS[0].name');assert.equal(await evaluate(nameExpr),expected);",`const expected=pcOrderFixture?'アイヌタチツボスミレ':'アイズシモツケ';
  const expectedIds=pcOrderFixture?['seed-angiosperm-2','test-plant','seed-angiosperm-10','seed-angiosperm-1']:['seed-angiosperm-1','seed-angiosperm-2','seed-angiosperm-10','test-plant'];
  assert.equal(await evaluate(nameExpr),expected);
  assert.deepEqual(await evaluate('cards.map(c=>c.id)'),expectedIds,'phone normal order must match PC record/source order');
  await evaluate('shuffleBtn.click();shuffleBtn.click();render(true)');
  assert.deepEqual(await evaluate('order.map(i=>cards[i].id)'),expectedIds,'temporary shuffle must not replace normal order');`);
one("assert.equal(await evaluate(api+'.valid()'),false);", "assert.deepEqual(await evaluate('cards.map(c=>c.id)'),expectedIds,'same normal order after cached reload');\n  assert.equal(await evaluate(api+'.valid()'),false);");
one("(async()=>{await scenario('plants');await scenario('colors');await scenario('plants',{cacheOnly:true});await scenario('plants',{legacy:true});await scenario('colors',{legacy:true});})().catch(e=>{console.error(e);process.exitCode=1;});", "(async()=>{await scenario('plants');pcOrderFixture=true;await scenario('plants');await scenario('plants',{cacheOnly:true});await scenario('plants',{legacy:true});})().catch(e=>{console.error(e);process.exitCode=1;});");
const filename=path.resolve('tests/.browser-plant-order.generated.cjs');
const runner=new Module(filename,module);runner.filename=filename;runner.paths=Module._nodeModulePaths(path.dirname(filename));runner._compile(s,filename);
