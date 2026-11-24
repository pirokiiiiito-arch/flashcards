"""Exercise the printed poetry contents and its volume menu in a mobile reader."""
import base64
import hashlib
import io
import json
import os
import re
import shutil
import unittest
from pathlib import Path
from urllib.parse import urlsplit

from PIL import Image
from playwright.sync_api import expect, sync_playwright


TEMPLATES = Path(__file__).resolve().parents[1] / 'templates/reader/v2'
CHAPTER = '一　光の色'
POEMS = [('灯', '7', 3), ('淡い朝焼け', '25', 5), ('夜の向こうの風', '128', 6)]


def make_book(mode):
    originals = []
    for scan in range(1, 7):
        stream = io.BytesIO()
        Image.new('L', (64, 64), scan * 36).save(stream, format='PNG')
        image = stream.getvalue()
        originals.append({'scan': scan, 'sha256': hashlib.sha256(image).hexdigest(),
                          'src': 'data:image/png;base64,' + base64.b64encode(image).decode()})

    def ruby(text, base, reading):
        start = text.index(base)
        return [{'start': start, 'end': start + len(base), 'base': base, 'reading': reading,
                 'sourceScan': 1, 'sourceImageSha256': originals[0]['sha256'],
                 'sourceBox': [12, 18, 18, 40], 'reviewStatus': 'verified'}]

    blocks = [{'type': 'heading', 'id': 'chapter-link', 'scan': 1, 'text': CHAPTER,
               'ruby': ruby(CHAPTER, '光', 'ひかり'), 'sourceRole': 'contents-section',
               'printedSection': {'label': CHAPTER, 'target': 2}}]
    for i, (title, number, target) in enumerate(POEMS):
        if i == 2:
            blocks.append({'type': 'toc', 'id': 'divider', 'scan': 1, 'text': '☆　☆　☆',
                           'sourceRole': 'contents-separator', 'printedSeparator': True})
        blocks.append({'type': 'toc', 'id': f'entry-{i}', 'scan': 1,
                       'text': title + '　' + number,
                       'printedContents': {'label': title, 'number': number, 'target': target}})
        if i == 1:
            blocks[-1]['ruby'] = ruby(title, '朝焼', 'あさや')
    blocks.append({'type': 'heading', 'id': 'chapter-title', 'scan': 2, 'text': CHAPTER})
    for i, (title, _, target) in enumerate(POEMS):
        blocks.append({'type': 'heading', 'id': f'poem-{i}', 'scan': target, 'text': title})
        blocks.append({'type': 'body', 'id': f'line-{i}', 'scan': target,
                       'lineRole': 'prose', 'text': '空に浮かぶ'})
        if i == 0:
            # This scan is only represented inside a paragraph that begins on scan 3.
            blocks.append({'type': 'body', 'id': 'continuation', 'scan': 4, 'lineRole': 'prose',
                           'joinPrevious': True, 'text': '小さな雲。'})
    book = {'id': 'poetry-contents-fixture', 'title': '目次の試験', 'templateVariant': 'poetry',
            'totalScans': 6, 'kind': mode, 'originals': originals}
    if mode == 'mixed':
        book['entries'] = [{'kind': 'text', 'scan': b['scan'], 'blocks': [b]} for b in blocks]
    else:
        book['blocks'] = blocks
    return book


# Inspect one glyph at a time: native vertical layout can show the right strings
# while silently turning two or three digits sideways.
GEOMETRY = """row => {
    const label = row.querySelector('.printed-label'), leader = row.querySelector('.printed-leader');
    const number = row.querySelector('.printed-number'), sheet = document.querySelector('#sheet').getBoundingClientRect();
    const walker = document.createTreeWalker(number, NodeFilter.SHOW_TEXT);
    const centers = [], range = document.createRange();
    for (let text; text = walker.nextNode();) {
        for (let i = 0; i < text.length; i++) {
            range.setStart(text, i);
            range.setEnd(text, i + 1);
            const rect = range.getBoundingClientRect();
            centers.push(rect.top + rect.height / 2);
        }
    }
    const top = label.getBoundingClientRect(), middle = leader.getBoundingClientRect();
    const bottom = number.getBoundingClientRect();
    const axes = [middle.left + middle.width / 2, bottom.left + bottom.width / 2];
    const baseWalker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
    for (let text; text = baseWalker.nextNode();) {
        if (text.parentElement.closest('rt, rp')) continue;
        for (let i = 0; i < text.length; i++) {
            range.setStart(text, i);
            range.setEnd(text, i + 1);
            const rect = range.getBoundingClientRect();
            axes.push(rect.left + rect.width / 2);
        }
    }
    return {labelStart: top.top, numberEnd: bottom.bottom, digits: number.textContent, centers, axes,
        leaderHeight: middle.height, labelEnd: top.bottom, leaderStart: middle.top, leaderEnd: middle.bottom,
        numberStart: bottom.top, insideSheet: [top, middle, bottom].every(rect =>
            rect.left >= sheet.left - 1 && rect.right <= sheet.right + 1 &&
            rect.top >= sheet.top - 1 && rect.bottom <= sheet.bottom + 1)};
}"""


class PoetryContents(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        pw = sync_playwright().start()
        cls.addClassCleanup(pw.stop)
        if webkit := os.environ.get('WEBKIT_PATH'):
            cls.browser = pw.webkit.launch(executable_path=webkit)
        else:
            chrome = (os.environ.get('CHROME_PATH') or os.environ.get('CHROME_BIN') or
                      shutil.which('chromium') or shutil.which('google-chrome'))
            cls.browser = pw.chromium.launch(executable_path=chrome, args=['--no-sandbox'])
        cls.addClassCleanup(cls.browser.close)

    def open_reader(self, mode, width, height, font, point=0, scan=1):
        book = make_book(mode)
        html, substitutions = re.subn(
            r'<script>window\.READER_BOOK=.*?</script>',
            lambda _: '<script>window.READER_BOOK=' + json.dumps(book) + ';</script>',
            (TEMPLATES / 'poetry.html').read_text(), flags=re.S)
        self.assertEqual(substitutions, 1)
        page = self.browser.new_page(viewport={'width': width, 'height': height}, has_touch=True,
                                     is_mobile=True, locale='ja-JP')
        self.addCleanup(page.close)
        page.set_default_timeout(5000)
        position = {'schema': 'standard-reader-position-v2', 'bookId': book['id'], 'point': point,
                    'font': font, 'scan': scan}
        page.add_init_script('localStorage.setItem("novel-reader-v1:' + book['id'] + '",'
                             + json.dumps(json.dumps(position)) + ')')

        def serve(route):
            name = Path(urlsplit(route.request.url).path).name
            if name == 'index.html':
                route.fulfill(content_type='text/html', body=html)
            else:
                route.fulfill(path=TEMPLATES / name)

        page.route('http://poetry.test/**', serve)
        page.goto('http://poetry.test/index.html')
        page.wait_for_function('window.NovelReader && (NovelReader.inspect().pages || NovelReader.inspect().warning)')
        # The initial ResizeObserver can replace the visible columns on the next frame.
        page.evaluate('''async () => {
            await document.fonts.ready;
            for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
        }''')
        state = page.evaluate('NovelReader.inspect()')
        self.assertFalse(state['warning'], state)
        self.assertTrue(state['textIntegrity'])
        self.assertEqual(state['font'], font)
        return page

    def check_leader_ink(self, page, leader):
        box = leader.bounding_box()
        x = round(box['x'] + box['width'] / 2)
        y = round(box['y'] + box['height'] / 2)
        shot = Image.open(io.BytesIO(page.screenshot(scale='css'))).convert('L')
        marks = [min(shot.getpixel((pixel, line)) for pixel in range(x - 2, x + 3)) < 200
                 for line in range(y - 8, y + 8)]
        self.assertIn(True, marks, 'no ink between title and page number')
        self.assertIn(False, marks, 'solid line between title and page number')

    def inspect_printed_contents(self, page):
        manifest = page.evaluate('NovelReader.pageManifest()')
        flow = page.locator('#text-flow')
        locations = {}
        geometry = []
        for i, p in enumerate(manifest):
            if p['scan'] != 1:
                continue
            page.evaluate('i => NovelReader.gotoPage(i)', i)
            if flow.locator('.printed-section').count():
                locations['chapter'] = i
                self.assertEqual(flow.locator('.printed-section rt').all_text_contents(), ['ひかり'])
            if flow.locator('.printed-separator').count():
                self.assertEqual(flow.locator('.printed-separator').inner_text(), '☆　☆　☆')
                locations['separator'] = i
            for row in flow.locator('.printed-contents').all():
                key = row.get_attribute('data-body-id')
                self.assertNotIn(key, locations)
                locations[key] = i
                leader = row.locator('.printed-leader')
                self.assertEqual(leader.count(), 1)
                geometry.append(row.evaluate(GEOMETRY))
                if key == 'entry-0':
                    self.check_leader_ink(page, leader)
                if key == 'entry-1':
                    self.assertEqual(row.locator('rt').all_text_contents(), ['あさや'])
        self.assertEqual(locations['chapter'], locations['entry-0'])
        self.assertEqual(locations['separator'], locations['entry-2'])
        self.assertEqual([g['digits'] for g in geometry], [n for _, n, _ in POEMS])
        for prop in ['labelStart', 'numberEnd']:
            values = [g[prop] for g in geometry]
            self.assertLessEqual(max(values) - min(values), 1, (prop, values))
        for g in geometry:
            self.assertTrue(g['insideSheet'], g)
            self.assertGreater(g['leaderHeight'], 3, g)
            self.assertGreaterEqual(g['leaderStart'] + 1, g['labelEnd'], g)
            self.assertLessEqual(g['leaderEnd'] - 1, g['numberStart'], g)
            self.assertLessEqual(max(g['centers']) - min(g['centers']), 1, g)
            self.assertLessEqual(max(g['axes']) - min(g['axes']), 1.5, g)

        return locations

    def check_links(self, page, locations):
        flow = page.locator('#text-flow')
        page.evaluate('i => NovelReader.gotoPage(i)', locations['chapter'])
        flow.locator('.printed-section').click()
        self.assertTrue(flow.locator('[data-heading-id="chapter-title"]').is_visible())
        for i, (title, _, _) in enumerate(POEMS):
            target = f'entry-{i}'
            page.evaluate('i => NovelReader.gotoPage(i)', locations[target])
            link = flow.locator(f'[data-body-id="{target}"]')
            expect(link).to_have_role('link')
            expect(link).to_have_accessible_name(re.compile(re.escape(title)))
            if i == 0:
                link.locator('.printed-leader').tap()
            else:
                link.press(['Enter', 'Space'][i - 1])
            self.assertTrue(flow.locator(f'[data-heading-id="poem-{i}"]').is_visible(), title)

        destinations = [(CHAPTER, 'chapter-title')] + [(p[0], f'poem-{i}') for i, p in enumerate(POEMS)]
        for i, (title, heading) in enumerate(destinations):
            page.locator('#all').click()
            entries = page.locator('#menu-items .poetry-menu-item')
            self.assertEqual(entries.count(), 4)
            expect(entries.nth(i)).to_have_accessible_name(re.compile(re.escape(' '.join(title.split()))))
            entries.nth(i).click()
            self.assertTrue(page.locator('#menu-backdrop').is_hidden())
            self.assertTrue(flow.locator(f'[data-heading-id="{heading}"]').is_visible(), title)

    def check_original_menu(self, page):
        manifest = page.evaluate('NovelReader.pageManifest()')
        self.assertNotIn(4, [p['scan'] for p in manifest])
        page.locator('#all').click()
        details = page.locator('#menu-items details')
        details.locator('summary').click()
        buttons = details.get_by_role('button')
        self.assertEqual(buttons.count(), 6)
        buttons.filter(has_text=re.compile(r'原本\s*4(?:\D|$)')).click()
        location = manifest[page.evaluate('NovelReader.inspect().index')]
        self.assertIn(4, [span['scan'] for span in location['sourceSpans']])
        self.assertEqual(page.locator('#page-minor').inner_text(), '原本 4 / 6')
        self.assertTrue(page.locator('#menu-backdrop').is_hidden())
        page.locator('#original').click()
        image = page.locator('#original-image')
        self.assertTrue(image.is_visible())
        self.assertEqual(image.get_attribute('src'), page.evaluate(
            'READER_BOOK.originals.find(original => original.scan === 4).src'))
        page.locator('#original-close').click()
        page.locator('#all').click()
        page.locator('#menu-items .poetry-menu-item').filter(has_text=POEMS[0][0]).click()
        self.assertEqual(page.locator('#page-minor').inner_text(), '原本 3 / 6')

    def test_selected_source_survives_an_edition_with_longer_front_matter(self):
        # The saved text offset falls in the newly expanded contents.
        page = self.open_reader('mixed', 390, 675, 20, point=6, scan=4)
        self.assertEqual(page.locator('#page-minor').inner_text(), '原本 4 / 6')
        self.assertTrue(page.locator('#text-flow [data-heading-id="poem-0"]').is_visible())
        page.locator('#larger').click()
        page.evaluate('''async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame); }''')
        self.assertEqual(page.evaluate('NovelReader.inspect().font'), 22)
        self.assertEqual(page.locator('#page-minor').inner_text(), '原本 4 / 6')
        self.assertTrue(page.locator('#text-flow [data-heading-id="poem-0"]').is_visible())

    def test_printed_contents_and_named_menu(self):
        for mode in ('text', 'mixed'):
            for width, height, font in [(390, 675, 20), (320, 568, 30)]:
                with self.subTest(mode=mode, width=width, font=font):
                    page = self.open_reader(mode, width, height, font)
                    locations = self.inspect_printed_contents(page)
                    self.check_links(page, locations)
                    self.check_original_menu(page)
                    page.close()
