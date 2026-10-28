"""Run after previous builds/tests. Keep existing data keys, update viewer
resources and add a fresh entry alias for older offline workers. No user data
is bundled or uploaded by this build.
"""
from pathlib import Path
R=Path(__file__).resolve().parents[1]
def read(p): return (R/p).read_text(encoding='utf-8')
def write(p,s): (R/p).write_text(s,encoding='utf-8')
def one(s,a,b):
    if s.count(a)!=1: raise RuntimeError('Names-preservation anchor changed: '+a[:90])
    return s.replace(a,b,1)
def resources(s):
    return s.replace('drive-view-cache.js?v=1','drive-view-cache.js?v=names2').replace('drive-local-view.js?v=1','drive-local-view.js?v=names2').replace('view-shell.js?v=1','view-shell-v2.js?v=2')
p=resources(read('plants/drive-view.html'))
p=one(p,'<script src="../drive-local-view.js?v=names2"></script>','<script src="../drive-legacy-view.js?v=2"></script>\n<script src="../drive-local-view.js?v=names2"></script>')
p=p.replace('植物・端末保存の閲覧版','植物・端末保存版（名前保持 修正2）')
write('plants/drive-view.html',p);write('plants/saved-view.html',p)
l=resources(read('colors/data/review47-local-loader.js'))
l=one(l,"'../drive-local-view.js?v=names2'","'../drive-legacy-view.js?v=2','../drive-local-view.js?v=names2'")
write('colors/data/review47-local-loader-v2.js',l)
p=read('colors/drive-view.html').replace('review47-local-loader.js?v=1','review47-local-loader-v2.js?v=2').replace('色名・端末保存の閲覧版','色名・端末保存版（名前保持 修正2）')
write('colors/drive-view.html',p);write('colors/saved-view.html',p)
s=read('view-shell.js')
s=one(s,"if(!location.pathname.endsWith('/drive-view.html'))return;", "const entry=location.pathname.split('/').pop();if(!['drive-view.html','saved-view.html'].includes(entry))return;")
s=one(s,"scope:'./drive-view.html'","scope:'./'+entry")
write('view-shell-v2.js',s)
for app in ['plants','colors']:
    s=resources(read(app+'/drive-view-worker.js'))
    s=s.replace('flashcards-local-view-shell-v1-','flashcards-local-view-shell-v2-')
    s=s.replace('"./drive-view.html",','"./drive-view.html", "./saved-view.html", "../drive-legacy-view.js?v=2",')
    s=s.replace('review47-local-loader.js?v=1','review47-local-loader-v2.js?v=2')
    s=one(s,"const shell=absolute('./drive-view.html');","const shell=self.registration?.scope||absolute('./drive-view.html');")
    write(app+'/drive-view-worker.js',s)
p=read('plants/local-adapter.js')
check="      if(!list.length)throw Error('Driveから受信できた植物は0件です。カードの復旧は完了していません。');"
p=one(p,check,'')
p=one(p,'      cards=list;sequence++;',check+'\n      cards=list;sequence++;')
write('plants/local-adapter.js',p)
print('Name-preserving viewers built. Old cache contents retained; new private cache is isolated from word-worker cleanup.')
