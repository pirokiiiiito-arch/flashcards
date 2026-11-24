"""Issue the independently authorized edited reading artifact without equating its images to historical originals."""
import base64
import hashlib
import json
import re
from collections import Counter

from reader_shelf_pack import member, require, review_seams, sha, source_json, storage_ranges

FORMAT = 'wh1-editorial-source-v1'
PINS = {'nativeManifest':'sourceManifestSha256','pages':'sourceRecordsSha256','sources':'sourceInventorySha256',
        'toc':'sourceTocSha256','boundaries':'boundaryReviewsSha256'}
# One authorization binds the book identity, the actual read-only entry, and the five
# independent frozen source records. No title, historical image or private file ID is public.
AUTHORIZED = '25f45dbed6c63a40a4864cc57e5de06dbc153a4530b19212c8b61dbc28ad075b'
STYLE = '35d2da2a4827b26328656e6f3e74843e671182a46ade27dc69279cb4bfdabbe3'


def json_sha(value):
    return sha(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',',':')).encode())


def images(html, payload, native, sources, pages):
    names = {str(n) for n in range(1,len(pages)+1)}
    views = native['sourceDisplayAssets']
    require(set(views)==set(payload['labels'])==names and len(payload['assets'])==len(names),
            '校閲資料の原本番号が欠落または重複しています')
    originals = {str(v['scan']):v['sha256'] for v in sources}
    require(set(originals)==names and len(sources)==len(names), '独立原本一覧が不足しています')
    tags = {}
    pattern = rb'<script id="(source-image-[0-9]+)" type="application/octet-stream">([A-Za-z0-9+/=]+)</script>'
    for match in re.finditer(pattern,html):
        ident = match[1].decode()
        require(ident not in tags, '比較資料が重複しています')
        raw = base64.b64decode(match[2],validate=True)
        tags[ident] = (len(raw),sha(raw))
    require(len(tags)==len(names), '比較資料の実体が不足しています')
    selected=[]; counts=Counter(); image_ids=set()
    for p in pages:
        key=str(p['scan']); source=originals[key]; view=views[key]; label=payload['labels'][key]
        kind=view['kind']; name=view['name']; asset=payload['assets'][name]; image_ids.add(asset['id'])
        require(kind in ('original','redacted-source','review-notice') and
                source==p['originalSha256']==view['sourceImageSha256'] and
                label=={'kind':kind,'name':name} and asset['mime']==view['mime'] and
                tags[asset['id']]==(view['bytes'],view['sha256']), '校閲比較画像と独立原本記録が違います')
        genuine = kind=='original'
        require((key in native['originalScans'])==genuine and (source==view['sha256'])==genuine,
                '編集済み画像を無変更原本として使用できません')
        if genuine:
            require(native['originalScans'][key]['sha256']==source, '無変更原本のSHAが一致しません')
        counts[kind]+=1; selected.append([p['scan'],kind,source,view['sha256']])
    require(set(tags)==image_ids, '表示に使用されない画像が含まれます')
    return counts,json_sha(selected)


def fields(sheet,name):
    rows=re.findall(r'^const '+name+r'=(.*);$',sheet,re.M)
    require(len(rows)==1, '編集版の読書データを特定できません')
    return json.loads(rows[0])


def utf16slice(text,a,b):
    return text.encode('utf-16-le')[a*2:b*2].decode('utf-16-le')


def ruby_key(row):
    return row['sourceScan'],tuple(row['sourceBox']),row['sourceImageSha256'],row['base'],row['reading']


def verify_text(sheet,pages,toc):
    observed={};expected={};bodies={};edges=set();rendered_ruby=Counter();source_ruby=Counter()
    for p in pages:
        n=p['scan']
        if p['pageType']=='toc':
            rows=[(str(t['number'])+'　'+t['label']) for t in toc if t['source']==n]
            require([b['text'] for b in p['blocks']]==rows,'原本目次と校閲原稿が違います')
        elif p['pageType']=='image':
            top=[b['text'] for b in p['blocks'] if b['placement']=='beforeFigure']
            caption='\n'.join(b['text'] for b in p['blocks'] if b['placement']=='afterFigure')
            expected[n,0]=('figure', (top,caption))
        else:
            for i,b in enumerate(p['blocks']):
                kind='note' if b.get('editorial') else {'dialogue':'body','footnote':'note'}.get(b['type'],b['type'])
                expected[n,i]=(kind,b['text'])
        for b in p['blocks']:
            for r in b.get('ruby',[]):
                require(r['sourceScan']==n and r['sourceImageSha256']==p['originalSha256'] and
                        r.get('reviewStatus')=='verified' and b['text'][r['start']:r['end']]==r['base'],
                        '原稿ルビの親文字と原本が一致しません')
                source_ruby[ruby_key(r)]+=1
    def record(ref,kind,text):
        key=tuple(ref);require(key not in observed,'読書本文の原本位置が重複しています')
        observed[key]=(kind,text)
        if kind=='body':bodies[key]=text
    def reading(row,text):
        require(utf16slice(text,row['start'],row['end'])==row['base'],'読書画面のルビ親文字が違います')
        rendered_ruby[ruby_key(row)]+=1
    for b in fields(sheet,'blocks'):
        kind=b['type']
        if kind=='toc':continue
        if kind=='figure':
            record(b['sourceRef'],kind,(b.get('figureHeadings',[]),b['caption']))
            continue
        value=b['text']
        for r in b.get('bodyRuby',[]):reading(r,value)
        if kind!='body':
            record(b['sourceRef'],kind,value);continue
        offset=0;last=None
        for span in b['sourceSpans']:
            ref=tuple(span['sourceRef'])
            require(span['start']==offset and span['end']>offset and span['scan']==ref[0],'本文の原本範囲が不正です')
            record(ref,kind,utf16slice(value,offset,span['end']))
            if last and (last[0]-1)//20!=(ref[0]-1)//20:edges.add((last,ref))
            offset=span['end'];last=ref
        require(offset*2==len(value.encode('utf-16-le')),'連結本文に未照合の部分があります')
    require(observed==expected,'編集済み本文・図版の表示と校閲原稿が一致しません')
    entries=fields(sheet,'toc')
    require([(e['page'],e['num'],e['name'],e['target']) for e in entries]==
            [(r['source'],str(r['number']),r['label'],r['target']) for r in toc] and
            all(e.get('linkAvailable') for e in entries),'目次または着地点が違います')
    for e in entries:
        for r in e.get('nameRuby',[]):reading(r,e['name'])
    require(rendered_ruby==source_ruby,'原稿と実表示のルビが違います')
    return bodies,edges,sum(rendered_ruby.values())


def materialize(m,read,write=None):
    descriptor=m['editorialEdition']
    require(m['template_profile']=='world_history_1' and descriptor['format']==FORMAT and
            descriptor['entry']=='reader.html' and '一部省略' in m['status'] and '校正中' in m['status'],
            '編集版の種類・開示・読書入口が違います')
    fingerprint='\n'.join([sha(m['bookId'].encode()),descriptor['sha256']]+[descriptor[k]['sha256'] for k in PINS])
    require(sha(fingerprint.encode())==AUTHORIZED,'この編集版の入力は受領済みの書籍・版と一致しません')
    html=read('reader.html');require(sha(html)==descriptor['sha256'],'受領済みの読書HTMLと異なります')
    docs={};sealed=dict(descriptor)
    for key in PINS:
        ref=descriptor[key];data=read(member(ref['path']))
        require(sha(data)==ref['sha256'],'編集版の独立証拠が変更されています')
        docs[key]=json.loads(data)
        sealed[key]={'path':'editorial/'+key+'.json','sha256':ref['sha256']}
        if write:write(sealed[key]['path'],data)
    native=docs['nativeManifest'];pages=docs['pages'];bounds=m['range']
    require(native['bookId']==m['bookId'] and native['range']==bounds and
            [p['scan'] for p in pages]==list(range(bounds[0],bounds[1]+1)),'編集原稿の対象が違います')
    payload=source_json(html.decode(),'source');sheet=payload['sheet']
    styles=re.findall(r'<style\b[^>]*>[\s\S]*?</style>',sheet)
    require(len(styles)==1 and sha(styles[0].encode())==STYLE and payload['book']==m['bookId'] and
            payload['size']==len(pages) and payload['status']==m['status'],'基準組版と編集版の書誌が一致しません')
    counts,selection=images(html,payload,native,docs['sources'],pages)
    bodies,edges,ruby=verify_text(sheet,pages,docs['toc'])
    storage_ranges(native)
    ranges=[[s['start'],s['end']] for s in native['segments']]
    require(ranges==[[i,min(i+19,bounds[1])] for i in range(bounds[0],bounds[1]+1,20)] and
            native['readingFlow']['boundaryReviews']==docs['boundaries'],'独立した分冊境界記録と違います')
    require(review_seams(native,bodies,{},edges)==edges and
            {(tuple(e['from']),tuple(e['to'])) for e in native['readingFlow']['continuations']}==edges,
            '独立原本の分冊接続と表示本文が違います')
    evidence={'version':1,'format':FORMAT,'readerSha256':sha(html),
              **{field:descriptor[k]['sha256'] for k,field in PINS.items()},'selectionSha256':selection,
              'originalScans':counts['original'],'redactedScans':counts['redacted-source'],'noticeScans':counts['review-notice'],
              'sourceRanges':len(ranges),'rubyCount':ruby,'tocRows':len(docs['toc']),'verifiedBoundaries':len(docs['boundaries']),
              'verifiedContinuations':len(edges),'textDisagreements':'not-certified'}
    flow={'format':FORMAT,'sourceRanges':ranges,'boundaryReviews':docs['boundaries'],
          'continuations':[{'from':list(a),'to':list(b)} for a,b in sorted(edges)]}
    if write:write('reader.html',html)
    return {**{k:m[k] for k in ('schema','bookId','title','range','template_profile','status')},
            'subtitle':m.get('subtitle',''),'format':'standalone-reader-html-v1','entry':'reader.html',
            'sha256':sha(html),'editorialEdition':sealed,'editorialEvidence':evidence,'readingFlow':flow}


def expected_displays(zipped,manifest):
    name=manifest['editorialEdition']['nativeManifest']['path']
    views=json.loads(zipped.read(name))['sourceDisplayAssets']
    projection={scan:{'kind':v['kind'],'sha256':v['sha256']} for scan,v in views.items()}
    rows=[[int(scan),v['kind'],v['sha256']] for scan,v in sorted(projection.items(),key=lambda pair:int(pair[0]))]
    return projection,json_sha(rows)


def verify_archive(archive,m,ref):
    import zipfile
    with zipfile.ZipFile(archive) as z:
        expected={'manifest.json','reader.html',*('editorial/'+field+'.json' for field in PINS)}
        require(set(z.namelist())==expected and len(z.namelist())==len(expected),'承認対象外の資料が登録ZIPにあります')
        checked=materialize(m,z.read)
        comparison,expected=expected_displays(z,m)
    require(ref.get('editorialDisplay')==comparison,'比較資料の独立原本参照が異なります')
    require(checked==m and ref.get('editorial')==m['editorialEvidence'] and m['bookId']==ref['bookId'] and
            m['readingFlow']['boundaryReviews']==ref['boundaryReviews'] and m['readingFlow']['continuations']==ref['continuations'],
            '登録対象の編集版と外部固定した台帳が一致しません')
    flow=m['readingFlow']
    return {'route':FORMAT,'expectedDisplayReadback':expected,'sourceRanges':flow['sourceRanges'],'edges':flow['continuations'],
            'breaks':[r for r in flow['boundaryReviews'] if r['display_boundary']!='continue']}


def bind_readback(static,measured,expected_digest):
    display=measured.get('editorialDisplay',{})
    expected={'original':static['originalScans'],'redacted-source':static['redactedScans'],'review-notice':static['noticeScans']}
    require(display.get('counts')==expected and display.get('count')==sum(expected.values()) and
            display.get('report')==expected_digest and re.fullmatch(r'[0-9a-f]{64}',expected_digest),
            '本棚での編集版資料全枚の種別・バイト読戻しがありません')
    return {**static,'displayReadbackSha256':display['report']}


def partial_evidence(channel,proof):
    require(channel=='preview' and proof.get('status')=='partial' and type(proof.get('pendingScans')) is int and
            proof['pendingScans']>0 and 'textDisagreements' not in proof,
            'この編集版は未完了の原本照合を明示した確認版としてのみ登録できます')


def recheck_staged(folder,record,details):
    """Verify the exact downloaded delivery a second time before cataloging or finalizing."""
    import shutil
    import tempfile
    import zipfile
    source=details['sourceProof']
    partial_evidence(record['channel'],source)
    with tempfile.TemporaryFile() as archive:
        parts=json.loads((folder/'parts.json').read_bytes())
        for index,_ in enumerate(parts,1):
            with (folder/f'{index:02d}.bin').open('rb') as part:shutil.copyfileobj(part,archive)
        require(archive.tell()==record['bytes'],'編集版の読戻しサイズが違います')
        archive.seek(0)
        require(hashlib.file_digest(archive,'sha256').hexdigest()==record['sha256'],'編集版の登録実体が変更されています')
        archive.seek(0)
        with zipfile.ZipFile(archive) as zipped:
            m=json.loads(zipped.read('manifest.json'))
            expected={'manifest.json','reader.html',*('editorial/'+field+'.json' for field in PINS)}
            require(len(zipped.namelist())==len(expected) and set(zipped.namelist())==expected and
                    m==materialize(m,zipped.read),'登録用の編集版の校閲資料が変更されています')
            _,expected_hash=expected_displays(zipped,m)
    signed=bind_readback(m['editorialEvidence'],details['continuity'],expected_hash)
    require(details.get('editorial')==signed==record['evidence']['editorial'],'編集版の照合記録が署名と違います')
