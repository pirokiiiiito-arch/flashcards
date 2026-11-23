import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools' if (ROOT / 'tools').is_dir() else ROOT))
from caption_initials import candidates


def row(identifier,x,y,w,h=20,text='abc'):
    return {'id':identifier,'box':[x,y,x+w,y+h],'text':text}


class InitialRegionTest(unittest.TestCase):
    def setUp(self):
        self.first=row('a',95,100,180)
        self.second=row('b',96,131,173)
        self.third=row('c',40,162,255)
        self.inset=[self.first,self.second,self.third]
        self.ids=[r['id'] for r in self.inset]

    def test_geometric_region_includes_all_ocr_roles(self):
        fragment=row('m',42,103,41,43,text='17')
        title=dict(fragment,id='t',kind='line_title')
        normal=row('v',42,20,18,77,text='17')
        rows=[*self.inset,fragment,title,normal]
        item,=candidates(self.ids,rows)
        self.assertEqual(item,{'box':[40,100,95,151],'lines':self.ids,'fragments':['m','t']})
        self.assertEqual(rows[3]['text'],'17')

    def test_missing_ocr_still_requires_source_reading(self):
        self.assertEqual(candidates(self.ids,self.inset)[0]['fragments'],[])

    def test_two_lines_without_wrapping_are_not_a_hit_without_a_fragment(self):
        self.assertEqual(candidates(self.ids[:2],self.inset[:2]),[])
        fragment=row('x',42,103,42,42,'A')
        self.assertEqual(candidates(self.ids[:2],[*self.inset[:2],fragment])[0]['fragments'],['x'])

    def test_real_numbers_at_normal_type_size_do_not_become_fragments(self):
        genuine=row('unit',44,103,18,20,'17')
        aligned=[self.first,self.second,row('c',95,162,220),genuine]
        self.assertEqual(candidates(self.ids,aligned),[])

    def test_colocated_fragments_in_a_legacy_caption_are_examined(self):
        clipped=row('clip',42,103,40,43,'?')
        ids=['clip',*self.ids]
        self.assertEqual(candidates(ids,[*self.inset,clipped])[0]['fragments'],['clip'])

    def test_region_between_paragraphs_is_not_an_initial(self):
        rows=[self.first,row('b',95,185,190),row('c',40,220,190)]
        self.assertEqual(candidates(self.ids,rows),[])

    def test_already_linked_initial_can_still_have_an_overlapping_mistaken_body_detection(self):
        proper=row('proper',40,103,46,45,'The')
        smaller=row('other',42,106,40,38,'7')
        item,=candidates(['proper',*self.ids],[*self.inset,proper,smaller])
        self.assertEqual(item['fragments'],['proper','other'])

    def test_duplicate_ids_are_invalid(self):
        with self.assertRaises(ValueError):
            candidates(self.ids,self.inset + [self.first])

if __name__=='__main__':
    unittest.main()
