#!/usr/bin/env python3
"""TEST FIXTURE ONLY — stands in for `hermes` so board-stats can be exercised end to end.

Argv is recorded to $STUB_LOG so the test can assert exactly which verbs were called.
Output shapes are copied verbatim from Hermes v0.19.0 on the user's host (2026-10-28).

Hermes accepts `--board` BEFORE the subcommand (`hermes kanban --board x stats`), so the
subcommand is the first non-flag token, not simply argv[1].
"""
import json
import os
import sys

argv = sys.argv[1:]
log = os.environ.get('STUB_LOG')
if log:
    with open(log, 'a', encoding='utf-8') as handle:
        handle.write(json.dumps(argv) + '\n')


def flag(name, default=None):
    """Value of a flag, tolerating both `--flag v` and `--flag=v`."""
    for index, token in enumerate(argv):
        if token == name and index + 1 < len(argv):
            return argv[index + 1]
        if token.startswith(name + '='):
            return token.split('=', 1)[1]
    return default


def positionals():
    """Tokens that are not flags and not flag values."""
    values, skip = [], False
    for token in argv:
        if skip:
            skip = False
            continue
        if token.startswith('-'):
            if '=' not in token:
                skip = True
            continue
        values.append(token)
    return values


board = flag('--board', 'default')
pos = positionals()

if pos[:1] == ['kanban'] and len(pos) > 1:
    sub = pos[1]
    if sub == 'boards':
        print(json.dumps([
            {"slug": "default", "name": "Default", "total": 0, "current": True},
            {"slug": "divisia", "name": "Divisia", "total": 6, "current": False},
        ]))
        sys.exit(0)
    if sub == 'stats':
        # Verbatim Hermes v0.19.0 text shape, incl. the irregular "scheduled" spacing.
        if board == 'divisia':
            sys.stdout.write(
                "By status:\n  triage     1\n  todo       2\n  scheduled  1\n"
                "  ready      1\n  running    0\n  blocked    1\n  done       4\n"
            )
        else:
            sys.stdout.write(
                "By status:\n  triage    0\n  todo      0\n  scheduled  0\n"
                "  ready     0\n  running   0\n  blocked   0\n  done      0\n"
            )
        sys.exit(0)
    if sub in {'list', 'ls'}:
        print('[]')
        sys.exit(0)

sys.stderr.write('stub: unsupported invocation %r\n' % (argv,))
sys.exit(1)
