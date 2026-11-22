#!/usr/bin/env python3
"""Run a request-bound merge from the current private runtime distribution."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import re

ACTIVE_LOCK_SHA256 = 'fc2e9791634a747380fdb663351c8778c8f09a4f0800d05dd9e4d9808f08d670'


def verify_runtime(root):
    lock = (root / 'active_release.json').read_bytes()
    if hashlib.sha256(lock).hexdigest() != ACTIVE_LOCK_SHA256:
        raise ValueError('統合運用版が一致しません。現行のWork用統合パッケージを使用してください')
    for name, expected in json.loads(lock)['sha256'].items():
        if hashlib.sha256((root / name).read_bytes()).hexdigest() != expected:
            raise ValueError('配布した統合運用版とファイルが一致しません: ' + name)


class MergeHold(ValueError):
    def __init__(self, task, message, candidates=()):
        super().__init__(message)
        self.task = task
        self.candidates = [str(path) for path in candidates]


def read_object(path):
    data = json.loads(Path(path).read_bytes())
    if not isinstance(data, dict):
        raise ValueError('JSONオブジェクトが必要です')
    return data


def request_scope(path):
    raw = Path(path).read_bytes()
    req = json.loads(raw)
    if not isinstance(req, dict):
        raise ValueError('依頼記録を確認してください')
    scans = req.get('scanRange')
    if (req.get('schema') != 'reader-work-request-v1'
            or not isinstance(req.get('bookId'), str)
            or not re.fullmatch(r'[a-z0-9-]{3,150}', req['bookId'])
            or not isinstance(scans, list) or len(scans) != 2
            or not all(type(n) in (int, float) and 1 <= n <= 9007199254740991 and int(n) == n for n in scans)
            or scans[0] > scans[1]):
        raise ValueError('依頼の書籍ID・原本開始／終了番号を確認してください')
    return {'bookId': req['bookId'], 'scanRange': scans, 'sha256': hashlib.sha256(raw).hexdigest()}


def matches(data, scope, action):
    pages = data.get('expected_source_pages')
    if not isinstance(pages, dict) or data.get('book_id') != scope['bookId']:
        return False
    pair = [pages.get('start'), pages.get('end')]
    if not all(type(n) is int for n in pair) or pair != scope['scanRange']:
        return False
    if action == 'stage':
        return isinstance(data.get('files'), list)
    return isinstance(data.get('reading_segments'), list) and data.get('requested_scope') == scope


def choose_input(args, scope):
    root = Path(args.workflow_root).absolute()
    state = read_object(args.workflow_state)
    if state.get('book_id') != scope['bookId'] or state.get('scan_range') != scope['scanRange']:
        raise MergeHold('locate_matching_workflow', '依頼の書籍・範囲に対応する現行の工程台帳を選び直す')
    if state.get('scope', {}).get('include_merge') is not True:
        raise MergeHold('check_requested_work', '工程台帳の依頼範囲を確認し、現在許可されている作業へ進む')
    primary = Path(args.manifest if args.action == 'stage' else Path(args.staged_dir)/'approved_files.json').absolute()
    choices = []
    for row in state.get('artifacts', []):
        if row.get('domain') != 'content' or row.get('role') != 'canonical_content':
            continue
        rel = Path(row['path'])
        if rel.is_absolute() or '..' in rel.parts or chr(92) in str(rel):
            continue
        p = root / rel
        if p != primary and any(part.lower() in {'history','retained','archive','retired','履歴'} for part in rel.parts[:-1]):
            continue
        if args.action == 'merge' and p.name != 'approved_files.json':
            continue
        if p != primary and args.action == 'stage' and not p.is_relative_to(Path(args.book_dir).absolute()):
            continue
        if p.suffix.lower() != '.json' and p != primary:
            continue
        if p.is_symlink() or any(x.is_symlink() for x in p.parents) or not p.is_file():
            if p == primary:
                raise MergeHold('restore_registered_input', '指定された登録入力を元のファイルから復元し、登録SHAを照合する', [p])
            continue
        raw = p.read_bytes()
        if hashlib.sha256(raw).hexdigest() != row.get('baseline_sha256'):
            if p == primary:
                raise MergeHold('restore_registered_input', '指定された登録入力の内容が変わった。確定時の実体と登録SHAを照合する', [p])
            continue
        try:
            data = json.loads(raw)
        except (UnicodeError, ValueError):
            continue
        if isinstance(data, dict) and matches(data, scope, args.action):
            choices.append(p)
    if primary in choices:
        return primary, False
    if len(choices) == 1:
        return choices[0], True
    if len(choices) > 1:
        raise MergeHold('resolve_approved_input', '候補が複数あります。採用記録と照合して現行入力を指定する', choices)
    if args.action == 'merge':
        raise MergeHold('stage_and_register', '同じ依頼で分冊を選定し、生成したapproved_files.jsonと実SHAを同じ工程台帳に登録してから統合する')
    raise MergeHold('locate_approved_segments', '対象範囲の確定分冊と不足ページを採用台帳で確認し、該当する統合台帳を登録する')


def resume_queue(args, scope):
    if not args.entry or not args.expected_entry_sha256 or not scope:
        return {}
    path = Path(__file__).with_name('reader-work-resume.cjs')
    try:
        result = subprocess.run(['node', str(path), '--entry', args.entry, '--expected-entry-sha256',
                                 args.expected_entry_sha256, '--request', args.request, '--surface', 'work'],
                                capture_output=True, text=True, check=False)
        data = json.loads(result.stdout)
        if (result.returncode == 0 and data.get('status') == 'resume_consistent'
                and data.get('requestedScope') == scope and data.get('bookId') == scope['bookId']
                and data.get('scanRange') == scope['scanRange']):
            return {'readyTasks': data['readyTasks'], 'nextProductionTask': data.get('nextAction'),
                    'deferredTasks': data.get('deferredTasks', []), 'externalWaiting': data.get('externalWaiting', []),
                    'sourceReview': data.get('sourceReview')}
        return {'resumeErrors': data.get('errors', ['再開台帳を照合できませんでした'])}
    except (OSError, ValueError, KeyError) as error:
        return {'resumeErrors': [str(error)]}


def report_hold(args, scope, error, details=(), evidence=None):
    report = {'status': 'merge_pending', 'phase': args.action, 'requestedScope': scope,
              'nextAction': {'id': error.task, 'instruction': str(error)}, 'candidates': error.candidates,
              'diagnostics': list(details), 'mergeCompleted': False, 'readyTasks': []}
    report.update(evidence or {})
    report.update(resume_queue(args, scope))
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 2


def audit_remaining(args, source, scope, state_digest):
    # Read current, independently registered bytes only. This is a file check, not source proofreading.
    try:
        current, _ = choose_input(args, scope)
        if (current != source or request_scope(args.request) != scope
                or hashlib.sha256(Path(args.workflow_state).read_bytes()).hexdigest() != state_digest):
            return {}
        raw = source.read_bytes()
        state = read_object(args.workflow_state)
        rel = str(source.relative_to(Path(args.workflow_root).absolute()))
        if not any(row.get('path') == rel and row.get('baseline_sha256') == hashlib.sha256(raw).hexdigest()
                   for row in state['artifacts']):
            return {}
        data = json.loads(raw)
        if not matches(data, scope, args.action):
            return {}
        if args.action == 'stage':
            rows, base, field = data['files'], Path(args.book_dir).absolute(), 'path'
        else:
            rows = data['reading_segments'] + data['supporting_assets']
            base, field = source.parent, 'staged_path'
        checked = []
        for row in rows:
            if not isinstance(row, dict) or row.get('status') != 'approved' or row.get('book_id') != scope['bookId']:
                continue
            name = row.get(field)
            if not isinstance(name, str) or not name:
                continue
            part = Path(name)
            if part.is_absolute() or '..' in part.parts or chr(92) in name:
                continue
            file = base / part
            if any(x.is_symlink() for x in (file, *file.parents)):
                status = 'unsafe_reference'
            elif not file.is_file():
                status = 'missing'
            else:
                try:
                    with file.open('rb') as stream:
                        h = hashlib.sha256()
                        for block in iter(lambda: stream.read(1024 * 1024), b''):
                            h.update(block)
                    status = 'bytes_match' if h.hexdigest() == row.get('sha256') else 'hash_mismatch'
                except OSError:
                    status = 'unreadable'
            checked.append({'path': name, 'role': row.get('role'), 'scans': row.get('source_scan_ids', []), 'status': status})
        return {'inputAudit': checked}
    except (ValueError, TypeError, OSError, KeyError, AttributeError):
        return {}


def failed_check(lines):
    why = ' '.join(lines)
    if '既に存在' in why or '出力先が存在' in why:
        return MergeHold('check_existing_output', '既存出力の依頼・入力・SHAを確認し、改版が必要なときは別の出力先を使う')
    if '経路' in why or 'ブラウザ環境' in why:
        return MergeHold('restore_verification_route', '確認経路を復旧し、小さな確認用データで動作を確認する')
    if '凍結' in why:
        return MergeHold('review_frozen_version', '採用済みの凍結版と依頼の差分を確認する')
    return MergeHold('review_failed_input', '診断に示された原本・分冊・台帳を照合し、該当箇所の根拠を整える')


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
        command.add_argument('--entry', help='採用済みの制作再開entry')
        command.add_argument('--expected-entry-sha256', help='外部に固定されたentry SHA')
    args = parser.parse_args(argv)
    root = args.runtime.resolve()
    scope = None
    try:
        verify_runtime(root)
    except (ValueError, OSError) as error:
        return report_hold(args, scope, MergeHold('restore_current_runtime', str(error)))
    try:
        scope = request_scope(args.request)
    except (ValueError, OSError) as error:
        return report_hold(args, scope, MergeHold('restore_original_request', str(error)))
    try:
        state_digest = hashlib.sha256(Path(args.workflow_state).read_bytes()).hexdigest()
        source, recovered = choose_input(args, scope)
        if args.action == 'stage':
            command = [str(root / 'book_merge_guard.py'), 'stage', '--book-dir', args.book_dir, '--manifest', str(source)]
        else:
            command = [str(root / 'merge_approved_book.py'), '--staged-dir', str(source.parent)]
        if request_scope(args.request) != scope:
            raise MergeHold('restore_original_request', '依頼記録が変わったため、元の依頼と照合する')
        if recovered:
            print('工程台帳から依頼に一致する登録入力を1件復元して続行:', source, file=sys.stderr)
        command.extend(['--request', args.request, '--workflow-state', args.workflow_state,
                        '--workflow-root', args.workflow_root, '--out-dir', args.out_dir])
        result = subprocess.run([sys.executable, '-B', *command], capture_output=True, text=True, check=False)
        if result.returncode:
            lines = [line for line in (result.stderr + '\n' + result.stdout).splitlines() if line.strip()]
            task = failed_check(lines)
            evidence = {}
            if args.action == 'stage' and any(line.startswith('NG: ') for line in lines):
                evidence = audit_remaining(args, source, scope, state_digest)
            return report_hold(args, scope, task, lines, evidence)
        sys.stdout.write(result.stdout)
        sys.stderr.write(result.stderr)
        return 0
    except MergeHold as error:
        return report_hold(args, scope, error)
    except (OSError, KeyError, AttributeError, TypeError, ValueError) as error:
        return report_hold(args, scope, MergeHold('inspect_workflow_inputs', '工程台帳と入力ファイルを照合する'), [str(error)])


if __name__ == '__main__':
    sys.exit(main())
