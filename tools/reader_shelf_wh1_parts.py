"""Verify book data bound to the existing WH1 011–030 reader without reformatting it."""
import json
import re
import zipfile

from reader_shelf_pack import member, require, review_seams, sha, storage_ranges

FORMAT = 'wh1-bound-source-v1'
STYLE_SHA = '35d2da2a4827b26328656e6f3e74843e671182a46ade27dc69279cb4bfdabbe3'
# OCR may interpret a repeated ornament as a long standalone run of zeroes.
# It is a review signal, never a text replacement. Numbers with a nonzero
# leading digit do not match; a genuine run may be confirmed from the scan.
ZERO_BAND = re.compile(r'(?<![0-9０-９])[0０]{16,}(?![0-9０-９])')


def observe_figure_text(blocks, groups, segment, observed, *, joined=False):
    """Follow the template's figure grouping, including image overrides and hidden blocks."""
    starts, consumed = {}, set()
    for group in groups:
        scan, at = group['scan'], group['at']
        require(type(at) is int and 0 <= at < len(blocks) and at not in starts and group['figs'],
                f'原本{scan}: 図版の開始位置を特定できません')
        images, descriptions = [], []
        for kind, indices in (('figure', group['figs']), ('note', group['desc'])):
            for index in indices:
                require(type(index) is int and 0 <= index < len(blocks),
                        f'原本{scan}: 図または説明の参照が範囲外です')
                block = blocks[index]
                require(block['type'] == kind and block['scan'] == scan,
                        f'原本{scan}: 図と説明の原本番号・文字の役割が一致しません')
                consumed.add(index)
                if kind == 'figure' and scan in observed:
                    name = group.get('overrides', {}).get(str(index)) or block['image']
                    images.append(segment['assets'][name]['sha256'])
                if kind == 'note':
                    text = block['text']
                    require(not ZERO_BAND.search(text) or scan in observed,
                            f'原本{scan}: 図の説明に長い0列があります。原本の本文順・図注を照合してください')
                    descriptions.append(sha(text.encode()))
        starts[at] = (scan, dict(images=images, descriptions=descriptions))
        consumed.update(group.get('suppress', []))
        if 'heading' in group:
            consumed.add(group['heading'])
    for index, block in enumerate(blocks):
        scan, kind = block['scan'], block['type']
        if index in starts:
            group_scan, figure = starts[index]
            if group_scan in observed:
                observed[group_scan]['figures'].append(figure)
        elif index in consumed:
            continue
        elif joined and kind == 'body':
            for span in block['sourceSpans']:
                if span['scan'] in observed:
                    text = block['text'].encode('utf-16-le')[2*span['start']:2*span['end']].decode('utf-16-le')
                    observed[span['scan']]['prose'].append([kind, sha(text.encode())])
        elif scan in observed:
            if kind == 'figure':
                image = segment['assets'][block['image']]['sha256']
                caption = block.get('caption')
                observed[scan]['figures'].append(dict(images=[image], descriptions=[sha(caption.encode())] if caption else []))
            elif kind in ('body', 'heading', 'note', 'aside', 'signature', 'separator'):
                observed[scan]['prose'].append([kind, sha(block['text'].encode())])


def verify(m, read, write=None, independent=None, independent_figure_text=None):
    require(m.get('template_profile')=='world_history_1' and m.get('canonicalTemplate')=='wh1-0011-0030',
            '第1巻の基準書式を特定できません')
    scans = storage_ranges(m)
    require(set(m['originalScans'])==set(map(str,scans)), '原本の対応が欠けています')
    reviews = m.get('figureTextReviews', {})
    require(isinstance(reviews, dict) and set(reviews) <= set(m['originalScans']),
            '図版本文の原本照合記録が不正です')
    if independent_figure_text is not None:
        require(reviews == independent_figure_text, '登録用の原本照合記録と図版本文の検査対象が違います')
    def observations():
        return {int(n): dict(sourceSha256=m['originalScans'][n]['sha256'], prose=[], figures=[]) for n in reviews}
    source_observed, display_observed = observations(), observations()
    paths = {}
    def entry(meta,path,stored=False):
        data=read(member(path))
        require(meta.get('sha256')==sha(data) and ('bytes' not in meta or len(data)==meta['bytes']),
                f'制作台帳と実体が一致しません: {path}')
        if write and path not in paths:
            write(path,data,zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED)
        paths[path] = meta['sha256']
        return data
    def fields(data):
        styles=re.findall(rb'<style\b[^>]*>[\s\S]*?</style>',data)
        require(len(styles)==1 and sha(styles[0])==STYLE_SHA,'第1巻の基準CSSが変わっています')
        names=('blocks','ILLUSTRATION_GROUPS','toc')
        result=[]
        for name in names:
            rows=re.findall(rb'^const '+name.encode()+rb'=(.*);$',data,re.M)
            require(len(rows)==1,f'書籍データが見つかりません: {name}')
            result.append(json.loads(rows[0]))
        return result
    for meta in m['originalScans'].values():
        entry(meta,meta['path'],True)
    raw_bodies={};display_bodies={};display_refs=[];joined=set()
    for s in m['segments']:
        raw,groups,toc=fields(entry(s,s['part']))
        disp,gr2,toc2=fields(entry(s['display'],s['display']['path']))
        observe_figure_text(raw,groups,s,source_observed)
        observe_figure_text(disp,gr2,s,display_observed,joined=True)
        require(toc==toc2,'統合前後で目次が変わっています')
        def supplements(blocks):
            return [{k:v for k,v in b.items() if k!='sourceSpans'} for b in blocks if b['type']!='body']
        require(supplements(raw)==supplements(disp),'統合前後で図版・説明・見出しが変わっています')
        def illustrations(blocks,gs):
            return [(g['scan'],g['title'],[blocks[i] for i in g['figs']],[blocks[i] for i in g['desc']]) for g in gs]
        require(illustrations(raw,groups)==illustrations(disp,gr2),'図版と説明文の対応が違います')
        for b in raw:
            require(s['start']<=b['scan']<=s['end'],'分冊と原本番号が違います')
            if b['type']=='body':
                key=tuple(b['sourceRef'])
                require(key[0]==b['scan'] and key not in raw_bodies,'本文の出典が重複しています')
                raw_bodies[key]=b['text']
        for b in disp:
            if b['type']!='body':continue
            data=b['text'].encode('utf-16-le');offset=0;previous=None
            for span in b['sourceSpans']:
                ref=tuple(span['sourceRef']);end=span['end']
                require(ref[0]==span['scan'] and ref not in display_bodies and span['start']==offset and end>offset,'統合本文の原本位置が不正です')
                display_bodies[ref]=data[offset*2:end*2].decode('utf-16-le')
                display_refs.append(ref)
                if previous and scans[previous[0]]!=scans[ref[0]]:joined.add((previous,ref))
                previous=ref;offset=end
            require(2*offset==len(data),'統合後の段落に未照合の文字があります')
        for b in raw:
            if 'image' in b:require(b['image'] in s['assets'],'画像の参照先がありません')
        for meta in s['assets'].values():
            if meta['path'] not in paths:entry(meta,meta['path'],True)
            require(meta['sha256']==paths[meta['path']], '同じ図版に異なる画像の照合記録があります')
    for n, expected in reviews.items():
        require(expected == source_observed[int(n)] == display_observed[int(n)],
                f'原本{n}: 原本照合と読書版の本文順・見出し・独立した注・図版・説明文が一致しません')
    require(raw_bodies==display_bodies and list(raw_bodies)==display_refs,'本文の欠落・重複・順序違いがあります')
    if independent is not None:
        require(m['readingFlow']['boundaryReviews']==independent,'原本境界照合表と分冊が一致しません')
    evidence=dict(m,readingFlow=dict(m['readingFlow']))
    edges=review_seams(evidence,raw_bodies,{},joined)
    require(edges==joined,'原本の接続指定と統合済みの本文が異なります')
    return [{'from':list(a),'to':list(b)} for a,b in sorted(joined)]
