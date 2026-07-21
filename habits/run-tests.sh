#!/usr/bin/env bash
PORT="${PORT:-4181}"
HABITS_URL="http://127.0.0.1:$PORT/"

cleanup() { kill "$server_pid" 2>/dev/null; }
trap cleanup EXIT

npx serve -l "$PORT" -s . &>/dev/null &
server_pid=$!

# Wait for the static server to actually answer before driving tests at it.
# A fixed `sleep 1` races cold `npx` startups; polling the port lets slow
# machines catch up without slowing down the common case.
ready=0
for _ in $(seq 1 60); do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "test server failed to start on port $PORT (the port may already be in use)" >&2
    exit 1
  fi
  if curl -sf -o /dev/null "http://127.0.0.1:$PORT/"; then ready=1; break; fi
  sleep 0.25
done
if [ "$ready" -ne 1 ]; then
  echo "server did not become ready on port $PORT" >&2
  exit 1
fi

total_ok=0
total_not_ok=0
total_pageerrors=0
files_passed=0
files_failed=0
results=()

for f in tests/*.js; do
  name=$(basename "$f")
  tmpfile=$(mktemp)

  HABITS_URL="$HABITS_URL" node "$f" 2>&1 | tee "$tmpfile"
  exit_code=${PIPESTATUS[0]}
  output=$(cat "$tmpfile")
  rm "$tmpfile"

  ok_count=$(echo "$output" | grep -c '^  ok' || true)
  not_ok_count=$(echo "$output" | grep -c 'not ok' || true)
  pe_count=$(echo "$output" | grep -c 'pageerror:' || true)

  total_ok=$((total_ok + ok_count))
  total_not_ok=$((total_not_ok + not_ok_count))
  total_pageerrors=$((total_pageerrors + pe_count))

  if [ $exit_code -eq 0 ]; then
    results+=("PASS  $name  (${ok_count} assertions)")
    files_passed=$((files_passed + 1))
  else
    results+=("FAIL  $name  (exit $exit_code)")
    files_failed=$((files_failed + 1))
  fi
done

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  SUMMARY"
echo "═══════════════════════════════════════════════════════════"
for r in "${results[@]}"; do
  echo "  $r"
done
echo "───────────────────────────────────────────────────────────"
echo "  Files:           $files_passed passed, $files_failed failed"
total_assertions=$((total_ok + total_not_ok))
echo "  Assertions:      $total_ok ok, $total_not_ok not ok (${total_assertions} total)"
echo "  Page errors:     $total_pageerrors"
echo "═══════════════════════════════════════════════════════════"

if [ $files_failed -gt 0 ]; then exit 1; fi
