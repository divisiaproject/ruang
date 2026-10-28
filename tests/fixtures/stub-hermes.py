#!/usr/bin/env python3
"""TEST FIXTURE ONLY - a fake `hermes` used to prove the write module's argv
handling and success path. This is NOT real Hermes and must never be shipped.
It records the argv it receives so the test can assert no injection occurred."""
import json
import os
import sys
from pathlib import Path

LOG = Path(os.environ.get("STUB_LOG", "/tmp/stub_hermes.jsonl"))
argv = sys.argv[1:]
LOG.parent.mkdir(parents=True, exist_ok=True)
with LOG.open("a") as handle:
    handle.write(json.dumps(argv) + "\n")

profiles = Path("/root/.hermes/profiles")

if argv[:2] == ["profile", "create"]:
    name = argv[2]
    (profiles / name).mkdir(parents=True, exist_ok=True)
    print(f"Created profile {name}")
elif argv[:2] == ["profile", "delete"]:
    name = argv[2]
    import shutil
    shutil.rmtree(profiles / name, ignore_errors=True)
    print(f"Deleted profile {name}")
elif argv[:2] == ["profile", "rename"]:
    old, new = argv[2], argv[3]
    (profiles / old).rename(profiles / new)
    print(f"Renamed {old} -> {new}")
elif argv[:2] == ["profile", "export"]:
    name = argv[2]
    target = Path(f"{name}.tar.gz")
    if "--output" in argv:
        target = Path(argv[argv.index("--output") + 1])
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"fake-tarball-content-padding" * 4)
    print(f"Exported to {target}")
elif argv[:1] == ["-p"] or "config" in argv:
    print("Set config")
else:
    print("ok")
