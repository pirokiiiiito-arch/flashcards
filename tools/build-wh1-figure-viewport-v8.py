"""Build current WH1 entries; retain this filename for existing workflows."""
from pathlib import Path
import hashlib
import json
import re

root = Path(__file__).resolve().parents[1]
folder = root / 'reader/wh1/all'
path = folder / 'index.html'
html = path.read_text(encoding='utf-8')
revision = 'figure-viewport-v9-20261110'
module = 'wh1-figure-viewport-v9.js'
# Idempotent when the build is repeated.
html = re.sub(r'<script src="\./wh1-figure-viewport-v[89]\.js(?:\?[^\"]*)?"></script>\s*', '', html)
pattern = r'<script src="\./wh1-exact-pagination\.js(?:\?[^\"]*)?"></script>'
replacement = ('<script src="./wh1-exact-pagination.js?v=' + revision + '"></script>\n'
               '<script src="./' + module + '?v=' + revision + '"></script>')
html, count = re.subn(pattern, lambda _: replacement, html)
if count != 1:
    raise SystemExit(f'Expected one WH1 pager entry; found {count}. No output written.')
html = html.replace("navigator.serviceWorker.register('./sw.js',{scope:'./'})",
                    "navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'})")
assert 'wh1-unified-book' in html
assert 'WH1_UNIFIED_POSITION' in html
assert html.index(module) < html.index('const SEGMENTS=')
assert (folder / module).is_file()
assert revision in (folder / module).read_text(encoding='utf-8')
assert 'src="./wh1-figure-viewport-v8.js' not in html
path.write_text(html, encoding='utf-8')
# A distinct navigation URL bypasses an already-open older document. Same origin,
# path depth, IndexedDB and position keys; no re-import or storage deletion.
for entry in ('figure-repair-v9.html', 'figure-repair-v8.html'):
    (folder / entry).write_text(html, encoding='utf-8')
report = {'revision': revision, 'entry': 'figure-repair-v9.html',
          'aliases': ['figure-repair-v8.html'],
          'index_sha256': hashlib.sha256(html.encode()).hexdigest(),
          'private_book_modified': False,
          'verification': 'Build checks only. Browser and real-iPhone verification are separate.'}
for report_name in ('figure-repair-v9-build.json', 'figure-repair-v8-build.json'):
    (folder / report_name).write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))

