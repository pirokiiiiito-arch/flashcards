"""Exercise production-boundary discovery with an independent synthetic touch reader."""

import base64
from io import BytesIO
import json
import os
from pathlib import Path
import shutil
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from PIL import Image, ImageDraw
from reader_shelf_probe import Reader
from reader_shelf_turns import TurnFrames, boundary_screens, measure_turns, source_pair


ACTIONS = {kind + action for kind in ('button', 'swipe')
           for action in ('Forward', 'Back', 'RapidReturn', 'RapidReverse')}
READER = '''<!doctype html><html lang="ja"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0}#sheet{position:fixed;inset:50px 12px 82px;
background:#fffdf8;font:24px serif;touch-action:none}footer{position:fixed;bottom:12px;left:12px;
right:12px;height:52px;display:flex;align-items:center;justify-content:space-between}
button{width:64px;height:42px;touch-action:manipulation}#location{width:155px;text-align:center;
font:16px sans-serif;white-space:pre-line}</style>
<main id="sheet"></main><footer><button id="back">前へ</button><div id="location"></div>
<button id="forward">次へ</button></footer>
<script>
const {sources,fault}=FIXTURE;
const paper=document.querySelector('#sheet'), number=document.querySelector('#location');
const total=sources.at(-1).at(-1);let current=0;const inputs=[];
function paint(i){
 current=Math.max(0,Math.min(i,sources.length-1));const n=current+1;
 paper.textContent=['港の古い地図','丘の上の書庫','森の入り口','朝の広場'][current]||'原本'+sources[current][0]+'の案内';
 number.textContent=(fault==='visible-number'?n+7:n)+' / '+sources.length+'\\n原本 '+
    (fault==='source'?total+2:sources[current][0])+' / '+total;
 if(fault==='visible-number')number.dataset.global=n+' / '+sources.length;
}
function move(kind,delta){inputs.push(kind);paint(current+delta)}
document.querySelector('#back').onclick=()=>move('button',-1);
document.querySelector('#forward').onclick=()=>move('button',1);
let startY;paper.addEventListener('touchstart',e=>{startY=e.changedTouches[0].clientY});
paper.addEventListener('touchend',e=>{const dy=e.changedTouches[0].clientY-startY;
 if(Math.abs(dy)>45)move('swipe',dy<0?1:-1)});
window.StandardReader={inspect:()=>({pages:sources.length,index:current,currentKind:'text',paintPending:false}),
 pageManifest:()=>sources.map(scans=>({scan:scans[0],kind:'text',sourceScans:scans})),gotoPage:paint};
paint(0);
</script></html>'''


def reader_for(end):
    return SimpleNamespace(ui={}, manifest={'range': [1, end]}, frame=None, part=None)


class ProductionBoundaries(unittest.TestCase):
    def test_absent_or_separated_sources_cannot_substitute_a_neighbor(self):
        for sources in ([[19], [21]], [[20], [9], [21]]):
            with self.subTest(sources=sources), self.assertRaises(ValueError):
                source_pair(sources, 20, 21)
        self.assertEqual(source_pair([[19], [20, 21], [22]], 20, 21), (1, 1))
        self.assertEqual(source_pair([[20], [20], [21]], 20, 21), (1, 2))

    def test_declared_interleaved_order_locates_all_three_crossings(self):
        records = [[19], [21], [20], [22]]
        self.assertEqual(boundary_screens(records, 20, 21, reordered=True), [(0, 1), (1, 2), (2, 3)])
        with self.assertRaises(ValueError):
            boundary_screens(records, 20, 21, reordered=False)

    def test_zero_boundaries_require_one_complete_range_and_one_runtime_section(self):
        # No browser calls beyond initialization are necessary when neither kind
        # of edge exists. Mapping or capturing a guessed page would fail here.
        page = SimpleNamespace(evaluate=lambda _: [])
        proof = measure_turns(page, reader_for(20), None, [(1, 20)])
        self.assertEqual(proof['sectionCount'], 1)
        self.assertEqual(proof['ranges'], [[1, 20]])
        self.assertEqual((proof['boundaries'], proof['sectionBoundaries'], proof['measurements']), ([], [], []))
        for ranges in ([], [[2, 20]], [[1, 19]], [[1, 9], [11, 20]]):
            with self.subTest(ranges=ranges), self.assertRaises(ValueError):
                measure_turns(page, reader_for(20), None, ranges)
        manifest_reader = reader_for(20)
        manifest_reader.manifest['segments'] = [{'start': 1, 'end': 10}, {'start': 11, 'end': 20}]
        with self.assertRaises(ValueError):
            measure_turns(page, manifest_reader, None, [(1, 20)])


class TouchReader(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from playwright.sync_api import sync_playwright
        cls.pw = sync_playwright().start()
        cls.addClassCleanup(cls.pw.stop)
        exe = (os.environ.get('CHROME_PATH') or os.environ.get('CHROME_BIN') or shutil.which('chromium') or
               shutil.which('google-chrome') or cls.pw.chromium.executable_path)
        if not Path(exe).is_file():
            raise unittest.SkipTest('Chromium is required for the touch reader fixture')
        cls.browser = cls.pw.chromium.launch(executable_path=exe, args=['--no-sandbox', '--disable-gpu',
                                                                       '--no-zygote', '--disable-dev-shm-usage'])
        cls.addClassCleanup(cls.browser.close)

    def fixture(self, sources, fault=None):
        ctx = self.browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=3,
                                       is_mobile=True, has_touch=True)
        self.addCleanup(ctx.close)
        page = ctx.new_page()
        page.set_content(READER.replace('FIXTURE', json.dumps({'sources': sources, 'fault': fault})))
        return page, reader_for(sources[-1][-1]), ctx.new_cdp_session(page)

    def custom_ui(self, sources=None, corrupt_visible=False):
        # There is no page-manifest API. The gate must derive order and totals
        # from what this reader displays and use its real scan selector to visit references.
        page, _, cdp = self.fixture(sources or [[n] for n in range(1, 7)])
        page.evaluate("""corrupt => {
          delete window.StandardReader;
          const jump=document.createElement('select');jump.id='jump-to-scan';
          sources.flat().forEach(n=>jump.add(new Option(String(n),String(n))));
          jump.onchange=()=>paint(sources.findIndex(ns=>ns.includes(Number(jump.value))));document.body.prepend(jump);
          const write=paint;window.paint=i=>{write(i);number.dataset.sources=JSON.stringify(sources[current]);
            number.dataset.position=String(current+1);number.dataset.total=String(sources.length);
            if(corrupt)number.textContent='99 / '+sources.length+' 原本 '+sources[current][0]+' / '+total;};
          paint(0);
          for(const [current,custom] of [['sheet','folio'],['location','counter'],['back','earlier'],['forward','later']]){
            const node=document.getElementById(current);node.id=custom;
            for(const rule of document.styleSheets[0].cssRules){
              if(rule.selectorText?.includes('#'+current))rule.selectorText=rule.selectorText.replace('#'+current,'#'+custom);
            }
          }
        }""", corrupt_visible)
        ui = {'position': {'selector': '#counter'}, 'scan': {'selector': '#counter', 'pattern': r'原本\s*(\d+)'},
              'goto': [{'action': 'select', 'selector': '#jump-to-scan', 'value': '{scan}'}],
              'turns': {'body': '#folio', 'number': '#counter', 'prev': '#earlier', 'next': '#later'}}
        return page, Reader(page, {'range': [1, 6]}, {'ui': ui}), cdp

    def assert_operations(self, measurement, stationary=False):
        tests = measurement['tests']
        self.assertEqual(set(tests), ACTIONS)
        for action, result in tests.items():
            self.assertGreaterEqual(result['frames'], 2)
            self.assertEqual(result['intermediateFrames'], 0)
            if stationary:
                self.assertEqual(result['sequence'], [0])
            elif 'Rapid' in action:
                self.assertIn(result['sequence'], [[0], [0, 1, 0]])
            else:
                self.assertEqual(result['sequence'], [0, 1])

    def test_single_document_has_two_production_edges_and_eight_real_inputs_per_edge(self):
        sources = [list(range(1, 20)), [20, 21], list(range(22, 41)), [41, 42]]
        page, reader, cdp = self.fixture(sources)
        result = measure_turns(page, reader, cdp, [(1, 20), (21, 40), (41, 42)])
        self.assertEqual(result['sectionCount'], 1)
        self.assertEqual(result['sectionBoundaries'], [])
        self.assertEqual([(b['after'], b['before'], b['kind']) for b in result['boundaries']],
                         [(20, 21, 'shared-page'), (40, 41, 'within-document')])
        first, second = result['boundaries']
        self.assertEqual(first['sharedScans'], [20, 21])
        self.assertEqual(len(result['measurements']), 2)
        for edge, pair in zip((first, second), ((1, 2), (2, 3))):
            measured = result['measurements'][edge['measurement']]
            self.assertEqual((measured['from'], measured['to']), ([0, pair[0]], [0, pair[1]]))
            self.assert_operations(measured)
        # Each modality sends two ordinary turns and two two-input rapid reversals per edge.
        actual = page.evaluate('inputs')
        self.assertEqual((actual.count('button'), actual.count('swipe')), (12, 12))

    def test_shared_single_screen_keeps_sources_and_checks_all_no_op_inputs(self):
        page, reader, cdp = self.fixture([list(range(1, 22))])
        result = measure_turns(page, reader, cdp, [(1, 20), (21, 21)])
        self.assertEqual(len(result['boundaries']), 1)
        edge = result['boundaries'][0]
        self.assertEqual(edge['kind'], 'shared-page')
        self.assertEqual(edge['sharedScans'], list(range(1, 22)))
        self.assertEqual(edge['totalScreens'], 1)
        measurement = result['measurements'][edge['measurement']]
        self.assertEqual(measurement['from'], measurement['to'])
        self.assert_operations(measurement, stationary=True)

    def test_reordered_manifest_registers_every_display_crossing(self):
        sources = [list(range(1, 20)), [21], [20], [22]]
        page, reader, cdp = self.fixture(sources)
        reader.manifest['readingFlow'] = {'scanOrder': [*range(1, 20), 21, 20, 22]}
        proof = measure_turns(page, reader, cdp, [(1, 20), (21, 22)])
        self.assertEqual(len(proof['boundaries']), 1)
        crossings = proof['boundaries'][0]['displayCrossings']
        self.assertEqual([(c['fromScans'][-1], c['toScans'][0]) for c in crossings],
                         [(19, 21), (21, 20), (20, 22)])
        self.assertEqual(len(proof['measurements']), 3)
        for c in crossings:
            self.assert_operations(proof['measurements'][c['measurement']])

    def test_authoritative_blank_image_and_cover_are_valid_endpoints(self):
        page, reader, cdp = self.fixture([[1], [2]])
        blank = Image.new('RGB', (70, 110), 'white')
        cover = blank.copy()
        ImageDraw.Draw(cover).rectangle((8, 10, 62, 96), fill='#28557e')
        urls = []
        for bitmap in (blank, cover):
            png = BytesIO()
            bitmap.save(png, format='PNG')
            urls.append('data:image/png;base64,' + base64.b64encode(png.getvalue()).decode())
        page.evaluate("""async urls => {
          const images=await Promise.all(urls.map(async url=>{const im=new Image();im.src=url;
            im.style.cssText='display:block;width:100%;height:100%';await im.decode();return im}));
          const write=paint;window.paint=i=>{write(i);paper.replaceChildren(images[current])};
          StandardReader.gotoPage=paint;
          StandardReader.pageManifest=()=>[{scan:1,kind:'scan'},{scan:2,kind:'portrait'}];
          paint(0);
        }""", urls)
        pixels = page.screenshot(clip=page.locator('#sheet').bounding_box(), scale='css')
        self.assertEqual(Image.open(BytesIO(pixels)).convert('RGB').getextrema(), ((255, 255),) * 3)
        proof = measure_turns(page, reader, cdp, [(1, 1), (2, 2)])
        self.assert_operations(proof['measurements'][0])
        page.evaluate('StandardReader.gotoPage(1)')
        self.assertEqual(page.locator('#sheet img').get_attribute('src'), urls[1])

    def test_custom_reader_without_page_api_measures_two_boundaries_and_visible_totals(self):
        page, reader, cdp = self.custom_ui()
        self.assertFalse(page.evaluate('Boolean(window.StandardReader||window.NovelReader||window.WH1BookReader)'))
        proof = measure_turns(page, reader, cdp, [(1, 2), (3, 4), (5, 6)])
        self.assertEqual(proof['sectionCount'], 1)
        self.assertEqual([(edge['after'], edge['before']) for edge in proof['boundaries']], [(2, 3), (4, 5)])
        self.assertEqual(len(proof['measurements']), 2)
        for edge in proof['boundaries']:
            left, right = edge['after'], edge['before']
            m = proof['measurements'][edge['measurement']]
            self.assertEqual((m['from'], m['to']), ([0, left, left], [0, right, right]))
            self.assert_operations(m)
            self.assertEqual((edge['fromScans'], edge['toScans']), ([left], [right]))
            self.assertEqual(len(edge['displayCrossings']), 1)
        self.assertEqual(page.evaluate("inputs.filter(x=>x==='swipe').length"), 12)

    def test_custom_source_lists_cover_last_scan_and_interleaved_edges(self):
        page, reader, cdp = self.custom_ui([[1], [3], [2], [4, 5], [6]])
        reader.manifest['readingFlow'] = {'scanOrder': [1, 3, 2, 4, 5, 6]}
        reader.ui['turns']['sourceScans'] = {'selector': '#counter', 'attribute': 'data-sources'}
        proof = measure_turns(page, reader, cdp, [(1, 2), (3, 4), (5, 6)])
        first, second = proof['boundaries']
        self.assertEqual([(x['fromScans'], x['toScans']) for x in first['displayCrossings']],
                         [([1], [3]), ([3], [2]), ([2], [4, 5])])
        self.assertTrue(any(x['sharedScans'] == [4, 5] for x in second['displayCrossings']))
        for m in proof['measurements']:
            self.assert_operations(m)

    def test_custom_final_shared_scan_is_the_true_end(self):
        page, reader, cdp = self.custom_ui([[1, 2], [3, 4], [5, 6]])
        reader.ui['turns']['sourceScans'] = {'selector': '#counter', 'attribute': 'data-sources'}
        proof = measure_turns(page, reader, cdp, [(1, 2), (3, 4), (5, 6)])
        self.assertEqual(proof['boundaries'][-1]['toScans'], [5, 6])
        self.assertEqual(len(proof['measurements']), 2)
        for m in proof['measurements']:
            self.assert_operations(m)

    def test_custom_data_attributes_do_not_override_incorrect_visible_number(self):
        page, reader, cdp = self.custom_ui(corrupt_visible=True)
        reader.ui['position']['attribute'] = 'data-position'
        reader.ui['turns']['total'] = {'selector': '#counter', 'attribute': 'data-total'}
        with patch.object(TurnFrames, 'reference', side_effect=AssertionError('captured false reference')) as ref:
            with self.assertRaisesRegex(ValueError, '番号|位置|ページ'):
                measure_turns(page, reader, cdp, [(1, 2), (3, 4), (5, 6)])
            ref.assert_not_called()

    def test_permanently_wrong_page_or_source_fails_before_any_reference_capture(self):
        from playwright.sync_api import Error as BrowserError
        sources = [list(range(1, 21)), [21]]
        for fault in ('visible-number', 'source'):
            with self.subTest(fault=fault):
                page, reader, cdp = self.fixture(sources, fault)
                with patch.object(TurnFrames, 'reference', side_effect=AssertionError('captured false reference')) as ref:
                    with self.assertRaisesRegex((ValueError, BrowserError), '番号|読書位置'):
                        measure_turns(page, reader, cdp, [(1, 20), (21, 21)])
                    ref.assert_not_called()


if __name__ == '__main__':
    unittest.main()
