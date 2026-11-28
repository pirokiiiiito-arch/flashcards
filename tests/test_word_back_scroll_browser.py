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
    images_css = (ROOT / "word-images.css").read_text(encoding="utf-8")
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
<style>{images_css}</style><style>{css.group(1)}</style>
<link rel="stylesheet" href="data:text/css,.word-image-picture{{height:260px}}">
<style>
#test-back-content{{padding-left:14px;padding-right:8px}}
</style></head><body><div class="wrap">
<div class="stage"><article id="test-card" class="card with-images show-back">
<div class="face front"><div class="card-text">表面</div></div>
<div class="face back"><div class="face-label">裏・意味</div>
<div class="back-content" id="test-back-content">
<div data-image-ui class="word-image-gallery">{cards}</div>
<div class="card-text">画像が3枚あるカード</div>
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
    def test_photo_and_description_spacing_follow_current_text_line_height(self):
        """Measure three-line photo gaps and the four-line description gap at every text size."""
        with sync_playwright() as playwright:
            chrome = shutil.which("google-chrome") or shutil.which("chromium")
            launch_options = {"headless": True, "args": ["--no-sandbox"]}
            if chrome:
                launch_options["executable_path"] = chrome
            browser = playwright.chromium.launch(**launch_options)
            try:
                cases = ((w, h, size) for w, h in ((390, 760), (1200, 800))
                         for size in ("", "size-medium", "size-small", "size-xsmall"))
                for width, height, size_class in cases:
                    with self.subTest(viewport=(width, height), size_class=size_class):
                        context = browser.new_context(
                            viewport={"width": width, "height": height},
                            device_scale_factor=1, is_mobile=width < 600, has_touch=True,
                        )
                        try:
                            page = context.new_page()
                            page.set_content(fixture_html(), wait_until="load")
                            dimensions = page.evaluate("""(sizeClass) => {
                              const card=document.querySelector('#test-card');
                              if(sizeClass)card.querySelector('.back').classList.add(sizeClass);
                              const desc=document.querySelector('#test-back-content > .card-text');
                              const imageArea=document.querySelector('#test-back-content > [data-image-ui]');
                              const style=getComputedStyle(desc);
                              const lines=Number.parseFloat(style.lineHeight);
                              const pictures=[...imageArea.querySelectorAll('.word-image-item')];
                              const photoGaps=()=>pictures.slice(1).map((picture,i)=>
                                picture.getBoundingClientRect().top-pictures[i].getBoundingClientRect().bottom);
                              const imageGaps=photoGaps();
                              const gap=desc.getBoundingClientRect().top-imageArea.getBoundingClientRect().bottom;
                              const margin=Number.parseFloat(style.marginTop);
                              desc.textContent='';
                              const emptyMargin=Number.parseFloat(getComputedStyle(desc).marginTop);
                              const imageOnlyGaps=photoGaps();
                              desc.textContent='元の説明';
                              card.classList.add('is-editing');
                              const editMargin=Number.parseFloat(getComputedStyle(desc).marginTop);
                              card.classList.remove('is-editing');
                              card.classList.remove('with-images');
                              const noPhotoMargin=Number.parseFloat(getComputedStyle(desc).marginTop);
                              return {lines,imageGaps,imageOnlyGaps,gap,margin,emptyMargin,editMargin,noPhotoMargin};
                            }""", size_class)
                            for gap in dimensions["imageGaps"] + dimensions["imageOnlyGaps"]:
                                self.assertAlmostEqual(gap, 3 * dimensions["lines"], delta=1.0,
                                    msg=f"consecutive images have exactly three text lines between them: {dimensions}")
                            self.assertAlmostEqual(dimensions["margin"], 4 * dimensions["lines"], delta=0.5,
                                msg="the gap is exactly four current description line heights")
                            self.assertAlmostEqual(dimensions["gap"], 4 * dimensions["lines"], delta=1.0,
                                msg=f"visible separation must equal four lines: {dimensions}")
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
    def test_reverse_counter_right_aligned_below_buttons_and_above_long_meaning(self):
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
                                  numberGap:nr.top-br.bottom,
                                  studyBackPadding:parseFloat(getComputedStyle(card.querySelector('.back')).paddingTop),
                                  textTop:mr.top,numberRight:nr.right,
                                  meaningRight:mr.right,cardRight:cr.right,
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
                            self.assertLess(abs(initial["numberRight"]-initial["meaningRight"]), 1.0,
                                "count aligns to the right edge of the description's content region")
                            self.assertGreater(initial["cardRight"]-initial["numberRight"], 8,
                                "count remains inside the card's right-side padding")
                            self.assertGreaterEqual(initial["numberTop"], initial["buttonsBottom"]-1,
                                "count starts below the action buttons")
                            self.assertLessEqual(initial["numberGap"], 14,
                                "image-card number must sit immediately below Delete, not drift into the meaning")
                            self.assertAlmostEqual(initial["studyBackPadding"],
                                60 if width < 600 else 66, delta=0.5,
                                msg="only image study faces use the compact top spacing")
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


class WordTextOnlyCounterTopRightTest(unittest.TestCase):
    def test_text_only_count_sits_under_delete_while_meaning_stays_centered(self):
        """Use actual source CSS; measure compact/tall text at phone and desktop widths."""
        with sync_playwright() as playwright:
            chrome = shutil.which("google-chrome") or shutil.which("chromium")
            launch = {"headless": True, "args": ["--no-sandbox"]}
            if chrome:
                launch["executable_path"] = chrome
            browser = playwright.chromium.launch(**launch)
            try:
                for width, height in ((390, 760), (1200, 800)):
                    for long_text in (False, True):
                        with self.subTest(viewport=(width, height), long_text=long_text):
                            context = browser.new_context(
                                viewport={"width": width, "height": height},
                                device_scale_factor=1, is_mobile=width < 600, has_touch=True,
                            )
                            try:
                                page = context.new_page()
                                page.set_content(fixture_html(), wait_until="load")
                                result = page.evaluate("""(longText) => {
                                  const card=document.querySelector('#test-card');
                                  card.classList.remove('with-images');
                                  const back=card.querySelector('.back');
                                  if(longText)back.classList.add('longtext');
                                  const content=back.querySelector('.back-content');
                                  const meaning=content.querySelector('.card-text');
                                  meaning.textContent=longText
                                    ? ('ナイトテーブルは、ベッドサイドに置いて照明やスマホ、'
                                      +'メガネ、飲み物などを手元にまとめる小型テーブル。').repeat(14)
                                    : 'ナイトテーブルは、ベッドサイドに置く小型のテーブル';
                                  const gallery=content.querySelector('.word-image-gallery');
                                  gallery.replaceChildren();
                                  const actions=document.createElement('div');
                                  actions.className='card-actions';
                                  for(const text of ['＋追加','編集','削除']){
                                    const button=document.createElement('button');
                                    button.className='small';button.textContent=text;
                                    actions.appendChild(button);
                                  }
                                  card.appendChild(actions);
                                  const count=document.createElement('div');
                                  count.className='card-number card-number-back';
                                  count.textContent='65 / 68';
                                  content.prepend(count);
                                  const cr=card.getBoundingClientRect();
                                  const btn=actions.lastElementChild.getBoundingClientRect();
                                  const nr=count.getBoundingClientRect();
                                  const mr=meaning.getBoundingClientRect();
                                  const sr=content.getBoundingClientRect();
                                  return {
                                    buttonBottom:btn.bottom,numberTop:nr.top,
                                    numberBottom:nr.bottom,numberRight:nr.right,
                                    textTop:mr.top,textRight:mr.right,
                                    textCenterY:mr.top+mr.height/2,
                                    cardCenterY:cr.top+cr.height/2,
                                    countStyle:getComputedStyle(count).position,
                                    scrollable:content.scrollHeight>content.clientHeight+5,
                                    contentHeight:sr.height,cardHeight:cr.height
                                  };
                                }""", long_text)
                                self.assertEqual(result["countStyle"], "static")
                                self.assertGreaterEqual(result["numberTop"], result["buttonBottom"]-1,
                                    "top-right counter must appear below Delete")
                                self.assertLess(result["numberTop"]-result["buttonBottom"], 45,
                                    "counter must stay near Delete, not drift toward the meaning")
                                self.assertLess(abs(result["numberRight"]-result["textRight"]), 1,
                                    "right edges of counter and meaning area must align")
                                self.assertGreaterEqual(result["textTop"], result["numberBottom"]+8,
                                    "counter and long Japanese explanation must never overlap")
                                if long_text:
                                    self.assertTrue(result["scrollable"],
                                        "a long text-only meaning remains scrollable")
                                else:
                                    self.assertLess(abs(result["textCenterY"]-result["cardCenterY"]), 48,
                                        "short text-only description remains near the card's center")
                                    self.assertFalse(result["scrollable"])
                            finally:
                                context.close()
            finally:
                browser.close()


class WordFrontNumberUnderDeleteTest(unittest.TestCase):
    def test_front_progress_just_under_delete_without_covering_word(self):
        """Measure the real CSS on mobile and desktop with and without photos."""
        with sync_playwright() as playwright:
            chrome = shutil.which("google-chrome") or shutil.which("chromium")
            options = {"headless": True, "args": ["--no-sandbox"]}
            if chrome:
                options["executable_path"] = chrome
            browser = playwright.chromium.launch(**options)
            try:
                for width, height in ((390, 760), (1200, 800)):
                    for photo_card in (False, True):
                        with self.subTest(viewport=(width, height), photo_card=photo_card):
                            context = browser.new_context(
                                viewport={"width": width, "height": height},
                                device_scale_factor=1, is_mobile=width < 600, has_touch=True,
                            )
                            try:
                                page = context.new_page()
                                page.set_content(fixture_html(), wait_until="load")
                                result = page.evaluate("""(photoCard) => {
                                  const card=document.querySelector('#test-card');
                                  card.classList.remove('show-back');
                                  if(!photoCard)card.classList.remove('with-images');
                                  const front=card.querySelector('.front');
                                  const word=front.querySelector('.card-text');
                                  word.textContent='ジャカランダ';
                                  const actions=document.createElement('div');
                                  actions.className='card-actions';
                                  for(const label of ['＋追加','編集','削除']){
                                    const button=document.createElement('button');
                                    button.className='small';button.textContent=label;
                                    actions.appendChild(button);
                                  }
                                  card.appendChild(actions);
                                  const number=document.createElement('div');
                                  number.className='card-number card-number-front';
                                  number.textContent='71 / 74';
                                  front.appendChild(number);
                                  const nr=number.getBoundingClientRect();
                                  const dr=actions.lastElementChild.getBoundingClientRect();
                                  const wr=word.getBoundingClientRect();
                                  const cr=card.getBoundingClientRect();
                                  return {
                                    gap:nr.top-dr.bottom,
                                    numberRight:nr.right,deleteRight:dr.right,
                                    numberBottom:nr.bottom,wordTop:wr.top,
                                    wordCenterY:wr.top+wr.height/2,
                                    cardCenterY:cr.top+cr.height/2,
                                    numberPosition:getComputedStyle(number).position
                                  };
                                }""", photo_card)
                                self.assertEqual(result["numberPosition"], "absolute")
                                self.assertGreaterEqual(result["gap"], -1.0,
                                    "front progress must stay below Delete, not overlap it")
                                self.assertLessEqual(result["gap"], 12,
                                    "front progress must be just beneath Delete")
                                self.assertLess(abs(result["numberRight"]-result["deleteRight"]), 4,
                                    "front progress stays aligned with Delete on the right")
                                self.assertLess(result["numberBottom"], result["wordTop"]-6,
                                    "number may not cover the studied word")
                                self.assertLess(abs(result["wordCenterY"]-result["cardCenterY"]), 16,
                                    "the word stays centered vertically")
                            finally:
                                context.close()
            finally:
                browser.close()

if __name__ == "__main__":
    unittest.main()
