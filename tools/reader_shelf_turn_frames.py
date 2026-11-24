"""Compare actual Chromium compositor frames with independently visited reader pages."""

import base64
import hashlib
import math
import time
from io import BytesIO

from PIL import Image, ImageChops


def _box(value, viewport):
    x, y, width, height = (tuple(value[k] for k in ('x', 'y', 'width', 'height'))
                           if isinstance(value, dict) else value)
    if not all(math.isfinite(v) for v in (x, y, width, height)):
        raise ValueError('本文・ページ番号の画面座標が不正です')
    left, top = max(0, math.ceil(x)), max(0, math.ceil(y))
    right, bottom = min(viewport[0], math.floor(x + width)), min(viewport[1], math.floor(y + height))
    if right <= left or bottom <= top:
        raise ValueError('本文・ページ番号の検査範囲が画面にありません')
    return left, top, right, bottom


class _Pixels:
    """Allow a one-level RGB rounding difference from Chromium's compositing path."""

    def __init__(self, image):
        self.image = image
        self.digest = hashlib.sha256(image.tobytes()).digest()

    def __eq__(self, other):
        if not isinstance(other, _Pixels):
            return NotImplemented
        if self.image.size != other.image.size:
            return False
        if self.digest == other.digest:
            return True
        difference = ImageChops.difference(self.image, other.image)
        return all(high <= 1 for _, high in difference.getextrema())


def _signature(png, boxes, viewport, marker):
    with Image.open(BytesIO(png)) as image:
        if image.size != viewport:
            raise ValueError(f'合成画像の寸法が変わりました {image.size} / {viewport}')
        rgb = image.convert('RGB')
        # This single pixel only clocks the compositor. If the two requested
        # regions fill the viewport it also occurs in one of the reference crops.
        rgb.putpixel(marker, (0, 0, 0))
        return tuple(_Pixels(rgb.crop(box)) for box in boxes)


def _verify(frames, references, label, optional_middle):
    references = list(references)
    if not references or any(a == b for a, b in zip(references, references[1:])):
        raise ValueError(f'{label}: 独立に確定した開始・到着画面を指定してください')
    expected = [references.index(ref) for ref in references]
    if optional_middle and expected != [0, 1, 0]:
        raise ValueError(f'{label}: 反転操作には開始・隣のページ・開始の順で参照が必要です')
    observed = []
    count = 0
    for frame in frames:
        count += 1
        matches = {state for state, ref in zip(expected, references) if frame == ref}
        if len(matches) != 1:
            paper = [i for i, ref in enumerate(references) if ref[0] == frame[0]]
            number = [i for i, ref in enumerate(references) if ref[1] == frame[1]]
            raise ValueError(f'{label}: 合成フレーム{count}で本文とページ番号が一致しません '
                             f'(本文の一致候補 {paper}, ページ番号の一致候補 {number})')
        state = matches.pop()
        if not observed or observed[-1] != state:
            observed.append(state)
    if observed != expected and not (optional_middle and observed == [0]):
        raise ValueError(f'{label}: 紙面の切替順が違います {observed} / {expected}')
    return {'frames': count, 'intermediateFrames': 0, 'sequence': observed}


_CLOCK = '''([x,y]) => {
 const dot=document.createElement('span');dot.setAttribute('aria-hidden','true');dot.inert=true;
 dot.style.cssText='all:initial!important;position:fixed!important;pointer-events:none!important;'+
  'width:1px!important;height:1px!important;z-index:2147483647!important;'+
  'left:'+x+'px!important;top:'+y+'px!important';
 document.documentElement.append(dot);let id,phase=false;
 function tick(){phase=!phase;dot.style.setProperty('background-color',phase?'#111':'#eee','important');
   id=requestAnimationFrame(tick)}
 tick();return ()=>{cancelAnimationFrame(id);dot.remove()};
}'''


class TurnFrames:
    """One lossless screencast for a group of turns on an existing sync Playwright page.

    Supply body and page-number bounding boxes in top-level CSS pixels. Crop the
    visible reading surface and number labels, excluding gesture buttons, focus
    rings and animated progress bars. Reference pages must be visited and their
    identity checked by the caller independently of the turn being tested.
    """

    def __init__(self, page, cdp, body_box, number_box):
        self.page = page
        self.cdp = cdp
        self.regions = (body_box, number_box)
        self.pending = None

    def __enter__(self):
        geometry = self.page.evaluate('''() => [innerWidth,innerHeight,visualViewport.scale,
                                                visualViewport.offsetLeft,visualViewport.offsetTop]''')
        if geometry[2:] != [1, 0, 0]:
            raise ValueError('等倍の表示位置でページ送りを検査してください')
        self.viewport = tuple(geometry[:2])
        self.boxes = tuple(_box(v, self.viewport) for v in self.regions)
        w, h = self.viewport
        corners = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
        self.marker = next((p for p in corners if all(not (x <= p[0] < r and y <= p[1] < b)
                           for x, y, r, b in self.boxes)), corners[0])
        self.clock = self.page.evaluate_handle(_CLOCK, list(self.marker))
        self.cdp.on('Page.screencastFrame', self._receive)
        try:
            # Explicit CSS-sized compositor output makes one monitor pixel map
            # to one CSS pixel even in the iPhone profile with deviceScaleFactor=3.
            self.cdp.send('Page.startScreencast', {'format': 'png', 'maxWidth': w,
                                                  'maxHeight': h, 'everyNthFrame': 1})
        except Exception:
            self._cleanup()
            raise
        return self

    def _cleanup(self):
        self.cdp.remove_listener('Page.screencastFrame', self._receive)
        self.clock.evaluate('stop => stop()')
        self.clock.dispose()

    def __exit__(self, exc_type, exc, traceback):
        try:
            try:
                self.cdp.send('Page.stopScreencast')
            finally:
                self._cleanup()
        except Exception:
            if exc_type is None:
                raise

    def _receive(self, event):
        if self.pending is not None:
            stamp = event['metadata'].get('timestamp')
            self.pending.append((stamp,event['data']))
        self.cdp.send('Page.screencastFrameAck', {'sessionId': event['sessionId']})

    def _paint_fence(self):
        self.page.wait_for_function('''() => new Promise(done => requestAnimationFrame(() =>
                                     requestAnimationFrame(() => done(true))))''', timeout=5000).dispose()

    def _wait_frames(self, count):
        target = len(self.pending) + count
        deadline = time.monotonic() + 5
        while len(self.pending) < target:
            if time.monotonic() >= deadline:
                raise ValueError('Chromiumの合成フレームを取得できませんでした')
            self.page.wait_for_timeout(20)

    def _presentation_order(self):
        # Screencast PNGs can finish encoding out of order. CDP supplies each
        # frame's swap time independently of delivery. Retain every frame.
        if any(not isinstance(stamp, (float,int)) or not math.isfinite(stamp)
               for stamp,_ in self.pending):
            raise ValueError('Chromiumの描画時刻がないため合成順序を確認できません')
        ordered=sorted(self.pending,key=lambda record:record[0])
        if any(a[0]==b[0] and a[1]!=b[1] for a,b in zip(ordered,ordered[1:])):
            raise ValueError('異なる合成画像の描画時刻が重複しています')
        return [data for _,data in ordered]

    def _sign(self, encoded):
        return _signature(base64.b64decode(encoded), self.boxes, self.viewport, self.marker)

    def reference(self):
        """Read stable endpoint pixels using the very same compositor and sampling scale."""
        self._paint_fence()
        self.pending = []
        try:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                self._wait_frames(2)
                previous, latest = map(self._sign, self._presentation_order()[-2:])
                if previous == latest:
                    return latest
            raise ValueError('参照紙面の描画が確定しませんでした')
        finally:
            self.pending = None

    def check(self, references, action, label='ページ送り', optional_middle=False):
        """Record an action including its completion wait. No internal screenshots or DOM states substitute for a frame."""
        self.pending = []
        try:
            self._wait_frames(2)
            action()
            self._paint_fence()
            self._wait_frames(2)
            frames = (self._sign(data) for data in self._presentation_order())
            return _verify(frames, references, label, optional_middle)
        finally:
            self.pending = None
