/* Editor -> Drive journal -> fresh phone viewer; all external replies synthetic. */
'use strict';
const fs=require('node:fs'),Module=require('node:module'),path=require('node:path');
let s=fs.readFileSync('tests/browser-word-quiet-sync.cjs','utf8');
const bootstrap=String.raw`let remoteSnapshot=null;
function bootstrap(){return \`(()=>{
 const card={id:'seed-one',name:'写真移行確認用植物',description:'保存した説明',group:'angiosperm',images:['idb:missing-one','','']};
 const events=[{id:'old-card',key:'card:seed-one',value:{id:card.id,name:card.name,description:card.description,group:card.group},parents:[],clock:1,deleted:false},{id:'old-marker',key:'migration:supabase-images:user-one',value:{images:0},parents:[],clock:2,deleted:false}];
 const encode=t=>Array.from(new TextEncoder().encode(t));
 const jpeg=Uint8Array.from(atob('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAEAAQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDyuiiivSOA/9k='),c=>c.charCodeAt(0));
 const files=REMOTE_FILES||{'initial-journal':{meta:{appProperties:{namespace:'plant-flashcards',kind:'journal'}},data:encode(JSON.stringify({schema:'flashcards-drive-journal-v3',namespace:'plant-flashcards',events})),type:'application/json'}};
 window.__fixture={files,sourceReads:0};
 if(location.pathname.endsWith('/index.html')){
  localStorage.setItem('plant_flashcards_v1',JSON.stringify([card]));
  for(const key of ['plant_flashcards_seed_loaded_v1','plant_angiosperm_greenlist_v2','plant_nonangio_expand_v1','plant_drive_primary_v1'])localStorage.setItem(key,'1');
  localStorage.setItem('flashcards_supabase_session_v1',JSON.stringify({access_token:'old-user-synthetic-token',expires_at:Date.now()+3600000,user:{id:'user-one',email:'owner@example.invalid'}}));
 }
 const native=fetch.bind(window),json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json'}});
 window.fetch=async(input,options={})=>{
  const u=new URL(typeof input==='string'?input:input.url,document.baseURI);
  if(u.origin==='https://himtyybslzzwsfmgdivx.supabase.co'){
   if(u.pathname==='/auth/v1/user')return json({id:'user-one',email:'owner@example.invalid'});
   if(u.pathname==='/storage/v1/object/list/plant-images')return json(JSON.parse(options.body).prefix==='user-one'?[{name:'seed-one',id:null}]:[0,1,2].map(i=>({name:i+'.jpg',id:'old-'+i,updated_at:'2026-01-01T00:00:00Z'})));
   if(u.pathname.startsWith('/storage/v1/object/authenticated/plant-images/user-one/seed-one/')){__fixture.sourceReads++;return new Response(jpeg,{headers:{'Content-Type':'image/jpeg'}});}
   throw Error('Unexpected legacy source request');
  }
  if(u.origin!=='https://www.googleapis.com')return native(input,options);
  if(window.__offline)throw TypeError('Synthetic offline');
  if(u.pathname.endsWith('/about'))return json({user:{permissionId:'google-one',emailAddress:'owner@example.invalid'}});
  if(u.pathname==='/upload/drive/v3/files'){
   const bytes=new Uint8Array(await options.body.arrayBuffer()),boundary=new Headers(options.headers).get('Content-Type').split('boundary=')[1];
   const find=(text,start=0)=>{const needle=new TextEncoder().encode(text);outer:for(let i=start;i<=bytes.length-needle.length;i++){for(let j=0;j<needle.length;j++)if(bytes[i+j]!==needle[j])continue outer;return i;}throw Error('Multipart fixture mismatch');};
   const sep='\\r\\n--'+boundary,a=find('\\r\\n\\r\\n')+4,b=find(sep,a),meta=JSON.parse(new TextDecoder().decode(bytes.slice(a,b))),c=find('\\r\\n\\r\\n',b+sep.length)+4,d=find(sep,c),id='uploaded-'+Object.keys(files).length;
   files[id]={meta,data:Array.from(bytes.slice(c,d)),type:meta.mimeType};return json({id,md5Checksum:id});
  }
  if(u.pathname==='/drive/v3/files'){
   const q=u.searchParams.get('q')||'',kind=q.includes("value='journal'")?'journal':q.includes("value='image'")?'image':'';
   return json({files:Object.entries(files).filter(([id,f])=>f.meta.appProperties.kind===kind).map(([id,f])=>({id,md5Checksum:id,appProperties:f.meta.appProperties,mimeType:f.type}))});
  }
  const file=files[u.pathname.split('/').pop()];if(file)return new Response(Uint8Array.from(file.data),{headers:{'Content-Type':file.type}});
  throw Error('Unexpected Google request');
 };
 window.google={accounts:{oauth2:{hasGrantedAllScopes:()=>true,initTokenClient:c=>({requestAccessToken:()=>c.callback({access_token:'synthetic-google-access-token',expires_in:3600})})}}};
})();\`.replace('REMOTE_FILES',JSON.stringify(remoteSnapshot));}
`;
const actual=bootstrap.replaceAll('\\`','`');
const start=s.indexOf('function bootstrap()'),end=s.indexOf('async function scenario',start);s=s.slice(0,start)+actual+s.slice(end);
const begin=s.indexOf("  await send('Page.navigate'"),finish=s.indexOf(' }catch(e){if(evaluate)',begin);
if(begin<0||finish<0)throw Error('Browser harness changed');
s=s.slice(0,begin)+String.raw`
  const editor=width>600;
  await send('Page.navigate',{url:origin+'/flashcards/plants/'+(editor?'index.html':'photo-view.html')});
  await until(()=>evaluate('!!window.PlantDriveSync&&!!document.querySelector("#plantsAuthRequired")'),'plant startup');
  await evaluate('document.querySelector("#plantsAuthRequired button").click()');
  const selector=editor?'dialog [data-connect]':'#plantsAuthDialog button';
  await until(()=>evaluate('!document.querySelector('+JSON.stringify(selector)+').disabled'),'connection ready');
  await evaluate('document.querySelector('+JSON.stringify(selector)+').click()');
  await until(()=>evaluate('Object.keys(PlantDriveSync.view().data).filter(k=>k.startsWith("image:")).length===3'),'three photo references received');
  if(editor){
   await until(()=>evaluate('PlantDriveSync.status().status==="同期済み"'),'editor sync completion');
   assert.equal(await evaluate('getImages(cards[0]).every(v=>v.startsWith("gdrive:"))'),true);
   assert.equal(await evaluate('PlantLegacyPhotoStatus().source'),3);
   assert.equal(await evaluate('cards[0].name'),'写真移行確認用植物');
   remoteSnapshot=await evaluate('__fixture.files');
   console.log('PASS source transfer: existing user session, stale zero marker, missing local bytes -> three verified Drive image assignments');
  }else{
   await evaluate('render(true)');
   await until(()=>evaluate('document.querySelectorAll(".image-box img").length===3&&[...document.querySelectorAll(".image-box img")].every(i=>i.naturalWidth>0)'),'three real images in fresh mobile viewer');
   assert.equal(await evaluate('document.querySelector(".front-name").textContent'),'写真移行確認用植物');
   await evaluate('window.__offline=true;PlantDriveSync.disconnect();render(true)');
   await until(()=>evaluate('[...document.querySelectorAll(".image-box img")].length===3&&[...document.querySelectorAll(".image-box img")].every(i=>i.naturalWidth>0)'),'cached images survive disconnect');
   console.log('PASS fresh smartphone-sized viewer: editor-created journals render three photographs, retained after disconnect');
  }
  assert.deepEqual(errors,[],'no runtime errors');
`+s.slice(finish);
s=s.replace("'.html':'text/html; charset=utf-8'","'.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8'");
const m=new Module(path.resolve('tests/.plant-source-browser.cjs'),module);m.filename=path.resolve('tests/.plant-source-browser.cjs');m.paths=module.paths;m._compile(s,m.filename);
