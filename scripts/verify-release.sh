#!/usr/bin/env bash
# Everything that proves a build is fit to release, in the order that finds problems soonest.
#
#   bash scripts/verify-release.sh            type check, lint, unit, database tests, all 324 matrix combinations, production build, browser journeys
#   bash scripts/verify-release.sh quick      the first four only (a few minutes)
#   bash scripts/verify-release.sh rollback   also run the original suite against the rolled-back database (about ten minutes more)
#
# Run it as an ordinary user: Postgres refuses to start as root. It stops at the first step that fails and says which.
set -u
cd "$(dirname "$0")/.."
MODE="${1:-full}"
LOG="${VERIFY_LOG:-/tmp/ut-verify}"
mkdir -p "$LOG"
step=0
failed=0
run() { # label, command...
  local label="$1"; shift
  step=$((step + 1))
  printf '%2d. %-52s' "$step" "$label"
  local start=$SECONDS
  if "$@" > "$LOG/$step.log" 2>&1; then
    printf 'passed (%ss)\n' $((SECONDS - start))
  else
    printf 'FAILED (%ss)\n    last lines of %s/%s.log:\n' $((SECONDS - start)) "$LOG" "$step"
    tail -n 25 "$LOG/$step.log" | sed 's/^/    /'
    failed=1
    exit 1
  fi
}

run "Type check"                         npm run --silent typecheck
run "Lint"                               npm run --silent lint
run "Unit tests"                         npm run --silent test:unit
run "Database tests"                     npm run --silent test:db
if [ "$MODE" = "quick" ]; then echo "Quick checks passed."; exit 0; fi
run "All 324 combinations of the switches" npm run --silent test:matrix
run "Production build and browser journeys" npm run --silent e2e
if [ "$MODE" = "rollback" ]; then
  run "Rollback rehearsal on the original suite" npm run --silent test:rehearse
fi
echo "Everything passed. Logs are in $LOG."
