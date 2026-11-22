"""Exercise actual IndexedDB transactions used to replace an offline book."""
import os
import shutil
import unittest
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class GenerationCleanup(unittest.TestCase):
    def test_replacement_rollback_and_unrelated_records(self):
        with sync_playwright() as pw:
            exe = os.environ.get('CHROME_PATH') or os.environ.get('CHROME_BIN') or shutil.which('chromium') or shutil.which('google-chrome') or pw.chromium.executable_path
            browser = pw.chromium.launch(executable_path=exe, args=['--no-sandbox', '--no-zygote', '--disable-dev-shm-usage'])
            try:
                page = browser.new_page()
                page.route('http://reader.test/**', self.serve)
                page.goto('http://reader.test/')
                page.evaluate(self.exercise())
            finally:
                browser.close()

    @staticmethod
    def serve(route):
        name = route.request.url.rsplit('/', 1)[-1]
        if name == 'storage.js':
            route.fulfill(path=ROOT / 'reader/library/storage.js', content_type='application/javascript')
        elif name == 'shelf-registration.mjs':
            # Unique root per fixture, without production signing keys or private book data.
            route.fulfill(body="export async function ledger(){};export async function admitBlob(book,blob){return {chunkRoot:await blob.text()}}", content_type='application/javascript')
        else:
            route.fulfill(body='<script src="/storage.js"></script>', content_type='text/html')

    @staticmethod
    def exercise():
        return r"""async () => {
          const book={id:'test'}, other={id:'test-more'}, pos='BOOK_POSITION_test';
          const expect=(v,reason)=>{if(!v)throw Error(reason);};
          const save=async(b,parts)=>{const w=await LibraryDB.newWriter(b);for(const p of parts)await w.write(new Blob([p]));return w.commit();};
          const text=async b=>(await LibraryDB.readBlob(b.id)).blob.text();
          const open=()=>new Promise((ok,no)=>{const r=indexedDB.open('private-bookshelf-v1');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
          const change=async action=>{
            const db=await open();
            try {return await new Promise((ok,no)=>{const tx=db.transaction('chunks','readwrite'),r=action(tx.objectStore('chunks'));tx.oncomplete=()=>ok(r.result);tx.onabort=()=>no(tx.error);});}
            finally {db.close();}
          };
          const keys=()=>change(s=>s.getAllKeys()),prefix=m=>m.id+'|'+m.generation+'|';
          const old=await save(book,['a','b','c']);await save(other,['other']);
          const sameBookNeighbor='test|'+old.generation+'x|000000';
          await change(s=>s.put(new Blob(['untouched']),sameBookNeighbor));localStorage.setItem(pos,'retained');
          const before=await keys(), candidate=await LibraryDB.newWriter(book);await candidate.write(new Blob(['failed']));
          let failed=false;
          try{await candidate.commit(6,()=>{throw Error('fixture failure');});}catch(e){failed=true;}
          expect(failed,'must reject failed validation');await candidate.abort();
          expect(JSON.stringify(before)===JSON.stringify(await keys())&&await text(book)==='abc','failed save lost or left chunks');

          // Abort the actual IDB transaction after both metadata put and old-generation deletion were queued.
          const broken=await LibraryDB.newWriter(book);await broken.write(new Blob(['abort']));
          const remove=IDBObjectStore.prototype.delete;let aborted=false;
          IDBObjectStore.prototype.delete=function(range){const req=remove.call(this,range);this.transaction.abort();return req;};
          try{await broken.commit(5);}catch(e){aborted=true;}finally{IDBObjectStore.prototype.delete=remove;}
          expect(aborted,'forced transaction abort not observed');await broken.abort();
          expect(JSON.stringify(before)===JSON.stringify(await keys())&&await text(book)==='abc','atomic rollback failed');

          const stale=await LibraryDB.newWriter(book);await stale.write(new Blob(['stale']));
          const next=await save(book,['fresh','-book']);let rejected=false;
          try{await stale.commit(5);}catch(e){rejected=true;}expect(rejected,'stale writer replaced a newer generation');await stale.abort();
          const after=await keys();
          expect(!after.some(k=>k.startsWith(prefix(old)))&&after.filter(k=>k.startsWith(prefix(next))).length===2,'old/new chunk membership');
          expect(after.includes(sameBookNeighbor)&&after.length===4&&await text(book)==='fresh-book'&&await text(other)==='other','adjacent generation/book changed');
          expect(await LibraryDB.removeBook(book.id)&&!(await LibraryDB.removeBook(book.id)),'remove result broken');
          expect(!(await LibraryDB.getMeta(book.id))&&(await keys()).length===2&&await text(other)==='other','remove touched another record');
          expect((await keys()).includes(sameBookNeighbor)&&localStorage.getItem(pos)==='retained','orphan or bookmark changed');
        }"""
