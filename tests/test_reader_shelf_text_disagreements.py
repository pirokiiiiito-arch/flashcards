import base64
import copy
import hashlib
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from PIL import Image

TOOLS = Path(__file__).resolve().parents[1]/'tools'
sys.path.insert(0, str(TOOLS))
from reader_text_disagreements import audit, check_summary


class DisagreementGate(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.archive = self.root/'edition.zip'
        self.manifest = {'range':[3,3], 'entry':'reader.html'}
        buffer = io.BytesIO()
        Image.new('L', (45,98), 255).save(buffer, format='PNG')
        self.image = buffer.getvalue()
        self.source_sha = hashlib.sha256(self.image).hexdigest()
        self.book = {
            'kind':'mixed', 'originals':[{'scan':3, 'src':'data:image/png;base64,'+
                                         base64.b64encode(self.image).decode()}],
            'entries':[{'kind':'text','scan':3,'type':'body','id':'b3','text':'原𠮷肩'}]}
        self.frozen = {'schema':'reader-ocr-observations-v1','bookId':'fixture','range':[3,3],
                       'pages':[{'scan':3,'sourceSha256':self.source_sha,'rows':[
                           {'region':'r1','box':[12,1,21,39],'primary':'原𠮷','alternate':'原𠮷','independent':'原𠮷'},
                           {'region':'r2','box':[2,3,10,20],'primary':'石','alternate':'肩','independent':'肩'}]}]}
        self.private = {'schema':'reader-text-disagreements-v1','bookId':'fixture','range':[3,3],
                        'pages':[{'scan':3,'sourceSha256':self.source_sha,'rows':[
                            {'region':'r1','blockId':'b3','start':0,'end':2},
                            {'region':'r2','blockId':'b3','start':2,'end':3}]}],
                        'decisions':[{'scan':3,'region':'r2','reading':'肩','method':'original-image','reviewedBy':'reader'}]}
        self.index = {'schema':'reader-shelf-proof-index-v1','bookId':'fixture','range':[3,3],'members':[]}

    def pin(self, name, obj):
        data = json.dumps(obj, ensure_ascii=False).encode()
        (self.root/name).write_bytes(data)
        return {'path':name,'sha256':hashlib.sha256(data).hexdigest()}

    def run_audit(self):
        books = self.book if isinstance(self.book, list) else [('reader.html',self.book)]
        with zipfile.ZipFile(self.archive,'w') as z:
            for name, book in books:
                z.writestr(name,'<script type="application/json" id="bookdata">'+json.dumps(book)+'</script>')
        archive_sha = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.private['archiveSha256'] = self.index['archiveSha256'] = archive_sha
        self.private['observations'] = self.pin('observations.json', self.frozen)
        self.index['textDisagreements'] = self.pin('decisions.json', self.private)
        self.pin('proof.json', self.index)
        result = audit(self.archive,archive_sha,self.manifest,'fixture',self.root/'proof.json')
        check_summary(result,3,3)
        return result

    def test_checked_conflict_even_if_two_engines_agree(self):
        summary = self.run_audit()
        self.assertEqual(summary['batches'],[[3,3,1,1]])
        self.private['decisions'].clear()
        with self.assertRaisesRegex(ValueError,'未解決'):
            self.run_audit()

    def test_independent_only_variance_and_missing_recognition(self):
        row=self.frozen['pages'][0]['rows'][1]
        row.update(primary='肩',alternate='肩',independent='別')
        self.assertEqual(self.run_audit()['detected'],1)
        row['independent']=None
        self.assertEqual(self.run_audit()['detected'],0)
        self.private['decisions'].clear()
        with self.assertRaisesRegex(ValueError,'未解決'):
            self.run_audit()

    def test_new_registration_cannot_hide_the_inventory(self):
        self.run_audit()
        self.index.pop('textDisagreements')
        self.pin('proof.json', self.index)
        for path in (self.root/'proof.json',None):
            with self.assertRaisesRegex(ValueError,'本文OCR不一致'):
                audit(self.archive,self.index['archiveSha256'],self.manifest,'fixture',path)
        self.private['pages'][0]['rows'].pop()
        with self.assertRaisesRegex(ValueError,'凍結'):
            self.run_audit()
        self.frozen['pages'][0]['rows'].pop()
        self.private['decisions'].clear()
        with self.assertRaisesRegex(ValueError,'本文全体'):
            self.run_audit()

    def test_unchanged_reading_must_be_in_final_payload_and_pin_its_own_source(self):
        self.book['entries'][0]['text'] = '原𠮷石'
        with self.assertRaisesRegex(ValueError,'読書HTMLの文字'):
            self.run_audit()
        self.book['entries'][0]['text'] = '原𠮷肩'
        self.private['pages'][0]['sourceSha256']='0'*64
        with self.assertRaisesRegex(ValueError,'元画像'):
            self.run_audit()

    def test_duplicate_placement_and_tampering_with_primary(self):
        self.private['pages'][0]['rows'][1]['primary']='肩'
        with self.assertRaisesRegex(ValueError,'変更'):
            self.run_audit()
        del self.private['pages'][0]['rows'][1]['primary']
        self.private['pages'][0]['rows'][1]['start']=1
        self.private['decisions'][0]['reading']='𠮷肩'
        with self.assertRaisesRegex(ValueError,'抜けまたは重複'):
            self.run_audit()

    def test_primary_fallback_with_missing_independent_requires_source_again(self):
        row=self.frozen['pages'][0]['rows'][0]
        row.update(mode='source-transcribed',primary=None,alternate=None,independent=None)
        with self.assertRaisesRegex(ValueError,'未解決'):
            self.run_audit()
        self.private['decisions'].append(dict(scan=3,region='r1',reading='原𠮷',method='original-image',reviewedBy='reader'))
        self.assertEqual(self.run_audit()['resolved'],1)

    def test_image_only_has_no_invented_ocr_and_cannot_mask_a_text_book(self):
        self.frozen['pages'][0]['rows']=[]
        self.private['pages'][0].update(rows=[],noBody=dict(method='original-image',reviewedBy='reader'))
        self.private['decisions']=[]
        with self.assertRaisesRegex(ValueError,'本文領域'):
            self.run_audit()
        self.book['kind']='image'
        self.book['figures']=[]
        del self.book['entries']
        self.assertEqual(self.run_audit()['detected'],0)

    def test_cancelled_intrusion_has_a_verified_empty_anchor(self):
        self.frozen['pages'][0]['rows'].append(dict(region='r3',box=[30,4,38,10],
                                                   primary='x',alternate='',independent=''))
        self.private['pages'][0]['rows'].append(dict(region='r3',blockId='b3',start=1,end=1))
        self.private['decisions'].append(dict(scan=3,region='r3',reading='',method='original-image',reviewedBy='reader'))
        self.assertEqual(self.run_audit()['detected'],2)

    def test_multi_member_readback_cannot_omit_a_differing_display(self):
        self.manifest = {'range':[3,3], 'segments':[{'start':3,'end':3,'part':'part.html','display':{'path':'display.html'}}]}
        book = self.book
        self.book = [('part.html',book),('display.html',copy.deepcopy(book))]
        for r in self.private['pages'][0]['rows']:
            r['placements'] = [dict(member=m,blockId=r['blockId'],start=r['start'],end=r['end']) for m,_ in self.book]
        self.assertEqual(self.run_audit()['detected'],1)
        self.book[1][1]['entries'][0]['text']='原𠮷石'
        with self.assertRaisesRegex(ValueError,'読書HTMLの文字'):
            self.run_audit()
        self.private['pages'][0]['rows'][1]['placements'].pop()
        with self.assertRaisesRegex(ValueError,'読戻しが不足'):
            self.run_audit()

    def test_coordinate_clipping_keeps_boundary_and_preserves_original_disagreement(self):
        self.frozen['pages'][0]['independentTsvSha256']='0'*64
        with self.assertRaisesRegex(ValueError,'位置で照合'):
            self.run_audit()
        geometry={'schema':'reader-independent-geometry-v1','bookId':'fixture','range':[3,3],'pages':[
            {'scan':3,'sourceSha256':self.source_sha,'rows':[
                {'region':'r1','tokens':[{'box':[11,1,20,38],'text':'原𠮷'}]},
                {'region':'r2','tokens':[{'box':[2,0,10,3],'text':'外'},{'box':[1,2,9,18],'text':'肩'}]}]}]}
        self.private['coordinateInputs']=self.pin('spatial.json',geometry)
        self.assertEqual(self.run_audit()['resolved'],1)
        self.private['decisions'].clear()
        with self.assertRaisesRegex(ValueError,'未解決'):
            self.run_audit()
        geometry['pages'][0]['rows'][1]['tokens'][0]['box'][3]=4
        self.private['coordinateInputs']=self.pin('spatial.json',geometry)
        with self.assertRaisesRegex(ValueError,'本文枠内'):
            self.run_audit()

    def test_prior_warning_must_survive_subsequent_matching_reads(self):
        self.frozen['pages'][0]['rows'][0]['priorDisagreement']=True
        with self.assertRaisesRegex(ValueError,'未解決'):
            self.run_audit()

    def test_registration_summary_cannot_accept_skipped_or_unsupported_evidence(self):
        good=self.run_audit()
        for bad in [None, good|{'pending':1}, good|{'resolved':0}, good|{'batches':[]},
                    good|{'batches':[[3,3,1,0]]}, good|{'batches':[[3,4,1,1]]}]:
            with self.assertRaises(ValueError):
                check_summary(bad,3,3)
