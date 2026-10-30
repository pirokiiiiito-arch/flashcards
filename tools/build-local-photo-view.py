"""Run last, after palette restoration. Ordinary editors and their data remain
unchanged. Only generated drive-view.html pages get local-first viewing.
The established OAuth and GET-only request implementation is reused unchanged.
"""
from pathlib import Path
import hashlib, json
R=Path(__file__).resolve().parents[1]
def read(p):return (R/p).read_text(encoding='utf-8')
def write(p,s):(R/p).write_text(s,encoding='utf-8')
def one(s,a,b):
    if s.count(a)!=1:raise RuntimeError('Local viewer anchor changed: '+a[:120])
    return s.replace(a,b,1)
def sha(p):return hashlib.sha256((R/p).read_bytes()).hexdigest()
protected=['drive-core.js','drive-sync.js','index.html','word-network-recovery.js','drive-readonly.js','plants/index.html','plants/drive-sync.js','colors/index.html','colors/color-sync-v2.html','colors/app-main.js','colors/app-view.js','colors/drive-sync.js','colors/origin-editor.js','colors/data/review47-progress.b64','colors/private-assets-manifest.json']
before={p:sha(p) for p in protected}
s=read('drive-readonly.js')
s=one(s,'function createTransport({namespace,core,fetcher=root.fetch.bind(root),onStatus=()=>{}})', 'function createTransport({namespace,core,fetcher=root.fetch.bind(root),onStatus=()=>{},journalCache=null})')
s=one(s,'nextPageToken,files(id,name,appProperties,sha256Checksum,size,mimeType)','nextPageToken,files(id,name,appProperties,md5Checksum,sha256Checksum,version,modifiedTime,size,mimeType)')
s=one(s,"const journals=await list('journal'),events=Object.create(null);", "const journals=await list('journal'),events=Object.create(null);let fetchedJournals=0,reusedJournals=0;")
s=one(s,"        const doc=await (await request(BASE+'files/'+encodeURIComponent(journals[i].id)+'?alt=media')).json();", """        const file=journals[i];
        const version=file.md5Checksum?'md5:'+file.md5Checksum:file.sha256Checksum?'sha:'+file.sha256Checksum:file.version?'version:'+file.version+':'+(file.modifiedTime||''):null;
        const stored=version&&journalCache?await journalCache.get(account,file.id,version):null;
        const doc=stored||await (await request(BASE+'files/'+encodeURIComponent(file.id)+'?alt=media')).json();
        if(stored)reusedJournals++;else fetchedJournals++;""")
s=one(s,"        if(Object.keys(events).length>300000)throw Error('履歴が大きすぎます。元データは変更していません。');", "        if(Object.keys(events).length>300000)throw Error('履歴が大きすぎます。元データは変更していません。');\n        if(!stored&&version&&journalCache)await journalCache.put(account,file.id,version,doc);")
s=one(s,"return {view,imageFiles:images,journals:journals.length,email:user.emailAddress||'',account};", "return {view,imageFiles:images,journals:journals.length,email:user.emailAddress||'',account,fetchedJournals,reusedJournals};")
s=s.replace('端末には保存しません。','変更のない履歴は端末保存を再利用します。')
s=one(s,"title.textContent='保存不要のDrive閲覧モード'", "title.textContent='端末保存・差分同期の閲覧モード'")
s=one(s,"description.textContent='写真・文字をDriveから直接受信します。端末キャッシュを保存せず、PC・Driveのデータも変更しません。この画面では編集できません。'", "description.textContent='取得した写真・文字はこのブラウザに保存します。次回は保存済みから表示し、接続時だけDriveの変更分を確認します。編集はPCの通常画面で行ってください。'")
s=one(s,"refresh.textContent='Driveから再取得'", "refresh.textContent='変更分だけ同期'")
s=one(s,"const output=document.createElement('p');", "const storage=document.createElement('p');storage.id='localPhotoStorageStatus';storage.setAttribute('role','status');let storageFailed=false;\n    const shell=document.createElement('p');shell.id='cachedViewerShellStatus';shell.setAttribute('role','status');\n    const output=document.createElement('p');")
s=one(s,'box.append(title,description,connect,refresh,output);','box.append(title,description,connect,refresh,output,storage,shell);')
s=one(s,'let gisPromise,client,applying=null;', 'let gisPromise,client,applying=null,startup=Promise.resolve();')
s=one(s,'const transport=createTransport({namespace:cfg.namespace,core:root.FlashcardsDrive,onStatus:', "const transport=root.DriveLocalView.createTransport({namespace:cfg.namespace,core:root.FlashcardsDrive,onCache:info=>{if(!info.durable)storageFailed=true;storage.textContent=(storageFailed?'注意：一部の保存に失敗しています。閉じた後に再取得が必要な写真があります。\\n':'')+info.message;},onStatus:")
s=one(s,'        await cfg.ready;\n        const result=await transport.sync();','        await startup;await cfg.ready;\n        const result=await transport.sync();')
s=one(s,"cfg.summary?.(result)||'文字・画像の参照を受信しました。写真は表示する欄から取得します。'", "(cfg.summary?.(result)||'文字・画像の参照を受信しました。')+'\\n今回の履歴：新規取得 '+(result.fetchedJournals||0)+'件／端末再利用 '+(result.reusedJournals||0)+'件。'")
s=one(s,"}catch(e){transport.setStatus('認証準備エラー',e.message||String(e));}", "}catch(e){connect.disabled=false;if(!transport.status().cached)transport.setStatus('認証準備エラー',e.message||String(e));}")
s=one(s,"connect.onclick=()=>{if(client)client.requestAccessToken({prompt:''});};", "connect.onclick=()=>{if(client){root.navigator?.storage?.persist?.().catch(()=>{});client.requestAccessToken({prompt:''});}else prepare();};")
s=one(s,'    prepare();return api;', """    startup=(async()=>{
      await cfg.ready;const result=await transport.restore();
      if(result){await cfg.apply(result,api);transport.setStatus('保存済みで閲覧',cfg.summary?.(result)||'保存済み写真・文字を復元しました。');storage.textContent='保存済みデータを復元しました。再接続しなくても、保存済み写真を表示できます。';}
      else storage.textContent='初回取得後、表示した写真を順に端末へ保存します。';
    })().catch(e=>transport.setStatus('保存済みの読込未完了',e.message||String(e)));
    if(root.navigator?.onLine!==false)prepare();else connect.disabled=false;
    return api;""")
s=s.replace("'接続して表示'", "'初回接続・変更分を同期'")
s=s.replace('「接続して表示」','「初回接続・変更分を同期」')
s=one(s,'root.DriveReadOnly=exported;', 'root.DriveReadOnlyBase=exported;root.DriveReadOnly=exported;')
s=s.replace('/* Storage-free viewer. No IndexedDB, localStorage, service worker, uploads,', '/* Derived viewer: authentication and GET-only requests retained. Local cache is a separate layer. No uploads,',1)
write('drive-local-base.js',s)
# The two adapters continue to render the same data, including all five color roles.
for app in ['plants','colors']:
    adapter=read(app+'/readonly-adapter.js')
    adapter=adapter.replace('端末保存・Driveへの書込みは行いません。','取得した写真・文字は端末に保存します。Driveへの書込みは行いません。')
    adapter=adapter.replace('この画面では端末保存・Driveへの書込みを行いません。','保存済み写真・文字は再接続なしで表示します。Driveへの書込みは行いません。')
    adapter=adapter.replace('写真はカードを開くと取得します。','写真は保存済みを優先し、未保存のものだけ取得します。')
    adapter=adapter.replace('写真は表示する欄から取得・SHA照合します。','未保存の写真だけ、表示する欄から取得・SHA照合して端末保存します。')
    adapter=adapter.replace('Driveから色名・写真を再取得','色名・写真の変更分を同期')
    write(app+'/local-adapter.js',adapter)
p=read('plants/drive-view.html')
p=one(p,'<script src="../drive-readonly.js?v=1"></script>', '<script src="../drive-view-cache.js?v=1"></script>\n<script src="../drive-local-base.js?v=1"></script>\n<script src="../drive-local-view.js?v=1"></script>')
p=one(p,'./readonly-adapter.js?v=1','./local-adapter.js?v=1')
p=p.replace('植物・保存不要の閲覧版','植物・端末保存の閲覧版')
p=one(p,'</body>','<script src="../view-shell.js?v=1"></script>\n</body>')
write('plants/drive-view.html',p)
l=read('colors/data/review47-view-loader.js')
l=one(l,"'../drive-readonly.js?v=1'", "'../drive-view-cache.js?v=1','../drive-local-base.js?v=1','../drive-local-view.js?v=1'")
l=one(l,"'./readonly-adapter.js?v=1'", "'./local-adapter.js?v=1'")
l=one(l,"'../readonly-guard.js?v=1'", "'../readonly-guard.js?v=1','../view-shell.js?v=1'")
write('colors/data/review47-local-loader.js',l)
p=read('colors/drive-view.html')
p=one(p,'data/review47-view-loader.js?v=palette1','data/review47-local-loader.js?v=1')
p=p.replace('色名・保存不要の閲覧版','色名・端末保存の閲覧版')
write('colors/drive-view.html',p)
shared=['../drive-config.js?v=3','../persistent-drive-auth.js?v=1','../drive-core.js?v=readonly1','../drive-view-cache.js?v=1','../drive-local-base.js?v=1','../drive-local-view.js?v=1','../readonly-guard.js?v=1','../view-shell.js?v=1']
assets={
 'plants':['./drive-view.html','./local-adapter.js?v=1','../drive-core.js?v=plant-network2']+shared,
 'colors':['./drive-view.html','./data/review47-local-loader.js?v=1','./data/review47-progress.b64?v=1','./network-support.js?v=2','./app-view.js?v=palette1','./origin-editor-view.js?v=1','./local-adapter.js?v=1','./nav-top.js?v=1','./private-assets-manifest.json?v=2']+shared,
}
worker=read('view-shell-worker.js')
for app,paths in assets.items():
    write(app+'/drive-view-worker.js','const APP='+json.dumps(app)+';\nconst ASSETS='+json.dumps(list(dict.fromkeys(paths)))+';\n'+worker)
after={p:sha(p) for p in protected}
if before!=after:raise RuntimeError('An ordinary editor or protected dataset changed')
write('local-view-build.json',json.dumps({'schema':'local-photo-view-build-v1','protected_sha256':after,'apps':['plants/drive-view.html','colors/drive-view.html'],'authentication_changed':False,'drive_writes_added':False},indent=2)+'\n')
print('Local-first viewers built; ordinary apps, original data and OAuth flow unchanged.')
