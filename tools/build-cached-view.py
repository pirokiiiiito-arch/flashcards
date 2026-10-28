"""Run last, after palette restoration. Upgrade only the mobile viewing pages.
Existing editor data and Google authorization code remain byte-identical.
"""
from pathlib import Path
import hashlib
import json
ROOT=Path(__file__).resolve().parents[1]
def read(p):return (ROOT/p).read_text(encoding='utf-8')
def write(p,s):(ROOT/p).write_text(s,encoding='utf-8')
def one(s,a,b):
    if s.count(a)!=1:raise RuntimeError('Cached viewer anchor changed: '+a[:100])
    return s.replace(a,b,1)
def sha(p):return hashlib.sha256((ROOT/p).read_bytes()).hexdigest()
protected=['drive-core.js','drive-sync.js','drive-readonly.js','index.html','word-network-recovery.js','plants/index.html','plants/drive-sync.js','colors/index.html','colors/app-main.js','colors/drive-sync.js','colors/origin-editor.js','colors/data/review47-progress.b64','colors/private-assets-manifest.json','colors/app-view.js','readonly-guard.js']
before={p:sha(p) for p in protected}
s=read('drive-readonly.js')
s=one(s,'function createTransport({namespace,core,fetcher=root.fetch.bind(root),onStatus=()=>{}}){','function createNetworkTransport({namespace,core,fetcher=root.fetch.bind(root),onStatus=()=>{}}){')
s=one(s,'  function install(cfg){','  function createTransport(options){return root.DriveLocalView.wrap(createNetworkTransport,{...options,boundedBlob});}\n  function install(cfg){')
s=one(s,"title.textContent='保存不要のDrive閲覧モード'","title.textContent='端末保存・差分同期版'")
s=one(s,'写真・文字をDriveから直接受信します。端末キャッシュを保存せず、PC・Driveのデータも変更しません。この画面では編集できません。','取得した写真・文字をこの端末に保存します。次回は保存済みを表示し、変更された履歴と未取得写真だけを受信します。認証が切れても保存済み写真は消しません。閲覧専用です。')
s=one(s,"connect.textContent='接続して表示'","connect.textContent='接続して差分同期'")
s=one(s,"refresh.textContent='Driveから再取得'","refresh.textContent='変更分を同期'")
s=one(s,'        await cfg.ready;\n        const result=await transport.sync();','        await cfg.ready;await initialRead;\n        const result=await transport.sync();')
s=one(s,"if(transport.valid())transport.setStatus('受信済み',cfg.summary?.(result)||'文字・画像の参照を受信しました。写真は表示する欄から取得します。');","if(transport.valid())transport.setStatus('差分同期済み',(cfg.summary?.(result)||'変更を反映しました。')+'\\n履歴：新規取得 '+result.delta.downloaded+'件 ／ 保存済み再利用 '+result.delta.reused+'件');")
s=one(s,"transport.setStatus('未接続','「接続して表示」を押してください。');","transport.setStatus('未接続','更新を受信するときは「接続して差分同期」を押してください。保存済み写真は表示できます。');")
s=one(s,'    prepare();return api;',"""    const initialRead=(async()=>{
      await cfg.ready;const saved=await transport.hydrate();
      if(saved){await cfg.apply(saved,api);transport.setStatus('保存済みを表示中',(cfg.summary?.(saved)||'保存済みの写真・文字を表示しています。')+'\\n前回取得：'+saved.saved_at);}
    })().catch(e=>transport.setStatus('保存データ確認',e.message||String(e)));
    prepare();return api;""")
# The original network authorization and OAuth callback must not be rewritten.
original=read('drive-readonly.js')
for start,end in [('    function authorize(value,seconds){','    async function request(url){'),('    async function prepare(){','    function open(){')]:
    a=original[original.index(start):original.index(end,original.index(start))]
    if a not in s:raise RuntimeError('Authorization code changed')
write('drive-cached.js',s)
p=read('plants/readonly-adapter.js')
p=one(p,'閲覧専用です。端末保存・Driveへの書込みは行いません。','閲覧専用です。取得済み写真・文字を端末に保存します。Driveへの書込みは行いません。')
p=one(p,'写真はカードを開くと取得します。取得エラーは写真欄に表示します。','写真は端末保存分を優先表示します。未取得分だけDriveから取得します。')
write('plants/cached-adapter.js',p)
p=read('colors/readonly-adapter.js')
p=one(p,'この画面では端末保存・Driveへの書込みを行いません。','取得済み写真・文字を端末に保存します。Driveへの書込みは行いません。')
p=one(p,"button.textContent='Driveから色名・写真を再取得'","button.textContent='色名・写真の変更分を同期'")
write('colors/cached-adapter.js',p)
register="<script>if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js',{updateViaCache:'none'}).then(r=>r.update()).catch(()=>{}));</script>"
p=read('plants/drive-view.html')
p=one(p,'<script src="../drive-readonly.js?v=1"></script>','<script src="../drive-view-cache.js?v=1"></script>\n<script src="../drive-local-view.js?v=1"></script>\n<script src="../drive-cached.js?v=1"></script>')
p=one(p,'./readonly-adapter.js?v=1','./cached-adapter.js?v=1')
p=p.replace('植物・保存不要の閲覧版','植物・端末保存と差分同期')
p=one(p,'</body>',register+'\n</body>');write('plants/drive-view.html',p)
l=read('colors/data/review47-view-loader.js')
l=one(l,"'../drive-readonly.js?v=1'","'../drive-view-cache.js?v=1','../drive-local-view.js?v=1','../drive-cached.js?v=1'")
l=one(l,"'./readonly-adapter.js?v=1'","'./cached-adapter.js?v=1'")
write('colors/data/review47-cached-loader.js',l)
p=read('colors/drive-view.html')
p=one(p,'data/review47-view-loader.js?v=palette1','data/review47-cached-loader.js?v=1')
p=p.replace('色名・保存不要の閲覧版','色名・端末保存と差分同期')
p=one(p,'</body>',register+'\n</body>');write('colors/drive-view.html',p)
common=['../drive-view-cache.js?v=1','../drive-local-view.js?v=1','../drive-cached.js?v=1','../readonly-guard.js?v=1']
for app in ['plants','colors']:
    path=app+'/service-worker.js';s=read(path)
    old='plant-flashcards-v31-network2' if app=='plants' else 'colors1000-review47-drive3-palette1'
    s=one(s,old,old+'-localcache1')
    resources=['./drive-view.html','./cached-adapter.js?v=1']+common
    if app=='colors':resources+=['./data/review47-cached-loader.js?v=1','./app-view.js?v=palette1','./origin-editor-view.js?v=1','../drive-core.js?v=readonly1']
    s=one(s,'const STATIC = [','const STATIC = ['+', '.join(repr(x) for x in resources)+', ')
    s=one(s,r'drive-(core|config)',r'(?:drive-(?:core|config|view-cache|local-view|cached)|readonly-guard)')
    s=s.replace('await c.put(r, response.clone());','await c.put(r, response.clone()).catch(() => {});')
    s=one(s,'await c.match(r) ||',"await c.match(r, {ignoreSearch:r.mode==='navigate'}) ||")
    write(path,s)
if {p:sha(p) for p in protected}!=before:raise RuntimeError('An existing editor or protected dataset changed')
write('cached-view-build.json',json.dumps({'schema':'flashcards-cached-view-build-v1','protected_sha256':before,'drive_write_operations':False,'tokens_persisted':False,'authorization_unchanged':True,'palette_preserved':True},indent=2)+'\n')
print('Persistent mobile viewing built. Google authorization, PC editors, word app, research and palette data unchanged.')
