"""Run after all existing builds. Word presentation only; retain existing URLs,
local data keys, network recovery, automatic sync timing, and Drive protocol.
"""
from pathlib import Path
import hashlib,json
R=Path(__file__).resolve().parents[1]
def read(p):return (R/p).read_text(encoding='utf-8')
def write(p,s):(R/p).write_text(s,encoding='utf-8')
def one(s,a,b):
    if s.count(a)!=1:raise RuntimeError('Quiet-word anchor changed: '+a[:120])
    return s.replace(a,b,1)
def sha(p):return hashlib.sha256((R/p).read_bytes()).hexdigest()
protected=['drive-core.js','drive-local-view.js','drive-view-cache.js','drive-readonly.js','drive-config.js','word-network-recovery.js']+[str(p.relative_to(R)) for app in ['plants','colors'] for p in (R/app).rglob('*') if p.is_file()]
before={p:sha(p) for p in protected}
s=read('drive-sync.js')
a=s.index('    apply: list => {');b=s.index('    afterSync:',a)
s=s[:a]+'''    apply: list => {
      if(editing)throw Error('編集中の内容は保持しています。保存後に変更分を反映します。');
      const Q=window.WordQuietSync, plan=Q.plan(cards,list,{order,pos,shuffled:isShuffled});
      if(!plan)return; // Identical data must not replace the card DOM or write local data.
      const viewport=Q.capture(stage),previous=cards;
      cards=list;
      try{saveCards();}catch(e){cards=previous;throw e;}
      order=plan.order;pos=plan.pos;isShuffled=plan.shuffled;
      if(plan.redraw){
        render();
        if(plan.sameCard&&viewport.back)stage.querySelector('.card')?.classList.add('show-back');
      }else{
        const number=stage.querySelector('.card-number');
        if(number)number.textContent=(pos+1)+' / '+cards.length;
        updateNav();updateMode();
      }
      updateSyncUI();Q.refresh();Q.restore(stage,viewport,plan.redraw,plan.sameCard);
    },
''' +s[b:]
s=one(s,'  const sync = F.install(cfg); window.WordDriveSync = sync;', '''  const reportStatus=cfg.onStatus;
  cfg.onStatus=(status,message)=>{reportStatus(status,message);window.WordQuietSync.refresh(status,message);};
  const sync = F.install(cfg); window.WordDriveSync = sync;
  window.WordQuietSync.attach(sync,()=>cards.length);''')
s=one(s,"const p = document.createElement('p'); p.setAttribute('role','alert'); p.textContent = '件数表示", "const p = document.createElement('p'); p.id='wordRecoveryLoadError'; p.setAttribute('role','alert'); p.textContent = '件数表示")
s=s.replace('20261028-network2','20261028-quiet1')
write('drive-sync.js',s)
s=read('word-recovery.js')
s=one(s,"const output = document.createElement('p'); output.setAttribute('role','status');", "const output = document.createElement('p'); output.id='wordRecoveryResult'; output.setAttribute('role','status');")
s=one(s,'  function refresh() {','  function refreshDetails() {')
s=one(s,'  root.WordDriveRecovery = Object.freeze({refresh, ...tools});', '''  function refresh(){refreshDetails();root.WordQuietSync?.refresh();}
  root.WordDriveRecovery = Object.freeze({refresh, ...tools});''')
write('word-recovery.js',s)
css='''
/* Stable reading layout: detailed progress belongs in a user-opened dialog. */
.topbar > #wordNetworkBuild,.topbar > #wordNetworkSync,.topbar > #wordRecoverMissing,
.topbar > #wordDriveDataStatus,.topbar > #wordNetworkProgress,.topbar > #wordRecoveryResult,
.topbar > #wordRecoveryLoadError{display:none!important}
#wordQuietStatus{display:flex;align-items:center;gap:8px;width:100%;height:44px;min-height:44px;max-height:44px;overflow:hidden;font-size:13px;color:var(--muted)}
#wordQuietStatus > span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#wordQuietStatus > button{flex:0 0 104px;width:104px;height:38px;padding:6px;border-radius:10px;font-size:13px;white-space:nowrap}
#wordQuietStatus .word-sync-error{color:#a31b1b;font-weight:700}
#countText{white-space:nowrap}
#wordQuietDetails{width:min(620px,92vw);max-height:85vh;overflow:auto;box-sizing:border-box;border:1px solid var(--border);border-radius:16px;padding:20px;color:var(--text)}
#wordQuietDetails::backdrop{background:rgba(20,28,40,.35)}
#wordQuietDetails h2{font-size:22px;margin:0 0 12px}
#wordQuietDetails p{line-height:1.65;overflow-wrap:anywhere}
.word-sync-tools{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.word-sync-tools p{width:100%;margin:8px 0}
'''
for path in ['index.html','word-sync-v2.html']:
    s=read(path)
    s=one(s,'</head>','<meta name="word-quiet-sync" content="quiet1">\n<style id="wordQuietStyle">'+css+'</style>\n</head>')
    s=s.replace('20261028-network2','20261028-quiet1')
    s=one(s,'<script src="./drive-sync.js?v=20261028-quiet1"></script>','<script src="./word-quiet-sync.js?v=20261028-quiet1"></script>\n<script src="./drive-sync.js?v=20261028-quiet1"></script>')
    write(path,s)
s=read('service-worker.js')
s=one(s,"const CACHE = 'flashcards-v18-private-cache-safe';","const CACHE = 'flashcards-v19-quiet-word-sync';")
s=one(s,"const BUILD = '20261028-network2';","const BUILD = '20261028-quiet1';")
s=one(s,"'./word-sync-v2.html',","'./word-sync-v2.html', './word-quiet-sync.js?v=' + BUILD,")
write('service-worker.js',s)
after={p:sha(p) for p in protected}
if before!=after:raise RuntimeError('Protected data, authentication, or another app changed')
write('word-quiet-build.json',json.dumps({'schema':'word-quiet-build-v1','urls':['index.html','word-sync-v2.html'],'unchanged':after,'data_migration':False,'automatic_sync_delay_changed':False},indent=2)+'\n')
print('Word sync now preserves unchanged DOM and keeps diagnostics outside the reading layout.')
