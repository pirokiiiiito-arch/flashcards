#!/usr/bin/env python3
"""Prepare or finalize one private bookshelf registration, for both new books and replacements."""
import argparse
import hashlib
from html.parser import HTMLParser
import json
import re
import tempfile
import zipfile
from pathlib import Path

from reader_shelf_probe import check, digest, measure
from reader_shelf_pack import FLOW, pack, structured_sources

BLOCK=4*1024*1024
REGISTRY='reader/quality/shelf-registration.json'

def read(path):
    return json.loads(path.read_bytes())
def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream,'sha256').hexdigest()
def textsha(s):
    return hashlib.sha256(s.encode()).hexdigest()
def encode(obj):
    return (json.dumps(obj,ensure_ascii=False,indent=2)+'\n').encode()

def identity(b):
    fields=['shelf-entry-v1',b['id'],b['title'],b.get('subtitle',''),b.get('status',''),b.get('scans') or 0,[[p['id'],p['size']] for p in b['parts']]]
    return textsha(json.dumps(fields,ensure_ascii=False,separators=(',',':')))

def parts_fingerprint(entry,folder):
    observed=read(folder/'parts.json')
    check(isinstance(observed,list) and len(observed)==len(entry['parts']),'Driveの同一ID読戻し記録が必要です')
    seen=set()
    piece=bytearray()
    root=hashlib.sha256()
    full=hashlib.sha256()
    total=0
    for i,p in enumerate(entry['parts'],1):
        check(re.fullmatch(r'[A-Za-z0-9_-]{12,128}',p['id']) and p['id'] not in seen,'DriveファイルIDが不正または重複しています')
        seen.add(p['id'])
        observation=observed[i-1]
        check((observation['id'],observation['index'],observation['bytes'])==(p['id'],i,p['size']),'読戻しファイルのIDまたは順序が違います')
        part_digest=hashlib.sha256()
        path=folder/f'{i:02d}.bin'
        check(path.stat().st_size==p['size'] and p['size']>0,f'読戻しサイズが違います: {i}')
        with path.open('rb') as f:
            for buf in iter(lambda:f.read(1024*1024),b''):
                part_digest.update(buf)
                full.update(buf)
                total+=len(buf)
                piece.extend(buf)
                while len(piece)>=BLOCK:
                    root.update(hashlib.sha256(piece[:BLOCK]).digest())
                    del piece[:BLOCK]
        check(part_digest.hexdigest()==observation['sha256'],'同一IDからの読戻し記録と実体が一致しません')
    if piece:
        root.update(hashlib.sha256(piece).digest())
    check(total==entry['totalBytes'] and seen,'Drive読戻し範囲が違います')
    return full.hexdigest(),root.hexdigest()

class Viewport(HTMLParser):
    def __init__(self):
        super().__init__()
        self.settings=[]
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='meta' and (a.get('name') or '').lower()=='viewport':
            self.settings.append(a.get('content',''))

def inspect_archive(archive,ref):
    with zipfile.ZipFile(archive) as z:
        paths=z.namelist()
        check(len(paths)==len(set(paths)),'ZIPの同名項目が重複しています')
        m=json.loads(z.read('manifest.json'))
        check(m['range']==ref['range'],'原本と書籍の範囲が違います')
        low,high=m['range']
        check(1<=low<=high,'原本範囲が不正です')
        if m.get('segments'):
            entries=[(v['start'],v['end'],v['part']) for v in m['segments']]
        else:
            path=m.get('entry') or m.get('engine')
            check(path and path in paths,'読書画面を特定できません')
            entries=[(low,high,path)]
        at=low
        ranges=[]
        html_hashes=[]
        for start,end,path in entries:
            check(start==at and start<=end<=high,'分冊に欠落または重複があります')
            at=end+1
            ranges.extend((s,min(s+19,end)) for s in range(start,end+1,20))
            h=hashlib.sha256()
            with z.open(path) as f:
                head=f.read(1024*1024)
                h.update(head)
                for buf in iter(lambda:f.read(1024*1024),b''):
                    h.update(buf)
            parser=Viewport()
            parser.feed(head.decode('utf-8',errors='replace').split('</head>',1)[0])
            check(len(parser.settings)==1,f'{start}〜{end}: viewportを特定できません')
            pairs=[s.strip().lower().split('=',1) for s in re.split('[,;]',parser.settings[0]) if '=' in s]
            options={k.strip():v.strip() for k,v in pairs}
            check(len(options)==len(pairs) and options.get('user-scalable')=='yes' and float(options.get('maximum-scale','inf'))>=5,f'{start}〜{end}: 標準ピンチ設定が上書きされています')
            html_hashes.append(h.hexdigest())
        check(at==high+1,'末尾の分冊がありません')
        original_ranges=m.get('readingFlow', {}).get('sourceRanges')
        if original_ranges:
            cuts={entry[0] for entry in entries}
            cuts.add(high+1)
            at=low
            for start,end in original_ranges:
                check(start==at and start<=end<=high, '元分冊範囲に欠落または重複があります')
                cuts.add(start)
                at=end+1
            check(at==high+1, '末尾の元分冊範囲がありません')
            ordered=sorted(cuts)
            ranges=[(n,min(n+19,stop-1)) for start,stop in zip(ordered,ordered[1:]) for n in range(start,stop,20)]
        return m,ranges,html_hashes

def write_set(out,files):
    check(not out.exists(),'新しい出力先を指定してください')
    out.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=out.parent) as tmp:
        ready=Path(tmp)/'ready'
        ready.mkdir()
        for name,content in files.items():
            (ready/name).write_bytes(content)
        ready.rename(out)

def edge_keys(edges):
    return {(tuple(e['from']),tuple(e['to'])) for e in edges}


def registration_flow(archive, m, ref, admitted):
    """Classify the bytes that will be signed, before probing the actual saved-book reader."""
    if m.get('bookId') is not None and not admitted:
        check(m['bookId']==ref['bookId'], '本棚で検査する書籍のIDが違います')
    segments = m.get('segments', [])
    from reader_shelf_wh1_parts import FORMAT as wh1_format, verify as verify_wh1
    if not admitted and m.get('readingFlow', {}).get('format') == wh1_format:
        figure_reviews = ref.get('figureTextReviews', {})
        check(isinstance(figure_reviews, dict), '登録用の図版本文の原本照合記録が不正です')
        with zipfile.ZipFile(archive) as packed:
            edges = verify_wh1(m, packed.read, independent=ref['boundaryReviews'],
                               independent_figure_text=figure_reviews)
        check(edge_keys(edges)==edge_keys(ref['continuations']), '原本で確認した分冊の接続と違います')
        return {'route':wh1_format,'edges':edges}
    if len(segments) < 2:
        flow=m.get('readingFlow', {})
        if flow.get('format') == 'merged-template-flow-v1':
            check(m.get('format') == 'standalone-reader-html-v1', '統合読書ファイルの形式が違います')
            cursor=m['range'][0]
            for a,b in flow['sourceRanges']:
                check(a==cursor and a<=b<=m['range'][1], '統合読書ファイルの元分冊範囲が不正です')
                cursor=b+1
            check(not flow['sourceRanges'] or cursor==m['range'][1]+1, '統合読書ファイルに元分冊の欠落があります')
            edges=flow['continuations']
            if 'continuations' in ref:
                check(edge_keys(edges)==edge_keys(ref['continuations']), '原本照合表と全巻テンプレートの接続が異なります')
            return {'route':flow['format'], 'edges':edges, 'sourceRanges':flow['sourceRanges'],
                    'breaks':[row for row in flow.get('boundaryReviews', []) if row.get('display_boundary')!='continue']}
        if ref.get('continuations'):
            return {'route':'merged-template-flow-v1','edges':ref['continuations'],'sourceRanges':[]}
        return None
    if admitted:
        return None
    if 'text' not in ref['modes'] and not m.get('readingFlow'):
        return {'route': 'without-prose', 'edges': []}
    if m.get('bookId') == 'us-presidents-south' and m.get('template_profile') == 'world_history_1':
        return {'route': 'legacy-continuous', 'edges': []}
    if ref['profile'] != 'world_history_1' or m.get('template_profile') != ref['profile']:
        raise ValueError('分冊本文を共通 pack で全巻組版してから再登録してください')
    with zipfile.ZipFile(archive) as z:
        edges = structured_sources(m, z.read, independent_reviews=ref.get('boundaryReviews'))
    if 'continuations' in ref:
        expected = edge_keys(ref['continuations'])
        actual = edge_keys(edges)
        check(actual == expected, '原本照合表の分冊接続と登録する書籍の接続が一致しません')
    return {'route': FLOW, 'edges': edges}


def turn_summary(report, ranges):
    """Bind the actual recorded turns to both the source ranges and the reader's sections."""
    check(report.get('version') == 1 and [list(r) for r in report['ranges']] == [list(r) for r in ranges],
          '境界検査の原本範囲が一致しません')
    edges = [[r['after'], r['before'], r['kind']] for r in report['boundaries']]
    expected = [[left[1], right[0]] for left, right in zip(ranges, ranges[1:])]
    check([row[:2] for row in edges] == expected, '元分冊境界の往復検査に欠落・重複があります')
    check(all(row[2] in ('segment','within-document','shared-page') for row in edges),
          '元分冊境界の表示形式を確認できません')
    count = report['sectionCount']
    check(type(count) is int and count >= 1, '実際の表示区間数が得られません')
    sections = [[r['fromSection'], r['toSection']] for r in report['sectionBoundaries']]
    check(sections == [[i,i+1] for i in range(count-1)], '実際の表示区間の往復検査に欠落・重複があります')
    measurements = report['measurements']
    referenced = set()
    required = {kind + action for kind in ('button','swipe')
                for action in ('Forward','Back','RapidReturn','RapidReverse')}
    actual_crossings = []
    for boundary in report['boundaries']:
        if 'displayCrossings' in boundary:
            crossings = boundary['displayCrossings']
            check(isinstance(crossings, list) and crossings and all(isinstance(row, dict) for row in crossings),
                  '原本境界に対応する読書画面の往復記録がありません')
            check(crossings[0].get('measurement') == boundary.get('measurement'),
                  '原本境界の代表画面と先頭の往復記録が一致しません')
            actual_crossings.extend(crossings)
    for boundary in [*report['boundaries'], *report['sectionBoundaries'], *actual_crossings]:
        index = boundary.get('measurement')
        check(type(index) is int and 0 <= index < len(measurements), '分冊境界の画面記録がありません')
        referenced.add(index)
    check(len(referenced) == len(measurements), '元分冊・表示区間に対応しない画面記録があります')
    for result in measurements:
        cases = result.get('tests', {})
        check(required <= cases.keys(), '通常の前後移動・素早い両方向の折り返しが未検査です')
        for name in required:
            case = cases[name]
            check(type(case.get('frames')) is int and case['frames'] > 0 and case.get('intermediateFrames') == 0,
                  '境界の実描画が未検査か、途中の画面が混ざっています')
    return {'version':1, 'report':digest(report), 'boundaries':edges, 'sectionCount':count, 'sections':sections}


def measure_source_ruby(archive, manifest, html_hashes, inventories, book_id):
    # Check the privately staged bytes independently of a preview handoff.
    from subprocess import run
    ruby_reports=[]
    parts=manifest.get('segments') or [{'start':manifest['range'][0],'end':manifest['range'][1],'part':manifest.get('entry') or manifest.get('engine')}]
    check(len(parts)==len(inventories)==len(html_hashes),'収録HTMLごとに対応する原本ルビ台帳を指定してください')
    with zipfile.ZipFile(archive) as source, tempfile.TemporaryDirectory() as tmp:
        local_html=Path(tmp)/'edition.html'; output=Path(tmp)/'coverage.json'
        for part,expected,inventory in zip(parts,html_hashes,inventories):
            local_html.write_bytes(source.read(part['part']))
            check(sha(local_html)==expected,'検査中に読書HTMLが変わりました')
            run(['node',str(Path(__file__).with_name('reader-ruby-coverage.cjs')),'--artifact',str(local_html),
                 '--inventory',str(inventory),'--out',str(output)],check=True)
            coverage=read(output)
            check(coverage.get('bookId')==book_id and coverage.get('range')==[part['start'],part['end']]
                  and coverage.get('artifactSha256')==expected and coverage.get('status')=='complete',
                  '全原本のルビ照合と収納HTMLが一致しません')
            ruby_reports.append(digest(coverage))
    return ruby_reports


def prepare(a):
    from subprocess import run
    site=a.site.resolve()
    ledger_path=site/REGISTRY
    original_ledger=ledger_path.read_bytes()
    original_catalog=a.catalog.read_bytes()
    ledger=json.loads(original_ledger)
    catalog=json.loads(original_catalog)
    book=read(a.book)
    ref_bytes=a.reference.read_bytes()
    ref=json.loads(ref_bytes)
    check(ref['bookId']==book['id'] and ref['title']==book['title'] and re.fullmatch(r'[a-zA-Z0-9_-]{1,90}',book['id']),'書名または対象IDが違います')
    check(ref['profile'] in ['world_history_1','novel'] and ref['range'][1]==book['scans'],'原本照合表・書籍の範囲が違います')
    check(isinstance(book.get('title'),str) and len(book['title'])<=140 and len(book.get('subtitle',''))<=170,'本棚の書誌情報の長さが不正です')
    m,ranges,htmls=inspect_archive(a.archive,ref)
    full,root=parts_fingerprint(book,a.readback)
    check(a.archive.stat().st_size==book['totalBytes'] and sha(a.archive)==full,'検査対象のZIPとDriveの同一ID読戻しが違います')
    claim=ref.get('rubyCoverageClaim')
    check(claim in (None,'partial','complete'),'ふりがな照合状態が不正です')
    ruby_reports=[]
    inventories=getattr(a,'ruby_inventory',None) or []
    if inventories:
        ruby_reports=measure_source_ruby(a.archive,m,htmls,inventories,book['id'])
    if a.channel=='release':
        check(a.handoff,'通常版には既存の正式な納品判定が必要です')
        reports=read(a.handoff)
        covered=set()
        for report in reports:
            check(report.get('status')=='verified_release' and report.get('handoffAllowed') and report.get('canonical60Valid') and report.get('deviceVerified') and report.get('publicHttpVerified'),'通常版の既存検査が未完了です')
            coverage=report.get('rubyCoverage',{})
            check(coverage.get('schema')=='reader-ruby-coverage-v1' and coverage.get('status')=='complete'
                  and coverage.get('bookId')==book['id'] and coverage.get('artifactSha256')==report.get('artifactSha256')
                  and coverage.get('incomplete')==[] and coverage.get('errors')==[],
                  '今回の読書版の全原本ルビ照合記録が必要です')
            if not inventories:
                ruby_reports.append(digest(coverage))
            covered.add(report['artifactSha256'])
        check(full in covered or set(htmls).issubset(covered),'正式な納品判定がこの実体に対応していません')
    if claim=='complete':
        check(ruby_reports,'全原本の目視確認済みと記す版には原本照合台帳を --ruby-inventory で指定してください')
    key=textsha(book['id'])
    check(not any(r['key']==key for r in ledger['pending']),'この本の先行登録の確定または取下げが必要です')
    ids=[b['id'] for b in catalog['books']]
    check(len(ids)==len(set(ids)),'本棚の書籍IDが重複しています')
    admitted = any(row.get('key') == key and row.get('sha256') == full
                   for row in [*ledger.get('existing', []), *ledger.get('editions', [])])
    continuation = registration_flow(a.archive, m, ref, admitted)
    batches,hits,hosts,joins,turns=measure(site,a.archive,book,m,ref,ranges,root,a.chromium,continuation)

    detail={'pageTurns':turns,'continuity':joins,'batches':batches,'destinations':hits,'hostFiles':hosts,'sourceSha256':hashlib.sha256(ref_bytes).hexdigest(),'physicalIPhone':'not tested by this tool'}
    if ruby_reports:
        detail['sourceRubyCoverage']={'status':'complete','reports':ruby_reports}
    report=digest(detail)
    evidence={'version':1,'archive':full,'source':detail['sourceSha256'],'host':digest(hosts),'report':report,'first':ref['range'][0],'last':ref['range'][1],'modes':sorted(ref['modes']),'singleScreen':bool(ref.get('singleScreen')),'batches':batches,'toc':{'kind':ref['toc']['kind'],'rows':len(ref['toc']['rows']),'landed':len(hits),'reference':digest(ref['toc']),'results':digest(hits)}}
    evidence['pageTurns']=turn_summary(turns,ranges)
    record={'key':key,'entry':identity(book),'bytes':book['totalBytes'],'sha256':full,'chunkRoot':root,'channel':a.channel,'evidence':evidence}
    args=['node','--input-type=module','-e',"import fs from 'node:fs';import {parseLedger} from './reader/library/shelf-registration.mjs';await parseLedger(JSON.parse(fs.readFileSync(0)))"]
    signing="import fs from 'node:fs';import crypto from 'node:crypto';import {signingText} from './reader/library/shelf-registration.mjs';const r=JSON.parse(fs.readFileSync(0));console.log(crypto.sign('sha256',Buffer.from(signingText(r)),{key:fs.readFileSync(process.argv[1]),dsaEncoding:'ieee-p1363'}).toString('base64'));"
    record['signature']=run(['node','--input-type=module','-e',signing,str(a.key.resolve())],input=encode(record),cwd=site,check=True,capture_output=True).stdout.decode().strip()
    ledger['pending'].append(record)
    run(args,input=encode(ledger),cwd=site,check=True)
    if book['id'] in ids:
        catalog['books'][ids.index(book['id'])]=book
    else:
        catalog['books'].append(book)
    result=encode(catalog) if catalog!=json.loads(original_catalog) else original_catalog
    check(sha(a.archive)==full and original_catalog==a.catalog.read_bytes() and original_ledger==ledger_path.read_bytes(),'検査中に入力版が変わりました。最新の一覧から再開してください')
    for path,expected in hosts.items():
        check(sha(site/path)==expected,'検査後に読書プログラムが変わりました')
    prior=next((b for b in json.loads(original_catalog)['books'] if b['id']==book['id']),None)
    plan={'id':book['id'],'previousEntry':digest(prior) if prior else None,'record':record,'beforeRegistry':hashlib.sha256(original_ledger).hexdigest(),'beforeCatalog':hashlib.sha256(original_catalog).hexdigest(),'catalog':hashlib.sha256(result).hexdigest(),'detailHash':report}
    write_set(a.out,{'registry-staged.json':encode(ledger),'bookshelf.json':result,'plan.json':encode(plan),'verification.json':encode(detail)})

def checked_stage(a):
    from subprocess import run
    plan=read(a.prepared/'plan.json')
    detail=read(a.prepared/'verification.json')
    rec=plan['record']
    check(digest(detail)==plan['detailHash']==rec['evidence']['report'],'操作検査記録が変わりました')
    check('pageTurns' in detail, '分冊境界の往復検査を含む最新版の prepare が必要です')
    ranges=[row[:2] for row in rec['evidence']['batches']]
    check(turn_summary(detail['pageTurns'],ranges)==rec['evidence'].get('pageTurns'),
          '分冊境界の往復検査と署名対象が一致しません')
    db=read(a.registry)
    key=rec['key']
    check([r for r in db['pending'] if r['key']==key]==[rec],'公開済みの登録候補が違います')
    script="import fs from 'node:fs';import {parseLedger} from './reader/library/shelf-registration.mjs';await parseLedger(JSON.parse(fs.readFileSync(0)))"
    run(['node','--input-type=module','-e',script],input=encode(db),cwd=Path(__file__).resolve().parents[1],check=True)
    return plan,rec,db

def catalog_candidate(a):
    plan,rec,_=checked_stage(a)
    current=a.catalog.read_bytes()
    cat=json.loads(current)
    key=plan['id']
    proposed=next(b for b in read(a.prepared/'bookshelf.json')['books'] if b['id']==key)
    check(identity(proposed)==rec['entry'],'本棚候補の書籍・分割ファイルが検査版と一致しません')
    matches=[(i,b) for i,b in enumerate(cat['books']) if b['id']==key]
    check(len(matches)<=1,'本棚IDが重複しています')
    if matches and matches[0][1]==proposed:
        result=current
    else:
        check((digest(matches[0][1]) if matches else None)==plan['previousEntry'],'検査後に同じ書籍が更新されました。新版を確認してください')
        if matches:
            cat['books'][matches[0][0]]=proposed
        else:
            cat['books'].append(proposed)
        result=encode(cat)
    full,root=parts_fingerprint(proposed,a.readback)
    check((full,root)==(rec['sha256'],rec['chunkRoot']),'Driveの書籍実体が変わりました')
    write_set(a.out,{'bookshelf.json':result,'write-condition.json':encode({'expectedSha256':hashlib.sha256(current).hexdigest(),'candidateSha256':hashlib.sha256(result).hexdigest(),'unchanged':current==result})})

def finalize(a):
    plan,rec,db=checked_stage(a)
    key=rec['key']
    cat=read(a.catalog)
    entries=[b for b in cat['books'] if b['id']==plan['id']]
    check(len(entries)==1 and identity(entries[0])==rec['entry'],'Driveの同一IDから読み戻した本棚一覧が候補と一致しません')
    full,root=parts_fingerprint(entries[0],a.readback)
    check((full,root)==(rec['sha256'],rec['chunkRoot']),'公開後の分割ファイルが検査版と一致しません')
    db['pending']=[r for r in db['pending'] if r['key']!=key]
    db['editions']=[r for r in db['editions'] if r['key']!=key]+[rec]
    write_set(a.out,{'shelf-registration.json':encode(db),'confirmed.json':encode({'key':key,'archiveSha256':full,'readbackCatalog':sha(a.catalog),'basedOnRegistry':sha(a.registry)})})

def main():
    p=argparse.ArgumentParser(description=__doc__)
    sub=p.add_subparsers(dest='operation',required=True)
    composer=sub.add_parser('pack',help='原本照合済みの分冊を本棚ZIPに組み立てる')
    composer.add_argument('--manifest', required=True, type=Path)
    composer.add_argument('--archive', required=True, type=Path)
    composer.add_argument('--structure-reviews',type=Path,help='四工程の merged_bookdata.json または structure_reviews.json')
    q=sub.add_parser('prepare')
    f=sub.add_parser('finalize')
    c=sub.add_parser('catalog')
    for parser,fields in [(q,'site catalog book archive reference readback out'),(f,'prepared registry catalog readback out'),(c,'prepared registry catalog readback out')]:
        for field in fields.split():
            parser.add_argument('--'+field,required=True,type=Path)
    q.add_argument('--channel',choices=['preview','release'],required=True)
    q.add_argument('--chromium',type=Path)
    q.add_argument('--handoff',type=Path)
    q.add_argument('--ruby-inventory',action='append',type=Path,help='各収録HTMLに対応する私有の全原本ルビ照合台帳。分冊順に繰り返し指定できる。')
    q.add_argument('--key',required=True,type=Path)
    a=p.parse_args()
    if a.operation == 'pack':
        pack(a.manifest, a.archive, a.structure_reviews)
        return
    {'prepare':prepare,'catalog':catalog_candidate,'finalize':finalize}[a.operation](a)
if __name__=='__main__':
    main()
