#!/usr/bin/env bash
PORT="${PORT:-4173}"
HABITS_URL="${HABITS_URL:-http://127.0.0.1:$PORT/}"

cleanup() { kill "$server_pid" 2>/dev/null; }
trap cleanup EXIT

npx serve -l "$PORT" -s . &>/dev/null &
server_pid=$!
sleep 1

for f in tests/*.js; do
  HABITS_URL="$HABITS_URL" node "$f" || { echo "FAIL: $f"; exit 1; }
  echo "PASS: $f"
done
echo "All tests passed"
