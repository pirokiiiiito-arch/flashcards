"""Source ruby stays attached to one printed occurrence, independently of OCR guesses."""
import hashlib
import importlib.util
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

TOOL = Path(__file__).resolve().parents[1] / 'tools/reader-source-ruby.py'
spec = importlib.util.spec_from_file_location('source_ruby', TOOL)
ruby = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ruby)


class SourceRubyTest(unittest.TestCase):
    def setUp(self):
        source = io.BytesIO()
        Image.new('L', (80, 90), 'white').save(source, 'PNG')
        self.source = source.getvalue()
        self.digest = hashlib.sha256(self.source).hexdigest()
        self.page = {'scan': 3, 'sha256': self.digest, 'blocks': [{'id': 'p1', 'text': '𠮷と空と空。'}]}
        self.item = {'blockId': 'p1', 'start': 4, 'end': 5, 'base': '空', 'reading': 'くう',
                     'sourceBox': [39, 14, 46, 44], 'before': '空と', 'after': '。', 'reviewStatus': 'verified'}
        self.form = {'sourceScan': 3, 'sourceImageSha256': self.digest, 'annotations': [self.item]}

    def apply(self, page=None):
        return ruby.apply_review(self.page if page is None else page, self.form, self.digest, (80, 90))

    def test_second_occurrence_survives_repeated_apply_and_combines_new_annotations(self):
        result = self.apply()
        self.assertNotIn('ruby', self.page['blocks'][0])
        old = result['blocks'][0]['ruby'][0]
        self.assertEqual((4, 5, '空', 'くう'), (old['start'], old['end'], old['base'], old['reading']))
        self.assertEqual(self.apply(result), result)
        other = {**self.item, 'start': 2, 'end': 3, 'before': '𠮷と', 'after': 'と空。', 'reading': 'そら'}
        self.form['annotations'] = [other]
        combined = self.apply(result)
        self.assertEqual(['そら', 'くう'], [a['reading'] for a in combined['blocks'][0]['ruby']])
        self.assertEqual(combined['blocks'][0]['text'], self.page['blocks'][0]['text'])

    def test_detected_ruby_and_emphasis_are_both_pending_until_reviewed(self):
        rows = [{'kind': 'line_main', 'text': '𠮷と空と空。', 'box': [24, 9, 37, 70]},
                {'kind': 'block_rubi', 'text': 'くう', 'box': [39, 14, 46, 44]},
                {'kind': 'block_rubi', 'text': '、、', 'box': [39, 54, 46, 64]}]
        ocr = {'scan': 3, 'width': 80, 'height': 90, 'source_sha256': self.digest, 'rows': rows}
        candidates = ruby.get_candidates(ocr, self.digest, (80, 90))
        self.assertEqual(['pending', 'pending'], [r['reviewStatus'] for r in candidates['annotations']])
        self.assertEqual(rows[0]['text'], candidates['annotations'][0]['nearbyLineHint']['ocrText'])
        self.assertEqual(self.page, ruby.apply_review(self.page, candidates, self.digest, (80, 90)))

    def test_rejects_stale_offsets_or_source_and_conflicting_overlaps(self):
        for edit in ({'start': 2, 'end': 3}, {'base': '月'}, {'reading': ''}, {'sourceBox': [0, 0, 100, 1]},
                     {'sourceImageSha256': '9' * 64}, {'sourceScan': 7}, {'blockIndex': 1}, {'blockId': 'other'}):
            with self.subTest(edit=edit), self.assertRaises(ValueError):
                self.form['annotations'] = [{**self.item, **edit}]
                self.apply()
        self.form['annotations'] = [self.item, {**self.item, 'reading': 'そら'}]
        with self.assertRaises(ValueError):
            self.apply()
        self.form['annotations'] = [self.item]
        self.form['sourceImageSha256'] = '0' * 64
        with self.assertRaises(ValueError):
            self.apply()

    def test_cli_failure_preserves_output_and_original(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root/'scan.png'; source.write_bytes(self.source)
            page = root/'page.json'; page.write_text(json.dumps(self.page))
            review = root/'review.json'; review.write_text(json.dumps(self.form))
            args = [sys.executable, str(TOOL), 'apply', '--page', str(page), '--image', str(source),
                    '--review', str(review), '--out']
            blocked = subprocess.run([*args, str(source)], capture_output=True)
            self.assertNotEqual(blocked.returncode, 0)
            self.assertEqual(source.read_bytes(), self.source)
            out = root/'annotated.json'
            subprocess.run([*args, str(out)], check=True)
            before = out.read_bytes()
            self.form['annotations'][0]['base'] = '別字'
            review.write_text(json.dumps(self.form))
            self.assertNotEqual(subprocess.run([*args, str(out)], capture_output=True).returncode, 0)
            self.assertEqual(out.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
