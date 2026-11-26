"""Real mobile Chromium regression for the word-card back's native scrolling.

Synthetic cards only. Uses the app's actual inline stylesheet and pointerdown
listener, never a user's locally stored cards or remote services.
"""
import re
import shutil
import unittest
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]


def fixture_html():
    source = (ROOT / "index.html").read_text(encoding="utf-8")
    css = re.search(r"<style>(.*?)</style>", source, re.S)
    if not css:
        raise AssertionError("Missing actual word-card inline stylesheet")
    start = source.index("function resetWordBackScroll(card){")
    end = source.index("\nfunction renderCard(item){", start)
    flip_helpers = source[start:end]
    start = source.index('card.addEventListener("pointerdown",e=>{')
    end = source.index('\n card.addEventListener("pointermove"', start)
    pointer_handler = source[start:end]
    cards = "\n".join(
        '<figure class="word-image-item"><div class="word-image-open">'
        '<div class="word-image-picture" '
        'style="width:100%;height:260px;background:#dde4ed"></div>'
        '</div></figure>'
        for _ in range(3)
    )
    script = """
const card = document.querySelector('#test-card');
let editing=false, swipePointerId=null, swipeStartX=0, swipeStartY=0;
let cards=[], order=[], pos=0, isShuffled=false;
function currentIndex(){return pos;}
let swipeMoved=false, touchTapHandled=true;
window.__captures=0;
const nativeCapture=card.setPointerCapture.bind(card);
card.setPointerCapture=id=>{__captures++;return nativeCapture(id)};
""" + flip_helpers + "\n" + pointer_handler
    return f"""<!doctype html><html lang="ja"><head>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>{css.group(1)}</style>
<link rel="stylesheet" href="data:text/css,.word-image-picture{{height:260px}}">
<style>
#test-back-content{{padding-left:14px;padding-right:8px}}
</style></head><body><div class="wrap">
<div class="stage"><article id="test-card" class="card with-images show-back">
<div class="face front"><div class="card-text">表面</div></div>
<div class="face back"><div class="face-label">裏・意味</div>
<div class="back-content" id="test-back-content">
<div class="card-text" style="font-size:20px">画像が3枚あるカード</div>
<div data-image-ui class="word-image-gallery">{cards}</div>
</div></div></article></div></div><script>{script}</script></body></html>"""


def swipe_up(page, cdp, *, start_on_image=False):
    box = page.locator("#test-back-content").bounding_box()
    assert box is not None, "scroll container has no layout box"
    # Exercise both the actual photograph and the padding around it.
    x = box["x"] + (box["width"] * 0.5 if start_on_image else 5)
    y = box["y"] + box["height"] * 0.72
    cdp.send("Input.dispatchTouchEvent", {
        "type": "touchStart", "touchPoints": [{"x": x, "y": y, "id": 1}]
    })
    for step in range(1, 8):
        cdp.send("Input.dispatchTouchEvent", {
            "type": "touchMove",
            "touchPoints": [{"x": x, "y": y - step * 35, "id": 1}]
        })
        page.wait_for_timeout(35)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    page.wait_for_timeout(350)
    return page.evaluate("document.querySelector('#test-back-content').scrollTop")


class WordBackNativeScrollTest(unittest.TestCase):
    def test_native_swipe_remains_available_after_back_is_reset(self):
        with sync_playwright() as playwright:
            chrome = shutil.which("google-chrome") or shutil.which("chromium")
            launch_options = {"headless": True, "args": ["--no-sandbox"]}
            if chrome:
                launch_options["executable_path"] = chrome
            browser = playwright.chromium.launch(**launch_options)
            try:
                context = browser.new_context(
                    viewport={"width": 390, "height": 760},
                    device_scale_factor=1, is_mobile=True, has_touch=True,
                )
                page = context.new_page()
                page.set_content(fixture_html(), wait_until="load")
                dimensions = page.evaluate("""() => {
                  const el=document.querySelector('#test-back-content');
                  return {
                    client:el.clientHeight, scroll:el.scrollHeight,
                    touchAction:getComputedStyle(el).touchAction
                  };
                }""")
                self.assertGreater(dimensions["scroll"] - dimensions["client"], 200)
                self.assertEqual(dimensions["touchAction"], "pan-y pinch-zoom")

                # A touch on empty space inside the scrollable face must NOT
                # start the card-wide swipe handler or capture its pointer.
                cdp = context.new_cdp_session(page)
                first = swipe_up(page, cdp, start_on_image=True)
                self.assertGreater(first, 40, "first native vertical swipe must scroll")
                self.assertEqual(page.evaluate("__captures"), 0)

                # The reverse face must still have layout while hidden.
                # Clear the old position BEFORE hiding so WebKit cannot restore it.
                page.evaluate("flipWordCardFace(card)")
                hidden = page.evaluate("""() => {
                  const el=document.querySelector('#test-back-content');
                  const face=el.closest('.back');
                  return { scrollTop:el.scrollTop, clientHeight:el.clientHeight,
                           visibility:getComputedStyle(face).visibility,
                           overflow:getComputedStyle(el).overflowY };
                }""")
                self.assertEqual(hidden["scrollTop"], 0, "closing back clears previous offset")
                self.assertGreater(hidden["clientHeight"], 100, "hidden back remains measurable")
                self.assertEqual(hidden["visibility"], "hidden")
                self.assertEqual(hidden["overflow"], "hidden")

                page.wait_for_timeout(130)
                page.evaluate("flipWordCardFace(card)")
                page.wait_for_timeout(70)
                self.assertEqual(
                    page.evaluate("document.querySelector('#test-back-content').scrollTop"),
                    0, "front-to-back must reopen at the beginning",
                )
                self.assertEqual(
                    page.evaluate("getComputedStyle(document.querySelector('#test-back-content')).overflowY"),
                    "auto", "visible back must regain native scrolling",
                )
                second = swipe_up(page, cdp, start_on_image=False)
                self.assertGreater(second, 40, "second native swipe must still scroll")
                self.assertEqual(page.evaluate("__captures"), 0)
                page.evaluate("flipWordCardFace(card)")
                page.wait_for_timeout(130)
                # Simulate the browser trying to restore an old hidden offset.
                page.evaluate("document.querySelector('#test-back-content').scrollTop=250")
                page.evaluate("flipWordCardFace(card)")
                page.wait_for_timeout(70)
                self.assertEqual(
                    page.evaluate("document.querySelector('#test-back-content').scrollTop"),
                    0, "every later front-to-back flip must also reset",
                )
                third = swipe_up(page, cdp, start_on_image=True)
                self.assertGreater(third, 40, "scroll must keep working after repeated flips")
            finally:
                browser.close()



class WordCardFrontHeightTest(unittest.TestCase):
    def test_photo_card_front_matches_plain_card_on_phone_and_desktop(self):
        """Use the actual app CSS with three synthetic photo placeholders."""
        with sync_playwright() as playwright:
            chrome = shutil.which("google-chrome") or shutil.which("chromium")
            launch_options = {"headless": True, "args": ["--no-sandbox"]}
            if chrome:
                launch_options["executable_path"] = chrome
            browser = playwright.chromium.launch(**launch_options)
            try:
                for width, height in ((390, 760), (1200, 800)):
                    with self.subTest(viewport=(width, height)):
                        context = browser.new_context(
                            viewport={"width": width, "height": height},
                            device_scale_factor=1, is_mobile=width < 600, has_touch=True,
                        )
                        try:
                            page = context.new_page()
                            page.set_content(fixture_html(), wait_until="load")
                            sizes = page.evaluate("""() => {
                              const card=document.querySelector('#test-card');
                              const scroller=document.querySelector('#test-back-content');
                              const regular=document.createElement('article');
                              regular.className='card';
                              document.body.appendChild(regular);
                              const plain=regular.getBoundingClientRect().height;
                              regular.remove();
                              const photoBack=card.getBoundingClientRect().height;
                              const backScrollable=scroller.scrollHeight>scroller.clientHeight+80;
                              card.classList.remove('show-back');
                              const photoFront=card.getBoundingClientRect().height;
                              const frontFace=card.querySelector('.front').getBoundingClientRect().height;
                              card.classList.add('show-back');
                              const restoredBack=card.getBoundingClientRect().height;
                              card.classList.remove('show-back');
                              card.classList.add('is-editing');
                              const editorHeight=card.getBoundingClientRect().height;
                              return {plain,photoFront,frontFace,photoBack,
                                      restoredBack,backScrollable,editorHeight};
                            }""")
                            self.assertAlmostEqual(sizes["photoFront"], sizes["plain"], delta=0.5,
                                msg=f"photo front must match text-only card: {sizes}")
                            self.assertAlmostEqual(sizes["frontFace"], sizes["plain"], delta=0.5,
                                msg="photo front face must fill same height as text-only face")
                            self.assertGreater(sizes["photoBack"], sizes["plain"] + 25,
                                "reverse side keeps extra height for multiple photos")
                            self.assertAlmostEqual(sizes["restoredBack"], sizes["photoBack"], delta=0.5,
                                msg="reopening reverse side restores its taller photo view")
                            self.assertTrue(sizes["backScrollable"],
                                "stacked images continue to scroll vertically")
                            self.assertGreaterEqual(sizes["editorHeight"], sizes["photoBack"] - 0.5,
                                "editor keeps the tall reverse-image layout")
                        finally:
                            context.close()
            finally:
                browser.close()


class WordMeaningPhotoSpacingTest(unittest.TestCase):
    def test_two_text_lines_of_spacing_only_between_description_and_first_photo(self):
        """Measure the rendered gap from the actual word-card CSS."""
        with sync_playwright() as playwright:
            chrome = shutil.which("google-chrome") or shutil.which("chromium")
            launch_options = {"headless": True, "args": ["--no-sandbox"]}
            if chrome:
                launch_options["executable_path"] = chrome
            browser = playwright.chromium.launch(**launch_options)
            try:
                for width, height in ((390, 760), (1200, 800)):
                    with self.subTest(viewport=(width, height)):
                        context = browser.new_context(
                            viewport={"width": width, "height": height},
                            device_scale_factor=1, is_mobile=width < 600, has_touch=True,
                        )
                        try:
                            page = context.new_page()
                            page.set_content(fixture_html(), wait_until="load")
                            dimensions = page.evaluate("""() => {
                              const card=document.querySelector('#test-card');
                              const desc=document.querySelector('#test-back-content > .card-text');
                              const imageArea=document.querySelector('#test-back-content > [data-image-ui]');
                              const style=getComputedStyle(desc);
                              const lines=Number.parseFloat(style.lineHeight);
                              const gap=imageArea.getBoundingClientRect().top-desc.getBoundingClientRect().bottom;
                              const margin=Number.parseFloat(style.marginBottom);
                              desc.textContent='';
                              const emptyMargin=Number.parseFloat(getComputedStyle(desc).marginBottom);
                              desc.textContent='元の説明';
                              card.classList.add('is-editing');
                              const editMargin=Number.parseFloat(getComputedStyle(desc).marginBottom);
                              card.classList.remove('is-editing');
                              card.classList.remove('with-images');
                              const noPhotoMargin=Number.parseFloat(getComputedStyle(desc).marginBottom);
                              return {lines,gap,margin,emptyMargin,editMargin,noPhotoMargin};
                            }""")
                            self.assertAlmostEqual(dimensions["margin"], 2 * dimensions["lines"], delta=0.5,
                                msg="the gap is exactly two current description line heights")
                            self.assertAlmostEqual(dimensions["gap"], 2 * dimensions["lines"], delta=1.0,
                                msg=f"visible separation must equal two lines: {dimensions}")
                            self.assertAlmostEqual(dimensions["emptyMargin"], 0, delta=0.5,
                                msg="image-only cards need no extra empty spacing")
                            self.assertAlmostEqual(dimensions["editMargin"], 0, delta=0.5,
                                msg="study-view gap must not change editing UI")
                            self.assertAlmostEqual(dimensions["noPhotoMargin"], 0, delta=0.5,
                                msg="text-only cards keep their original layout")
                        finally:
                            context.close()
            finally:
                browser.close()


class WordCardNumberPlacementTest(unittest.TestCase):
    def test_reverse_counter_centered_below_buttons_and_above_long_meaning(self):
        """Check geometry, not merely CSS strings, with real desktop/phone layouts."""
        with sync_playwright() as playwright:
            chrome = shutil.which("google-chrome") or shutil.which("chromium")
            launch = {"headless": True, "args": ["--no-sandbox"]}
            if chrome:
                launch["executable_path"] = chrome
            browser = playwright.chromium.launch(**launch)
            try:
                for width, height in ((390, 760), (1200, 800)):
                    with self.subTest(viewport=(width, height)):
                        context = browser.new_context(
                            viewport={"width": width, "height": height},
                            device_scale_factor=1, is_mobile=width < 600, has_touch=True,
                        )
                        try:
                            page = context.new_page()
                            page.set_content(fixture_html(), wait_until="load")
                            result = page.evaluate("""() => {
                              const card=document.querySelector('#test-card');
                              const backContent=card.querySelector('.back-content');
                              const meaning=backContent.querySelector('.card-text');
                              meaning.textContent=('1890年代末に創業した歴史ある車・エンジンメーカーであり、'
                                +'近年はレースへの挑戦でも注目されているブランド。').repeat(2);
                              const buttons=document.createElement('div');
                              buttons.className='card-actions';
                              for(const label of ['＋追加','編集','削除']){
                                const b=document.createElement('button');
                                b.className='small';b.textContent=label;buttons.appendChild(b);
                              }
                              card.appendChild(buttons);
                              const backNum=document.createElement('div');
                              backNum.className='card-number card-number-back';
                              backNum.textContent='67 / 73';
                              backContent.prepend(backNum);
                              const frontNum=document.createElement('div');
                              frontNum.className='card-number card-number-front';
                              frontNum.textContent=backNum.textContent;
                              card.querySelector('.front').appendChild(frontNum);
                              const geometry=()=>{
                                const cr=card.getBoundingClientRect();
                                const br=buttons.getBoundingClientRect();
                                const nr=backNum.getBoundingClientRect();
                                const mr=meaning.getBoundingClientRect();
                                return {
                                  buttonsBottom:br.bottom,numberTop:nr.top,numberBottom:nr.bottom,
                                  textTop:mr.top,numberCenter:nr.left+nr.width/2,
                                  cardCenter:cr.left+cr.width/2,
                                  numberStyle:getComputedStyle(backNum).position,
                                  scrollable:backContent.scrollHeight>backContent.clientHeight,
                                  scrollTop:backContent.scrollTop
                                };
                              };
                              const initial=geometry();
                              backContent.scrollTop=120;
                              const afterScroll=geometry();
                              card.classList.remove('show-back');
                              const backHidden=getComputedStyle(backNum).visibility;
                              const frontVisible=getComputedStyle(frontNum).display!=='none'
                                && getComputedStyle(card.querySelector('.front')).display!=='none';
                              card.classList.add('show-back');
                              backContent.scrollTop=0;
                              return {initial,afterScroll,backHidden,frontVisible};
                            }""")
                            initial=result["initial"]
                            self.assertEqual(initial["numberStyle"], "static",
                                "reverse number must participate in document flow")
                            self.assertLess(abs(initial["numberCenter"]-initial["cardCenter"]), 1.0,
                                "count is horizontally centered within the card")
                            self.assertGreaterEqual(initial["numberTop"], initial["buttonsBottom"]-1,
                                "count starts below the action buttons")
                            self.assertGreaterEqual(initial["textTop"], initial["numberBottom"]+8,
                                "meaning starts below the count with at least 8px separation")
                            self.assertTrue(initial["scrollable"],
                                "multiple photos must retain native vertical scrolling")
                            self.assertGreater(result["afterScroll"]["scrollTop"], 0,
                                "the number may scroll away together with the image list")
                            self.assertEqual(result["backHidden"], "hidden")
                            self.assertTrue(result["frontVisible"],
                                "front still shows its own count without reverse-side overlay")
                        finally:
                            context.close()
            finally:
                browser.close()

if __name__ == "__main__":
    unittest.main()
