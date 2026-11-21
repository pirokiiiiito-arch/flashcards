"""Exercise authored and runtime book boundaries in the live registration browser."""
import re
import time
from dataclasses import dataclass

from playwright.sync_api import Error as BrowserError
from reader_shelf_turn_frames import TurnFrames

API = '(window.StandardReader||window.NovelReader||window.WH1BookReader)'
DEFAULTS = {
    'body': '#sheet, #reader-page',
    'number': '#ukPageDisplay, .location-indicator, .page-location, #location, #page-major',
    'next': '#forward, #next',
    'prev': '#back, #prev',
}
# Input coordinates are page CSS pixels, including the shelf host outside an iframe.
MANIFEST = """()=>{const api=API;return api.pageManifest().map(p=>{
 const scans=[p.scan,...(p.sourceScans||[]),...(p.sourceSpans||[]).map(s=>s.scan)];
 if(p.kind==='image'&&Number.isInteger(p.figure)){
   const figure=window.READER_BOOK?.entries?.filter(e=>e.kind==='image')[p.figure];
   scans.push(...(figure?.sourceScans||[]));
 }
 return [...new Set(scans.filter(Number.isInteger))];
})}""".replace('API', API)


def require(value, message):
    if not value:
        raise ValueError(message)


@dataclass(frozen=True)
class Position:
    section: int
    index: int


def source_pair(pages, after, before):
    """Locate the real reading screens on either side of a source boundary."""
    left = [i for i, scans in enumerate(pages) if after in scans]
    right = [i for i, scans in enumerate(pages) if before in scans]
    require(left and right, f'原本 {after}/{before} を実画面の出典に照合できません')
    for i in right:
        if after in pages[i]:
            return i, i
    for i in right:
        if i and i - 1 in left:
            return i - 1, i
    raise ValueError(f'原本 {after}/{before} に対応する連続画面を確認できません')


def boundary_screens(pages, after, before, reordered):
    """Find each actual crossing when the authorized reading order interleaves batches."""
    if not reordered:
        return [source_pair(pages, after, before)]
    require(any(after in s for s in pages) and any(before in s for s in pages),
            f'並べ替えた原本 {after}/{before} の出典がありません')
    sides = [{int(n >= before) for n in scans} for scans in pages]
    require(all(sides), '並べ替えた読書ページの出典が不足しています')
    edges = []
    for i, side in enumerate(sides):
        if len(side) == 2:
            edges.append((i, i))
        if i and sides[i-1] != side:
            edges.append((i-1, i))
    require(edges, f'原本 {after}/{before} の表示上の境界がありません')
    return edges


def controls(frame, spec):
    found = {}
    for key, selectors in DEFAULTS.items():
        for selector in (spec[key],) if key in spec else selectors.split(', '):
            items = frame.locator(selector)
            for item in items.all():
                if item.is_visible():
                    found[key] = item
                    break
            if key in found:
                break
        require(key in found, f'実読書画面の {key} が見つかりません。ui.turns のセレクタを確認してください')
    return found


def coordinates(control):
    box = control.bounding_box()
    require(box and min(box['width'], box['height']) > 1, '画面上の操作領域がありません')
    return box


def center(box):
    return box['x'] + box['width'] / 2, box['y'] + box['height'] / 2


def combined_box(a,b):
    x,y=min(a['x'],b['x']),min(a['y'],b['y'])
    return {'x':x,'y':y,'width':max(a['x']+a['width'],b['x']+b['width'])-x,
            'height':max(a['y']+a['height'],b['y']+b['height'])-y}


def swipe(cdp, box, direction):
    x, y = center(box)
    distance = min(110, box['height'] * .42)
    require(distance > 50, '読書面に実スワイプの距離がありません')
    for kind, offset in [('touchStart', -.5), ('touchMove', 0), ('touchMove', .5), ('touchEnd', 0)]:
        points = [] if kind == 'touchEnd' else [{'id': 1, 'x': x, 'y': y-offset*distance*direction}]
        cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': points})


class BookTurns:
    def __init__(self, page, reader, cdp):
        self.page = page
        self.reader = reader
        self.cdp = cdp
        self.ui = reader.ui.get('turns', {})
        self.sections = page.evaluate("""()=>typeof SEGMENTS!=='undefined'&&Array.isArray(SEGMENTS)&&
            typeof openSegment==='function'?SEGMENTS.map(s=>[s.start,s.end]):[]""")
        require(not reader.manifest.get('segments') or self.sections, '実際の読書区間を取得できません')
        self.section_count = len(self.sections) or 1
        self.maps = []
        self.positions = []
        self.scans = []

    def frame(self):
        selector = self.reader.ui.get('frame') or ('#reader' if self.sections else None)
        if not selector:
            return self.page.main_frame
        element = self.page.locator(selector).element_handle()
        try:
            frame = element.content_frame()
        finally:
            element.dispose()
        require(frame is not None, '紙面のiframeがありません')
        return frame

    def select_section(self, section, mode='first'):
        if self.sections:
            self.page.evaluate('([i,m])=>openSegment(i,{mode:m})', [section, mode])
            self.page.wait_for_function("""i=>activeSegment===i&&currentState.segment===i&&
                pendingLoaded&&document.getElementById('busy').hidden""", arg=section)
        self.reader.part = section if self.sections else None
        self.reader.frame = self.frame()
        return self.reader.frame

    def map(self):
        for section in range(self.section_count):
            f = self.select_section(section)
            if not f.evaluate('Boolean('+API+')'):
                if not self.reader.ui.get('position'):
                    f.wait_for_function(API+'?.inspect().pages>0')
                else:
                    return False
            f.wait_for_function(API+'?.inspect().pages>0 && !'+API+'.inspect().paintPending')
            p = f.evaluate(MANIFEST)
            require(p, '区間内の画面一覧が空です')
            self.maps.append(p)
            self.scans.extend(p)
            self.positions.extend(Position(section, i) for i in range(len(p)))
        return True

    def goto(self, pos):
        section = self.page.evaluate('activeSegment') if self.sections else 0
        f = self.select_section(pos.section) if section != pos.section else self.frame()
        f.evaluate('i=>'+API+'.gotoPage(i)',pos.index)
        self.wait(pos)
        return self.frame()

    def wait(self, pos):
        if self.sections:
            self.page.wait_for_function("""i=>activeSegment===i&&currentState.segment===i&&
                pendingLoaded&&document.getElementById('busy').hidden""",arg=pos.section)
        f = self.frame()
        f.wait_for_function('i=>{const s='+API+'?.inspect();return s&&s.index===i&&!s.paintPending}',arg=pos.index)
        return f

    def stable(self, f, position):
        elements = controls(f, self.ui)
        info = elements['body'].evaluate("""async e=>{
            await document.fonts.ready;
            const visible=n=>{
                const r=n.getBoundingClientRect(),s=e.getBoundingClientRect();
                if(r.width<=0||r.height<=0||r.right<=Math.max(s.left,0)||r.bottom<=Math.max(s.top,0)||
                   r.left>=Math.min(s.right,innerWidth)||r.top>=Math.min(s.bottom,innerHeight))return false;
                if(getComputedStyle(n).visibility!=='visible')return false;
                for(let p=n;p;p=p.parentElement)if(+getComputedStyle(p).opacity===0)return false;
                return true;
            };
            const imgs=(e.matches('img')?[e]:[...e.querySelectorAll('img')]).filter(visible);
            await Promise.all(imgs.map(i=>i.decode()));
            const text=e.innerText?.trim();return {text:!!text,images:imgs.length,loaded:imgs.every(i=>i.naturalWidth>0)};
        }""")
        kind=None
        if f.evaluate('Boolean('+API+')'):
            kind=f.evaluate('()=>{const a='+API+';return a.pageManifest()[a.inspect().index]?.kind}')
        require(info['loaded'] and (info['text'] or info['images'] or kind=='blank'),
                '基準紙面が空か、画像が未描画です')
        require(kind not in ('image','portrait','figure','scan') or info['images']>0,
                '画像ページに表示済みの画像がありません')
        if isinstance(position, Position):
            counts = [len(m) for m in self.maps]
            spec = {'local':[position.index+1,counts[position.section]],
                    'book':[sum(counts[:position.section])+position.index+1,sum(counts)],
                    'sources':self.maps[position.section][position.index],
                    'sourceTotal':self.reader.manifest['range'][1]}
            # Allow the asynchronous whole-book counter to finish. A screenshot of
            # an already incorrect number is never used as an expected reference.
            elements['number'].evaluate(r"""async (e,s)=>{
                const deadline=performance.now()+12000;
                do{
                    const n=e.querySelector('#page-major,#location')||e;
                    const after=getComputedStyle(n,'::after');
                    const transparent=c=>c==='transparent'||/^rgba\([^)]*,\s*0\)$/.test(c);
                    const replaced=transparent(getComputedStyle(n).color)&&!transparent(after.color)&&
                        after.visibility!=='hidden'&&after.display!=='none'&&+after.opacity>0;
                    const raw=replaced?after.content:n.innerText;
                    const parts=raw.match(/(\d+)\s*[/／]\s*(\d+)/);
                    const expected=(n.hasAttribute('data-wh1-global')||n.hasAttribute('data-global'))?s.book:s.local;
                    const origin=e.innerText.match(/原本\s*(\d+)\s*[/／]\s*(\d+)/);
                    if(parts && +parts[1]===expected[0] && +parts[2]===expected[1] &&
                        (!origin||(s.sources.includes(+origin[1])&&+origin[2]===s.sourceTotal)))return;
                    await new Promise(r=>requestAnimationFrame(r));
                }while(performance.now()<deadline);
                throw Error('表示番号／原本番号が実際の読書位置と違います '+JSON.stringify(s)+' / '+e.innerText);
            }""",spec)
        return {k:coordinates(v) for k,v in elements.items()}

    def perform(self, input_type, direction, boxes):
        if input_type == 'swipe':
            swipe(self.cdp, boxes['body'], direction)
        else:
            self.page.touchscreen.tap(*center(boxes['next' if direction > 0 else 'prev']))

    def verify_pair(self, left, right, go=None, wait=None):
        # Reference images are acquired by independent positioning, never from a tested input.
        go = go or self.goto
        wait = wait or self.wait
        same = left == right
        left_boxes = self.stable(go(left), left)
        right_boxes = self.stable(go(right), right)
        regions = [combined_box(left_boxes[k],right_boxes[k]) for k in ('body','number')]
        with TurnFrames(self.page, self.cdp, *regions) as film:
            self.stable(go(left), left)
            old = film.reference()
            self.stable(go(right), right)
            new = film.reference()
            if not same:
                require(old != new, '隣り合う2画面を本文・番号の組で区別できません')
            go(left)
            self.stable(self.frame(),left)
            results = {}
            def turn(name, actions, destination, sequence, optional=False):
                def action():
                    for kind, direction, boxes in actions:
                        self.perform(kind, direction, boxes)
                    # A rapid reversal can momentarily be at the correct origin while the
                    # first operation is still running. Wait for the host/reader to drain.
                    if len(actions)>1:
                        self.page.wait_for_timeout(300)
                    wait(destination)
                    self.page.wait_for_function("""()=>(typeof sectionTurn==='undefined'||!sectionTurn)&&
                        (typeof presidentsTurn==='undefined'||!presidentsTurn)&&
                        (typeof wh3TurningSection==='undefined'||!wh3TurningSection)""")
                    wait(destination)
                results[name]=film.check(sequence,action,label=name,optional_middle=optional)
            for kind in ('button','swipe'):
                turn(kind+'Forward',[(kind,1,left_boxes)],right,[old] if same else [old,new])
                turn(kind+'RapidReverse',[(kind,-1,right_boxes),(kind,1,left_boxes)],right,
                     [new] if same else [new,old,new],not same)
                turn(kind+'Back',[(kind,-1,right_boxes)],left,[old] if same else [new,old])
                turn(kind+'RapidReturn',[(kind,1,left_boxes),(kind,-1,right_boxes)],left,
                     [old] if same else [old,new,old],not same)
            return results


def measure_turns(page, reader, cdp, ranges):
    seq=[list(r) for r in ranges]
    require(seq and all(a<=b for a,b in seq) and all(a[1]+1==b[0] for a,b in zip(seq,seq[1:])), '制作範囲が連続していません')
    require([seq[0][0],seq[-1][1]]==list(reader.manifest['range']),'制作範囲が書籍全体を含みません')
    book=BookTurns(page,reader,cdp)
    out={'version':1,'ranges':seq,'sectionCount':book.section_count,'boundaries':[],'sectionBoundaries':[],'measurements':[]}
    if len(seq)==1 and book.section_count==1:
        return out
    if book.map():
        positions, scans = book.positions, book.scans
        verify = book.verify_pair
    else:
        walk = UITraversal(book)
        walk.collect()
        positions, scans = walk.positions, walk.scans
        def verify(a, b):
            return book.verify_pair(a, b, walk.goto, walk.wait)

    measurements = {}
    def proof(a, b):
        if (a, b) not in measurements:
            tests = verify(a, b)
            def location(p):
                return [p.section,p.index] if isinstance(p,Position) else [p.section,p.scan,p.number]
            measurements[a,b] = len(out['measurements'])
            out['measurements'].append({'from':location(a),'to':location(b),'tests':tests})
        return measurements[a,b]

    for i in range(book.section_count-1):
        first = next((n for n,p in enumerate(positions) if p.section==i+1),None)
        require(first and positions[first-1].section==i,'読書区間の境界を特定できません')
        out['sectionBoundaries'].append({
            'fromSection':i,'toSection':i+1,'after':book.sections[i][1],'before':book.sections[i+1][0],
            'fromScans':scans[first-1],'toScans':scans[first],'measurement':proof(positions[first-1],positions[first]),
        })
    order=reader.manifest.get('readingFlow',{}).get('scanOrder',[])
    reordered=bool(order and list(order)!=sorted(order))
    for left,right in zip(seq,seq[1:]):
        after,before=left[1],right[0]
        crossings=[]
        for l,r in boundary_screens(scans,after,before,reordered):
            shared_scans=scans[l] if l==r else []
            if l==r:
                # This source seam is already visible on one screen. Test exiting
                # that screen, or entering from its predecessor at the book's end.
                if r+1<len(positions):r+=1
                elif l:l-=1
            a,b=positions[l],positions[r]
            kind='shared-page' if shared_scans else 'segment' if a.section!=b.section else 'within-document'
            crossings.append({'kind':kind,'fromScans':scans[l],'toScans':scans[r],
                              'sharedScans':shared_scans,'measurement':proof(a,b)})
        out['boundaries'].append({'after':after,'before':before,'totalScreens':len(positions),
                                  **crossings[0],'displayCrossings':crossings})
    return out


@dataclass(frozen=True)
class UIPosition:
    section: int
    scan: int
    number: int
    total: int


def displayed_number(frame, spec):
    node=frame.locator(spec['selector'])
    raw=node.get_attribute(spec['attribute']) if 'attribute' in spec else node.inner_text()
    result=re.search(spec.get('pattern',r'(\d+)'),raw or '')
    require(result,'画面に指定した読書位置の表示がありません')
    return int(result.group(1))


class UITraversal:
    """Readers without a page API expose the same information via their visible controls."""
    def __init__(self, book):
        self.book=book
        self.reader=book.reader
        self.page=book.page
        self.positions=[]
        self.scans=[]
        self.sections=book.sections or [book.reader.manifest['range']]
        declared=self.reader.manifest.get('readingFlow',{}).get('scanOrder',[])
        self.order=[n for lo,hi in self.sections for n in (declared or range(lo,hi+1)) if lo<=n<=hi]
        self.rank={n:i for i,n in enumerate(self.order)}

    def current(self):
        f=self.book.frame()
        source=displayed_number(f,self.reader.ui['scan'])
        if f.locator('#ukPageMinor').count():
            # The British Interiors archive streams each scan independently. The
            # prominent number is the scan and the smaller one is the reading page.
            raw=f.locator('#ukPageMinor').inner_text()
            local=re.search(r'読書\s*(\d+)\s*[/／]\s*(\d+)',raw)
            require(local, '原本内の読書ページ総数を確認できません')
            n,total=map(int,local.groups())
            major=f.locator('#ukPageMajor').inner_text()
            match=re.search(r'(\d+)\s*[/／]\s*(\d+)',major)
            require(match and [int(v) for v in match.groups()]==[source,self.reader.manifest['range'][1]],'原本番号表示が一致しません')
        else:
            n=displayed_number(f,self.reader.ui['position'])
            readout=controls(f,self.book.ui)['number']
            visible=readout.evaluate("""e=>{
                const n=e.querySelector('#page-major,#location')||e;
                const a=getComputedStyle(n,'::after');
                const clear=c=>c==='transparent'||c.endsWith(', 0)');
                return clear(getComputedStyle(n).color)&&!clear(a.color)&&a.display!=='none'&&
                    a.visibility!=='hidden'&&+a.opacity>0 ? a.content : e.innerText;
            }""")
            match=re.search(self.book.ui.get('numberPattern',r'(\d+)\s*[/／]\s*(\d+)'),visible)
            require(match and int(match.group(1))==n,'利用者に表示した読書番号と実際の位置が一致しません')
            if 'total' in self.book.ui:
                total=displayed_number(f,self.book.ui['total'])
                require(not match.lastindex or match.lastindex<2 or int(match.group(2))==total,
                        '表示した総ページ数が一致しません')
            else:
                require(match.lastindex and match.lastindex>=2,'独自読書画面の総ページ数を ui.turns.total で指定してください')
                total=int(match.group(2))
        require(1<=n<=total,'読書位置と総ページ数が一致しません')
        section=self.page.evaluate('activeSegment') if self.book.sections else 0
        return UIPosition(section,source,n,total)

    def change(self, old, direction):
        f=self.book.frame()
        button=controls(f,self.book.ui)['next' if direction>0 else 'prev']
        self.page.touchscreen.tap(*center(coordinates(button)))
        # Allow the actual asynchronous reader and its original source indicator
        # to settle before recording the following position.
        deadline=time.monotonic()+self.page_timeout
        while time.monotonic()<deadline:
            self.page.wait_for_timeout(50)
            try:
                current=self.current()
            except (ValueError, BrowserError):
                continue
            if current!=old:
                return current
        raise ValueError('独自読書画面のページ送りが進みません')

    page_timeout=12

    def collect(self):
        self.reader.open(self.order[0])
        if self.book.sections:
            self.book.select_section(0)
        p=self.current()
        require(p.section==0 and p.scan==self.order[0] and p.number==1,'独自読書画面の先頭を確認できません')
        seen=set()
        while True:
            require(p not in seen,'独自読書画面の順序が循環しています')
            seen.add(p)
            self.positions.append(p)
            sources = [p.scan]
            if 'sourceScans' in self.book.ui:
                spec = self.book.ui['sourceScans']
                node = self.book.frame().locator(spec['selector'])
                raw = node.get_attribute(spec['attribute']) if 'attribute' in spec else node.inner_text()
                require(raw, '独自読書画面の原本出典がありません')
                sources.extend(int(n) for n in re.findall(r'\d+',raw))
                require(all(n in self.rank for n in sources),'読書画面の出典が原本範囲の外です')
            self.scans.append(list(dict.fromkeys(sources)))
            if p.section==len(self.sections)-1 and self.order[-1] in sources and p.number==p.total:
                break
            following=self.change(p,1)
            require(following.section in (p.section,p.section+1) and self.rank[following.scan]>=self.rank[p.scan],
                    '実際の読書区間または原本の順序が違います')
            require(following.number==p.number+1 or
                    (following.number==1 and (following.section>p.section or self.rank[following.scan]>self.rank[p.scan]) and p.number==p.total),
                    '独自読書画面の表示番号が飛んでいます')
            p=following

    def goto(self,pos):
        self.reader.part=None
        self.reader.open(pos.scan)
        current=self.current()
        require(current in self.positions,'独自読書画面の独立した移動先を確認できません')
        i=self.positions.index(current);target=self.positions.index(pos)
        direction=1 if i<target else -1
        for j in range(i+direction,target+direction,direction):
            current=self.change(current,direction)
            require(current==self.positions[j],'独立した移動先とページ番号が一致しません')
        return self.wait(pos)

    def wait(self,pos):
        deadline=time.monotonic()+self.page_timeout
        while time.monotonic()<deadline:
            try:
                if self.current()==pos:return self.book.frame()
            except (ValueError,BrowserError):
                pass
            self.page.wait_for_timeout(40)
        raise ValueError(f'期待する読書位置に到達しません {pos}')
