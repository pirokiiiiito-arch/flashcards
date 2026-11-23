import binascii
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
import zlib

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from reader_caption_census import audit, rows_digest, sha


def png():
    def chunk(name,value):
        return struct.pack('>I',len(value))+name+value+struct.pack('>I',binascii.crc32(name+value))
    return (b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',100,100,8,0,0,0,0))+
            chunk(b'IDAT',zlib.compress(b'\0'*(101*100)))+chunk(b'IEND',b''))


class CaptionBook:
    """Two independent source documents and two separate painted observations per scan."""
    def __init__(self,root,n=1):
        self.root=root;self.n=n;self.source=sha(png())
        self.pages={};self.docs={};self.obs={'part':{},'shelf':{}}
        for scan in range(1,n+1):
            page={'scan':scan,'source':self.write(f'{scan}.png',png())}
            identity={'scan':scan,'sourceSha256':self.source}
            self.pages[scan]=page
            self.docs[scan]={
              'census':dict(identity,reviewedBy='原本図版目録',wholePage=True,figures=[],captions=[]),
              'review':dict(identity,reviewedBy='原本の全面再確認',wholePage=True,blindToOutput=True,figureIds=[],captions=[]),
              'ocr':dict(scan=scan,source_sha256=self.source,width=100,height=100,rows=[]),
              'ocrAudit':dict(identity,reviewedBy='元OCRとの照合',decisions=[])}
            for route in self.obs:
                self.obs[route][scan]=dict(scan=scan,sourceSha256=self.source,unhandled=[],painted=[],
                                          captures=[self.write(f'{route}-{scan}.png',png())|{'page':0}])
    def write(self,name,data):
        (self.root/name).write_bytes(data)
        return {'path':name,'sha256':sha(data)}
    def figure(self,scan,ident,capids,image=None):
        digest=image or sha(ident.encode());c=self.docs[scan]
        c['census']['figures'].append(dict(id=ident,box=[2,3,40,40],captionIds=capids,imageSha256=digest))
        c['review']['figureIds'].append(ident)
        return digest
    def caption(self,scan,ident,owners,text,ruby=None,row_ids=None):
        c=self.docs[scan]
        c['census']['captions'].append(dict(id=ident,box=[10,50,85,80],figureIds=owners,rowIds=row_ids or []))
        c['review']['captions'].append(dict(id=ident,figureIds=owners,text=text,rubies=ruby or [],ocrOmissionReason='原本で目視転記。OCR未検出'))
    def paint(self,scan,images,text=None,ruby=None):
        for route in self.obs:
            for i,im in enumerate(images):
                self.obs[route][scan]['painted'].append(dict(key=f'figure-0-{i}',scope='figure',value={'sha256':im},pageIndexes=[0]))
            if text is not None:
                self.obs[route][scan]['painted'].append(dict(key='caption-0',scope='caption',value={'text':text,
                    'captionVisibility':{'fullyVisible':True,'fragments':[dict(page=0,fullyVisible=True,glyphs=len(text))]} },
                    pageIndexes=[0],rubies=ruby or [],fragments=[dict(page=0,start=0,end=len(text))]))
    def save(self,refresh=True):
        for n,d in self.docs.items():
            for name in ('census','review','ocr','ocrAudit'):
                if name=='ocrAudit' and refresh:
                    d[name].update(rawSha256=self.pages[n]['ocr']['sha256'],rowCount=len(d['ocr']['rows']),
                                   rowsSha256=rows_digest(d['ocr']['rows']))
                self.pages[n][name]=self.write(f'{n}-{name}.json',json.dumps(d[name],ensure_ascii=False).encode())
        p=self.root/'index.json'
        if not hasattr(self,'origin') or refresh:
            self.origin=self.write('original-ocr.json',json.dumps(dict(schema='reader-caption-ocr-origin-v1',bookId='fixture',
                range=[1,self.n],pages=[dict(scan=n,sourceSha256=self.source,rawSha256=r['ocr']['sha256']) for n,r in self.pages.items()])).encode())
        p.write_text(json.dumps(dict(schema='reader-caption-census-v1',bookId='fixture',range=[1,self.n],pages=list(self.pages.values()),originalOcrSources=self.origin)))
        return p
    def readbacks(self):
        return {r:[(self.root/(r+'.json'),dict(schema='reader-proof-readback-v1',bookId='fixture',route=r,
            artifactSha256=sha(r.encode()),archiveSha256='a'*64,range=[1,self.n],pages=list(pages.values())))] for r,pages in self.obs.items()}
    def run(self,refresh=True,**kwargs):
        return audit(self.save(refresh),book_id='fixture',scan_range=[1,self.n],source_hashes={n:self.source for n in self.pages},
                     readbacks=self.readbacks(),**kwargs)


class TestReaderCaptionCensus(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
    def tearDown(self):
        self.temp.cleanup()
    def test_independently_checked_zero_figures_and_explicit_no_caption(self):
        b=CaptionBook(self.root,2);img=b.figure(2,'art',[]);b.paint(2,[img]);self.assertEqual(b.run()['status'],'complete')
        del b.docs[2]['census']['figures'][0]['captionIds'];self.assertEqual(b.run()['pendingScans'],[2])
        b.docs[1]['review']['wholePage']=False;self.assertEqual(b.run()['pendingScans'],[1,2])
    def test_missing_page_missing_independent_source_and_wrong_hash(self):
        b=CaptionBook(self.root,3);p=b.save();d=json.loads(p.read_bytes());d['pages'].pop(1)
        d['pages'][0]['review']=d['pages'][0]['census'];p.write_text(json.dumps(d))
        r=audit(p,book_id='fixture',scan_range=[1,3],readbacks=b.readbacks(),
                source_hashes={1:b.source,2:b.source,3:'0'*64})
        self.assertEqual(r['pendingScans'],[1,2,3])
    def test_full_source_ocr_pins_not_selected_rows(self):
        b=CaptionBook(self.root);r={'box':[2,3,28,10],'text':'図説'};b.docs[1]['ocr']['rows']=[r,r|{'text':'の。'}]
        b.save();b.docs[1]['ocr']['rows'].pop()
        self.assertIn('MISSING_OR_CHANGED_ORIGINAL_OCR_EXPORT',[v['code'] for v in b.run(refresh=False)['pages'][0]['issues']])
    def test_candidates_require_disposition_even_without_preassigned_caption(self):
        b=CaptionBook(self.root);im=b.figure(1,'f',[]);b.paint(1,[im])
        b.docs[1]['ocr']['rows']=[dict(id='body-or-caption',box=[2,41,35,46],text='所属を確認')]
        self.assertEqual(b.run()['pendingScans'],[1])
        b.docs[1]['ocrAudit']['decisions']=[dict(figureId='f',rowId='body-or-caption',disposition='body',reason='本文の続き')]
        self.assertEqual(b.run()['status'],'complete')
    def test_unassigned_short_ending_from_column_ocr(self):
        b=CaptionBook(self.root);im=b.figure(1,'f',['c']);b.caption(1,'c',['f'],'描いたもの。',row_ids=['r1'])
        b.docs[1]['ocr']['rows']=[dict(id='r1',box=[2,42,40,48],text='描いたも'),dict(id='r2',box=[2,50,8,56],text='の。')]
        b.paint(1,[im],'描いたもの。')
        self.assertIn('UNREVIEWED_CAPTION_ENDING',[x['code'] for x in b.run()['pages'][0]['issues']])
        b.docs[1]['census']['captions'][0]['rowIds'].append('r2')
        self.assertEqual(b.run()['status'],'complete')
    def test_cross_twenty_shared_caption_join_rebases_ruby(self):
        b=CaptionBook(self.root,21)
        a=b.figure(20,'a',['first','rest']);c=b.figure(20,'b',['first','rest'])
        b.caption(20,'first',['a','b'],'絵を');b.caption(21,'rest',['a','b'],'描いた。',[dict(start=0,end=1,base='描',reading='えが')])
        b.paint(20,[a,c],'絵を描いた。',[dict(start=2,end=3,base='描',reading='えが')])
        self.assertEqual(b.run()['status'],'complete')
        b.obs['shelf'][20]['painted'][-1]['rubies'][0]=dict(start=2,end=3,base='描',reading='か')
        result=b.run();self.assertEqual(result['pendingScans'],[20,21])
        self.assertEqual([t['pendingScans'] for t in result['batches']],[[20],[21]])
    def test_wrong_order_duplicate_and_extra_or_missing_caption_in_either_route(self):
        b=CaptionBook(self.root);a=b.figure(1,'a',['c']);d=b.figure(1,'b',['c'])
        b.caption(1,'c',['a','b'],'原本の全文。');b.paint(1,[a,d],'原本の全文。')
        self.assertEqual(b.run()['status'],'complete')
        rows=b.obs['part'][1]['painted']
        rows[0]['value'],rows[1]['value']=rows[1]['value'],rows[0]['value'];self.assertEqual(b.run()['status'],'partial')
        rows[0]['value'],rows[1]['value']=rows[1]['value'],rows[0]['value'];rows.append(rows[-1])
        self.assertEqual(b.run()['status'],'partial')
        rows.pop();rows[-1]['value']['text']='原本の全文';self.assertEqual(b.run()['status'],'partial')
        rows.pop();self.assertEqual(b.run()['status'],'partial')
    def test_original_carrier_without_figures_or_containing_source_figure(self):
        b=CaptionBook(self.root,2)
        for n in (1,2):
            b.docs[n]['census']['originalCarrier']={}
            b.paint(n,[b.source])
            for route in b.obs:
                fig=b.obs[route][n]['painted'][0];fig['key']='image-0'
                fig['imageDisplay']=dict(fullyVisible=True,naturalWidth=100,naturalHeight=100)
        b.figure(2,'printed',[],b.source);b.docs[2]['census']['figures'][0]['viaOriginal']=True
        self.assertEqual(b.run()['status'],'complete')
        b.obs['part'][2]['painted'][0]['imageDisplay']['fullyVisible']=False
        self.assertEqual(b.run()['pendingScans'],[2])
    def test_capture_hash_and_published_readback_binding(self):
        b=CaptionBook(self.root,2)
        self.assertEqual(b.run(archive_sha256='b'*64)['pendingScans'],[1,2])
        self.assertEqual(b.run(artifact_sha256='b'*64)['pendingScans'],[1,2])
        self.assertEqual(b.run(index_sha256='b'*64)['pendingScans'],[1,2])
        b.obs['part'][1]['captures'][0]['sha256']='f'*64;self.assertEqual(b.run()['pendingScans'],[1])
    def test_wrong_group_attribution_and_empty_ruby_or_split_caption(self):
        b=CaptionBook(self.root);a=b.figure(1,'a',['c']);z=b.figure(1,'z',[]);b.caption(1,'c',['a'],'原本')
        b.paint(1,[a,z],'原本');self.assertEqual(b.run()['status'],'partial')
        for route in b.obs:b.obs[route][1]['painted'][1]['key']='figure-1-0'
        self.assertEqual(b.run()['status'],'complete')
        b.obs['part'][1]['painted'][-1]['fragments'][0]['start']=1;self.assertEqual(b.run()['status'],'partial')
    def test_distinct_source_pass_required_on_same_reviewer(self):
        b=CaptionBook(self.root);a=b.docs[1]['census'];r=b.docs[1]['review'];r['reviewedBy']=a['reviewedBy']
        self.assertEqual(b.run()['status'],'partial')
        a['passId']='source-inventory';r['passId']='independent-read';r['blindToCensus']=True
        self.assertEqual(b.run()['status'],'complete')
    def test_ocr_entirely_missed_print_and_impossible_painted_page_number(self):
        b=CaptionBook(self.root);a=b.figure(1,'f',['c']);b.caption(1,'c',['f'],'原文');b.paint(1,[a],'原文')
        del b.docs[1]['review']['captions'][0]['ocrOmissionReason']
        self.assertEqual(b.run()['status'],'partial')
        b.docs[1]['review']['captions'][0]['ocrOmissionReason']='印刷図説を拡大して読んだ。OCR行はなし'
        self.assertEqual(b.run()['status'],'complete')
        row=b.obs['shelf'][1]['painted'][-1];row['fragments'][0]['page']=10000;row['pageIndexes']=[10000]
        self.assertIn('READBACK_REFERENCES_UNCAPTURED_SCREEN',[i['code'] for i in b.run()['pages'][0]['issues']])
    def test_batch_selects_neighboring_original_sources_and_readers(self):
        b=CaptionBook(self.root,21);im=b.figure(20,'a',['on-next-sheet'])
        b.caption(21,'on-next-sheet',['a'],'続く。');b.paint(20,[im],'続く。')
        def first():
            return audit(b.save(),book_id='fixture',scan_range=[1,20],readbacks=b.readbacks())
        self.assertEqual(first()['status'],'complete')
        del b.obs['part'][21];self.assertEqual(first()['pendingScans'],[20])
    def test_repinning_partial_ocr_and_audit_does_not_replace_original_export(self):
        b=CaptionBook(self.root);b.docs[1]['ocr']['rows']=[dict(box=[2,2,18,11],text='元の行')]
        b.save();old=(b.root/'original-ocr.json').read_bytes();b.docs[1]['ocr']['rows']=[]
        p=b.save();index=json.loads(p.read_bytes());index['originalOcrSources']=b.write('original-intake.json',old)
        p.write_text(json.dumps(index));r=audit(p,book_id='fixture',scan_range=[1,1],readbacks=b.readbacks())
        self.assertEqual(r['pendingScans'],[1])
    def test_declared_pending_ocr_page_is_not_a_global_problem(self):
        b=CaptionBook(self.root,2);index=b.save();doc=json.loads(index.read_bytes());orig=json.loads((b.root/'original-ocr.json').read_bytes())
        orig['pages'][1]['sourceSha256']=None;orig['pages'][1]['rawSha256']=None
        doc['originalOcrSources']=b.write('original-ocr.json',json.dumps(orig).encode())
        index.write_text(json.dumps(doc))
        result=audit(index,book_id='fixture',scan_range=(1,2),readbacks=b.readbacks())
        self.assertEqual(result['pendingScans'],[2])

    def test_partial_index_preserves_progress_and_counts_only_reviewed_figures(self):
        b=CaptionBook(self.root,2)
        figure=b.figure(2,'sketch',['legend'])
        b.caption(2,'legend',['sketch'],'原本の図。')
        b.paint(2,[figure],'原本の図。')
        result=audit(b.save(),book_id='fixture',scan_range=[1,23],readbacks=b.readbacks())
        self.assertEqual(result['pendingScans'],list(range(3,24)))
        self.assertEqual([row['pendingScans'] for row in result['batches']],
                         [list(range(3,21)),[21,22,23]])
        self.assertEqual([p.get('checkedFigures') for p in result['pages'][:3]],[0,1,None])
        self.assertEqual([p.get('checkedCaptions') for p in result['pages'][:3]],[0,1,None])

    def test_whole_book_readback_can_verify_a_later_partial_source_index(self):
        b=CaptionBook(self.root,5)
        p=b.save()
        index=json.loads(p.read_bytes()); index['range']=[3,4]; index['pages']=index['pages'][2:4]
        origins=json.loads((b.root/'original-ocr.json').read_bytes())
        origins['range']=[3,4];origins['pages']=origins['pages'][2:4]
        index['originalOcrSources']=b.write('ocr-batch.json',json.dumps(origins).encode())
        p.write_text(json.dumps(index))
        result=audit(p,book_id='fixture',scan_range=[2,5],readbacks=b.readbacks())
        self.assertEqual(result['pendingScans'],[2,5])

    def test_bad_neighbor_binding_affects_only_a_genuinely_linked_page(self):
        b=CaptionBook(self.root,21)
        figure=b.figure(20,'f',['legend-on-21'])
        b.caption(21,'legend-on-21',['f'],'次の紙面の図説。')
        b.paint(20,[figure],'次の紙面の図説。')
        receipts=b.readbacks()
        result=audit(b.save(),book_id='fixture',scan_range=[1,20],readbacks=receipts,
                     page_issues={21:['CAPTION_WRONG_ARCHIVE_MEMBER']})
        self.assertEqual(result['pendingScans'],[20])
        receipt=receipts['shelf'][0][1]
        receipts['shelf'].append((self.root/'irrelevant.json',dict(receipt,route='part',range=[41,60])))
        result=audit(b.save(),book_id='fixture',scan_range=[1,20],readbacks=receipts)
        self.assertEqual(result['pendingScans'],[])
    def test_multiple_figures_with_individually_painted_legends(self):
        b=CaptionBook(self.root);a=b.figure(1,'a',['capA']);z=b.figure(1,'z',['capZ'])
        b.caption(1,'capA',['a'],'最初');b.caption(1,'capZ',['z'],'別の図');b.paint(1,[a,z],'最初')
        for j,f in enumerate(b.docs[1]['census']['figures']):f['labelCaptionIds']=f['captionIds']
        for route in b.obs:
            out=b.obs[route][1]['painted'];a=out[-1];a['key']='figure-label-0-0';z=json.loads(json.dumps(a))
            z.update(key='figure-label-0-1');z['value']['text']='別の図';z['fragments'][0]['end']=3;out.append(z)
        self.assertEqual(b.run()['status'],'complete')
        b.obs['shelf'][1]['painted'][-1]['value']['text']='最初';self.assertEqual(b.run()['status'],'partial')
    def test_template_single_figure_and_missing_or_partly_clipped_caption(self):
        b=CaptionBook(self.root);im=b.figure(1,'figure',['cap']);b.caption(1,'cap',['figure'],'図説');b.paint(1,[im],'図説')
        for route in b.obs:b.obs[route][1]['painted'][0]['key']='figure-0'
        self.assertEqual(b.run()['status'],'complete')
        val=b.obs['shelf'][1]['painted'][-1]['value']
        val['captionVisibility']['fragments'][0]['fullyVisible']=False;self.assertEqual(b.run()['status'],'partial')
        del val['captionVisibility'];self.assertEqual(b.run()['status'],'partial')
    def test_missing_source_and_missing_render_never_become_none(self):
        b=CaptionBook(self.root,2);del b.obs['shelf'][1]
        self.assertEqual(b.run()['pendingScans'],[1])
        self.assertEqual(audit(None,book_id='fixture',scan_range=(1,21))['pendingScans'],list(range(1,22)))


if __name__=='__main__':
    unittest.main()
