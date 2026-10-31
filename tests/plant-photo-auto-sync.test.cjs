'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('plants/drive-sync.js','utf8');
const begin=source.indexOf('  function currentPhotoValues() {');
const end=source.indexOf('  const oldResolve = resolveImageValue;',begin);
assert.ok(begin>=0&&end>begin,'registration watcher must be installed');
const code=source.slice(begin,end);
const ref='gdrive:image-file:'+('a'.repeat(64));
const original='idb:plantimg:plant:0:photo-a';
function rig({initial='',valid=true,connected=true,durable=[],success=true,online=true}={}){
 let clock=10000,saved=0,changed=0,synced=0,runs=[],nextId=1;
 const timers=new Map(),events={};
 const card={id:'plant',images:[initial,'','']},cards=[card];
 let durableKeys=[...durable];
 const sync={
   applying:false, valid:()=>valid, changed:()=>{changed++},
   sync:async()=>{synced++}, pendingKeys:()=>durableKeys, status:()=>({pending:durableKeys.length})};
 const copier={busy:false};
 const window={
   PersistentDriveAuth:{state:()=>({phase:connected?'connected':'app_login_required'})},
   addEventListener:(name,fn)=>{events[name]=fn;}};
 const document={visibilityState:'visible',addEventListener:(name,fn)=>{events[name]=fn;}};
 const navigator={onLine:online};
 const ctx={cards,getImages:c=>c.images,imageKey:(c,i)=>'image:'+c.id+':'+i,originalSave:()=>{saved++},
   sync,copier,window,document,navigator,Map,Set,Promise,ready:Promise.resolve(),orderSource:{capture:()=>{}},P:{isDrive:value=>/^gdrive:[\w-]+:[a-f0-9]{64}$/.test(String(value||''))},
   Date:{now:()=>clock},recoveryBusy:false,editing:false,
   automaticPhotoRegistrations:new Map(),savedPhotoValues:new Map(),
   automaticPhotoTimer:null,automaticPhotoRunning:false,automaticPhotoNextAttempt:0,automaticPhotoDelay:30000,
   retryPlantPhotos:async(origin,keys)=>{
      runs.push({origin,keys:[...keys]});
      if(!success)return false;
      if(cards[0].images[0]===original)cards[0].images[0]=ref;
      durableKeys=[];
      return true;
   },
   setTimeout:(fn,ms)=>{const id=nextId++;timers.set(id,{fn,ms});return id;},
   clearTimeout:(id)=>{timers.delete(id);},
   queueMicrotask:fn=>Promise.resolve().then(fn)
 };
 vm.createContext(ctx);
 vm.runInContext(code,ctx);
 const flush=()=>new Promise(done=>setImmediate(done));
 const tick=async()=>{
   if(!timers.size)return false;
   const [id,task]=timers.entries().next().value;
   timers.delete(id);clock+=task.ms;
   await task.fn();await flush();return true;
 };
 return {ctx,card,sync,navigator,window,document,events,timers,flush,tick,
   setValid:v=>{valid=v},setConnected:v=>{connected=v},setSuccess:v=>{success=v},
   get state(){return {saved,changed,synced,runs,queued:[...ctx.automaticPhotoRegistrations],timers:timers.size}}};
}
test('saving one newly registered device photo schedules automatic Drive registration',async()=>{
 const r=rig();await r.flush();
 r.card.images[0]=original;
 r.ctx.saveCards();
 assert.equal(r.state.saved,1);
 assert.equal(r.state.changed,1);
 assert.equal(r.state.queued.length,1);
 assert.ok(r.state.timers>=1);
 await r.tick();
 assert.deepEqual(r.state.runs[0].keys,[['image:plant:0',original]]);
 assert.equal(r.card.images[0],ref);
 assert.equal(r.state.queued.length,0);
});
test('a description-only save does not republish an existing image',async()=>{
 const r=rig({initial:ref});await r.flush();
 r.ctx.saveCards();await r.flush();
 assert.equal(r.state.runs.length,0);
 assert.equal(r.state.queued.length,0);
 assert.equal(r.state.saved,1);
});
test('remote apply must never promote a tombstoned or remote photo to a new local registration',async()=>{
 const r=rig();await r.flush();
 r.sync.applying=true;r.card.images[0]=ref;
 r.ctx.saveCards();r.sync.applying=false;await r.flush();
 assert.equal(r.state.queued.length,0);
 assert.equal(r.state.runs.length,0);
});
test('deleting a photo before the automatic upload cancels the pending retry',async()=>{
 const r=rig();await r.flush();
 r.card.images[0]=original;r.ctx.saveCards();
 r.card.images[0]='';r.ctx.saveCards();
 assert.equal(r.state.queued.length,0);
 assert.equal(r.state.timers,0);
 assert.equal(r.state.runs.length,0);
});
test('a failed copy stays queued and retries later without clearing the original',async()=>{
 const r=rig({success:false});await r.flush();
 r.card.images[0]=original;r.ctx.saveCards();
 await r.tick();
 assert.equal(r.card.images[0],original);
 assert.equal(r.state.queued.length,1);
 assert.equal(r.state.runs.length,1);
 assert.equal(r.state.timers,1);
 r.setSuccess(true);await r.tick();
 assert.equal(r.card.images[0],ref);
 assert.equal(r.state.queued.length,0);
});
test('offline save and authentication expiry retain the photo until a reconnect',async()=>{
 const r=rig({online:false,valid:false,connected:false});await r.flush();
 r.card.images[0]=original;r.ctx.saveCards();
 await r.tick();assert.equal(r.state.runs.length,0);
 assert.equal(r.card.images[0],original);
 r.navigator.onLine=true;r.setValid(true);r.setConnected(true);r.events.online();
 await r.tick();
 assert.equal(r.card.images[0],ref);
 assert.equal(r.state.queued.length,0);
});
test('durable unsent image keys resume without another edit after page restart',async()=>{
 const r=rig({initial:original,durable:['image:plant:0']});
 await r.flush();
 assert.equal(r.state.queued.length,1);
 await r.tick();
 assert.equal(r.card.images[0],ref);
 assert.equal(r.state.queued.length,0);
});
test('a newer user photo replacing an in-flight registration remains pending',async()=>{
 const r=rig();await r.flush();
 r.card.images[0]=original;r.ctx.saveCards();
 r.ctx.retryPlantPhotos=async(_origin,_keys)=>{
   r.card.images[0]='idb:plantimg:plant:0:photo-b';
   r.ctx.saveCards();
   return true;
 };
 await r.tick();
 assert.equal(r.card.images[0],'idb:plantimg:plant:0:photo-b');
 assert.deepEqual(r.state.queued,[['image:plant:0','idb:plantimg:plant:0:photo-b']]);
});
