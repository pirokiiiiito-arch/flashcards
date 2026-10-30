"""Run LAST after build-quiet-study-sync.py. Repair viewer image retry only.
Metadata equality must not suppress retries for failed photo downloads.
No Google auth changes, storage migrations, remote writes, or seed-data edits.
"""
from pathlib import Path
import json, re, hashlib
R=Path(__file__).resolve().parents[1]
def read(p):return (R/p).read_text(encoding='utf-8')
def write(p,s):(R/p).write_text(s,encoding='utf-8')
def one(s,a,b):
    if s.count(a)!=1:raise RuntimeError('Photo-resume anchor changed: '+a[:100])
    return s.replace(a,b,1)
def sha(p):return hashlib.sha256((R/p).read_bytes()).hexdigest()
protected=['index.html','word-sync-v2.html','drive-core.js','drive-sync.js','word-quiet-sync.js','word-network-recovery.js','drive-readonly.js','drive-local-base.js','drive-local-view.js','drive-view-cache.js','drive-legacy-view.js','plants/index.html','plants/drive-sync.js','plants/normal-order.js','plants/pc-order-source.js','plants/source-order.js','colors/index.html','colors/app-main.js','colors/app-view.js','colors/drive-sync.js','colors/origin-editor.js','colors/origin-editor-view.js','colors/network-support.js','colors/data/review47-progress.b64','colors/private-assets-manifest.json']+[str(p.relative_to(R)) for p in (R/'plants').glob('data*.json')]
before={p:sha(p) for p in protected}
for path in ['plants/local-adapter.js','plants/readonly-adapter.js']:
    s=read(path)
    s=one(s,'      statusEl.textContent=detail();',"""      statusEl.textContent=detail();
      // No-op reconciliation still has work when the first photo request failed.
      // Retry only empty/failed visible slots; retain card identity and loaded images.
      root.PlantPhotoResume.retry({stage,getCard:()=>cards[currentIndex()],getImages,
        resolve:(item,index,value)=>resolveCardImage(item,index,value),isEditing:()=>editing}).catch(()=>{});""")
    write(path,s)
for path in ['colors/local-adapter.js','colors/readonly-adapter.js']:
    s=read(path)
    a="      N.note({cards:CARDS.length,expected:940,...counts});if(changed){render();q.restore(document.getElementById('back')||document.body,snapshot);}"
    s=one(s,a,a+"\n      // Failed downloads reset their resolving flag; retry them even with identical metadata.\n      N.renderImages(api,refs).catch(e=>N.onStatus('写真取得エラー',e.message||String(e)));")
    write(path,s)
for path in ['plants/drive-view.html','plants/saved-view.html','plants/pc-order-view.html','plants/auto-view.html']:
    s=read(path)
    s=one(s,'<script src="../study-quiet-sync.js?v=1"></script>','<script src="./photo-resume.js?v=1"></script>\n<script src="../study-quiet-sync.js?v=1"></script>')
    s=s.replace('./local-adapter.js?v=studyquiet1','./local-adapter.js?v=photoresume1')
    s=s.replace('../study-view-shell.js?v=1','../photo-view-shell.js?v=1')
    s=one(s,'<head>','<head>\n<meta name="photo-resume-build" content="1">')
    s=one(s,'<body>','<body>\n<p style="margin:8px 16px;font:13px system-ui">写真再読込 修正1（保存データを引き継ぎ）</p>')
    write(path,s)
for path in ['colors/data/review47-view-loader.js','colors/data/review47-local-loader.js','colors/data/review47-local-loader-v2.js']:
    s=read(path).replace('./local-adapter.js?v=studyquiet1','./local-adapter.js?v=photoresume1').replace('./readonly-adapter.js?v=studyquiet1','./readonly-adapter.js?v=photoresume1').replace('../study-view-shell.js?v=1','../photo-view-shell.js?v=1')
    write(path,s)
for path in ['colors/drive-view.html','colors/saved-view.html','colors/auto-view.html']:
    s=read(path)
    s=s.replace('data/review47-local-loader-v2.js?v=studyquiet1','data/review47-local-loader-v2.js?v=photoresume1')
    s=one(s,'<head>','<head>\n<meta name="photo-resume-build" content="1">')
    s=one(s,'<body>','<body>\n<p style="margin:8px 16px;font:13px system-ui">写真再読込 修正1（保存データを引き継ぎ）</p>')
    write(path,s)
# Fresh entry for devices controlled by an older cache-first exact-path worker.
# Private data keys and account namespace are IDENTICAL to auto-view.html.
for app in ['plants','colors']:
    page=read(app+'/auto-view.html')
    # iPhone Safari/Chrome: keep one-finger scrolling, block double-tap and pinch zoom.
    page=re.sub(r'<meta name="viewport"[^>]*>', '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">', page, count=1)
    zoom_guard='''<style id="photo-view-zoom-guard">html,body,body *{touch-action:pan-y!important;-ms-touch-action:pan-y!important}</style>
<script id="photo-view-zoom-guard-js">
(function(){
  var lastTouchEnd=0,activePointers=new Set();
  function stop(e){e.preventDefault();}
  document.addEventListener('dblclick',stop,{capture:true,passive:false});
  document.addEventListener('gesturestart',stop,{capture:true,passive:false});
  document.addEventListener('gesturechange',stop,{capture:true,passive:false});
  document.addEventListener('gestureend',stop,{capture:true,passive:false});
  document.addEventListener('touchstart',function(e){if(e.touches&&e.touches.length>1)e.preventDefault();},{capture:true,passive:false});
  document.addEventListener('touchmove',function(e){if(e.touches&&e.touches.length>1)e.preventDefault();},{capture:true,passive:false});
  document.addEventListener('touchend',function(e){
    var now=Date.now();
    if(now-lastTouchEnd<=400)e.preventDefault();
    lastTouchEnd=now;
  },{capture:true,passive:false});
  document.addEventListener('pointerdown',function(e){if(e.pointerType==='touch')activePointers.add(e.pointerId);},{capture:true,passive:false});
  document.addEventListener('pointermove',function(e){if(e.pointerType==='touch'&&activePointers.size>1)e.preventDefault();},{capture:true,passive:false});
  function dropPointer(e){activePointers.delete(e.pointerId);}
  document.addEventListener('pointerup',dropPointer,true);
  document.addEventListener('pointercancel',dropPointer,true);
})();
</script>'''
    page=one(page,'</head>',zoom_guard+'\n</head>')
    write(app+'/photo-view.html',page)
s=one(read('study-view-shell.js'),"['drive-view.html','saved-view.html','pc-order-view.html','auto-view.html']","['drive-view.html','saved-view.html','pc-order-view.html','auto-view.html','photo-view.html']")
write('photo-view-shell.js',s)
for app in ['plants','colors']:
    path=app+'/drive-view-worker.js';s=read(path)
    s=one(s,'flashcards-study-quiet-shell-v1-','flashcards-photo-resume-shell-v11-')
    s=s.replace('./local-adapter.js?v=studyquiet1','./local-adapter.js?v=photoresume1').replace('./readonly-adapter.js?v=studyquiet1','./readonly-adapter.js?v=photoresume1').replace('./data/review47-local-loader-v2.js?v=studyquiet1','./data/review47-local-loader-v2.js?v=photoresume1').replace('../study-view-shell.js?v=1','../photo-view-shell.js?v=1')
    m=re.search(r'^const ASSETS=(\[.*\]);$',s,re.M)
    if not m:raise RuntimeError('Viewer worker assets missing')
    assets=json.loads(m[1])+['./photo-view.html','../photo-view-shell.js?v=1']+(['./photo-resume.js?v=1'] if app=='plants' else [])
    s=s[:m.start(1)]+json.dumps(list(dict.fromkeys(assets)))+s[m.end(1):]
    write(path,s)
after={p:sha(p) for p in protected}
if before!=after:raise RuntimeError('Protected editor, data, auth, or private cache implementation changed')
write('photo-resume-build.json',json.dumps({'schema':'photo-resume-v1','protected_sha256':after,'remote_writes_added':False,'data_recovery_claimed':False},ensure_ascii=False,indent=2)+'\n')
print('Failed visible photos now retry on unchanged sync. Existing photos, names, order, auth and private storage remain unchanged.')
