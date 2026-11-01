#!/usr/bin/env bash
# Publish a new Ruang version: verify, package, and push.
#
# Why a script and not a manual sequence: the Ruang deploy pipeline is
#   repo -> build -> tarball -> host
# and it has silently shipped stale tarballs before (a feature was committed
# but the tarball was built earlier, so the feature never went live).
# This script is the single command that does the whole chain, so the
# thing that gets tested is the thing that gets pushed and deployed.
#
# Usage:
#   scripts/publish.sh            # verify + package + push
#   scripts/publish.sh --no-push  # verify + package only
#
# Exit codes:
#   0  published (or packaged, with --no-push)
#   1  verification failed, nothing was packaged or pushed
#   2  packaging failed
#   3  push failed (the tarball is still usable)

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARBALL="${RUANG_TARBALL:-/root/ruang-mc-write.tar.gz}"
DO_PUSH=1
[ "${1:-}" = "--no-push" ] && DO_PUSH=0

cd "$REPO_DIR"

say() { printf '\n=== %s ===\n' "$1"; }

say "identity"
git config user.name
git config user.email
echo "branch: $(git rev-parse --abbrev-ref HEAD)"

say "working tree"
if [ -n "$(git status --porcelain)" ]; then
  echo "There are uncommitted changes. Commit them before publishing:"
  git status --short
  exit 1
fi
echo "clean"

say "lint"
npm run lint

say "tests"
# jsdom 30 (needed by src/office-dialog-focus.test.tsx) requires Node >= 22.22,
# so on Node 20 that one file cannot even be collected. Vitest then reports
# "Errors 1" and exits 1 even though every collected test passed.
# CI runs Node 22, so this only happens locally. Fail on a real failed test,
# not on the environment mismatch, but say so loudly.
npm test > /tmp/ruang-publish-test.log 2>&1 || test_status=$?
test_status=${test_status:-0}
tail -8 /tmp/ruang-publish-test.log
if [ "$test_status" -ne 0 ]; then
  failed_tests="$(grep -E '^ *Tests +' /tmp/ruang-publish-test.log | tail -1)"
  if echo "$failed_tests" | grep -qE '[0-9]+ failed'; then
    echo ""
    echo "TESTS FAILED - refusing to publish."
    exit 1
  fi
  if grep -q 'markAsUncloneable is not a function' /tmp/ruang-publish-test.log; then
    echo ""
    echo "NOTE: the jsdom environment could not be loaded (Node $(node --version))."
    echo "      Every collected test passed, but src/office-dialog-focus.test.tsx"
    echo "      was not run. CI uses Node 22 and will cover it."
  else
    echo ""
    echo "Test run failed for an unknown reason - refusing to publish."
    exit 1
  fi
fi

say "build"
npm run build

say "package"
# Mirror the layout the host expects: a single top-level directory named
# ruang_build, so the host can extract with --strip-components=1.
rm -f "$TARBALL"
tar czf "$TARBALL" \
  --exclude='ruang_build/node_modules' \
  --exclude='ruang_build/dist' \
  --exclude='ruang_build/build' \
  --exclude='ruang_build/.git' \
  ruang_build
ls -lh "$TARBALL"
sha256sum "$TARBALL"

# The tarball must actually contain the feature that was just committed.
# A stale tarball is the failure mode this whole pipeline keeps hitting.
say "package sanity"
missing=0
for required in \
  ruang_build/package.json \
  ruang_build/src/pages/Admin.tsx \
  ruang_build/server/index.ts
do
  if ! tar tzf "$TARBALL" | grep -qx "$required"; then
    echo "MISSING from tarball: $required"
    missing=1
  fi
done
[ "$missing" -eq 0 ] || exit 2
echo "required files present"

say "push"
if [ "$DO_PUSH" -eq 0 ]; then
  echo "skipped (--no-push)"
  exit 0
fi

if [ -z "$(git log --format=%H @{u}..HEAD 2>/dev/null)" ]; then
  echo "already up to date with $(git rev-parse --abbrev-ref '@{u}')"
  exit 0
fi

git push origin "$(git rev-parse --abbrev-ref HEAD)"
echo "pushed $(git rev-parse --short HEAD)"
