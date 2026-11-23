import sys
from pathlib import Path
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from reader_shelf_readback import normalize
from reader_shelf_wh1_parts import verify_region_review


class ReadbackTest(unittest.TestCase):
    def test_partial_matches_do_not_hide_intervening_noise_or_unclaimed_text(self):
        raw={'pageIndexes':[1], 'unknown':[], 'rows':[
            dict(key='b',scope='body',value={'text':'本来の文'}),
            dict(key='noise',scope='note',value={'text':'XX'}),
            dict(key='next',scope='note',value={'text':'欄題'})]}
        census=dict(completeScopes=['body','note','other'],regions=[
            dict(id='sample',scope='body'),dict(id='ornament',scope='other'),dict(id='label',scope='note')])
        regions,complete=normalize(raw,census,{'sample':dict(key='b',start=2,end=4),
            'ornament':dict(before='b',after='next',beforeLength=2,afterLength=2),'label':dict(key='next')})
        by_id={r['id']:r for r in regions}
        self.assertEqual(by_id['ornament']['observedWindow'],'の文XX欄題')
        self.assertEqual(by_id['unmapped/b/0']['value'],{'text':'本来'})
        self.assertEqual(by_id['unmapped/noise/0']['value'],{'text':'XX'})
        self.assertIn('body',complete)

    def test_ruby_is_read_from_painted_row_and_bound_to_its_own_parent(self):
        raw={'pageIndexes':[2], 'unknown':['other'], 'rows':[
            dict(key='caption-0',scope='caption',value={'text':'𠮷見本誌'},
                 rubies=[dict(start=1,end=3,base='見本',reading='みほん',page=2)])]}
        census=dict(completeScopes=['ruby','other'],regions=[dict(id='caption',scope='caption'),dict(id='annotation',scope='ruby')])
        regions,complete=normalize(raw,census,{'caption':dict(key='caption-0',start=1), 'annotation':dict(key='caption-0/ruby-0')})
        self.assertEqual(regions[1]['value'],dict(base='見本',reading='みほん',parent='caption',start=0,end=2))
        self.assertEqual(complete,['ruby'])

    def test_illegible_requires_original_view_and_observed_text_or_anchors(self):
        raw={'pageIndexes':[1], 'unknown':[], 'rows':[
            dict(key='a',scope='body',value={'text':'前文'}),
            dict(key='b',scope='note',value={'text':'注記'})]}
        census=dict(completeScopes=[],regions=[dict(id='spot',scope='other',illegible=True)])
        mapping={'spot':dict(before='a',after='b',beforeLength=2,afterLength=2)}
        self.assertEqual(normalize(raw,census,mapping)[0],[])
        observation={'mode':'reader-original','imageSha256':'original','box':[0,0,10,10]}
        rows,_=normalize(raw,census,mapping,{'spot':observation})
        self.assertEqual(rows[0]['value'],{'originalSha256':'original','box':[0,0,10,10]})
        self.assertEqual(rows[0]['legibilityDisplay']['observedWindow'],'前文注記')
        rows,_=normalize(raw,census,{'spot':dict(noteKey='b')},{'spot':observation})
        self.assertEqual(rows[0]['legibilityDisplay'],dict(kind='note',text='注記'))

    def test_region_gate_rejects_missing_reading_even_if_caption_matches(self):
        ruby=dict(base='見本',reading='みほん',start=0,end=2)
        r=dict(sourceSha256='S',regions=[dict(box=[0,0,12,10],text='見本',imageSha256='I',descriptionSha256='D',ruby=ruby)],prose=[])
        observed=dict(sourceSha256='S',figures=[dict(images=['I'],descriptions=['D'])],prose=[])
        args=('251',r,observed,{'D':'見本誌'},[20,20])
        verify_region_review(*args,{(251,'I','D'):[[ruby]]})
        for wrong in [[],[[dict(ruby,reading='べつ')]],[[dict(ruby,start=1)]],[[ruby,ruby]]]:
            with self.assertRaises(ValueError):verify_region_review(*args,{(251,'I','D'):wrong})


if __name__=='__main__':unittest.main()
