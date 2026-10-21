#!/usr/bin/env bash
# Phase 8: the way back, rehearsed on the original test suite.
#
# Builds two databases from the migration files and runs the tests that existed before the rework (Phase 0) against each:
#   baseline     the database as it stood before the rework began (migrations up to 20261215000100)
#   rolled back  every migration applied, then the three rollback files run, newest first
# The two runs must give the same answer test by test: everything the baseline passes, the rolled-back database passes too.
# Run as an ordinary user (Postgres refuses to start as root):   bash scripts/rehearse-rollback.sh
set -u
cd "$(dirname "$0")/.."
OUT="${REHEARSAL_OUT:-/tmp/ut-rehearsal}"
mkdir -p "$OUT"

# Tests written for the rework itself: they check the new behaviour, so they are not part of the original suite.
NEW='academy-switch|card-templates|card-templates-all|god-oversight|notices|notices-rollback|leader-appointments|leader-board|leader-fit|leader-fit-screen|matrix|pipeline|rollback|static-checks|switchboard|switchboard-journeys|placement-scorer|placement-plan|placement-send|placement-undo|placement-leaders|placement-rollback|placement-scale|assistant-recommendations'
FILES=()
for f in tests/db/*.test.ts; do
  name="$(basename "$f" .test.ts)"
  if ! echo "$name" | grep -Eq "^($NEW)$"; then FILES+=("$f"); fi
done
echo "Original suite: ${#FILES[@]} test files"

run() { # name, env...
  local name="$1"; shift
  env "$@" npx vitest run --config vitest.db.config.mts --reporter=json --outputFile="$OUT/$name.json" "${FILES[@]}" > "$OUT/$name.log" 2>&1
  echo "$name: finished (exit $?)"
}

run baseline UT_UPTO=20261215000100
run rolledback UT_ROLLED_BACK=1
node scripts/compare-vitest.mjs "$OUT/baseline.json" "$OUT/rolledback.json"
