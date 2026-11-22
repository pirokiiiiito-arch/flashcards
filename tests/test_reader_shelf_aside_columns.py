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


# Original 448-byte WOFF2, generated with FontTools for this fixture. Each test character
# maps to one centered rectangular ink mark, with a 1000-unit square advance in both axes.
INK_FONT = (
    'd09GMgABAAAAAAHAAAwAAAAAA6QAAAF0AAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAABmAAgUwKHDcBNgIkAwYLBgAE'
    'IAWBJQctFyQYBhveAmAehXHD3SwtwqAV/+tjcoyH5w9/5973/ty0eIdFgSWSSAIhRBxFf3FXa7oXQpuJJlRRLH+i'
    'gLnA4Ih1hC9a1PXEFZJsuePbr+0XSJxQzEFbqwUWaCRtoScBJppYQFnzMN2mKDIPfWMeMf7aVSn3mNVQlWonvHd5'
    'cc5y8Zb/DBgDlgHQDqkL5jHwj6ofYA87qLovTlXBfGz+sq6sTjfbV/Y/BF7jIwl+UpQst521/w1gYz1jE7Pc/3+w'
    '/BKvDq8WTu2n5OPn8eHu09bsJm/jevva/erN6uywekhns9HfaBQfIYRMpSIcTVhSAVE/8cxctbw0XwAEgu99fijI'
    '1ry2S7nDTRQ32STiwFdeZw5AkSBQ1t9pRpyqu/qgmAUQSFWABABA0wcEQotVe6DWDE0jQ0XUjjC0NqQ4DJs28IYV'
    'qvGa2fjAlUOS542AKaiKqzEzsohLqssJI2tyNOKEz5HNzzTOqAAi/v8YlLsrYuUv4tgOVw=='
)


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
        css = ("@font-face{font-family:InsetQA;src:url(data:font/woff2;base64," + INK_FONT
               + ") format('woff2')}.text-flow{font-family:InsetQA}")
        html = html.replace('</style>', css + '</style>', 1)
        with sync_playwright() as pw:
            if webkit := os.environ.get('WEBKIT_PATH'):
                browser = pw.webkit.launch(executable_path=webkit)
            else:
                exe = os.environ.get('CHROME_PATH') or os.environ.get('CHROME_BIN') or shutil.which('chromium') or pw.chromium.executable_path
                browser = pw.chromium.launch(executable_path=exe, args=['--no-sandbox', '--disable-dev-shm-usage'])
            try:
                page = browser.new_page(viewport={'width': 400, 'height': 666})
                page.route('http://reader.test/', lambda route: route.fulfill(body=html, content_type='text/html'))
                page.goto('http://reader.test/')
                self.assertEqual(page.evaluate("async () => (await document.fonts.load('20px InsetQA','東')).length"), 1)
                page.set_viewport_size({'width': 390, 'height': 666})
                page.wait_for_function("window.StandardReader?.inspect().pages > 0 && "
                                       "document.querySelector('#measure-sheet').getBoundingClientRect().width === 390")
                result = page.evaluate(INSPECT_COLUMNS)
                self.assertEqual(''.join(result['texts']), ''.join(block['text'] for block in blocks))
                columns = page.evaluate(MARKER_COLUMNS, result['sampleIndex'])
                self.assertGreater(len(columns), 2)
                raster = Image.open(io.BytesIO(page.screenshot())).convert('L')
                for points in columns:
                    for x, y in (points[0], points[len(points)//2], points[-1]):
                        box = (round(x)-4, round(y)-4, round(x)+5, round(y)+5)
                        self.assertGreater(sum(raster.crop(box).histogram()[:140]), 2, f'blank marker at {box}')
            finally:
                browser.close()


INSPECT_COLUMNS = """async () => {
    const live = document.querySelector('#text-flow'), measure = document.querySelector('#measure-text');
    const texts = [];
    let plainPages = 0, sampleIndex = -1, wrappedColumns = 0;
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
                    if (flow === live)
                        check(paragraph.contains(document.elementFromPoint(r.x+r.width/2, r.y+r.height/2)), 'covered glyph');
                    previous = {x, y};
                    result.push(x, y, r.width, r.height);
                }
            }
            return result;
        };
        const visible = geometry(live), measured = geometry(measure);
        if (sampleIndex < 0 && live.querySelector('.aside-body + .aside-body')) sampleIndex = i;
        check(visible.every((v, j) => Math.abs(v-measured[j]) < 0.1), 'measure/live geometry mismatch');
    }
    check(plainPages && sampleIndex >= 0 && wrappedColumns, 'fixture missed required page layouts');
    return {texts, sampleIndex};
}"""

MARKER_COLUMNS = """async index => {
    StandardReader.gotoPage(index);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (StandardReader.inspect().paintPending || StandardReader.inspect().index !== index) throw Error('sample page not ready');
    const columns = new Map(), range = document.createRange();
    for (const p of document.querySelectorAll('#text-flow > .aside-body')) {
        const text = p.firstChild;
        for (let i = 0; i < text.length; i++) {
            range.setStart(text, i);
            range.setEnd(text, i + 1);
            const r = range.getBoundingClientRect(), x = Math.round(r.x+r.width/2);
            if (!columns.has(x)) columns.set(x, []);
            columns.get(x).push([x, r.y+r.height/2]);
        }
    }
    return [...columns.values()];
}"""
