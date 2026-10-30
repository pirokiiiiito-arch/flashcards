"""Run last, after settle-plant-auth-ui.py. Layout-only plant change.
Move the existing description node; never rewrite descriptions or photo data.
"""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
ENTRIES = ['plants/' + name for name in (
    'index.html', 'plant-sync-v2.html', 'drive-view.html', 'saved-view.html',
    'pc-order-view.html', 'auto-view.html', 'photo-view.html')]
WORKERS = ['plants/service-worker.js', 'plants/drive-view-worker.js']
REPORT = 'plants/description-first-build.json'
OLD = 'body.append(left,desc);back.append(bl,body);'
NEW = 'body.append(desc,left);back.append(bl,body);'

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def digest(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()

# Only HTML node order and public application-cache versions may change.
allowed = set(ENTRIES + WORKERS + [REPORT])
protected = [str(p.relative_to(ROOT)) for p in ROOT.rglob('*')
             if p.is_file() and '.git' not in p.relative_to(ROOT).parts
             and str(p.relative_to(ROOT)) not in allowed]
before = {path: digest(path) for path in protected}
updates = {}
for path in ENTRIES:
    text = read(path)
    old_count, new_count = text.count(OLD), text.count(NEW)
    if (old_count, new_count) == (1, 0):
        updates[path] = text.replace(OLD, NEW, 1)
        if updates[path].replace(NEW, OLD, 1) != text:
            raise RuntimeError('Unexpected plant content change: ' + path)
    elif (old_count, new_count) == (0, 1):
        updates[path] = text
    else:
        raise RuntimeError('Plant render anchor changed: ' + path)
for path in WORKERS:
    text, count = re.subn(r"(const CACHE\s*=\s*')([^']+)(')",
                         lambda m: m[1] + m[2] + '-description1' + m[3],
                         read(path), count=1)
    if count != 1:
        raise RuntimeError('Plant public cache anchor changed: ' + path)
    updates[path] = text
for path, text in updates.items():
    (ROOT / path).write_text(text, encoding='utf-8')
if before != {path: digest(path) for path in protected}:
    raise RuntimeError('A protected data, photograph, authentication or sync file changed')
(ROOT / REPORT).write_text(json.dumps({
    'schema': 'plant-description-first-v1', 'entries': ENTRIES,
    'layout': ['description', 'image1', 'image2', 'image3'],
    'protected_sha256': before, 'new_urls': False
}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('Plant description now precedes all three photos in every existing entry. All data, auth, sync, photo and other-app files unchanged.')
