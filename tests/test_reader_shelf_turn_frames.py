"""Pixel turn tests use synthetic paper, numbers, and a synthetic cover only."""

import os
from pathlib import Path
import shutil
import sys
import unittest

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from reader_shelf_turn_frames import TurnFrames, _Pixels, _verify


class Sequences(unittest.TestCase):
    old = ('old-body', 'first-number')
    new = ('new-body', 'next-number')

    def test_compositor_frames_follow_swap_time_and_retain_invalid_intermediate_frames(self):
        film=TurnFrames(None,None,None,None)
        a,b=self.old,self.new
        film.pending=[(1,a),(3,b),(2,a),(4,b)]
        ordered=film._presentation_order()
        self.assertEqual(ordered,[a,a,b,b])
        self.assertEqual(_verify(ordered,[a,b],'forward',False)['frames'],4)
        film.pending.append((3.5,('invalid','paper')))
        with self.assertRaises(ValueError):
            _verify(film._presentation_order(),[a,b],'forward',False)
        for timing in [None,float('nan'),1]:
            film.pending=[(1,a),(timing,b)]
            with self.assertRaises(ValueError):
                film._presentation_order()

    def test_rounding_uses_a_per_channel_bound_in_every_pixel(self):
        reference = Image.new('RGB', (64, 16), (253, 200, 120))
        rounded = reference.copy()
        for i in range(17):
            rounded.putpixel((i, 1), (252, 201, 120))
        a, b = _Pixels(reference), _Pixels(rounded)
        self.assertNotEqual(a.digest, b.digest)
        self.assertEqual(a, b)
        rounded.putpixel((1, 8), (253, 200, 118))
        self.assertNotEqual(a, _Pixels(rounded))
        unchanged = _Pixels(Image.new('RGB', (1, 1), 'white'))
        ends = [(_Pixels(Image.new('RGB', (4, 2), (k, 0, 0))), unchanged) for k in (70, 72)]
        ambiguous = (_Pixels(Image.new('RGB', (4, 2), (71, 0, 0))), unchanged)
        with self.assertRaises(ValueError):
            _verify([ends[0], ambiguous, ends[1]], ends, 'ambiguous', False)

    def test_no_extra_frame_in_either_direction(self):
        a, b = self.old, self.new
        for frames in ([a, ('blank', 'empty'), b], [a, ('cover', b[1]), b],
                       [a, (b[0], a[1]), b], [a, (a[0], b[1]), b], [a, b, a, b], [a], []):
            with self.subTest(frames=frames), self.assertRaises(ValueError):
                _verify(frames, [a, b], 'single', False)
        self.assertEqual(_verify([b, b, a, a], [b, a], 'back', False)['sequence'], [0, 1])

    def test_cancelled_turn_may_commit_once_before_reversal(self):
        a, b = self.old, self.new
        for frames, wanted in [([a, a, a], [0]), ([a, b, b, a], [0, 1, 0])]:
            self.assertEqual(_verify(frames, [a, b, a], 'cancel', True)['sequence'], wanted)
        for frames in ([a, b], [a, b, a, b, a], [a, ('cover', a[1]), a]):
            with self.assertRaises(ValueError):
                _verify(frames, [a, b, a], 'cancel', True)
        with self.assertRaises(ValueError):
            _verify([a, b], [a, b], 'invalid optional target', True)


class ChromiumFrames(unittest.TestCase):
    def test_mobile_compositor_through_real_input(self):
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            self.skipTest('Playwright is required for the Chromium test')
        with sync_playwright() as pw:
            executable = (os.environ.get('CHROME_PATH') or os.environ.get('CHROME_BIN') or
                          shutil.which('chromium') or shutil.which('google-chrome') or pw.chromium.executable_path)
            if not Path(executable).is_file():
                self.skipTest('Chromium is required for the compositor test')
            browser = pw.chromium.launch(executable_path=executable, args=['--no-sandbox', '--disable-gpu',
                                                                           '--no-zygote', '--disable-dev-shm-usage'])
            try:
                self.check_recording(browser)
            finally:
                browser.close()

    def check_recording(self, browser):
        page = browser.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=3,
                                is_mobile=True, has_touch=True)
        page.set_content('''<meta name="viewport" content="width=device-width,initial-scale=1">
          <style>body{margin:0} #paper{position:absolute;top:55px;left:14px;width:360px;height:656px;
          background:#fffdf8;font:24px serif;color:#233;touch-action:none} #number{position:absolute;left:155px;top:735px;
          width:90px;text-align:center;font:18px sans-serif}button{position:absolute;left:302px;top:735px}
          button:focus{outline:4px dotted magenta}
          #paper i{position:absolute;top:65px;width:54px;height:31px}
          #paper .A{left:18px;background:#821f45}#paper .B{left:95px;background:#245585;border-radius:50%}
          #paper .C{left:165px;height:58px;background:#29765b}
          #number i{display:block;margin:2px auto 0;width:11px;height:3px;background:#253b52}
          #number .B{width:27px}</style>
          <main id="paper"></main><output id="number"></output><button onclick="show('B')">次へ</button>
          <script>function mark(el,key){const shape=document.createElement('i');shape.className=key;el.append(shape)}
          function setNumber(key){number.textContent=key==='B'?'73 / 120':'72 / 120';mark(number,key)}
          function show(key){paper.textContent=({A:'海辺に残る古い地図',B:'町を流れる朝の川',C:'試験用の表紙'})[key];
          mark(paper,key);setNumber(key==='B'?'B':'A')}show('A')</script>''')
        cdp = page.context.new_cdp_session(page)
        regions = [page.locator(selector).bounding_box() for selector in ['#paper', '#number']]
        def go(key):
            page.evaluate('key => show(key)', key)
            page.wait_for_timeout(85)
        with TurnFrames(page, cdp, *regions) as film:
            old = film.reference()
            go('B')
            new = film.reference()
            go('C')
            cover = film.reference()
            go('A')
            for a, b in ((old, new), (old, cover), (new, cover)):
                self.assertNotEqual(a[0], b[0], 'Each reference must have distinct paper pixels')
            self.assertNotEqual(old[1], new[1], 'Page numbers must have distinct pixels')
            self.assertEqual(old[1], cover[1])
            def tap_next():
                page.locator('button').tap()
                page.wait_for_function("number.textContent==='73 / 120'")
            success = film.check([old, new], tap_next, 'tap')
            self.assertEqual(success['sequence'], [0, 1])
            # The focus ring is outside both reading regions. Resetting an endpoint
            # while the same recorder is open must not count in the next action.
            page.locator('button').focus()
            self.assertEqual(film.reference(), new)
            page.evaluate("paper.addEventListener('touchend', () => show('A'), {once:true})")
            def swipe_back():
                for event, y in [('touchStart', 380), ('touchMove', 415), ('touchMove', 455), ('touchEnd', None)]:
                    points = [] if y is None else [{'id': 1, 'x': 193, 'y': y}]
                    cdp.send('Input.dispatchTouchEvent', {'type': event, 'touchPoints': points})
                page.wait_for_function("number.textContent==='72 / 120'")
            self.assertEqual(film.check([new, old], swipe_back, 'swipe')['sequence'], [0, 1])

            for mode in ('blank', 'cover', 'number-first', 'body-first'):
                def wrong_frame():
                    page.evaluate('''mode=>{
                      if(mode==='blank'){paper.textContent='';number.textContent=''}
                      if(mode==='cover')show('C');
                      if(mode==='number-first')setNumber('B');
                      if(mode==='body-first'){show('B');setNumber('A')}
                    }''', mode)
                    page.wait_for_timeout(85)
                    go('B')
                with self.subTest(mode=mode), self.assertRaisesRegex(ValueError, '合成フレーム'):
                    film.check([old, new], wrong_frame, mode)
                go('A')
            def one_paint():
                page.evaluate("""() => new Promise(done => requestAnimationFrame(() => {
                  show('B');setNumber('A');
                  requestAnimationFrame(() => {show('B');requestAnimationFrame(() => done())});
                }))""")
            with self.assertRaisesRegex(ValueError, '合成フレーム'):
                film.check([old, new], one_paint, 'one-paint number mismatch')
            go('A')
            self.assertEqual(film.check([old, new, old], lambda: None, optional_middle=True)['sequence'], [0])
            def reverse():
                go('B')
                go('A')
            self.assertEqual(film.check([old, new, old], reverse, optional_middle=True)['sequence'], [0, 1, 0])
        cdp.detach()
        self.assertEqual(page.locator('html > span').count(), 0)
        page.close()


if __name__ == '__main__':
    unittest.main()
