import copy
import importlib.util
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1] / 'tools'
sys.path.insert(0, str(TOOLS))
spec = importlib.util.spec_from_file_location('shelf_register', TOOLS / 'reader-shelf-register.py')
register = importlib.util.module_from_spec(spec)
spec.loader.exec_module(register)


class TurnEvidenceTests(unittest.TestCase):
    def test_source_ranges_survive_standalone_pack(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / 'book.zip'
            manifest = {'range':[1,48], 'entry':'book.html', 'readingFlow':{'sourceRanges':[[1,8],[9,48]]}}
            with zipfile.ZipFile(archive, 'w') as z:
                z.writestr('manifest.json', json.dumps(manifest))
                z.writestr('book.html', '<meta name="viewport" content="user-scalable=yes, maximum-scale=5">')
            _, ranges, _ = register.inspect_archive(archive, {'range':[1,48]})
            self.assertEqual(ranges, [(1,8),(9,28),(29,48)])

    def test_each_boundary_must_link_to_measured_input(self):
        ranges = [[1,20], [21,40]]
        cases = {kind+action:{'frames':6,'intermediateFrames':0}
                 for kind in ('button','swipe') for action in ('Forward','Back','RapidReturn','RapidReverse')}
        report = {'version':1, 'ranges':ranges, 'sectionCount':2,
                  'boundaries':[{'after':20,'before':21,'kind':'segment','measurement':0}],
                  'sectionBoundaries':[{'fromSection':0,'toSection':1,'measurement':0}],
                  'measurements':[{'tests':cases}]}
        self.assertEqual(register.turn_summary(report, ranges)['sections'], [[0,1]])
        # A reordered source can cross a production boundary more than once.
        reordered = copy.deepcopy(report)
        reordered['measurements'].append({'tests':copy.deepcopy(cases)})
        reordered['boundaries'][0]['displayCrossings'] = [{'measurement':0},{'measurement':1}]
        self.assertEqual(register.turn_summary(reordered, ranges)['sections'], [[0,1]])
        reordered['boundaries'][0]['displayCrossings'].pop()
        with self.assertRaises(ValueError):
            register.turn_summary(reordered, ranges)
        for key in ('measurements','boundaries','sectionBoundaries'):
            broken = dict(report)
            broken[key] = []
            with self.subTest(missing=key), self.assertRaises(ValueError):
                register.turn_summary(broken, ranges)
        for name, metric, value in [('buttonRapidReverse','intermediateFrames',1),('swipeForward','frames',0)]:
            broken = copy.deepcopy(report)
            broken['measurements'][0]['tests'][name][metric] = value
            with self.subTest(case=name), self.assertRaises(ValueError):
                register.turn_summary(broken, ranges)
        del cases['swipeBack']
        with self.assertRaises(ValueError):
            register.turn_summary(report, ranges)
