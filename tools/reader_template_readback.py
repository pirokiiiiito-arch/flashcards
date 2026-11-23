"""Read painted StandardReader or NovelReader pages in a standalone HTML document.

Pass the source inventory and optional scan-local region locations used by
reader_shelf_readback.py. Standard text keys are block-<sourceBlock>; novel
text keys are block-<scan-local paragraph ordinal>. Image keys are figure-<n>,
figure-<n>-title and caption-<n>, using the template's figure index.
"""
import argparse
import functools
import http.server
import json
import threading
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

from reader_shelf_probe import wait_painted
from reader_shelf_readback import checked_census, normalize, sha


class PrivateFiles(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def capture(html, inventory_path, out, chromium, locations_path=None):
    from playwright.sync_api import sync_playwright

    html, out = html.resolve(strict=True), out.resolve()
    root = inventory_path.resolve().parent
    inventory = json.loads(inventory_path.read_bytes())
    locations = json.loads(locations_path.read_bytes()) if locations_path else {}
    out.parent.mkdir(parents=True, exist_ok=True)
    images = out.parent / (out.stem + '-captures')
    images.mkdir(exist_ok=True)
    report = dict(schema='reader-proof-readback-v1', bookId=inventory['bookId'], range=inventory['range'],
                  artifactSha256=sha(html.read_bytes()), member=html.name, route='part', pages=[])
    report['hostFiles'] = {}
    runner = Path(__file__).with_suffix('.js').read_text()
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(PrivateFiles, directory=html.parent))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    template_api = 'window.StandardReader||window.NovelReader'
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=str(chromium), args=['--no-sandbox','--disable-dev-shm-usage'])
            ctx = browser.new_context(viewport={'width':390,'height':700}, is_mobile=True, has_touch=True,
                                      locale='ja-JP', service_workers='block')
            ctx.route('**/*', lambda route: route.continue_() if route.request.url.startswith(origin+'/') else route.abort())
            page = ctx.new_page()
            page.goto(origin+'/'+quote(html.name))
            wait_painted(page)
            info = page.evaluate(f'()=>({template_api}).inspect()')
            if page.evaluate(f'()=>({template_api}).bookId') != inventory['bookId']:
                raise ValueError('読書HTMLと原本照合台帳の書籍IDが一致しません')
            report.update(template=page.evaluate(f'()=>({template_api}).version'), viewport=[390,700], font=info['font'])
            for item in inventory['pages']:
                scan = item['scan']
                census = checked_census(root,item)
                original = (root/item['image']['path']).resolve(strict=True)
                if not original.is_relative_to(root):
                    raise ValueError('原本が校正台帳のフォルダー外にあります')
                digest = sha(original.read_bytes())
                if not (digest == item['image']['sha256'] == census['sourceSha256'] and scan == census['scan']
                        and inventory['range'][0] <= scan <= inventory['range'][1]):
                    raise ValueError('原本または対象範囲が一致しません')
                embedded = page.evaluate("""async scan=>{
                    const matches=(window.READER_BOOK.originals||[]).filter(p=>Number(p.scan)===scan);
                    if(!matches.length)return null;
                    if(matches.length!==1||!matches[0].src)throw Error('原本参照が不正です');
                    const response=await fetch(matches[0].src);
                    if(!response.ok)throw Error('内蔵原本を取得できません');
                    const hash=await crypto.subtle.digest('SHA-256',await response.arrayBuffer());
                    return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
                }""",scan)
                if embedded is not None and embedded != digest:
                    raise ValueError('読書HTMLの原本と校正台帳の原本が異なります')
                raw = page.evaluate(runner,scan)
                regions, complete = normalize(raw,census,locations.get(str(scan),{}))
                captures = []
                for ix in raw['pageIndexes']:
                    page.evaluate(f'i=>({template_api}).gotoPage(i)',ix)
                    wait_painted(page,ix)
                    page.evaluate('async()=>{await document.fonts.ready;await new Promise(requestAnimationFrame)}')
                    name = images/f'{scan:03}-page-{ix:03}.png'
                    data = page.screenshot(path=name)
                    captures.append(dict(path=name.relative_to(out.parent).as_posix(),sha256=sha(data)))
                report['pages'].append(dict(scan=scan,sourceSha256=digest,completeScopes=complete,regions=regions,
                                            captures=captures,painted=raw['rows'],unhandled=raw['unknown'],
                                            sourceBinding='embedded' if embedded else 'inventory'))
            resources = page.evaluate("()=>[...document.querySelectorAll('script[src],link[rel=stylesheet][href]')].map(e=>e.src||e.href)")
            for url in resources:
                if not url.startswith(origin+'/'):
                    raise ValueError('外部の表示プログラムを再照合できません')
                name = unquote(urlsplit(url).path).lstrip('/')
                path = (html.parent/name).resolve(strict=True)
                if not path.is_relative_to(html.parent):
                    raise ValueError('読書プログラムの保存先が不正です')
                report['hostFiles'][name] = sha(path.read_bytes())
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    return report


if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for param in ['html','inventory','out','chromium']:
        parser.add_argument('--'+param,type=Path,required=True)
    parser.add_argument('--locations',type=Path)
    args = parser.parse_args()
    capture(args.html,args.inventory,args.out,args.chromium,args.locations)
