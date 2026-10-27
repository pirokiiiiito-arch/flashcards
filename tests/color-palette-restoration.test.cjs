'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const Network=require('../colors/network-support.js');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCFkAAAAASUVORK5CYII=','base64');
const hash=crypto.createHash('sha256').update(png).digest('hex'),ref='gdrive:synthetic_palette_image:'+hash,data='data:image/png;base64,'+png.toString('base64');
const roles=['origin','interior','fashion','product','palette'],source=file=>fs.readFileSync(file,'utf8');
function functionLine(src,name){const lines=src.split('\n').filter(line=>line.startsWith('function '+name+'('));assert.equal(lines.length,1,name);return lines[0];}
function contextFor(file){
 const src=source(file),elements={},el=id=>elements[id]||(elements[id]={className:'',innerHTML:'',classList:{toggle(){}},querySelectorAll(){return [];}});
 const CARDS=Array.from({length:1000},(_,i)=>({name:'色'+(i+1),hex:'#334455',origin:'jp'})),CARD_IDS=CARDS.map((_,i)=>'color-'+String(i+1).padStart(4,'0'));
 const ctx={console,URL,structuredClone,CARDS,CARD_IDS,manualEdits:{},progress:{},PRIVATE_PHOTO_MAP:{},ORIGIN_PHOTO_RENDER_CACHE:{},USAGE_PHOTO_ATTRIBUTIONS:{},
 VALID_SLOT_KEYS:new Set(CARD_IDS.flatMap(id=>roles.map(role=>id+':'+role))),ROLE_LABELS:{origin:'由来・名前のイメージ',interior:'インテリア',fashion:'ファッション',product:'プロダクト',palette:'配色'},
 state:{flipped:true},$:el,research:()=>({}),effectiveColor:c=>({...c,rgb:[51,68,85]}),displayColorReferenceMarkup:()=>'',
 safeLink:v=>{try{const u=new URL(v);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}},escapeHtml:x=>String(x??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),
 own:(o,k)=>Object.prototype.hasOwnProperty.call(o,k),bindPhotoActions(){ctx.bound++;},bound:0,externalLink:(u,l)=>'<a href="'+u+'">'+l+'</a>',window:{ColorNetworkSupport:Network}};
 vm.createContext(ctx);for(const name of ['safeImage','sourcePhoto','slotPhoto','photoCredit','searchTerms','photoSlot','renderBack','normalizeEdits'])vm.runInContext(functionLine(src,name),ctx);ctx.back=el('back');return ctx;
}
for(const file of ['colors/app-main.js','colors/app-view.js']){
 test(file+' renders five roles for all 1000 colors with the original Japanese search terms',()=>{
  const c=contextFor(file);for(let i=0;i<1000;i++){c.renderBack(c.CARDS[i],i);const h=c.back.innerHTML;
   assert.equal((h.match(/class="palette-photo-row"/g)||[]).length,1);assert.equal((h.match(/data-photo-slot=/g)||[]).length,5);
   for(const r of roles)assert.ok(h.includes('data-photo-slot="'+c.CARD_IDS[i]+':'+r+'"'));
   assert.ok(h.indexOf(':palette"')>h.indexOf(':product"'));assert.ok(h.includes(encodeURIComponent('配色 カラーパレット')));
  }assert.equal(c.bound,1000);
 });
 test(file+' restores an embedded palette photograph without changing its saved bytes or key',()=>{
  const c=contextFor(file);c.manualEdits['color-0001:palette']={data_url:data,sha256:hash,label:'保存済み配色',updated_at:'2020-01-01'};
  const before=JSON.stringify(c.manualEdits);c.renderBack(c.CARDS[0],0);assert.ok(c.back.innerHTML.includes('data-color-private-src="'+data+'"'));assert.ok(c.back.innerHTML.includes('保存済み配色'));assert.equal(JSON.stringify(c.manualEdits),before);
 });
 test(file+' retains a Drive palette reference through normalization and rendering',()=>{
  const c=contextFor(file);c.manualEdits=c.normalizeEdits({'color-0001:palette':{data_url:ref,sha256:hash}});c.renderBack(c.CARDS[0],0);
  assert.equal(c.manualEdits['color-0001:palette'].data_url,ref);assert.ok(c.back.innerHTML.includes('data-color-private-src="'+ref+'"'));assert.ok(c.back.innerHTML.includes('data-photo-file="color-0001:palette"'));
 });
 test(file+' preserves deliberate deletion and keeps the front answer-free',()=>{
  const c=contextFor(file);c.manualEdits={'color-0001:palette':{deleted:true,updated_at:'2020-01-01'}};c.PRIVATE_PHOTO_MAP['color-0001:palette']='assets/'+hash+'.png';c.renderBack(c.CARDS[0],0);
  assert.equal(c.slotPhoto(0,'palette'),null);assert.ok(!c.back.innerHTML.includes('data-color-private-src='));c.state.flipped=false;c.renderBack(c.CARDS[0],0);assert.equal(c.back.innerHTML,'');
 });
}
test('actual read-only adapter maps received palette metadata to the restored slot without storage writes',async()=>{
 const c=contextFor('colors/app-view.js');let cfg;const api={setStatus(){},getBlob:async()=>new Blob([png],{type:'image/png'})};
 c.readyImages=Promise.resolve();c.render=()=>c.renderBack(c.CARDS[0],0);c.validateStudyProgress=x=>x;c.document={getElementById:()=>null};
 c.fetch=async()=>({ok:true,json:async()=>({counts:{unique_images:940,registrations:1047,suppressed_duplicates:107},registrations:[],files:{}})});
 c.window.ColorNetworkSupport={...Network,note(){},onStatus(){},renderImages:async()=>{}};c.window.ColorOriginEditor={ready:Promise.resolve(),validateRecords:x=>x,previewRecords(){}};c.window.DriveReadOnly={install:v=>{cfg=v;return api;}};
 vm.runInContext(source('colors/readonly-adapter.js'),c);await cfg.ready;await cfg.apply({view:{data:{'photo:color-0001:palette':{data_url:ref,sha256:hash}},deleted:{}},imageFiles:[]});
 assert.ok(c.back.innerHTML.includes('data-photo-slot="color-0001:palette"'));assert.ok(c.back.innerHTML.includes('data-color-private-src="'+ref+'"'));
});
test('actual image resolver obtains picture bytes for the restored palette image',async()=>{
 const make=()=>({style:{},setAttribute(){},append(){},textContent:'',disabled:false});const img={dataset:{colorPrivateSrc:ref},isConnected:true,src:'',getAttribute(n){return n==='src'?this.src:null;}};let fetched,objectBlob;
 const root={},document={querySelector:()=>make(),body:make(),createElement:make,querySelectorAll:s=>s.startsWith('img')?[img]:[]};root.document=document;
 const c={window:root,document,console,Map,Set,Promise,Blob,FileReader:function(){},URL:{createObjectURL:b=>{objectBlob=b;return 'blob:verified-palette';},revokeObjectURL(){}}};
 vm.createContext(c);vm.runInContext(source('colors/network-support.js'),c);await root.ColorNetworkSupport.renderImages({getBlob:async r=>{fetched=r;return new Blob([png],{type:'image/png'});}},{});
 assert.equal(fetched,ref);assert.equal(img.src,'blob:verified-palette');assert.deepEqual(Buffer.from(await objectBlob.arrayBuffer()),png);
});
test('all existing color links load freshly versioned scripts',()=>{
 for(const file of ['colors/index.html','colors/color-sync-v2.html'])assert.ok(source(file).includes('review47-loader.js?v=palette1'));
 assert.ok(source('colors/drive-view.html').includes('review47-view-loader.js?v=palette1'));assert.ok(source('colors/data/review47-loader.js').includes('app-main.js?v=palette1'));assert.ok(source('colors/data/review47-view-loader.js').includes('app-view.js?v=palette1'));assert.ok(source('colors/service-worker.js').includes('drive3-palette1'));
});
test('research, photograph manifest, sync code, word app and plant app stay byte-identical',()=>{
 const report=JSON.parse(source('colors/palette-restoration.json'));assert.equal(report.private_photos_published,false);
 for(const [file,expected] of Object.entries(report.unchanged_protected_sha256))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),expected,file);
});
