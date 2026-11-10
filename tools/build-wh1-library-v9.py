"""Attach the current WH1 renderer to the existing bookshelf storage and routes."""
from pathlib import Path
import hashlib
import json
import re

root = Path(__file__).resolve().parents[1]
folder = root / 'reader/library'
source = root / 'reader/wh1/all'
revision = 'wh1-library-v9-20261110'
copies = {
    'wh1-pager-v9.js': 'wh1-exact-pagination.js',
    'wh1-figure-viewport-v9.js': 'wh1-figure-viewport-v9.js',
    'wh1-display-check-v9.js': 'wh1-display-check-v9.js',
}
base = (folder / 'read.html').read_text(encoding='utf-8')
legacy_pager = (folder / 'wh1-exact-pagination.js').read_bytes()
pattern = r'<script src="\./wh1-exact-pagination\.js(?:\?[^\"]*)?"></script>'
scripts = ('<script src="./wh1-pager-v9.js?v=' + revision + '"></script>\n'
           '<script src="./wh1-figure-viewport-v9.js?v=' + revision + '"></script>\n'
           '<script src="./wh1-display-check-v9.js?revision=display-check-v9-1-20261110"></script>')
html, count = re.subn(pattern, lambda _: scripts, base)
if count != 1:
    raise SystemExit(f'Expected one legacy bookshelf pager; found {count}. No output written.')
assert base.count('<body>') == 1 and base.count('<title>') == 1
assert 'LibraryDB.findBlob(BOOK_ID)' in html
assert "const POSITION_KEY='BOOK_POSITION_'+BOOK_ID" in html
assert "localStorage.getItem('WH1_UNIFIED_POSITION')" in html
fallback = ('<aside id="wh1-display-check-fallback" role="status" '
            'style="position:fixed;z-index:45;right:8px;top:calc(6px + env(safe-area-inset-top));'
            'max-width:128px;padding:4px 7px;border:1px solid #c6d8d2;border-radius:7px;'
            'background:#fffdf7;color:#233539;font:11px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;'
            'pointer-events:none">確認9.1 · 確認待ち</aside>')
html = html.replace('<title>', '<title>確認9.1｜', 1)
html = html.replace('<body>', '<body>\n' + fallback, 1)
payloads = {dest: (source / src).read_bytes() for dest, src in copies.items()}
assert b'figure-viewport-v9-20261110' in payloads['wh1-figure-viewport-v9.js']
assert b'display-check-v9-1-20261110' in payloads['wh1-display-check-v9.js']
for dest, payload in payloads.items():
    (folder / dest).write_bytes(payload)
(folder / 'read-wh1-v9.html').write_text(html, encoding='utf-8')
assert (folder / 'read.html').read_text(encoding='utf-8') == base
assert (folder / 'wh1-exact-pagination.js').read_bytes() == legacy_pager
report = {
    'revision': revision, 'entry': 'read-wh1-v9.html',
    'reader_sha256': hashlib.sha256(html.encode()).hexdigest(),
    'modules_sha256': {dest: hashlib.sha256(payload).hexdigest() for dest, payload in payloads.items()},
    'private_book_modified': False,
    'storage': 'Existing LibraryDB and BOOK_POSITION_<original book id> retained',
    'verification': 'Build checks only. Browser and real-iPhone verification are separate.',
}
(folder / 'wh1-library-v9-build.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
