#!/usr/bin/env python3
"""Run a request-bound merge from the current private runtime distribution."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ACTIVE_LOCK_SHA256 = '6e31546af47084f4d3e4fb258fb226d59f54951b8e254799429b564beceacdce'


def verify_runtime(root):
    lock = (root / 'active_release.json').read_bytes()
    if hashlib.sha256(lock).hexdigest() != ACTIVE_LOCK_SHA256:
        raise ValueError('統合運用版が一致しません。現行のWork用統合パッケージを使用してください')
    for name, expected in json.loads(lock)['sha256'].items():
        if hashlib.sha256((root / name).read_bytes()).hexdigest() != expected:
            raise ValueError('配布した統合運用版とファイルが一致しません: ' + name)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    commands = parser.add_subparsers(dest='action', required=True)
    stage = commands.add_parser('stage')
    stage.add_argument('--book-dir', required=True)
    stage.add_argument('--manifest', required=True)
    merge = commands.add_parser('merge')
    merge.add_argument('--staged-dir', required=True)
    for command in (stage, merge):
        command.add_argument('--request', required=True)
        command.add_argument('--workflow-state', required=True)
        command.add_argument('--workflow-root', required=True)
        command.add_argument('--out-dir', required=True)
    args = parser.parse_args(argv)
    root = args.runtime.resolve()
    try:
        verify_runtime(root)
        if args.action == 'stage':
            command = [str(root / 'book_merge_guard.py'), 'stage', '--book-dir', args.book_dir,
                       '--manifest', args.manifest]
        else:
            command = [str(root / 'merge_approved_book.py'), '--staged-dir', args.staged_dir]
        command.extend(['--request', args.request, '--workflow-state', args.workflow_state,
                        '--workflow-root', args.workflow_root, '--out-dir', args.out_dir])
        return subprocess.run([sys.executable, '-B', *command], check=False).returncode
    except (OSError, ValueError) as error:
        print('STOP:', error, file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
