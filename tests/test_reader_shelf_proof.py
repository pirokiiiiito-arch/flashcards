import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parents[1] / 'tools'
sys.path.insert(0, str(TOOLS))
import reader_shelf_proof as proof


class ShelfProof(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.archive = self.root / 'book.zip'
        self.image = b'first source image'
        self.original = proof.sha(self.image)
        self.book_id = 'fixture'
        self.book = {'range': [1, 1], 'segments': [{'start': 1, 'end': 1, 'part': 'first.html',
                                                    'display': {'path': 'display.html'}}],
                     'originalScans': {'1': {'path': 'original.jpg', 'sha256': self.original}}}
        with zipfile.ZipFile(self.archive, 'w') as zipped:
            for name, value in [('first.html', 'first'), ('display.html', 'display'), ('original.jpg', self.image)]:
                zipped.writestr(name, value)
        self.sha = proof.sha(self.archive.read_bytes())
        self.inventory = self.write_json('inventory.json', {'bookId': 'fixture', 'range': [1,1],
            'pages': [{'scan': 1, 'image': {'sha256': self.original}}]})
        self.index = {'schema':'reader-shelf-proof-index-v1','bookId':'fixture','range':[1,1],
                      'archiveSha256':self.sha, 'members':[]}

    def write_json(self, name, data):
        raw = json.dumps(data).encode()
        (self.root / name).write_bytes(raw)
        return {'path': name, 'sha256': proof.sha(raw)}

    def measure(self):
        path = self.root / self.write_json('index.json', self.index)['path']
        return proof.measure(self.archive, self.sha, self.book, self.book_id, path, self.root)

    def test_absent_or_partial_input_keeps_scans_open(self):
        # Partial last batch and range not beginning at 1.
        book = {'range': [7,27], 'entry': 'standalone.html'}
        missing = proof.measure(self.archive, self.sha, book, self.book_id)
        self.assertEqual(missing['batches'], [[7,26,20],[27,27,1]])
        proof.require_claims(missing, 'preview', {'status':'部分校正済み・本文校正中'}, {}, {})
        for channel, meta, ref in [('release',{},{}),('preview',{'status':'全文校了'},{}),
                                   ('preview',{'subtitle':'全字確認済み'},{}),('preview',{'status':'全21枚校正済み'},{}),
                                   ('preview',{'status':'21枚校正済み'},{}),('preview',{'status':'図説・注 校正済み'},{}),
                                   ('preview',{}, {'sourceScopeClaims':{'ruby':'complete'}}),('preview',{}, {'sourceProofClaim':'complete'})]:
            with self.assertRaises(ValueError):
                proof.require_claims(missing, channel, meta, {}, ref)

    def test_different_archive_and_unreferenced_html_rejected(self):
        self.index['archiveSha256'] = '0' * 64
        with self.assertRaises(ValueError):
            self.measure()
        self.index['archiveSha256'] = self.sha
        self.index['members'] = [{'path':'unrelated.html'}]
        with self.assertRaises(ValueError):
            self.measure()

    def test_both_part_and_display_views_are_required(self):
        def finish(cmd, **unused):
            html = Path(cmd[cmd.index('--artifact')+1]).read_bytes()
            report = {'schema':'reader-proof-batches-v1','artifactSha256':proof.sha(html),'bookId':'fixture',
                      'range':[1,1],'status':'complete','pendingScans':0,'queue':[],
                      'pages':[{'scan':1,'pendingScopes':[],'matchedRegions':[{'id':'a','scope':'caption','state':'verified'}]}]}
            return type('Result', (), {'stdout': json.dumps(report)})()
        self.index['members'] = [{'path':'first.html','inventory':self.inventory}]
        with patch.object(proof.subprocess, 'run', side_effect=finish):
            self.assertEqual(self.measure()['pendingScans'],1)
            self.index['members'].append({'path':'display.html','inventory':self.inventory})
            result=self.measure()
            self.assertEqual(result['pendingScans'],0)
            self.assertEqual(result['batches'],[[1,1,0]])
            self.assertEqual(result['scopeBatches'][0]['matchedRegions'],1)
            proof.require_claims(result,'release', {},{}, {})

    def test_signed_summary_changes_if_capture_reference_changes_with_same_counts(self):
        inventory = self.write_json('empty.json', {'schema':'reader-proof-inventory-v1','bookId':'fixture',
                                                   'range':[1,1],'pages':[]})
        captured = {'schema':'reader-proof-readback-v1','bookId':'fixture','range':[1,1],'pages':[],
                    'artifactSha256':proof.sha(b'first'), 'viewport':[390,844]}
        readback = self.write_json('readback.json',captured)
        self.index['members'] = [{'path':'first.html','inventory':inventory,'readback':readback}]
        first = self.measure()
        captured['viewport'] = [400,844]
        new_ref = self.write_json('readback.json',captured)
        with self.assertRaisesRegex(ValueError,'校正資料の版'):
            self.measure()
        self.index['members'][0]['readback'] = new_ref
        second = self.measure()
        self.assertEqual(first['scopeBatches'], second['scopeBatches'])
        self.assertNotEqual(first['report'], second['report'])
        self.index['revision'] = 'new evidence-index snapshot'
        self.assertNotEqual(second['report'], self.measure()['report'])

    def test_completed_caption_and_note_scopes_can_coexist_with_unreviewed_body(self):
        summary = proof.measure(self.archive, self.sha, self.book, self.book_id)
        for key in ('caption','note'):
            summary['scopeBatches'][0]['pending'][key] = 0
        proof.require_claims(summary,'preview',{'status':'図説・注 校正済み／本文校正中'}, {},
                             {'sourceScopeClaims':{'caption':'complete','note':'complete'}})
        summary['scopeBatches'][0]['pending']['note'] = 1
        with self.assertRaisesRegex(ValueError,'未照合'):
            proof.require_claims(summary,'preview',{'status':'図説・注 校正済み'}, {}, {})

    def test_tampered_image_inventory_or_wrong_readback_route_fails(self):
        self.index['members'] = [{'path':'first.html','inventory':dict(self.inventory,sha256='0'*64)}]
        with self.assertRaisesRegex(ValueError, '校正資料の版'):
            self.measure()
        inv=self.write_json('wrong.json', {'bookId':'fixture','range':[1,1],
                                           'pages':[{'scan':1,'image':{'sha256':'f'*64}}]})
        self.index['members'] = [{'path':'first.html','inventory':inv}]
        with self.assertRaisesRegex(ValueError, '原本画像'):
            self.measure()
        with self.assertRaisesRegex(ValueError, '個別'):
            proof.verify_readback({'route':'part'}, True, True, self.root)
        with self.assertRaisesRegex(ValueError, '版'):
            proof.verify_readback({'route':'shelf','hostFiles':{}}, True, True, self.root)

    def test_part_readback_native_original_requires_current_shelf_host(self):
        original = {'mode': 'reader-original', 'route': 'shelf'}
        receipt = {'route': 'part', 'pages': [{'regions': [{'originalObservation': original}]}]}
        with self.assertRaisesRegex(ValueError, '版'):
            proof.verify_readback(receipt, True, False, self.root)
        hosts = {}
        for name in proof.SHELF_HOSTS:
            local = self.root / name
            local.parent.mkdir(parents=True, exist_ok=True)
            local.write_bytes(name.encode())
            hosts[name] = proof.sha(local.read_bytes())
        receipt['originalHostFiles'] = hosts
        proof.verify_readback(receipt, True, False, self.root)
        original['route'] = 'part'
        with self.assertRaisesRegex(ValueError, '経路'):
            proof.verify_readback(receipt, True, False, self.root)
        original['route'] = 'shelf'
        (self.root / next(iter(hosts))).write_bytes(b'changed host')
        with self.assertRaisesRegex(ValueError, '異なります'):
            proof.verify_readback(receipt, True, False, self.root)
