"""Run last, after protect-local-names.py. Plant ordering only.
Use the PC boot source sequence as fallback; explicit PC order has priority.
No private data is bundled and no names, descriptions or image bytes change.
"""
from pathlib import Path
import json,hashlib,re
R=Path(__file__).resolve().parents[1]
def read(p):return (R/p).read_text(encoding='utf-8')
def write(p,s):(R/p).write_text(s,encoding='utf-8')
def one(s,a,b):
    if s.count(a)!=1:raise RuntimeError('Plant-order anchor changed: '+a[:100])
    return s.replace(a,b,1)
def sha(p):return hashlib.sha256((R/p).read_bytes()).hexdigest()
files=['plants/data.json']+[f'plants/data-angio-extra-{i}.json' for i in range(1,6)]+['plants/data-nonangio-extra.json']
protected=files+['index.html','drive-core.js','drive-sync.js','drive-local-view.js','drive-view-cache.js','drive-legacy-view.js','service-worker.js']+[str(p.relative_to(R)) for p in (R/'colors').rglob('*') if p.is_file()]
before={p:sha(p) for p in protected}
groups={'angiosperm','gymnosperm','fern','moss'}
valid=lambda c:c.get('group') in groups and isinstance(c.get('name'),str) and isinstance(c.get('description'),str)
rows=[c for c in json.loads(read(files[0]))['cards'] if valid(c)]
seen={c['name'].strip() for c in rows if c['group']=='angiosperm'}
for path in files[1:6]:
    for c in json.loads(read(path))['cards']:
        name=c['name'].strip()
        if name and name not in seen:rows.append(c);seen.add(name)
seen={(c['group'],c['name'].strip()) for c in rows}
for c in json.loads(read(files[-1]))['cards']:
    if valid(c):
        key=(c['group'],c['name'].strip())
        if key not in seen:rows.append(c);seen.add(key)
ids=[c['id'] for c in rows]
if len(set(ids))!=len(ids):raise RuntimeError('Duplicate plant source IDs')
if rows[0]['name']!='アイズシモツケ':raise RuntimeError('PC first card changed')
if len(rows)!=9891 or sum(c['group']=='angiosperm' for c in rows)!=8621:raise RuntimeError('PC source counts changed; do not guess ordering')
write('plants/source-order.js','/* Existing public PC seed-loading sequence, without re-sorting. */\n(function(root){const ids='+json.dumps(ids,ensure_ascii=False,separators=(',',':'))+';root.PLANT_SOURCE_ORDER=Object.freeze(ids);if(typeof module!=="undefined"&&module.exports)module.exports=ids;})(typeof window!=="undefined"?window:globalThis);\n')
p=read('plants/drive-sync.js')
p=one(p,'  if (window.PlantDriveSync) return;','  if (window.PlantDriveSync) return;\n  const O=window.PlantNormalOrder, orderSource=window.PlantPcOrderSource.create();')
p=one(p,'  function values(list) {','  function values(list, includeOrder=true) {')
p=one(p,'    const result = {};','    const result = {};\n    const normalOrder=orderSource.read(); if(includeOrder&&normalOrder)result[O.KEY]=normalOrder;')
p=one(p,'const data = values(raw.cards), times = {};','const data = values(raw.cards,false), times = {};')
p=one(p,"    prepareApply: async view => window.PlantNetworkSupport.plan(view, cards, getImages, withImages, sync?.pendingValues?.('image:') || {}),", """    prepareApply: async view => {
      const record=O.validate(view.data[O.KEY]||null);
      const list=window.PlantNetworkSupport.plan(view,cards,getImages,withImages,sync?.pendingValues?.('image:') || {});
      return {list:O.ordered(list,record||orderSource.read(),{preferredIds:cards.map(c=>c.id)}),record};
    },""")
p=one(p,'    apply: list => {','    apply: prepared => {\n      const list=prepared.list;orderSource.accept(prepared.record);')
p=one(p,'    onStatus: (s, message) => {','    onStatus: (s, message) => {\n      orderSource.status(s);')
p=one(p,'  sync = F.install(cfg); window.PlantDriveSync = sync; copier.attach(sync);','  sync = F.install(cfg); window.PlantDriveSync = sync; copier.attach(sync);orderSource.attach(sync);')
p=one(p,'  saveCards = function () { const r = originalSave(); sync.changed(); if (sync.valid()) queueMicrotask(async () => { try { copier.retry(); await copier.sweep(); await sync.sync(); if (sync.status().pending && sync.valid()) await sync.sync(); } catch {} }); return r; };','  saveCards = function () { const r = originalSave(); if(!sync.applying)orderSource.capture(cards); sync.changed(); if (sync.valid()) queueMicrotask(async () => { try { copier.retry(); await copier.sweep(); await sync.sync(); if (sync.status().pending && sync.valid()) await sync.sync(); } catch {} }); return r; };')
write('plants/drive-sync.js',p)
for path in ['plants/readonly-adapter.js','plants/local-adapter.js']:
    p=read(path)
    p=one(p,'  let stats={cards:0,assigned:0,drive:0,files:0},urls=new Map(),sequence=0;','  let stats={cards:0,assigned:0,drive:0,files:0},urls=new Map(),sequence=0,normalOrderRecord=null;')
    p=one(p,"  function detail(){return '植物 '","  function detail(){return root.PlantNormalOrder.describe(normalOrderRecord)+'\\n植物 '")
    p=one(p,'      const list=[];let assigned=0,drive=0;','      let list=[];let assigned=0,drive=0;')
    p=one(p,'      list.sort((a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0)||a.id.localeCompare(b.id));',
          '      const incomingOrder=root.PlantNormalOrder.validate(result.view.data[root.PlantNormalOrder.KEY]||null);\n      list=root.PlantNormalOrder.ordered(list,incomingOrder);normalOrderRecord=incomingOrder;')
    write(path,p)
shared='<script src="./source-order.js?v=pcorder1"></script>\n<script src="./normal-order.js?v=pcorder1"></script>\n'
for path in ['plants/index.html','plants/plant-sync-v2.html','plants/drive-view.html','plants/saved-view.html']:
    p=read(path)
    extra='' if 'view.html' in path else '<script src="./pc-order-source.js?v=pcorder1"></script>\n'
    p=one(p,'<script src="../drive-config.js?v=3"></script>',shared+extra+'<script src="../drive-config.js?v=3"></script>')
    p=p.replace('./drive-sync.js?v=network2','./drive-sync.js?v=pcorder1').replace('./local-adapter.js?v=1','./local-adapter.js?v=pcorder1')
    p=one(p,'<body>','<body>\n<p style="margin:8px 16px;font:13px system-ui">植物の通常順：PC基準 修正1</p>')
    write(path,p)
# A fresh entry avoids an older exact-URL worker serving an outdated HTML page.
# It uses the same account/namespace/cache keys, not a new user data archive.
p=one(read('plants/saved-view.html'),'../view-shell-v2.js?v=2','./order-view-shell.js?v=pcorder1')
write('plants/pc-order-view.html',p)
s=one(read('view-shell-v2.js'),"['drive-view.html','saved-view.html']","['drive-view.html','saved-view.html','pc-order-view.html']")
write('plants/order-view-shell.js',s)
p=read('plants/service-worker.js')
p=one(p,'plant-flashcards-v31-network2','plant-flashcards-v32-pcorder1')
p=one(p,'./drive-sync.js?v=network2','./drive-sync.js?v=pcorder1')
p=one(p,"'./plant-sync-v2.html'","'./plant-sync-v2.html', './source-order.js?v=pcorder1', './normal-order.js?v=pcorder1', './pc-order-source.js?v=pcorder1'")
write('plants/service-worker.js',p)
p=read('plants/drive-view-worker.js')
p=one(p,'flashcards-local-view-shell-v2-','flashcards-local-view-shell-v3-pcorder1-')
p=p.replace('./local-adapter.js?v=1','./local-adapter.js?v=pcorder1')
m=re.search(r'^const ASSETS=(\[.*\]);$',p,re.M)
if not m:raise RuntimeError('Viewer asset list missing')
assets=json.loads(m.group(1))+['./source-order.js?v=pcorder1','./normal-order.js?v=pcorder1','./pc-order-view.html','./order-view-shell.js?v=pcorder1']
p=p[:m.start(1)]+json.dumps(assets)+p[m.end(1):]
write('plants/drive-view-worker.js',p)
after={p:sha(p) for p in protected}
if before!=after:raise RuntimeError('A plant dataset, a color file, word sync or private storage implementation changed')
write('plants/order-build-report.json',json.dumps({'schema':'plant-order-build-v1','source_count':len(rows),'source_counts':{g:sum(c['group']==g for c in rows) for g in sorted(groups)},'first_angiosperms':[c['name'] for c in rows if c['group']=='angiosperm'][:5],'protected_sha256':after,'user_pc_sequence_received':False},ensure_ascii=False,indent=2)+'\n')
print('Plant PC-order alignment built:',len(rows),'cards; first =',rows[0]['name'],'; no names or photos altered.')
