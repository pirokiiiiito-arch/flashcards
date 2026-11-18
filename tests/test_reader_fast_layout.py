"""Private reader layout cache and fail-closed logic: synthetic-only."""
import importlib.util
import json
import tempfile
import pathlib
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
SPEC=importlib.util.spec_from_file_location("reader_fast_layout",ROOT/"tools"/"reader-fast-layout.py")
mod=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)

class FastReaderChecks(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder=pathlib.Path(self.tmp.name)
        self.html=self.folder/"20261119_0606_synthetic_reader.html"
        self.html.write_bytes(b"synthetic HTML for cache test only")
        self.report=self.folder/"cache.json"

    def test_29_unique_cases_and_image_dimensions(self):
        cases=mod.cases()
        self.assertEqual(len(cases),29)
        self.assertEqual(len({x['id'] for x in cases}),29)
        self.assertEqual(len([x for x in cases if x['kind']=="font"]),24)
        self.assertEqual(len([x for x in cases if x['kind']=="height"]),5)
        self.assertEqual(set(x['width'] for x in cases),{320,390,430})
        self.assertEqual(set(x['font'] for x in cases if x['kind']=="font"),
                         {16,18,20,22,24,26,28,30})

    def test_cache_accepts_exact_sha_and_runner_only(self):
        first=mod.new_report(self.html,self.report)
        self.assertEqual(first['results'],{})
        sample=mod.cases()[0]
        first['results'][sample['id']]={'status':'passed','errors':[]}
        mod.atomic_json(self.report,first)
        second=mod.new_report(self.html,self.report)
        self.assertIn(sample['id'],second['results'])
        self.assertEqual(second['artifactSha256'],first['artifactSha256'])
        self.assertEqual(second['runnerSha256'],first['runnerSha256'])

    def test_one_byte_edit_invalidates_all_cached_cases(self):
        r=mod.new_report(self.html,self.report)
        r['results']={c['id']:{'status':'passed','errors':[]} for c in mod.cases()}
        mod.atomic_json(self.report,r)
        self.html.write_bytes(self.html.read_bytes()+b'\n')
        newer=mod.new_report(self.html,self.report)
        self.assertEqual(newer['results'],{})
        self.assertNotEqual(newer['artifactSha256'],r['artifactSha256'])

    def test_runner_code_change_invalidates_cache(self):
        r=mod.new_report(self.html,self.report)
        r['runnerSha256']='0'*64
        r['results']={mod.cases()[0]['id']:{'status':'passed'}}
        mod.atomic_json(self.report,r)
        self.assertEqual(mod.new_report(self.html,self.report)['results'],{})

    def test_cache_never_authorizes_source_proofreading_or_iphone(self):
        r=mod.new_report(self.html,self.report)
        r['results']={c['id']:{'status':'passed','errors':[]} for c in mod.cases()}
        self.assertEqual(r['sourceProofreading'],'not_run_by_this_tool')
        self.assertEqual(r['canonical60'],'not_run_by_this_tool')
        self.assertEqual(r['realIPhone'],'not_run_by_this_tool')
        self.assertEqual(r['eligibleForDelivery'],False)

    def test_incorrect_reader_or_columns_fail_closed(self):
        c=next(x for x in mod.cases() if x['font']==20)
        fake={'pages':2,'font':20,'size':'20px','view':{'width':c['width'],'height':c['height']},
             'sheet':{'x':0,'width':c['width']-20,'height':300},'warning':'',
             'g404Pass':True,'textIntegrity':True,'novelSourceIntegrity':True,'originalReady':True}
        self.assertEqual(mod.assess(fake,c,[]),[])
        fake['textIntegrity']=False
        self.assertIn('TEXT_READER_INTEGRITY_FAIL',mod.assess(fake,c,[]))
        fake['textIntegrity']=True
        fake['g404Pass']=False
        self.assertIn('NOVEL_COLUMN_LAYOUT_WARNING',mod.assess(fake,c,[]))
        fake['g404Pass']=True
        self.assertIn('CHROMIUM_PAGE_ERROR',mod.assess(fake,c,['synthetic error']))
        wrong={**c,'font':30}
        self.assertIn('FONT_NOT_MATCHED',mod.assess(fake,wrong,[]))

    def test_invalid_report_cannot_be_reused(self):
        self.report.write_text('malformed JSON',encoding='utf-8')
        self.assertEqual(mod.new_report(self.html,self.report)['results'],{})
        self.report.write_text(json.dumps({'schema':'old','results':{'fake':{'status':'passed'}}}),encoding='utf-8')
        self.assertEqual(mod.new_report(self.html,self.report)['results'],{})

if __name__=="__main__":
    unittest.main()
