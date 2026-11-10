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
check_revision = 'display-check-v9-1-20261110'
check_module = 'wh1-display-check-v9.js'
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
assert (folder / check_module).is_file()
assert check_revision in (folder / check_module).read_text(encoding='utf-8')
path.write_text(html, encoding='utf-8')
# A distinct navigation URL bypasses an already-open older document. Same origin,
# path depth, IndexedDB and position keys; no re-import or storage deletion.
for entry in ('figure-repair-v9.html', 'figure-repair-v8.html'):
    (folder / entry).write_text(html, encoding='utf-8')
# Diagnostics are a separate entry. Keep the normal reader byte-identical and
# put the static marker outside its iframe, even when diagnostic JS cannot run.
viewport_script = '<script src="./' + module + '?v=' + revision + '"></script>'
check_script = '<script src="./' + check_module + '?revision=' + check_revision + '"></script>'
fallback = ('<aside id="wh1-display-check-fallback" role="status" '
            'style="position:fixed;z-index:45;right:8px;top:calc(6px + env(safe-area-inset-top));'
            'max-width:128px;padding:4px 7px;border:1px solid #c6d8d2;border-radius:7px;'
            'background:#fffdf7;color:#233539;font:11px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;'
            'pointer-events:none">確認9.1 · 確認待ち</aside>')
assert html.count(viewport_script) == 1 and html.count('<body>') == 1
check_html = html.replace(viewport_script, viewport_script + '\n' + check_script, 1)
check_html = check_html.replace('<title>', '<title>確認9.1｜', 1)
check_html = check_html.replace('<body>', '<body>\n' + fallback, 1)
(folder / 'figure-check-v9-1.html').write_text(check_html, encoding='utf-8')
report = {'revision': revision, 'entry': 'figure-repair-v9.html',
          'aliases': ['figure-repair-v8.html'],
          'index_sha256': hashlib.sha256(html.encode()).hexdigest(),
          'private_book_modified': False,
          'verification': 'Build checks only. Browser and real-iPhone verification are separate.'}
for report_name in ('figure-repair-v9-build.json', 'figure-repair-v8-build.json'):
    (folder / report_name).write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))

