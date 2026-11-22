"""Check structured shelf segmentation, source-coordinate annotations and page turns together."""
import json
import os
from pathlib import Path
import shutil
import unittest

from playwright.sync_api import sync_playwright

TEMPLATE = Path(__file__).resolve().parents[1] / 'reader/library/wh3-format.html'


def fixture(first, second):
    data = {'bookId': 'ruby-test', 'title': '読書試験', 'range': [1, 2],
            'continuations': [{'from': [1, 0], 'to': [2, 0]}],
            'pages': [{'scan': i, 'blocks': [b], 'figures': []}
                      for i, b in enumerate((first, second), 1)]}
    script = '<script type="application/json" id="bookdata">' + json.dumps(data) + '</script>'
    return TEMPLATE.read_text().replace('<!--WH3_PRIVATE_DATA-->', script)


def reading(text, start, end, value, scan):
    return dict(start=start, end=end, base=text[start:end], reading=value, sourceScan=scan,
                sourceImageSha256='1' * 64, sourceBox=[12, 10, 18, 26], reviewStatus='verified')


COLLECT = """() => {
    const api = StandardReader, manifest = api.pageManifest();
    const all = [], annotations = [];
    for (let i=0; i < manifest.length; i++) {
        api.gotoPage(i);
        const flow = document.getElementById('text-flow');
        const plain = flow.cloneNode(true);
        plain.querySelectorAll('rt').forEach(r => r.remove());
        all.push(plain.textContent);
        for (const ruby of flow.querySelectorAll('ruby')) {
            const rt = ruby.querySelector('rt'), nodes = ruby.cloneNode(true);
            nodes.querySelector('rt').remove();
            const range = document.createRange();
            range.selectNodeContents(ruby.firstChild);
            const base = range.getBoundingClientRect(), label = rt.getBoundingClientRect();
            const sheet = document.getElementById('sheet').getBoundingClientRect();
            annotations.push({base:nodes.textContent, reading:rt.textContent,
                right:label.left >= base.left && label.right > base.right,
                inside:label.x >= sheet.x-1 && label.right <= sheet.right+1 &&
                       label.y >= sheet.y-1 && label.bottom <= sheet.bottom+1,
                bold:nodes.querySelector('strong')?.textContent});
        }
    }
    return {all, annotations, integrity:api.inspect().textIntegrity};
}"""


class ShelfBodyRuby(unittest.TestCase):
    def test_printed_base_stays_whole_and_gloss_belongs_only_to_its_occurrence(self):
        first = {'type': 'body', 'text': '𠮷か\u3099。' + '東西南北' * 135}
        second = {'type': 'body', 'text': '山川山川。旧註。' + '山川' * 35}
        with sync_playwright() as pw:
            exe = (os.environ.get('CHROME_PATH') or os.environ.get('CHROME_BIN') or
                   shutil.which('chromium') or shutil.which('google-chrome') or pw.chromium.executable_path)
            browser = pw.chromium.launch(executable_path=exe, timeout=15000,
                                         args=['--no-sandbox', '--disable-dev-shm-usage'])
            try:
                page = browser.new_page(viewport={'width': 320, 'height': 568})
                page.set_default_timeout(5000)
                page.set_content(fixture(first, second))
                page.wait_for_function('window.StandardReader?.inspect().pages > 1')
                old = page.evaluate(COLLECT)
                self.assertTrue(old['integrity'])
                edge = len(old['all'][0])
                self.assertTrue(5 < edge < len(first['text'])-6)
                first['ruby'] = [reading(first['text'], 0, 1, 'よし', 1),
                                 reading(first['text'], edge-2, edge+2, 'ほうがく', 1)]
                # Public legacy emphasis offsets are UTF-16. The supplementary ideograph precedes this range.
                first['emphasis'] = [[edge, edge+2]]
                second['ruby'] = [reading(second['text'], 2, 4, 'やまかわ', 2)]
                second['glosses'] = [{'at': 5, 'base': '旧註', 'reading': 'きゅうちゅう'}]
                page.goto('about:blank')
                page.set_content(fixture(first, second))
                page.wait_for_function('window.StandardReader?.inspect().pages > 1')
                page.evaluate("""() => {
                    const record = () => { window.renderedFont = StandardReader.inspect().font; };
                    record();
                    new MutationObserver(record).observe(document.getElementById('text-flow'), {childList:true});
                }""")
                expected = first['text'] + second['text']
                for width, size in [(320, 20), (390, 22), (430, 24), (320, 30)]:
                    page.set_viewport_size({'width': width, 'height': 568})
                    current = page.evaluate('StandardReader.inspect().font')
                    self.assertLessEqual(current, size)
                    for _ in range((size - current) // 2):
                        page.locator('#larger').click()
                    page.wait_for_function("""size => window.renderedFont === size &&
                        document.getElementById('measure-sheet').getBoundingClientRect().width ===
                        document.getElementById('sheet').getBoundingClientRect().width""", arg=size)
                    result = page.evaluate(COLLECT)
                    self.assertTrue(result['integrity'])
                    self.assertEqual(''.join(result['all']), expected)
                    cuts = set()
                    pos = 0
                    for text in result['all']:
                        pos += len(text)
                        cuts.add(pos)
                    self.assertFalse(cuts.intersection(range(edge-1, edge+2)))
                    self.assertFalse(cuts.intersection({len(first['text'])+3}))
                    found = result['annotations']
                    self.assertEqual([(a['base'], a['reading']) for a in found],
                                     [('𠮷', 'よし'), (first['ruby'][1]['base'], 'ほうがく'), ('山川', 'やまかわ'),
                                      ('旧註', 'きゅうちゅう')])
                    self.assertEqual(found[1]['bold'], first['text'][edge-1:edge+1])
                    self.assertTrue(all(a['right'] and a['inside'] for a in found), found)
            finally:
                browser.close()


if __name__ == '__main__':
    unittest.main()
