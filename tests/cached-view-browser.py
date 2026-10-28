"""Browser regression with synthetic data only. No real Google credentials,
Drive files or third-party network are used. Run after all site builds.
"""
import argparse,hashlib,json,pathlib,struct,threading,zlib
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlparse,parse_qs
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--engine',choices=['chromium','webkit'],default='chromium');args=parser.parse_args()
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**k):super().__init__(*a,directory=str(ROOT),**k)
    def log_message(self,*a):pass
server=ThreadingHTTPServer(('127.0.0.1',8766),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
def chunk(t,b):return struct.pack('>I',len(b))+t+b+struct.pack('>I',zlib.crc32(t+b)&0xffffffff)
png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',2,2,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b'\0\x33\x66\x99\x33\x66\x99'*2))+chunk(b'IEND',b'')
h=hashlib.sha256(png).hexdigest();ref='gdrive:photo1:'+h
schema='flashcards-drive-journal-v3'
def event(i,k,v):return {'id':i,'key':k,'value':v,'parents':[],'deleted':False,'clock':1}
docs={
 'color-journal':{'schema':schema,'namespace':'colors1000-review47','events':[event('c1','photo:color-0001:palette',{'data_url':ref,'sha256':h,'label':'SYNTHETIC PALETTE','updated_at':'2020-01-01T00:00:00Z'})]},
 'plant-journal':{'schema':schema,'namespace':'plant-flashcards','events':[event('p1','card:plant1',{'id':'plant1','name':'試験植物','description':'試験用の説明','group':'angiosperm','sort_order':1}),event('p2','image:plant1:0',ref)]}}
gis="window.google={accounts:{oauth2:{hasGrantedAllScopes:()=>true,initTokenClient:c=>({requestAccessToken:()=>c.callback({access_token:'mock-no-real-credentials',expires_in:3600})})}}};"
results=[]
with sync_playwright() as p:
    browser=getattr(p,args.engine).launch(headless=True)
    context=browser.new_context(viewport={'width':390,'height':844})
    calls=[]
    def route(r):
        u=urlparse(r.request.url)
        if u.hostname=='127.0.0.1':r.continue_();return
        if u.hostname=='accounts.google.com' and u.path=='/gsi/client':r.fulfill(status=200,content_type='application/javascript',body=gis);return
        if u.hostname!='www.googleapis.com' or not u.path.startswith('/drive/v3/'):
            r.abort();return
        headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization','Access-Control-Allow-Methods':'GET, OPTIONS'}
        if r.request.method=='OPTIONS':r.fulfill(status=204,headers=headers);return
        assert r.request.method=='GET'
        calls.append(r.request.url);q=parse_qs(u.query)
        if u.path.endswith('/about'):body={'user':{'permissionId':'synthetic-owner','emailAddress':'fixture@example.invalid'}}
        elif u.path.endswith('/files'):
            query=q.get('q',[''])[0]
            if "value='journal'" in query:body={'files':[{'id':'color-journal' if 'colors1000-review47' in query else 'plant-journal','md5Checksum':'synthetic-revision-1'}]}
            else:body={'files':[{'id':'photo1','appProperties':{'sha256':h},'sha256Checksum':h,'mimeType':'image/png','size':str(len(png))}]}
        elif u.path.split('/')[-1] in docs:body=docs[u.path.split('/')[-1]]
        elif u.path.endswith('/photo1'):r.fulfill(status=200,headers=headers,content_type='image/png',body=png);return
        else:raise AssertionError('Unexpected Drive path '+u.path)
        r.fulfill(status=200,headers=headers,content_type='application/json',body=json.dumps(body))
    context.route('**/*',route)
    for app,api in [('colors','ColorDriveSync'),('plants','PlantDriveSync')]:
        page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        url='http://127.0.0.1:8766/'+app+'/drive-view.html?cache=1'
        def ready():page.wait_for_function('Boolean(window.'+api+')',timeout=30000)
        def show():
            if app=='colors':page.evaluate('jump(0);flip()')
            else:page.evaluate('render(true)')
            selector='[data-photo-slot="color-0001:palette"] img' if app=='colors' else '.image-box img'
            page.wait_for_function('(s)=>{const i=document.querySelector(s);return !!i&&i.complete&&i.naturalWidth>0}',arg=selector,timeout=20000)
        try:
            page.goto(url,wait_until='load');ready()
            page.get_by_role('button',name='接続して差分同期',exact=True).click()
            page.wait_for_function('window.'+api+'.status().status === "差分同期済み"',timeout=30000)
            show();page.wait_for_function('window.'+api+'.cacheInfo().photoSaved>0',timeout=15000)
            n=len(calls);page.evaluate('window.'+api+'.disconnect()');show()
            assert len(calls)==n,'Disconnect must not re-download a photo'
            page.reload(wait_until='load');ready()
            page.wait_for_function('Boolean(window.'+api+'.cachedResult())',timeout=15000)
            assert not page.evaluate('window.'+api+'.valid()'),'Reload must not silently reuse credentials'
            show();assert len(calls)==n,'Reload must restore from IndexedDB without Drive requests'
            page.evaluate('navigator.serviceWorker.ready.then(()=>true)')
            page.wait_for_function('Boolean(navigator.serviceWorker.controller)',timeout=20000)
            context.set_offline(True)
            page.reload(wait_until='load');ready()
            page.wait_for_function('Boolean(window.'+api+'.cachedResult())',timeout=15000)
            show();assert len(calls)==n,'Offline reopen must not request Drive data'
            context.set_offline(False)
            # An unchanged sync may list metadata, but must fetch no media bodies.
            start=len(calls);page.get_by_role('button',name='接続して差分同期',exact=True).click()
            page.wait_for_function('window.'+api+'.status().status === "差分同期済み"',timeout=30000)
            assert not any('alt=media' in u for u in calls[start:]),'Unchanged media was downloaded again'
            assert not errors,errors
            results.append({'engine':args.engine,'app':app,'real_indexeddb':True,'disconnect_retains_image':True,'reload_without_auth':True,'offline_reopen':True,'unchanged_media_downloads':0})
        except Exception:
            print(json.dumps({'app':app,'errors':errors,'text':page.locator('body').inner_text()[:6000]},ensure_ascii=False))
            raise
        finally:
            context.set_offline(False);page.close()
    context.close();browser.close()
server.shutdown()
print(json.dumps({'results':results},ensure_ascii=False,indent=2))
