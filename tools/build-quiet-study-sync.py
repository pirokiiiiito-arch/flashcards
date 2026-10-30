"""Run LAST after build-quiet-word-sync.py. Change rendering and scheduling only.
No change to authentication, event keys, private image bytes, datasets, storage
keys, existing PC order records, or the working word application.
"""
from pathlib import Path
import re,json,hashlib
R=Path(__file__).resolve().parents[1]
def read(p):return (R/p).read_text(encoding='utf-8')
def write(p,s):(R/p).write_text(s,encoding='utf-8')
def one(s,a,b):
    if s.count(a)!=1:raise RuntimeError('Quiet study anchor changed: '+a[:100])
    return s.replace(a,b,1)
def section(s,a,b,replacement):
    if s.count(a)!=1 or s.count(b)!=1:raise RuntimeError('Quiet section changed: '+a)
    i=s.index(a);j=s.index(b,i);return s[:i]+replacement+s[j:]
def sha(p):return hashlib.sha256((R/p).read_bytes()).hexdigest()
protected=['index.html','word-sync-v2.html','drive-core.js','drive-sync.js','word-quiet-sync.js','word-recovery.js','word-network-recovery.js','service-worker.js','drive-readonly.js','drive-local-base.js','drive-local-view.js','drive-view-cache.js','drive-legacy-view.js','plants/normal-order.js','plants/pc-order-source.js','plants/source-order.js','colors/app-main.js','colors/app-view.js','colors/data/review47-progress.b64','colors/private-assets-manifest.json']+[str(p.relative_to(R)) for p in (R/'plants').glob('data*.json')]
before={p:sha(p) for p in protected}
Q='window.StudyQuietSync'
p=read('plants/drive-sync.js')
p=section(p,'    apply: prepared => {','    // Older journals',"""    apply: prepared => {
      const list=prepared.list;orderSource.accept(prepared.record);
      const q=window.StudyQuietSync,plan=q.plantPlan(cards,list,{group:currentGroup,order,pos,shuffled:isShuffled});
      if(!plan)return;
      const snapshot=q.capture(stage),previous=cards;cards=list;
      try{saveCards();}catch(e){cards=previous;throw e;}
      updateCounts();
      if(currentGroup){
        order=plan.order;pos=plan.pos;isShuffled=plan.shuffled;
        if(plan.redraw)render(snapshot.back);else{updateDeckHeader();updateMode();const n=stage.querySelector('.card-number');if(n)n.textContent=(pos+1)+' / '+order.length;}
      }
      q.restore(stage,snapshot,plan.redraw&&plan.sameCard);
    },
""")
p=one(p,"      if (currentGroup && !editing) { const back = !!stage.querySelector('.show-back'); render(back); }",'      // Conversion retains the displayed bytes; do not rebuild an unchanged card after every sync.')
p=one(p,'    onStatus: (s, message) => {',"    onStatus: (s, message) => {\n      window.StudyQuietSync.status('plants',s,message);")
p=one(p,'  imageSyncStatus.onclick = () => sync.open();',"""  imageSyncStatus.onclick = () => sync.open();
  window.StudyQuietSync.attach(sync,{app:'plants',toolbar:'.toolbar',editing:()=>cfg.isEditing(),warning:()=>{const s=copier.summary();return s.pending||s.failed?'写真コピー未完了：詳細を確認':'';}});
""")
write('plants/drive-sync.js',p)
for path in ['plants/readonly-adapter.js','plants/local-adapter.js']:
    p=read(path)
    p=one(p,"const statusEl=document.createElement('p');", "const statusEl=document.createElement('p');statusEl.id='plantQuietDiagnostics';")
    p=one(p,"onStatus:(s,m)=>{imageSyncStatus", "onStatus:(s,m)=>{root.StudyQuietSync.status('plants',s,m);imageSyncStatus")
    p=one(p,'      cards=list;sequence++;',"      const q=root.StudyQuietSync,plan=q.plantPlan(cards,list,{group:currentGroup,order,pos,shuffled:isShuffled}),snapshot=q.capture(stage);\n      cards=list;sequence++;")
    p=one(p,'      updateCounts();if(!currentGroup&&cards.length)openGroup(cards[0].group);else if(currentGroup){rebuildOrder();render();}',"""      updateCounts();
      if(!currentGroup&&cards.length)openGroup(cards[0].group);
      else if(currentGroup&&plan){order=plan.order;pos=plan.pos;isShuffled=plan.shuffled;
        if(plan.redraw)render(snapshot.back);else{updateDeckHeader();updateMode();const n=stage.querySelector('.card-number');if(n)n.textContent=(pos+1)+' / '+order.length;}}
      q.restore(stage,snapshot,!!plan?.redraw&&plan.sameCard);""")
    p=one(p,'  imageSyncStatus.onclick=()=>api.open();',"  imageSyncStatus.onclick=()=>api.open();\n  root.StudyQuietSync.attach(api,{app:'plants',toolbar:'.toolbar',readonly:true,editing:()=>false});")
    write(path,p)
# Suppress only cloud-driven origin rerenders; user-initiated editing is unchanged.
for path in ['colors/origin-editor.js','colors/origin-editor-view.js']:
    p=read(path)
    p=one(p,'  function applyCloudRecords(input) {','  function applyCloudRecords(input,options={}) {')
    p=one(p,'    render(); return persist().then(ok =>', '    if(!options.quiet)render(); return persist().then(ok =>')
    if path.endswith('-view.js'):
        p=one(p,'  function previewRecords(input){records=validateRecords(input||{});render();}', '  function previewRecords(input,options={}){records=validateRecords(input||{});if(!options.quiet)render();}')
    write(path,p)
p=read('colors/drive-sync.js')
p=section(p,'    apply: prepared => {','    afterSync: async (view, api) => {',"""    apply: prepared => {
      const q=window.StudyQuietSync,nextPhotos={...manualEdits,...prepared.photos};
      for(const id of prepared.photoDeleted||[])delete nextPhotos[id];
      const nextStudy={...progress,...prepared.study},nextAssets={...assetRefs,...prepared.assets};
      const nextOrigins=E.mergeRecords(E.getRecords(),prepared.origins,true);
      const photoChanged=!q.same(manualEdits,nextPhotos),studyChanged=!q.same(progress,nextStudy),assetChanged=!q.same(assetRefs,nextAssets),originChanged=!q.same(E.getRecords(),nextOrigins);
      if(!photoChanged&&!studyChanged&&!assetChanged&&!originChanged)return;
      const snapshot=q.capture(document.getElementById('back')||document.body);
      manualEdits=nextPhotos;progress=nextStudy;assetRefs=nextAssets;
      // The current card, face, search and shuffle belong to this reading session.
      // Incoming navigation settings stay in the journal, not applied over a reader.
      const writes=[];
      if(photoChanged)writes.push(persistEdits());
      if(studyChanged)localStorage.setItem('colors1000_verified_progress',JSON.stringify(progress));
      if(assetChanged)writes.push(sync.cache.put('states',localAssetKey,assetRefs));
      if(originChanged)writes.push(E.applyCloudRecords(prepared.origins,{quiet:true}));
      render();q.restore(document.getElementById('back')||document.body,snapshot);
      return Promise.all(writes);
    },
""")
p=one(p,'    onStatus: (status, message) => {', "    onStatus: (status, message) => { window.StudyQuietSync.status('colors',status,message);")
# Attach after all existing sync/migration controls are constructed.
pos=p.rfind('})();')
if pos<0:raise RuntimeError('Color adapter closure changed')
p=p[:pos]+"  window.StudyQuietSync.attach(sync,{app:'colors',toolbar:'.toolbar .controls',editing:()=>cfg.isEditing()});\n"+p[pos:]
write('colors/drive-sync.js',p)
for path in ['colors/readonly-adapter.js','colors/local-adapter.js']:
    p=read(path)
    p=one(p,'    onStatus:(s,m)=>N.onStatus(s,m),',"    onStatus:(s,m)=>{N.onStatus(s,m);root.StudyQuietSync.status('colors',s,m);},")
    p=one(p,"if(/^[a-f0-9]{64}$/.test(h||'')&&(!f.sha256Checksum||f.sha256Checksum===h))byHash.set(h,f);", "if(/^[a-f0-9]{64}$/.test(h||'')&&(!f.sha256Checksum||f.sha256Checksum===h)&&(!byHash.has(h)||f.id.localeCompare(byHash.get(h).id)<0))byHash.set(h,f);")
    p=one(p,'      refs=nextRefs;manualEdits=clean;progress=validateStudyProgress(study);\n      E.previewRecords(cleanOrigins);',"""      const q=root.StudyQuietSync,nextStudy=validateStudyProgress(study);
      const changed=!q.same([refs,manualEdits,progress,E.getRecords()],[nextRefs,clean,nextStudy,cleanOrigins]);
      const snapshot=changed?q.capture(document.getElementById('back')||document.body):null;
      if(changed){refs=nextRefs;manualEdits=clean;progress=nextStudy;E.previewRecords(cleanOrigins,{quiet:true});}""")
    p=one(p,'      N.note({cards:CARDS.length,expected:940,...counts});render();',"      N.note({cards:CARDS.length,expected:940,...counts});if(changed){render();q.restore(document.getElementById('back')||document.body,snapshot);}")
    p=one(p,"  ready.catch(e=>api.setStatus('読込エラー',e.message));", "  ready.catch(e=>api.setStatus('読込エラー',e.message));\n  root.StudyQuietSync.attach(api,{app:'colors',toolbar:'.toolbar .controls',readonly:true,editing:()=>false});")
    write(path,p)
# Version only presentation resources; private storage/account keys are untouched.
def versions(text,names):
    for name in names:
        text=re.sub(r'('+re.escape(name)+r')\?[^\s\'\"<>\],]+',lambda m:m[1]+'?v=studyquiet1',text)
    return text
for path in ['plants/index.html','plants/plant-sync-v2.html','plants/drive-view.html','plants/saved-view.html','plants/pc-order-view.html']:
    p=one(read(path),'<script src="../drive-config.js?v=3"></script>','<script src="../study-quiet-sync.js?v=2"></script>\n<script src="../drive-config.js?v=3"></script>')
    p=versions(p,['./drive-sync.js','./local-adapter.js','./readonly-adapter.js'])
    p=re.sub(r'<script src="(?:\.\./view-shell-v2.js\?v=2|\./order-view-shell.js\?v=pcorder1)"></script>','<script src="../study-view-shell.js?v=1"></script>',p)
    write(path,p)
for path in ['colors/data/review47-loader.js','colors/data/review47-view-loader.js','colors/data/review47-local-loader.js','colors/data/review47-local-loader-v2.js']:
    p=one(read(path),'    for(const name of [',"    for(const name of ['../study-quiet-sync.js?v=2',")
    p=versions(p,['./drive-sync.js','./local-adapter.js','./readonly-adapter.js','./origin-editor.js','./origin-editor-view.js'])
    p=p.replace('../view-shell-v2.js?v=2','../study-view-shell.js?v=1')
    write(path,p)
for path in ['colors/index.html','colors/color-sync-v2.html','colors/drive-view.html','colors/saved-view.html']:
    p=versions(read(path),['data/review47-loader.js','data/review47-view-loader.js','data/review47-local-loader.js','data/review47-local-loader-v2.js'])
    write(path,p)
# Fresh optional entries avoid old exact-path workers serving outdated HTML.
write('plants/auto-view.html',read('plants/pc-order-view.html'))
write('colors/auto-view.html',read('colors/saved-view.html'))
s=one(read('view-shell-v2.js'),"['drive-view.html','saved-view.html']","['drive-view.html','saved-view.html','pc-order-view.html','auto-view.html']")
write('study-view-shell.js',s)
for app in ['plants','colors']:
    path=app+'/drive-view-worker.js';p=read(path)
    p=re.sub(r"const CACHE='[^']+'\+APP;","const CACHE='flashcards-study-quiet-shell-v1-'+APP;",p,count=1)
    p=versions(p,['./local-adapter.js','./readonly-adapter.js','./origin-editor-view.js','./data/review47-local-loader-v2.js'])
    p=p.replace('../view-shell-v2.js?v=2','../study-view-shell.js?v=1')
    m=re.search(r'^const ASSETS=(\[.*\]);$',p,re.M)
    if not m:raise RuntimeError('Viewer asset list changed')
    assets=json.loads(m[1])+['./auto-view.html','../study-quiet-sync.js?v=2','../study-view-shell.js?v=1']
    p=p[:m.start(1)]+json.dumps(list(dict.fromkeys(assets)))+p[m.end(1):];write(path,p)
for app in ['plants','colors']:
    path=app+'/service-worker.js';p=read(path)
    p=re.sub(r"(const CACHE\s*=\s*)'[^']+'",lambda m:m[1]+repr('plant-flashcards-v33-studyquiet1' if app=='plants' else 'colors1000-review47-drive3-studyquiet1'),p,count=1)
    p=versions(p,['./drive-sync.js','./origin-editor.js','./data/review47-loader.js'])
    # Existing STATIC lists are public application files only.
    anchor="'./index.html'"
    if p.count(anchor)<1:raise RuntimeError('Worker entry missing')
    p=p.replace(anchor,anchor+", '../study-quiet-sync.js?v=2'",1);write(path,p)
after={p:sha(p) for p in protected}
if before!=after:raise RuntimeError('Protected word/data/auth/cache file changed')
write('study-quiet-build.json',json.dumps({'schema':'study-quiet-auto-v1','interval_ms':15000,'protected_sha256':after,'drive_auth_changed':False,'storage_keys_changed':False,'private_photos_published':False},ensure_ascii=False,indent=2)+'\n')
print('Quiet automatic plant/color editors and viewers built; word app, data, auth, private cache and PC order unchanged.')
