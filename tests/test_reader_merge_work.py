import contextlib
import io
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('merge_work', Path(__file__).resolve().parents[1] / 'tools/reader-merge-work.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class WorkMergeTests(unittest.TestCase):
    def test_unrecognized_lock_and_changed_program_stop(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            program = root / 'book_merge_guard.py'
            program.write_bytes(b'synthetic')
            lock = json.dumps({'release_id': 'fixture', 'sha256': {program.name: hashlib.sha256(program.read_bytes()).hexdigest()}}).encode()
            (root / 'active_release.json').write_bytes(lock)
            with self.assertRaises(ValueError):
                module.verify_runtime(root)
            pins = root / 'fixture-locks.json'
            pins.write_text(json.dumps({'releaseId': 'fixture', 'packages': {
                'production': '0' * 64, 'integration': hashlib.sha256(lock).hexdigest()}}))
            with patch.object(module, 'RUNTIME_LOCKS', pins):
                module.verify_runtime(root)
                altered = json.loads(lock)
                altered['release_id'] = 'other'
                (root / 'active_release.json').write_text(json.dumps(altered))
                with self.assertRaises(ValueError):
                    module.verify_runtime(root)
                (root / 'active_release.json').write_bytes(lock)
                program.write_bytes(b'changed')
                with self.assertRaises(ValueError):
                    module.verify_runtime(root)

    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.scope = {'schema':'reader-work-request-v1','bookId':'example-book','scanRange':[1,3]}
        self.req = self.root/'request.json'
        self.req.write_text(json.dumps(self.scope))
        self.statefile = self.root/'state.json'
        self.state = {'book_id':'example-book','scan_range':[1,3], 'scope':{'include_merge':True},'artifacts':[]}
        self.manifest = {'book_id':'example-book','expected_source_pages':{'start':1,'end':3},'files':[]}
        self.base = ['--runtime', str(self.root)]
        self.common = ['--request',str(self.req),'--workflow-root',str(self.root),'--workflow-state',str(self.statefile),'--out-dir',str(self.root/'out')]

    def pin(self, name, data):
        p = self.root/name
        p.parent.mkdir(exist_ok=True)
        raw = json.dumps(data).encode()
        p.write_bytes(raw)
        self.state['artifacts'].append({'domain':'content','role':'canonical_content','path':name,'baseline_sha256':hashlib.sha256(raw).hexdigest()})
        self.statefile.write_text(json.dumps(self.state))
        return p

    def stage(self, primary='wrong.json', code=0):
        out = io.StringIO()
        with patch.object(module,'verify_runtime'), patch.object(module.subprocess,'run') as run, contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            run.return_value.returncode = code
            run.return_value.stdout = ''
            run.return_value.stderr = 'NG: fixture' if code else ''
            result = module.main(self.base+['stage','--book-dir',str(self.root),'--manifest',str(self.root/primary)]+self.common)
        return result,run,json.loads(out.getvalue()) if result else {}

    def test_unique_alternative_runs_stage(self):
        p = self.pin('correct.json',self.manifest)
        code,run,_ = self.stage()
        self.assertEqual(code,0)
        command=run.call_args.args[0]
        self.assertIn(str(p),command)
        self.assertIn(str(self.req),command)

    def test_ambiguous_or_changed_primary_never_runs(self):
        self.pin('first.json',self.manifest)
        self.pin('second.json',self.manifest)
        code,run,r = self.stage()
        self.assertEqual(r['nextAction']['id'],'resolve_approved_input')
        run.assert_not_called()
        (self.root/'first.json').write_text('changed')
        code,run,r = self.stage('first.json')
        self.assertEqual(r['nextAction']['id'],'restore_registered_input')
        run.assert_not_called()

    def test_other_scope_not_selected(self):
        self.pin('other.json',{**self.manifest,'book_id':'other-book'})
        code,run,r = self.stage()
        self.assertEqual(code,2)
        self.assertFalse(r['mergeCompleted'])
        run.assert_not_called()

    def test_failed_segment_still_checks_siblings(self):
        data=b'exact'
        (self.root/'ok.txt').write_bytes(data)
        row={'role':'reading_segment','book_id':'example-book','status':'approved','sha256':hashlib.sha256(data).hexdigest()}
        self.pin('correct.json',{**self.manifest,'files':[{**row,'path':n} for n in ['missing','ok.txt']]})
        code,run,r = self.stage('correct.json',2)
        self.assertEqual(run.call_count,1)
        self.assertEqual([x['status'] for x in r['inputAudit']],['missing','bytes_match'])

    def test_merge_selects_only_index_bound_to_identical_request(self):
        bound=module.request_scope(self.req)
        data={**self.manifest,'reading_segments':[], 'requested_scope':bound}
        self.pin('old/approved_files.json',{**data,'requested_scope':{**bound,'sha256':'0'*64}})
        self.pin('selected/approved_files.json',data)
        with patch.object(module,'verify_runtime'), patch.object(module.subprocess,'run') as run, contextlib.redirect_stderr(io.StringIO()):
            run.return_value.returncode=0
            run.return_value.stdout=run.return_value.stderr=''
            self.assertEqual(module.main(self.base+['merge','--staged-dir',str(self.root/'old')]+self.common),0)
            self.assertIn(str(self.root/'selected'),run.call_args.args[0])

if __name__ == '__main__':
    unittest.main()
