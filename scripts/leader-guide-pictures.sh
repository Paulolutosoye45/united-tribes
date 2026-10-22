#!/bin/bash
# Makes the pictures in the leader welcome email, from a throwaway copy of the site. See e2e/pictures/leader-guide.ts.
#
#   bash scripts/leader-guide-pictures.sh              build, start the throwaway site, make the pictures, stop
#   E2E_SKIP_BUILD=1 bash scripts/leader-guide-pictures.sh    reuse the last build
#
# Needs a normal user (Postgres refuses to run as root) and a Chromium: set CHROMIUM_PATH, or run
# `npx playwright-core install chromium` once. The pictures are written to public/email/leader-guide.
set -u
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
OUT="$ROOT/.e2e"
mkdir -p "$OUT/logs"
eval "$(npx tsx e2e/env.ts --print)"

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
for i in $(seq 1 30); do curl -fs "http://127.0.0.1:${E2E_PORT:-3100}/sign-in" >/dev/null 2>&1 && break; sleep 1; done

npx tsx e2e/pictures/leader-guide.ts
status=$?
stop_all
exit $status
