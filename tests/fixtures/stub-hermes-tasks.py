#!/usr/bin/env python3
"""TEST FIXTURE ONLY — stands in for `hermes` so the stuck view can be exercised end to end.

Payload shapes are copied verbatim from Hermes v0.19.0 on the user's host (2026-10-28).

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
    for index, token in enumerate(argv):
        if token == name and index + 1 < len(argv):
            return argv[index + 1]
        if token.startswith(name + '='):
            return token.split('=', 1)[1]
    return default


def positionals():
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
NOW = int(os.environ.get('STUB_NOW', '1793198807'))
HOUR = 3600


def task(tid, title, status, age_hours, assignee=None):
    return {
        "id": tid, "title": title, "body": None, "assignee": assignee,
        "status": status, "priority": 0, "tenant": None,
        "workspace_kind": "scratch", "workspace_path": None, "branch_name": None,
        "project_id": None, "created_by": "user", "created_at": NOW - age_hours * HOUR,
        "started_at": None, "completed_at": None, "result": None, "skills": [],
        "max_retries": None, "session_id": None, "workflow_template_id": None,
        "current_step_key": None,
    }


# A realistic mix: blocked, a stale ready, a fresh ready, and quiet statuses.
TASKS = [
    task("t_blocked", "Naskah kampanye belum dari vendor", "blocked", 30),
    task("t_slow", "Draft artikel divisia", "ready", 96),
    task("t_fresh", "cek bentuk data", "ready", 0),
    task("t_doing", "Edit video reels", "running", 200),
    task("t_done", "Posting IG minggu lalu", "done", 300),
]

if pos[:1] == ['kanban'] and len(pos) > 1:
    sub = pos[1]
    if sub == 'boards':
        print(json.dumps([
            {"slug": "default", "name": "Default", "total": len(TASKS), "current": True},
        ]))
        sys.exit(0)
    if sub == 'stats':
        print("By status:\n  triage    0\n  todo      0\n  scheduled  0\n"
              "  ready     2\n  running   1\n  blocked   1\n  done      1\n", end='')
        sys.exit(0)
    if sub in {'list', 'ls'}:
        print(json.dumps(TASKS))
        sys.exit(0)

sys.stderr.write('stub: unsupported invocation %r\n' % (argv,))
sys.exit(1)
