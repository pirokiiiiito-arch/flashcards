"""Observe WH1 originals in the real reading frame without using the review transcription.

Optional --locations maps scan -> census region ID -> {key,start?,end?} where key is
block-<scan-local sourceRef>, caption-<index>, figure-<group>-<tab>, or <key>/ruby-<index>.
An ornament between two retained blocks uses {before,after,beforeLength,afterLength}.
All offsets are Unicode code points. Otherwise census ID is used as the output key.
"""
import argparse
import functools
import hashlib
import http.server
import json
import threading
from pathlib import Path
from urllib.parse import unquote, urlsplit
from zipfile import ZipFile
from reader_shelf_probe import Reader, SEED

SCOPES = ('body','heading','figure','caption','note','ruby','toc','other')
HOST = ('read.html','read-wh1-v9.html','wh1-caption-ruby.js','storage.js','wh1-reader-routing.js',
        'wh1-pager-v9.js','wh1-figure-viewport-v9.js','wh1-display-check-v9.js','wh1-exact-pagination.js',
        'shelf-registration.mjs','app.js')
sha = lambda data: hashlib.sha256(data).hexdigest()


class ArchiveServer(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        name = unquote(urlsplit(self.path).path)
        if name.startswith('/__member/'):
            member = name[len('/__member/'):]
            if member not in self.server.allowed:
                self.send_error(404); return
            with ZipFile(self.server.archive) as z:
                data = z.read(member)
            self.send_response(200)
            self.send_header('Content-Type', self.guess_type(member) + ('; charset=utf-8' if member.endswith('.html') else ''))
            self.send_header('Content-Length', str(len(data)))
            self.end_headers(); self.wfile.write(data)
        else:
            super().do_GET()

    def translate_path(self, path):
        if urlsplit(path).path == '/__qa_archive':
            return str(self.server.archive)
        return super().translate_path(path)

    def log_message(self, *args):
        pass


def normalize(raw, census, locations, originals=None):
    """Select by slots and coordinates, keep output order and report unclaimed visible content."""
    rows = {r['key']:r for r in raw['rows']}
    order = {k:n for n,k in enumerate(rows)}
    rubies = {}
    for key,row in rows.items():
        for n,ruby in enumerate(row.get('rubies', [])):
            rubies[f'{key}/ruby-{n}'] = (key,ruby)
    match = []; owners = {}; consumed = {}; claimed_rubies = set()
    def emit(position, ident, scope, value, **extra):
        match.append((position,{'id':ident,'scope':scope,'value':value,**extra}))
    for region in census['regions']:
        ident,scope = region['id'],region['scope']
        loc = locations.get(ident,{'key':ident}); key=loc.get('key')
        original=(originals or {}).get(ident)
        illegible=region.get('illegible') is True
        if illegible and not original:continue
        if illegible and 'noteKey' in loc:
            note=loc['noteKey']
            if note not in rows or rows[note]['scope']!='note':continue
            text=rows[note]['value']['text']
            emit((order[note],0,0),ident,scope,{'originalSha256':original['imageSha256'],'box':original['box']},
                 originalObservation=original,legibilityDisplay={'kind':'note','text':text})
            consumed[note]=[(0,len(text))]
        elif 'before' in loc and 'after' in loc:
            left,right=loc['before'],loc['after']
            if left not in rows or right not in rows or order[left]>=order[right]: continue
            a,b=loc['beforeLength'],loc['afterLength']
            if type(a) is not int or type(b) is not int or min(a,b)<1:raise ValueError('Invalid ornament window')
            left_text=rows[left]['value'].get('text','')[-a:];right_text=rows[right]['value'].get('text','')[:b]
            middle=[r for k,r in rows.items() if order[left]<order[k]<order[right]]
            # An intervening figure is evidence too, even when it has no text.
            window=left_text+''.join(r['value'].get('text','\uFFFC') for r in middle)+right_text
            if illegible:
                emit((order[left]+0.9,0,0),ident,scope,{'originalSha256':original['imageSha256'],'box':original['box']},
                     originalObservation=original,legibilityDisplay={'kind':'source-only','before':left_text,'after':right_text,'observedWindow':window})
            else:
                emit((order[left]+0.9,0,0),ident,'other',{'disposition':'source-only','before':left_text,'after':right_text},observedWindow=window)
        elif not illegible and key in rows and rows[key]['scope']==scope:
            value=dict(rows[key]['value']);start=loc.get('start',0);end=loc.get('end')
            if 'text' in value:
                full=value['text'];end=len(full) if end is None else end
                if type(start) is not int or type(end) is not int or not 0<=start<end<=len(full): continue
                value['text']=full[start:end];consumed.setdefault(key,[]).append((start,end))
                owners.setdefault(key,[]).append((start,end,ident))
            else:consumed[key]=[(0,1)]
            emit((order[key],start,0),ident,scope,value)
    for region in census['regions']:
        ident=region['id']; key=locations.get(ident,{'key':ident}).get('key')
        if region['scope']!='ruby' or key not in rubies:continue
        parent,r=rubies[key]
        options=[p for p in owners.get(parent,[]) if p[0]<=r['start'] and r['end']<=p[1]]
        if len(options)!=1:continue
        start,_,pid=options[0]
        emit((order[parent],r['start'],1),ident,'ruby',dict(base=r['base'],reading=r['reading'],start=r['start']-start,end=r['end']-start,parent=pid))
        claimed_rubies.add(key)
    # A complete scope requires bidirectional enumeration. Include unmatched
    # rows, annotation slots and uncovered intervals, so the independent gate sees them.
    complete = set(census.get('completeScopes',[])) - set(raw['unknown'])
    if not raw['pageIndexes']: complete.clear()
    for key,row in rows.items():
        scope=row['scope']
        if scope not in complete:continue
        ranges=sorted(consumed.get(key,[]));size=len(row['value'].get('text','x'))
        cursor=0
        for start,end in ranges+[(size,size)]:
            if start>cursor:
                value=dict(row['value'])
                if 'text' in value:value['text']=value['text'][cursor:start]
                emit((order[key],cursor,0),f'unmapped/{key}/{cursor}',scope,value)
            if start<cursor:complete.discard(scope)
            cursor=max(cursor,end)
    if 'ruby' in complete:
        for key,(parent,r) in rubies.items():
            if key not in claimed_rubies:
                emit((order[parent],r['start'],1),'unmapped/'+key,'ruby',{k:v for k,v in r.items() if k!='page'}|{'parent':parent})
    return [r for _,r in sorted(match,key=lambda item:item[0])], [s for s in SCOPES if s in complete]


def checked_census(folder, page):
    ref=page['census'];file=(folder/ref['path']).resolve()
    if folder.resolve() not in file.parents:raise ValueError('Census path outside inventory')
    data=file.read_bytes()
    if sha(data)!=ref['sha256']:raise ValueError('Census SHA mismatch')
    return json.loads(data)


def open_shelf(page, url, book, root):
    page.goto(url+'/reader/library/manifest.webmanifest',wait_until='commit')
    page.evaluate(SEED,[book['bookId'],book['title'],root])
    page.goto(url+'/reader/library/read.html?id='+book['bookId'],wait_until='domcontentloaded')
    page.wait_for_url('**/read-wh1-v9.html?id='+book['bookId'])
    return Reader(page,book,{})


def observe_original(page, scan, regions, source, images, out):
    """Read the actual original-mode <img>, positioning each source rectangle onscreen."""
    page.evaluate('n=>openOriginal(n)',scan)
    modal=page.locator('#originalOverlay');modal.wait_for(state='visible')
    img=modal.locator('#originalImage')
    observed=img.evaluate("""async img=>{
        await img.decode();
        const bytes=await(await fetch(img.currentSrc)).arrayBuffer();
        const hash=await crypto.subtle.digest('SHA-256',bytes);
        return {sha:[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join(''),
                dimensions:[img.naturalWidth,img.naturalHeight],title:document.querySelector('#originalTitle').textContent};
    }""")
    width,height=observed['dimensions']
    if observed['sha']!=source or not observed['title'].startswith(f'原本スキャン {scan} /') or min(width,height)<1:
        raise ValueError('The actual reader opened a different original scan')
    observations={}
    for ordinal,r in enumerate(regions):
        x,y,X,Y=r['box']
        if not(0<=x<X<=width and 0<=y<Y<=height):raise ValueError('Original region outside displayed image')
        projected=img.evaluate("""async (img,box)=>{
          const viewer=document.getElementById('originalViewer');
          function rect(){
            const b=img.getBoundingClientRect(),sx=b.width/img.naturalWidth,sy=b.height/img.naturalHeight;
            return [b.left+box[0]*sx,b.top+box[1]*sy,b.left+box[2]*sx,b.top+box[3]*sy];
          }
          const v=viewer.getBoundingClientRect(),r=rect();
          viewer.scrollBy((r[0]+r[2]-v.left-v.right)/2,(r[1]+r[3]-v.top-v.bottom)/2);
          await new Promise(requestAnimationFrame);
          const t=rect(),top=Math.max(v.top,0),bottom=Math.min(v.bottom,innerHeight);
          if(t[0]<Math.max(0,v.left)-1 || t[2]>Math.min(innerWidth,v.right)+1 || t[1]<top-1 || t[3]>bottom+1)return null;
          return t;
        }""",r['box'])
        if projected is None:continue
        file=images/f'{scan:03}-original-{ordinal:03}.png';data=page.screenshot(path=str(file))
        observations[r['id']]=dict(mode='reader-original',route='shelf',scan=scan,imageSha256=source,box=r['box'],
                                   dimensions=[width,height],screenBox=projected,capture=dict(path=file.relative_to(out.parent).as_posix(),sha256=sha(data)))
    page.locator('#originalClose').click()
    return observations


def capture(args):
    from playwright.sync_api import sync_playwright
    inventory=json.loads(args.inventory.read_bytes()); locations=json.loads(args.locations.read_bytes()) if args.locations else {}
    out=args.out.resolve();out.parent.mkdir(parents=True,exist_ok=True)
    images=out.parent/(out.stem+'-captures');images.mkdir(exist_ok=True)
    site=args.site.resolve();archive=args.archive.resolve()
    runner=Path(__file__).with_suffix('.js').read_text()
    root=hashlib.sha256()
    with archive.open('rb') as f:
        archive_digest=hashlib.file_digest(f,'sha256').hexdigest();f.seek(0)
        while chunk:=f.read(4*1024*1024):root.update(hashlib.sha256(chunk).digest())
    with ZipFile(archive) as z:
        m=json.loads(z.read('manifest.json'))
        if m['bookId']!=inventory['bookId'] or list(inventory['range'])!=[args.start,args.end]:raise ValueError('Wrong book or range')
        segment=next(s for s in m['segments'] if [s['start'],s['end']]==[args.start,args.end])
        member=segment['part'] if args.route=='part' else segment['display']['path']
        part_sha=sha(z.read(member))
        if part_sha!=(segment['sha256'] if args.route=='part' else segment['display']['sha256']):raise ValueError('Wrong member SHA')
        sources={p['scan']:sha(z.read(m['originalScans'][str(p['scan'])]['path'])) for p in inventory['pages']}
    report=dict(schema='reader-proof-readback-v1',bookId=m['bookId'],range=[args.start,args.end],artifactSha256=part_sha,
                member=member,archiveSha256=archive_digest,route=args.route,pages=[],viewport=[390,700],font=20)
    if args.route=='shelf':report['hostFiles']={'reader/library/'+p:sha((site/'reader/library'/p).read_bytes()) for p in HOST}
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(ArchiveServer,directory=site))
    server.archive=archive;server.allowed={segment['part']}|{a['path'] for a in segment['assets'].values()}
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        url=f'http://127.0.0.1:{server.server_port}'
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path=str(args.chromium.resolve()),args=['--single-process','--no-zygote','--no-sandbox','--disable-dev-shm-usage','--disable-gpu'])
            ctx=browser.new_context(viewport=dict(width=390,height=700),is_mobile=True,has_touch=True,locale='ja-JP',service_workers='block')
            page=ctx.new_page();page.set_default_timeout(45000)
            original_page=None
            if args.route=='shelf':
                reader=open_shelf(page,url,m,root.hexdigest())
                original_page=page
            else:
                page.goto(url+'/__member/'+segment['part'])
                page.evaluate("""async assets=>{const list=await Promise.all(Object.entries(assets).map(async ([name,a])=>({name,mime:a.mime,data:await(await fetch('/__member/'+a.path)).arrayBuffer()})));window.postMessage({wh1bridge:1,action:'loadAssets',size:20,assets:list},'*');}""",segment['assets'])
                page.wait_for_function('WH1BookReader.inspect().originalReady&&WH1BookReader.inspect().pages>0')
            for p in inventory['pages']:
                scan=p['scan'];census=checked_census(args.inventory.parent,p);source=sources[scan]
                if not (source==p['image']['sha256']==census['sourceSha256'] and scan==census['scan']):raise ValueError('Wrong original')
                frame=reader.open(scan) if args.route=='shelf' else page.main_frame
                raw=frame.evaluate(runner,scan)
                captures=[]
                for ix in raw['pageIndexes']:
                    frame.evaluate('i=>WH1BookReader.gotoPage(i)',ix)
                    frame.wait_for_function('i=>WH1BookReader.inspect().index===i&&!WH1BookReader.inspect().paintPending',arg=ix)
                    tabs=frame.locator('#reader-page .figure-bundle-tabs button')
                    count=tabs.count()
                    for tab in range(max(1,count)):
                        if count:tabs.nth(tab).click()
                        frame.evaluate("async()=>{await document.fonts.ready;await Promise.all([...document.querySelectorAll('#reader-page img')].map(i=>i.decode()));await new Promise(requestAnimationFrame);}")
                        suffix=f'-figure-{tab}' if count else ''
                        file=images/f'{scan:03}-page-{ix:03}{suffix}.png';data=page.screenshot(path=str(file))
                        captures.append(dict(path=file.relative_to(out.parent).as_posix(),sha256=sha(data)))
                scan_locations=locations.get(str(scan),{})
                illegibles=[r for r in census['regions'] if r.get('illegible') is True and
                           ('noteKey' in scan_locations.get(r['id'],{}) or
                            {'before','after'} <= set(scan_locations.get(r['id'],{})))]
                originals={}
                if illegibles:
                    if original_page is None:
                        original_page=ctx.new_page()
                        reader=open_shelf(original_page,url,m,root.hexdigest())
                        report['originalHostFiles']={'reader/library/'+f:sha((site/'reader/library'/f).read_bytes()) for f in HOST}
                    reader.open(scan)
                    originals=observe_original(original_page,scan,illegibles,source,images,out)
                    captures.extend(o['capture'] for o in originals.values())
                regions,complete=normalize(raw,census,scan_locations,originals)
                report['pages'].append(dict(scan=scan,sourceSha256=source,completeScopes=complete,regions=regions,captures=captures,
                                            painted=raw['rows'],unhandled=raw['unknown']))
            browser.close()
    finally:
        server.shutdown();server.server_close()
    out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    return report


if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    for name in ('archive','inventory','site','chromium','out'):ap.add_argument('--'+name,type=Path,required=True)
    for name in ('start','end'):ap.add_argument('--'+name,type=int,required=True)
    ap.add_argument('--locations',type=Path);ap.add_argument('--route',choices=('shelf','part'),required=True)
    capture(ap.parse_args())
