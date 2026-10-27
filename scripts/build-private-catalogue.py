"""Build metadata only; never publish or modify the original image bytes."""
import argparse
import hashlib
import json
import re
from pathlib import Path
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
text = (args.source / 'index.html').read_text()
decoder = json.JSONDecoder()

def constant(name):
    found = re.search(r'const ' + name + r'=', text)
    if not found:
        raise ValueError('Missing source constant: ' + name)
    return decoder.raw_decode(text[found.end():])[0]

cards, research, render_cache = (constant(n) for n in ['CARDS', 'RESEARCH_DATA', 'ORIGIN_PHOTO_RENDER_CACHE'])
original = json.loads((args.source / 'asset_manifest.json').read_text())['files']
files = {}
for path, info in original.items():
    image_path = args.source / path
    raw = image_path.read_bytes()
    if len(raw) != info['bytes'] or hashlib.sha256(raw).hexdigest() != info['sha256']:
        raise ValueError('Original image integrity mismatch: ' + path)
    with Image.open(image_path) as image:
        width, height = image.size
        orientation = int(image.getexif().get(274, 1))
    files[path] = {**info, 'asset_id': info['sha256'], 'original_asset_path': path,
                   'width': width, 'height': height, 'exif_orientation': orientation}

registrations = []
for index, card in enumerate(cards):
    color_id = f'color-{index + 1:04d}'
    item = research[card['name']]
    for role in ['origin', 'interior', 'fashion', 'product', 'palette']:
        photo = item.get('photo') if role == 'origin' else item.get('usage_examples', {}).get(role)
        if not photo or not photo.get('url'):
            continue
        path = photo['url']
        if role == 'origin':
            path = render_cache.get(photo.get('page'), {}).get('url', path)
        if path not in files:
            raise ValueError('Unresolved registration: ' + color_id + ':' + role)
        info = files[path]
        registrations.append({
            'photo_id': photo.get('photo_id') or color_id + ':' + role,
            'registration_id': color_id + ':' + role,
            'original_photo_id': photo.get('photo_id') or photo.get('id'),
            'color_id': color_id, 'role': role, 'asset_id': info['sha256'],
            'original_asset_path': path, 'drive_file_id': None, 'drive_ref': None,
            'mime_type': info['mime_type'], 'size': info['bytes'], 'sha256': info['sha256'],
            'width': info['width'], 'height': info['height'], 'exif_orientation': info['exif_orientation'],
            'suppressed_duplicate': bool(photo.get('display_suppressed_duplicate'))
        })

assert len(cards) == 1000
assert len(files) == 940
assert len(registrations) == 1047
assert sum(r['suppressed_duplicate'] for r in registrations) == 107
assert len({r['asset_id'] for r in registrations}) == 940
catalogue = {'schema': 'colors1000-private-assets-v2',
             'counts': {'fixed_cards': 1000, 'unique_images': 940, 'registrations': 1047, 'suppressed_duplicates': 107},
             'files': files, 'registrations': registrations}
args.output.write_text(json.dumps(catalogue, ensure_ascii=False, separators=(',', ':')) + '\n')
print(json.dumps({**catalogue['counts'], 'original_sha256_mismatches': 0, 'unresolved_registrations': 0}))
