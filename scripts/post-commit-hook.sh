#!/usr/bin/env bash
# Auto-publish after each commit: verify, package, push.
#
# Enabled by scripts/publish.sh, which installs this hook. Set
# RUANG_NO_AUTOPUBLISH=1 to skip it for a single commit.
#
# The hook never fails the commit itself: if the push or the build breaks,
# the commit still lands and the error is printed for the operator.

if [ "${RUANG_NO_AUTOPUBLISH:-0}" = "1" ]; then
  exit 0
fi

# The hook lives in .git/hooks, so the repo root is two levels up from the
# hook file itself. Prefer git, fall back to the path only if git is missing.
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_DIR" ]; then
  REPO_DIR="$(cd "$HOOK_DIR/../.." && pwd)"
fi
LOG="${RUANG_PUBLISH_LOG:-/tmp/ruang-publish.log}"

{
  echo "--- publish hook fired at $(date -Is) ---"
  cd "$REPO_DIR"
  bash scripts/publish.sh
} >>"$LOG" 2>&1

status=$?
if [ "$status" -ne 0 ]; then
  echo ""
  echo "post-commit publish did not finish cleanly (exit $status)."
  echo "The commit is safe. Check $LOG for details."
fi
exit 0
