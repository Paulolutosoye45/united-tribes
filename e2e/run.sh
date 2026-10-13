#!/bin/bash
# Browser journeys, end to end, against the stand-in backend (a real Postgres with every migration).
#
#   npm run e2e                 build, start everything, run every journey, stop
#   npm run e2e -- 01 05        only journeys whose file name starts with 01 or 05
#   E2E_SKIP_BUILD=1 npm run e2e    reuse the last build
#
# Needs a normal user (Postgres refuses to run as root) and a Chromium: set CHROMIUM_PATH,
# or run `npx playwright-core install chromium` once.
set -u
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
OUT="$ROOT/.e2e"
mkdir -p "$OUT/logs"
eval "$(npx tsx e2e/env.ts --print)"
# Lets a journey refuse the requests a service worker makes, to test the app with no signal (journey 08).
export PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1

stop_all() { pkill -f "[n]ext-server" 2>/dev/null; pkill -f "e2e/[s]tack.ts" 2>/dev/null; pkill -f "e2e/[s]tubs.ts" 2>/dev/null; true; }
stop_all
sleep 1

if [ -z "${E2E_SKIP_BUILD:-}" ]; then
  echo "Building the app..."
  npx next build > "$OUT/logs/build.log" 2>&1 || { echo "BUILD FAILED"; tail -30 "$OUT/logs/build.log"; exit 1; }
fi

rm -f "$OUT/stack.json" "$OUT/logs/stack.log"
nohup npx tsx e2e/stack.ts > "$OUT/logs/stack.log" 2>&1 &
for i in $(seq 1 60); do sleep 2; grep -q "STACK READY" "$OUT/logs/stack.log" 2>/dev/null && break; done
grep -q "STACK READY" "$OUT/logs/stack.log" || { echo "STACK DID NOT START"; tail -20 "$OUT/logs/stack.log"; exit 1; }
for i in $(seq 1 30); do curl -fs "http://127.0.0.1:${E2E_PORT:-3100}/api/health" >/dev/null 2>&1 || curl -fs "http://127.0.0.1:${E2E_PORT:-3100}/sign-in" >/dev/null 2>&1 && break; sleep 1; done

failed=0
total=0
for file in e2e/journeys/*.ts; do
  name="$(basename "$file" .ts)"
  if [ $# -gt 0 ]; then
    match=0
    for want in "$@"; do case "$name" in "$want"*) match=1;; esac; done
    [ $match -eq 1 ] || continue
  fi
  total=$((total+1))
  echo "=== $name"
  if npx tsx "$file" > "$OUT/logs/$name.log" 2>&1; then
    tail -1 "$OUT/logs/$name.log"
  else
    failed=$((failed+1))
    grep -n "✗\|Error" "$OUT/logs/$name.log" | head -12
    tail -1 "$OUT/logs/$name.log"
  fi
done
stop_all
echo "=== $((total-failed)) of $total journeys passed"
[ $failed -eq 0 ]
