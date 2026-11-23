"""Check that private work and registration use the same scope and shelf provenance."""
import json
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

from test_reader_shelf_caption_census import CaptionBook
from reader_caption_census import WH1_SHELF_HOSTS, sha
from reader_caption_work import audit


class CaptionWorkBinding(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.book = CaptionBook(self.root, 2)
        self.figure = self.book.figure(1, 'figure', ['legend'])
        self.book.caption(1, 'legend', ['figure'], '最初の図。')
        self.book.paint(1, [self.figure], '最初の図。')
        self.hosts = {}
        for name in WH1_SHELF_HOSTS:
            relative = Path('site') / name
            (self.root / relative).parent.mkdir(parents=True, exist_ok=True)
            self.hosts[name] = self.book.write(str(relative), name.encode())['sha256']
        self.members = {}
        archive = self.root / 'book.zip'
        with ZipFile(archive, 'w') as packed:
            segments = []
            for scan in (1, 2):
                row = {'start': scan, 'end': scan}
                for route in ('part', 'shelf'):
                    name = f'{route}-{scan}.html'
                    raw = f'<title>{route}-{scan}</title>'.encode()
                    packed.writestr(name, raw)
                    self.members[(route, scan)] = (name, sha(raw))
                    if route == 'part':
                        row.update(part=name, sha256=sha(raw))
                    else:
                        row['display'] = dict(path=name, sha256=sha(raw))
                segments.append(row)
            packed.write(self.root / '1.png', 'original.png')
            packed.writestr('manifest.json', json.dumps(dict(bookId='fixture',range=[1,2],segments=segments,
                originalScans={str(n): {'path':'original.png','sha256':self.book.source} for n in (1,2)},
                readingFlow={'format':'wh1-bound-source-v1'})))
        self.archive_sha = sha(archive.read_bytes())
        self.manifest = dict(bookId='fixture',range=[1,1],captionArchive=dict(path=archive.name,sha256=self.archive_sha),
                             captionSiteRoot='site',captionReadbacks={'part':[], 'shelf':[]})

    def capture(self, role, scan, **changes):
        name, digest = self.members[(role, scan)]
        doc = dict(schema='reader-proof-readback-v1',bookId='fixture',range=[scan,scan],route=role,
                   artifactSha256=digest,archiveSha256=self.archive_sha,member=name,pages=[self.book.obs[role][scan]])
        if role == 'shelf':
            doc['hostFiles'] = self.hosts
        doc.update(changes)
        raw = json.dumps(doc).encode()
        self.manifest['captionReadbacks'][role].append(self.book.write(sha(raw)+'.json', raw))

    def verify(self):
        index = self.book.save()
        self.manifest['captionCensus'] = {'path':index.name,'sha256':sha(index.read_bytes())}
        return audit(self.root,self.manifest,{'1': self.book.source},self.members[('part',1)][1])

    def test_other_segment_failure_only_blocks_its_connected_caption(self):
        for route in ('part','shelf'):
            for scan in (1,2):
                self.capture(route, scan)
        self.capture('shelf', 2, route='part')
        self.assertEqual(self.verify()['pendingScans'], [])
        self.book.docs[1]['census']['figures'][0]['captionIds'].append('continued')
        self.book.caption(2, 'continued', ['figure'], '続き。')
        # Refresh the real observations for the new line printed on sheet 2.
        self.manifest['captionReadbacks'] = {'part':[], 'shelf':[]}
        for role in ('part','shelf'):
            field = self.book.obs[role][1]['painted'][-1]
            field['value']['text'] += '続き。'
            length = len(field['value']['text'])
            field['fragments'][0]['end'] = length
            field['value']['captionVisibility']['fragments'][0]['glyphs'] = length
            for scan in (1,2):
                self.capture(role, scan)
        self.assertEqual(self.verify()['pendingScans'], [])
        self.capture('shelf', 2, route='part')
        result = self.verify()
        self.assertEqual(result['pendingScans'], [1])
        self.assertIn('LINKED_CAPTION_REVIEW_PENDING',[x['code'] for x in result['pages'][0]['issues']])

    def test_wh1_requires_the_current_reading_program_on_the_shelf_route(self):
        self.capture('part', 1)
        self.capture('shelf', 1, hostFiles={'reader/library/read.html':self.hosts['reader/library/read.html']})
        result = self.verify()
        self.assertEqual(result['pendingScans'], [1])
        self.assertTrue(any('CAPTION_SHELF_HOST_REQUIRED' in x['code'] for x in result['pages'][0]['issues']))


if __name__ == '__main__':
    unittest.main()
