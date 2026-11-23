"""Exercise the real WH1 pack and registration paths with synthetic source text."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

TOOLS = Path(__file__).resolve().parents[1] / 'tools'
sys.path.insert(0, str(TOOLS))
from reader_shelf_pack import pack
import reader_shelf_wh1_parts as bound

spec = importlib.util.spec_from_file_location('shelf_register', TOOLS / 'reader-shelf-register.py')
register = importlib.util.module_from_spec(spec)
spec.loader.exec_module(register)


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


class FigureTextTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.style = '<style>body{color:black}</style>'
        approved_style = patch.object(bound, 'STYLE_SHA', digest(self.style))
        approved_style.start()
        self.addCleanup(approved_style.stop)
        self.blocks = [
            {'type':'heading', 'text':'標本', 'scan':1},
            {'type':'body', 'text':'第一段。', 'scan':1, 'sourceRef':[1,1]},
            {'type':'body', 'text':'第二段。', 'scan':1, 'sourceRef':[1,2]},
            {'type':'figure', 'image':'crop.png', 'scan':1},
            {'type':'note', 'text':'標本の断面。', 'scan':1},
        ]
        self.group = dict(scan=1, at=3, title='図', figs=[3], desc=[4])
        self.display_group = None
        self.review = {
            'sourceSha256':digest('source image'),
            'prose':[['heading',digest('標本')],['body',digest('第一段。')],['body',digest('第二段。')]],
            'figures':[{'images':[digest('cropped image')], 'descriptions':[digest('標本の断面。')]}],
        }
        self.reference = {'bookId':'sample', 'boundaryReviews':[], 'continuations':[]}

    def file(self, path, data):
        (self.root / path).write_text(data, encoding='utf-8')
        return {'path':path, 'sha256':digest(data)}

    def write(self, review):
        def html(blocks, group):
            payload = {'blocks':blocks, 'ILLUSTRATION_GROUPS':[group], 'toc':[]}
            return self.style + '\n' + ''.join('const '+k+'='+json.dumps(v)+';\n' for k,v in payload.items())
        display = copy.deepcopy(self.blocks)
        for b in display:
            if b['type'] == 'body':
                b['sourceSpans'] = [{'sourceRef':b['sourceRef'], 'scan':1, 'start':0, 'end':len(b['text'])}]
        raw = self.file('source.html', html(self.blocks, self.group))
        segment = dict(start=1, end=1, part=raw['path'], sha256=raw['sha256'],
                       display=self.file('display.html', html(display, self.display_group or self.group)),
                       assets={'crop.png':self.file('crop.png','cropped image'),
                               'other.png':self.file('other.png','unrelated image')})
        m = dict(bookId='sample', title='見本', range=[1,1], template_profile='world_history_1',
                 canonicalTemplate='wh1-0011-0030', segments=[segment],
                 originalScans={'1':self.file('source.png','source image')},
                 readingFlow={'format':bound.FORMAT, 'boundaryReviews':[], 'continuations':[]})
        if review is not None:
            m['figureTextReviews'] = {'1':review}
        path = self.root / 'manifest.json'
        path.write_text(json.dumps(m))
        return path

    def make(self, review=None):
        dest = self.root / 'edition.zip'
        pack(self.write(review), dest)
        with zipfile.ZipFile(dest) as z:
            return dest, json.loads(z.read('manifest.json'))

    def test_same_wrong_text_in_both_editions_is_rejected_before_packing(self):
        self.blocks[-1]['text'] = '0' * 100 + '標本第一段。第二段。'
        with self.assertRaisesRegex(ValueError, '長い0列'):
            self.make()
        self.assertFalse((self.root / 'edition.zip').exists())

    def test_compared_prose_cannot_be_moved_between_columns_or_into_the_caption(self):
        self.blocks[1], self.blocks[2] = self.blocks[2], self.blocks[1]
        with self.assertRaisesRegex(ValueError, '本文順'):
            self.make(self.review)
        self.blocks[1], self.blocks[2] = self.blocks[2], self.blocks[1]
        self.blocks[-1]['text'] = '第一段。' + self.blocks[-1]['text']
        with self.assertRaisesRegex(ValueError, '説明文'):
            self.make(self.review)

    def test_genuine_zero_string_can_be_preserved_with_a_source_bound_review(self):
        text = '０' * 32
        self.blocks[-1]['text'] = text
        self.review['figures'][0]['descriptions'] = [digest(text)]
        dest, manifest = self.make(self.review)
        reference = dict(self.reference, figureTextReviews={'1':self.review})
        self.assertEqual(bound.FORMAT, register.registration_flow(dest, manifest, reference, False)['route'])
        with self.assertRaisesRegex(ValueError, '登録用'):
            register.registration_flow(dest, manifest, self.reference, False)
        with self.assertRaisesRegex(ValueError, '登録用'):
            register.registration_flow(dest, manifest, dict(self.reference, figureTextReviews=None), False)

    def test_normal_numeric_value_is_not_flagged(self):
        self.blocks[-1]['text'] = '1' + '0' * 22 + '個'
        dest, manifest = self.make()
        self.assertEqual(bound.FORMAT, register.registration_flow(dest, manifest, self.reference, False)['route'])

    def test_uses_the_actual_image_and_correctly_typed_blocks(self):
        self.review['sourceSha256'] = digest('a different scan')
        with self.assertRaisesRegex(ValueError, '原本照合'):
            self.make(self.review)
        self.group['desc'] = [2]
        with self.assertRaisesRegex(ValueError, '文字の役割'):
            self.make()

    def test_standalone_notes_remain_visible_and_separate_from_figure_descriptions(self):
        self.blocks.append({'type':'note', 'scan':1, 'text':'別枠の記事。'})
        self.review['prose'].append(['note', digest('別枠の記事。')])
        self.display_group = dict(self.group, suppress=[5])
        with self.assertRaisesRegex(ValueError, '独立した注'):
            self.make(self.review)
        self.group['desc'].append(5)
        self.display_group = None
        with self.assertRaisesRegex(ValueError, '説明文'):
            self.make(self.review)
        self.group['desc'].pop()
        self.make(self.review)

    def test_compares_the_displayed_figure_override_and_not_only_source_block_images(self):
        self.display_group = dict(self.group, overrides={'3':'other.png'})
        with self.assertRaisesRegex(ValueError, '図版'):
            self.make(self.review)


if __name__ == '__main__':
    unittest.main()
