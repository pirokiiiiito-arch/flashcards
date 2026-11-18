#!/usr/bin/env python3
"""Private reader layout QA: resumable 24 width/font + 5 height checks.

Checkpoints are tied to *exact* HTML and runner SHA-256. Failures don't erase
prior passes; content correctness and real iPhone verification are OUT OF SCOPE.
"""
from __future__ import annotations
import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
from datetime import datetime, timezone

WIDTHS=(320,390,430)
FONTS=(16,18,20,22,24,26,28,30)
HEIGHTS=(568,650,700,812,926)
BASE_HEIGHT=700
RUNNER_VERSION='private-reader-sharded-v1'


def digest(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda:f.read(2**20),b''):h.update(chunk)
    return h.hexdigest()


def cases():
    return [dict(id=f'font-w{w}-f{f}-h{BASE_HEIGHT}',width=w,font=f,height=BASE_HEIGHT,kind='font')
            for w in WIDTHS for f in FONTS] + [
            dict(id=f'height-w390-f20-h{h}',width=390,font=20,height=h,kind='height')
            for h in HEIGHTS]


def atomic_json(path, obj):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_name(path.name+'.part')
    temp.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    temp.replace(path)


def new_report(html_path, report_path):
    data={'schema':'reader-fast-layout-report-v1','runnerVersion':RUNNER_VERSION,
          'runnerSha256':digest(__file__), 'artifactSha256':digest(html_path),
          'artifactName':Path(html_path).name,
          'profile':'not_verified', 'results':{}, 'lastRunAt':None,
          'sourceProofreading':'not_run_by_this_tool',
          'realIPhone':'not_run_by_this_tool', 'canonical60':'not_run_by_this_tool',
          'eligibleForDelivery':False}
    if Path(report_path).exists():
        try:
            old=json.loads(Path(report_path).read_text(encoding='utf-8'))
            if (old.get('schema')==data['schema'] and
                old.get('runnerSha256')==data['runnerSha256'] and
                old.get('artifactSha256')==data['artifactSha256']):
                data['results']={k:v for k,v in old.get('results',{}).items() if k in {c['id'] for c in cases()}}
        except Exception:pass
    return data


async def frame(page):
    return await page.evaluate('''async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const r=window.NovelReader?.inspect?.();
      if(!r) return {error:'READER_INSPECTOR_UNAVAILABLE'};
      const sheet=document.querySelector('#sheet')?.getBoundingClientRect();
      const foot=document.querySelector('.page-footer, .bottom-bar, #bottom-bar, .nav-strip')?.getBoundingClientRect();
      const main=document.querySelector('#reader-main')?.getBoundingClientRect();
      const status=document.querySelector('#shelf-status')?.textContent||'';
      const size=document.querySelector('#current-size')?.textContent||'';
      const view={width:window.innerWidth,height:window.innerHeight};
      return {pages:r.pages,font:r.font,warning:r.warning||'',g404Pass:r.g404Pass,
        textIntegrity:r.textIntegrity,novelSourceIntegrity:r.novelSourceIntegrity,
        originalReady:r.originalReady,size,view, status,
        sheet:sheet?{x:sheet.x,width:sheet.width,height:sheet.height,bottom:sheet.bottom}:null,
        main:main?{x:main.x,width:main.width,height:main.height}:null,
        foot:foot?{top:foot.top,bottom:foot.bottom}:null};
    }''')


def assess(ob,case,errors):
    issues=[]
    if ob.get('error'):issues.append(ob['error'])
    if not isinstance(ob.get('pages'),int) or ob['pages']<1:issues.append('NO_READING_PAGES')
    if ob.get('font')!=case['font']:issues.append('FONT_NOT_MATCHED')
    if ob.get('size')!=f"{case['font']}px":issues.append('SIZE_CONTROL_NOT_MATCHED')
    if ob.get('warning'):issues.append('READER_WARNING')
    if ob.get('g404Pass') is not True:issues.append('NOVEL_COLUMN_LAYOUT_WARNING')
    if ob.get('textIntegrity') is not True:issues.append('TEXT_READER_INTEGRITY_FAIL')
    if ob.get('novelSourceIntegrity') is not True:issues.append('ORIGINAL_TEXT_DIGEST_MISMATCH')
    if ob.get('originalReady') is not True:issues.append('ORIGINAL_IMAGE_UNAVAILABLE')
    if ob.get('view',{}).get('width')!=case['width'] or ob.get('view',{}).get('height')!=case['height']:
        issues.append('VIEWPORT_NOT_MATCHED')
    sheet=ob.get('sheet')
    if not sheet or sheet['x'] < -1 or sheet['width']>case['width']+2 or sheet['height']<60:
        issues.append('SHEET_GEOMETRY_INVALID')
    if errors:issues.append('CHROMIUM_PAGE_ERROR')
    return issues


async def run_check(html,report_path,force=False,only_failed=False,selected=None):
    from playwright.async_api import async_playwright
    selected=set(selected or [])
    report=new_report(html,report_path)
    work=cases()
    if selected:work=[c for c in work if c['id'] in selected]
    if not force:
        if only_failed:
            work=[c for c in work if report['results'].get(c['id'],{}).get('status')=='failed']
        else:
            work=[c for c in work if report['results'].get(c['id'],{}).get('status')!='passed']
    if not work:
        return report,0
    content=Path(html).read_text(encoding='utf-8')
    grouped={}
    for c in work:grouped.setdefault((c['kind'],c['width']),[]).append(c)
    # Only one Chromium instance; one page is recycled per shard. Bounded work
    # can resume from the exact failed case after interruption.
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
            args=['--no-sandbox','--disable-dev-shm-usage','--disable-background-networking'])
        try:
            for (kind,width),group in sorted(grouped.items()):
                page=await browser.new_page(viewport={'width':width,'height':BASE_HEIGHT},device_scale_factor=1)
                errors=[]
                page.on('pageerror',lambda e:errors.append(str(e)[:300]))
                try:
                    await asyncio.wait_for(page.set_content(content,wait_until='domcontentloaded',timeout=15000),timeout=22)
                    await page.wait_for_function('!!window.NovelReader && window.NovelReader.inspect().pages>0',timeout=20000)
                    current_font=20
                    for c in group:
                        start_errors=len(errors)
                        try:
                            if kind=='height':
                                await page.set_viewport_size({'width':width,'height':c['height']})
                            else:
                                while current_font!=c['font']:
                                    direction='#larger' if current_font<c['font'] else '#smaller'
                                    await asyncio.wait_for(page.locator(direction).click(timeout=5000),timeout=6)
                                    current_font+=2 if direction=='#larger' else -2
                            ob=await asyncio.wait_for(frame(page),timeout=9)
                            problems=assess(ob,c,errors[start_errors:])
                            status='passed' if not problems else 'failed'
                        except Exception as e:
                            ob={};problems=['CASE_EXCEPTION:'+type(e).__name__+':'+str(e)[:150]];status='failed'
                        report['results'][c['id']]={'status':status,'errors':problems,
                            'font':c['font'],'width':c['width'],'height':c['height'],
                            'pageCount':ob.get('pages') if isinstance(ob,dict) else None}
                        report['lastRunAt']=datetime.now(timezone.utc).isoformat()
                        atomic_json(report_path,report)
                        print(c['id'],status,','.join(problems[:3]),flush=True)
                except Exception as e:
                    for c in group:
                        report['results'][c['id']]={'status':'failed','errors':['SHARD_START_FAILED:'+type(e).__name__+':'+str(e)[:150]],
                            'font':c['font'],'width':c['width'],'height':c['height']}
                        atomic_json(report_path,report)
                    print('SHARD_START_FAILED',kind,width,type(e).__name__,flush=True)
                finally:
                    await page.close()
        finally:
            await browser.close()
    return report,len(work)


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--html',required=True)
    ap.add_argument('--report',required=True)
    ap.add_argument('--force',action='store_true')
    ap.add_argument('--only-failed',action='store_true')
    ap.add_argument('--case',action='append',default=[])
    args=ap.parse_args()
    report,ran=asyncio.run(run_check(args.html,args.report,args.force,args.only_failed,args.case))
    allcases={c['id'] for c in cases()}
    done=sum(report['results'].get(i,{}).get('status')=='passed' for i in allcases)
    failures=[i for i in allcases if report['results'].get(i,{}).get('status')=='failed']
    print(json.dumps({'artifactSha256':report['artifactSha256'], 'checked':done,
       'expected':len(allcases),'failedCases':sorted(failures),'executedNow':ran,
       'status':'layout_pass_only' if done==len(allcases) and not failures else 'incomplete_or_failed',
       'sourceProofreading':'not_verified','canonical60':'not_verified',
       'iPhone':'not_verified','releaseEligible':False},ensure_ascii=False))
    return 0 if done==len(allcases) and not failures else 1
if __name__=='__main__':raise SystemExit(main())
