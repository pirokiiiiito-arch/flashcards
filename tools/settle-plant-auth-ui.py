"""Run after unblock-plant-transfers.py. Only the plant source-auth presentation.
Keep the authenticated source reader, Google authorization and transfer queue
byte-identical. Never delete or alter user photos or persist a fake login state.
"""
from pathlib import Path
import hashlib,json,re
R=Path(__file__).resolve().parents[1]
def read(p):return (R/p).read_text(encoding='utf-8')
def write(p,s):(R/p).write_text(s,encoding='utf-8')
def one(s,a,b):
    if s.count(a)!=1:raise RuntimeError('Plant auth display anchor changed: '+a[:100])
    return s.replace(a,b,1)
def sha(p):return hashlib.sha256((R/p).read_bytes()).hexdigest()
protected=['drive-core.js','drive-config.js','auth-only-ui.js','drive-sync.js','index.html','word-sync-v2.html','drive-local-base.js','drive-local-view.js','drive-view-cache.js','plants/drive-transfer-core.js','plants/legacy-photo-source.js','plants/drive-image-copy.js','plants/local-adapter.js','plants/photo-view.html','plants/normal-order.js','plants/pc-order-source.js']+[str(p.relative_to(R)) for p in (R/'colors').rglob('*') if p.is_file()]+[str(p.relative_to(R)) for p in (R/'plants').glob('data*.json')]
before={p:sha(p) for p in protected}
s=read('plants/drive-sync.js')
s=one(s,"sourceAuth.className='auth-only-prompt';", "sourceAuth.className='auth-only-prompt';sourceAuth.id='plantSourceAuthRequired';")
s=one(s,"sourceDialog.className='auth-only-dialog';", "sourceDialog.className='auth-only-dialog';sourceDialog.id='plantSourceAuthDialog';")
s=one(s,"  const legacySource=window.PlantLegacyPhotoSource.create(", """  function refreshSourceAuth(){
    if(!sync)return;
    const needed=window.PlantSourceAuthUI.required(legacySource.status(),cards,getImages,sync.view());
    sourceAuth.hidden=!needed;sourceAuth.setAttribute('aria-hidden',String(!needed));
    if(!needed&&sourceDialog.open)sourceDialog.close();
  }
  const legacySource=window.PlantLegacyPhotoSource.create(""")
s=one(s,'onAuthRequired:()=>{sourceAuth.hidden=false;}', 'onAuthRequired:refreshSourceAuth')
s=one(s,'      retry.disabled = s.busy;', '      retry.disabled = s.busy;\n      refreshSourceAuth();')
s=one(s,'    onStatus: (s, message) => {', '    onStatus: (s, message) => {\n      refreshSourceAuth();')
s=one(s,'      window.PlantNetworkSupport.complete(sync);', '      window.PlantNetworkSupport.complete(sync);\n      refreshSourceAuth();')
write('plants/drive-sync.js',s)
for path in ['plants/index.html','plants/plant-sync-v2.html']:
    s=one(read(path),'<script src="./drive-sync.js?v=queue1"></script>', '<script src="./source-auth-ui.js?v=1"></script>\n<script src="./drive-sync.js?v=authsettled9"></script>')
    write(path,s)
s=one(read('plants/service-worker.js'),'plant-flashcards-v35-queue1','plant-flashcards-v44-photorecover1')
s=one(s,"'./drive-sync.js?v=queue1'", "'./drive-sync.js?v=authsettled9', './source-auth-ui.js?v=1'")
write('plants/service-worker.js',s)
if before!={p:sha(p) for p in protected}:raise RuntimeError('Protected auth, photo, data, transfer or viewer changed')
write('plants/auth-settled-build.json',json.dumps({'schema':'plant-source-auth-display-v1','protected_sha256':before,'authentication_flow_changed':False,'photo_mutation':False},ensure_ascii=False,indent=2)+'\n')
print('Obsolete source login prompt hidden for synced photos. Necessary Google/source authentication retained.')
