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
from reader_shelf_pack import pack, structured_sources, review_seams, source_json

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

    def test_private_whole_source_preparation_checks_zip_bytes_without_delivery_authorization(self):
        source=hashlib.sha256(b'b').hexdigest()
        page={'scan':1,'sha256':source,'blocks':[],'width':1,'height':1,'dataUrl':'data:image/png;base64,Yg=='}
        book={'bookId':'sample','range':[1,1],'pages':[page]}
        data=('<script id="bookdata" type="application/json">'+json.dumps(book)+'</script>').encode()
        archive=self.root/'review.zip'
        with zipfile.ZipFile(archive,'w') as out:
            out.writestr('reader.html',data)
        manifest={'range':[1,1],'entry':'reader.html'}
        def ref(name,value):
            blob=json.dumps(value).encode()
            (self.root/name).write_bytes(blob)
            return {'path':name,'sha256':hashlib.sha256(blob).hexdigest()}
        review={'scan':1,'sourceSha256':source,'visualReview':'complete','method':'synthetic full blank-page inspection',
                'annotations':[],'corrections':[],'candidates':[],'unresolved':[]}
        record={'scan':1,'candidateSource':'visual-only','baseline':ref('before.json',page),'review':ref('check.json',review)}
        inv=self.root/'inventory.json'
        inv.write_text(json.dumps({'schema':'reader-ruby-inventory-v1','bookId':'sample','range':[1,1],'pages':[record]}))
        html_sha=hashlib.sha256(data).hexdigest()
        self.assertEqual(len(register.measure_source_ruby(archive,manifest,[html_sha],[inv],'sample')),1)
        with self.assertRaisesRegex(ValueError,'読書HTML'):
            register.measure_source_ruby(archive,manifest,['0'*64],[inv],'sample')

    def test_ruby_in_structured_pages_is_bound_to_the_packaged_original(self):
        self.parts[0]['continuations']=[self.edge]
        row=self.parts[0]['pages'][0]['blocks'][0]
        annotation={'start':0,'end':2,'base':'記録','reading':'きろく','sourceScan':1,
                    'sourceImageSha256':hashlib.sha256(b'b').hexdigest(),'sourceBox':[2,3,4,6],'reviewStatus':'verified'}
        row['ruby']=[dict(annotation,sourceImageSha256='0'*64)]
        with self.assertRaisesRegex(ValueError, 'ルビ'):self.make()
        row['ruby']=[annotation]
        archive,manifest=self.make()
        with zipfile.ZipFile(archive) as z:
            page=source_json(z.read(manifest['segments'][0]['part']).decode(),'bookdata')['pages'][0]
            changed_image = manifest['originalScans']['1']['path']
            with self.assertRaisesRegex(ValueError, 'ルビ'):
                structured_sources(manifest, lambda path: b'different scan' if path == changed_image else z.read(path))
        self.assertEqual(page['blocks'][0]['ruby'],[annotation])
        self.assertEqual(page['blocks'][0]['text'],'記録1')

    def test_standalone_original_image_handling_is_explicit(self):
        self.manifest.update(entry='reader.html', range=[1, 1])
        del self.manifest['segments']
        html=b'<html><body>Standalone example</body></html>'
        (self.root/'reader.html').write_bytes(html)
        manifest=self.root/'manifest.json'
        for mode in (None, 'blob-v1', 'other'):
            if mode:
                self.manifest['originalImageHandling']=mode
            manifest.write_text(json.dumps(self.manifest))
            dest=self.root/f'{mode}.zip'
            if mode=='other':
                with self.assertRaises(ValueError):
                    pack(manifest,dest)
                continue
            result=pack(manifest,dest)
            self.assertEqual(result.get('originalImageHandling'),mode)
            with zipfile.ZipFile(dest) as archive:
                self.assertEqual(archive.read('reader.html'),html)

    def test_standalone_bookdata_checks_ruby_even_without_any_seam(self):
        source=self.parts[0]['pages'][0]
        source['dataUrl']=source.pop('original')
        block=source['blocks'][0]
        ruby={'start':0,'end':2,'base':'記録','reading':'きろく','sourceScan':1,'sourceBox':[1,1,3,5],
              'sourceImageSha256':hashlib.sha256(b'b').hexdigest(),'reviewStatus':'verified'}
        self.manifest.update(entry='reader.html',range=[1,1]);del self.manifest['segments']
        manifest_path=self.root/'manifest.json';manifest_path.write_text(json.dumps(self.manifest))
        def write_reader():
            html='<html><script type="application/json" id="bookdata">'+json.dumps({'pages':[source]})+'</script></html>'
            (self.root/'reader.html').write_text(html)
            return html.encode()
        block['ruby']=[dict(ruby,start=1)];write_reader()
        with self.assertRaisesRegex(ValueError,'ルビ'):pack(manifest_path,self.root/'reject.zip')
        block['ruby']=[ruby];original=write_reader()
        dest=self.root/'good.zip';pack(manifest_path,dest)
        with zipfile.ZipFile(dest) as z:self.assertEqual(z.read('reader.html'),original)

    def test_new_structured_id_retains_originals_and_verified_edges(self):
        self.parts[0]['continuations']=[self.edge]
        dest,manifest=self.make()
        self.assertEqual(manifest['readingFlow']['format'],'structured-scan-flow-v1')
        self.assertEqual(len(manifest['originalScans']),22)
        with zipfile.ZipFile(dest) as z:
            self.assertEqual(z.read('originals/021.png'),b'b')
            self.assertEqual(z.read('1.html'),(self.root/'1.html').read_bytes())
        self.assertEqual(register.registration_flow(dest,manifest,self.ref,False)['edges'],[self.edge])

    def test_repack_compiled_template_resolves_embedded_original_by_index(self):
        from reader_shelf_template import template_html
        first = {'start':1,'end':1,'part':'first.json'}
        self.manifest.update(range=[1,1], segments=[first])
        source = {'id':'sample-new','kind':'text','blocks':[{
            'scan':1, 'text':'記録', 'ruby':[{'start':0,'end':2,'base':'記録','reading':'きろく','sourceScan':1,
            'sourceBox':[1,1,3,5],'sourceImageSha256':hashlib.sha256(b'b').hexdigest(),'reviewStatus':'verified'}]}],
            'originals':[{'scan':1,'src':'data:image/png;base64,Yg=='}]}
        compiled = template_html(self.manifest, lambda _: json.dumps(source).encode())
        standalone = dict(self.manifest, entry='reader.html')
        del standalone['segments']
        manifest = self.root/'manifest.json'
        manifest.write_text(json.dumps(standalone))
        reader = self.root/'reader.html'
        reader.write_bytes(compiled.replace(b'Yg==', b'YQ=='))
        with self.assertRaisesRegex(ValueError, 'ルビ'):
            pack(manifest, self.root/'reject.zip')
        reader.write_bytes(compiled)
        archive = self.root/'checked.zip'
        pack(manifest, archive)
        with zipfile.ZipFile(archive) as z:
            self.assertEqual(z.read('reader.html'), compiled)

    def test_poetry_contents_ruby_remains_bound_to_the_title_through_repacking(self):
        from reader_shelf_template import TemplateSource, template_html
        manifest = dict(self.manifest, range=[1,1], template_profile='novel', template_variant='poetry',
                        segments=[{'start':1,'end':1,'part':'first.json'}])
        annotation = {'start':0, 'end':1, 'base':'森', 'reading':'もり', 'sourceScan':1,
                      'sourceImageSha256':hashlib.sha256(b'b').hexdigest(), 'sourceBox':[2,3,4,6],
                      'reviewStatus':'verified'}
        row = {'type':'toc', 'scan':1, 'text':'森　7', 'ruby':[annotation],
               'printedContents':{'label':'森', 'number':'7', 'target':1}}
        source = {'id':'sample-new', 'kind':'text', 'blocks':[row],
                  'originals':[{'scan':1,'src':'data:image/png;base64,Yg=='}]}
        def render(changes, profile=manifest):
            content = {**source, 'blocks':[{**row, **changes}]}
            return template_html(profile, lambda _: json.dumps(content).encode())
        with self.assertRaisesRegex(ValueError, 'ルビ'):
            render({}, {k:v for k,v in manifest.items() if k != 'template_variant'})
        for change in ({'printedContents':None}, {'text':'林　7'},
                       {'ruby':[{**annotation,'start':2,'end':3,'base':'7'}]}):
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, 'ルビ'):
                render(change)
        compiled = render({})
        standalone = {k:v for k,v in manifest.items() if k != 'segments'}
        standalone['entry'] = 'reader.html'
        manifest_file = self.root/'manifest.json'
        manifest_file.write_text(json.dumps(standalone))
        (self.root/'reader.html').write_bytes(compiled)
        archive = self.root/'checked.zip'
        pack(manifest_file, archive)
        with zipfile.ZipFile(archive) as z:
            parser = TemplateSource()
            parser.feed(z.read('reader.html').decode())
            parser.close()
            self.assertEqual(parser.data['blocks'][0]['ruby'], [annotation])

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
