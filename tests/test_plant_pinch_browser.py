"""Mobile Chromium regression for native plant-card page pinch and panning.

Runs the production CSS and gesture handlers with synthetic photo slots.
There are no accounts, remote photos, storage writes, or page-scale overrides.
"""
import re
import shutil
import unittest
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
PNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGOUSzFiYGBgYmBgYGBgAAAIhgC45g2MEQAAAABJRU5ErkJggg=="


def fixture_html():
    source = (ROOT / "plants/index.html").read_text(encoding="utf-8")
    style = re.search(r"<style>(.*?)</style>", source, re.S)
    assert style, "plant-card styles must exist"
    start = source.index("function plantPageIsZoomed()")
    end = source.index("function renderCard(", start)
    handlers = source[start:end]
    slots = "".join(
        f'<div class="image-slot"><div class="image-slot-title">画像{i + 1}</div>'
        '<div class="image-box" contenteditable="true" tabindex="0">'
        f'<img alt="synthetic photo {i + 1}" src="data:image/png;base64,{PNG}"></div>'
        f'<div class="image-slot-tools"><button class="small paste-btn" data-slot="{i}"'
        ' onclick="pasteCount++">貼り付け</button></div></div>'
        for i in range(3)
    )
    return f"""<!doctype html><html lang="ja"><head>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>{style.group(1)}</style></head><body><div class="wrap">
<nav class="nav"><button id="previous" onclick="buttonCount++">戻る</button>
<button>通常</button><button id="next" onclick="buttonCount++">次へ</button></nav>
<div class="stage"><article class="card show-back">
<div class="face front"><div class="label">表・植物名</div>
<div class="front-name">検証用の植物</div></div>
<div class="face back"><div class="label">裏・画像と説明</div>
<div class="back-body"><div class="back-intro"><div class="desc">検証用の説明です。\n写真を観察できます。</div></div>
<div class="image-stack">{slots}</div></div></div>
<div class="number">1 / 3</div></article></div></div>
<script>
let editing=false,pos=0,order=[0,1,2],navCount=0,pasteCount=0,buttonCount=0;
function render(){{navCount++;document.querySelector('.number').textContent=(pos+1)+' / 3';}}
{handlers}
bindPlantCardGestures(document.querySelector('.card'));
</script></body></html>"""


def send_touches(cdp, kind, points):
    cdp.send("Input.dispatchTouchEvent", {
        "type": kind,
        "touchPoints": [{"x": x, "y": y, "id": i + 1}
                        for i, (x, y) in enumerate(points)],
    })


def pinch(page, cdp, x, y, *, outward):
    start, end = (35, 88) if outward else (88, 25)
    send_touches(cdp, "touchStart", [(x - start, y), (x + start, y)])
    for step in range(1, 8):
        radius = start + (end - start) * step / 7
        send_touches(cdp, "touchMove", [(x - radius, y), (x + radius, y)])
        page.wait_for_timeout(35)
    send_touches(cdp, "touchEnd", [])
    page.wait_for_timeout(250)
    return page.evaluate("visualViewport.scale")


def drag(page, cdp, start, end):
    send_touches(cdp, "touchStart", [start])
    for step in range(1, 8):
        point = tuple(a + (b - a) * step / 7 for a, b in zip(start, end))
        send_touches(cdp, "touchMove", [point])
        page.wait_for_timeout(35)
    send_touches(cdp, "touchEnd", [])
    page.wait_for_timeout(300)


class PlantNativePageZoomBrowserTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        chrome = shutil.which("google-chrome")
        if not chrome and not Path(cls.playwright.chromium.executable_path).is_file():
            chrome = shutil.which("chromium")
        options = {"headless": True, "args": ["--no-sandbox"]}
        if chrome:
            options["executable_path"] = chrome
        cls.browser = cls.playwright.chromium.launch(**options)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(
            viewport={"width": 390, "height": 760}, device_scale_factor=1,
            is_mobile=True, has_touch=True,
        )
        self.page = self.context.new_page()
        self.page.route("**/*", lambda route: route.fulfill(
            status=200, content_type="text/html; charset=utf-8", body=fixture_html()
        ))
        self.page.goto("https://plant-fixture.test/", wait_until="load")
        self.cdp = self.context.new_cdp_session(self.page)

    def tearDown(self):
        self.context.close()

    def state(self):
        return self.page.evaluate("""({pos,navCount,pasteCount,buttonCount,
            back:document.querySelector('.card').classList.contains('show-back'),
            transform:document.querySelector('.card').style.transform})""")

    def assert_unchanged_card(self):
        state = self.state()
        self.assertEqual((state["pos"], state["navCount"]), (0, 0))
        self.assertTrue(state["back"], "pinch and panning must not flip the card")
        self.assertEqual(state["transform"], "")

    def test_native_pinch_on_each_photo_and_description(self):
        for selector in [".image-slot:nth-child(1) .image-box", ".image-slot:nth-child(2) .image-box", ".desc"]:
            with self.subTest(selector=selector):
                self.page.reload(wait_until="load")
                target = self.page.locator(selector).first
                target.scroll_into_view_if_needed()
                rect = target.bounding_box()
                self.assertIsNotNone(rect)
                x, y = rect["x"] + rect["width"] / 2, rect["y"] + rect["height"] / 2
                self.assertAlmostEqual(self.page.evaluate("visualViewport.scale"), 1, delta=.01)
                enlarged = pinch(self.page, self.cdp, x, y, outward=True)
                self.assertGreater(enlarged, 1.25, "two native contacts must enlarge the page")
                self.assert_unchanged_card()
                self.assertEqual(self.page.locator(".image-box img").evaluate_all(
                    "images=>images.every(img=>getComputedStyle(img).transform==='none')"
                ), True, "browser zoom must not transform or crop individual photos")
                reduced = pinch(self.page, self.cdp, 195, 300, outward=False)
                self.assertLess(reduced, enlarged - .1)
                self.assert_unchanged_card()
                print(f"native pinch {selector}: 1 -> {enlarged:.3f} -> {reduced:.3f}")

    def test_zoomed_page_pans_both_axes_without_navigation(self):
        rect = self.page.locator(".image-box").first.bounding_box()
        self.assertIsNotNone(rect)
        scale = pinch(self.page, self.cdp, 195, rect["y"] + rect["height"] / 2,
                      outward=True)
        self.assertGreater(scale, 1.25)
        self.page.wait_for_function("document.documentElement.classList.contains('plant-page-zoomed')")
        self.assertEqual(self.page.locator(".card").evaluate(
            "card=>getComputedStyle(card).touchAction"), "auto")
        before = self.page.evaluate("({x:visualViewport.pageLeft,y:visualViewport.pageTop})")
        drag(self.page, self.cdp, (260, 420), (140, 300))
        after = self.page.evaluate("({x:visualViewport.pageLeft,y:visualViewport.pageTop})")
        self.assertGreater(abs(after["x"] - before["x"]), 10, "native horizontal panning")
        self.assertGreater(abs(after["y"] - before["y"]), 10, "native vertical panning")
        self.assert_unchanged_card()
        reduced = pinch(self.page, self.cdp, 195, 300, outward=False)
        self.assertAlmostEqual(reduced, 1, delta=.05)
        self.page.wait_for_function("!document.documentElement.classList.contains('plant-page-zoomed')")
        self.page.locator(".desc").tap()
        self.assertFalse(self.state()["back"], "a fresh ordinary tap works after pinching back")

    def test_normal_tap_swipe_scroll_and_buttons(self):
        self.page.locator(".desc").tap()
        self.assertFalse(self.state()["back"])
        self.page.locator(".front-name").tap()
        self.assertTrue(self.state()["back"])
        self.page.locator(".paste-btn").first.tap()
        self.assertEqual(self.state()["pasteCount"], 1)
        self.assertTrue(self.state()["back"])
        self.page.locator("#next").tap()
        self.assertEqual(self.state()["buttonCount"], 1)
        rect = self.page.locator(".desc").bounding_box()
        y = rect["y"] + rect["height"] / 2
        drag(self.page, self.cdp, (280, y), (120, y))
        self.assertEqual((self.state()["pos"], self.state()["navCount"]), (1, 1))
        drag(self.page, self.cdp, (120, y), (280, y))
        self.assertEqual((self.state()["pos"], self.state()["navCount"]), (0, 2))
        self.assertTrue(self.state()["back"])
        rect = self.page.locator(".image-box").first.bounding_box()
        y = rect["y"] + rect["height"] / 2
        before = self.page.evaluate("scrollY")
        drag(self.page, self.cdp, (195, y), (195, max(30, y - 180)))
        self.assertGreater(self.page.evaluate("scrollY"), before + 30)
        self.assertEqual((self.state()["pos"], self.state()["navCount"]), (0, 2))
        self.assertTrue(self.state()["back"])


if __name__ == "__main__":
    unittest.main()
