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
            lock = json.dumps({'sha256': {program.name: hashlib.sha256(program.read_bytes()).hexdigest()}}).encode()
            (root / 'active_release.json').write_bytes(lock)
            with self.assertRaises(ValueError):
                module.verify_runtime(root)
            with patch.object(module, 'ACTIVE_LOCK_SHA256', hashlib.sha256(lock).hexdigest()):
                module.verify_runtime(root)
                program.write_bytes(b'changed')
                with self.assertRaises(ValueError):
                    module.verify_runtime(root)

    def test_each_phase_forwards_the_same_explicit_request_and_exit_status(self):
        common = ['--workflow-state','state','--workflow-root','work','--request','request','--out-dir','out']
        with patch.object(module, 'verify_runtime'), patch.object(module.subprocess, 'run') as run:
            run.return_value.returncode = 2
            for action, extras in [('stage',['--book-dir','book','--manifest','manifest']), ('merge',['--staged-dir','staged'])]:
                self.assertEqual(module.main(['--runtime','runtime',action,*extras,*common]),2)
                args = run.call_args.args[0]
                self.assertEqual(args[args.index('--request')+1], 'request')
                self.assertTrue(any(x.endswith('book_merge_guard.py' if action=='stage' else 'merge_approved_book.py') for x in args))


if __name__ == '__main__':
    unittest.main()
