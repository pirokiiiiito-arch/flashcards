"""Run AFTER the existing editor and read-only builds.
Restore the original palette row using photoSlot(index, 'palette'). Do not
rewrite saved records, card IDs, Drive references, deletion history or photos.
"""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]

def read(name):
    return (ROOT / name).read_text(encoding='utf-8')

def write(name, text):
    (ROOT / name).write_text(text, encoding='utf-8')

def replace_once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError('Palette restoration anchor changed: ' + old[:110])
    return text.replace(old, new, 1)

def sha(name):
    return hashlib.sha256((ROOT / name).read_bytes()).hexdigest()

protected = [
    'drive-core.js', 'drive-sync.js', 'index.html', 'word-network-recovery.js',
    'plants/index.html', 'plants/drive-sync.js', 'plants/drive-view.html',
    'colors/drive-sync.js', 'colors/readonly-adapter.js',
    'colors/origin-editor.js', 'colors/network-support.js',
    'colors/data/review47-progress.b64', 'colors/private-assets-manifest.json',
]
before = {name: sha(name) for name in protected}
row = '<div class="palette-photo-row">${photoSlot(index,\'palette\')}</div>'
anchor = "${photoSlot(index,'product')}</div><p class=\"paste-hint\">"
replacement = "${photoSlot(index,'product')}</div>" + row + '<p class="paste-hint">'

for name in ['colors/app-main.js', 'colors/app-view.js']:
    text = read(name)
    if row in text:
        raise RuntimeError('Palette row already present; do not add it twice: ' + name)
    if "palette:'配色'" not in text or "'palette'" not in text:
        raise RuntimeError('Existing palette role must be retained: ' + name)
    updated = replace_once(text, anchor, replacement)
    # Apart from this one row, the full app stays byte-identical.
    if updated.replace(row, '', 1) != text:
        raise RuntimeError('Unexpected app changes: ' + name)
    write(name, updated)

# New resource URLs invalidate old script caches without removing browser data.
versions = {
    'colors/data/review47-loader.js': ("'./app-main.js?v=network2'", "'./app-main.js?v=palette1'"),
    'colors/data/review47-view-loader.js': ("'./app-view.js?v=1'", "'./app-view.js?v=palette1'"),
    'colors/index.html': ('data/review47-loader.js?v=network2', 'data/review47-loader.js?v=palette1'),
    'colors/color-sync-v2.html': ('data/review47-loader.js?v=network2', 'data/review47-loader.js?v=palette1'),
    'colors/drive-view.html': ('data/review47-view-loader.js?v=1', 'data/review47-view-loader.js?v=palette1'),
}
for name, (old, new) in versions.items():
    write(name, replace_once(read(name), old, new))
sw = read('colors/service-worker.js')
for old, new in [
    ('colors1000-review47-drive3-network2', 'colors1000-review47-drive3-palette1'),
    ('./data/review47-loader.js?v=network2', './data/review47-loader.js?v=palette1'),
    ('./app-main.js?v=network2', './app-main.js?v=palette1'),
]:
    sw = replace_once(sw, old, new)
write('colors/service-worker.js', sw)

after = {name: sha(name) for name in protected}
if before != after:
    raise RuntimeError('Protected data or another app was changed')
write('colors/palette-restoration.json', json.dumps({
    'schema': 'colors-palette-render-restoration-v1',
    'role': 'palette',
    'photo_key_pattern': 'color-NNNN:palette',
    'restored_apps': ['app-main.js', 'app-view.js'],
    'unchanged_protected_sha256': after,
    'private_photos_published': False,
    'remote_photo_download_verified': False,
}, ensure_ascii=False, indent=2) + '\n')
print('Palette row restored in editor and storage-free viewer; existing photo keys and all protected files unchanged.')
