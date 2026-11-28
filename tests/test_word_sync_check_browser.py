"""Mobile browser checks for the isolated, local-only word preservation page.

All data is synthetic. The served files come from the current working directory
(the exact Pages deployment tree in CI), or WORD_SYNC_CHECK_ROOT when supplied.
External requests and writes to the original app's stores are blocked and audited.
"""
import base64
import hashlib
import json
import mimetypes
import os
import shutil
import unittest
from pathlib import Path
from urllib.parse import unquote, urlsplit

from playwright.sync_api import sync_playwright


ROOT = Path(os.environ.get("WORD_SYNC_CHECK_ROOT", os.getcwd())).resolve()
ORIGIN = "http://127.0.0.1:8765"
ENTRY = "/flashcards/word-sync-check/"
SOURCE_DB = "flashcards_drive_cache_v3"
BACKUP_DB = "word_sync_safety_backups_v1"
PRIVATE_MARKERS = (
    "PRIVATE_WORD_", "PRIVATE_MEANING_", "synthetic-access-secret",
    "synthetic-refresh-secret", "private-fixture@example.invalid",
    "private-drive-account-fixture",
)

SEED = r"""async ({missingImage=false, existingCache=true}) => {
  const cards=Array.from({length:105},(_,i)=>({
    id:'fixture-word-'+i, word:'PRIVATE_WORD_'+i,
    meaning:'PRIVATE_MEANING_'+i, sort_order:i, updated_at:null, images:[]
  }));
  const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9sAAAAASUVORK5CYII='),x=>x.charCodeAt(0));
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',png))]
    .map(x=>x.toString(16).padStart(2,'0')).join('');
  // The normal image reader first checks the local hash even for a Drive ref.
  // Exercise that real cache layout without downloading the image again.
  cards[0].images=[{ref:'gdrive:fixture-cached-image:'+hash,type:'image/png',name:'fixture.png'}];
  if(missingImage)cards[104].images=[{
    ref:'gdrive:unavailable-fixture-image:'+'b'.repeat(64),
    type:'image/png',name:'missing-fixture.png'
  }];
  localStorage.setItem('simple_vocab_cards_v1',JSON.stringify(cards));
  localStorage.setItem('word_drive_primary_v1','1');
  localStorage.setItem('flashcards_drive_device_v3','fixture-device');
  localStorage.setItem('flashcards_supabase_session_v1',JSON.stringify({
    access_token:'synthetic-access-secret',refresh_token:'synthetic-refresh-secret',
    expires_at:Date.now()+3600000,
    user:{id:'fixture-user',email:'private-fixture@example.invalid'}
  }));
  localStorage.setItem('word_gdrive_meta_v2',JSON.stringify({
    updated:{'fixture-word-0':'2026-11-28T00:00:00Z'},deleted:{}
  }));
  const pendingDelete={id:'preserve-existing-intent',key:'card:fixture-word-104',
    value:null,deleted:true,parents:[],clock:300,device_id:'fixture-device',
    updated_at:'2026-11-28T00:00:00Z'};
  localStorage.setItem('flashcards_drive_delete_intent_v1:word-flashcards:fixture',
    JSON.stringify({schema:'synthetic-preserved-intent',event:pendingDelete}));
  if(!existingCache)return;
  const db=await new Promise((resolve,reject)=>{
    const r=indexedDB.open('flashcards_drive_cache_v3',1);
    r.onupgradeneeded=()=>{r.result.createObjectStore('states');r.result.createObjectStore('blobs')};
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
  const events={};
  for(let i=0;i<75;i++){
    const id='fixture-live-'+i;
    events[id]={id,key:'card:fixture-word-'+i,value:cards[i],deleted:false,
      parents:[],clock:i+1,device_id:'fixture-device',updated_at:null};
  }
  for(let i=75;i<78;i++){
    const id='fixture-deleted-'+i;
    events[id]={id,key:'card:fixture-word-'+i,value:null,deleted:true,
      parents:[],clock:i+1,device_id:'fixture-device',updated_at:null};
  }
  const state={events,pending:[],seen:{'fixture-journal':'fixture-checksum'},
    imports:{},account:'private-drive-account-fixture',clock:78,initialized:true,
    snapshot:Object.fromEntries(cards.slice(0,75).map(c=>['card:'+c.id,c])),
    basis:Object.fromEntries(Object.values(events).map(e=>[e.key,[e.id]]))};
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(['states','blobs'],'readwrite');
    tx.objectStore('states').put(state,'word-flashcards');
    tx.objectStore('states').put({keep:'unrelated-app-state'},'other-app');
    tx.objectStore('blobs').put(new Blob([png],{type:'image/png'}),'word-image:'+hash);
    tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error);
  });
  db.close();
}"""

READ_SOURCE = r"""async () => {
  const storage=Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)]);
  const databases=await indexedDB.databases();
  if(!databases.some(x=>x.name==='flashcards_drive_cache_v3'))
    return {storage,states:null,blobs:null};
  const db=await new Promise((resolve,reject)=>{
    const r=indexedDB.open('flashcards_drive_cache_v3');
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
  const rows=await Promise.all(['states','blobs'].map(name=>new Promise((resolve,reject)=>{
    const tx=db.transaction(name,'readonly'),s=tx.objectStore(name);
    const keys=s.getAllKeys(),values=s.getAll();
    tx.oncomplete=()=>resolve(keys.result.map((k,i)=>[k,values.result[i]]));
    tx.onerror=tx.onabort=()=>reject(tx.error);
  })));
  db.close();
  const blobs=await Promise.all(rows[1].map(async([key,value])=>
    [key,value instanceof Blob?{type:value.type,bytes:[...new Uint8Array(await value.arrayBuffer())]}:value]));
  return {storage,states:rows[0],blobs};
}"""

TRAPS = r"""(() => {
  const faults=__FAULTS__;
  const audit={storageWrites:[],sourceWrites:[],network:[],backupWrites:[]};
  Object.defineProperty(window,'__syncCheckAudit',{value:audit});
  const reject=(group,label)=>{
    audit[group].push(label);throw new Error('Synthetic forbidden side effect: '+label);
  };
  for(const name of ['setItem','removeItem','clear']){
    Storage.prototype[name]=function(){return reject('storageWrites',name)};
  }
  const transaction=IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction=function(stores,mode,...args){
    if(this.name==='flashcards_drive_cache_v3'&&mode&&mode!=='readonly')
      return reject('sourceWrites','transaction:'+mode);
    if(this.name==='word_sync_safety_backups_v1'&&mode==='readwrite'){
      audit.backupWrites.push(Array.isArray(stores)?stores.join(','):String(stores));
      if(faults.backupQuota)throw new DOMException('Synthetic backup capacity failure','QuotaExceededError');
    }
    return transaction.call(this,stores,mode,...args);
  };
  for(const name of ['add','put','delete','clear']){
    const original=IDBObjectStore.prototype[name];
    IDBObjectStore.prototype[name]=function(...args){
      if(this.transaction.db.name==='flashcards_drive_cache_v3')
        return reject('sourceWrites','objectStore:'+name);
      return original.apply(this,args);
    };
  }
  for(const name of ['createObjectStore','deleteObjectStore']){
    const original=IDBDatabase.prototype[name];
    IDBDatabase.prototype[name]=function(...args){
      if(this.name==='flashcards_drive_cache_v3')return reject('sourceWrites',name);
      return original.apply(this,args);
    };
  }
  const open=IDBFactory.prototype.open,drop=IDBFactory.prototype.deleteDatabase;
  IDBFactory.prototype.open=function(name,version){
    if(name==='flashcards_drive_cache_v3'&&version&&version>1)
      return reject('sourceWrites','upgrade:'+version);
    return version===undefined?open.call(this,name):open.call(this,name,version);
  };
  IDBFactory.prototype.deleteDatabase=function(name){
    if(name==='flashcards_drive_cache_v3')return reject('sourceWrites','deleteDatabase');
    return drop.call(this,name);
  };
  window.fetch=(...args)=>{audit.network.push('fetch:'+String(args[0]));return Promise.reject(new Error('Synthetic network block'))};
  XMLHttpRequest.prototype.open=function(method,url){return reject('network','xhr:'+url)};
  navigator.sendBeacon=url=>{audit.network.push('beacon:'+url);return false};
  window.WebSocket=function(url){return reject('network','websocket:'+url)};
  window.EventSource=function(url){return reject('network','eventsource:'+url)};
  if(navigator.serviceWorker)navigator.serviceWorker.register=url=>{
    audit.network.push('serviceworker:'+url);return Promise.reject(new Error('Synthetic service worker block'));
  };
})();"""


class WordSyncCheckBrowserTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        launch = {"headless": True, "args": ["--no-sandbox"]}
        chrome = shutil.which("google-chrome") or shutil.which("chromium")
        if chrome:
            launch["executable_path"] = chrome
        cls.browser = cls.playwright.chromium.launch(**launch)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(
            viewport={"width": 390, "height": 844}, device_scale_factor=1,
            is_mobile=True, has_touch=True, accept_downloads=True,
            service_workers="block",
        )
        self.unexpected_requests = []
        self.safety_mode = "normal"
        self.held_routes = []
        self.context.route("**/*", self.serve)
        self.page = self.context.new_page()
        self.page.set_default_timeout(10000)

    def tearDown(self):
        for route in self.held_routes:
            try:
                route.abort()
            except Exception:
                pass
        self.context.close()

    def serve(self, route):
        request = route.request
        url = urlsplit(request.url)
        if request.url == ORIGIN + ENTRY + "__seed__.html":
            route.fulfill(status=200, content_type="text/html", body="<!doctype html><title>Synthetic fixture</title>")
            return
        if request.url == ORIGIN + "/favicon.ico":
            route.fulfill(status=204, body="")
            return
        if url.scheme + "://" + url.netloc != ORIGIN or not url.path.startswith(ENTRY) or request.method != "GET":
            self.unexpected_requests.append(request.url)
            route.abort()
            return
        relative = unquote(url.path[len("/flashcards/"):])
        if relative.endswith("/"):
            relative += "index.html"
        source = (ROOT / relative).resolve()
        if not source.is_relative_to(ROOT / "word-sync-check") or not source.is_file():
            self.unexpected_requests.append(request.url)
            route.abort()
            return
        if source.name == "safety.js" and self.safety_mode != "normal":
            if self.safety_mode == "hold":
                self.held_routes.append(route)
            else:
                route.abort()
            return
        route.fulfill(status=200, content_type=mimetypes.guess_type(str(source))[0] or "application/octet-stream", body=source.read_bytes())

    def seed_and_open(self, *, missing_image=False, existing_cache=True, backup_quota=False):
        self.page.goto(ORIGIN + ENTRY + "__seed__.html")
        self.page.evaluate(SEED, {"missingImage": missing_image, "existingCache": existing_cache})
        self.baseline = self.page.evaluate(READ_SOURCE)
        self.context.add_init_script(TRAPS.replace("__FAULTS__", json.dumps({"backupQuota": backup_quota})))
        self.page.goto(ORIGIN + ENTRY, wait_until="commit")
        self.page.locator("h1").wait_for(state="visible")

    def assert_sources_untouched(self):
        self.assertEqual(self.page.evaluate(READ_SOURCE), self.baseline)
        audit = self.page.evaluate("__syncCheckAudit")
        self.assertEqual(audit["storageWrites"], [], "the page must not rewrite any existing local/session storage")
        self.assertEqual(audit["sourceWrites"], [], "the original card, history and image stores must stay read-only")
        self.assertEqual(audit["network"], [], "no cloud, authentication or auto-sync request is allowed")
        self.assertEqual(self.unexpected_requests, [], "only the isolated page's own static assets may load")
        self.assertTrue(self.page.evaluate("!window.WordDriveSync&&!window.PersistentDriveAuth&&!window.FlashcardsDrive"))

    def assert_in_mobile_view(self, selector):
        element = self.page.locator(selector)
        self.assertTrue(element.is_visible(), selector + " must remain visible")
        box = element.bounding_box()
        self.assertIsNotNone(box)
        self.assertGreaterEqual(box["x"], 0)
        self.assertLessEqual(box["x"] + box["width"], 391)
        self.assertGreaterEqual(box["y"], 0)
        self.assertLessEqual(box["y"] + box["height"], 845)

    def wait_for_backup(self):
        self.page.wait_for_function("!document.getElementById('downloadBackup').disabled&&!document.getElementById('retryCheck').disabled")
        self.assertEqual(self.page.locator("#localCount").inner_text(), "105")

    def assert_private_diagnostics_absent(self):
        text = self.page.locator("body").inner_text()
        for marker in PRIVATE_MARKERS:
            self.assertNotIn(marker, text, "the diagnostic UI must not expose card text or credentials")

    def download_backup(self):
        self.page.locator("#downloadBackup").click()
        self.page.wait_for_function("document.getElementById('downloadBackup').textContent==='ファイルを保存'&&!document.getElementById('downloadBackup').disabled")
        with self.page.expect_download() as completed:
            self.page.locator("#downloadBackup").click()
        download = completed.value
        self.assertTrue(download.suggested_filename.endswith("-105cards.json"))
        text = Path(download.path()).read_text(encoding="utf-8")
        for marker in PRIVATE_MARKERS[2:]:
            self.assertNotIn(marker, text, "the portable backup must exclude authentication and the raw account ID")
        exported = json.loads(text)
        self.assertEqual(exported["schema"], "word-sync-safety-export-v1")
        self.assertTrue(exported["verified"])
        original = dict(self.baseline["storage"])["simple_vocab_cards_v1"]
        self.assertEqual(exported["snapshot"]["originalRaw"], original)
        self.assertEqual(exported["snapshot"]["cardIds"], ["fixture-word-" + str(i) for i in range(105)])
        self.assertEqual(len(json.loads(exported["snapshot"]["originalRaw"])), 105)
        return exported

    def test_mobile_preservation_diagnostics_and_download_leave_sources_unchanged(self):
        self.seed_and_open()
        self.wait_for_backup()
        self.assertEqual(self.page.locator("h1").inner_text(), "単語帳の保全と同期確認")
        self.assertEqual(self.page.locator("#backupStatus").get_attribute("data-kind"), "success")
        for selector in ("h1", "#startupNotice", "#localCount", "#backupStatus", "#downloadBackup"):
            self.assert_in_mobile_view(selector)
        self.assertIn("105件", self.page.locator("#backupStatus").inner_text())
        self.assertIn("保全しました", self.page.locator("#backupStatus").inner_text())
        self.assertIn("保存済みの同期情報を読み取りました", self.page.locator("#diagnosticStatus").inner_text())
        details = self.page.locator("#diagnosticDetails").inner_text()
        for line in (
            "端末の単語数：105件", "単語IDの重複：0件", "単語IDなし：0件",
            "取得済みDrive履歴：75件（この端末のキャッシュ）", "取得済み削除履歴：3件",
            "保存済みの送信待ち：0件", "保存済み履歴にない単語ID：27件",
            "削除履歴と重なる端末の単語：3件", "端末の画像参照：1枚",
            "読み取れた画像本体：1枚", "未取得・未確認の画像：0枚",
            "ログイン情報の保存：あり（現在の接続は未確認）",
        ):
            self.assertIn(line, details)
        fingerprint = hashlib.sha256(b"private-drive-account-fixture").hexdigest()[:12]
        self.assertIn("接続先の照合用番号（保存済み）：" + fingerprint, details)
        self.assert_private_diagnostics_absent()
        self.page.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedDiagnostic=text}}})")
        self.page.locator("#copyReport").click()
        self.assertEqual(self.page.evaluate("window.__copiedDiagnostic"), details)
        exported = self.download_backup()
        self.assertTrue(exported["complete"])
        self.assertEqual(len(exported["assets"]), 1)
        asset = exported["assets"][0]
        self.assertEqual(asset["type"], "image/png")
        self.assertEqual(list(base64.b64decode(asset["data"].split(",", 1)[1])), self.baseline["blobs"][0][1]["bytes"])
        self.page.evaluate("window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'))")
        self.assert_sources_untouched()
        self.assertGreater(len(self.page.evaluate("__syncCheckAudit.backupWrites")), 0)

    def test_mobile_loading_and_script_failure_keep_heading_count_and_controls_visible(self):
        self.safety_mode = "hold"
        self.seed_and_open()
        self.page.wait_for_function("document.getElementById('localCount').textContent==='105'")
        for selector in ("h1", "#startupNotice", "#localCount", "#backupStatus", "#downloadBackup"):
            self.assert_in_mobile_view(selector)
        self.assertTrue(self.page.locator("#downloadBackup").is_disabled())
        self.assertIn("保存内容を確認", self.page.locator("#backupStatus").inner_text())
        self.assertEqual(len(self.held_routes), 1)
        for route in self.held_routes:
            route.abort()
        self.held_routes = []
        self.page.wait_for_function("document.getElementById('startupNotice').dataset.kind==='error'&&!document.getElementById('retryCheck').disabled")
        self.assertEqual(self.page.locator("#localCount").inner_text(), "105")
        self.assertTrue(self.page.locator("#downloadBackup").is_disabled())
        self.assertEqual(self.page.locator("#backupStatus").get_attribute("data-kind"), "error")
        self.assertIn("未完了", self.page.locator("#diagnosticDetails").inner_text())
        for selector in ("h1", "#startupNotice", "#localCount", "#backupStatus", "#downloadBackup"):
            self.assert_in_mobile_view(selector)
        self.assert_private_diagnostics_absent()
        self.assert_sources_untouched()

    def test_mobile_backup_capacity_failure_does_not_claim_success_or_mutate_sources(self):
        self.seed_and_open(backup_quota=True)
        self.page.wait_for_function("document.getElementById('startupNotice').dataset.kind==='error'&&!document.getElementById('retryCheck').disabled")
        self.assertEqual(self.page.locator("#localCount").inner_text(), "105")
        self.assertEqual(self.page.locator("#backupStatus").get_attribute("data-kind"), "error")
        self.assertNotIn("保全しました", self.page.locator("#backupStatus").inner_text())
        self.assertTrue(self.page.locator("#downloadBackup").is_disabled())
        for selector in ("h1", "#startupNotice", "#backupStatus", "#downloadBackup"):
            self.assert_in_mobile_view(selector)
        self.assert_private_diagnostics_absent()
        self.assert_sources_untouched()

    def test_mobile_missing_image_is_reported_as_an_incomplete_backup(self):
        self.seed_and_open(missing_image=True)
        self.wait_for_backup()
        self.assertEqual(self.page.locator("#backupStatus").get_attribute("data-kind"), "warning")
        self.assertIn("完全な画像バックアップではありません", self.page.locator("#backupStatus").inner_text())
        self.assert_in_mobile_view("#backupStatus")
        self.assert_in_mobile_view("#downloadBackup")
        details = self.page.locator("#diagnosticDetails").inner_text()
        self.assertIn("端末の画像参照：2枚", details)
        self.assertIn("読み取れた画像本体：1枚", details)
        self.assertIn("未取得・未確認の画像：1枚", details)
        exported = self.download_backup()
        self.assertFalse(exported["complete"])
        self.assertEqual(exported["snapshot"]["summary"]["missingImageCount"], 1)
        self.assertEqual(len(exported["assets"]), 1)
        self.assert_private_diagnostics_absent()
        self.assert_sources_untouched()

    def test_absent_original_database_is_not_created_and_history_is_not_guessed(self):
        self.seed_and_open(existing_cache=False)
        self.wait_for_backup()
        self.assertEqual(self.page.locator("#backupStatus").get_attribute("data-kind"), "warning")
        details = self.page.locator("#diagnosticDetails").inner_text()
        for line in ("取得済みDrive履歴：未確認", "取得済み削除履歴：未確認", "保存済みの送信待ち：未確認", "未取得・未確認の画像：1枚"):
            self.assertIn(line, details)
        self.assertNotIn("取得済みDrive履歴：0件", details)
        self.assert_in_mobile_view("#localCount")
        self.assert_in_mobile_view("#downloadBackup")
        self.assert_private_diagnostics_absent()
        self.assert_sources_untouched()


if __name__ == "__main__":
    unittest.main()
