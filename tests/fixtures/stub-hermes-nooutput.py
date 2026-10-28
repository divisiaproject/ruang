#!/usr/bin/env python3
"""TEST FIXTURE: a `hermes` stub that REJECTS --output, to exercise the
fallback path in exportProfile() (writes to CWD when --output is unsupported)."""
import json
import os
import sys
from pathlib import Path

LOG = Path(os.environ.get("STUB_LOG", "/tmp/stub_hermes_nooutput.jsonl"))
argv = sys.argv[1:]
LOG.parent.mkdir(parents=True, exist_ok=True)
with LOG.open("a") as handle:
    handle.write(json.dumps(argv) + "\n")

profiles = Path("/root/.hermes/profiles")

if argv[:2] == ["profile", "create"]:
    (profiles / argv[2]).mkdir(parents=True, exist_ok=True)
    print(f"Created profile {argv[2]}")
elif argv[:2] == ["profile", "delete"]:
    import shutil
    shutil.rmtree(profiles / argv[2], ignore_errors=True)
    print(f"Deleted profile {argv[2]}")
elif argv[:2] == ["profile", "export"]:
    if "--output" in argv or "-o" in argv:
        # Simulate a CLI that does not support the flag.
        sys.stderr.write("error: unrecognized arguments: --output\n")
        sys.exit(2)
    # No --output: the real CLI writes <name>.tar.gz into the CWD.
    target = Path.cwd() / f"{argv[2]}.tar.gz"
    target.write_bytes(b"fallback-tarball-content-padding" * 4)
    print(f"Exported to {target}")
else:
    print("ok")
