"""Resolve frozen OCR discrepancies against original scans and the exact shelf payload."""
import base64
import json
import re
import zipfile
from collections import Counter, defaultdict
from io import BytesIO

from PIL import Image
from reader_shelf_probe import check
from reader_shelf_proof import pinned, pinned_bytes, reading_members, sha
from reader_shelf_template import part_image, read_part, template_entries

READINGS = ('primary', 'alternate', 'independent')
BODY = ('body', 'dialogue')


def indexed(rows, key, label):
    check(isinstance(rows, list), f'{label}の一覧がありません')
    result = {}
    for row in rows:
        check(isinstance(row, dict), f'{label}の項目が不正です')
        ident = key(row)
        check(ident not in result, f'{label}の重複: {ident}')
        result[ident] = row
    return result


def original_images(zipped, manifest, books):
    """Read original bytes independently from the observation and correction files."""
    images = {}

    def add(scan, data, declared=None):
        fingerprint = sha(data)
        check(not declared or declared == fingerprint, f'原本{scan}の画像が制作台帳と違います')
        if scan in images:
            check(images[scan][0] == fingerprint, f'原本{scan}の画像が収録経路で異なります')
            return
        with Image.open(BytesIO(data)) as image:
            images[scan] = (fingerprint, image.size)

    for key, ref in manifest.get('originalScans', {}).items():
        add(int(key), zipped.read(ref['path']), ref['sha256'])
    parts = {p['part']:p for p in manifest.get('segments', [])}
    for name, book in books.items():
        for page in book.get('originals', []) or book.get('pages', []):
            scan = page['scan']
            uri = page.get('src') or page.get('dataUrl') or page.get('original')
            if not isinstance(uri, str) or not uri:
                continue
            resource = part_image(uri, parts.get(name, {'part': name}), zipped.read)
            header, _, payload = resource.partition(',')
            check(re.fullmatch(r'data:image/[a-z0-9+.-]+;base64', header), f'原本{scan}の画像形式が不正です')
            add(scan, base64.b64decode(payload, validate=True), page.get('sha256'))
    return images


def book_blocks(book):
    if 'pages' in book:
        for page in book['pages']:
            for block in page['blocks']:
                yield page['scan'], block
    else:
        for entry in template_entries(book):
            if entry['kind'] == 'text':
                for block in entry.get('blocks', [entry]):
                    yield block.get('scan', entry.get('scan')), block


def wh1_blocks(data):
    # The WH1 pack verifier already checks the visible 011–030 host, joins and these literals.
    lines = re.findall(rb'^const blocks=(.*);$', data, re.M)
    check(len(lines) == 1, '世界の歴史の読書HTMLから本文列を取得できません')
    for block in json.loads(lines[0]):
        if block.get('type') == 'figure':
            continue
        if 'sourceSpans' not in block or block.get('type') != 'body':
            yield block['scan'], block
            continue
        value = block['text'].encode('utf-16-le')
        for span in block['sourceSpans']:
            piece = value[span['start']*2:span['end']*2].decode('utf-16-le')
            yield span['scan'], dict(type='body', text=piece, sourceRef=span['sourceRef'])


def painted_blocks(directory, reference, name, data, book_id, archive_sha, bounds, site):
    """For custom readers, accept the actual shelf painting pinned to the same member and renderer."""
    path, receipt = pinned(directory, reference)
    check(receipt.get('schema') == 'reader-proof-readback-v1' and receipt.get('route') == 'shelf'
          and receipt.get('archiveSha256') == archive_sha and receipt.get('artifactSha256') == sha(data)
          and receipt.get('bookId') == book_id and receipt.get('member') == name and receipt.get('range') == bounds,
          '独自書式の本棚読戻しが対象の書籍・配布版と一致しません')
    host_files = receipt.get('hostFiles', {})
    check(site and 'reader/library/read.html' in host_files, '読戻しに本棚の読書プログラムがありません')
    for resource, expected in host_files.items():
        pinned_bytes(site.resolve(), {'path': resource, 'sha256': expected})
    captured = indexed(receipt.get('pages'), lambda p:p.get('scan'), '本棚の読戻し原本')
    check(set(captured) == set(range(bounds[0], bounds[1]+1)), '独自書式に全原本の読戻しがありません')
    items = []
    for scan, page in captured.items():
        check(isinstance(page.get('unhandled'), list) and 'body' not in page['unhandled']
              and 'body' in page.get('completeScopes', []) and page.get('captures'), '独自書式に未検証の本文があります')
        for capture in page['captures']:
            pinned_bytes(path.parent, capture)
        for row in page['painted']:
            if row['scope'] in ('body', 'heading', 'note', 'other', 'toc', 'caption'):
                items.append((scan, dict(id=row['key'], type=row['scope'], text=row['value']['text'])))
    return items, captured


def inspect_payload(archive, archive_sha, manifest, book_id, directory, runtime, site):
    blocks, required, books, members = {}, set(), {}, reading_members(manifest)
    check(isinstance(runtime, dict) and runtime.keys() <= members.keys(), '本文読戻しに対象外の読書HTMLがあります')
    captured = {}
    wh1 = manifest.get('readingFlow', {}).get('format') == 'wh1-bound-source-v1'
    with zipfile.ZipFile(archive) as zipped:
        for name, bounds in members.items():
            if wh1:
                items = wh1_blocks(zipped.read(name))
            else:
                try:
                    book = read_part({'part': name}, zipped.read)
                except ValueError:
                    check(name in runtime, f'{name}: 独自書式は対象版の本棚本文読戻しを指定してください')
                    items, pages = painted_blocks(directory, runtime[name], name, zipped.read(name), book_id,
                                                 archive_sha, bounds, site)
                    for scan, page in pages.items():
                        source = page.get('sourceSha256')
                        check(captured.setdefault(scan, source) == source, '読書画面ごとに読戻し原本が異なります')
                else:
                    books[name] = book
                    items = book_blocks(book)
            ordinals = Counter()
            for scan, block in items:
                check(type(scan) is int and manifest['range'][0] <= scan <= manifest['range'][1],
                      '読書本文の原本番号が不正です')
                ref = block.get('sourceRef') or [scan, ordinals[scan]]
                ident = block.get('id') or f'block-{ref[1]}'
                ordinals[scan] += 1
                key = (scan, name, ident)
                value = block.get('text')
                check(key not in blocks and isinstance(value, str), f'原本{scan}の本文の位置が不明または重複しています')
                blocks[key] = value
                if block.get('type', 'body') in BODY and value:
                    required.add(key)
        images = original_images(zipped, manifest, books)
        # Custom reader originals must likewise be bound to independently hashed archive images.
        check(all(n in images and images[n][0] == h for n, h in captured.items()),
              '独自書式の原本画像と本棚読戻しが一致しません')
    return blocks, required, images


def page_index(doc, schema, book_id, scan_range):
    check(isinstance(doc, dict) and doc.get('schema') == schema and
          doc.get('bookId') == book_id and doc.get('range') == scan_range, '本文不一致台帳の書籍・原本範囲が違います')
    pages = indexed(doc.get('pages'), lambda p: p.get('scan'), '本文不一致の原本')
    check(all(type(n) is int for n in pages) and set(pages) == set(range(scan_range[0], scan_range[1] + 1)),
          '本文不一致台帳に原本の抜けまたは範囲外の原本があります')
    return pages


def original_review(decision):
    return (isinstance(decision, dict) and decision.get('method') == 'original-image'
            and isinstance(decision.get('reviewedBy'), str) and bool(decision['reviewedBy'].strip()))


def check_observation(row, size, label):
    box = row.get('box')
    check(isinstance(box, list) and len(box) == 4 and all(type(x) is int for x in box) and
          0 <= box[0] < box[2] <= size[0] and 0 <= box[1] < box[3] <= size[1],
          f'{label}: 原本の照合座標が不正です')
    manual = row.get('mode') == 'source-transcribed'
    check(row.get('mode') in (None, 'ocr', 'source-transcribed') and
          all(row.get(k) is None or isinstance(row[k], str) for k in READINGS), f'{label}: 認識結果が不正です')
    readings = [row[k] for k in READINGS if row.get(k) is not None]
    check((manual and not readings) or (not manual and readings), f'{label}: OCRと原本からの直接転記を特定できません')
    previously_flagged = row.get('priorDisagreement', False)
    check(type(previously_flagged) is bool, f'{label}: 元の不一致状態が不正です')
    return previously_flagged or len(set(readings)) > 1, manual or len(readings) != len(READINGS)


def independent_body_reading(box, tokens):
    """Keep a separately segmented line in source order, including tokens that cross its body edge."""
    check(isinstance(tokens, list), '独立OCRの文字位置がありません')
    kept = []
    for token in tokens:
        word = token.get('box')
        check(isinstance(word, list) and len(word) == 4 and all(type(x) is int for x in word)
              and word[0] < word[2] and word[1] < word[3] and isinstance(token.get('text'), str),
              '独立OCRの文字領域が不正です')
        if max(box[0],word[0]) < min(box[2],word[2]) and max(box[1],word[1]) < min(box[3],word[3]):
            kept.append(token['text'])
    return ''.join(kept)


def verify_coordinates(raw, source, positions, scan):
    available = {r for r, row in raw.items() if row.get('independent') is not None}
    if not positions and 'independentTsvSha256' not in source:
        return
    check(positions and positions.get('sourceSha256') == source['sourceSha256'],
          f'原本{scan}: 本文と独立OCRを位置で照合した記録がありません')
    spatial = indexed(positions.get('rows'), lambda v:v.get('region'), f'原本{scan}の独立OCR文字位置')
    check(spatial.keys() == available, f'原本{scan}: 独立OCR文字位置に領域の欠落または追加があります')
    for region, row in spatial.items():
        check(independent_body_reading(raw[region]['box'], row.get('tokens')) == raw[region]['independent'],
              f'原本{scan}・{region}: 本文枠内の独立OCR文字と凍結した読みが異なります')


def check_placements(locations, reading, scan, blocks, members_for_block, coverage, label):
    check(isinstance(locations, list) and locations, f'{label}: 読書版での訂正位置がありません')
    pieces = defaultdict(list)
    for loc in locations:
        ident = loc.get('blockId')
        members = members_for_block.get((scan, ident), set())
        member = loc.get('member')
        if member is None:
            check(len(members) == 1, f'{label}: 対象の読書HTMLを指定してください')
            member = next(iter(members))
        key = (scan, member, ident)
        start, end = loc.get('start'), loc.get('end')
        check(key in blocks and type(start) is int and type(end) is int and
              0 <= start <= end <= len(blocks[key]), f'{label}: 読書版の訂正位置が一致しません')
        pieces[member].append(blocks[key][start:end])
        if start < end:
            coverage[key].append((start, end))
    check(all(''.join(text) == reading for text in pieces.values()), f'{label}: 原本で確定した読みと読書HTMLの文字が違います')
    return set(pieces)


def audit(archive, archive_sha, manifest, book_id, proof_index, site=None):
    check(proof_index is not None, '本文OCR不一致の照合台帳を --proof-index で指定してください')
    index_path = proof_index.resolve(strict=True)
    index = json.loads(index_path.read_bytes())
    scan_range = manifest['range']
    check(index.get('bookId') == book_id and index.get('archiveSha256') == archive_sha and index.get('range') == scan_range,
          '本文OCR不一致の校正台帳と登録対象が一致しません')
    check(isinstance(index.get('textDisagreements'), dict), 'この版の本文OCR不一致の台帳がありません')
    path, report = pinned(index_path.parent, index['textDisagreements'])
    check(report.get('archiveSha256') == archive_sha, '本文OCR不一致の訂正台帳と登録ZIPが一致しません')
    _, frozen = pinned(path.parent, report.get('observations'))
    frozen_pages = page_index(frozen, 'reader-ocr-observations-v1', book_id, scan_range)
    pages = page_index(report, 'reader-text-disagreements-v1', book_id, scan_range)
    geometry = {}
    if 'coordinateInputs' in report:
        _, coordinates = pinned(path.parent, report['coordinateInputs'])
        geometry = page_index(coordinates, 'reader-independent-geometry-v1', book_id, scan_range)
    decisions = indexed(report.get('decisions'), lambda r: (r.get('scan'), r.get('region')), '本文の原本照合結果')
    blocks, required, images = inspect_payload(archive, archive_sha, manifest, book_id, path.parent,
                                                report.get('runtimeReadbacks', {}), site)
    members_for_block = defaultdict(set)
    for scan, member, block in blocks:
        members_for_block[scan, block].add(member)
    coverage, detected, used = defaultdict(list), Counter(), set()
    low, high = scan_range
    for scan in range(low, high + 1):
        page, source = pages[scan], frozen_pages[scan]
        check(scan in images and page.get('sourceSha256') == source.get('sourceSha256') == images[scan][0],
              f'原本{scan}: 検出・校正時の原本が読書版の元画像と一致しません')
        raw = indexed(source.get('rows'), lambda x: x.get('region'), f'原本{scan}の検出領域')
        mapped = indexed(page.get('rows'), lambda x: x.get('region'), f'原本{scan}の読書版への対応')
        check(raw.keys() == mapped.keys(), f'原本{scan}: 凍結したOCR領域に抜けまたは追加があります')
        verify_coordinates(raw, source, geometry.get(scan), scan)
        if not raw:
            check(original_review(page.get('noBody')) and not any(k[0] == scan for k in required),
                  f'原本{scan}: 本文領域のない原本の確認が必要です')
        for region, row in raw.items():
            check(isinstance(region, str) and region.strip(), f'原本{scan}: OCR領域のIDがありません')
            key, label = (scan, region), f'原本{scan}・{region}'
            target = mapped[region]
            check(all(k not in target or target[k] == row.get(k) for k in ('box', 'mode', *READINGS)),
                  f'{label}: 凍結した読み取り候補または座標が変更されています')
            disputed, needs_read = check_observation(row, images[scan][1], label)
            decision = decisions.get(key)
            if disputed or needs_read or decision is not None:
                check(original_review(decision) and isinstance(decision.get('reading'), str),
                      f'{label}: 本文不一致の原本照合が未解決です')
                used.add(key)
                reading = decision['reading']
            else:
                reading = row['primary']
            # A row may span multiple newly assembled blocks. Each affected source/display
            # member is checked independently against its real, shipped text.
            locations = (decision or {}).get('placements', target.get('placements'))
            if locations is None:
                locations = [target]
            checked = check_placements(locations, reading, scan, blocks, members_for_block, coverage, label)
            # Even a removed intrusion has an empty anchor in each representation.
            for loc in locations:
                check(members_for_block[scan, loc['blockId']] <= checked, f'{label}: 本文の収録経路に読戻しが不足しています')
            detected[scan] += int(disputed)
    check(used == decisions.keys(), '凍結したOCR領域にない訂正・確認記録があります')
    for key in required:
        at = 0
        for start, end in sorted(coverage[key]):
            check(start == at, f'原本{key[0]}・{key[2]}: 本文OCRの照合範囲に抜けまたは重複があります')
            at = end
        check(at == len(blocks[key]), f'原本{key[0]}・{key[2]}: 読書HTMLの本文全体と候補台帳が対応していません')
    batches = []
    for start in range(low, high + 1, 20):
        end = min(start+19, high)
        count = sum(detected[n] for n in range(start, end+1))
        batches.append([start, end, count, count])
    return dict(version=1, status='complete', pending=0, detected=sum(detected.values()),
                resolved=sum(detected.values()), batches=batches, report=index['textDisagreements']['sha256'])


def check_summary(summary, low, high):
    """Require the signed report made by the current producer before catalog writes."""
    check(isinstance(summary, dict) and summary.get('version') == 1 and summary.get('status') == 'complete'
          and type(summary.get('pending')) is int and summary['pending'] == 0
          and isinstance(summary.get('report'), str) and re.fullmatch(r'[a-f0-9]{64}', summary['report']),
          'この候補には本文OCR不一致を全件解決した記録がありません。同じ版を prepare で再照合してください')
    batches = summary.get('batches')
    check(isinstance(batches, list) and len(batches) == (high-low)//20+1,
          '本文OCR不一致の20枚ごとの記録が不足しています')
    total = 0
    for start, row in zip(range(low, high+1, 20), batches):
        check(isinstance(row, list) and len(row) == 4 and all(type(n) is int for n in row)
              and row[:2] == [start, min(start+19, high)] and 0 <= row[2] == row[3],
              '本文OCR不一致に未解決または範囲の異なる記録があります')
        total += row[2]
    check(all(type(summary.get(k)) is int and summary[k] == total for k in ('detected','resolved')),
          '本文OCR不一致の照合件数と内訳が一致しません')
