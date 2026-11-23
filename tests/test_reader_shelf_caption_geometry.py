import unittest

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools' if (ROOT / 'tools').is_dir() else ROOT))
from figure_caption_geometry import inspect_input


def line(key, left, top, right, text=None):
    return {'id': key, 'box': [left, top, right, top+20], 'text': text or key}


def layout(rows, figures, previous=None):
    source = {'width': 1000,'height': 1400,'rows': rows,
              'figures': [{'bbox':coordinates} for coordinates in figures]}
    if previous is not None:
        source['existingCaptionRows']=previous
    return inspect_input(source)


class FigureCaptionGeometryTests(unittest.TestCase):
    def test_distant_body_does_not_become_caption_of_only_figure(self):
        rows=[line('body',100,40,850),line('legend',100,1030,850)]
        result=layout(rows,[[100,410,900,1000]])
        self.assertEqual(result['candidates'],{0:['legend']})
        self.assertEqual(result['reviewFlags'],['detached-text'])

    def test_two_columns_read_down_left_before_right(self):
        rows=[line(k,x,y,x+320) for k,x,y in [
            ('right2',550,500),('left2',100,500),('right1',550,470),('left1',100,470)]]
        result=layout(rows,[[90,100,900,450]],[['left1','right1','left2','right2']])
        self.assertEqual(result['candidates'],{0:['left1','left2','right1','right2']})
        self.assertEqual(result['reviewFlags'],['interleaved-column-order'])

    def test_full_width_ocr_crossing_repeated_gutter_requires_review(self):
        rows=[line(f'{x}-{y}',x,y,x+340) for x in (100,550) for y in (500,535,570)]
        rows.append(line('wide',100,605,890))
        self.assertIn('cross-column-ocr',layout(rows,[[100,100,900,475]])['reviewFlags'])

    def test_zero_run_preserved_for_review(self):
        result=layout([line('rule',0,450,500,'０'*100)],[[0,100,500,420]])
        self.assertEqual(result['reviewFlags'],['repeated-zero-run'])
        self.assertEqual(result['candidates'],{0:['rule']})
        self.assertFalse(layout([line('date',0,450,500,'100000000000000円')],[[0,100,500,420]])['reviewFlags'])

    def test_ambiguous_caption_between_neighbors(self):
        result=layout([line('ambiguous',100,550,600)],[[100,200,600,520],[100,600,600,980]])
        self.assertEqual(result,{'candidates':{},'reviewFlags':['ambiguous-figure']})

    def test_group_preserves_dependence_on_its_own_figure(self):
        figures=[[100,100,900,400],[100,650,900,1100]]
        rows=[line('legend1',100,430,400),line('legend2',100,465,400)]
        result=layout(rows,figures,[['legend1'],['legend2']])
        self.assertEqual(result['candidates'],{0:['legend1','legend2']})
        self.assertEqual(result['reviewFlags'],['conflicting-figure'])

    def test_one_figure_without_text_is_valid(self):
        self.assertEqual(layout([],[[10,10,500,500]]),{'candidates':{},'reviewFlags':[]})

    def test_bad_coordinates_and_duplicate_references_raise(self):
        with self.assertRaises(ValueError):
            layout([line('x',11,20,10)],[])
        with self.assertRaises(ValueError):
            layout([line('x',10,520,600)],[[100,100,900,500]],[['x','x']])


if __name__=='__main__':
    unittest.main()
