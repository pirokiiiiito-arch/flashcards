'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');

const editor=fs.readFileSync('colors/drive-sync.js','utf8');
const core=fs.readFileSync('colors/drive-transfer-core.js','utf8');
const marker='  // Queue only user-edited photo slots.';
const start=editor.indexOf(marker),end=editor.indexOf('  const oldMark = mark;',start);
assert.ok(start>0&&end>start,'manual color photo registration manager must exist');
const manager=editor.slice(start,end);
const image='data:image/png;base64,aW1hZ2U=';
const sha='a'.repeat(64);
const drive='gdrive:valid-photo:'+sha;
const slot='color-0001:origin',key='photo:'+slot;
const photo=(src=image,updated_at='2026-10-31T10:00:00.000Z')=>
 ({data_url:src,sha256:sha,label:'手動写真',updated_at});

function rig({initial={},offline=false,connected=true,remoteFail=false,pending=[]}={}) {
  const manualEdits={...initial},timers=new Map(),events={},remoteData={};
  let nextTimer=0,clock=10000,saves=0,changed=0,syncs=0;
  const republished=[],errors=[];
  let pendingKeys=[...pending];
  const sync={
    applying:false,valid:()=>connected&&!offline,ready:Promise.resolve(),
    changed(){changed++;},pendingKeys:()=>pendingKeys,view:()=>({data:remoteData,deleted:{}}),
    status:()=>({pending:pendingKeys.length}),
    async republish(keys){if(remoteFail)throw Error('temporary_drive_error');republished.push(...keys);pendingKeys=[...new Set([...pendingKeys,...keys])];},
    async sync(){
      syncs++;
      if(remoteFail)throw Error('temporary_drive_error');
      for(const k of republished){
        const local=manualEdits[k.slice(6)];
        if(local&&!local.deleted){
          const result={...local,data_url:drive};
          remoteData[k]=result;manualEdits[k.slice(6)]=result;
        }
      }
      pendingKeys=[];
    }
  };
  const statusEl={style:{},hidden:true,textContent:'',setAttribute(){}};
  const toolbar={append(){}};
  const document={
    visibilityState:'visible',
    createElement:()=>statusEl,
    querySelector:()=>toolbar,
    addEventListener:(name,fn)=>{events[name]=fn;}
  };
  const window={
    __COLOR_RESTORE_IMPORT_ACTIVE:false,
    addEventListener:(name,fn)=>{events[name]=fn;}
  };
  const ctx={
    manualEdits, sync,readyImages:Promise.resolve(),document,window,
    persistEdits:async()=>{saves++;},cfg:{isEditing:()=>false},
    Map,Set,Promise,Object,String,JSON,Date:{now:()=>clock},navigator:{onLine:!offline},
    queueMicrotask:fn=>Promise.resolve().then(fn),
    setTimeout:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,delay});return id;},
    clearTimeout:id=>timers.delete(id),
    setInterval:()=>1
  };
  vm.createContext(ctx);vm.runInContext(manager,ctx);
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  const tick=async()=>{
    if(!timers.size)return false;
    const [id,{fn,delay}]=timers.entries().next().value;timers.delete(id);clock+=delay;
    await fn();await flush();return true;
  };
  return {
    ctx,manualEdits,sync,remoteData,events,flush,tick,timers,statusEl,republished,errors,
    get counts(){return {saves,changed,syncs,queued:ctx.ColorPhotoAutoStatus.pending(),timer:timers.size}},
    connect:()=>{connected=true;offline=false;ctx.navigator.onLine=true;events.online?.();},
    fail:value=>{remoteFail=value;}
  };
}
test('newly pasted manual origin picture is automatically uploaded and registered in the Drive journal',async()=>{
 const r=rig();await r.flush();
 r.manualEdits[slot]=photo();await r.ctx.persistEdits();
 assert.equal(r.counts.saves,1);assert.equal(r.counts.changed,1);
 assert.deepEqual(r.counts.queued,[key]);assert.equal(r.counts.timer,1);
 await r.tick();assert.deepEqual(r.republished,[key]);
 assert.equal(r.manualEdits[slot].data_url,drive);
 assert.equal(r.remoteData[key].data_url,drive);
 assert.deepEqual(r.counts.queued,[]);
});
test('origin-only and study-only saves never republish an unchanged photograph',async()=>{
 const r=rig({initial:{[slot]:photo(drive)}});await r.flush();
 await r.ctx.persistEdits();await r.flush();
 assert.deepEqual(r.republished,[]);assert.equal(r.counts.timer,0);assert.equal(r.counts.changed,1);
});
test('a remote color photo apply cannot turn a tombstone or received photo into a new local upload',async()=>{
 const r=rig();await r.flush();
 r.sync.applying=true;r.manualEdits[slot]=photo(drive);
 await r.ctx.persistEdits();r.sync.applying=false;
 assert.deepEqual(r.counts.queued,[]);assert.deepEqual(r.republished,[]);
});
test('explicitly deleted manual photos are not restored by the auto registration sender',async()=>{
 const r=rig();await r.flush();
 r.manualEdits[slot]=photo();await r.ctx.persistEdits();
 r.manualEdits[slot]={deleted:true,updated_at:'2026-10-31T11:00:00Z'};await r.ctx.persistEdits();
 assert.deepEqual(r.counts.queued,[]);assert.equal(r.counts.timer,0);
 assert.deepEqual(r.republished,[]);
});
test('failed photo transport remains queued, retries and retains original PC data',async()=>{
 const r=rig({remoteFail:true});await r.flush();
 r.manualEdits[slot]=photo();await r.ctx.persistEdits();await r.tick();
 assert.equal(r.manualEdits[slot].data_url,image);
 assert.deepEqual(r.counts.queued,[key]);assert.equal(r.counts.timer,1);
 assert.match(r.statusEl.textContent,/temporary_drive_error/);
 r.fail(false);await r.tick();
 assert.equal(r.manualEdits[slot].data_url,drive);assert.deepEqual(r.counts.queued,[]);
});
test('offline edits survive until connection returns without requiring manual retry',async()=>{
 const r=rig({offline:true,connected:false});await r.flush();
 r.manualEdits[slot]=photo();await r.ctx.persistEdits();await r.tick();
 assert.equal(r.manualEdits[slot].data_url,image);assert.deepEqual(r.republished,[]);
 r.connect();await r.tick();
 assert.equal(r.manualEdits[slot].data_url,drive);assert.deepEqual(r.counts.queued,[]);
});
test('durable pending photo registration resumes on reload without user resaving',async()=>{
 const r=rig({initial:{[slot]:photo()},pending:[key]});await r.flush();
 assert.deepEqual(r.counts.queued,[key]);await r.tick();
 assert.equal(r.remoteData[key].data_url,drive);assert.deepEqual(r.counts.queued,[]);
});
test('a newer replacement or a deletion is never acknowledged by an older in-flight send',async()=>{
 const r=rig();await r.flush();
 r.manualEdits[slot]=photo();await r.ctx.persistEdits();
 r.sync.republish=async(keys)=>{
   r.republished.push(...keys);
   r.manualEdits[slot]=photo('data:image/png;base64,bmV3','2026-10-31T11:00:00.000Z');
   await r.ctx.persistEdits();
 };
 await r.tick();assert.equal(r.manualEdits[slot].data_url,'data:image/png;base64,bmV3');
 assert.deepEqual(r.counts.queued,[key]);
});
test('specialized color queue isolates unsent bytes and uses actual remote heads',()=>{
 assert.ok(core.includes('colorPhotoDeferred'));
 assert.ok(!core.includes('plantPhotoDeferred'));
 assert.ok(core.includes('async function republish(keys)'));
 assert.ok(core.includes('await pull();'));
 assert.ok(core.includes('const current = await cfg.read(), currentHeads = heads(state.events);'));
 assert.ok(core.includes('pendingKeys: () =>'));
 assert.ok(editor.includes("sync?.pendingValues?.('photo:')"));
 assert.ok(editor.includes('if (!local || local.deleted || !pending || pending.deleted) continue;'));
});
test('color sender keeps the original 940-photo catalogue, all four manual slots, origins and study records unmodified',()=>{
 const report=JSON.parse(fs.readFileSync('colors/color-auto-photo-build.json','utf8'));
 assert.equal(report.source_photos_changed,false);
 assert.equal(report.origin_texts_changed,false);
 assert.equal(report.user_data_changed,false);
 for(const [path,hash] of Object.entries(report.protected_sha256)){
   assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex'),hash,path);
 }
 const loader=fs.readFileSync('colors/data/review47-loader.js','utf8');
 const worker=fs.readFileSync('colors/service-worker.js','utf8');
 assert.ok(loader.includes('./drive-transfer-core.js?v=autophoto1'));
 assert.ok(loader.includes('./drive-sync.js?v=autophoto1'));
 assert.ok(worker.includes('./drive-transfer-core.js?v=autophoto1'));
 for(const role of ['origin','interior','fashion','product'])
   assert.ok(['origin','interior','fashion','product'].includes(role));
});
test('photo cloud copy verifies private bytes before publishing immutable gdrive ref',async()=>{
 const begin=editor.indexOf('  async function toCloudValue('),finish=editor.indexOf('  const cfg =',begin);
 assert.ok(begin>0&&finish>begin);
 const source=editor.slice(begin,finish);
 const blob=new Blob([Buffer.from('synthetic picture')],{type:'image/png'});
 const ctx={fetch:async()=>({ok:true,type:'basic',blob:async()=>blob}),Error,Blob};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 const api={digest:async()=>sha,putBlob:async()=>drive,getBlob:async(ref,opts)=>{assert.equal(ref,drive);assert.equal(opts.fresh,true);return blob;}};
 const out=await ctx.toCloudValue(key,photo(),api);
 assert.equal(out.data_url,drive);assert.equal(out.sha256,sha);
 const failed={fetch:async()=>{throw Error('cors denied')},Error,Blob};
 vm.createContext(failed);vm.runInContext(source,failed);
 await assert.rejects(()=>failed.toCloudValue(key,photo(),api),e=>e.colorPhotoDeferred===true);
});
