"""Verify source ruby on the visible reader, including joins, dialogue, and reflow."""
import base64
import hashlib
import io
import json
import os
import re
import shutil
import tempfile
import unittest
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright


TEMPLATES = Path(__file__).resolve().parents[1] / 'templates/reader/v2'
# This is synthetic layout data, independent of any privately stored book.
buffer = io.BytesIO()
Image.new('L', (100, 200), 255).save(buffer, format='PNG')
SCAN_HASH = hashlib.sha256(buffer.getvalue()).hexdigest()
SOURCE_URL = 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode()


def annotation(block, start, end, reading):
    block.setdefault('ruby', []).append({
        'start': start, 'end': end, 'base': block['text'][start:end], 'reading': reading,
        'sourceScan': block['scan'], 'sourceImageSha256': SCAN_HASH,
        'sourceBox': [40, 20, 47, 80], 'reviewStatus': 'verified',
    })


def build_book(blocks, mode):
    book = {
        'id': 'source-ruby-test', 'title': '組版試験', 'kind': mode, 'totalScans': 2,
        'originals': [{'scan': n, 'src': SOURCE_URL, 'sha256': SCAN_HASH} for n in [1, 2]],
    }
    if mode == 'mixed':
        book['entries'] = [{'kind': 'text', 'scan': b['scan'], 'blocks': [b]} for b in blocks]
    else:
        book['blocks'] = blocks
    return book


def sample():
    first = {'type': 'body', 'scan': 1, 'text': '𠮷野とか\u3099くの山。五月の空。山の奥を歩く。'}
    second = {'type': 'body', 'scan': 2, 'joinPrevious': True,
              'text': '山は静かだった。「山が見える」' + '遠くの山には雪が積もる。' * 35}
    # Only the second occurrence near the beginning of scan 1 and first two on scan 2 are marked.
    annotation(first, 0, 2, 'よしの')
    pos = first['text'].rindex('山')
    annotation(first, pos, pos + 1, 'やま')
    annotation(second, 0, 1, 'さん')
    pos = second['text'].index('「山') + 1
    annotation(second, pos, pos + 1, 'やま')
    return [first, second]


OBSERVE = """() => {
  const api=window.NovelReader || window.StandardReader;
  const pages=api.pageManifest();
  const flow=document.querySelector('#text-flow');
  let source='';
  const found=[];
  for (let i=0;i<pages.length;i++) {
    api.gotoPage(i);
    const sheet=document.getElementById('sheet').getBoundingClientRect();
    const seenRubies=new Set();
    const walker=document.createTreeWalker(flow,NodeFilter.SHOW_TEXT);
    for (let node;node=walker.nextNode();) {
      if(node.parentElement.closest('rt,rp')) continue;
      const ruby=node.parentElement.closest('ruby');
      if(ruby && !seenRubies.has(ruby)) {
        seenRubies.add(ruby);
        const content=ruby.cloneNode(true);
        content.querySelectorAll('rt,rp').forEach(el => el.remove());
        const size=ruby.querySelector('rt').getBoundingClientRect();
        const range=document.createRange();
        range.selectNodeContents(node);
        const base=range.getClientRects()[0];
        found.push({start:Array.from(source).length,base:content.textContent,
          reading:ruby.querySelector('rt').textContent,
          rightOfBaseCenter:size.left+size.width/2>base.left+base.width/2,
          visible:size.width>0 && size.height>0 && size.left>=sheet.left-1 &&
             size.right<=sheet.right+1 && size.top>=sheet.top-1 && size.bottom<=sheet.bottom+1});
      }
      source+=node.textContent;
    }
  }
  return {source,found,state:api.inspect(),boundaries:pages.map(p=>p.end)};
}"""


class SourceRubyLayout(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        cls.root = Path(cls.temp.name)
        for path in TEMPLATES.iterdir():
            if path.suffix in ('.css', '.js'):
                (cls.root / path.name).write_bytes(path.read_bytes())
        cls.pw = sync_playwright().start()
        cls.addClassCleanup(cls.pw.stop)
        exe = (os.environ.get('CHROME_PATH') or os.environ.get('CHROME_BIN') or
               shutil.which('chromium') or shutil.which('google-chrome') or cls.pw.chromium.executable_path)
        cls.browser = cls.pw.chromium.launch(executable_path=exe, timeout=15000,
                                             args=['--no-sandbox', '--disable-dev-shm-usage'])
        cls.addClassCleanup(cls.browser.close)
        cls.page = cls.browser.new_page()
        cls.page.set_default_timeout(5000)
        cls.page.add_init_script('localStorage.clear()')
        cls.errors = []
        cls.page.on('pageerror', lambda e: cls.errors.append(str(e)))

    def load(self, profile, book):
        name = 'novel.html' if profile == 'novel' else 'mixed.html'
        html, count = re.subn(r'<script>window\.READER_BOOK=.*?</script>',
                              lambda _: '<script>window.READER_BOOK=' + json.dumps(book) + ';</script>',
                              (TEMPLATES / name).read_text(), flags=re.S)
        self.assertEqual(count, 1)
        path = self.root / (profile + '-fixture.html')
        path.write_text(html)
        self.errors.clear()
        self.page.goto(path.as_uri(), wait_until='load')
        if not self.errors:
            self.page.wait_for_function("""() => {
                const state = (window.NovelReader || window.StandardReader)?.inspect();
                return state && (state.pages || state.warning);
            }""")

    def observe(self, blocks):
        result = self.page.evaluate(OBSERVE)
        expected, offset = [], 0
        for block in blocks:
            for r in block.get('ruby', []):
                expected.append([offset + r['start'], r['base'], r['reading']])
            offset += len(block['text'])
        self.assertFalse(self.errors, self.errors)
        self.assertFalse(result['state']['warning'], result['state'])
        self.assertEqual(result['source'], ''.join(b['text'] for b in blocks))
        self.assertTrue(result['state']['textIntegrity'])
        self.assertGreater(len(result['boundaries']), 1)
        self.assertEqual([[r['start'], r['base'], r['reading']] for r in result['found']], expected)
        for item in result['found']:
            self.assertTrue(item['rightOfBaseCenter'], item)
            self.assertTrue(item['visible'], item)
        return result

    def test_render_at_two_sizes_and_reflow(self):
        for profile in ('standard', 'novel'):
            for mode in ('text', 'mixed'):
                with self.subTest(profile=profile, mode=mode):
                    blocks = sample()
                    self.page.set_viewport_size({'width': 390, 'height': 690})
                    self.load(profile, build_book(blocks, mode))
                    initial = self.observe(blocks)
                    if profile == 'novel':
                        self.assertGreater(initial['state']['dialogueCount'], 0)
                    self.assertEqual(initial['state']['font'], 20)
                    self.page.evaluate("""() => {
                        const api = window.NovelReader || window.StandardReader;
                        new MutationObserver(() => { window.renderedFont = api.inspect().font; })
                            .observe(document.getElementById('text-flow'), {childList:true});
                    }""")
                    self.page.set_viewport_size({'width': 320, 'height': 568})
                    self.page.locator('#larger').click()
                    self.page.locator('#larger').click()
                    self.page.wait_for_function("""window.renderedFont === 24 &&
                        document.getElementById('measure-sheet').getBoundingClientRect().width ===
                        document.getElementById('sheet').getBoundingClientRect().width""")
                    resized = self.observe(blocks)
                    self.assertNotEqual(initial['boundaries'], resized['boundaries'])

    def test_ruby_base_crossing_existing_break_moves_together(self):
        for profile in ('standard', 'novel'):
            with self.subTest(profile=profile):
                self.page.set_viewport_size({'width': 320, 'height': 568})
                block = {'type': 'body', 'scan': 1, 'text': '海辺を歩いて山へ向かう。' * 75}
                self.load(profile, build_book([block], 'text'))
                boundary = self.observe([block])['boundaries'][0]
                annotation(block, boundary-1, boundary+1, 'ためし')
                self.load(profile, build_book([block], 'text'))
                self.assertNotIn(boundary, self.observe([block])['boundaries'])

    def test_stale_offsets_rejected(self):
        for profile in ('standard', 'novel'):
            with self.subTest(profile=profile):
                block = sample()[0]
                block['ruby'][0]['start'] = 1  # Stale edit, source no longer equals the registered base.
                self.load(profile, build_book([block], 'text'))
                warning = self.page.evaluate("(window.NovelReader || window.StandardReader)?.inspect().warning")
                self.assertTrue(self.errors or warning, 'An invalid source anchor was accepted.')


if __name__ == '__main__':
    unittest.main()
