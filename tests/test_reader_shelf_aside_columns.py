"""Exercise the inset renderer and its offscreen measurement with a synthetic book."""
import io
import json
import os
import shutil
import unittest
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

TEMPLATE = Path(__file__).resolve().parents[1] / 'reader/library/wh3-format.html'


class AsideColumns(unittest.TestCase):
    def test_inset_columns_match_measurement_and_source_order(self):
        def paragraph(text):
            return {'type': 'note', 'readingRole': 'aside', 'text': text}

        blocks = [
            {'type': 'body', 'text': '通常の文章'},
            {'type': 'heading', 'readingRole': 'aside-heading', 'text': '見出し'},
            paragraph('東西南北' * 17),
            paragraph('春夏秋冬' * 23),
            paragraph('山川草木' * 33),
        ]
        book = {'bookId': 'fixture', 'title': '表示試験', 'range': [1, 1],
                'pages': [{'scan': 1, 'blocks': blocks, 'figures': []}]}
        data = '<script type="application/json" id="bookdata">' + json.dumps(book) + '</script>'
        html = TEMPLATE.read_text(encoding='utf-8').replace('<!--WH3_PRIVATE_DATA-->', data)
        with sync_playwright() as pw:
            if webkit := os.environ.get('WEBKIT_PATH'):
                browser = pw.webkit.launch(executable_path=webkit)
            else:
                exe = os.environ.get('CHROME_PATH') or os.environ.get('CHROME_BIN') or shutil.which('chromium') or pw.chromium.executable_path
                browser = pw.chromium.launch(executable_path=exe, args=['--no-sandbox', '--disable-dev-shm-usage'])
            try:
                page = browser.new_page(viewport={'width': 390, 'height': 666})
                page.route('http://reader.test/', lambda route: route.fulfill(body=html, content_type='text/html'))
                page.goto('http://reader.test/')
                page.wait_for_function('window.StandardReader?.inspect().pages > 0')
                result = page.evaluate(INSPECT_COLUMNS)
                self.assertEqual(''.join(result['texts']), ''.join(block['text'] for block in blocks))
                page.evaluate('i => StandardReader.gotoPage(i)', result['sample']['index'])
                page.wait_for_function('!StandardReader.inspect().paintPending')
                raster = Image.open(io.BytesIO(page.screenshot())).convert('L')
                for x, y, width, height in result['sample']['columns']:
                    # Inspect the interior of a Kanji, away from paragraph rules and adjacent columns.
                    box = tuple(round(v) for v in (x + width*.15, y + height*.15, x + width*.85, y + height*.85))
                    self.assertGreater(sum(raster.crop(box).histogram()[:140]), 2, f'blank glyph at {box}')
            finally:
                browser.close()


INSPECT_COLUMNS = """async () => {
    const live = document.querySelector('#text-flow'), measure = document.querySelector('#measure-text');
    const texts = [];
    let plainPages = 0, sample, wrappedColumns = 0;
    const check = (ok, message) => { if (!ok) throw Error(message); };
    for (let i = 0; i < StandardReader.inspect().pages; i++) {
        StandardReader.gotoPage(i);
        const deadline = performance.now() + 5000;
        while (StandardReader.inspect().paintPending && performance.now() < deadline) await new Promise(requestAnimationFrame);
        check(!StandardReader.inspect().paintPending, 'page did not finish rendering');
        texts.push(live.textContent);
        if (!live.querySelector('.aside-body')) {
            plainPages++;
            check(getComputedStyle(live).writingMode === 'vertical-rl', 'ordinary prose writing mode');
            continue;
        }
        const columns = new Map();
        measure.replaceChildren(...Array.from(live.children, p => p.cloneNode(true)));
        const geometry = flow => {
            const origin = flow.getBoundingClientRect(), result = [];
            check(getComputedStyle(flow).overflowX === 'visible', 'inset flow clips vertical glyphs');
            let previousLeft = Infinity;
            for (const paragraph of flow.children) {
                const box = paragraph.getBoundingClientRect();
                check(box.right <= previousLeft + 0.5, 'paragraphs overlap or run left to right');
                previousLeft = box.left;
                check(getComputedStyle(paragraph).writingMode === 'vertical-rl', 'paragraph writing mode');
                const range = document.createRange(), text = paragraph.firstChild;
                let previous;
                for (let j = 0; j < text.length; j++) {
                    range.setStart(text, j);
                    range.setEnd(text, j + 1);
                    const r = range.getBoundingClientRect();
                    const x = r.x - origin.x, y = r.y - origin.y;
                    check(r.width > 0 && r.height > 0 && x >= -0.5 && y >= -0.5
                          && x + r.width <= origin.width + 0.5 && y + r.height <= origin.height + 0.5,
                          'glyph outside its flow');
                    if (previous) {
                        if (Math.abs(x - previous.x) < 0.5) check(y > previous.y, 'column order');
                        else { check(x < previous.x, 'wrapped column order'); wrappedColumns++; }
                    }
                    if (flow === live) {
                        check(paragraph.contains(document.elementFromPoint(r.x+r.width/2, r.y+r.height/2)), 'covered glyph');
                        if (paragraph.classList.contains('aside-body'))
                            columns.set(r.x, [r.x, r.y, r.width, r.height]);
                    }
                    previous = {x, y};
                    result.push(x, y, r.width, r.height);
                }
            }
            return result;
        };
        const visible = geometry(live), measured = geometry(measure);
        if (!sample && live.querySelector('.aside-body + .aside-body'))
            sample = {index:i, columns:[...columns.values()]};
        check(visible.every((v, j) => Math.abs(v-measured[j]) < 0.1), 'measure/live geometry mismatch');
    }
    check(plainPages && sample && sample.columns.length > 2 && wrappedColumns, 'fixture missed required page layouts');
    return {texts, sample};
}"""
