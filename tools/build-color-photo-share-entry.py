"""Create a fresh color-photo viewing entry from the fully built, read-only viewer.

Runs after the established build/test pipeline and before Pages artifact upload.
Does not touch private photographs, Google Drive state, editor, or storage keys.
Unlike older saved-view/photo-view paths, this entry has no previously installed
exact-path cache-first service worker to serve an outdated viewer.
"""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = root / 'colors/photo-view.html'
target = root / 'colors/photo-share-20261106.html'
page = source.read_text(encoding='utf-8')

required = (
    'window.FLASHCARDS_READONLY_VIEW=true',
    'review47-local-loader-v2.js',
    'photo-resume-build',
    'auth-only-ui.js',
    'cardNavScrollAnchor',
    'id="swatch"',
)
missing = [token for token in required if token not in page]
if missing:
    raise RuntimeError('The current photo viewer is not fully built: ' + repr(missing))
if 'location.replace(\'./index.html' in page or 'location.replace("./index.html' in page:
    raise RuntimeError('Refusing to make a photo viewer that redirects to the editor')
if page.count('<head>') != 1:
    raise RuntimeError('Unexpected viewer document head')

marker = '<meta name="color-photo-share-entry" content="20261106">'
target.write_text(page.replace('<head>', '<head>\n' + marker, 1), encoding='utf-8')
print('Created a fresh, read-only color photo sharing entry with unchanged Drive account and private-cache keys.')
