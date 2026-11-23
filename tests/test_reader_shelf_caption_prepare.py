import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import reader_caption_prepare as prepare


class CaptionWorkTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.work = self.root / 'review'
        self.image = self.root / 'source.png'
        Image.new('RGB', (100, 80), 'white').save(self.image)
        self.raw = self.root / 'ocr.json'
        self.put_ocr([])
        self.manifest = self.root / 'source-list.json'
        self.sources = {'bookId': 'example', 'range': [1, 21],
                        'pages': [{'scan': 1, 'source': self.image.name, 'ocr': self.raw.name}]}

    def put_ocr(self, rows):
        self.raw.write_bytes(prepare.json_bytes({
            'scan': 1, 'width': 100, 'height': 80, 'rows': rows,
            'source_sha256': hashlib.sha256(self.image.read_bytes()).hexdigest()}))

    def start(self):
        self.manifest.write_bytes(prepare.json_bytes(self.sources))
        return prepare.init(self.manifest, self.work)

    def test_every_page_including_last_partial_batch_starts_unreviewed(self):
        index = self.start()
        prepare.sheets(index, self.work)
        self.assertEqual(list(range(1, 22)), [p['scan'] for p in index['pages']])
        self.assertEqual(['0001-0020.jpg', '0021-0021.jpg'], sorted(p.name for p in (self.work / 'sheets').iterdir()))
        first, missing = index['pages'][:2]
        self.assertEqual(prepare.load(self.work / first['ocrAudit']['path'])['rowCount'], 0)
        self.assertIsNone(missing['ocr'])
        self.assertIsNone(missing['source'])
        self.assertFalse(prepare.load(self.work / first['review']['path'])['wholePage'])

    def test_source_first_crop_and_resume_keep_transcription_and_invalidate_changed_ocr(self):
        first = self.start()['pages'][0]
        census_path = self.work / first['census']['path']
        census = prepare.load(census_path)
        census['captions'] = [{'id': 'caption-1', 'box': [4, 6, 40, 65]}]
        census_path.write_bytes(prepare.json_bytes(census))
        record, = prepare.crops(self.work, 12)
        self.assertEqual(record['box'], [0, 0, 52, 77])
        with Image.open(self.work / record['crop']['path']) as crop:
            self.assertEqual(crop.size, (52, 77))
        updated = prepare.refresh(self.work)['pages'][0]
        self.assertNotEqual(first['census']['sha256'], updated['census']['sha256'])
        self.put_ocr([{'box': [5, 9, 10, 15], 'text': '。'}])
        recalculated = self.start()['pages'][0]
        self.assertEqual(recalculated['census'], updated['census'])
        self.assertNotEqual(recalculated['ocrAudit'], updated['ocrAudit'])
        self.assertEqual(prepare.load(self.work / recalculated['ocrAudit']['path'])['reviewedBy'], '')

    def test_attach_late_ocr_to_one_page(self):
        self.sources['pages'][0]['ocr'] = None
        initial = self.start()
        self.assertIsNone(initial['pages'][0]['ocrAudit'])
        self.manifest.write_bytes(prepare.json_bytes({'bookId': 'example', 'range': [1, 1],
            'pages': [{'scan': 1, 'ocr': self.raw.name}]}))
        after = prepare.attach(self.manifest, self.work)
        self.assertIsNotNone(after['pages'][0]['ocrAudit'])
        self.assertEqual(after['pages'][0]['review'], initial['pages'][0]['review'])
        self.assertEqual(after['pages'][1:], initial['pages'][1:])
        self.raw.write_bytes(b'{"scan":1,"source_sha256":"different","rows":[]}')
        with self.assertRaisesRegex(ValueError, '出典'):
            prepare.attach(self.manifest, self.work)
        self.assertEqual(after, prepare.load(self.work / prepare.INDEX))

    def test_new_scan_cannot_inherit_old_confirmation(self):
        first = self.start()['pages'][0]
        path = self.work / first['review']['path']
        prior = prepare.load(path)
        prior['wholePage'] = True
        path.write_bytes(prepare.json_bytes(prior))
        Image.new('RGB', (100, 80), 'gray').save(self.image)
        with self.assertRaisesRegex(ValueError, '出典'):
            self.start()
        self.put_ocr([])
        updated = self.start()['pages'][0]
        self.assertNotEqual(updated['review']['path'], first['review']['path'])
        self.assertFalse(prepare.load(self.work / updated['review']['path'])['wholePage'])
        self.assertTrue(prepare.load(path)['wholePage'])

    def test_refresh_will_not_repin_modified_source_or_raw_ocr(self):
        first = self.start()['pages'][0]
        (self.work / first['ocr']['path']).write_bytes(b'{}')
        with self.assertRaisesRegex(ValueError, 'init'):
            prepare.refresh(self.work)

    def test_ingested_ocr_receipt_is_independent_of_review_and_versioned(self):
        index = self.start()
        origin = index['originalOcrSources']
        first = prepare.load(self.work / origin['path'])['pages'][0]
        self.assertEqual(first['rawSha256'], prepare.digest(self.raw.read_bytes()))
        self.assertEqual(first['sourceSha256'], prepare.digest(self.image.read_bytes()))
        self.put_ocr([{'box': [2, 3, 8, 9], 'text': '。'}])
        new = self.start()['originalOcrSources']
        self.assertNotEqual(origin, new)
        self.assertTrue((self.work / origin['path']).is_file())
        (self.work / new['path']).write_text('{}')
        with self.assertRaisesRegex(ValueError, '取り込み'):
            prepare.refresh(self.work)

    def test_partial_reinitialization_keeps_previously_received_input_and_review(self):
        former = self.start()
        page = former['pages'][0]
        proof = self.work/page['review']['path']
        updated = prepare.load(proof)
        updated['reviewedBy'] = '原本からの独立再読'
        proof.write_bytes(prepare.json_bytes(updated))
        former = prepare.refresh(self.work)
        self.sources['pages'] = []
        self.assertEqual(self.start(), former)


    def test_combine_keeps_both_batches_original_receipts_and_gaps(self):
        self.sources['range'] = [1, 1]
        self.start()
        second = self.root/'second'
        manifest = self.root/'more.json'
        manifest.write_bytes(prepare.json_bytes({'bookId':'example', 'range':[21, 21],
                              'pages':[{'scan':21, 'source':self.image.name}]}))
        prepare.init(manifest, second)
        selection = self.root/'batches.json'
        batches = [prepare.reference(p/prepare.INDEX, self.root) for p in (self.work, second)]
        selection.write_bytes(prepare.json_bytes({'bookId':'example', 'range':[1, 40], 'batches':batches + batches[:1]}))
        output = self.root/'combined'
        combined = prepare.combine(selection, output)
        self.assertEqual([p['scan'] for p in combined['pages']], [1, 21])
        self.assertEqual(combined, prepare.combine(selection, output))
        receipts = prepare.load(output/combined['originalOcrSources']['path'])['pages']
        self.assertEqual([r['rawSha256'] for r in receipts], [prepare.digest(self.raw.read_bytes()), None])
        self.assertEqual(len(combined['selectedBatches']), 2)
        previous = (output/prepare.INDEX).read_bytes()
        selection.write_bytes(prepare.json_bytes({'bookId':'example', 'range':[1, 40], 'batches':batches[1:]}))
        with self.assertRaisesRegex(ValueError, '出力先'):
            prepare.combine(selection, output)
        self.assertEqual((output/prepare.INDEX).read_bytes(),previous)

    def test_combine_rejects_conflicting_revisions_and_rehashed_pages(self):
        self.sources['range'] = [1, 1]
        index = self.start()
        second = self.root/'second'
        import shutil
        shutil.copytree(self.work, second)
        path = second/index['pages'][0]['review']['path']
        review = prepare.load(path)
        review['reviewedBy'] = 'second pass'
        path.write_bytes(prepare.json_bytes(review))
        prepare.refresh(second)
        selected = self.root/'selected.json'
        batches=[prepare.reference(p/prepare.INDEX,self.root) for p in (self.work,second)]
        selected.write_bytes(prepare.json_bytes({'bookId':'example','range':[1,2],'batches':batches}))
        output = self.root/'result'
        with self.assertRaisesRegex(ValueError, '異なる版'):
            prepare.combine(selected,output)
        self.assertFalse(output.exists())
        index=prepare.load(second/prepare.INDEX)
        new_bytes=b'{"rows":[]}'
        raw=second/'switched.json'
        raw.write_bytes(new_bytes)
        index['pages'][0]['ocr']=prepare.reference(raw,second)
        (second/prepare.INDEX).write_bytes(prepare.json_bytes(index))
        selected.write_bytes(prepare.json_bytes({'bookId':'example','range':[1,2],
                    'batches':[prepare.reference(second/prepare.INDEX,self.root)]}))
        with self.assertRaisesRegex(ValueError, '受領記録'):
            prepare.combine(selected,output)
        self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
