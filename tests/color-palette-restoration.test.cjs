'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const Network=require('../colors/network-support.js');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCFkAAAAASUVORK5CYII=','base64');
const hash=crypto.createHash('sha256').update(png).digest('hex');
const ref='gdrive:synthetic_palette_image:'+hash;
const data='data:image/png;base64,'+png.toString('base64');
const roles=['origin','interior','fashion','product','palette'];
const source=file=>fs.readFileSync(file,'utf8');
function functionLine(src,name){
 const lines=src.split('\n').filter(line=>line.startsWith('function '+name+'('));
 assert.equal(lines.length,1,'exact original function: '+name);return lines[0];
}
function contextFor(file){
 const src=source(file),elements={};
 const el=id=>elements[id]||(elements[id]={className:'',innerHTML:'',classList:{toggle(){}},querySelectorAll(){return [];}});
 const CARDS=Array.from({length:1000},(_,i)=>({name:'色'+(i+1),hex:'#334455',origin:'jp'}));
 const CARD_IDS=CARDS.map((_,i)=>'color-'+String(i+1).padStart(4,'0'));
 const ctx={console,URL,structuredClone,CARDS,CARD_IDS,manualEdits:{},PRIVATE_PHOTO_MAP:{},ORIGIN_PHOTO_RENDER_CACHE:{},USAGE_PHOTO_ATTRIBUTIONS:{},
   VALID_SLOT_KEYS:new Set(CARD_IDS.flatMap(id=>roles.map(role=>id+':'+role))),
   ROLE_LABELS:{origin:'由来・名前のイメージ',interior:'インテリア',fashion:'ファッション',product:'プロダクト',palette:'配色'},
   state:{flipped:true},$ : el,research:()=>({}),effectiveColor:c=>({...c,rgb:[51,68,85]}),displayColorReferenceMarkup:()=>'',
   safeLink:value=>{try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}},
   escapeHtml:x=>String(x??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),
   own:(o,k)=>Object.prototype.hasOwnProperty.call(o,k),bindPhotoActions(){ctx.bound++;},bound:0,
   externalLink:(url,label)=>'<a href="'+url+'">'+label+'</a>',window:{ColorNetworkSupport:Network}};
 vm.createContext(ctx);
 for(const name of ['safeImage','sourcePhoto','slotPhoto','photoCredit','searchTerms','photoSlot','renderBack','normalizeEdits'])vm.runInContext(functionLine(src,name),ctx);
 ctx.back=el('back');return ctx;
}
for(const file of ['colors/app-main.js','colors/app-view.js']){
 test(file+' renders exactly five separate image roles for each of the 1000 colors',()=>{
  const ctx=contextFor(file);
  for(let i=0;i<1000;i++){
   ctx.renderBack(ctx.CARDS[i],i);
   const html=ctx.back.innerHTML;
   assert.equal((html.match(/class="palette-photo-row"/g)||[]).length,1);
   assert.equal((html.match(/data-photo-slot=/g)||[]).length,5);
   for(const role of roles)assert.ok(html.includes('data-photo-slot="'+ctx.CARD_IDS[i]+':'+role+'"'));
   assert.ok(html.indexOf(':palette"')>html.indexOf(':product"'));
   assert.ok(html.includes('配色%20カラーパレット'));
  }
  assert.equal(ctx.bound,1000);
 });
 test(file+' renders an existing embedded palette photograph with its original key and bytes',()=>{
  const ctx=contextFor(file),edit={data_url:data,sha256:hash,label:'保存済み配色',updated_at:'2020-01-01T00:00:00.000Z'};
  ctx.manualEdits['color-0001:palette']=edit;
  const before=JSON.stringify(ctx.manualEdits);ctx.renderBack(ctx.CARDS[0],0);
  assert.ok(ctx.back.innerHTML.includes('data-color-private-src="'+data+'"'));
  assert.ok(ctx.back.innerHTML.includes('保存済み配色'));
  assert.equal(JSON.stringify(ctx.manualEdits),before);
 });
 test(file+' retains a Drive palette reference through normalization and rendering',()=>{
  const ctx=contextFor(file);ctx.manualEdits=ctx.normalizeEdits({'color-0001:palette':{data_url:ref,sha256:hash}});
  ctx.renderBack(ctx.CARDS[0],0);
  assert.equal(ctx.manualEdits['color-0001:palette'].data_url,ref);
  assert.ok(ctx.back.innerHTML.includes('data-color-private-src="'+ref+'"'));
  assert.ok(ctx.back.innerHTML.includes('data-photo-file="color-0001:palette"'));
 });
 test(file+' does not resurrect a deliberately deleted palette picture or expose answers on the front',()=>{
  const ctx=contextFor(file);ctx.manualEdits={'color-0001:palette':{deleted:true,updated_at:'2020-01-01'}};
  ctx.PRIVATE_PHOTO_MAP['color-0001:palette']='assets/'+hash+'.png';
  ctx.renderBack(ctx.CARDS[0],0);
  assert.equal(ctx.slotPhoto(0,'palette'),null);assert.ok(!ctx.back.innerHTML.includes('data-color-private-src='));
  ctx.state.flipped=false;ctx.renderBack(ctx.CARDS[0],0);assert.equal(ctx.back.innerHTML,'');
 });
}
test('the real read-only adapter routes a received palette photo to the restored fifth slot without storage writes',async()=>{
 const ctx=contextFor('colors/app-view.js');let cfg;
 const api={setStatus(){},getBlob:async()=>new Blob([png],{type:'image/png'})};
 ctx.readyImages=Promise.resolve();ctx.render=function(){ctx.renderBack(ctx.CARDS[0],0);};ctx.validateStudyProgress=x=>x;
 ctx.document={getElementById:()=>null};
 ctx.fetch=async()=>({ok:true,json:async()=>({counts:{unique_images:940,registrations:1047,suppressed_duplicates:107},registrations:[],files:{}})});
 ctx.window.ColorNetworkSupport={...Network,note(){},onStatus(){},renderImages:async()=>{}};
 ctx.window.ColorOriginEditor={ready:Promise.resolve(),validateRecords:x=>x,previewRecords(){}};
 ctx.window.DriveReadOnly={install:c=>{cfg=c;return api;}};
 vm.runInContext(source('colors/readonly-adapter.js'),ctx);await cfg.ready;
 await cfg.apply({view:{data:{'photo:color-0001:palette':{data_url:ref,sha256:hash}},deleted:{}},imageFiles:[]});
 assert.ok(ctx.back.innerHTML.includes('data-photo-slot="color-0001:palette"'));
 assert.ok(ctx.back.innerHTML.includes('data-color-private-src="'+ref+'"'));
});
test('the real image resolver fetches the restored palette picture rather than drawing an empty placeholder',async()=>{
 const make=()=>({style:{},setAttribute(){},append(){},textContent:'',disabled:false});
 const img={dataset:{colorPrivateSrc:ref},isConnected:true,src:'',getAttribute(name){return name==='src'?this.src:null;}};
 let fetched,objectBlob;
 const root={};const document={querySelector:()=>make(),body:make(),createElement:make,querySelectorAll:selector=>selector.startsWith('img')?[img]:[]};root.document=document;
 const ctx={window:root,document,console,Map,Set,Promise,Blob,FileReader:function(){},URL:{createObjectURL:blob=>{objectBlob=blob;return 'blob:verified-palette';},revokeObjectURL(){}}};
 vm.createContext(ctx);vm.runInContext(source('colors/network-support.js'),ctx);
 await root.ColorNetworkSupport.renderImages({getBlob:async r=>{fetched=r;return new Blob([png],{type:'image/png'});}},{});
 assert.equal(fetched,ref);assert.equal(img.src,'blob:verified-palette');
 assert.deepEqual(Buffer.from(await objectBlob.arrayBuffer()),png);
});
test('all existing editor and viewer links load palette-versioned scripts',()=>{
 for(const file of ['colors/index.html','colors/color-sync-v2.html'])assert.ok(source(file).includes('review47-loader.js?v=palette1'));
 assert.ok(source('colors/drive-view.html').includes('review47-view-loader.js?v=palette1'));
 assert.ok(source('colors/data/review47-loader.js').includes('app-main.js?v=palette1'));
 assert.ok(source('colors/data/review47-view-loader.js').includes('app-view.js?v=palette1'));
 const sw=source('colors/service-worker.js');assert.ok(sw.includes('drive3-palette1'));assert.ok(sw.includes('app-main.js?v=palette1'));
});
test('research, photograph manifest, sync code, and the word and plant apps remain byte-identical',()=>{
 const report=JSON.parse(source('colors/palette-restoration.json'));
 assert.equal(report.private_photos_published,false);
 for(const [file,expected] of Object.entries(report.unchanged_protected_sha256))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),expected,file);
});
