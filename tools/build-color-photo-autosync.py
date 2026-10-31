"""Build a color-card-only, privacy-preserving automatic manual-photo sender.

Run after settle-plant-auth-ui.py (and all other existing generators) and before
the final Pages upload. Leaves the 1000-card dataset, 940 original photographs,
manual user photos, origin records, study history, and word/plant apps unchanged.
"""
from pathlib import Path
import re, hashlib, json

ROOT=Path(__file__).resolve().parents[1]
def read(name): return (ROOT/name).read_text(encoding='utf-8')
def write(name, value): (ROOT/name).write_text(value,encoding='utf-8')
def sha(name): return hashlib.sha256((ROOT/name).read_bytes()).hexdigest()
def replace_one(src, old, new, label):
    count=src.count(old)
    if count!=1: raise RuntimeError(f'Color auto photo build anchor {label}: expected 1, got {count}')
    return src.replace(old,new,1)
def replace_regex_one(src, pattern, replacement, label):
    result, count=re.subn(pattern,replacement,src,count=1)
    if count!=1: raise RuntimeError(f'Color auto photo regex anchor {label}: {count}')
    return result

allowed={
    'colors/drive-transfer-core.js',
    'colors/data/review47-loader.js',
    'colors/index.html','colors/color-sync-v2.html',
    'colors/service-worker.js','colors/color-auto-photo-build.json',
}
protected=[str(p.relative_to(ROOT)) for p in ROOT.rglob('*')
           if p.is_file() and '.git' not in p.relative_to(ROOT).parts
           and str(p.relative_to(ROOT)) not in allowed]
before={name:sha(name) for name in protected}

# Reuse the already-tested plant-specialized journal core, with the deferred
# error marker isolated to color manual photo records. Do not alter shared core.
core=read('plants/drive-transfer-core.js')
if core.count('plantPhotoDeferred')!=1 or 'async function republish(keys)' not in core or 'pendingKeys: () =>' not in core:
    raise RuntimeError('The plant queue core changed; color auto-photo copy needs review')
core=core.replace('plantPhotoDeferred','colorPhotoDeferred')
write('colors/drive-transfer-core.js',core)

# The native editor loads a verified photo registry first; replace the core
# only for this editor, never a viewer or a different application.
loader=read('colors/data/review47-loader.js')
loader=replace_regex_one(loader,r"'\.\./drive-core\.js\?v=[^']+'",
                         "'./drive-transfer-core.js?v=autophoto1'",'editor core')
loader=replace_regex_one(loader,r"'\./drive-sync\.js\?v=[^']+'",
                         "'./drive-sync.js?v=autophoto1'",'editor sync')
write('colors/data/review47-loader.js',loader)

for name in ['colors/index.html','colors/color-sync-v2.html']:
    page=read(name)
    page=replace_regex_one(page,r'(data/review47-loader\.js)\?v=[^"''\s<>]+',
                           r'\1?v=autophoto1','editor loader '+name)
    write(name,page)

worker=read('colors/service-worker.js')
worker=replace_regex_one(worker,r"(const CACHE\s*=\s*')([^']+)(')",
                         lambda m:m[1]+m[2]+'-autophoto1'+m[3],'worker cache')
worker=replace_regex_one(worker,r"'\./drive-sync\.js\?v=[^']+'",
                         "'./drive-sync.js?v=autophoto1'",'worker sync')
worker=replace_regex_one(worker,r"'\./data/review47-loader\.js\?v=[^']+'",
                         "'./data/review47-loader.js?v=autophoto1'",'worker loader')
worker=replace_one(worker,"'./asset-migration.js?v=1'",
                         "'./drive-transfer-core.js?v=autophoto1', './asset-migration.js?v=1'",
                         'worker offline core asset')
write('colors/service-worker.js',worker)

after={name:sha(name) for name in protected}
if before!=after: raise RuntimeError('Protected color photo data, origins, plant or word app changed')
write('colors/color-auto-photo-build.json',json.dumps({
    'schema':'colors1000-manual-photo-auto-sync-v1',
    'scope':'manual photo registrations only',
    'root_drive_core_changed':False,
    'source_photos_changed':False,
    'origin_texts_changed':False,
    'user_data_changed':False,
    'queue_deferred_value':'colorPhotoDeferred',
    'protected_sha256':after,
},ensure_ascii=False,indent=2)+'\n')
print('Color manual photo automatic Drive sender prepared; immutable review47 assets and user data preserved.')
