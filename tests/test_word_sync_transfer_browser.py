"""Real mobile transfer UI with synthetic auth/Drive HTTP responses only.

The production origin is intercepted inside a fresh browser context. No real
account, network service, or user data is used. Cards and original image bytes
remain write-protected, including after the explicit synchronization action.
"""
import hashlib
import json
import mimetypes
import os
import re
import shutil
import unittest
from email import policy
from email.parser import BytesParser
from pathlib import Path
from urllib.parse import unquote, urlsplit, parse_qs

from playwright.sync_api import sync_playwright
from test_word_sync_check_browser import READ_SOURCE, PRIVATE_MARKERS


ROOT = Path(os.environ.get("WORD_SYNC_CHECK_ROOT", os.getcwd())).resolve()
ORIGIN = "https://pirokiiiiito-arch.github.io"
ENTRY = "/flashcards/word-sync-check/"
ACCOUNT = "private-drive-account-fixture"
AUTH_ORIGIN = "https://himtyybslzzwsfmgdivx.supabase.co"
DRIVE_ORIGIN = "https://www.googleapis.com"

SEED_TRANSFER = r"""async () => {
  const cards=Array.from({length:105},(_,i)=>({id:'fixture-word-'+i,
    word:'PRIVATE_WORD_'+i,meaning:'PRIVATE_MEANING_'+i,
    sort_order:i,updated_at:null,images:[]}));
  const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9sAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
  const blobs=[];
  for(let i=58;i<105;i++){
    const bytes=new Uint8Array(png.length+1);bytes.set(png);bytes[png.length]=i;
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
      .map(x=>x.toString(16).padStart(2,'0')).join('');
    cards[i].images=[{ref:'local:'+hash,type:'image/png',name:'fixture-'+i+'.png'}];
    blobs.push(['word-image:'+hash,new Blob([bytes],{type:'image/png'})]);
  }
  const events={},remoteEvents=[],pending=[];
  for(let i=0;i<75;i++){
    const id='fixture-base-'+i,value={...cards[i],images:[]};
    const event={id,key:'card:'+cards[i].id,value,deleted:false,parents:[],
      clock:i+1,device_id:'fixture-device',updated_at:'2026-11-28T00:00:00Z'};
    events[id]=event;remoteEvents.push(event);
  }
  for(let i=58;i<105;i++){
    const id='fixture-pending-'+i;
    events[id]={id,key:'card:'+cards[i].id,value:cards[i],deleted:false,
      parents:i<75?['fixture-base-'+i]:[],clock:100+i,device_id:'fixture-device',
      updated_at:'2026-11-28T00:00:01Z'};
    pending.push(id);
  }
  for(let i=0;i<3;i++){
    const id='fixture-deletion-'+i;
    const event={id,key:'card:previously-deleted-'+i,value:null,deleted:true,
      parents:[],clock:300+i,device_id:'fixture-device',updated_at:'2026-11-28T00:00:00Z'};
    events[id]=event;remoteEvents.push(event);
  }
  localStorage.setItem('simple_vocab_cards_v1',JSON.stringify(cards));
  localStorage.setItem('word_drive_primary_v1','1');
  localStorage.setItem('flashcards_drive_device_v3','fixture-device');
  localStorage.setItem('flashcards_supabase_session_v1',JSON.stringify({
    access_token:'synthetic-access-secret',refresh_token:'synthetic-refresh-secret',
    expires_at:Date.now()+3600000,
    user:{id:'fixture-user',email:'private-fixture@example.invalid'}
  }));
  localStorage.setItem('word_gdrive_meta_v2',JSON.stringify({updated:{},deleted:{}}));
  const state={events,pending,seen:{'fixture-initial':'fixture-checksum'},imports:{},
    account:'private-drive-account-fixture',clock:302,initialized:true,
    snapshot:Object.fromEntries(cards.map(c=>['card:'+c.id,c])),
    basis:Object.fromEntries(cards.map((c,i)=>['card:'+c.id,[i>=58?'fixture-pending-'+i:'fixture-base-'+i]]))};
  const db=await new Promise((resolve,reject)=>{
    const r=indexedDB.open('flashcards_drive_cache_v3',1);
    r.onupgradeneeded=()=>{r.result.createObjectStore('states');r.result.createObjectStore('blobs')};
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(['states','blobs'],'readwrite');
    tx.objectStore('states').put(state,'word-flashcards');
    tx.objectStore('states').put({preserve:'unrelated-app'},'other-app');
    for(const [key,blob]of blobs)tx.objectStore('blobs').put(blob,key);
    tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error);
  });
  db.close();
  return {schema:'flashcards-drive-journal-v3',namespace:'word-flashcards',events:remoteEvents};
}"""

TRANSFER_TRAPS = r"""(() => {
  const audit={authorized:false,clicks:0,forbidden:[],network:[],popups:[],queueWrites:[]};
  Object.defineProperty(window,'__transferAudit',{value:audit});
  const reject=label=>{audit.forbidden.push(label);throw new Error('Synthetic forbidden operation: '+label)};
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('#syncNow');
    if(button&&!button.disabled){audit.authorized=true;audit.clicks++;}
  },true);
  for(const method of ['setItem','removeItem','clear']){
    const original=Storage.prototype[method];
    Storage.prototype[method]=function(key,...args){
      const authKeys=['flashcards_supabase_session_v1','flashcards_drive_paused_v1',
        'flashcards_app_refresh_lock_v1','flashcards_drive_login_context_v1'];
      if(!audit.authorized||method==='clear'||!authKeys.includes(String(key)))return reject('storage:'+method+':'+key);
      return original.call(this,key,...args);
    };
  }
  const transaction=IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction=function(stores,mode,...args){
    const names=Array.isArray(stores)?stores:[stores];
    if(this.name==='flashcards_drive_cache_v3'&&mode&&mode!=='readonly'&&
       (!audit.authorized||names.some(name=>name!=='states')))
      return reject('source-transaction:'+names.join(',')+':'+mode);
    if(this.name==='word_sync_transfer_checkpoints_v1'&&!audit.authorized)
      return reject('checkpoint-before-click');
    return transaction.call(this,stores,mode,...args);
  };
  for(const method of ['add','put','delete','clear']){
    const original=IDBObjectStore.prototype[method];
    IDBObjectStore.prototype[method]=function(...args){
      const [value,key]=args;
      if(this.transaction.db.name==='flashcards_drive_cache_v3'){
        if(!audit.authorized||this.name!=='states'||method!=='put'||key!=='word-flashcards')
          return reject('source-store:'+this.name+':'+method);
        audit.queueWrites.push({pending:value.pending?.length,events:Object.keys(value.events||{}).length});
      }
      return original.apply(this,args);
    };
  }
  const drop=IDBFactory.prototype.deleteDatabase;
  IDBFactory.prototype.deleteDatabase=function(name){
    if(name==='flashcards_drive_cache_v3')return reject('source-delete-database');
    return drop.call(this,name);
  };
  for(const method of ['createObjectStore','deleteObjectStore']){
    const original=IDBDatabase.prototype[method];
    IDBDatabase.prototype[method]=function(...args){
      if(this.name==='flashcards_drive_cache_v3')return reject('source-schema:'+method);
      if(this.name==='word_sync_transfer_checkpoints_v1'&&!audit.authorized)return reject('checkpoint-before-click');
      return original.apply(this,args);
    };
  }
  const fetcher=window.fetch.bind(window);
  window.fetch=(input,init)=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(url.origin!==location.origin){
      audit.network.push(url.origin+url.pathname);
      if(!audit.authorized)return Promise.reject(new Error(reject('network-before-click')));
    }
    return fetcher(input,init);
  };
  window.open=url=>{audit.popups.push(String(url));return null};
  XMLHttpRequest.prototype.open=function(method,url){return reject('xhr:'+url)};
  navigator.sendBeacon=url=>{reject('beacon:'+url);return false};
  window.WebSocket=function(url){return reject('websocket:'+url)};
  window.EventSource=function(url){return reject('eventsource:'+url)};
  if(navigator.serviceWorker)navigator.serviceWorker.register=url=>Promise.reject(new Error(reject('serviceworker:'+url)));
})();"""


class SyntheticDrive:
    def __init__(self):
        self.account = ACCOUNT
        self.files = {}
        self.uploads = []
        self.calls = []
        self.fail_journal_readback = False
        self.failed_readbacks = 0

    def add(self, file_id, metadata, data):
        metadata = dict(metadata)
        metadata.update(id=file_id, md5Checksum=hashlib.md5(data).hexdigest(),
                        sha256Checksum=hashlib.sha256(data).hexdigest(), size=str(len(data)))
        self.files[file_id] = {"metadata": metadata, "data": data}
        return metadata

    def seed(self, document):
        data = json.dumps(document, ensure_ascii=False).encode()
        self.add("fixture-initial", {"name": "fixture-initial.json", "mimeType": "application/json",
            "appProperties": {"namespace": "word-flashcards", "kind": "journal"}}, data)

    @staticmethod
    def multipart(request):
        content_type = request.header_value("content-type")
        raw = b"Content-Type: " + content_type.encode() + b"\r\nMIME-Version: 1.0\r\n\r\n" + request.post_data_buffer
        parts = list(BytesParser(policy=policy.default).parsebytes(raw).iter_parts())
        if len(parts) != 2:
            raise AssertionError("expected real Drive multipart metadata and content")
        return json.loads(parts[0].get_payload(decode=True)), parts[1].get_payload(decode=True)

    def handle(self, request):
        url = urlsplit(request.url)
        query = parse_qs(url.query)
        self.calls.append((request.method, url.path))
        if request.method == "GET" and url.path == "/drive/v3/about":
            return 200, {"user": {"permissionId": self.account}}, "application/json"
        if request.method == "GET" and url.path == "/drive/v3/files":
            properties = re.findall(r"key\s*=\s*'([^']+)'\s+and\s+value\s*=\s*'([^']+)'", query.get("q", [""])[0])
            files = [item["metadata"] for item in self.files.values()
                if all(item["metadata"].get("appProperties", {}).get(key) == value for key, value in properties)]
            return 200, {"files": files}, "application/json"
        if request.method == "GET" and url.path.startswith("/drive/v3/files/"):
            file_id = unquote(url.path.rsplit("/", 1)[1])
            item = self.files.get(file_id)
            if not item:
                return 404, {"error": {"message": "Synthetic missing file"}}, "application/json"
            if self.fail_journal_readback and item["metadata"].get("appProperties", {}).get("kind") == "journal" and any(upload["kind"] == "journal" for upload in self.uploads):
                self.failed_readbacks += 1
                return 503, {"error": {"message": "Synthetic final readback unavailable"}}, "application/json"
            if query.get("alt") == ["media"]:
                return 200, item["data"], item["metadata"]["mimeType"]
            return 200, item["metadata"], "application/json"
        if request.method == "POST" and url.path == "/upload/drive/v3/files":
            metadata, data = self.multipart(request)
            kind = metadata.get("appProperties", {}).get("kind")
            if kind not in {"image", "journal"} or metadata.get("appProperties", {}).get("namespace") != "word-flashcards":
                raise AssertionError("unexpected Drive upload kind/namespace")
            file_id = "fixture-upload-" + str(len(self.uploads) + 1)
            result = self.add(file_id, metadata, data)
            document = json.loads(data) if kind == "journal" else None
            self.uploads.append({"id": file_id, "kind": kind, "document": document, "data": data})
            return 200, {"id": file_id, "md5Checksum": result["md5Checksum"]}, "application/json"
        raise AssertionError("unexpected Drive request: " + request.method + " " + request.url)


class WordSyncTransferBrowserTest(unittest.TestCase):
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
        self.context = self.browser.new_context(viewport={"width": 390, "height": 844},
            device_scale_factor=1, is_mobile=True, has_touch=True, service_workers="block")
        self.drive = SyntheticDrive()
        self.unexpected = []
        self.auth_calls = []
        self.auth_error = None
        self.hold_forced_token = False
        self.held_token_routes = []
        self.static_assets = []
        self.held_safety = []
        self.hold_safety = True
        self.context.route("**/*", self.serve)
        self.page = self.context.new_page()
        self.page.set_default_timeout(30000)

    def tearDown(self):
        for route in self.held_safety + self.held_token_routes:
            try:
                route.abort()
            except Exception:
                pass
        self.context.close()

    @staticmethod
    def reply(route, status, body, content_type="application/json"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False)
        route.fulfill(status=status, body=body, content_type=content_type, headers={
            "Access-Control-Allow-Origin": ORIGIN,
            "Access-Control-Allow-Headers": "authorization,content-type,apikey,x-client-info",
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        })

    def serve(self, route):
        request = route.request
        url = urlsplit(request.url)
        origin = url.scheme + "://" + url.netloc
        if origin in {AUTH_ORIGIN, DRIVE_ORIGIN} and request.method == "OPTIONS":
            self.reply(route, 204, "")
            return
        if origin == AUTH_ORIGIN and url.path == "/functions/v1/drive-auth/token" and request.method == "POST":
            payload = json.loads(request.post_data or "{}")
            self.auth_calls.append(payload)
            if self.hold_forced_token and payload.get("force") is True:
                self.held_token_routes.append(route)
                return
            if self.auth_error:
                self.reply(route, 403, {"error": self.auth_error})
            else:
                token = "synthetic-drive-access-renewed" if payload.get("force") is True else "synthetic-drive-access-secret"
                self.reply(route, 200, {"access_token": token, "expires_in": 3600, "account": ACCOUNT})
            return
        if origin == DRIVE_ORIGIN:
            try:
                status, body, content_type = self.drive.handle(request)
                self.reply(route, status, body, content_type)
            except Exception as error:
                self.unexpected.append(str(error))
                route.abort()
            return
        if request.url == ORIGIN + ENTRY + "__transfer_fixture__.html":
            self.reply(route, 200, "<!doctype html><title>Synthetic transfer fixture</title>", "text/html")
            return
        allowed_shared = {"/flashcards/drive-core.js", "/flashcards/persistent-drive-auth.js", "/flashcards/auth-only-ui.css"}
        if origin != ORIGIN or request.method != "GET" or not (url.path.startswith(ENTRY) or url.path in allowed_shared):
            self.unexpected.append(request.method + " " + request.url)
            route.abort()
            return
        relative = unquote(url.path[len("/flashcards/"):])
        if relative.endswith("/"):
            relative += "index.html"
        source = (ROOT / relative).resolve()
        if not source.is_relative_to(ROOT) or not source.is_file():
            self.unexpected.append("missing static file: " + request.url)
            route.abort()
            return
        self.static_assets.append(url.path)
        if source.name == "safety.js" and self.hold_safety:
            self.held_safety.append(route)
            return
        self.reply(route, 200, source.read_bytes(), mimetypes.guess_type(str(source))[0] or "application/octet-stream")

    def open_with_verified_backup(self):
        self.page.goto(ORIGIN + ENTRY + "__transfer_fixture__.html")
        self.drive.seed(self.page.evaluate(SEED_TRANSFER))
        self.baseline = self.page.evaluate(READ_SOURCE)
        self.context.add_init_script(TRANSFER_TRAPS)
        self.page.goto(ORIGIN + ENTRY, wait_until="commit")
        self.page.locator("h1").wait_for(state="visible")
        self.page.wait_for_function("document.getElementById('localCount').textContent==='105'")
        self.assertTrue(self.page.locator("#syncNow").is_disabled(), "no transfer before the backup can be verified")
        self.assertEqual(self.auth_calls, [])
        self.assertEqual(self.drive.calls, [])
        self.assertEqual(len(self.held_safety), 1)
        self.hold_safety = False
        for route in self.held_safety:
            self.reply(route, 200, (ROOT / "word-sync-check/safety.js").read_bytes(), "text/javascript")
        self.held_safety = []
        self.page.wait_for_function("!document.getElementById('syncNow').disabled&&!document.getElementById('downloadBackup').disabled")
        self.assertIn("105", self.page.locator("#syncNow").inner_text())
        button_box = self.page.locator("#syncNow").bounding_box()
        self.assertIsNotNone(button_box)
        self.assertGreaterEqual(button_box["x"], 0)
        self.assertLessEqual(button_box["x"] + button_box["width"], 391)
        self.assertGreaterEqual(button_box["y"], 0)
        self.assertLessEqual(button_box["y"] + button_box["height"], 845, "the explicit action must be on the initial phone screen")
        self.assertEqual(self.page.locator("#backupStatus").get_attribute("data-kind"), "success")
        self.assertIn("画像本体の保全：47／47枚", self.page.locator("#diagnosticDetails").inner_text())
        self.assertEqual(self.auth_calls, [])
        self.assertEqual(self.drive.calls, [])
        self.assertNotIn("/flashcards/persistent-drive-auth.js", self.static_assets)
        self.assertNotIn("/flashcards/drive-core.js", self.static_assets)
        self.assertEqual(self.page.evaluate(READ_SOURCE), self.baseline)

    def assert_original_cards_and_images_preserved(self, pending_count, *, popup_count=0):
        current = self.page.evaluate(READ_SOURCE)
        self.assertEqual(current["blobs"], self.baseline["blobs"], "all 47 original images must remain byte-for-byte identical")
        before_storage, current_storage = dict(self.baseline["storage"]), dict(current["storage"])
        for key in ("simple_vocab_cards_v1", "word_drive_primary_v1", "flashcards_drive_device_v3", "word_gdrive_meta_v2"):
            self.assertEqual(current_storage[key], before_storage[key], "publishing must not replace the source cards or their IDs")
        before_states, current_states = dict(self.baseline["states"]), dict(current["states"])
        self.assertEqual(current_states["other-app"], before_states["other-app"])
        state = current_states["word-flashcards"]
        self.assertEqual(len(state["pending"]), pending_count)
        if pending_count == 47:
            self.assertEqual(state["pending"], before_states["word-flashcards"]["pending"], "unverified pending event IDs must not be acknowledged")
        self.assertTrue(set(before_states["word-flashcards"]["events"]).issubset(state["events"]), "all prior event IDs must be preserved")
        for event_id, event in before_states["word-flashcards"]["events"].items():
            def semantic(value):
                result = json.loads(json.dumps(value))
                if isinstance(result.get("value"), dict):
                    for image in result["value"].get("images", []):
                        image["ref"] = image["ref"].rsplit(":", 1)[-1]
                return result
            self.assertEqual(semantic(state["events"][event_id]), semantic(event), "history must retain content, IDs, ancestry and image hashes")
        audit = self.page.evaluate("__transferAudit")
        self.assertEqual(audit["forbidden"], [])
        self.assertEqual(len(audit["popups"]), popup_count, "authentication must never open a popup automatically")
        self.assertEqual(self.unexpected, [])
        self.assertTrue(self.page.evaluate("!window.WordDriveSync"), "the normal automatic card adapter must not start")
        for upload in self.drive.uploads:
            if upload["kind"] == "journal":
                self.assertFalse(any(event.get("deleted") for event in upload["document"]["events"]), "this flow must not publish any deletion")
        return state

    def click_sync_and_wait(self):
        self.page.locator("#syncNow").click()
        self.page.wait_for_function("['done','error'].includes(document.getElementById('syncStage').dataset.stage)&&!document.getElementById('syncNow').disabled")

    def assert_verified_remote(self):
        events = {}
        for item in self.drive.files.values():
            if item["metadata"]["appProperties"]["kind"] == "journal":
                for event in json.loads(item["data"])["events"]:
                    if event["id"] in events:
                        self.assertEqual(events[event["id"]], event, "immutable remote event IDs must not change")
                    events[event["id"]] = event
        view = self.page.evaluate("events=>FlashcardsDrive.materialize(events)", events)
        self.assertEqual(len(view["data"]), 105)
        self.assertEqual(set(view["deleted"]), {"card:previously-deleted-" + str(i) for i in range(3)})
        original = json.loads(dict(self.baseline["storage"])["simple_vocab_cards_v1"])
        images = 0
        for card in original:
            remote = view["data"]["card:" + card["id"]]
            for key in ("id", "word", "meaning", "sort_order"):
                self.assertEqual(remote[key], card[key])
            self.assertEqual(len(remote.get("images", [])), len(card["images"]))
            for source_image, remote_image in zip(card["images"], remote.get("images", [])):
                match = re.fullmatch(r"gdrive:([\w-]+):([a-f0-9]{64})", remote_image["ref"])
                self.assertIsNotNone(match, "Drive must receive durable image references")
                self.assertEqual(match[2], source_image["ref"].rsplit(":", 1)[-1])
                image = self.drive.files[match[1]]
                self.assertEqual(hashlib.sha256(image["data"]).hexdigest(), match[2])
                images += 1
        self.assertEqual(images, 47)
        self.assertEqual(self.page.locator("#syncStatus").get_attribute("data-kind"), "success")
        self.assertEqual(self.page.locator("#syncStage").get_attribute("data-stage"), "done")
        self.assertIn("この端末105件／Drive105件", self.page.locator("#syncStatus").inner_text())
        self.assertIn("送信待ち0件", self.page.locator("#syncStatus").inner_text())
        details = self.page.locator("#diagnosticDetails").inner_text()
        for line in ("今回Driveから確認した単語数：105件", "今回Driveから照合した画像：47枚", "同期後の送信待ち：0件", "別端末への反映：この画面では未確認"):
            self.assertIn(line, details)
        for marker in PRIVATE_MARKERS + ("synthetic-drive-access-secret",):
            self.assertNotIn(marker, details)
        self.page.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedTransfer=text}}})")
        self.page.locator("#copyReport").click()
        self.assertEqual(self.page.evaluate("window.__copiedTransfer"), details)

    def test_explicit_sync_uploads_and_reads_back_105_cards_and_47_images(self):
        self.open_with_verified_backup()
        self.click_sync_and_wait()
        self.assert_verified_remote()
        self.assert_original_cards_and_images_preserved(0)
        self.assertGreater(len(self.auth_calls), 0)
        self.assertEqual(sum(upload["kind"] == "image" for upload in self.drive.uploads), 47)
        self.assertEqual(sum(upload["kind"] == "journal" for upload in self.drive.uploads), 1)
        self.assertTrue(self.page.evaluate("!!window.PersistentDriveAuth&&!!window.FlashcardsDrive&&!!window.WordSyncTransfer"))

    def test_failed_readback_keeps_the_queue_and_retry_does_not_duplicate_uploads(self):
        self.drive.fail_journal_readback = True
        self.open_with_verified_backup()
        self.click_sync_and_wait()
        self.assertGreater(self.drive.failed_readbacks, 0, "the failure must occur after a real accepted upload")
        self.assertEqual(self.page.locator("#syncStage").get_attribute("data-stage"), "error")
        self.assertEqual(self.page.locator("#syncStatus").get_attribute("data-kind"), "error")
        self.assertNotIn("同期後の送信待ち：0件", self.page.locator("#diagnosticDetails").inner_text())
        self.assert_original_cards_and_images_preserved(47)
        upload_ids = [upload["id"] for upload in self.drive.uploads]
        self.assertEqual(sum(upload["kind"] == "journal" for upload in self.drive.uploads), 1)
        self.drive.fail_journal_readback = False
        self.click_sync_and_wait()
        self.assert_verified_remote()
        self.assert_original_cards_and_images_preserved(0)
        self.assertEqual([upload["id"] for upload in self.drive.uploads], upload_ids, "retry must verify and reuse accepted images and the journal")

    def test_mismatched_drive_account_blocks_all_uploads(self):
        self.drive.account = "different-synthetic-account"
        self.open_with_verified_backup()
        self.click_sync_and_wait()
        self.assertIn(("GET", "/drive/v3/about"), self.drive.calls)
        self.assertEqual(self.drive.uploads, [])
        self.assertEqual(self.page.locator("#syncStatus").get_attribute("data-kind"), "error")
        self.assertIn("TRANSFER_ACCOUNT_MISMATCH", self.page.locator("#syncStage").inner_text())
        self.assertTrue(self.page.locator("#syncAuth").is_visible())
        self.assert_original_cards_and_images_preserved(47)
        self.assertEqual(self.page.evaluate("__transferAudit.queueWrites"), [])
        self.assertEqual(self.page.evaluate("PersistentDriveAuth.state().phase"), "connected")
        self.page.locator("#syncAuth").click()
        dialog = self.page.locator("#persistentDriveDialog")
        dialog.wait_for(state="visible")
        self.assertEqual(self.page.evaluate("PersistentDriveAuth.state().phase"), "connected")
        self.assertTrue(self.page.locator("#persistentDriveDialog [data-google]").is_visible(), "an explicitly requested reconnection must remain available with a still-valid token")
        self.assertTrue(dialog.is_visible(), "opening the dialog must not immediately close it because the old token is valid")
        self.assertEqual(self.page.evaluate("__transferAudit.popups"), [])
        self.page.locator("#persistentDriveDialog [data-google]").click()
        context = self.page.evaluate("JSON.parse(sessionStorage.getItem('flashcards_drive_login_context_v1'))")
        self.assertEqual(context["expected_account"], ACCOUNT)
        self.assertEqual(context["returnTo"], ENTRY)
        self.assertTrue(dialog.is_visible(), "the explicit Google action alone is not a completed reconnection")
        self.assert_original_cards_and_images_preserved(47, popup_count=1)
        self.hold_forced_token = True
        with self.page.expect_request(lambda request: request.url == AUTH_ORIGIN + "/functions/v1/drive-auth/token" and request.method == "POST" and json.loads(request.post_data or "{}").get("force") is True) as forced:
            self.page.evaluate("window.dispatchEvent(new MessageEvent('message',{origin:location.origin,source:window,data:{type:'flashcards-drive-connected'}}))")
        self.assertTrue(json.loads(forced.value.post_data)["force"])
        self.assertTrue(dialog.is_visible(), "the dialog must stay open until the refreshed token arrives")
        self.assertEqual(len(self.held_token_routes), 1)
        self.hold_forced_token = False
        for route in self.held_token_routes:
            self.reply(route, 200, {"access_token": "synthetic-drive-access-renewed", "expires_in": 3600, "account": ACCOUNT})
        self.held_token_routes = []
        dialog.wait_for(state="hidden")
        self.assertEqual(self.page.evaluate("PersistentDriveAuth.getToken().then(access=>access.token)"), "synthetic-drive-access-renewed")
        self.assertEqual(self.page.locator("#syncStatus").get_attribute("data-kind"), "error", "reconnecting alone must not claim the cards were uploaded")
        self.assertEqual(self.drive.uploads, [])
        self.assertEqual(self.page.evaluate("__transferAudit.queueWrites"), [])
        self.assert_original_cards_and_images_preserved(47, popup_count=1)

    def test_permission_failure_shows_an_explicit_auth_action_without_auto_popup(self):
        self.auth_error = "google_permission_required"
        self.open_with_verified_backup()
        self.click_sync_and_wait()
        self.assertEqual(self.page.locator("#syncStatus").get_attribute("data-kind"), "error")
        self.assertIn("TRANSFER_AUTH_REQUIRED", self.page.locator("#syncStage").inner_text())
        self.assertTrue(self.page.locator("#syncAuth").is_visible())
        self.assertEqual(self.drive.calls, [])
        self.assertEqual(self.drive.uploads, [])
        self.assert_original_cards_and_images_preserved(47)
        self.page.locator("#syncAuth").click()
        self.page.locator("#persistentDriveDialog").wait_for(state="visible")
        self.assertEqual(self.page.evaluate("__transferAudit.popups"), [])
        self.page.locator("#persistentDriveDialog [data-google]").click()
        context = self.page.evaluate("JSON.parse(sessionStorage.getItem('flashcards_drive_login_context_v1'))")
        self.assertEqual(context["expected_account"], ACCOUNT)
        self.assertEqual(context["returnTo"], ENTRY)
        self.assert_original_cards_and_images_preserved(47, popup_count=1)


if __name__ == "__main__":
    unittest.main()
