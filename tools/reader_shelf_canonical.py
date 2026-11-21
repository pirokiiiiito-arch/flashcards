"""Use an actual four-stage merge's source decisions when packing a private book."""
import base64
from collections import defaultdict
from hashlib import sha256
import json
from pathlib import PurePosixPath
from urllib.parse import unquote_to_bytes

from reader_shelf_template import part_image, read_part, template_entries


def require(ok, text):
    if not ok:
        raise ValueError(text)


def apply_merge(manifest, read_bytes):
    """Return a byte source for the packer; caller's safe private-root reader handles all paths."""
    declared = manifest.get('mergeReport')
    report_path = declared or 'merge_report.json'
    try:
        raw = read_bytes(report_path)
    except FileNotFoundError:
        if declared:
            raise
        return read_bytes
    report = json.loads(raw)
    require(report.get('pipeline_version') == 'four-stage-book-merge-request-v1'
            and [(s['number'], s['status']) for s in report['stages']] ==
            [(i, 'passed') for i in range(1, 5)], '統合4工程の出力と結果が一致しません')
    directory = PurePosixPath(report_path).parent

    def output(name, checksum):
        data = read_bytes(str(directory / name))
        require(sha256(data).hexdigest() == report[checksum], f'統合後の {name} の版が違います')
        return json.loads(data)

    book = output('merged_bookdata.json', 'merged_bookdata_sha256')
    stream = output('reader_logical_stream.json', 'logical_stream_sha256')
    require(book.get('schema_version') == 'reader-bookdata-v1' and stream.get('model_schema') == 'reader-logical-stream-v1'
            and report['book_id'] == book['book']['book_id'] == manifest['bookId'] == stream['book_id']
            and report['template_profile'] == book['book']['template_profile'] ==
            stream['template_profile'] == manifest['template_profile'], '統合出力の書籍・テンプレートが違います')
    require(book['scans'] == stream['source_scans'] and book['structure_reviews'] == stream['structure_reviews']
            and book['figures'] == stream['figures'] and book['notes'] == stream['notes'], '本文の統合出力と構造台帳が違います')
    if report.get('output_figure_placement_ledger_sha256'):
        ledger = output('figure_placement_ledger.json', 'output_figure_placement_ledger_sha256')
        require(ledger['placements'] == stream['figure_placements'], '図版配置台帳と論理本文の版が違います')
    lo, hi = manifest['range']
    scans = {s['id']:s['scan_number'] for s in book['scans']}
    require(sorted(scans.values()) == list(range(lo, hi+1)) and len(scans) == len(book['scans']),
            '原本の統合範囲が一致しません')
    for sc in book['scans']:
        source = manifest.get('originalScans', {}).get(str(sc['scan_number']))
        if source and sc.get('image_sha256'):
            require(source.get('sha256', sc['image_sha256']) == sc['image_sha256'], '書籍と原本画像のSHAが違います')
            source['sha256'] = sc['image_sha256']
    canonical = {b['id']:b for b in book['body_blocks']}
    text = ''.join(canonical[i]['text'] for i in book['body_order'])
    require(text == stream['body_text'] and sha256(text.encode()).hexdigest() == report['body_sha256']
            and [s['id'] for s in stream['segments']] == book['body_order'], '統合後の本文と論理順が一致しません')
    order = book['body_order']
    boundaries = book['structure_reviews']['boundaries']
    pairs = [(r['left_body_id'], r['right_body_id']) for r in boundaries]
    require(len(order) == len(set(order)) and len(canonical) == len(book['body_blocks'])
            and len(pairs) == len(set(pairs)) and set(pairs) == set(zip(order, order[1:])),
            '統合境界に欠落・重複・順序の逆転があります')
    for segment in stream['segments']:
        require(segment['text'] == canonical[segment['id']]['text'], '論理本文ブロックと原稿の文字が違います')

    generated = {}
    standalone = manifest.get('entry') and not manifest.get('segments')
    if not standalone and not manifest.get('segments'):
        require(not book['notes'] and not book['figures'],
                'この統合データには図版または注記があります。配置・画像を収録した確認済みの読書分冊を segments に指定してください')
        generate_text_sections(manifest, book, stream, canonical, scans, generated, report['logical_stream_sha256'])

    def source(name):
        return generated[name] if name in generated else read_bytes(name)

    ordinals = defaultdict(int)
    blocks_by_ref = {}
    body_order, notes, figures = [], [], []
    block_ids = {}
    authored_links = set()
    parts = [{'part': manifest['entry'], 'start': lo, 'end': hi}] if standalone else manifest['segments']
    previous = None
    for part in parts:
        data = read_part(part, source)
        authored_links.update((tuple(e['from']), tuple(e['to'])) for e in data.get('continuations', []))
        if 'pages' in data:
            groups = [(p['scan'], p['blocks']) for p in data['pages']]
            figures.extend((p['scan'], f, part) for p in data['pages'] for f in p.get('figures', []))
        else:
            entries = list(template_entries(data))
            groups = [(e.get('scan'), e.get('blocks', [e]) if e['kind'] == 'text' else []) for e in entries]
            figures.extend((e['scan'],e,part) for e in entries if e['kind'] == 'image')
        for n, blocks in groups:
            if not blocks:
                previous = None
            for b in blocks:
                scan = b.get('scan', n)
                ref = (scan, ordinals[scan])
                if standalone and 'sourceRef' in b:
                    ref = tuple(b['sourceRef'])
                require(len(ref) == 2 and ref[0] == scan and type(ref[1]) is int and ref[1] >= 0
                        and ref not in blocks_by_ref, '読書分冊の本文位置が不正または重複しています')
                ordinals[scan] += 1
                blocks_by_ref[ref] = b
                if b.get('joinPrevious') is True:
                    require(previous is not None, '接続元の本文が見つかりません')
                    authored_links.add((previous, ref))
                previous = ref if b.get('type','body') in ('body','dialogue') else None
                if b.get('type', 'body') in ('body','dialogue','heading'):
                    body_order.append(ref)
                elif b.get('type') in ('note','footnote','caption'):
                    notes.append((scan,b,part))
                if b.get('id'):
                    require(b['id'] not in block_ids, '読書分冊の本文IDが重複しています')
                    block_ids[b['id']] = ref
    # Never guess at duplicate matching passages or an unrecorded split of a source block.
    by_key = defaultdict(list)
    for ref, row in blocks_by_ref.items():
        kind = row.get('type', 'body')
        if kind == 'dialogue':
            kind = 'body'
        if kind in ('body','heading'):
            by_key[ref[0], kind, row['text']].append(ref)
    matched = {}
    for ident, b in canonical.items():
        possible_scans = {scans[r['scan_id']] for r in b['source_refs']}
        candidates = [ref for n in possible_scans for ref in by_key[n, b['kind'], b['text']]]
        if ident in block_ids:
            candidates = [ref for ref in candidates if ref == block_ids[ident]]
        require(len(candidates) == 1, f'統合原稿と読書分冊で本文または見出しを一意に対応づけられません: {ident}')
        matched[ident] = candidates[0]
    if manifest['template_profile'] == 'novel':
        for segment in stream['segments']:
            ref = matched[segment['id']]
            if 'visual_dialogue_start' in segment:
                require((blocks_by_ref[ref].get('type') == 'dialogue') == segment['visual_dialogue_start'],
                        '小説の会話の開始位置が統合済み原稿と違います')
    require(len(matched) == len(set(matched.values())), '同じ読書ブロックが重複して統合原稿に割り当てられています')
    require(set(matched.values()) == set(body_order), '読書分冊に統合原稿と対応しない本文・見出しがあります')
    compare_supplements(book['notes'], notes, scans, 'note', source)
    placements = {p['figure_id']:p for p in stream.get('figure_placements', [])}
    ordered_figures = compare_supplements(book['figures'], figures, scans, 'figure', source, placements)
    if placements:
        require(ordered_figures == list(placements), '読書分冊の図版の掲載順が配置台帳と違います')
    flow = manifest.setdefault('readingFlow', {})
    decisions = list(flow.get('boundaryReviews', []))
    links = {(tuple(x['from']),tuple(x['to'])) for x in flow.get('continuations', [])}
    canonical_links = set()
    for boundary in boundaries:
        ai, bi = boundary['left_body_id'], boundary['right_body_id']
        a, b = matched[ai], matched[bi]
        require(boundary['display_boundary'] in {'continue','paragraph','dialogue','heading_transition','source_linebreak'}
                and boundary['source_review_status'] == 'verified' and boundary['left_suffix']
                and canonical[ai]['text'].endswith(boundary['left_suffix']) and boundary['right_prefix']
                and canonical[bi]['text'].startswith(boundary['right_prefix']), '原本の分冊境界と確認済み語句が違います')
        decisions.append({**boundary,'from': list(a),'to': list(b)})
        if boundary['display_boundary'] == 'continue':
            canonical_links.add((a,b))
        else:
            require((a,b) not in links | authored_links, '統合原稿と読書分冊の段落判断が矛盾しています')
    require((links | authored_links) <= canonical_links, '読書分冊に統合原稿と異なる本文接続があります')
    links = canonical_links
    # Compare actual body/heading order after applying the verified continuation chains.
    if flow.get('scanOrder'):
        rank = {n:i for i,n in enumerate(flow['scanOrder'])}
        body_order.sort(key=lambda ref: rank[ref[0]])
    after, incoming = dict(links), {b for a,b in links}
    actual_order = []
    for ref in body_order:
        if ref in incoming:
            continue
        while ref is not None:
            actual_order.append(ref)
            ref = after.get(ref)
    expected = [matched[e['heading_id'] if e['type']=='heading' else e['body_id']] for e in stream['layout_events']]
    require(actual_order == expected, '読書分冊の本文または見出しの表示順が統合原稿と違います')
    flow['boundaryReviews'] = decisions
    flow['continuations'] = [{'from':list(a),'to':list(b)} for a,b in sorted(links)]
    if standalone:
        require(authored_links == canonical_links, '全巻HTMLの改ページ・本文接続が確認済み統合原稿と一致しません')
        ranges = [[start,min(start + 19, hi)] for start in range(lo,hi + 1,20)]
        cuts = [start for start, _ in ranges[1:]]
        def crosses(row):
            a, b = row['from'][0], row['to'][0]
            return any(min(a,b) < cut <= max(a,b) for cut in cuts)
        flow['sourceRanges'] = ranges
        flow['confirmedSeams'] = [r for r in flow['continuations'] if crosses(r)]
        flow['boundaryReviews'] = [r for r in decisions if crosses(r)]
    return source


def compare_supplements(items, display, scans, kind, source, placements=None):
    # Figure and note placement is authored, not inferred from body punctuation.
    # Match IDs when present, with a unique scan + caption/text fallback.
    used = set()
    ordered = {}
    for item in items:
        source_scans = {scans[x['scan_id']] for x in item['source_refs']}
        value = item.get('caption_text', '') if kind=='figure' else item['text']
        hits = []
        for index, (n, row, part) in enumerate(display):
            if n not in source_scans or index in used or row.get('id',item['id']) != item['id']:
                continue
            text = (row.get('caption') or (row.get('externalCaption') or {}).get('text','')) if kind=='figure' else row['text']
            if text == value and (kind!='figure' or not row.get('image_sha256') or row['image_sha256']==item.get('image_sha256')):
                hits.append(index)
        require(len(hits)==1, '統合済みの図版・図説・注記と読書分冊が一致しません: '+item['id'])
        index = hits[0]
        used.add(index)
        ordered[index] = item['id']
        n, row, part = display[index]
        if kind == 'figure':
            placement = (placements or {}).get(item['id'], {})
            if row.get('src') and item.get('image_sha256'):
                encoded = part_image(row['src'], part, source)
                header, data = encoded.split(',',1)
                raw = base64.b64decode(data, validate=True) if header.endswith(';base64') else unquote_to_bytes(data)
                require(sha256(raw).hexdigest() == item['image_sha256'], '図版の画像が確認済みの版と違います')
            elif row.get('bbox') and placement:
                x,y,w,h = row['bbox']
                require(any(scans[r['scan_id']] == n and r['bounds'] == [x,y,x+w,y+h]
                            for r in placement['source_refs']), '図版の切り抜きが確認済みの領域と違います')
        for key in ('anchors','reference_anchors'):
            if key in row:
                require(row[key] == item.get(key), '読書分冊の注記・図版の本文アンカーが違います')
    require(len(used)==len(display), '読書分冊に統合原稿と対応しない図版または注記があります')
    return [ordered[i] for i in sorted(ordered)]


def generate_text_sections(manifest, book, stream, canonical, scans, generated, stream_hash):
    """A layout-complete text merge can be staged in 20-scan pieces without duplicating its transcription."""
    original_map = manifest.setdefault('originalScans', {})
    page_map = {}
    for sc in book['scans']:
        n = sc['scan_number']
        src = original_map.setdefault(str(n), {})
        if not src.get('path') and sc.get('image_filename'):
            src['path'] = sc['image_filename']
        require(src.get('path'), f'原本{n}の画像パスがありません')
        if sc.get('image_sha256'):
            require(not src.get('sha256') or src['sha256'] == sc['image_sha256'], f'原本{n}のSHAが違います')
            src['sha256'] = sc['image_sha256']
        page_map[n] = {'scan':n,'blocks':[],'figures':[],'toc_entries':[]}
    previous = 0
    toc = []
    novel = manifest['template_profile'] == 'novel'
    dialogues = {s['id'] for s in stream['segments'] if s.get('visual_dialogue_start')}
    for event in stream['layout_events']:
        ident = event['heading_id'] if event['type'] == 'heading' else event['body_id']
        b = canonical[ident]
        refs = {scans[x['scan_id']] for x in b['source_refs']}
        require(len(refs) == 1, '複数原本にまたがる一つの本文に原本文字位置がありません。確認済みの読書分冊を指定してください')
        n = refs.pop()
        require(n >= previous, '原本順と論理読順が異なるため、配置を収録した確認済みの読書分冊を指定してください')
        previous = n
        block = {'id': ident, 'type': 'dialogue' if novel and ident in dialogues else b['kind'], 'text':b['text']}
        if b.get('source_heading_id'):
            block['source_heading_id'] = b['source_heading_id']
        page_map[n]['blocks'].append(block)
        if event['type'] == 'heading':
            level = event.get('heading_level')
            toc.append({'kind':'chapter' if level == 1 else 'section', 'level':level,
                        'targetScan':n,'text':b['text'],'headingId':ident})
    lo, hi = manifest['range']
    parts = manifest['segments'] = []
    for start in range(lo, hi+1, 20):
        end = min(hi,start+19)
        pages = [page_map[n] for n in range(start,end+1)]
        bounds = [start,end]
        if novel:
            # Novel readers use their own dialogue, heading and pagination routines.
            data = {'bookId':manifest['bookId'], 'kind':'text', 'range':bounds,
                    'blocks':[dict(block, scan=p['scan']) for p in pages for block in p['blocks']]}
            name = f'readers/canonical-{start:04d}-{end:04d}.json'
            generated[name] = json.dumps(data,ensure_ascii=False).encode()
            parts.append({'start':start,'end':end,'part':name,'assets':{}})
            continue
        for p in pages:
            if not p['blocks']:
                p['pageType'] = 'portrait'
        data = {'bookId':manifest['bookId'],'title':manifest['title'],'range':bounds,'pages':pages,
                'toc':[row for row in toc if start <= row['targetScan'] <= end], 'continuations':[]}
        model = {'book_id':manifest['bookId'],'source_scan_numbers':list(range(start,end+1)),
                 'sourceLogicalStreamSha256':stream_hash,'model_schema':'shelf-merged-source-ref-v1'}
        def tag(ident, obj):
            val = json.dumps(obj,ensure_ascii=False).replace('<','\\u003c')
            return '<script type="application/json" id="'+ident+'">'+val+'</script>'
        name = f'readers/canonical-{start:04d}-{end:04d}.html'
        generated[name] = ('<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5,user-scalable=yes"></head><body>'+tag('reader-verified-structure',{'model':model})+tag('bookdata',data)+'</body></html>').encode()
        parts.append({'start':start,'end':end,'part':name,'assets':{}})
