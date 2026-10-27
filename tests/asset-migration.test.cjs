const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const {driveServer,replica}=require('./mock-runtime.cjs');
const M=require('../colors/asset-migration.js');
function fixture(){
  const originals=[Buffer.from([137,80,78,71,0,1]),Buffer.from([137,80,78,71,2,3])],files={},registrations=[];
  originals.forEach((b,i)=>{const sha256=crypto.createHash('sha256').update(b).digest('hex'),p='assets/'+sha256+'.png';files[p]={sha256,bytes:b.length,mime_type:'image/png',width:1,height:1,exif_orientation:1};registrations.push({photo_id:'color-000'+(i+1)+':origin',registration_id:'color-000'+(i+1)+':origin',color_id:'color-000'+(i+1),role:'origin',original_asset_path:p,sha256,size:b.length,suppressed_duplicate:false});});
  registrations.push({...registrations[0],photo_id:'color-0003:product',registration_id:'color-0003:product',color_id:'color-0003',role:'product',suppressed_duplicate:true});
  const catalogue={schema:'colors1000-private-assets-v2',counts:{fixed_cards:1000,unique_images:2,registrations:3,suppressed_duplicates:1},files,registrations};
  const provided=Object.keys(files).map((p,i)=>new File([originals[i]],p.split('/').pop(),{type:'image/png'}));
  return{catalogue,provided};
}
async function setup(server=driveServer(),apiTransform=x=>x){
  const f=fixture(),r=replica(server,{}, {namespace:'migration-fixture'});await r.connect();let refs={};
  const api=apiTransform(r.api),session=M.session({api,catalogue:f.catalogue,getRefs:()=>refs,setRef:async(p,v)=>{refs[p]=v;r.local=Object.fromEntries(Object.entries(refs).map(([p,v])=>['asset:'+p,v]));},flush:()=>r.api.sync()});
  return{...f,r,api,session,server,getRefs:()=>refs};
}
const imageFiles=s=>[...s.files.values()].filter(f=>f.appProperties.kind==='image');
test('migration deduplicates registrations and verifies downloaded bytes, not upload cache',async()=>{
  const f=await setup();const before=f.server.requests.length;const result=await f.session.run(f.provided);
  assert.equal(result.complete,true);assert.equal(result.counts.uploaded,2);assert.equal(result.counts.verified,2);assert.equal(result.registrations_verified,3);assert.equal(result.suppressed_duplicates,1);assert.equal(imageFiles(f.server).length,2);
  const gets=f.server.requests.slice(before).filter(r=>r.method==='GET'&&r.url.endsWith('?alt=media')&&imageFiles(f.server).some(x=>r.url.includes('/'+x.id+'?')));assert.equal(gets.length,2);
  const resolved=M.manifest(f.catalogue,f.getRefs(),f.api.view());assert.equal(resolved.registrations[0].drive_file_id,resolved.registrations[2].drive_file_id);
});
test('a second device with empty image cache resolves every image from Drive without source files',async()=>{
  const a=await setup();await a.session.run(a.provided);const b=await setup(a.server);b.r.db.dbs.get('flashcards_drive_cache_v3').get('blobs').clear();
  const result=await b.session.run([],true);assert.equal(result.complete,true);assert.equal(result.counts.skipped_existing,2);assert.equal(result.counts.uploaded,0);assert.equal(imageFiles(b.server).length,2);
});
test('resume reuses already uploaded hashes after a verification failure',async()=>{
  let fail=true,target;
  const f=await setup(undefined,api=>({...api,getBlob:async(ref,opts)=>{assert.equal(opts.fresh,true);if(fail&&ref.endsWith(target))throw new Error('simulated interrupted verification');return api.getBlob(ref,opts);}}));
  target=Object.values(f.catalogue.files)[1].sha256;
  const partial=await f.session.run(f.provided);assert.equal(partial.complete,false);assert.equal(partial.counts.failed,1);assert.equal(imageFiles(f.server).length,2);
  fail=false;const completed=await f.session.run(f.provided);assert.equal(completed.complete,true);assert.equal(completed.counts.uploaded,0);assert.equal(completed.counts.skipped_existing,2);assert.equal(imageFiles(f.server).length,2);
});
test('incorrect source bytes stop preflight before uploading any original image',async()=>{
  const f=await setup();const wrong=[new File(['bad'],f.provided[0].name,{type:'image/png'}),f.provided[1]];
  await assert.rejects(f.session.run(wrong),/元の940写真/);assert.equal(imageFiles(f.server).length,0);assert.equal(f.session.status().complete,false);
});
test('corrupted remote bytes fail even when a correct copy exists in IndexedDB',async()=>{
  const f=await setup();await f.session.run(f.provided);imageFiles(f.server)[0].content=Buffer.from('corrupt');
  const result=await f.session.run([],true);assert.equal(result.complete,false);assert.equal(result.counts.failed,1);assert.equal(result.counts.verified,1);
});
test('manual image replacement metadata, deletion masks and restore tombstones remain in private manifest',()=>{
  const f=fixture(),sha=Object.values(f.catalogue.files)[0].sha256,view={data:{'photo:color-0001:palette':{data_url:'gdrive:file9:'+sha,sha256:sha,mime_type:'image/png',size:6},'photo:color-0002:origin':{deleted:true}},deleted:{'photo:color-0003:product':{id:'deleted-revision',updated_at:'2026-10-27T00:00:00Z'}},conflicts:[]};
  const m=M.manifest(f.catalogue,{},view);assert.equal(m.manual[0].drive_file_id,'file9');assert.equal(m.manual[1].deleted,true);assert.equal(m.tombstones[0].restored_original,true);
});
test('unchanged private manifest is not uploaded repeatedly',async()=>{
  const f=await setup();const a=await M.publish(f.catalogue,{},f.api.view(),f.api),count=f.server.files.size,b=await M.publish(f.catalogue,{},f.api.view(),f.api);assert.equal(a.file_id,b.file_id);assert.equal(f.server.files.size,count);
});
test('real catalogue preserves 940 hashes, all 1047 registrations and 107 suppression flags',()=>{
  const catalogue=JSON.parse(fs.readFileSync('colors/private-assets-manifest.json'));assert.equal(M.validate(catalogue),true);assert.equal(Object.keys(catalogue.files).length,940);assert.equal(catalogue.registrations.length,1047);assert.equal(catalogue.registrations.filter(r=>r.suppressed_duplicate).length,107);
  for(const r of catalogue.registrations){const f=catalogue.files[r.original_asset_path];assert.equal(r.sha256,f.sha256);assert.ok(f.width>0&&f.height>0);}
});
