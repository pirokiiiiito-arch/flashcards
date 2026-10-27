"""Run after the existing word/plant/color builds. Generate separate viewing
pages only. The ordinary apps and shared sync implementation are not changed.
"""
from pathlib import Path
import re

def read(p):return Path(p).read_text(encoding='utf-8')
def write(p,s):Path(p).write_text(s,encoding='utf-8')
def one(s,a,b):
    if s.count(a)!=1:raise RuntimeError('Expected one viewer anchor: '+a[:90])
    return s.replace(a,b,1)
def section(s,a,b,replacement):
    if s.count(a)!=1 or s.count(b)!=1:raise RuntimeError('Ambiguous viewer section: '+a)
    start=s.index(a);end=s.index(b,start)
    return s[:start]+replacement+s[end:]

# No seed migrations or local-storage write wrappers run in the plant viewer.
p=read('plants/index.html')
p=one(p,'let cards=loadCards();','let cards=[];')
p=one(p,'let cloudSession=loadCloudSession();','let cloudSession=null;')
p=one(p,'function saveCards(){localStorage.setItem(STORAGE_KEY,JSON.stringify(cards))}',"function saveCards(){throw Error('閲覧専用です。PCの通常画面で編集してください。');}")
p=section(p,'const plantBootReady=(async()=>{','</script>\n<script src="../drive-config.js',
          'const plantBootReady=Promise.resolve();\nupdateCounts();\n')
p=one(p,'    bindImagePaste(imageBox,savePastedImage);','    // Pasting is disabled in the read-only page.')
p=one(p,'      imageBox.replaceChildren(img);\n    });','      imageBox.replaceChildren(img);\n    }).catch(e=>{imageBox.textContent=e.message||"写真を取得できません";});')
p=one(p,'<script src="./network-support.js?v=2"></script>','<script src="../drive-readonly.js?v=1"></script>')
p=one(p,'<script src="./drive-sync.js?v=network2"></script>','<script src="./readonly-adapter.js?v=1"></script>\n<script src="../readonly-guard.js?v=1"></script>')
p=p.replace('植物ネット同期 修正版2','植物・保存不要の閲覧版')
p=re.sub(r'<script src="https://cdn.jsdelivr.net/npm/xlsx@[^\"]+"></script>','',p)
p=one(p,'<head>','<head>\n<script>window.FLASHCARDS_READONLY_VIEW=true;</script>')
write('plants/drive-view.html',p)

# Copy the rendering app but never initialize, read or migrate its photo database.
a=read('colors/app-main.js')
a=section(a,'async function persistEdits(){','function normalizeEdits(input){',"async function persistEdits(){throw Error('閲覧専用です。編集はPCの通常画面で行ってください。');}\n")
a=section(a,'const readyImages=(async()=>{','render();})();',
          'const readyImages=Promise.resolve().then(()=>{manualEdits={};progress={};')
# The replacement above intentionally retains the original trailing render+closure,
# but changes the IIFE call to a Promise.then callback.
a=one(a,'progress={};render();})();','progress={};render();});')
for anchor in ['async function setImage(key,file){','async function changeEdit(key,restore){','async function importData(data){','function mark(v){']:
    a=one(a,anchor,anchor+"throw Error('閲覧専用です。編集はPCの通常画面で行ってください。');")
write('colors/app-view.js',a)
e=read('colors/origin-editor.js')
e=one(e,'  window.ColorOriginEditor = Object.freeze({ applyCloudRecords,',
      '  function previewRecords(input){records=validateRecords(input||{});render();}\n  window.ColorOriginEditor = Object.freeze({ previewRecords, applyCloudRecords,')
e=one(e,'  async function persist() {',"  async function persist() {\n    throw Error('閲覧専用です。由来の保存はPCの通常画面で行ってください。');")
write('colors/origin-editor-view.js',e)
l=read('colors/data/review47-loader.js')
start="    for(const name of [";end=']) await script(name);'
if l.count(start)!=1 or l.count(end)!=1:raise RuntimeError('Loader scripts changed')
a=l.index(start);b=l.index(end,a)+len(end)
l=l[:a]+"""    for(const name of ['./network-support.js?v=2','./app-view.js?v=1','./origin-editor-view.js?v=1',
      '../drive-config.js?v=3','../drive-core.js?v=readonly1','../drive-readonly.js?v=1',
      './readonly-adapter.js?v=1','./nav-top.js?v=1','../readonly-guard.js?v=1']) await script(name);"""+l[b:]
l=one(l,'    window.ColorNetworkSupport.installExport();\n','')
write('colors/data/review47-view-loader.js',l)
p=read('colors/index.html')
p=one(p,'data/review47-loader.js?v=network2','data/review47-view-loader.js?v=1')
p=re.sub(r'<script>if\("serviceWorker" in navigator\).*?</script>','',p)
p=p.replace('色名ネット同期 修正版2','色名・保存不要の閲覧版')
p=one(p,'<head>','<head>\n<script>window.FLASHCARDS_READONLY_VIEW=true;</script>')
write('colors/drive-view.html',p)
print('Separate plant/color GET-only viewers built. PC editors, word sync, research and journals unchanged.')
