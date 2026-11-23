"""Verify the private original-page figure/caption inventory against both painted reading routes."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
import struct

from figure_caption_geometry import figure_distance, inspect_input

HEX = re.compile(r'[a-f0-9]{64}')
SINGLE = re.compile(r'figure-(\d+)\Z')
FIG = re.compile(r'figure-(\d+)-(\d+)\Z')
CAP = re.compile(r'caption-(\d+)\Z')
IMAGE = re.compile(r'image-(\d+)\Z')
LABEL = re.compile(r'figure-label-(\d+)-(\d+)\Z')
IMAGE_CAP = re.compile(r'image-caption-(\d+)\Z')
WH1_SHELF_HOSTS = frozenset(
    'reader/library/' + name for name in (
        'read.html','read-wh1-v9.html','wh1-caption-ruby.js','storage.js','wh1-reader-routing.js',
        'wh1-pager-v9.js','wh1-figure-viewport-v9.js','wh1-display-check-v9.js','wh1-exact-pagination.js')
)


class EvidenceError(ValueError):
    pass


def require(test, code):
    if not test:
        raise EvidenceError(code)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def rows_digest(rows):
    return sha(json.dumps(rows, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode())


def named(value):
    return isinstance(value, str) and bool(value.strip())


def ids(value):
    return isinstance(value, list) and all(named(x) for x in value) and len(set(value)) == len(value)


def pinned(root, ref):
    require(isinstance(ref, dict) and named(ref.get('path')), 'MISSING_EVIDENCE_FILE')
    name = Path(ref['path'])
    path = (root / name).resolve()
    require(not name.is_absolute() and '..' not in name.parts and path.is_relative_to(root.resolve()), 'UNSAFE_EVIDENCE_PATH')
    require(path.is_file(), 'MISSING_EVIDENCE_FILE')
    data = path.read_bytes()
    require(sha(data) == ref.get('sha256'), 'EVIDENCE_HASH_MISMATCH')
    return data


def dimensions(data):
    if data.startswith(b'\x89PNG\r\n\x1a\n') and data[12:16] == b'IHDR' and len(data) >= 24:
        return struct.unpack('>II', data[16:24])
    if data.startswith((b'GIF87a', b'GIF89a')) and len(data) >= 10:
        return struct.unpack('<HH', data[6:10])
    if data.startswith(b'\xff\xd8'):
        i = 2
        while i + 4 <= len(data) and data[i] == 255:
            if data[i+1] == 255:
                i += 1
                continue
            marker = data[i+1]
            size = int.from_bytes(data[i+2:i+4], 'big')
            if marker in (192,193,194,195,197,198,199,201,202,203,205,206,207) and size >= 7 and i+9 <= len(data):
                h,w = struct.unpack('>HH',data[i+5:i+9])
                return w,h
            if size < 2 or marker in (217,218):
                break
            i += 2 + size
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        if data[12:16] == b'VP8X' and len(data) >= 30:
            return 1+int.from_bytes(data[24:27],'little'),1+int.from_bytes(data[27:30],'little')
        if data[12:16] == b'VP8L' and len(data) >= 25 and data[20] == 47:
            bits=int.from_bytes(data[21:25],'little')
            return (bits & 16383)+1,((bits >> 14) & 16383)+1
        if data[12:16] == b'VP8 ' and data[23:26] == b'\x9d\x01\x2a' and len(data)>=30:
            return tuple(v & 16383 for v in struct.unpack('<HH',data[26:30]))
    raise EvidenceError('INVALID_SOURCE_OR_CAPTURE_IMAGE')


def valid_box(box, size):
    return (isinstance(box,list) and len(box)==4 and all(type(v) is int for v in box)
            and 0<=box[0]<box[2]<=size[0] and 0<=box[1]<box[3]<=size[1])


def readings(text, values):
    require(isinstance(values,list),'RUBY_REVIEW_MISSING')
    out = []
    last = 0
    for r in values:
        a,b=r['start'],r['end']
        require(type(a) is int and type(b) is int and last<=a<b<=len(text) and
                text[a:b]==r.get('base') and named(r.get('reading')), 'INVALID_CAPTION_RUBY')
        out.append((a,b,r['base'],r['reading']))
        last=b
    return out


def source_page(root, page, book_sources, original_ocr):
    scan = page['scan']
    original = pinned(root,page.get('source'))
    source = sha(original)
    if book_sources is not None:
        require(book_sources.get(scan,book_sources.get(str(scan)))==source,'REGISTERED_ORIGINAL_MISMATCH')
    size = dimensions(original)
    require(min(size)>0,'INVALID_SOURCE_OR_CAPTURE_IMAGE')
    require(original_ocr.get(scan)==(source,(page.get('ocr') or {}).get('sha256')),
            'MISSING_OR_CHANGED_ORIGINAL_OCR_EXPORT')
    objects = {}
    for name in ('census','review','ocr','ocrAudit'):
        objects[name] = json.loads(pinned(root,page.get(name)))
        doc=objects[name]
        require(isinstance(doc,dict) and doc.get('scan')==scan and
                doc.get('sourceSha256',doc.get('source_sha256'))==source, 'ORIGINAL_PAGE_IDENTITY_MISMATCH')
    census,review,ocr,oa = (objects[n] for n in ('census','review','ocr','ocrAudit'))
    require(page['census']['sha256']!=page['review']['sha256'] and
            all(named(x.get('reviewedBy')) and x.get('wholePage') is True for x in (census,review)) and
            review.get('blindToOutput') is True,'INDEPENDENT_WHOLE_PAGE_REVIEW_REQUIRED')
    if census['reviewedBy'].strip()==review['reviewedBy'].strip():
        require(named(census.get('passId')) and named(review.get('passId')) and census['passId']!=review['passId'] and
                review.get('blindToCensus') is True,'INDEPENDENT_READING_PASS_REQUIRED')
    raw = ocr.get('rows')
    require(isinstance(raw,list) and [ocr.get('width'),ocr.get('height')]==list(size),'RAW_OCR_PAGE_INCOMPLETE')
    require(named(oa.get('reviewedBy')) and oa.get('rawSha256')==page['ocr']['sha256'] and
            type(oa.get('rowCount')) is int and oa['rowCount']==len(raw) and
            oa.get('rowsSha256')==rows_digest(raw),'RAW_OCR_ROWS_UNVERIFIED')
    rows=[]
    for j,row in enumerate(raw,1):
        ident=row.get('id',f's{scan:03}-r{j:03}')
        require(named(ident) and isinstance(row.get('text'),str) and valid_box(row.get('box'),size),'INVALID_RAW_OCR_ROW')
        rows.append(dict(row,id=ident))
    row_ids=[r['id'] for r in rows]
    require(ids(row_ids),'DUPLICATE_RAW_OCR_ROW')
    figures=census.get('figures');caps=census.get('captions');review_caps=review.get('captions')
    require(all(isinstance(x,list) for x in (figures,caps,review_caps)), 'WHOLE_PAGE_INVENTORY_MISSING')
    figids=[f['id'] for f in figures];capids=[c['id'] for c in caps]
    require(ids(figids+capids) and review.get('figureIds')==figids and [c.get('id') for c in review_caps]==capids,
            'INDEPENDENT_PAGE_COUNTS_OR_ORDER_DIFFER')
    for f in figures:
        require(valid_box(f.get('box'),size) and HEX.fullmatch(str(f.get('imageSha256'))) and
                ids(f.get('captionIds')), 'FIGURE_IDENTITY_OR_CAPTION_DISPOSITION_MISSING')
    for c,r in zip(caps,review_caps):
        require(valid_box(c.get('box'),size) and ids(c.get('figureIds')) and c['figureIds'] and
                c['figureIds']==r.get('figureIds') and ids(c.get('rowIds')) and
                set(c['rowIds'])<=set(row_ids),'CAPTION_SOURCE_OR_OWNERS_DIFFER')
        require(named(r.get('text')), 'INDEPENDENT_CAPTION_TEXT_MISSING')
        if not c['rowIds']:
            require(named(r.get('ocrOmissionReason')),'PRINTED_CAPTION_WITHOUT_OCR_REVIEW')
        c['text']=r['text']
        c['rubies']=readings(c['text'],r.get('rubies'))
    carrier=census.get('originalCarrier')
    require(carrier is None or isinstance(carrier,dict),'INVALID_ORIGINAL_CARRIER')
    for f in figures:
        if f.get('viaOriginal') is True:
            require(carrier is not None and f['imageSha256']==source,'INVALID_ORIGINAL_CARRIER')
    return dict(source=source,size=size,figures=figures,captions=caps,rows=rows,audit=oa,carrier=carrier)


def check_geometry(page, issue):
    """Review all generated flags; retain OCR-unseen print via the independent page lists."""
    figures,caps,rows=page['figures'],page['captions'],page['rows']
    if not figures and not caps:
        return
    decisions=page['audit'].get('decisions')
    require(isinstance(decisions,list),'OCR_CANDIDATE_DECISIONS_MISSING')
    by_id={r['id']:r for r in rows}
    fids={f['id'] for f in figures}
    by_cap={c['id']:c for c in caps}
    decided={}
    for d in decisions:
        pair=(d.get('figureId'),d.get('rowId'))
        disp=d.get('disposition')
        require(pair not in decided and pair[0] in fids and pair[1] in by_id and named(d.get('reason')) and
                disp in ('caption','body','other','duplicate'),'INVALID_CANDIDATE_DECISION')
        if disp=='caption':
            c=by_cap.get(d.get('captionId'))
            require(c and pair[0] in c['figureIds'] and pair[1] in c['rowIds'],'CANDIDATE_CAPTION_BINDING_DIFFERS')
        if disp=='body':
            require(all(pair[1] not in c['rowIds'] for c in caps),'CANDIDATE_BODY_CAPTION_CONFLICT')
        decided[pair]=disp
    # A shared legend is already independently assigned to all figures. Generate
    # geometric candidates once and keep the source IDs intact across the pair.
    primary={f['id']:[] for f in figures}
    for c in caps:
        local=next((f for f in c['figureIds'] if f in primary),None)
        if local: primary[local].extend(c['rowIds'])
    claimed={row for seq in primary.values() for row in seq}
    # Check unassigned horizontal lines along every illustration's edges as well
    # as the source's identified caption rows. All raw rows remain available for
    # initials and short tails even if their orientation was classified as body.
    rectangles=[{'bbox':f['box']} for f in figures]
    def candidate(row):
        x,y,X,Y=row['box']
        if (not row['text'].strip() or X-x<1.5*(Y-y) or row.get('kind','').startswith('block_')):
            return False
        area=(X-x)*(Y-y)
        inside=any(max(0,min(X,b[2])-max(x,b[0]))*max(0,min(Y,b[3])-max(y,b[1]))>=.5*area
                   for b in (f['bbox'] for f in rectangles))
        return not inside and any(figure_distance(row,f)<=4.4 for f in rectangles)
    geo=inspect_input(dict(width=page['size'][0],height=page['size'][1], figures=rectangles,
                           rows=[r for r in rows if r['id'] in claimed or candidate(r)],sourceRows=rows,
                           existingCaptionRows=list(primary.values())))
    for ordinal,group in geo['candidates'].items():
        fig=figures[int(ordinal)]['id']
        for row in group:
            if row not in claimed and (fig,row) not in decided:
                issue('UNREVIEWED_CAPTION_ROW',figureId=fig,rowId=row)
    for cand in geo.get('endingCandidates',[]):
        fig=figures[cand['figure']]['id']
        if (fig,cand['row']) not in decided:issue('UNREVIEWED_CAPTION_ENDING',figureId=fig,rowId=cand['row'])
    for cand in geo.get('initialCandidates',[]):
        fig=figures[cand['figure']]['id']
        for row in cand['fragments']:
            if (fig,row) not in decided:issue('UNREVIEWED_CAPTION_INITIAL',figureId=fig,rowId=row)
    # Special geometry flags with no single row need a source-side recorded decision.
    handled=page['audit'].get('reviewedFlags',[])
    require(isinstance(handled,list),'INVALID_GEOMETRY_REVIEW')
    resolved={r.get('flag') for r in handled if isinstance(r,dict) and named(r.get('reason'))}
    for flag in geo.get('reviewFlags',[]):
        if flag in {'caption-ending-review','empty-source-rows'}:continue
        if flag=='caption-initial-review' and all(c['fragments'] for c in geo.get('initialCandidates',[])):continue
        if flag not in resolved:issue('UNREVIEWED_GEOMETRY_FLAG',flag=flag)


def actual_groups(page, root, src):
    require(page.get('sourceSha256')==src and isinstance(page.get('painted'),list) and
            isinstance(page.get('unhandled'),list) and not {'figure','caption','ruby'}.intersection(page['unhandled']),
            'CAPTION_RENDER_ENUMERATION_INCOMPLETE')
    captures=page.get('captures')
    require(isinstance(captures,list) and captures,'CAPTION_RENDER_CAPTURE_MISSING')
    captured_pages=set()
    for ref in captures:
        require(min(dimensions(pinned(root,ref)))>0,'CAPTION_RENDER_CAPTURE_MISSING')
        position=ref.get('page')
        if position is None:
            matched=re.fullmatch(r'(\d+)-page-(\d+)(?:-figure-\d+)?\.png',Path(ref['path']).name)
            if matched and int(matched[1])==page['scan']:position=int(matched[2])
        if type(position) is int and position>=0:captured_pages.add(position)
    require(captured_pages,'CAPTURE_PAGE_IDENTITY_MISSING')
    out={};seen=set()
    for r in page['painted']:
        key=r['key']
        require(key not in seen,'DUPLICATE_RENDERED_SLOT')
        seen.add(key)
        if r['scope'] not in ('figure','caption'):continue
        positions=r.get('pageIndexes')
        require(isinstance(positions,list) and positions and all(type(i) is int and i in captured_pages for i in positions),
                'READBACK_REFERENCES_UNCAPTURED_SCREEN')
        value=r['value']
        if m:=FIG.fullmatch(key):
            group='figure-'+m[1];kind='figure';slot=int(m[2])
        elif m:=SINGLE.fullmatch(key):
            group='figure-'+m[1];kind='figure';slot=0
        elif m:=IMAGE.fullmatch(key):
            group='image-'+m[1];kind='figure';slot=0
        elif m:=CAP.fullmatch(key):
            group='figure-'+m[1];kind='caption';slot=0
        elif m:=IMAGE_CAP.fullmatch(key):
            group='image-'+m[1];kind='caption';slot=0
        elif m:=LABEL.fullmatch(key):
            group='figure-'+m[1];kind='label';slot=int(m[2])
        else:
            raise EvidenceError('UNRECOGNIZED_CAPTION_OR_FIGURE_SLOT')
        g=out.setdefault(group,dict(key=group,figures=[],captions=[],labels={},legible=[],labelLegibility={},imageDisplays=[]))
        if kind=='figure':
            require(r['scope']=='figure' and HEX.fullmatch(str(value.get('sha256'))) and slot==len(g['figures']),
                    'RENDERED_FIGURE_IDENTITY_OR_ORDER_DIFFERS')
            g['figures'].append(value['sha256'])
            g['imageDisplays'].append(r.get('imageDisplay'))
        else:
            text=value.get('text')
            require(r['scope']=='caption' and isinstance(text,str),'INVALID_DISPLAYED_CAPTION')
            ruby=readings(text,r.get('rubies'))
            offset=0;pages=[]
            for frag in r.get('fragments',[]):
                require(type(frag['start']) is int and type(frag['end']) is int and frag['start']==offset and frag['end']>=offset and
                        type(frag['page']) is int and (not pages or frag['page']>pages[-1]),'CAPTION_DISPLAY_FRAGMENT_GAP_OR_OVERLAP')
                offset=frag['end'];pages.append(frag['page'])
            require(pages and pages==r.get('pageIndexes') and offset==len(text),'CAPTION_DISPLAY_FRAGMENT_GAP_OR_OVERLAP')
            vis=value.get('captionVisibility')
            measured=vis.get('fragments') if isinstance(vis,dict) else None
            visible=(isinstance(vis,dict) and vis.get('fullyVisible') is True and isinstance(measured,list) and
                     len(measured)==len(pages) and all(isinstance(w,dict) and w.get('page')==f['page'] and
                     w.get('fullyVisible') is True and type(w.get('glyphs')) is int and
                     (w['glyphs']>0 or not text[f['start']:f['end']].strip())
                     for w,f in zip(measured,r['fragments'])))
            if kind=='label':
                g['labels'][slot]=(text,ruby)
                g['labelLegibility'][slot]=visible
            elif text or ruby:
                g['captions'].append((text,ruby));g['legible'].append(visible)
    return list(out.values())


def concat_fields(fields):
    text='';rubies=[]
    for value,annotations in fields:
        offset=len(text)
        rubies.extend((a+offset,b+offset,base,reading) for a,b,base,reading in annotations)
        text+=value
    return text,rubies


def audit(index_path, *, book_id, scan_range, source_hashes=None, readbacks=None,
          archive_sha256=None, artifact_sha256=None, index_sha256=None, ocr_hashes=None, page_issues=None):
    low,high=scan_range
    require(type(low) is int and type(high) is int and 0<low<=high,'INVALID_BOOK_RANGE')
    issues={n:[] for n in range(low,high+1)}
    def issue(scan,code,**details):
        record={'code':code,**details}
        if scan in issues and record not in issues[scan]:issues[scan].append(record)
    def each(code):
        for n in issues:issue(n,code)
    doc={};srcs={};rows=defaultdict(list);original_ocr={};requested=(low,high)
    if index_path is None:each('MISSING_CAPTION_CENSUS')
    else:
        try:
            path=Path(index_path)
            raw=path.read_bytes()
            require(index_sha256 is None or sha(raw)==index_sha256,'CAPTION_INDEX_HASH_MISMATCH')
            doc=json.loads(raw)
            extent=doc.get('range')
            require(doc.get('schema')=='reader-caption-census-v1' and doc.get('bookId')==book_id and
                    isinstance(extent,list) and len(extent)==2 and all(type(z) is int for z in extent) and
                    0<extent[0]<=extent[1] and extent[0]<=high and low<=extent[1] and
                    isinstance(doc.get('pages'),list),'WRONG_CAPTION_CENSUS')
            # Verify all supplied pages, including any referenced by an illustration
            # across the batch boundary. Missing requested pages remain in the queue.
            index_start,index_end=extent
            issues.update({n:[] for n in range(index_start,index_end+1)})
            if doc.get('originalOcrSources'):
                origin=json.loads(pinned(path.parent,doc['originalOcrSources']))
                require(origin.get('schema')=='reader-caption-ocr-origin-v1' and origin.get('bookId')==book_id and
                        origin.get('range')==extent and isinstance(origin.get('pages'),list),'WRONG_ORIGINAL_OCR_MANIFEST')
                origin_scans=set()
                for original in origin['pages']:
                    n=original['scan']
                    require(type(n) is int and index_start<=n<=index_end,'OUT_OF_RANGE_ORIGINAL_OCR_MANIFEST')
                    if n in origin_scans:
                        issue(n,'DUPLICATE_ORIGINAL_OCR_EXPORT')
                        continue
                    origin_scans.add(n)
                    source_sha,raw_sha=original.get('sourceSha256'),original.get('rawSha256')
                    if not (HEX.fullmatch(str(source_sha)) and HEX.fullmatch(str(raw_sha))):
                        issue(n,'MISSING_OR_CHANGED_ORIGINAL_OCR_EXPORT')
                        continue
                    original_ocr[n]=(source_sha,raw_sha)
            for p in doc['pages']:
                require(isinstance(p,dict) and type(p.get('scan')) is int and index_start<=p['scan']<=index_end,
                        'OUT_OF_RANGE_SOURCE_PAGE')
                rows[p['scan']].append(p)
        except (ValueError,OSError,KeyError,TypeError,AttributeError) as exc:each(str(exc) if isinstance(exc,EvidenceError) else 'INVALID_CAPTION_CENSUS')
    for n,entries in rows.items():
        try:
            require(len(entries)==1,'DUPLICATE_SOURCE_PAGE')
            if ocr_hashes is not None:
                external=ocr_hashes.get(n,ocr_hashes.get(str(n)))
                require(external and (n not in original_ocr or external==original_ocr[n][1]),'EXTERNAL_OCR_HASH_DIFFERS')
                original_ocr[n]=((entries[0].get('source') or {}).get('sha256'),external)
            srcs[n]=source_page(path.parent,entries[0],source_hashes,original_ocr)
            check_geometry(srcs[n],lambda code,**details:issue(n,code,**details))
        except (ValueError,OSError,KeyError,TypeError,AttributeError,IndexError) as exc:
            issue(n,str(exc) if isinstance(exc,EvidenceError) else 'INVALID_SOURCE_EVIDENCE')
    for n in issues:
        if n not in rows and not issues[n]:issue(n,'MISSING_SOURCE_PAGE')
    figures={};captions={};origins=defaultdict(list)
    for n,p in srcs.items():
        for name,dest in [('figures',figures),('captions',captions)]:
            for r in p[name]:
                origins[r['id']].append(n)
                dest[r['id']]=(n,r)
    for ident,scans in origins.items():
        if len(scans)>1:
            for n in scans:issue(n,'DUPLICATE_SOURCE_ID',id=ident)
    order={c['id']:(scan,i) for scan,p in srcs.items() for i,c in enumerate(p['captions'])}
    for ident,(n,f) in figures.items():
        known=[c for c in f['captionIds'] if c in order]
        if sorted(known,key=order.get)!=known:issue(n,'PRINTED_CAPTION_ORDER_DIFFERS',id=ident)
        for c in f['captionIds']:
            if c not in captions or ident not in captions[c][1]['figureIds']:issue(n,'FIGURE_CAPTION_BINDING_DIFFERS',id=c)
    for ident,(n,c) in captions.items():
        for f in c['figureIds']:
            if f not in figures or ident not in figures[f][1]['captionIds']:issue(n,'CAPTION_FIGURE_BINDING_DIFFERS',id=f)
    observed_artifacts=set()
    for route in ('part','shelf'):
        measured=defaultdict(list)
        for filename,receipt in (readbacks or {}).get(route,[]):
            extent=receipt.get('range') if isinstance(receipt,dict) else None
            known_range=(isinstance(extent,list) and len(extent)==2 and all(type(v) is int for v in extent)
                         and 0<extent[0]<=extent[1])
            affected=[n for n in srcs if not known_range or extent[0]<=n<=extent[1]]
            try:
                require(receipt.get('schema')=='reader-proof-readback-v1' and receipt.get('bookId')==book_id and
                        receipt.get('route')==route and isinstance(receipt.get('pages'),list) and
                        known_range,'WRONG_READBACK')
                require(HEX.fullmatch(str(receipt.get('artifactSha256'))) and
                        (archive_sha256 is None or receipt.get('archiveSha256')==archive_sha256),'WRONG_READBACK_VERSION')
                for obs in receipt['pages']:
                    n=obs['scan']
                    require(type(n) is int and extent[0]<=n<=extent[1],'WRONG_READBACK_RANGE')
                    if n in srcs:
                        measured[n].append((Path(filename).parent,obs))
                    if requested[0]<=n<=requested[1]:
                        observed_artifacts.add(receipt['artifactSha256'])
            except (ValueError,KeyError,TypeError,AttributeError):
                for n in affected:issue(n,'INVALID_READBACK',route=route)
        seen_captions=Counter()
        for n,src in srcs.items():
            try:
                require(len(measured[n])==1,'MISSING_OR_DUPLICATE_ROUTE_OBSERVATION')
                folder,obs=measured[n][0]
                groups=actual_groups(obs,folder,src['source'])
                remaining=list(src['figures']);carrier_seen=False
                for g in groups:
                    carrier=(src['carrier'] is not None and g['key'].startswith('image-') and g['figures']==[src['source']])
                    if carrier:
                        require(not carrier_seen,'DUPLICATE_ORIGINAL_CARRIER')
                        carrier_seen=True
                        fields=g['captions']
                        label=src['carrier'].get('displayLabel')
                        require(fields==([(label,[])] if label else []),'ORIGINAL_CARRIER_LABEL_DIFFERS')
                        fs=[f for f in src['figures'] if f.get('viaOriginal') is True]
                        if fs:
                            im=g['imageDisplays'][0]
                            require(isinstance(im,dict) and im.get('fullyVisible') is True and
                                    (im.get('naturalWidth'),im.get('naturalHeight'))==src['size'],
                                    'ORIGINAL_CARRIER_FIGURES_NOT_FULLY_VISIBLE')
                            require(remaining[:len(fs)]==fs,'ORIGINAL_CARRIER_FIGURE_ORDER_DIFFERS')
                            del remaining[:len(fs)]
                        # Printed legends embedded in an original image remain open
                        # until text/ruby readback is independently measured.
                        require(all(not f['captionIds'] for f in fs),'ORIGINAL_ONLY_CAPTION_NEEDS_READBACK')
                        continue
                    count=len(g['figures']);fs=remaining[:count];del remaining[:count]
                    require(fs and g['figures']==[f['imageSha256'] for f in fs] and
                            all(f.get('viaOriginal') is not True for f in fs),'EXTRA_MISSING_OR_REORDERED_FIGURE')
                    printed_labels=set()
                    for i,f in enumerate(fs):
                        caplist=f.get('labelCaptionIds',[])
                        require(ids(caplist) and set(caplist)<=set(f['captionIds']),'INVALID_INDIVIDUAL_FIGURE_LABEL')
                        if not caplist:continue
                        fields=[]
                        for c in caplist:
                            require(c in captions and captions[c][1]['figureIds']==[f['id']],
                                    'PRINTED_LABEL_ATTACHED_TO_WRONG_FIGURE')
                            fields.append((captions[c][1]['text'],captions[c][1]['rubies']))
                        require(g['labels'].get(i)==concat_fields(fields),'INDIVIDUAL_FIGURE_CAPTION_DIFFERS')
                        require(g['labelLegibility'].get(i) is True,'CAPTION_VISIBILITY_UNVERIFIED')
                        seen_captions.update(caplist);printed_labels.update(caplist)
                    for i,(label,ruby) in g['labels'].items():
                        require(i<len(fs) and (fs[i].get('labelCaptionIds') or
                                (not ruby and label==fs[i].get('displayLabel','図版'))),'UNREVIEWED_FIGURE_LABEL')
                    owners=[f['id'] for f in fs]
                    capids=list(dict.fromkeys(c for f in fs for c in f['captionIds'] if c not in printed_labels))
                    expected=[]
                    for c in capids:
                        require(c in captions,'MISSING_CAPTION_SOURCE')
                        cap=captions[c][1]
                        require(cap['figureIds']==owners, 'RENDERED_CAPTION_ATTACHED_TO_WRONG_FIGURES')
                        expected.append((cap['text'],cap['rubies']))
                    # Adjacent printed continuations can be laid out in a single
                    # stream. Check every character and rebase every ruby range.
                    if len(expected)>1 and len(g['captions'])==1:
                        expected=[concat_fields(expected)]
                    require(g['captions']==expected,'CAPTION_TEXT_RUBY_ORDER_OR_COUNT_DIFFERS')
                    require(all(g['legible']),'CAPTION_VISIBILITY_UNVERIFIED')
                    seen_captions.update(capids)
                require(not remaining,'EXTRA_MISSING_OR_REORDERED_FIGURE')
                require(src['carrier'] is None or carrier_seen,'MISSING_ORIGINAL_CARRIER')
            except (ValueError,OSError,KeyError,TypeError,AttributeError,IndexError) as exc:
                issue(n,str(exc) if isinstance(exc,EvidenceError) else 'INVALID_RENDER_EVIDENCE',route=route)
        for c,(n,_) in captions.items():
            if seen_captions[c]!=1:issue(n,'CAPTION_MISSING_OR_DUPLICATE_IN_READER',id=c,route=route)
    if artifact_sha256 is not None and artifact_sha256 not in observed_artifacts:each('ARTIFACT_HASH_NOT_OBSERVED')
    for scan,codes in (page_issues or {}).items():
        for code in sorted(codes):issue(scan,code)
    links=defaultdict(set)
    for c,(n,cap) in captions.items():
        for f in cap['figureIds']:
            if f in figures:
                other=figures[f][0]
                if other!=n:links[n].add(other);links[other].add(n)
    queue=[n for n,i in issues.items() if i]
    for n in queue:
        for other in sorted(links[n]):
            if not issues[other]:
                issue(other,'LINKED_CAPTION_REVIEW_PENDING',scanNumber=n)
                queue.append(other)
    low,high=requested
    pages=[dict(scan=n,status='partial' if issues[n] else 'complete',issues=issues[n]) for n in range(low,high+1)]
    for page in pages:
        if page['status']=='complete':
            source=srcs[page['scan']]
            page.update(checkedFigures=len(source['figures']),checkedCaptions=len(source['captions']))
    pending=[p['scan'] for p in pages if p['issues']]
    batches=[]
    for start in range(low,high+1,20):
        end=min(start+19,high);remaining=[n for n in pending if start<=n<=end]
        batches.append(dict(range=[start,end],status='partial' if remaining else 'complete',pendingScans=remaining))
    return dict(schema='reader-caption-census-report-v1',bookId=book_id,range=[low,high],
                status='partial' if pending else 'complete',pendingScans=pending,pages=pages,batches=batches)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--index',type=Path,required=True);p.add_argument('--book-id',required=True)
    p.add_argument('--start',type=int,required=True);p.add_argument('--end',type=int,required=True)
    for route in ('part','shelf'):p.add_argument('--'+route+'-readback',type=Path,action='append',default=[])
    p.add_argument('--source-hashes',type=Path);p.add_argument('--ocr-hashes',type=Path)
    for name in ('archive-sha256','artifact-sha256','index-sha256'):p.add_argument('--'+name)
    args=p.parse_args()
    readbacks={r:[(f,json.loads(f.read_bytes())) for f in getattr(args,r+'_readback')] for r in ('part','shelf')}
    result=audit(args.index,book_id=args.book_id,scan_range=(args.start,args.end),readbacks=readbacks,
                 ocr_hashes=json.loads(args.ocr_hashes.read_bytes()) if args.ocr_hashes else None,
                 source_hashes=json.loads(args.source_hashes.read_bytes()) if args.source_hashes else None,
                 archive_sha256=args.archive_sha256,artifact_sha256=args.artifact_sha256,index_sha256=args.index_sha256)
    print(json.dumps(result,ensure_ascii=False,indent=2))
    return 0 if result['status']=='complete' else 2


if __name__=='__main__':
    raise SystemExit(main())
