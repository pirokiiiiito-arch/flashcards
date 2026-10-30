"""Build only plant/color network upgrades; fail closed when a source anchor drifts.
Original research, private manifests, IDs, Drive core, word app and photographs
are never rewritten. All replacements below operate on the public Pages build.
"""
from pathlib import Path
import re

def one(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError('Expected exactly one build anchor: '+old[:100])
    return text.replace(old,new,1)

def block(text, start, end, replacement):
    if text.count(start)!=1 or text.count(end)!=1:
        raise RuntimeError('Ambiguous section: '+start)
    a=text.index(start); b=text.index(end,a)
    return text[:a]+replacement+text[b:]

def read(path):return Path(path).read_text(encoding='utf-8')
def write(path,text):Path(path).write_text(text,encoding='utf-8')

# Plant cards: keep cloud absence distinct from an explicit deletion.
p=read('plants/drive-sync.js')
p=block(p,'    prepareApply: async view => {','    apply: list => {',
        "    prepareApply: async view => window.PlantNetworkSupport.plan(view, cards, getImages, withImages),\n")
p=one(p,'      await copier.sweep();','      await copier.sweep();\n      window.PlantNetworkSupport.complete(sync);')
p=one(p,'    onStatus: (s, message) => {','    onStatus: (s, message) => {\n      window.PlantNetworkSupport.update(s, message);')
p=one(p,"    const local = await getStoredImage('drive:' + v); if (local) return local;",
      "    const local = await getStoredImage('drive:' + v).catch(() => ''); if (local) return local;")
p=one(p,"await putStoredImage('drive:' + v, data); return data;", "await putStoredImage('drive:' + v, data).catch(() => {}); return data;")
write('plants/drive-sync.js',p)
p=read('plants/index.html')
p=one(p,'<script src="./drive-sync.js?v=3"></script>',
      '<script src="./network-support.js?v=2"></script>\n<script src="./drive-sync.js?v=network2"></script>')
p=one(p,'../drive-core.js?v=persist1','../drive-core.js?v=plant-network2')
p=one(p,'<body>','<body>\n<p style="padding:8px 16px;font:13px system-ui">植物ネット同期 修正版2</p>')
write('plants/index.html',p);write('plants/plant-sync-v2.html',p)
p=read('plants/service-worker.js')
p=re.sub(r"const CACHE = '[^']+';","const CACHE = 'plant-flashcards-v31-network2';",p,count=1)
p=one(p,"'./drive-sync.js?v=3'","'./drive-sync.js?v=network2', './network-support.js?v=2', './plant-sync-v2.html'")
p=one(p,"'../drive-core.js?v=persist1'","'../drive-core.js?v=plant-network2'")
write('plants/service-worker.js',p)

# Color image working set: immutable refs, not every photo's base64 on each sync.
p=read('colors/app-main.js')
p=one(p,"function safeImage(value){const v=String(value||'');", "function safeImage(value){const v=String(value||'');if(window.ColorNetworkSupport.isDrive(v))return v;")
p=block(p,'function normalizeEdits(input){','async function digestBytes(bytes){',
        'function normalizeEdits(input){return window.ColorNetworkSupport.normalize(input,VALID_SLOT_KEYS,safeImage);}\n')
p=one(p,'if(!edit.deleted){edit.sha256=await digestBytes(bytesOfDataUrl(edit.data_url));}',
      'if(!edit.deleted&&!window.ColorNetworkSupport.isDrive(edit.data_url)){edit.sha256=await digestBytes(bytesOfDataUrl(edit.data_url));}')
write('colors/app-main.js',p)
p=read('colors/drive-sync.js')
p=one(p,"          if (String(v.data_url || '').startsWith('gdrive:')) v.data_url = await dataURL(await api.getBlob(v.data_url));",
      '          // Private Drive photos are resolved lazily; origin/card data applies immediately.')
p=one(p,"      if (recovered === catalogue.counts.unique_images) {\n        await api.cache.put('states', localAssetKey, assetRefs);\n      }",
      "      await api.cache.put('states', localAssetKey, assetRefs);")
p=one(p,'      await ColorAssetMigration.publish(catalogue, refs, view, api);\n      showPrivateImages();',
      """      if (recovered === catalogue.counts.unique_images) await ColorAssetMigration.publish(catalogue, refs, view, api);
      const entries = Object.entries(view.data);
      window.ColorNetworkSupport.note({cards: CARDS.length, builtin: recovered, expected: catalogue.counts.unique_images,
        manual: entries.filter(([k,v]) => k.startsWith('photo:') && v && !v.deleted).length,
        origins: entries.filter(([k,v]) => k.startsWith('origin:') && v?.mode === 'manual').length});
      indicator.textContent = '既存写真のDrive参照 '+recovered+' / '+catalogue.counts.unique_images+'枚（画像本体は表示時に取得・SHA検証）';
      showPrivateImages();
      if (recovered !== catalogue.counts.unique_images) throw Error('色名'+CARDS.length+'件は読み込み済みですが、元の写真のDrive参照は'+recovered+'/'+catalogue.counts.unique_images+'枚です。写真が残るPCでも同じページから同期してください。');""")
p=one(p,"    onStatus: status => { if (status === '同期済み') showPrivateImages(); }",
      "    onStatus: (status, message) => { window.ColorNetworkSupport.onStatus(status, message); if (status === '同期済み') showPrivateImages(); }")
p=block(p,'  async function showPrivateImages() {','  function loadCatalogue() {',
        '  async function showPrivateImages() { return window.ColorNetworkSupport.renderImages(sync, assetRefs); }\n')
write('colors/drive-sync.js',p)
p=read('colors/data/review47-loader.js')
p=one(p,"['./app-main.js?v=1'","['./network-support.js?v=2','./app-main.js?v=network2'")
p=one(p,"'../drive-core.js?v=persist1'","'../drive-core.js?v=color-network2'")
p=one(p,"'./drive-sync.js?v=13'","'./drive-sync.js?v=network2'")
p=one(p,'    hint.remove();','    window.ColorNetworkSupport.installExport();\n    hint.remove();')
write('colors/data/review47-loader.js',p)
p=read('colors/index.html')
p=one(p,'data/review47-loader.js?v=3','data/review47-loader.js?v=network2')
p=one(p,'<body>','<body>\n<p style="padding:8px 16px;font:13px system-ui">色名ネット同期 修正版2</p>')
write('colors/index.html',p);write('colors/color-sync-v2.html',p)
p=read('colors/service-worker.js')
p=re.sub(r"const CACHE = '[^']+';","const CACHE = 'colors1000-review47-drive3-network2';",p,count=1)
p=one(p,"'./data/review47-loader.js?v=3'","'./data/review47-loader.js?v=network2', './network-support.js?v=2', './color-sync-v2.html'")
p=one(p,"'./app-main.js?v=1'","'./app-main.js?v=network2'")
p=one(p,"'./drive-sync.js?v=13'","'./drive-sync.js?v=network2'")
p=one(p,"'../drive-core.js?v=6'","'../drive-core.js?v=color-network2'")
write('colors/service-worker.js',p)
print('Plant and color network v2 builds complete. No user data or shared word sync changed.')
