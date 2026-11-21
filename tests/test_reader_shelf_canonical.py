"""Synthetic four-stage output and preauthored reader fixtures; no private book content."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from reader_shelf_canonical import apply_merge
from reader_shelf_pack import pack, source_json, structured_sources


class CanonicalBookshelfTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.read = lambda name: (self.root / name).read_bytes()
        scans = [{'id':f's{i}','scan_number':i,'image_filename':f'originals/{i}.jpg'} for i in range(1,22)]
        text = ['最初のページ。','小さなエレベー','ターがある。']
        self.blocks = [dict(id=f'b{n}',kind='body',text=b,source_refs=[{'scan_id':f's{n}'}]) for n,b in zip((1,20,21),text)]
        self.blocks.append(dict(id='h1',kind='heading',text='入口',source_refs=[{'scan_id':'s1'}]))
        self.seams = [dict(left_body_id=a['id'],right_body_id=b['id'],left_suffix=a['text'],right_prefix=b['text'],
                           source_review_status='verified',display_boundary=how) for a,b,how in zip(self.blocks,self.blocks[1:],('paragraph','continue'))]
        bookid = 'synthetic-canonical'
        self.book = dict(schema_version='reader-bookdata-v1',book={'book_id':bookid,'template_profile':'world_history_1'},
                         scans=scans,notes=[],figures=[],joins=[],body_blocks=self.blocks,body_order=['b1','b20','b21'],
                         structure_reviews={'boundaries':self.seams})
        self.stream = dict(model_schema='reader-logical-stream-v1',book_id=bookid,template_profile='world_history_1',
                           source_scans=scans,notes=[],figures=[],structure_reviews=self.book['structure_reviews'],
                           body_text=''.join(text),body_text_sha256=hashlib.sha256(''.join(text).encode()).hexdigest(),
                           segments=[{'id':b['id'],'text':b['text']} for b in self.blocks[:3]],
                           layout_events=[{'type':'heading','heading_id':'h1'}]+[{'type':'body','body_id':b['id']} for b in self.blocks[:3]])
        self.manifest = dict(bookId=bookid,title='Test',template_profile='world_history_1',range=[1,21])

    def save(self):
        def write(name, obj):
            raw = json.dumps(obj,ensure_ascii=False).encode()
            (self.root / name).write_bytes(raw)
            return hashlib.sha256(raw).hexdigest()
        b = write('merged_bookdata.json',self.book)
        s = write('reader_logical_stream.json',self.stream)
        write('merge_report.json',dict(pipeline_version='four-stage-book-merge-request-v1',book_id=self.manifest['bookId'],
              template_profile=self.manifest['template_profile'], stages=[{'number':n,'status':'passed'} for n in range(1,5)],
              merged_bookdata_sha256=b,logical_stream_sha256=s,body_sha256=self.stream['body_text_sha256']))

    def test_report_drives_twenty_scan_pack_with_actual_layout_events_and_body_ids(self):
        self.save()
        loader = apply_merge(self.manifest,self.read)
        expected = [{'from':[20,0],'to':[21,0]}]
        self.assertEqual(structured_sources(self.manifest, loader),expected)
        raw = source_json(loader(self.manifest['segments'][0]['part']).decode(),'bookdata')
        self.assertEqual([b['id'] for b in raw['pages'][0]['blocks']],['h1','b1'])
        self.assertEqual(raw['pages'][1]['pageType'],'portrait')
        self.assertEqual(raw['toc'][0]['text'],'入口')
        self.assertEqual(self.manifest['segments'][0]['headings'],[{'scan':1,'text':'入口'}])
        self.assertEqual(self.manifest['originalScans']['21']['path'],'originals/21.jpg')
        self.assertEqual(self.manifest['readingFlow']['continuations'],expected)

    def test_authored_mixed_entries_keep_image_caption_note_and_ids_when_receiving_canonical_edge(self):
        self.book['figures']=self.stream['figures']=[{'id':'drawing','caption_text':'Drawing','source_refs':[{'scan_id':'s20'}]}]
        self.book['notes']=self.stream['notes']=[{'id':'n','text':'Note','source_refs':[{'scan_id':'s20'}]}]
        self.save()
        pages=[[{'kind':'text','scan':1,'blocks':[{'id':'h1','type':'heading','text':'入口'},self.blocks[0]]},
                {'kind':'text','scan':20,'blocks':[{'id':'n','type':'note','text':'Note'},self.blocks[1]]},
                {'kind':'image','scan':20,'src':'drawing.png','caption':'Drawing'}],
               [{'kind':'text','scan':21,'blocks':[self.blocks[2]]}]]
        self.manifest['segments'] = []
        for index, entries in enumerate(pages):
            src = '<script>window.READER_BOOK='+json.dumps({'kind':'mixed','entries':entries})+';</script>'
            name = f'{index}.html';(self.root/name).write_text(src)
            self.manifest['segments'].append(dict(part=name,start=1 if not index else 21,end=20+index))
        before = self.read('0.html')
        loader = apply_merge(self.manifest,self.read)
        self.assertEqual(loader('0.html'),before)
        self.assertEqual(self.manifest['readingFlow']['continuations'],[{'from':[20,1],'to':[21,0]}])
        data=json.loads(before.decode().split('window.READER_BOOK=',1)[1].split(';</script>')[0])
        for change in ('figure','order','extra'):
            with self.subTest(change=change):
                altered=json.loads(json.dumps(data))
                if change=='figure': altered['entries'].pop()
                if change=='order': altered['entries'][0]['blocks'].reverse()
                if change=='extra': altered['entries'][0]['blocks'].append({'type':'body','text':'追加'})
                (self.root/'0.html').write_text('<script>window.READER_BOOK='+json.dumps(altered)+';</script>')
                with self.assertRaises(ValueError):apply_merge(self.manifest,self.read)
        (self.root/'0.html').write_bytes(before)
        data=json.loads(self.read('0.html').decode().split('window.READER_BOOK=',1)[1].split(';</script>')[0])
        data['entries'][1]['blocks'][1]['text']='Different'
        (self.root/'0.html').write_text('<script>window.READER_BOOK='+json.dumps(data)+';</script>')
        with self.assertRaises(ValueError):
            apply_merge(self.manifest,self.read)

    def test_standalone_html_with_canonical_report_checks_and_retains_verified_seams(self):
        first, left, right, heading = self.blocks
        for structured in (False, True):
            with self.subTest(structured=structured):
                data = {'continuations':[{'from':[20,0],'to':[21,0]}]}
                groups = [(1, [{'id':heading['id'],'type':'heading','text':heading['text']}, first]),
                          (20,[left]), (21,[right])]
                if structured:
                    data['pages'] = [{'scan':n,'blocks':blocks,'figures':[]} for n,blocks in groups]
                else:
                    data.update(kind='mixed',entries=[{'kind':'text','scan':n,'blocks':blocks} for n,blocks in groups])
                html = '<!doctype html><html><script type="application/json" id="bookdata">'+json.dumps(data)+'</script></html>'
                (self.root/'reader.html').write_text(html)
                self.manifest['entry']='reader.html'
                self.save()
                manifest_path = self.root/'manifest.json'
                manifest_path.write_text(json.dumps(self.manifest))
                dest=self.root/f'standalone-{structured}.zip'
                saved=pack(manifest_path,dest)
                self.assertEqual(saved['readingFlow']['sourceRanges'],[[1,20],[21,21]])
                self.assertEqual(saved['readingFlow']['continuations'],data['continuations'])
                with zipfile.ZipFile(dest) as z:
                    self.assertEqual(z.read('reader.html').decode(),html)
                data['continuations'].clear()
                (self.root/'reader.html').write_text('<html><script type="application/json" id="bookdata">'+json.dumps(data)+'</script></html>')
                with self.assertRaisesRegex(ValueError,'全巻HTMLの改ページ'):
                    apply_merge(self.manifest,self.read)

    def test_pack_creates_global_heading_menu_and_two_storage_parts(self):
        self.save()
        (self.root/'originals').mkdir()
        for i in range(1,22):
            (self.root/'originals'/f'{i}.jpg').write_bytes(f'fake scan {i}'.encode())
        private=self.root/'manifest.json'
        private.write_text(json.dumps(self.manifest))
        archive=self.root/'edition.zip'
        saved=pack(private,archive)
        self.assertEqual(saved['segments'][0]['headings'],[{'scan':1,'text':'入口'}])
        self.assertEqual(saved['readingFlow']['continuations'],[{'from':[20,0],'to':[21,0]}])
        with zipfile.ZipFile(archive) as result:
            self.assertEqual(len(result.namelist()),24)
            self.assertEqual(result.read('originals/21.jpg'),b'fake scan 21')

    def test_canonical_novel_pack_uses_novel_reader_and_reviewed_dialogue(self):
        self.manifest['template_profile'] = self.book['book']['template_profile'] = self.stream['template_profile'] = 'novel'
        self.stream['segments'][1]['visual_dialogue_start'] = True
        self.seams[0]['display_boundary'] = 'dialogue'
        self.blocks[3]['source_heading_id'] = 'verified-source-head'
        self.save()
        (self.root/'originals').mkdir()
        for i in range(1,22):
            (self.root/'originals'/f'{i}.jpg').write_bytes(b'sample')
        private = self.root/'novel-manifest.json'
        private.write_text(json.dumps(self.manifest))
        archive = self.root/'novel.zip'
        saved = pack(private,archive)
        self.assertEqual(saved['template_profile'],'novel')
        self.assertEqual(saved['readingFlow']['sourceRanges'],[[1,20],[21,21]])
        self.assertEqual(saved['readingFlow']['continuations'],[{'from':[20,0],'to':[21,0]}])
        with zipfile.ZipFile(archive) as z:
            html=z.read('reader.html').decode()
        self.assertIn('window.NovelReader=',html)
        sample=html.partition('window.READER_BOOK=')[2]
        logical=json.JSONDecoder().raw_decode(sample)[0]
        self.assertEqual([b['type'] for b in logical['blocks']],['heading','body','dialogue','body'])
        self.assertTrue(logical['blocks'][-1]['joinPrevious'])
        self.assertEqual(logical['blocks'][0]['source_heading_id'],'verified-source-head')

    def test_rejects_stale_stream_and_unreviewed_missing_decision(self):
        self.save();(self.root/'reader_logical_stream.json').write_text('{}')
        with self.assertRaisesRegex(ValueError,'版が違います'):
            apply_merge(self.manifest,self.read)
        self.seams[-1]['source_review_status']='unknown';self.save()
        with self.assertRaisesRegex(ValueError,'確認済み語句'):
            apply_merge(self.manifest,self.read)


if __name__=='__main__':
    unittest.main()
