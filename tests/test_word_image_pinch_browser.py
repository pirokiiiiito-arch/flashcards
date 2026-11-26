"""Real mobile Chromium regression: browser zooms the whole page, not a cropped image.

Uses the actual word-card CSS and image module with 3 synthetic PNG entries.
No user account, data, photos, login, or remote requests.
"""
import re
import shutil
import unittest
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
PNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGOUSzFiYGBgYmBgYGBgAAAIhgC45g2MEQAAAABJRU5ErkJggg=="


def fixture_html():
    index = (ROOT / "index.html").read_text(encoding="utf-8")
    inline = re.search(r"<style>(.*?)</style>", index, re.S)
    if not inline:
        raise AssertionError("Missing word-card inline style")
    images_css = (ROOT / "word-images.css").read_text(encoding="utf-8")
    ui = (ROOT / "word-images-ui.js").read_text(encoding="utf-8")
    if "enablePinchZoom(" in ui or "ピンチで拡大・縮小" in ui:
        raise AssertionError("In-frame zoom or unwanted instruction text remains")
    return f"""<!doctype html><html lang="ja"><head>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>{inline.group(1)}</style><style>{images_css}</style></head>
<body><div class="wrap"><div class="stage"><article class="card with-images show-back">
<div class="face front"><div class="card-text">表面</div></div>
<div class="face back"><div class="face-label">裏・意味</div>
<div class="back-content" id="scroller"><div id="imageArea" data-image-ui></div>
</div></div></article></div></div>
<script>
window.WordImages = {{
  normalizeImages(images) {{ return Array.isArray(images) ? images : []; }},
  async getBlob() {{
    const bytes = Uint8Array.from(atob('{PNG}'), char => char.charCodeAt(0));
    return new Blob([bytes], {{ type: 'image/png' }});
  }}
}};
</script>
<script>{ui}</script>
<script>
window.__imageController = WordImageUI.render(
  document.getElementById('imageArea'),
  Array.from({{length:3}}, (_, index) => ({{
    ref:'local:synthetic-' + index, name:'Synthetic image ' + (index + 1), type:'image/png'
  }}))
);
document.querySelector('.card').addEventListener('click', () => {{
  document.querySelector('.card').classList.toggle('show-back');
}});
</script></body></html>"""


def send_touches(cdp, kind, pairs):
    cdp.send("Input.dispatchTouchEvent", {
        "type": kind,
        "touchPoints": [
            {"x": x, "y": y, "id": n + 1}
            for n, (x, y) in enumerate(pairs)
        ],
    })


def native_page_pinch(page, cdp, x, y, *, outward):
    # The gesture always starts in the original image area; no transform is
    # applied to individual images, and no JavaScript intercepts touch events.
    small, big = 35, 88
    start, end = (small, big) if outward else (big, small)
    send_touches(cdp, "touchStart", [(x - start, y), (x + start, y)])
    for step in range(1, 7):
        half = start + (end - start) * step / 6
        send_touches(cdp, "touchMove", [(x - half, y), (x + half, y)])
        page.wait_for_timeout(35)
    send_touches(cdp, "touchEnd", [])
    page.wait_for_timeout(250)
    return page.evaluate("window.visualViewport.scale")


def one_finger_scroll(page, cdp):
    rect = page.locator(".word-image-open").first.bounding_box()
    assert rect is not None
    x = rect["x"] + rect["width"] / 2
    y = rect["y"] + min(140, rect["height"] * 0.5)
    send_touches(cdp, "touchStart", [(x, y)])
    for step in range(1, 7):
        send_touches(cdp, "touchMove", [(x, y - step * 28)])
        page.wait_for_timeout(35)
    send_touches(cdp, "touchEnd", [])
    page.wait_for_timeout(350)
    return page.evaluate("document.querySelector('#scroller').scrollTop")


class WordImageNativePageZoomBrowserTest(unittest.TestCase):
    def test_tap_no_enlarge_native_whole_page_pinch_and_scroll(self):
        with sync_playwright() as playwright:
            chrome = shutil.which("google-chrome") or shutil.which("chromium")
            launch = {"headless": True, "args": ["--no-sandbox"]}
            if chrome:
                launch["executable_path"] = chrome
            browser = playwright.chromium.launch(**launch)
            try:
                context = browser.new_context(
                    viewport={"width": 390, "height": 760},
                    device_scale_factor=1, is_mobile=True, has_touch=True,
                )
                page = context.new_page()
                page.set_content(fixture_html(), wait_until="load")
                page.wait_for_function(
                    "() => document.querySelectorAll('.word-image-open').length === 3 && "
                    "[...document.querySelectorAll('.word-image-open')].every(el => !el.hidden)"
                )
                self.assertEqual(page.locator(".word-image-open button").count(), 0)
                self.assertEqual(page.locator(".word-image-zoom-hint").count(), 0)
                self.assertNotIn("ピンチで拡大・縮小", page.locator("#imageArea").inner_text())
                self.assertEqual(page.locator("dialog").count(), 0)

                pic = page.locator(".word-image-picture").first
                pic.tap()
                self.assertTrue(page.locator(".card").first.evaluate(
                    "(card) => card.classList.contains('show-back')"
                ), "image tap must not flip the card")
                self.assertEqual(page.locator("dialog").count(), 0, "tap opens no modal")
                self.assertEqual(pic.evaluate("(img) => img.style.transform"), "")
                self.assertAlmostEqual(page.evaluate("visualViewport.scale"), 1, delta=0.01)

                frame = page.locator(".word-image-open").first.bounding_box()
                assert frame is not None
                x = frame["x"] + frame["width"] / 2
                y = frame["y"] + min(90, frame["height"] * 0.35)
                cdp = context.new_cdp_session(page)
                zoomed = native_page_pinch(page, cdp, x, y, outward=True)
                self.assertGreater(zoomed, 1.2,
                    "spreading fingers must enlarge the *browser page*")
                self.assertEqual(pic.evaluate("(img) => img.style.transform"), "",
                    "image may not grow inside a clipped card frame")
                self.assertEqual(page.locator("dialog").count(), 0)

                reduced = native_page_pinch(page, cdp, x, y, outward=False)
                self.assertLess(reduced, 1.1,
                    "pinching fingers together must reduce whole-page zoom")
                self.assertEqual(pic.evaluate("(img) => img.style.transform"), "")
                scroll = one_finger_scroll(page, cdp)
                self.assertGreater(scroll, 40,
                    "one-finger swipe must still reveal following photos")
            finally:
                browser.close()


if __name__ == "__main__":
    unittest.main()
