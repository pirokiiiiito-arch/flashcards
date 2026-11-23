import json
import subprocess
import tempfile
import unittest

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools' if (ROOT / 'tools').is_dir() else ROOT))
from figure_caption_geometry import inspect_input


def line(key, left, top, right, text=None):
    return {'id': key, 'box': [left, top, right, top+20], 'text': text or key}


def layout(rows, figures, previous=None):
    source = {'width': 1000,'height': 1400,'rows': rows,'sourceRows': rows,
              'figures': [{'bbox':coordinates} for coordinates in figures]}
    if previous is not None:
        source['existingCaptionRows']=previous
    return inspect_input(source)


class FigureCaptionGeometryTests(unittest.TestCase):
    def test_legacy_input_keeps_candidates_but_cannot_clear_an_unchecked_original(self):
        head = line('a', 100, 500, 500, '説明')
        tail = line('b', 100, 529, 125, '。')
        data = dict(width=1000, height=1400, figures=[{'bbox': [100,570,800,900]}],
                    rows=[head, tail], existingCaptionRows=[['a']])
        result = inspect_input(data)
        self.assertEqual(result['candidates'], {0:['a','b']})
        self.assertEqual(result['endingCandidates'][0]['row'], 'b')
        self.assertIn('missing-source-rows', result['reviewFlags'])
        for value, expected in [({}, 'missing-source-rows'), ({'sourceRows':[]}, 'empty-source-rows')]:
            blank = dict(data, rows=[], figures=[], existingCaptionRows=[], **value)
            self.assertEqual(inspect_input(blank)['reviewFlags'], [expected])

    def test_cli_exit_status_distinguishes_review_missing_original_and_invalid_geometry(self):
        script = Path(inspect_input.__code__.co_filename)
        head = line('a', 100, 500, 500, '説明。')
        case = dict(width=1000, height=1400, figures=[{'bbox':[100,535,800,900]}],
                    rows=[head], existingCaptionRows=[['a']])
        with tempfile.TemporaryDirectory() as tmp:
            page, original = Path(tmp)/'page.json', Path(tmp)/'ocr.json'
            def run(*extra):
                return subprocess.run([sys.executable,str(script),str(page),*extra],capture_output=True,text=True)
            page.write_text(json.dumps(case))
            partial = run()
            self.assertEqual(partial.returncode,2)
            self.assertEqual(json.loads(partial.stdout)['reviewFlags'], ['missing-source-rows'])
            original.write_text(json.dumps({'rows':[head]}))
            valid = run('--source-rows',str(original))
            self.assertEqual(valid.returncode,0,valid.stderr)
            self.assertEqual(json.loads(valid.stdout)['candidates'], {'0':['a']})
            case['sourceRows'] = [head]
            page.write_text(json.dumps(case))
            self.assertEqual(run().returncode,0)
            self.assertEqual(run('--source-rows',str(original)).returncode,1)

    def test_cli_reads_native_scan_rows_without_requiring_manual_id_conversion(self):
        script = Path(inspect_input.__code__.co_filename)
        first = line('s020-r001', 100, 500, 500, '説明したも')
        last = line('s020-r002', 100, 528, 125, 'の。')
        with tempfile.TemporaryDirectory() as tmp:
            page, original = Path(tmp)/'layout.json', Path(tmp)/'scan.json'
            page.write_text(json.dumps(dict(scan=20,width=1000,height=1400,rows=[first],
                                            figures=[{'bbox':[100,570,800,900]}],
                                            existingCaptionRows=[['s020-r001']])))
            original.write_text(json.dumps(dict(scan=20,width=1000,height=1400,
                rows=[{k:v for k,v in row.items() if k!='id'} for row in [first,last]])))
            run = subprocess.run([sys.executable,str(script),str(page),'--source-rows',str(original)],
                                 capture_output=True,text=True)
            self.assertEqual(run.returncode,2,run.stderr)
            self.assertEqual(json.loads(run.stdout)['endingCandidates'][0]['row'], 's020-r002')

    def test_caption_start_compares_vertical_alternatives_from_full_ocr_geometry(self):
        lines = [line('a', 240, 550, 550), line('b', 240, 578, 550)]
        source = dict(width=1000, height=1400, figures=[{'bbox':[150,100,600,500]}],
                      rows=lines, existingCaptionRows=[['a','b']])
        self.assertNotIn('initialCandidates', inspect_input(source))
        source['sourceRows'] = lines + [{'id':'alt', 'box':[184,548,233,597],
                                        'text':'7', 'kind':'line_main'}]
        out = inspect_input(source)
        self.assertIn('caption-initial-review', out['reviewFlags'])
        self.assertEqual(out['initialCandidates'][0]['fragments'], ['alt'])
        self.assertEqual(out['initialCandidates'][0]['figure'], 0)

    def test_initial_cannot_match_caption_and_source_ids_at_different_positions(self):
        source = dict(width=1000, height=1400, rows=[line('a',100,540,850)],
                      figures=[{'bbox':[100,100,850,510]}], sourceRows=[line('a',400,540,850)])
        with self.assertRaisesRegex(ValueError, 'original OCR geometry'):
            inspect_input(source)

    def test_short_original_caption_end_is_flagged_in_new_and_saved_geometry(self):
        preceding = [line('first',100,510,420,'写真の解説'), line('second',100,540,420,'撮影したも')]
        tail = dict(id='end',box=[100,575,127,595],text='の。',kind='line_main')
        doc = dict(width=1000,height=1400,rows=preceding,sourceRows=[*preceding,tail],
                   figures=[{'bbox':[100,640,800,1100]}])
        for saved in [False, True]:
            if saved:
                doc['existingCaptionRows'] = [['first','second']]
            result = inspect_input(doc)
            self.assertEqual(result['endingCandidates'],[{'figure':0,'after':'second','row':'end','box':tail['box']}])
            self.assertIn('caption-ending-review', result['reviewFlags'])
            self.assertEqual(result['candidates'][0], ['first','second'], 'candidate discovery never moves or deletes source text')

    def test_reviewed_tail_and_unrelated_short_boxes_do_not_reopen_a_caption(self):
        lines = [line('first',100,510,420),line('second',100,540,420),
                 dict(id='printed-end',box=[100,575,127,595],text='の。')]
        variations = [
            dict(id='inside-art',box=[100,610,126,630],text='図'),
            dict(id='other-column',box=[350,611,380,630],text='編'),
            dict(id='folio',box=[100,607,127,626],text='20',kind='block_folio'),
            dict(id='overprint',box=[102,580,118,594],text='の')
        ]
        doc = dict(width=1000,height=1400,rows=lines,sourceRows=[*lines,*variations],
                   existingCaptionRows=[['first','second','printed-end']],figures=[{'bbox':[80,610,800,1100]}])
        self.assertNotIn('endingCandidates',inspect_input(doc))
        self.assertNotIn('caption-ending-review',inspect_input(doc)['reviewFlags'])

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

    def test_one_figure_without_ocr_text_retains_image_and_marks_source_for_review(self):
        self.assertEqual(layout([],[[10,10,500,500]]),{'candidates':{},'reviewFlags':['empty-source-rows']})

    def test_bad_coordinates_and_duplicate_references_raise(self):
        with self.assertRaises(ValueError):
            layout([line('x',11,20,10)],[])
        with self.assertRaises(ValueError):
            layout([line('x',10,520,600)],[[100,100,900,500]],[['x','x']])


if __name__=='__main__':
    unittest.main()
