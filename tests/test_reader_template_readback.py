"""Browser regressions for the standalone standard and novel proof adapters."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import unittest
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from reader_template_readback import capture


class StandaloneReadback(unittest.TestCase):
    def test_both_templates_use_painted_text_and_ruby(self):
        chromium = os.getenv('CHROME_PATH') or os.getenv('CHROME_BIN') or os.getenv('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome')
        if not chromium:
            self.skipTest('Set CHROME_PATH to exercise browser rendering')
        original = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=')
        digest = hashlib.sha256(original).hexdigest()
        blocks = [dict(type='heading', scan=1, text='星空'), dict(type='body', scan=1, text='東京へ。'+'山の道。'*130,
                  ruby=[dict(base='東京',reading='とうきょう',start=0,end=2,sourceScan=1,sourceImageSha256=digest,
                             reviewStatus='verified',sourceBox=[0,0,1,1])]),
                  dict(type='body',scan=2,text='第二日。',joinPrevious=True)]
        for filename in ('mixed.html','novel.html'):
            with self.subTest(filename=filename), tempfile.TemporaryDirectory() as tmp:
                work = Path(tmp)
                src = ROOT/'templates/reader/v2'
                for lib in ('standard.css','novel.css','standard.js','novel.js','novel-dialogue.js'):
                    shutil.copy(src/lib,work/lib)
                source = 'data:image/png;base64,'+base64.b64encode(original).decode()
                entries = [dict(kind='text', scan=1, blocks=blocks),
                           dict(kind='image', scan=2, id='map', title='地図', src=source, caption='山の地図。')]
                book = dict(id='proof-fixture',kind='mixed',title='fixture',totalScans=2,entries=entries,
                            originals=[dict(scan=n,src=source) for n in (1,2)])
                html = re.sub(r'window.READER_BOOK=.+?;</script>',lambda _:'window.READER_BOOK='+json.dumps(book)+';</script>',(src/filename).read_text(),flags=re.S)
                # Change the rendered glyph only; the original data and pagination remain untouched.
                html = html.replace('</body>', """<script>
                  new MutationObserver(()=>{for(const n of document.querySelectorAll('#text-flow ruby')){
                    const it=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);
                    while(it.nextNode()){const t=it.currentNode;if(t.data.includes('京')&&!t.parentElement.closest('rt'))t.data=t.data.replace('京','亰');}
                  }}).observe(document.querySelector('#text-flow'),{childList:true,subtree:true});
                </script></body>""")
                (work/filename).write_text(html)
                pages=[]
                for scan in (1,2):
                    image=work/f'{scan}.png';image.write_bytes(original)
                    cfile=work/f'census-{scan}.json'
                    cfile.write_text(json.dumps(dict(scan=scan,sourceSha256=digest,completeScopes=['body','heading','ruby'],regions=[])))
                    pages.append(dict(scan=scan,image=dict(path=image.name,sha256=digest),
                                      census=dict(path=cfile.name,sha256=hashlib.sha256(cfile.read_bytes()).hexdigest())))
                inv = work/'inventory.json'
                inv.write_text(json.dumps(dict(bookId=book['id'],range=[1,2],pages=pages)))
                report=capture(work/filename,inv,work/'out.json',Path(chromium))
                first,second=report['pages']
                self.assertGreater(len(first['captures']),1)
                self.assertEqual(first['painted'][0]['value'],{'text':'星空','startsPage':True})
                body=first['painted'][1]
                self.assertEqual(body['value']['text'],blocks[1]['text'].replace('東京','東亰'))
                self.assertEqual((body['rubies'][0]['base'],body['rubies'][0]['reading']),('東亰','とうきょう'))
                self.assertEqual(second['painted'][0]['value']['text'],'第二日。')
                self.assertEqual([r['value']['sha256'] for r in second['painted'] if r['scope']=='figure'],[digest])
                self.assertEqual([r['value']['text'] for r in second['painted'] if r['scope']=='caption'],['山の地図。'])
                caption = next(r for r in second['painted'] if r['scope']=='caption')
                self.assertTrue(caption['value']['captionVisibility']['fullyVisible'])
                self.assertEqual(caption['value']['captionVisibility']['fragments'][0]['glyphs'],5)
                self.assertTrue(report['hostFiles'])
                # The deployed standalone format writes the archive entry into
                # read.html after the shelf opens it. Bundle external fixtures.
                inline = re.sub(r'<script src="(?:\./)?([^"]+)"></script>',
                    lambda m:'<script>'+(work/m[1]).read_text()+'</script>', html)
                inline = re.sub(r'<link rel="stylesheet" href="(?:\./)?([^"]+)">',
                    lambda m:'<style>'+(work/m[1]).read_text()+'</style>', inline)
                packed_html=work/'reader.html'
                packed_html.write_text(inline)
                raw=packed_html.read_bytes()
                archive=work/'book.zip'
                with ZipFile(archive,'w') as z:
                    z.writestr('reader.html',raw)
                    z.writestr('manifest.json',json.dumps(dict(schema=1,bookId=book['id'],title='fixture',
                        format='standalone-reader-html-v1',entry='reader.html',range=[1,2],sha256=hashlib.sha256(raw).hexdigest())))
                shelf=capture(packed_html,inv,work/'shelf.json',Path(chromium),route='shelf',archive=archive,site=ROOT)
                self.assertEqual(shelf['route'],'shelf')
                self.assertEqual(shelf['member'],'reader.html')
                self.assertEqual(shelf['archiveSha256'],hashlib.sha256(archive.read_bytes()).hexdigest())
                self.assertIn('reader/library/read.html',shelf['hostFiles'])
                self.assertEqual(shelf['pages'][1]['painted'],report['pages'][1]['painted'])
                # All text stays in the DOM, but only the first line can be seen.
                clipped=html.replace('</head>', '<style>#figure-caption{max-width:1.1em!important;max-height:1.5em!important;overflow:hidden!important}</style></head>')
                (work/filename).write_text(clipped)
                hidden=capture(work/filename,inv,work/'hidden.json',Path(chromium))
                observed=next(r for r in hidden['pages'][1]['painted'] if r['scope']=='caption')
                self.assertEqual(observed['value']['text'],'山の地図。')
                self.assertFalse(observed['value']['captionVisibility']['fullyVisible'])
                self.assertGreater(observed['value']['captionVisibility']['fragments'][0]['hidden'],0)
