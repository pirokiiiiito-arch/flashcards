'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../guns/data.js'),X=require('../guns/extended-models.js'),V=require('../guns/extended-variants.js');
test('the study catalogue contains 2,000 distinct named firearm models and variants, never numbered filler',()=>{
 assert.equal(C.CATALOG_TARGET,2000);
 assert.equal(C.SEEDS.length,2000,'The user requested exactly 2,000 study cards');
 assert.ok(X.entries.length>1000);
 assert.ok(V.entries.length>500);
 const keys=new Set(),ids=new Set();
 for(const card of C.SEEDS){
   assert.ok(card.name_en&&/[A-Za-z]/.test(card.name_en),'English search model missing: '+card.id);
   assert.ok(card.name&&/[ァ-ヶぁ-ゔ一-龯]/.test(card.name),'Japanese display name missing: '+card.id);
   assert.ok(!/[A-Za-z]/.test(card.name),'Card fronts must contain katakana, not English names: '+card.name);
   assert.ok(card.description.length>10,'Description must not be empty: '+card.id);
   assert.ok(card.search.includes(card.name_en),'Google Images searches must use the English model name: '+card.id);
   assert.deepEqual(card.images,['','',''],'No photo should be invented by a catalogue expansion');
   assert.ok(!ids.has(card.id),'Duplicate stable ID: '+card.id);
   ids.add(card.id);
   const key=C.modelIdentity(card.category,card.name_en);
   assert.ok(!keys.has(key),'Duplicated firearm model: '+key);
   keys.add(key);
   assert.ok(!/未登録|調査待ち|placeholder/i.test(card.name),'No fake unnamed model slots');
   if(card.country)assert.ok(C.COUNTRIES[card.country]?.image,'Country flag must refer to a known local image');
 }
});
test('original 35 photo keys and user revisions survive catalog expansion unchanged',()=>{
 for(let i=0;i<35;i++)assert.equal(C.SEEDS[i].id,'gun-'+String(i+1).padStart(4,'0'));
 const old=C.SEEDS[0],original='idb:gunimg:gun-0001:0:existing-photo';
 const edited=C.mergeCards([{...old,description:'保存済みの本人の説明',images:[original,'',''],maker:'元の個別編集',name:'自分のカード名'}]);
 assert.equal(edited.length,2000);
 assert.deepEqual(edited[0].images,[original,'','']);
 assert.equal(edited[0].name,'自分のカード名');
 assert.equal(edited[0].description,'保存済みの本人の説明');
 assert.equal(edited[0].maker,'元の個別編集');
 const last=C.SEEDS[1999],ref='idb:gunimg:'+last.id+':2:source-photo';
 assert.equal(C.extendedId(last.category,last.name_en),last.id,'A model ID cannot depend on the order of the list');
 const roundTrip=C.mergeCards([{...last,description:'利用者の説明',images:['','',ref]}]).find(x=>x.id===last.id);
 assert.equal(roundTrip.images[2],ref);
 assert.equal(roundTrip.description,'利用者の説明');
});
test('historical categories keep their original ordering; all 2,000 cards remain searchable by type',()=>{
 assert.deepEqual(C.CATEGORIES.map(c=>c.id),['shotgun','revolver','bolt','lever','machine-gun','semi-rifle','pistol','smg','assault','other']);
 for(const cat of C.CATEGORIES.slice(0,-1)){
   assert.ok(C.SEEDS.filter(c=>c.category===cat.id).length>=60,cat.ja+' must have a meaningful study bank');
 }
 const countByType=Object.fromEntries(C.CATEGORIES.map(c=>[c.id,C.SEEDS.filter(x=>x.category===c.id).length]));
 assert.equal(Object.values(countByType).reduce((a,b)=>a+b,0),2000);
 assert.equal(C.SEEDS[0].name,'レミントン・モデル870');
 assert.equal(C.SEEDS[0].name_en,'Remington Model 870');
});
