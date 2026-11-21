"""Private browser measurements for the bookshelf's actual reader. No network publishing."""
import functools
import hashlib
import http.server
import json
import re
import threading
from pathlib import Path
from urllib.parse import quote, urlsplit



def check(condition, message):
    if not condition:
        raise ValueError(message)


def digest(value):
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,separators=(',',':'),sort_keys=True).encode()).hexdigest()


SEED = '''async ([id,title,root])=>{
 const blob=await fetch('/__qa_archive').then(r=>r.blob());
 const db=await new Promise((ok,bad)=>{const q=indexedDB.open('private-bookshelf-v1',1);q.onupgradeneeded=()=>{for(const name of ['books','chunks'])q.result.createObjectStore(name)};q.onsuccess=()=>ok(q.result);q.onerror=()=>bad(q.error)});
 const put=(store,key,v)=>new Promise((ok,bad)=>{const t=db.transaction(store,'readwrite');t.objectStore(store).put(v,key);t.oncomplete=ok;t.onabort=t.onerror=()=>bad(t.error)});
 const len=4*1024*1024;let count=0;for(let at=0;at<blob.size;at+=len)await put('chunks',id+'|qa|'+String(count++).padStart(6,'0'),blob.slice(at,at+len));
 await put('books',id,{id,title,generation:'qa',size:blob.size,count,registrationRoot:root});db.close();
}'''
API = '(window.StandardReader||window.NovelReader||window.WH1BookReader)'


def wait_painted(frame, index=None):
    frame.wait_for_function(
        'i=>{const s='+API+'?.inspect();return s&&s.pages>0&&!s.paintPending&&(i==null||s.index===i)}',
        arg=index)


def touch(page, cdp, start, end):
    def send(kind, points):
        cdp.send('Input.dispatchTouchEvent',{'type':kind,'touchPoints':[{'id':i,'x':x,'y':y,'radiusX':3,'radiusY':3} for i,(x,y) in enumerate(points)]})
    send('touchStart',start)
    page.wait_for_timeout(35)
    for i in range(1,13):
        send('touchMove',[(x+(xx-x)*i/12,y+(yy-y)*i/12) for (x,y),(xx,yy) in zip(start,end)])
        page.wait_for_timeout(12)
    send('touchEnd',[])
    page.wait_for_timeout(150)


def pinch(page,cdp,x,y,expand):
    a,b=(37,120) if expand else (120,22)
    touch(page,cdp,[(x-a,y),(x+a,y)],[(x-b,y),(x+b,y)])


def run_steps(page,reader,steps,scan):
    for step in steps:
        loc=(page if step.get('host') else reader).locator(step['selector'].replace('{scan}',str(scan)))
        action=step['action']
        value=str(step.get('value','')).replace('{scan}',str(scan))
        if action=='click':
            loc.click()
        elif action=='fill':
            loc.fill(value)
        elif action=='select':
            loc.select_option(value)
        elif action=='wait':
            loc.wait_for(state='visible')
        else:
            raise ValueError('Unsupported private UI action '+action)


def number(frame,spec):
    el=frame.locator(spec['selector'])
    text=el.get_attribute(spec['attribute']) if 'attribute' in spec else el.inner_text()
    match=re.search(spec.get('pattern',r'(\d+)'),text or '')
    check(match is not None, '画面のページ番号を読み取れません')
    return int(match.group(1))


class Reader:
    def __init__(self,page,manifest,reference):
        self.page=page
        self.manifest=manifest
        self.ref=reference
        self.ui=reference.get('ui',{})
        self.frame=None
        self.part=None

    def open(self,scan):
        p=self.page
        m=self.manifest
        segments=m.get('segments',[])
        if segments:
            p.wait_for_function('typeof openSegment==="function"&&!!bookZip')
            index=p.evaluate('n=>segmentForScan(n)',scan)
            if self.part!=index or p.evaluate('activeSegment')!=index:
                p.evaluate('x=>openSegment(x[0],{scan:x[1]})',[index,scan])
                self.part=index
            p.wait_for_function('i=>activeSegment===i&&pendingLoaded&&document.querySelector("#busy").hidden',arg=index)
            self.frame=p.locator('#reader').element_handle().content_frame()
        else:
            self.frame=p.main_frame
        if self.ui.get('frame'):
            self.frame=p.locator(self.ui['frame']).element_handle().content_frame()
        if self.ui.get('position'):
            run_steps(p,self.frame,self.ui.get('goto',[]),scan)
        else:
            self.frame.wait_for_function(API+'?.inspect().pages>0')
            self.frame.evaluate('n=>{const a='+API+';if(a.gotoScan)a.gotoScan(n)}',scan)
            wait_painted(self.frame)
        return self.frame

    def state(self):
        if self.ui.get('position'):
            return number(self.frame,self.ui['position']),number(self.frame,self.ui['scan'])
        x=self.frame.evaluate(API+'.inspect()')
        return x['index'],x['scan']

    def select(self,case,start,end):
        scan=case.get('scan',start)
        mode=case['mode']
        f=self.open(scan)
        if not self.ui.get('position'):
            ix=f.evaluate('''([lo,hi,scan,mode])=>{const a=window.StandardReader||window.NovelReader||window.WH1BookReader,pp=a.pageManifest();
             const candidates=pp.map((p,i)=>({p,i})).filter(({p,i})=>p.scan>=lo&&p.scan<=hi&&(mode==='figure'?p.kind==='image':mode==='text'?p.kind==='text':mode==='contents'&&window.WH1BookReader?p.kind==='contents':true));
             const right=candidates.filter(x=>x.p.scan===scan);let e=right.find(x=>x.i<pp.length-1)||right[0]||candidates.find(x=>x.i<pp.length-1)||candidates[0];if(!e)return -1;a.gotoPage(e.i);return e.i;}''',[start,end,scan,mode]);check(ix>=0,f'{start}-{end}: {mode} のページを特定できません')
            wait_painted(f,ix)
        run_steps(self.page,f,case.get('steps',[]),scan)
        if mode=='original' and not case.get('steps'):
            f.locator(self.ui.get('originalButton','#original')).click()
        defaults={'text':'#text-flow','figure':'#figure-stage .figure-frame','contents':'#text-flow','original':'#original-image'}
        surface=self.page if mode=='original' and self.ui.get('originalFrame')=='parent' else f
        target=surface.locator(case.get('selector') or self.ui.get(mode+'Selector') or defaults[mode])
        target.wait_for(state='visible')
        box=target.bounding_box()
        check(box and box['width']>0 and box['height']>0,'検査対象が画面にありません')
        x=max(125,min(265,box['x']+box['width']/2))
        y=max(50,min(760,box['y']+box['height']/2))
        check(box['x']<=x<=box['x']+box['width'] and box['y']<=y<=box['y']+box['height'],'ピンチ中心が対象の外です')
        if mode=='figure':
            target.tap()
            modal_frame=self.page if self.ui.get('originalFrame')=='parent' else f
            assert_modal=modal_frame.locator(self.ui.get('originalModal','#original-backdrop'))
            check(not assert_modal.is_visible(),'図版の単独タップが拡大画面を開きました')
        return x,y

    def probe(self,case,start,end,cdp):
        page=self.page
        mode=case['mode']
        x,y=self.select(case,start,end)
        before,observed=self.state()
        check(start<=observed<=end,'検査中の原本番号が分冊範囲と一致しません')
        view=lambda:page.evaluate('()=>[visualViewport.scale,visualViewport.offsetLeft,visualViewport.offsetTop]')
        initial=view()[0]
        pinch(page,cdp,x,y,True)
        zoom=view()[0]
        check(zoom>1.1 and self.state()==(before,observed),f'{start}-{end} {mode}: 2本指で画面全体を拡大できません')
        touch(page,cdp,[(190,400)],[(135,345)])
        xy=view()
        touch(page,cdp,[(190,400)],[(230,448)])
        back=view()
        dx=back[1]-xy[1]
        dy=back[2]-xy[2]
        check(abs(dx)>1 and abs(dy)>1 and self.state()==(before,observed),'拡大中の上下左右パンまたは読書位置が不正です')
        pinch(page,cdp,x,y,False)
        if view()[0]>1.04:
            pinch(page,cdp,x,y,False)
        final=view()[0]
        check(abs(initial-1)<.05 and abs(final-1)<.05 and self.state()==(before,observed),'元の倍率・ページに戻りません')
        up=down=0
        if mode=='original':
            steps=case.get('close') or self.ui.get('originalClose') or [{'action':'click','selector':'#original-close'}]
            run_steps(page,self.frame,steps,observed)
        elif not (self.ref.get('singleScreen') and self.ref['range'][0]==self.ref['range'][1]):
            # At a last screen test the preceding direction first, then return to the source screen.
            last=not self.ui.get('position') and self.frame.evaluate(API+'.inspect().index==='+API+'.inspect().pages-1')
            direction=1 if last else -1
            touch(page,cdp,[(190,400)],[(190,400+95*direction)])
            if not self.ui.get('position'):
                wait_painted(self.frame,before-direction)
            mid=self.state()[0]
            touch(page,cdp,[(190,400)],[(190,400-95*direction)])
            if not self.ui.get('position'):
                wait_painted(self.frame,before)
            after=self.state()[0]
            up,down=(after-mid,mid-before) if last else (mid-before,after-mid)
            check((up,down)==(1,-1) and self.state()==(before,observed),f'{start}-{end}: 等倍で1ページずつ往復しません')
        else:
            check(not self.ui.get('position') and self.frame.evaluate(API+'.inspect().pages')==1,'単画面の根拠がありません')
            touch(page,cdp,[(190,400)],[(190,305)])
            check(self.state()==(before,observed),'単画面でページが変わりました')
        return [mode,observed,initial,zoom,dx,dy,final,0,up,down]

    def measure_continuity(self, plan):
        if not plan or plan['route'] == 'without-prose':
            return {'route': plan['route'] if plan else 'existing-or-whole'}
        page = self.page
        if plan['route'] == 'merged-template-flow-v1':
            frame = self.open(self.manifest['range'][0])
            return trace_template(frame, plan)
        if plan['route'] == 'legacy-continuous':
            check(page.evaluate('!!bookZip.readingFlow'), '既存の全巻組版処理が選択されていません')
            return {'route': plan['route']}
        check(page.evaluate('!!bookZip.wh3Flow'), '書籍が分冊ごとの表示になっています')
        results = []
        for edge in plan['edges']:
            left, right = edge['from'], edge['to']
            frame = self.open(left[0])
            result = frame.evaluate("""([left,right])=>{
                const pageList=StandardReader.pageManifest(), entries=READER_BOOK.entries.filter(e=>e.kind==='text');
                const a=entries.findIndex(e=>e.blockKey===left.join('/')),b=entries.findIndex(e=>e.blockKey===right.join('/'));
                if(a<0||b!==a+1||READER_BOOK.runtimeBlocks[b].joinPrevious!==true)return null;
                const indexes=k=>pageList.map((p,i)=>p.sourceSpans.some(s=>s.sourceBlock===k)?i:-1).filter(i=>i>=0);
                const previous=indexes(a).at(-1),next=indexes(b)[0];
                if(!Number.isInteger(previous)||!Number.isInteger(next)||next<previous||next>previous+1)return null;
                if(next>previous){
                    const blocks=READER_BOOK.runtimeBlocks;let start=a,end=b;
                    while(start>0&&blocks[start].joinPrevious)start--;
                    while(end+1<blocks.length&&blocks[end+1].joinPrevious)end++;
                    const part=blocks.slice(start,end+1),text=part.map(x=>x.text).join('');
                    const at=blocks.slice(start,b).reduce((n,x)=>n+x.text.length,0);
                    const words=new Intl.Segmenter('ja',{granularity:'word'});
                    if(!Array.from(words.segment(text)).some(w=>w.index===at))return null;
                }
                return [previous,next];
            }""", [left,right])
            check(result is not None, f'分冊境界の本文をページ内／語境界で連続表示できません: {left} → {right}')
            results.append({'from':left, 'to':right, 'pages':result})
        return {'route':plan['route'],'joins':results}

    def toc(self):
        ref=self.ref['toc']
        wanted=ref['rows']
        out=[]
        page=self.page
        if not wanted:
            check(ref['kind']=='source-absent' and ref.get('basis'),'原本目次が無い根拠を記録してください')
            return out
        check(ref['kind']=='source','原本の目次照合が必要です')
        ui=ref.get('ui',{})
        selector=ui.get('row','.contents-row')
        locations=[]
        # Check printed labels and numbers independently from their click destinations.
        for n in dict.fromkeys(r['source'] for r in wanted):
            f=self.open(n)
            expected=[w for w in wanted if w['source']==n]
            actual=[]
            if ui.get('show') or self.ui.get('position'):
                indices=[None]
            else:
                indices=f.evaluate('n=>'+API+'.pageManifest().map((p,i)=>p.scan===n?i:-1).filter(i=>i>=0)',n)
            for ix in indices:
                if ix is not None:
                    f.evaluate('i=>'+API+'.gotoPage(i)',ix)
                    wait_painted(f,ix)
                run_steps(page,f,ui.get('show',[]),n)
                rows=f.locator(selector).evaluate_all('''(rows,u)=>rows.filter(r=>r.getClientRects().length).map(r=>{const a=u.label?r.querySelector(u.label):r.firstElementChild,b=u.number?r.querySelector(u.number):r.lastElementChild;if(!a||!b||a===b)throw Error('目次の項目名・掲載番号が分離されていません');const x=r.getBoundingClientRect(),p=a.getBoundingClientRect(),q=b.getBoundingClientRect();if(x.left<-.6||x.top<-.6||x.right>innerWidth+.6||x.bottom>innerHeight+.6||q.left<x.left-.6||q.right>x.right+.6||q.bottom>x.bottom+.6||q.top<x.top-.6||!((p.right<=q.left+.6)||(q.right<=p.left+.6)||(p.bottom<=q.top+.6)||(q.bottom<=p.top+.6)))throw Error('目次の項目名と番号が画面内に収まりません');return [a.textContent.trim(),b.textContent.trim()];})''',ui)
                actual.extend(rows)
                locations.extend((n,ix,i) for i in range(len(rows)))
            check(actual==[[r['label'],r['number']] for r in expected],f'原本{n}: 目次の並び・項目名・掲載番号が違います')
        ordered=[r for n in dict.fromkeys(r['source'] for r in wanted) for r in wanted if r['source']==n]
        for count,((n,ix,i),r) in enumerate(zip(locations,ordered,strict=True),1):
            if count%25==0:
                print(f'目次 {count}/{len(ordered)}',flush=True)
            f=self.open(n)
            if ix is not None:
                f.evaluate('i=>'+API+'.gotoPage(i)',ix)
                wait_painted(f,ix)
            run_steps(page,f,ui.get('show',[]),n)
            f.locator(selector+':visible').nth(i).click()
            if self.manifest.get('segments'):
                page.wait_for_function('s=>pendingLoaded&&currentState.scan===s&&document.getElementById("busy").hidden',arg=r['target'])
                self.part=page.evaluate('activeSegment')
                self.frame=page.locator('#reader').element_handle().content_frame()
            if self.ui.get('position'):
                check(self.state()[1]==r['target'],'目次クリック先が違います')
            else:
                self.frame.wait_for_function('n=>{const a='+API+';if(!a)return false;const p=a.pageManifest()[a.inspect().index];return p&&[p.scan,...(p.sourceScans||[]),...(p.sourceSpans||[]).map(x=>x.scan),...((window.READER_BOOK?.entries||[]).filter(x=>x.kind==="image")[p.figure]?.sourceScans||[])].includes(n)}',arg=r['target'])
            if r.get('view')=='figure' and not self.ui.get('position'):
                check(self.frame.evaluate(API+'.inspect().currentKind')=="image",'図版の目次が該当する図版画面に到着しません')
            if r.get('destinationSelector'):
                self.frame.locator(r['destinationSelector']).wait_for(state='visible')
            out.append([r['source'],r['target'],r.get('view')]);
        return out


def trace_template(frame, plan):
    """Follow every displayed span back to the contiguous source-entry stream, including dialogue."""
    results = frame.evaluate("""plan=>{
        const a=window.StandardReader||window.NovelReader, book=window.READER_BOOK;
        if(!a||!book||!a.inspect().textIntegrity)throw Error('統合版の本文が表示と一致しません');
        const text=book.kind==='text'?book.blocks:(book.entries||[]).filter(e=>e.kind==='text').flatMap(e=>e.blocks||[e]);
        const keys=new Map(),refs=[],counts=new Map(),start=[],end=[],ranges=[];
        const chars=new Intl.Segmenter('ja',{granularity:'grapheme'});
        const words=new Intl.Segmenter('ja',{granularity:'word'});
        for(const [i,e] of text.entries()){
            const ord=counts.get(e.scan)||0;counts.set(e.scan,ord+1);
            const ref=e.sourceRef||[e.scan,ord];
            if(ref[0]!==e.scan||keys.has(ref.join('/')))throw Error('本文の原本番号が重複しています');
            refs.push(ref.join('/'));
            keys.set(ref.join('/'),i);
            ranges.push(Array.from(chars.segment(e.text)).length);
        }
        let current=0,offset=0;
        for(const [pageIndex,p] of a.pageManifest().entries())for(const s of p.sourceSpans||[]){
            const n=s.sourceEnd-s.sourceStart;
            if(n<=0||!text[current]||s.scan!==text[current].scan||offset+n>ranges[current])throw Error('読書画面と原本ブロックの順番・文字数が異なります');
            if(offset===0)start[current]=pageIndex;
            offset+=n;
            if(offset===ranges[current]){end[current]=pageIndex;current++;offset=0;}
        }
        if(offset||current!==text.length)throw Error('統合版の本文が欠落しています');
        const cuts=plan.sourceRanges.slice(1).map(v=>v[0]);
        if(cuts.length){
            const expected=new Set(plan.edges.map(e=>e.from.join('/')+'>'+e.to.join('/')));
            for(const [i,e] of text.entries()){
                if(!e.joinPrevious||!i)continue;
                const l=text[i-1],r=e;
                if(!cuts.some(n=>Math.min(l.scan,r.scan)<n&&Math.max(l.scan,r.scan)>=n))continue;
                if(!expected.has(refs[i-1]+'>'+refs[i]))throw Error('原本で照合した分冊接続と表示指定が異なります');
            }
        }
        for(const row of plan.breaks||[]){
            const left=keys.get(row.from.join('/')),right=keys.get(row.to.join('/'));
            if(left===undefined||right===undefined||(right===left+1&&text[right].joinPrevious))throw Error('原本で確認した段落の区切りと表示が異なります');
        }
        return plan.edges.map(e=>{
            const left=keys.get(e.from.join('/')),right=keys.get(e.to.join('/'));
            if(right===undefined||left===undefined||right!==left+1||!text[right].joinPrevious)throw Error('統合版の分冊接続が一致しません');
            const delta=start[right]-end[left];
            if(delta<0||delta>1)throw Error('分冊の続きに別の読書画面が挿入されています');
            if(delta===1){
                let head=left,tail=right;
                while(head>0&&text[head].joinPrevious)head--;
                while(tail+1<text.length&&text[tail+1].joinPrevious)tail++;
                const full=text.slice(head,tail+1).map(x=>x.text).join('');
                const at=text.slice(head,right).reduce((n,x)=>n+x.text.length,0);
                if(!Array.from(words.segment(full)).some(w=>w.index===at))throw Error('分冊の境界で単語が切れています');
            }
            return {...e,pages:[end[left],start[right]]};
        });
    }""",plan)
    return {'route':plan['route'], 'joins':results, 'sourceRanges':plan['sourceRanges']}


def measure(site,archive,entry,manifest,reference,ranges,root,chromium,continuation=None):
    from playwright.sync_api import sync_playwright
    from reader_shelf_turns import measure_turns
    class Handler(http.server.SimpleHTTPRequestHandler):
        def do_GET(self):
            if self.path=='/__stage':
                body=b'<!doctype html><title>Offline reader QA</title>'
                self.send_response(200)
                self.send_header('Content-Type','text/html')
                self.send_header('Content-Length',str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            super().do_GET()
        def translate_path(self,url):
            return str(archive) if urlsplit(url).path=='/__qa_archive' else super().translate_path(url)
        def log_message(self,*args):
            pass
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(site)))
    thread=threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    base=f'http://127.0.0.1:{server.server_port}'
    shell='reader/library/read-wh1-v9.html' if entry['id']=='wh1' else 'reader/british-interiors/full/index.html' if entry['id']=='uk-interiors' else 'reader/library/read.html'
    check((site/shell).is_file(),'本棚の配信対象となる読書画面がありません')
    used={}
    try:
        with sync_playwright() as pw:
            options={} if not chromium else {'executable_path':str(chromium),'args':['--no-sandbox','--single-process','--no-zygote','--disable-dev-shm-usage','--disable-gpu']}
            browser=pw.chromium.launch(**options)
            ctx=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=3,is_mobile=True,has_touch=True,locale='ja-JP',service_workers='block')
            page=ctx.new_page()
            page.set_default_timeout(18000)
            def route(req):
                url=req.request.url
                if not url.startswith(base+'/'):
                    return req.abort()
                path=urlsplit(url).path.lstrip('/')
                file=site/path
                if path and file.is_file():
                    used[path]=hashlib.sha256(file.read_bytes()).hexdigest()
                return req.continue_()
            ctx.route('http**://**/*',route)
            page.goto(base+'/__stage')
            page.evaluate(SEED,[entry['id'],entry['title'],root])
            page.goto(base+'/'+shell+'?id='+quote(entry['id']))
            reader=Reader(page,manifest,reference)
            cdp=ctx.new_cdp_session(page)
            batches=[]
            modes=set(reference['modes'])
            check(modes and modes.issubset({'text','figure','contents','original'}),'検査する画面種別が不正です')
            observed=set()
            for start,end in ranges:
                cases=[c for c in reference.get('cases',[]) if start<=c['scan']<=end]
                default=reference.get('batchModes',{}).get(str(start),reference.get('defaultMode','text'))
                sample={'mode':default,'scan':start+(end-start)//2}
                cases=[sample,*cases]
                frame=reader.open(start)
                if continuation and continuation['route']=='without-prose':
                    text_pages=frame.evaluate('()=>{const a='+API+';return !!a?.pageManifest?.().some(p=>p.kind==="text")}')
                    check(not text_pages, '本文があるため分冊境界の照合と全巻組版が必要です')
                if not reader.ui.get('position'):
                    detected=frame.evaluate('()=>{const a='+API+';return [a.pageManifest().some(p=>p.kind==="image"),a.inspect().originalReady===true]}')
                    check(not detected[0] or 'figure' in modes,'書籍に図版があります。図版での検査が必要です')
                    check(not detected[1] or 'original' in modes,'原本画面の検査が必要です')
                batch=[]
                for c in cases:
                    try:
                        batch.append(reader.probe(c,start,end,cdp))
                        observed.add(c['mode'])
                    except Exception as exc:
                        raise ValueError(f'原本{start}〜{end}・{c["mode"]}: {exc}') from exc
                batches.append([start,end,batch])
                print(f'原本 {start}〜{end} 操作確認',flush=True)
            check(modes==observed,'原本にある画面種別のピンチ検査がそろっていません')
            joins=reader.measure_continuity(continuation)
            dest=reader.toc()
            turns=measure_turns(page, reader, cdp, ranges)
            browser.close()
        check(shell in used,'配信対象の読書画面を取得できません')
        return batches,dest,used,joins,turns
    finally:
        server.shutdown()
        thread.join()
        server.server_close()
