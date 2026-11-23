"""Collate the private original-page reports for every member used by a saved book."""
import base64
import hashlib
import json
import re
import subprocess
import tempfile
import zipfile
from collections import defaultdict
from pathlib import Path

from reader_shelf_probe import check, digest
from reader_shelf_template import read_part


def sha(data):
    return hashlib.sha256(data).hexdigest()


def pinned(folder, reference):
    check(isinstance(reference, dict) and isinstance(reference.get('path'), str), '校正資料の参照が不正です')
    child = Path(reference['path'])
    check(not child.is_absolute() and '..' not in child.parts, '校正資料は台帳と同じ作業フォルダ内に置いてください')
    path = (folder / child).resolve()
    check(path.is_relative_to(folder) and path.is_file(), '参照した校正資料がありません')
    data = path.read_bytes()
    check(sha(data) == reference.get('sha256'), '登録する校正資料の版が異なります')
    return path, json.loads(data)


def reading_members(manifest):
    members = {}
    def add(path, scan_range):
        check(isinstance(path, str) and path and
              (path not in members or members[path] == scan_range), '読書HTMLと原本範囲の対応が不正です')
        members[path] = scan_range

    for item in manifest.get('segments', []):
        scan_range = [item['start'], item['end']]
        add(item['part'], scan_range)
        if 'display' in item:
            add(item['display']['path'], scan_range)
    entry = manifest.get('entry') or manifest.get('engine')
    if entry:
        add(entry, manifest['range'])
    check(members, '校正対象の読書HTMLを特定できません')
    return members


def embedded_originals(data):
    book = read_part({'part': 'reader.html'}, lambda _: data)
    originals = book.get('originals') or book.get('pages') or []
    values = {}
    for page in originals:
        scan = page['scan']
        value = page.get('src') or page.get('original') or page.get('dataUrl') or ''
        header, comma, payload = value.partition(',')
        check(type(scan) is int and scan not in values and comma and
              re.fullmatch(r'data:image/[a-z0-9+.-]+;base64', header), '読書HTMLの内蔵原本を確認できません')
        values[scan] = sha(base64.b64decode(payload, validate=True))
    return values


SCOPES = ('body', 'heading', 'caption', 'note', 'ruby', 'figure', 'toc', 'other')
SHELF_HOSTS = {
    'reader/library/' + name for name in (
        'read.html', 'read-wh1-v9.html', 'wh1-caption-ruby.js', 'storage.js', 'wh1-reader-routing.js',
        'wh1-pager-v9.js', 'wh1-figure-viewport-v9.js', 'wh1-display-check-v9.js', 'wh1-exact-pagination.js')
}


def verify_readback(receipt, bound_wh1, display, site):
    if not bound_wh1:
        return
    expected = 'shelf' if display else 'part'
    check(receipt.get('route') == expected, '読書用の全巻表示と分冊の表示照合は個別に必要です')
    originals = [region['originalObservation'] for page in receipt.get('pages', []) for region in page.get('regions', [])
                 if 'originalObservation' in region]
    if originals:
        check(all(isinstance(o, dict) and o.get('mode') == 'reader-original' and o.get('route') == 'shelf' for o in originals),
              '原本表示の経路が読書プログラムと一致しません')
    if display or originals:
        check(isinstance(site, Path), '本棚の読書プログラムがあるサイトを指定してください')
        hosts = receipt.get('hostFiles' if display else 'originalHostFiles')
        check(isinstance(hosts, dict) and SHELF_HOSTS <= hosts.keys(), '本棚の読書プログラムの版が記録されていません')
        for name, expected in hosts.items():
            path = (site / name).resolve()
            check(path.is_relative_to(site.resolve()) and path.is_file() and sha(path.read_bytes()) == expected,
                  '校正時と登録時の本棚の読書プログラムが異なります')


def caption_index_reference(index_path, index, explicit):
    ref = index.get('captionCensus') if index else None
    if ref is not None:
        path, _ = pinned(index_path.parent, ref)
        if explicit is not None:
            check(sha(explicit.read_bytes()) == ref['sha256'], '指定した図説台帳と本棚校正台帳の版が異なります')
        return path
    return explicit.resolve(strict=True) if explicit else None


def caption_readback(receipts, path, captured, *, role, archive_sha, member, artifact_sha, site):
    # Historical preview receipts may lack route information. They still serve
    # the older region proof, but cannot stand in for a new full-caption readback.
    if captured.get('route') != role:
        return
    check(captured.get('artifactSha256') == artifact_sha, '図説の読戻しが対象HTMLと一致しません')
    if role == 'shelf':
        check(isinstance(site, Path), '本棚の照合には現在のサイトが必要です')
        check(captured.get('archiveSha256') == archive_sha and captured.get('member') == member,
              '本棚の図説読戻しが対象ZIP・読書HTMLと一致しません')
        hosts = captured.get('hostFiles', {})
        check('reader/library/read.html' in hosts, '本棚経路の読書プログラムの版がありません')
        for name, expected in hosts.items():
            host = (site / name).resolve()
            check(host.is_relative_to(site.resolve()) and host.is_file() and sha(host.read_bytes()) == expected,
                  '図説の読戻し時と現在の本棚の読書プログラムが異なります')
    receipts[role].append((path, captured))


def measure(archive, archive_sha, manifest, book_id, index_path=None, site=None, caption_census=None, caption_report_out=None):
    low, high = manifest['range']
    members = reading_members(manifest)
    rows = {}
    index_sha = None
    index = None
    if index_path:
        index_path = index_path.resolve()
        index_bytes = index_path.read_bytes()
        index_sha = sha(index_bytes)
        index = json.loads(index_bytes)
        check(index.get('schema') == 'reader-shelf-proof-index-v1' and index.get('bookId') == book_id
              and index.get('range') == [low, high] and index.get('archiveSha256') == archive_sha,
              '校正台帳の書籍・範囲・登録ZIPが一致しません')
        check(isinstance(index.get('members'), list), '校正対象の読書HTML一覧がありません')
        for row in index['members']:
            name = row['path']
            check(name in members and name not in rows, '校正台帳に重複または対象外の読書HTMLがあります')
            rows[name] = row

    census_path = caption_index_reference(index_path, index, caption_census)
    census_sha = sha(census_path.read_bytes()) if census_path else None
    caption_receipts = {'part': [], 'shelf': []}
    readback_hashes = {}
    bound_wh1 = manifest.get('readingFlow', {}).get('format') == 'wh1-bound-source-v1'
    displays = {part['display']['path'] for part in manifest.get('segments', []) if part.get('display')}
    paired_parts = {part['part'] for part in manifest.get('segments', []) if part.get('display')}
    pending = set()
    outstanding_scopes = defaultdict(set)
    matched_regions = {}
    evidence = []
    sources = {}
    source_reviews = {}
    with zipfile.ZipFile(archive) as packed, tempfile.TemporaryDirectory() as tmp:
        if census_path and manifest.get('originalScans'):
            for key, original in manifest['originalScans'].items():
                scan = int(key)
                if low <= scan <= high:
                    sources[scan] = sha(packed.read(original['path']))
                    check(sources[scan] == original['sha256'], 'ZIP内の図説照合用原本が制作台帳と異なります')
        artifact = Path(tmp) / 'member.html'
        for name, scan_range in members.items():
            start, end = scan_range
            if name not in rows:
                for scan in range(start, end + 1):
                    pending.add(scan)
                    outstanding_scopes[scan].update(SCOPES)
                    matched_regions[scan] = set()
                continue
            row = rows[name]
            data = packed.read(name)
            artifact.write_bytes(data)
            inventory, doc = pinned(index_path.parent, row['inventory'])
            check(doc.get('bookId') == book_id and doc.get('range') == scan_range and isinstance(doc.get('pages'), list),
                  '校正台帳と対象の分冊が一致しません')
            if manifest.get('originalScans'):
                for page in doc['pages']:
                    scan = page['scan']
                    check(type(scan) is int and start <= scan <= end, '校正台帳に対象外の原本があります')
                    if scan not in sources:
                        original = manifest['originalScans'][str(scan)]
                        sources[scan] = sha(packed.read(original['path']))
                        check(sources[scan] == original['sha256'], 'ZIP内の原本と制作台帳が違います')
            else:
                sources.update(embedded_originals(data))
            for page in doc['pages']:
                scan = page['scan']
                reviews = tuple((page.get(key) or {}).get('sha256') for key in ('image', 'census', 'review'))
                check(source_reviews.setdefault(scan, reviews) == reviews, '同じ原本に対する分冊と全巻の校正資料が異なります')
                check(isinstance(page.get('image'), dict) and page['image'].get('sha256') == sources.get(page['scan'])
                      and sources.get(page['scan']), '登録する本の原本画像と照合画像が違います')
            cmd = ['node', str(Path(__file__).with_name('reader-proof-batches.cjs')), '--artifact', str(artifact),
                   '--inventory', str(inventory), '--book-id', book_id, '--start', str(start), '--end', str(end)]
            readback = row.get('readback') or doc.get('readback')
            if readback:
                folder = index_path.parent if row.get('readback') else inventory.parent
                receipt, captured = pinned(folder, readback)
                readback_hashes[receipt] = readback['sha256']
                verify_readback(captured, bound_wh1, name in displays, site)
                if bound_wh1:
                    check(captured.get('archiveSha256') == archive_sha and captured.get('member') == name,
                          '画像を取得したZIP・読書画面と登録対象が違います')
                if census_path:
                    caption_readback(caption_receipts, receipt, captured, role='shelf' if name in displays else 'part',
                                     archive_sha=archive_sha, member=name, artifact_sha=sha(data), site=site)
                cmd.extend(['--readback', str(receipt)])
            if row.get('shelfReadback') is not None:
                check(name not in displays and name not in paired_parts and not bound_wh1, '統合表示がある本は各HTMLの固有の経路で照合してください')
                shelf_path, shelf_capture = pinned(index_path.parent, row['shelfReadback'])
                readback_hashes[shelf_path] = row['shelfReadback']['sha256']
                check(shelf_capture.get('bookId') == book_id and shelf_capture.get('range') == scan_range
                      and shelf_capture.get('route') == 'shelf', '本棚の図説読戻しの書籍・対象範囲・経路が異なります')
                caption_readback(caption_receipts, shelf_path, shelf_capture, role='shelf', archive_sha=archive_sha,
                                 member=name, artifact_sha=sha(data), site=site)
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            check(sha(inventory.read_bytes()) == row['inventory']['sha256'] and
                  (not readback or sha(receipt.read_bytes()) == readback['sha256']),
                  '照合中に原本台帳または読書表示の記録が変わりました')
            report = json.loads(result.stdout)
            check(report.get('schema') == 'reader-proof-batches-v1' and report.get('artifactSha256') == sha(data)
                  and report.get('bookId') == book_id and report.get('range') == scan_range, '校正判定の範囲・HTMLが異なります')
            outstanding = [p['scan'] for p in report['queue']]
            check(len(set(outstanding)) == len(outstanding) == report['pendingScans'] and
                  all(type(n) is int and start <= n <= end for n in outstanding) and
                  report['status'] == ('partial' if outstanding else 'complete'), '校正済み枚数と未照合の所在が違います')
            check(not report.get('globalIssues') or
                  (not readback and report['globalIssues'] == ['MISSING_READER_READBACK']),
                  '指定した原本校正・表示読戻し証拠の版が一致しません')
            check([p['scan'] for p in report['pages']] == list(range(start, end+1)), '原本別の校正結果に欠落があります')
            for page in report['pages']:
                scan = page['scan']
                remaining = page['pendingScopes']
                check(isinstance(remaining, list) and set(remaining) <= set(SCOPES), '不明な照合項目があります')
                outstanding_scopes[scan].update(remaining)
                matches = {(item['scope'], item['id'], item['state']) for item in page['matchedRegions']}
                if scan in matched_regions:
                    matched_regions[scan].intersection_update(matches)
                else:
                    matched_regions[scan] = matches
            pending.update(outstanding)
            evidence.append({'member': name, 'html': sha(data), 'inventory': row['inventory']['sha256'],
                             'readback': readback['sha256'] if readback else None, 'report': digest(report)})
    from reader_caption_census import audit as audit_captions
    caption_report = audit_captions(census_path, book_id=book_id, scan_range=[low, high],
                                    source_hashes=sources, readbacks=caption_receipts, index_sha256=census_sha)
    check(all(sha(path.read_bytes()) == expected for path, expected in readback_hashes.items()),
          '照合中に分冊または本棚の表示記録が変わりました')
    if caption_report_out is not None:
        caption_report_out.update(caption_report)
    if census_path:
        check(sha(census_path.read_bytes()) == census_sha, '照合中に図説全件台帳が変わりました')
    caption_pending = set(caption_report['pendingScans'])
    check(all(type(n) is int and low <= n <= high for n in caption_pending), '図説全件判定の原本番号が不正です')
    check(caption_report['status'] == ('partial' if caption_pending else 'complete'), '図説全件判定と未確認枚数が異なります')
    for n in caption_pending:
        outstanding_scopes[n].update(('figure','caption'))
    pending.update(caption_pending)
    if index_path:
        check(sha(index_path.read_bytes()) == index_sha, '照合中に本棚校正台帳が変わりました')
    batches = [[n, min(n + 19, high), sum(i in pending for i in range(n, min(n + 19, high) + 1))]
               for n in range(low, high + 1, 20)]
    scopes = []
    for start, end, _ in batches:
        scans = range(start, end + 1)
        scopes.append({'pending': {key: sum(key in outstanding_scopes[i] for i in scans) for key in SCOPES},
                       'matchedRegions': sum(len(matched_regions[i]) for i in scans)})
    # The shelf stores counts and a digest. Original positions, transcriptions,
    # paths and screenshots stay in the private source census.
    captions = {'version': 1, 'status': caption_report['status'], 'pendingScans': len(caption_pending),
                'batches': [[start,end,sum(n in caption_pending for n in range(start,end+1))]
                            for start,end,_ in batches], 'report': digest(caption_report)}
    return {'version': 1, 'status': 'partial' if pending else 'complete', 'pendingScans': len(pending),
            'batches': batches, 'scopeBatches': scopes, 'captionCensus': captions,
            'report': digest({'index': index_sha, 'members': evidence, 'captionCensus': census_sha,
                              'captionReport': captions['report']})}


def require_claims(summary, channel, book, manifest, reference):
    caption = summary.get('captionCensus', {})
    all_captions = caption.get('version') == 1 and caption.get('status') == 'complete' and caption.get('pendingScans') == 0
    def require_scope(scope):
        check(all(batch['pending'][scope] == 0 for batch in summary['scopeBatches']) and
              (scope not in ('figure','caption') or all_captions), '指定した項目に原本照合が未完了のページがあります')
    if channel == 'release':
        check(all_captions, '正式版には全原本の図・図説台帳と分冊・本棚双方の照合が必要です')
    for doc in (book, manifest, reference):
        claim = doc.get('sourceProofClaim')
        check(claim in (None, 'partial', 'complete'), '原本校正状態が不正です')
        check(claim != 'complete' or (summary['status'] == 'complete' and all_captions), '全枚照合の表記と判定が違います')
        claims = doc.get('sourceScopeClaims', {})
        check(isinstance(claims, dict) and set(claims) <= set(SCOPES), '原本照合の項目名が不正です')
        for scope, state in claims.items():
            check(state in ('partial', 'complete'), '項目別の照合状態が不正です')
            if state == 'complete':
                require_scope(scope)
    if summary['status'] == 'complete' and all_captions:
        return
    check(channel != 'release', '原本と読書表示を照合できていないページがあります')
    # Preserve genuinely partial progress labels. Treat unqualified completed
    # labels as whole-book claims, and named scopes as independent claims.
    scopes = {'本文':'body','見出し':'heading','図説':'caption','図の説明':'caption','図版説明':'caption',
              '図注':'caption','キャプション':'caption','注記':'note','脚注':'note','注':'note',
              'ルビ':'ruby','ふりがな':'ruby','図版':'figure','挿図':'figure','目次':'toc','その他':'other'}
    scope_pattern = '|'.join(sorted(scopes, key=len, reverse=True))
    completed = re.compile(r'(?:校了|(?:校正|照合|確認)(?:完了|済み?)|proofreading complete|fully proofread)(?:版)?', re.I)
    for doc in (book, manifest):
        for key in ('status', 'subtitle'):
            for label in re.split(r'[／/｜|、。]+', doc.get(key) or ''):
                for match in completed.finditer(label):
                    prefix = label[:match.start()].strip()
                    if prefix.endswith('未') or re.search(r'未完|ではない|していない', label[match.end():]):
                        continue
                    current = prefix.rsplit('・', 1)[-1].strip()
                    if re.search(r'部分|一部', current) and '全' not in current:
                        continue
                    number = re.search(r'([0-9０-９]+)(枚|箇所)', current)
                    if number and '全' not in current:
                        count, unit = int(number[1]), number[2]
                        if unit == '枚':
                            available = sum(end-start+1-pending for start,end,pending in summary['batches'])
                        else:
                            available = sum(batch['matchedRegions'] for batch in summary['scopeBatches'])
                        check(count <= available, '校正済みと表示する枚数・箇所数に照合記録が足りません')
                        continue
                    named = re.search(r'((?:'+scope_pattern+r')(?:[・と＋+、及び\s]*(?:'+scope_pattern+r'))*)[のをは\s]*$',prefix)
                    if named:
                        for word in re.findall(scope_pattern,named[1]):
                            require_scope(scopes[word])
                    else:
                        check(False, '完了を示す書誌表示には全枚の原本照合が必要です')
