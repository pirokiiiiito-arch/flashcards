"""Prepare private, source-only caption review sheets and pin the finished reviews.

init takes {bookId, range:[first,last], pages:[{scan,source,ocr}]}.
Paths in this input are relative to the file or absolute. Use null while a
source or its original OCR is unavailable. A review never starts as complete.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile


INDEX = 'caption-census.json'


def load(path):
    return json.loads(path.read_bytes())


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as out:
        temporary = Path(out.name)
        try:
            out.write(data)
            out.close()
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def json_bytes(obj):
    return (json.dumps(obj, ensure_ascii=False, indent=2) + '\n').encode()


def local(work, name):
    if not isinstance(name, str) or not name or Path(name).is_absolute() or '..' in Path(name).parts:
        raise ValueError('資料のパスを作業フォルダ内で指定してください')
    path = (work / name).resolve()
    if not path.is_relative_to(work.resolve()):
        raise ValueError('作業フォルダ外の資料です')
    return path


def reference(path, work):
    return {'path': path.relative_to(work).as_posix(), 'sha256': digest(path.read_bytes())}


def pinned_input(source, scan, field, parent, work):
    if source is None:
        return None
    if not isinstance(source, str) or not source:
        raise ValueError(f'{scan}: {field} の入力パスが不正です')
    path = parent / source
    data = path.read_bytes()
    suffix = path.suffix.lower() if field == 'source' else '.json'
    fingerprint = digest(data)
    dest = work / 'inputs' / f'{scan:04}-{field}-{fingerprint}{suffix}'
    if not dest.exists() or digest(dest.read_bytes()) != fingerprint:
        write(dest, data)
    return {'path': dest.relative_to(work).as_posix(), 'sha256': fingerprint}


def draft(work, folder, name, value):
    path = folder / name
    if not path.exists():
        write(path, json_bytes(value))
    return reference(path, work)


def pin_ocr_origins(work, book, scope, pages):
    # Persist the ingest receipt independently of review files and keep earlier revisions.
    rows = [{'scan': p['scan'], 'sourceSha256': p['source']['sha256'] if p['source'] else None,
             'rawSha256': p['ocr']['sha256'] if p['ocr'] else None} for p in pages]
    data = json_bytes({'schema': 'reader-caption-ocr-origin-v1', 'bookId': book, 'range': scope, 'pages': rows})
    path = work / 'inputs' / f'ocr-origins-{digest(data)}.json'
    write(path, data)
    return reference(path, work)


def init(sources, work):
    data = load(sources)
    first, last = data['range']
    book = data['bookId']
    if not isinstance(book, str) or not book.strip() or not all(type(n) is int for n in (first, last)) or not 1 <= first <= last:
        raise ValueError('書籍IDと原本範囲を確認してください')
    index_path = work / INDEX
    if index_path.exists():
        old = load(index_path)
        if old['bookId'] != book or old['range'] != [first, last]:
            raise ValueError('別の書籍または原本範囲用の作業フォルダです')
    by_scan = {}
    for row in data['pages']:
        n = row['scan']
        if type(n) is not int or not first <= n <= last or n in by_scan:
            raise ValueError(f'原本番号の範囲または重複を確認してください: {n}')
        by_scan[n] = row
    pages = []
    for scan in range(first, last + 1):
        row = by_scan.get(scan, {})
        image = pinned_input(row.get('source'), scan, 'source', sources.parent, work)
        raw_ref = pinned_input(row.get('ocr'), scan, 'ocr', sources.parent, work)
        image_sha = image['sha256'] if image else None
        folder = work / 'pages' / f'{scan:04}-{image_sha or "missing"}'
        identity = {'scan': scan, 'sourceSha256': image_sha, 'reviewedBy': '', 'passId': ''}
        census = draft(work, folder, 'census.json', {**identity, 'wholePage': False, 'figures': [], 'captions': []})
        review = draft(work, folder, 'review.json', {**identity, 'wholePage': False, 'blindToOutput': False, 'blindToCensus': False, 'figureIds': [], 'captions': []})
        audit = None
        if raw_ref:
            raw = load(local(work, raw_ref['path']))
            rows = raw['rows']
            if not isinstance(rows, list) or raw.get('scan') != scan or (image and raw.get('source_sha256') != image_sha):
                raise ValueError(f'{scan}: 原本とOCR全行の出典が一致しません')
            row_bytes = json.dumps(rows, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
            audit = draft(work, folder, 'ocr-audit-' + raw_ref['sha256'] + '.json', {
                **identity, 'rawSha256': raw_ref['sha256'], 'rowCount': len(rows),
                'rowsSha256': digest(row_bytes), 'decisions': [],
            })
        pages.append({'scan': scan, 'source': image, 'ocr': raw_ref, 'census': census, 'review': review, 'ocrAudit': audit})
    index = {'schema': 'reader-caption-census-v1', 'bookId': book, 'range': [first, last], 'pages': pages,
             'originalOcrSources': pin_ocr_origins(work, book, [first, last], pages)}
    write(index_path, json_bytes(index))
    return index


def attach(sources, work):
    update = load(sources)
    index = load(work / INDEX)
    if update['bookId'] != index['bookId']:
        raise ValueError('OCRの対象書籍が一致しません')
    first, last = update['range']
    if not index['range'][0] <= first <= last <= index['range'][1]:
        raise ValueError('追加する原本の範囲が一致しません')
    by_scan = {}
    for row in update['pages']:
        scan = row['scan']
        if type(scan) is not int or not first <= scan <= last or scan in by_scan:
            raise ValueError('追加する原本番号の範囲または重複を確認してください')
        by_scan[scan] = row
    merged = []
    for page in index['pages']:
        scan = page['scan']
        row = by_scan.get(scan, {})
        inputs = {'scan': scan}
        for key in ('source', 'ocr'):
            ref = page.get(key)
            current = local(work, ref['path']) if ref else None
            if current and digest(current.read_bytes()) != ref['sha256']:
                raise ValueError(f'{scan}: 保存済みの原資料の版が一致しません')
            supplied = row.get(key)
            selected = (sources.parent / supplied).resolve() if supplied else current
            if key == 'source' and current and supplied and digest(selected.read_bytes()) != ref['sha256']:
                raise ValueError(f'{scan}: 原本の異なるOCRを追加できません')
            inputs[key] = str(selected) if selected else None
        merged.append(inputs)
    with tempfile.TemporaryDirectory() as temp:
        manifest = Path(temp) / 'sources.json'
        manifest.write_bytes(json_bytes({'bookId': index['bookId'], 'range': index['range'], 'pages': merged}))
        return init(manifest, work)


def refresh(work):
    index = load(work / INDEX)
    origin = index['originalOcrSources']
    if reference(local(work, origin['path']), work) != origin:
        raise ValueError('OCR取り込み時の記録が一致しません')
    for page in index['pages']:
        for key in ('source', 'ocr', 'census', 'review', 'ocrAudit'):
            ref = page.get(key)
            if ref is None:
                continue
            path = local(work, ref['path'])
            actual = reference(path, work)
            if key in ('source', 'ocr') and ref != actual:
                raise ValueError(f'{page["scan"]}: {key} の版が変わりました。元の入力一覧で init を再実行してください')
            if key in ('census', 'review', 'ocrAudit'):
                load(path)
            page[key] = actual
    write(work / INDEX, json_bytes(index))
    return index


def sheets(index, work):
    from PIL import Image, ImageDraw, ImageOps
    for start in range(0, len(index['pages']), 20):
        chunk = index['pages'][start:start + 20]
        width, height = 260, 340
        sheet = Image.new('RGB', (width * min(len(chunk), 4), height * ((len(chunk) + 3) // 4)), 'white')
        pen = ImageDraw.Draw(sheet)
        for i, page in enumerate(chunk):
            left, top = (i % 4) * width, (i // 4) * height
            pen.text((left + 5, top + 2), str(page['scan']), fill='black')
            if page['source']:
                with Image.open(local(work, page['source']['path'])) as original:
                    preview = ImageOps.contain(original.convert('RGB'), (width - 8, height - 22))
                    sheet.paste(preview, (left + 4, top + 19))
            else:
                pen.text((left + 5, top + 32), 'Source pending', fill='black')
        path = work / 'sheets' / f'{chunk[0]["scan"]:04}-{chunk[-1]["scan"]:04}.jpg'
        path.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(path, quality=90)


def crops(work, padding):
    from PIL import Image
    if padding < 0:
        raise ValueError('余白は0以上を指定してください')
    result = []
    index = load(work / INDEX)
    for page in index['pages']:
        if not page['source']:
            continue
        ref = page['source']
        path = local(work, ref['path'])
        if digest(path.read_bytes()) != ref['sha256']:
            raise ValueError(f'{page["scan"]}: 原本画像の版が変わりました')
        census = load(local(work, page['census']['path']))
        if census['sourceSha256'] != ref['sha256'] or census['scan'] != page['scan']:
            raise ValueError('領域の記録と原本が一致しません')
        with Image.open(path) as source:
            for ordinal, item in enumerate(census['captions'], 1):
                x, y, right, bottom = item['box']
                if not 0 <= x < right <= source.width or not 0 <= y < bottom <= source.height:
                    raise ValueError(f'{page["scan"]}: 原本外の図説領域です')
                box = [max(0, x-padding), max(0, y-padding), min(source.width, right+padding), min(source.height, bottom+padding)]
                dest = work / 'crops' / f'{page["scan"]:04}-{ordinal:03}.png'
                dest.parent.mkdir(parents=True, exist_ok=True)
                source.crop(box).save(dest)
                result.append({'scan': page['scan'], 'captionId': item['id'], 'sourceSha256': ref['sha256'],
                               'box': box, 'crop': reference(dest, work)})
    write(work / 'crops/index.json', json_bytes(result))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    p = commands.add_parser('init')
    p.add_argument('--sources', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--records-only', action='store_true', help='台帳を先に準備し、原本一覧画像は sheets で生成')
    p = commands.add_parser('attach')
    p.add_argument('--sources', type=Path, required=True)
    p.add_argument('--work', type=Path, required=True)
    p.add_argument('--records-only', action='store_true', help='一覧画像を再生成せずに資料を追加')
    p = commands.add_parser('sheets')
    p.add_argument('--work', type=Path, required=True)
    p = commands.add_parser('refresh')
    p.add_argument('--work', type=Path, required=True)
    p = commands.add_parser('crops')
    p.add_argument('--work', type=Path, required=True)
    p.add_argument('--padding', type=int, default=48)
    args = parser.parse_args()
    if args.action == 'init':
        result = init(args.sources.resolve(), args.out.resolve())
        if not args.records_only:
            sheets(result, args.out.resolve())
        print(f'{len(result["pages"])}枚の作業台帳を用意しました')
    elif args.action == 'attach':
        result = attach(args.sources.resolve(), args.work.resolve())
        if not args.records_only:
            sheets(result, args.work.resolve())
        print(f'{len(result["pages"])}枚の台帳に追加の原資料を反映しました')
    elif args.action == 'sheets':
        work = args.work.resolve()
        sheets(load(work / INDEX), work)
        print('20枚単位の原本一覧画像を生成しました')
    elif args.action == 'refresh':
        print(f'{len(refresh(args.work.resolve())["pages"])}枚の記録の版を固定しました')
    else:
        print(f'{len(crops(args.work.resolve(), args.padding))}件の原本図説を余白付きで切り出しました')


if __name__ == '__main__':
    main()
