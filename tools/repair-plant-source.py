"""Run after build-auth-only-ui.py. Plant editor transfer only. User-session
storage authorization remains enforced; no server deployment or privilege change.
"""
from pathlib import Path
import json,hashlib,re
R=Path(__file__).resolve().parents[1]
def read(p):return (R/p).read_text(encoding='utf-8')
def write(p,s):(R/p).write_text(s,encoding='utf-8')
def one(s,a,b):
    if s.count(a)!=1:raise RuntimeError('Plant source anchor changed: '+a[:100])
    return s.replace(a,b,1)
protected=['drive-core.js','drive-config.js','drive-sync.js','auth-only-ui.js','drive-local-view.js','drive-view-cache.js','plants/local-adapter.js','plants/photo-resume.js','plants/normal-order.js','plants/pc-order-source.js']+[str(p.relative_to(R)) for p in (R/'colors').rglob('*') if p.is_file()]+[str(p.relative_to(R)) for p in (R/'plants').glob('data*.json')]
def sums():return {p:hashlib.sha256((R/p).read_bytes()).hexdigest() for p in protected}
before=sums()
s=read('plants/drive-sync.js')
s=one(s,'  const copier = P.create({', '''  const sourceAuth=document.createElement('div');sourceAuth.className='auth-only-prompt';sourceAuth.hidden=true;sourceAuth.style.bottom='76px';
  const sourceButton=document.createElement('button');sourceButton.className='btn auth-only-button';sourceButton.textContent='以前の植物写真への認証が必要です — ログイン';sourceAuth.append(sourceButton);document.body.append(sourceAuth);
  const sourceDialog=document.createElement('dialog');sourceDialog.className='auth-only-dialog';
  sourceDialog.innerHTML='<h2>以前の植物写真へのログイン</h2><p>旧保存先の本人確認です。認証後は不足写真を自動でDriveへコピーします。写真の貼り直しは不要です。</p><label>メールアドレス<input type="email" autocomplete="username" data-old-email></label><label>パスワード<input type="password" autocomplete="current-password" data-old-password></label><button type="button" data-old-login>ログインして引き継ぐ</button><button type="button" data-old-close>閉じる</button><p data-old-error role="alert"></p>';
  document.body.append(sourceDialog);sourceButton.onclick=()=>sourceDialog.showModal();sourceDialog.querySelector('[data-old-close]').onclick=()=>sourceDialog.close();
  const legacySource=window.PlantLegacyPhotoSource.create({url:SUPABASE_URL,publicKey:SUPABASE_KEY,
    getSession:async()=>{if(!cloudSession)cloudSession=loadCloudSession();return ensureCloudSession();},
    getApi:()=>sync,getCards:()=>cards,getImages,resolveLocal:v=>resolveImageValue(v),toDataURL:blobToDataUrl,imageBlob:P.imageBlob,
    onAuthRequired:()=>{sourceAuth.hidden=false;},onAuthenticated:()=>{sourceAuth.hidden=true;if(sourceDialog.open)sourceDialog.close();}});
  window.PlantLegacyPhotoStatus=legacySource.status;
  sourceDialog.querySelector('[data-old-login]').onclick=async()=>{
    const button=sourceDialog.querySelector('[data-old-login]'),password=sourceDialog.querySelector('[data-old-password]'),error=sourceDialog.querySelector('[data-old-error]');button.disabled=true;error.textContent='';
    try{const data=await rawCloudAuth('/auth/v1/token?grant_type=password',{email:sourceDialog.querySelector('[data-old-email]').value.trim(),password:password.value});
      if(!data.access_token||!data.user?.id)throw Error('旧保存先の認証を確認できません。');
      saveCloudSession({access_token:data.access_token,refresh_token:data.refresh_token,expires_at:Date.now()+Number(data.expires_in||3600)*1000,user:data.user});
      legacySource.retry();copier.retry();sourceAuth.hidden=true;sourceDialog.close();
      if(sync.valid())await sync.sync();else sync.open();
    }catch(e){error.textContent=e.message||String(e);if(!sourceDialog.open)sourceDialog.showModal();}
    finally{password.value='';button.disabled=false;}
  };
  const copier = P.create({''')
s=one(s,'resolveImage: v => resolveImageValue(v)','resolveImage: v => legacySource.resolve(v)')
a=s.index('    migrate: async (api, view) => {');b=s.index('    prepareApply:',a)
s=s[:a]+'    migrate: (api,view) => legacySource.migrate(api,view),\n'+s[b:]
write('plants/drive-sync.js',s)
for p in ['plants/index.html','plants/plant-sync-v2.html']:
    s=read(p)
    s,n=re.subn(r'<script src="\./drive-sync.js\?v=[^\"]+"></script>', '<script src="./legacy-photo-source.js?v=1"></script>\n<script src="./drive-sync.js?v=plantsource1"></script>',s)
    if n!=1:raise RuntimeError('Plant adapter script missing: '+p)
    write(p,s)
s=read('plants/service-worker.js')
s=re.sub(r"const CACHE\s*=\s*'[^']+'", "const CACHE = 'plant-flashcards-v34-source1'",s,count=1)
s=re.sub(r"'\./drive-sync.js\?v=[^']+'", "'./drive-sync.js?v=plantsource1', './legacy-photo-source.js?v=1'",s)
write('plants/service-worker.js',s)
if before!=sums():raise RuntimeError('Protected photo/viewer/auth/data files changed')
write('plants/source-repair-build.json',json.dumps({'schema':'plant-source-repair-v1','protected_sha256':before,'privileged_server_added':False,'source_permissions_changed':False},ensure_ascii=False,indent=2)+'\n')
print('Plant transfer rescans old source and resolves missing local bytes with existing user authentication. No source/photo deletion.')
