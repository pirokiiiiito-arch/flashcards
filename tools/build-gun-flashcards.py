"""Build an isolated firearm flashcard sync core from the verified plant queue.

Only guns/drive-transfer-core.js is generated. This script must not modify
the word/plant/color applications, research, source photos or private data.
"""
from pathlib import Path
import hashlib,json

R=Path(__file__).resolve().parents[1]
def read(name):return (R/name).read_text(encoding='utf-8')
def write(name,body):(R/name).write_text(body,encoding='utf-8')
def checksum(name):return hashlib.sha256((R/name).read_bytes()).hexdigest()

protected=['drive-core.js','persistent-drive-auth.js','drive-config.js','index.html','drive-sync.js',
  'plants/index.html','plants/drive-sync.js','plants/drive-image-copy.js',
  'colors/index.html','colors/drive-sync.js','colors/app-main.js',
  'colors/data/review47-progress.b64','colors/private-assets-manifest.json']
before={x:checksum(x) for x in protected}
src=read('plants/drive-transfer-core.js')
for marker in ['plantPhotoDeferred','async function republish(keys)','pendingKeys: () =>',
               'pendingValues: prefix =>','root.FlashcardsDrive']:
    if marker not in src:raise RuntimeError('The verified plant transfer core changed: '+marker)
guns=src.replace('plantPhotoDeferred','gunPhotoDeferred')
write('guns/drive-transfer-core.js',guns)
if before!={x:checksum(x) for x in protected}:
    raise RuntimeError('An existing application or its research was changed')
output={'schema':'gun-flashcards-build-v1','source':'verified-plant-journal-core',
        'namespace':'gun-flashcards-v1','deferred_marker':'gunPhotoDeferred',
        'data_changes':False,'other_apps_modified':False,
        'protected_sha256':before}
write('guns/build-report.json',json.dumps(output,indent=2,ensure_ascii=False)+'\n')
print('Gun cards built: independent Drive journal, images retained on copy failure.')
