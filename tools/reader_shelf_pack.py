"""Build the private input for the registered shelf from the reviewed production parts."""
import base64
import hashlib
import json
import math
import os
import re
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import unquote_to_bytes

from reader_shelf_template import validate_source_ruby

FLOW = 'structured-scan-flow-v1'


def require(value, reason):
    if not value:
        raise ValueError(reason)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def member(name):
    require(isinstance(name, str) and name and not any(c in name for c in ('\\', '\0', ':')),
            'ZIP内のパスが不正です')
    p = PurePosixPath(name)
    require(not p.is_absolute() and '..' not in p.parts and str(p) == name and name != '.',
            f'ZIP内のパスが不正です: {name}')
    return name


def source_json(html, name):
    pattern = r'<script\b(?=[^>]*\s+id=([\x22\x27])' + re.escape(name) + r'\1)(?=[^>]*\s+type=([\x22\x27])application/json\2)[^>]*>([\s\S]*?)</script\s*>'
    matches = list(re.finditer(pattern, html, re.I))
    require(len(matches) == 1, f'分冊の {name} を特定できません')
    return json.loads(matches[0].group(3))


def storage_ranges(m):
    first, last = m['range']
    require(type(first) is int and type(last) is int and first == 1 and last >= first,
            '原本範囲は1枚目から続く番号を指定してください')
    at = first
    parts = {}
    for i, part in enumerate(m['segments']):
        a, b = part['start'], part['end']
        require(a == at and type(b) is int and a <= b <= last, '原本分冊の範囲に欠落または重複があります')
        member(part['part'])
        for n in range(a, b + 1):
            parts[n] = i
        at = b + 1
    require(at == last + 1 and parts, '末尾の分冊がありません')
    return parts


def review_seams(m, bodies, ids, edges):
    """Apply the four-stage source decisions; a missing decision is never a paragraph break."""
    edges = set(edges)
    flow = m.setdefault('readingFlow', {})
    records = list(flow.get('boundaryReviews', []))
    records.extend(m.get('structure_reviews', {}).get('boundaries', []))
    cuts = [p['start'] for p in m['segments'][1:]]
    # Partitions with front/back matter only on one side have no prose seam.
    need = {c for c in cuts if any(n < c for n, _ in bodies) and any(n >= c for n, _ in bodies)}
    covered = set()
    normalized = {}
    valid = {'continue', 'paragraph', 'dialogue', 'heading_transition', 'source_linebreak'}

    def spanning(a, b):
        return {cut for cut in need if min(a[0], b[0]) < cut <= max(a[0], b[0])}

    for r in records:
        if 'from' in r and 'to' in r:
            a, b = tuple(r['from']), tuple(r['to'])
        else:
            a, b = ids.get(r.get('left_body_id')), ids.get(r.get('right_body_id'))
        require(a in bodies and b in bodies, '分冊境界の原本照合記録と本文IDが一致しません')
        if not spanning(a, b):
            continue
        left, right = r.get('left_suffix'), r.get('right_prefix')
        decision = r.get('display_boundary')
        require(r.get('source_review_status') == 'verified' and decision in valid
                and isinstance(left, str) and left and bodies[a].endswith(left)
                and isinstance(right, str) and right and bodies[b].startswith(right),
                f'分冊境界の原本照合・語句・判断が一致しません: {a} → {b}')
        require((a, b) not in normalized or normalized[a, b]['display_boundary'] == decision,
                '同じ原本境界に異なる判断があります')
        if decision == 'continue':
            edges.add((a, b))
        else:
            require((a, b) not in edges, '分冊の段落判定と本文の接続指定が矛盾しています')
        for cut in spanning(a, b):
            adjacent = (max(x for x in bodies if x[0] < cut), min(x for x in bodies if x[0] >= cut))
            if decision == 'continue' or (a, b) == adjacent or (b, a) == adjacent:
                covered.add(cut)
        normalized[a, b] = dict(source_review_status='verified', display_boundary=decision,
                                left_suffix=left, right_prefix=right,
                                **{'from': list(a), 'to': list(b)})
    for a, b in edges:
        require(a in bodies and b in bodies, '照合済みの本文接続先が見つかりません')
        covered.update(spanning(a, b))
    missing = sorted(need - covered)
    require(not missing, '原本で確認した分冊間の接続／段落判断がありません: '
            + ', '.join(f'{n-1}→{n}' for n in missing))
    flow['boundaryReviews'] = list(normalized.values())
    flow['confirmedSeams'] = [{'from': list(a), 'to': list(b)} for a,b in sorted(edges) if spanning(a,b)]
    # A continue decision may come from the four-stage merge outside the original HTMLs.
    return edges


def structured_sources(m, read_bytes, emit_original=None, independent_reviews=None):
    """Bind each confirmed edge to original block ordinals, including nonadjacent scans."""
    parts = storage_ranges(m)
    blocks = {}
    bodies = {}
    ids = {}
    joins = {}
    incoming = {}
    flow = m.get('readingFlow', {})
    require(flow.get('format', FLOW) == FLOW, '未対応の本文接続形式です')
    order = flow.get('scanOrder', list(parts))
    portraits = flow.get('portraitScans', [])
    require(isinstance(order, list) and all(type(n) is int for n in order) and sorted(order) == list(parts),
            '読書順に原本の欠落または重複があります')
    require(isinstance(portraits, list) and all(type(n) is int and n in parts for n in portraits)
            and len(set(portraits)) == len(portraits), '原本画像で開くページ番号が不正です')

    def add_edges(edges):
        for edge in edges:
            endpoints = [edge[key] for key in ('from', 'to')]
            require(all(isinstance(p, list) and len(p) == 2 and all(type(n) is int for n in p)
                        for p in endpoints), '本文接続には両側の原本番号と本文ブロック番号が必要です')
            left, right = map(tuple, endpoints)
            require(left != right and joins.get(left, right) == right and incoming.get(right, left) == left,
                    '原本の本文接続が分岐・重複しています')
            joins[left] = right
            incoming[right] = left

    add_edges(flow.get('continuations', []))
    for i, part in enumerate(m['segments']):
        data = read_bytes(member(part['part']))
        if part.get('sha256'):
            require(sha(data) == part['sha256'], '入力分冊が記録した版と違います')
        part['sha256'] = sha(data)
        html = data.decode('utf-8')
        src = source_json(html, 'bookdata')
        model = source_json(html, 'reader-verified-structure')['model']
        require(isinstance(model, dict) and src.get('bookId') == m['bookId']
                and src.get('range') == [part['start'], part['end']], '分冊の書籍ID・範囲が違います')
        require(model.get('book_id', m['bookId']) == m['bookId'], '構造記録が別の書籍です')
        require(isinstance(src.get('continuations'), list) and isinstance(src.get('pages'), list),
                '分冊の原本と接続リストが必要です')
        source_scans = []
        for page in src['pages']:
            n = page['scan']
            require(type(n) is int and parts.get(n) == i, '分冊に範囲外の原本があります')
            source_scans.append(n)
            require(isinstance(page.get('blocks'), list) and isinstance(page.get('figures'), list)
                    and isinstance(page.get('toc_entries', []), list), '原本の本文・目次・図版が不正です')
            for fig in page['figures']:
                rect = fig.get('bbox')
                require(isinstance(rect, list) and len(rect) == 4
                        and all(type(v) in (int, float) and math.isfinite(v) for v in rect)
                        and rect[2] > 0 and rect[3] > 0, '原本の図版範囲が不正です')
                width, height = page.get('width'), page.get('height')
                require(all(type(x) in (int,float) and math.isfinite(x) and x>0 for x in (width,height))
                        and rect[0]>=0 and rect[1]>=0 and rect[0]+rect[2]<=width and rect[1]+rect[3]<=height,
                        '図版が原本の寸法に収まりません')
            original_hash = emit_original(n, page) if emit_original else None
            for j, b in enumerate(page['blocks']):
                require(b.get('type') in {'body','heading','toc','note','footnote','caption'},
                        '原本の本文種別が不正です')
                require(isinstance(b.get('text'), str) and b['text'], '本文ブロックの文字がありません')
                if 'ruby' in b:
                    if b['ruby'] and original_hash is None:
                        ref = m.get('originalScans', {}).get(str(n))
                        require(ref and ref.get('path'), f'原本{n}のルビを登録画像と照合できません')
                        original_hash = sha(read_bytes(member(ref['path'])))
                    validate_source_ruby(dict(b, scan=n), original_hash)
                blocks[(n, j)] = b['type']
                if b['type'] == 'body':
                    bodies[n, j] = b['text']
                    if b.get('id'):
                        require(ids.get(b['id'], (n, j)) == (n, j), '原本の本文IDが重複しています')
                        ids[b['id']] = (n, j)
        require(sorted(source_scans) == list(range(part['start'], part['end'] + 1)),
                '分冊内の原本番号に欠落または重複があります')
        for item in model.get('segments', []):
            refs = item.get('source_refs') or []
            if not refs or 'sourceBlock' not in item or not item.get('id'):
                continue
            loc = (refs[0].get('scan'), item['sourceBlock'])
            if loc in bodies and bodies[loc] == item.get('text'):
                require(ids.get(item['id'], loc) == loc, '原本の本文IDが重複しています')
                ids[item['id']] = loc
        add_edges(src.get('continuations', []))
        if 'headings' not in part:
            part['headings'] = [{'scan': row['targetScan'], 'text': row['text']} for row in src.get('toc', [])
                                if part['start'] <= row['targetScan'] <= part['end']]
        part.setdefault('assets', {})
    old = set(joins.items())
    if independent_reviews:
        flow = m.setdefault('readingFlow', {})
        flow['boundaryReviews'] = list(flow.get('boundaryReviews', [])) + independent_reviews
    confirmed = review_seams(m, bodies, ids, old)
    extra = [{'from': list(a), 'to': list(b)} for a, b in sorted(confirmed-old)]
    if extra:
        require(emit_original is not None, '原本で確認した分冊接続が書籍実体にありません。pack で作成し直してください')
        m['readingFlow']['continuations'] = list(flow.get('continuations', [])) + extra
        add_edges(extra)
    require(all(blocks.get(v) == 'body' for pair in joins.items() for v in pair),
            '照合済み本文の接続先がありません。見出し・図注を接続できません')
    visited = set()
    for root in joins.keys() - incoming.keys():
        while root in joins:
            visited.add(root)
            root = joins[root]
    require(len(visited) == len(joins), '本文の接続が循環しています')
    return [{'from': list(a), 'to': list(b)} for a, b in sorted(joins.items()) if parts[a[0]] != parts[b[0]]]


def standalone_reviews(m, read_bytes):
    """Preserve pre-merged HTML bytes; bind supplied boundary evidence to its actual entries."""
    flow = m.get('readingFlow', {})
    ranges = flow.get('sourceRanges', [])
    declared = list(flow.get('confirmedSeams', flow.get('continuations', m.get('continuations', []))))
    records = list(flow.get('boundaryReviews', [])) + m.get('structure_reviews', {}).get('boundaries', [])
    from reader_shelf_template import TemplateSource, read_part, template_entries
    if records:
        data = read_part({'part':m['entry']}, read_bytes)
    else:
        # Keep opaque legacy readers byte-identical. When the standalone edition
        # declares block ruby in literal bookdata, audit it even without seams.
        raw = read_bytes(m['entry'])
        if not re.search(rb'"ruby"\s*:', raw):
            return ranges, declared, []
        parser = TemplateSource()
        parser.feed(raw.decode('utf-8-sig'))
        parser.close()
        data = parser.data
        if not isinstance(data, dict) or ('pages' not in data and data.get('kind') not in ('text','mixed','image')):
            return ranges, declared, []
    originals = {p['scan']:p.get('dataUrl') or p.get('original') for p in data.get('pages', [])}
    originals.update({p['scan']:p.get('src') for p in data.get('originals', []) if p.get('src')})
    image_hashes = {}

    def original_sha(n):
        if n not in image_hashes:
            url = originals.get(n) or ''
            header, comma, payload = url.partition(',')
            if comma and header.startswith('data:image/'):
                raw = base64.b64decode(payload, validate=True) if header.endswith(';base64') else unquote_to_bytes(payload)
            else:
                ref = m.get('originalScans', {}).get(str(n))
                require(ref and ref.get('path'), f'原本{n}のルビを対応する画像と照合できません')
                raw = read_bytes(member(ref['path']))
            image_hashes[n] = sha(raw)
        return image_hashes[n]
    bodies, ids = {}, {}
    counts = {}
    entries = ([{'kind':'text','scan':p['scan'],'blocks':p['blocks']} for p in data['pages']]
               if 'pages' in data else template_entries(data))
    for e in entries:
        if e['kind'] != 'text':
            continue
        for b in e.get('blocks', [e]):
            n = b.get('scan', e.get('scan'))
            if 'ruby' in b:
                expected = original_sha(n) if b['ruby'] else None
                validate_source_ruby(dict(b, scan=n, type=b.get('type','body')), expected)
            if not records:
                continue
            i = counts.get(n, 0)
            counts[n] = i + 1
            ref = tuple(b.get('sourceRef', [n, i]))
            if b.get('type','body') in ('body','dialogue'):
                bodies[ref] = b['text']
                if b.get('id'):
                    require(b['id'] not in ids, '統合読書HTMLの本文IDが重複しています')
                    ids[b['id']] = ref
    found = {(tuple(e['from']),tuple(e['to'])) for e in declared}
    decisions = {}
    verified = []
    cuts = [r[0] for r in ranges[1:]]
    for row in records:
        a = tuple(row['from']) if 'from' in row else ids.get(row['left_body_id'])
        b = tuple(row['to']) if 'to' in row else ids.get(row['right_body_id'])
        require(a in bodies and b in bodies, '統合読書HTMLと境界照合のIDが一致しません')
        if ranges and not any(min(a[0],b[0])<c<=max(a[0],b[0]) for c in cuts):
            continue
        decision = row.get('display_boundary')
        require(row.get('source_review_status')=='verified' and row.get('left_suffix')
                and bodies[a].endswith(row['left_suffix']) and row.get('right_prefix')
                and bodies[b].startswith(row['right_prefix'])
                and decision in ('continue','paragraph','dialogue','heading_transition','source_linebreak')
                and decisions.get((a,b),decision)==decision, '統合読書HTMLの境界照合が未確定です')
        if decision=='continue':
            found.add((a,b))
        else:
            require((a,b) not in found, '統合読書HTMLの段落判断と接続が矛盾しています')
        decisions[a,b] = decision
        verified.append({**row, 'from':list(a), 'to':list(b)})
    return ranges, [{'from':list(a),'to':list(b)} for a,b in sorted(found)], verified


def pack(manifest_path, archive, structure_reviews=None):
    manifest_path = manifest_path.resolve()
    root = manifest_path.parent
    m = json.loads(manifest_path.read_bytes())
    profile = m['template_profile']
    if structure_reviews:
        evidence = json.loads(structure_reviews.read_bytes())
        require(evidence.get('book_id', m['bookId']) == m['bookId'], '境界照合記録が別の書籍です')
        m['structure_reviews'] = evidence.get('structure_reviews', evidence)
        require(isinstance(m['structure_reviews'].get('boundaries'), list), '境界照合記録がありません')
    require(re.fullmatch(r'[a-zA-Z0-9_-]{1,90}', m['bookId']) and m.get('title'),
            '書名と書籍IDが必要です')
    require(profile in ('world_history_1', 'novel'), '書籍テンプレートを特定できません')
    require(not archive.exists(), '出力ZIPには新しいパスを指定してください')
    archive.parent.mkdir(parents=True, exist_ok=True)

    def read_bytes(name):
        path = (root / member(name)).resolve()
        require(path.is_relative_to(root), '制作フォルダ外のファイルを参照しています')
        return path.read_bytes()

    from reader_shelf_canonical import apply_merge
    read_bytes = apply_merge(m, read_bytes)
    m.pop('mergeReport', None)

    with tempfile.TemporaryDirectory(dir=archive.parent) as tmp:
        candidate = Path(tmp) / 'book.zip'
        with zipfile.ZipFile(candidate, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=3) as z:
            written = {}

            def write(name, data, compress=zipfile.ZIP_DEFLATED):
                name = member(name)
                require(name != 'manifest.json', 'manifest.json は書籍目録用です')
                h = sha(data)
                if name in written:
                    require(written[name] == h, f'同じパスに異なる内容があります: {name}')
                    return
                written[name] = h
                z.writestr(name, data, compress_type=compress)

            m['schema'] = 1
            source_ranges = []
            if m.get('segments') and profile == 'world_history_1':
                from reader_shelf_template import read_part
                sample = read_part(m['segments'][0], read_bytes)
                template_source = sample.get('kind') in ('text', 'image', 'mixed') and 'pages' not in sample
            else:
                template_source = profile == 'novel'
            if template_source or m.get('entry') and not m.get('segments'):
                if m.get('segments'):
                    from reader_shelf_template import template_html
                    storage_ranges(m)
                    source_ranges = [[p['start'],p['end']] for p in m['segments']]
                    data = template_html(m, read_bytes)
                    compiled = m['readingFlow']
                    confirmed, reviews = compiled['confirmedSeams'], compiled['boundaryReviews']
                else:
                    source_ranges, confirmed, reviews = standalone_reviews(m, read_bytes)
                    data = read_bytes(m['entry'])
                    require(not m.get('sha256') or sha(data) == m['sha256'], '統合読書HTMLの版が違います')
                require(re.search(rb'<html\b', data, re.I), '全巻統合の読書HTMLが必要です')
                m = {k: m[k] for k in ('schema', 'bookId', 'title', 'range', 'template_profile', 'subtitle', 'edition', 'status') if k in m}
                m.update(format='standalone-reader-html-v1', entry='reader.html', sha256=sha(data))
                if source_ranges or confirmed or reviews:
                    m['readingFlow'] = {'format':'merged-template-flow-v1','sourceRanges':source_ranges,
                                        'continuations':confirmed, 'boundaryReviews':reviews}
                write('reader.html', data)
            else:
                m.setdefault('originalScans', {})
                def original(n, p):
                    registered = m['originalScans'].get(str(n))
                    embedded = p.get('original') or ''
                    if registered:
                        path = member(registered['path'])
                        data = read_bytes(path)
                    else:
                        prefix, comma, encoded = embedded.partition(',')
                        require(comma and prefix in ('data:image/jpeg;base64', 'data:image/png;base64', 'data:image/webp;base64'),
                                f'原本{n}の画像を指定してください')
                        ext = {'data:image/jpeg;base64': 'jpg', 'data:image/png;base64': 'png', 'data:image/webp;base64': 'webp'}[prefix]
                        path = f'originals/{n:03}.{ext}'
                        data = base64.b64decode(encoded, validate=True)
                    h = sha(data)
                    require(data and all(v == h for v in [p.get('sha256'), (registered or {}).get('sha256')] if v),
                            f'原本{n}の画像が照合した版と異なります')
                    if registered and embedded.startswith('data:image/'):
                        require(base64.b64decode(embedded.partition(',')[2], validate=True) == data,
                                f'原本{n}の分冊内画像と登録画像が異なります')
                    m['originalScans'][str(n)] = {**(registered or {}), 'path': path, 'sha256': h}
                    write(path, data, zipfile.ZIP_STORED)
                    return h
                structured_sources(m, read_bytes, original)
                for part in m['segments']:
                    data = read_bytes(part['part'])
                    require(sha(data) == part['sha256'], '作成中に分冊の版が変わりました')
                    write(part['part'], data)
                    for asset in part['assets'].values():
                        write(asset['path'], read_bytes(asset['path']))
                m['readingFlow'] = {**m.get('readingFlow', {}), 'format': FLOW}
                m['readingFlow'].pop('confirmedSeams', None)
                m.pop('structure_reviews', None)
            z.writestr('manifest.json', json.dumps(m, ensure_ascii=False, separators=(',', ':')).encode())
        os.link(candidate, archive)
    return m
