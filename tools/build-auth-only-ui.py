"""Run LAST, after repair-photo-resume.py. Sync presentation only.
No auth implementation, data, image, ordering, storage or scheduler changes.
Reuse every existing URL rather than creating another application entry.
"""
from pathlib import Path
import re,json,hashlib
R=Path(__file__).resolve().parents[1]
def read(p):return (R/p).read_text(encoding='utf-8')
def write(p,s):(R/p).write_text(s,encoding='utf-8')
def one(s,a,b):
    if s.count(a)!=1:raise RuntimeError('Authentication-only UI anchor changed: '+a[:100])
    return s.replace(a,b,1)
def sha(p):return hashlib.sha256((R/p).read_bytes()).hexdigest()
protected=['drive-core.js','drive-config.js','drive-readonly.js','drive-local-base.js','drive-local-view.js','drive-view-cache.js','drive-legacy-view.js','drive-sync.js','word-network-recovery.js','word-recovery.js','plants/drive-sync.js','plants/drive-image-copy.js','plants/photo-resume.js','plants/local-adapter.js','plants/readonly-adapter.js','plants/normal-order.js','plants/pc-order-source.js','plants/source-order.js','colors/drive-sync.js','colors/local-adapter.js','colors/readonly-adapter.js','colors/network-support.js','colors/app-main.js','colors/app-view.js','colors/origin-editor.js','colors/origin-editor-view.js','colors/data/review47-progress.b64','colors/private-assets-manifest.json']+[str(p.relative_to(R)) for p in (R/'plants').glob('data*.json')]
before={p:sha(p) for p in protected}
s=read('word-quiet-sync.js')
s=one(s,'    const counter=document.getElementById(\'countText\'),value=count()+\'件\';',"    root.AuthOnlySync?.refresh(api);\n    const counter=document.getElementById('countText'),value=count()+'件';")
s=one(s,'    active={api,label,button,count,dialog};','    active={api,label,button,count,dialog};\n    root.AuthOnlySync.attach(api,{app:\'words\'});')
write('word-quiet-sync.js',s)
s=read('study-quiet-sync.js')
s=one(s,"    label.dataset.state=notice.s;label.classList.toggle('sq-error',bad||!!warn);label.title=notice.message||text;", "    label.dataset.state=notice.s;label.classList.toggle('sq-error',bad||!!warn);label.title=notice.message||text;\n    root.AuthOnlySync?.refresh(api);")
s=one(s,'    const entry={api,label,dialog,options};entries.set(app,entry);tidy();', "    const entry={api,label,dialog,options};entries.set(app,entry);tidy();\n    root.AuthOnlySync.attach(api,{app,readonly:!!options.readonly});")
write('study-quiet-sync.js',s)
def versions(s):
    for name in ['word-quiet-sync.js','study-quiet-sync.js']:
        s=re.sub(r'('+re.escape(name)+r')\?v=[^\s\'\"<>\],]+',lambda m:m[1]+'?v=authonly1',s)
    return s
entries=['index.html','word-sync-v2.html']
entries+=['plants/'+p for p in ['index.html','plant-sync-v2.html','drive-view.html','saved-view.html','pc-order-view.html','auto-view.html','photo-view.html']]
entries+=['colors/'+p for p in ['index.html','color-sync-v2.html','drive-view.html','saved-view.html','auto-view.html','photo-view.html']]
for path in entries:
    s=read(path);prefix='../' if '/' in path else './'
    s,n=re.subn(r'<html\b(?![^>]*data-auth-only-sync)', '<html data-auth-only-sync="1"',s,count=1)
    if n!=1:raise RuntimeError('HTML root changed: '+path)
    s=one(s,'<head>', '<head>\n<link rel="stylesheet" href="'+prefix+'auth-only-ui.css?v=1">\n<script src="'+prefix+'auth-only-ui.js?v=1"></script>')
    # Old repair/version banners are diagnostic labels, not learning content.
    s=re.sub(r'<p (style="[^\"]*")>((?:写真再読込 修正1|植物の通常順：PC基準 修正1|植物[・ネ]|色名[・ネ])[^<]*)</p>',r'<p data-sync-build-note \1>\2</p>',s)
    s=versions(s)
    if path.startswith('colors/'):
        s=re.sub(r'(data/review47-(?:local-loader-v2|local-loader|view-loader|loader)\.js)\?v=[^\"<>]+',r'\1?v=authonly1',s)
    write(path,s)
for p in (R/'colors/data').glob('review47-*loader*.js'):
    rel=str(p.relative_to(R));write(rel,versions(read(rel)))
for path in ['service-worker.js','plants/service-worker.js','colors/service-worker.js','plants/drive-view-worker.js','colors/drive-view-worker.js']:
    s=versions(read(path))
    s=re.sub(r'(const CACHE\s*=\s*)\'([^\']+)\'',lambda m:m[1]+repr(m[2]+'-authonly1'),s,count=1)
    prefix='./' if '/' not in path else '../'
    if 'drive-view-worker' in path:
        m=re.search(r'^const ASSETS=(\[.*\]);$',s,re.M)
        if not m:raise RuntimeError('Viewer worker list missing')
        assets=json.loads(m[1])+[prefix+'auth-only-ui.js?v=1',prefix+'auth-only-ui.css?v=1']
        assets=[re.sub(r'(review47-[^/]*loader[^/]*)\?v=[^\s]+',r'\1?v=authonly1',x) for x in assets]
        s=s[:m.start(1)]+json.dumps(list(dict.fromkeys(assets)))+s[m.end(1):]
    else:
        if s.count("'./index.html'")<1:raise RuntimeError('Worker entries missing')
        s=s.replace("'./index.html'","'./index.html', '"+prefix+"auth-only-ui.js?v=1', '"+prefix+"auth-only-ui.css?v=1'",1)
        s=re.sub(r'(review47-[^/\s\'\"]*loader[^/\s\'\"]*)\?v=[^\s\'\"\],]+',r'\1?v=authonly1',s)
    write(path,s)
after={p:sha(p) for p in protected}
if before!=after:raise RuntimeError('Protected data, photo, sync, or auth code changed')
write('auth-only-ui-build.json',json.dumps({'schema':'authentication-only-ui-v1','entry_points':entries,'protected_sha256':after,'authentication_flow_changed':False,'new_entry_urls':False},ensure_ascii=False,indent=2)+'\n')
print('All existing entries now hide routine sync UI and show only authentication-required controls. Data/auth/sync/photo code unchanged.')
