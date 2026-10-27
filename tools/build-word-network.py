#!/usr/bin/env python3
"""Build only the word app entry pages. No network access or user-data operations."""
from pathlib import Path
import re

BUILD = '20261028-network2'
root = Path(__file__).resolve().parents[1]
path = root / 'index.html'
html = path.read_text(encoding='utf-8')
for name in ('drive-config.js', 'drive-core.js', 'drive-sync.js'):
    pattern = r'(<script\s+src="\./' + re.escape(name) + r')(?:\?[^"<>]*)?("\s*>\s*</script>)'
    html, count = re.subn(pattern, lambda m: m[1] + '?v=' + BUILD + m[2], html)
    if count != 1:
        raise SystemExit('Expected exactly one root script tag: ' + name)
if 'const KEY="simple_vocab_cards_v1";' not in html:
    raise SystemExit('Word app storage key changed; refusing to build')
if 'word-network-build' not in html:
    html = html.replace('<head>', '<head>\n<meta name="word-network-build" content="' + BUILD + '">', 1)
# Keep the usual bookmark working; the second URL has never cached the old entry.
path.write_text(html, encoding='utf-8')
(root / 'word-sync-v2.html').write_text(html, encoding='utf-8')
assert './drive-sync.js?v=' + BUILD in html
print('Versioned root word app and word-sync-v2.html built; private data unchanged.')
