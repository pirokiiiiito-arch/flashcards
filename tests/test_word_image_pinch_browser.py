"""Real mobile Chromium test: picture tap stays inline; pinch zooms without breaking scroll.

Synthetic PNG bytes only. Loads the actual word-card CSS and word-images-ui.js.
No user vocabulary, images, login, or remote requests are involved.
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
        raise AssertionError("Missing actual word-card inline style")
    images_css = (ROOT / "word-images.css").read_text(encoding="utf-8")
    ui = (ROOT / "word-images-ui.js").read_text(encoding="utf-8")
    if "function enablePinchZoom(" not in ui:
        raise AssertionError("Pinch behavior missing in original UI code")
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
</script></body></html>"""


def send_touches(cdp, kind, pairs):
    cdp.send("Input.dispatchTouchEvent", {
        "type": kind,
        "touchPoints": [
            {"x": x, "y": y, "id": n + 1}
            for n, (x, y) in enumerate(pairs)
        ],
    })


def pinch(page, cdp, *, outward):
    picture = page.locator(".word-image-picture").first
    rect = picture.bounding_box()
    assert rect and rect["width"] > 100 and rect["height"] > 100
    x = rect["x"] + rect["width"] / 2
    y = rect["y"] + min(90, rect["height"] / 2)
    small, big = 34, 91
    beginning, ending = (small, big) if outward else (big, small)
    send_touches(cdp, "touchStart", [(x - beginning, y), (x + beginning, y)])
    for step in range(1, 7):
        half = beginning + (ending - beginning) * step / 6
        send_touches(cdp, "touchMove", [(x - half, y), (x + half, y)])
        page.wait_for_timeout(35)
    send_touches(cdp, "touchEnd", [])
    page.wait_for_timeout(100)
    text = picture.evaluate("(picture) => picture.style.transform")
    match = re.search(r"scale\(([0-9.]+)\)", text)
    return float(match.group(1)) if match else 1.0


def one_finger_scroll(page, cdp):
    rect = page.locator(".word-image-picture").first.bounding_box()
    assert rect is not None
    x = rect["x"] + rect["width"] / 2
    y = rect["y"] + min(180, rect["height"] * 0.75)
    send_touches(cdp, "touchStart", [(x, y)])
    for step in range(1, 7):
        send_touches(cdp, "touchMove", [(x, y - step * 28)])
        page.wait_for_timeout(35)
    send_touches(cdp, "touchEnd", [])
    page.wait_for_timeout(350)
    return page.evaluate("document.querySelector('#scroller').scrollTop")


class WordImagePinchBrowserTest(unittest.TestCase):
    def test_tap_no_modal_pinch_in_place_and_normal_one_finger_scroll(self):
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
                    "() => [...document.querySelectorAll('.word-image-open')].length === 3 && "
                    "[...document.querySelectorAll('.word-image-open')].every(el => !el.hidden)"
                )
                self.assertEqual(page.locator(".word-image-open button").count(), 0)
                self.assertEqual(
                    page.locator(".word-image-zoom-hint").first.inner_text(),
                    "ピンチで拡大・縮小",
                )
                pic = page.locator(".word-image-picture").first
                pic.tap()
                self.assertEqual(page.locator("dialog").count(), 0, "tap must never open viewer")
                self.assertEqual(pic.evaluate("(img) => img.style.transform"), "")

                cdp = context.new_cdp_session(page)
                bigger = pinch(page, cdp, outward=True)
                self.assertGreater(bigger, 1.3, "two-finger spread zooms the picture inline")
                self.assertEqual(page.locator("dialog").count(), 0)

                smaller = pinch(page, cdp, outward=False)
                self.assertLess(smaller, 1.1, "two-finger inward pinch returns near 1x")
                self.assertEqual(
                    page.evaluate("document.querySelector('#scroller').scrollTop"), 0
                )
                scroll = one_finger_scroll(page, cdp)
                self.assertGreater(scroll, 40, "one-finger image swipe still scrolls to the next picture")
            finally:
                browser.close()


if __name__ == "__main__":
    unittest.main()
