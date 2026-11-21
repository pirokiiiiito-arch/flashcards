import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]/'tools'
sys.path.insert(0,str(TOOLS))
from reader_shelf_pack import pack, structured_sources, review_seams

spec=importlib.util.spec_from_file_location('shelf_register',TOOLS/'reader-shelf-register.py')
register=importlib.util.module_from_spec(spec)
spec.loader.exec_module(register)


class Pack(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.ref={'bookId':'sample-new','profile':'world_history_1','modes':['text']}
        self.manifest={'schema':1,'bookId':'sample-new','title':'確認','template_profile':'world_history_1','range':[1,22],
                       'segments':[{'start':1,'end':20,'part':'1.html'},{'start':21,'end':22,'part':'2.html'}]}
        self.edge={'from':[20,0],'to':[21,0]}
        self.parts=[]
        for part in self.manifest['segments']:
            pages=[{'scan':n,'original':'data:image/png;base64,Yg==','figures':[],'blocks':[{'id':str(n),'type':'body','text':'記録'+str(n)}]}
                   for n in range(part['start'],part['end']+1)]
            self.parts.append({'bookId':'sample-new','range':[part['start'],part['end']],'pages':pages,'continuations':[]})
    def write(self):
        tag=lambda name,v:'<script type="application/json" id="'+name+'">'+json.dumps(v)+'</script>'
        for part,data in zip(self.manifest['segments'],self.parts):
            (self.root/part['part']).write_text('<html><head><meta name="viewport" content="width=device-width,user-scalable=yes,maximum-scale=5"></head>'+tag('reader-verified-structure',{'model':{'book_id':'sample-new'}})+tag('bookdata',data)+'</html>')
        p=self.root/'manifest.json'
        p.write_text(json.dumps(self.manifest))
        return p
    def make(self,reviews=None):
        dest=self.root/'packed.zip'
        pack(self.write(),dest,reviews)
        with zipfile.ZipFile(dest) as z:
            return dest,json.loads(z.read('manifest.json'))
    def decision(self,kind):
        return {'source_review_status':'verified','display_boundary':kind,'left_body_id':'20','right_body_id':'21','left_suffix':'録20','right_prefix':'記録21'}

    def test_new_structured_id_retains_originals_and_verified_edges(self):
        self.parts[0]['continuations']=[self.edge]
        dest,manifest=self.make()
        self.assertEqual(manifest['readingFlow']['format'],'structured-scan-flow-v1')
        self.assertEqual(len(manifest['originalScans']),22)
        with zipfile.ZipFile(dest) as z:
            self.assertEqual(z.read('originals/021.png'),b'b')
            self.assertEqual(z.read('1.html'),(self.root/'1.html').read_bytes())
        self.assertEqual(register.registration_flow(dest,manifest,self.ref,False)['edges'],[self.edge])

    def test_premerged_review_still_binds_the_real_html(self):
        self.manifest.pop('segments')
        self.manifest['entry']='existing.html'
        self.manifest['structure_reviews']={'boundaries':[self.decision('continue')]}
        book={'kind':'text','blocks':[{'type':'body','scan':n,'id':str(n),'text':'記録'+str(n),
                                     'joinPrevious':n==21} for n in (20,21)]}
        html='<html><script>window.READER_BOOK='+json.dumps(book)+';</script></html>'
        (self.root/'existing.html').write_text(html)
        spec=self.root/'manifest.json'
        spec.write_text(json.dumps(self.manifest))
        dest=self.root/'checked.zip'
        m=pack(spec,dest)
        self.assertEqual(register.registration_flow(dest,m,self.ref,False)['edges'],[self.edge])
        with zipfile.ZipFile(dest) as z:
            self.assertEqual(z.read('reader.html'),html.encode())

    def test_missing_seam_fails_without_writing_an_archive(self):
        with self.assertRaisesRegex(ValueError,'20→21'):
            self.make()
        self.assertFalse((self.root/'packed.zip').exists())

    def test_four_stage_review_links_existing_parts_without_reediting(self):
        f=self.root/'review.json';f.write_text(json.dumps({'book_id':'sample-new','structure_reviews':{'boundaries':[self.decision('continue')]}}))
        dest,m=self.make(f)
        self.assertEqual(m['readingFlow']['continuations'],[self.edge])
        self.assertEqual(register.registration_flow(dest,m,self.ref,False)['edges'],[self.edge])

    def test_verified_paragraph_stays_separate(self):
        self.manifest['structure_reviews']={'boundaries':[self.decision('paragraph')]}
        dest,m=self.make()
        self.assertEqual(register.registration_flow(dest,m,self.ref,False)['edges'],[])
        self.assertEqual(m['readingFlow']['boundaryReviews'][0]['display_boundary'],'paragraph')

    def test_rejects_wrong_or_unbound_review(self):
        self.manifest['structure_reviews']={'boundaries':[dict(self.decision('paragraph'),left_suffix='誤り')]}
        with self.assertRaisesRegex(ValueError,'照合|語句'):
            self.make()

    def test_unrelated_paragraph_pair_does_not_cover_another_seam(self):
        row=dict(self.decision('paragraph'),left_body_id='1',left_suffix='録1')
        self.manifest['structure_reviews']={'boundaries':[row]}
        with self.assertRaisesRegex(ValueError,'20→21'):
            self.make()

    def test_absent_prose_needs_no_fabricated_edges(self):
        for b in self.parts:
            for p in b['pages']:
                p['blocks']=[];p['pageType']='portrait'
        _,m=self.make()
        self.assertEqual(m['readingFlow']['boundaryReviews'],[])

    def test_different_declared_and_source_review_blocks_publication(self):
        self.parts[0]['continuations']=[self.edge]
        dst,m=self.make()
        with self.assertRaisesRegex(ValueError,'接続が一致'):
            register.registration_flow(dst,m,dict(self.ref,continuations=[]),False)

    def test_new_opaque_multifile_body_is_never_signed_as_continuous(self):
        path=self.root/'opaque.zip'
        with zipfile.ZipFile(path,'w') as z:
            z.writestr('1.html','<html>legacy</html>')
            z.writestr('2.html','<html>legacy</html>')
        with self.assertRaisesRegex(ValueError,'bookdata'):
            register.registration_flow(path,self.manifest,self.ref,False)
        self.assertIsNone(register.registration_flow(path,self.manifest,self.ref,True))


if __name__=='__main__':
    unittest.main()
