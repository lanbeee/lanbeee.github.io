#!/usr/bin/env bash
PORT="${PORT:-4181}"
PLANNER_MODE="${PLANNER_MODE:-default}"
if [ "$PLANNER_MODE" = "fast" ]; then
  HABITS_URL="http://127.0.0.1:$PORT/?planner=fast"
elif [ "$PLANNER_MODE" = "default" ]; then
  HABITS_URL="http://127.0.0.1:$PORT/"
else
  echo "unknown PLANNER_MODE '$PLANNER_MODE' (use 'default' or 'fast')" >&2
  exit 2
fi

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
files_skipped=0
results=()
failed_names=()

# Persist every run so failures can be inspected after the fact (the live `tee`
# used to be the only record, and it was discarded). Outputs land under
# test-results/ (gitignored): a stable last-run.log, a timestamped copy, and a
# per-failed-test dump under failed/. .last-run.json is rewritten each run so
# tooling never reads stale data; the previous run is preserved under the
# "previousRun" key so chained runs (e.g. fast then default) stay comparable.
RESULTS_DIR="test-results"
FAILED_DIR="$RESULTS_DIR/failed"
RUN_LOG="$RESULTS_DIR/last-run.log"
STAMPED_LOG="$RESULTS_DIR/run-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "$FAILED_DIR"
: > "$RUN_LOG"
echo "run-tests.sh — planner=$PLANNER_MODE — $(date)" > "$STAMPED_LOG"

for f in tests/*.js; do
  name=$(basename "$f")
  if [ "$PLANNER_MODE" = "fast" ]; then
    case "$name" in
      agenda-optimizer-test.js|progressive-render-test.js)
        results+=("SKIP  $name  (GLPK-specific)")
        files_skipped=$((files_skipped + 1))
        continue
        ;;
    esac
  fi
  tmpfile=$(mktemp)

  HABITS_PLANNER_MODE="$PLANNER_MODE" HABITS_URL="$HABITS_URL" node "$f" 2>&1 | tee "$tmpfile"
  exit_code=${PIPESTATUS[0]}
  output=$(cat "$tmpfile")

  # Keep the full per-test output: always append to the whole-run log, and
  # preserve failed tests individually for post-run triage. Clearing the
  # per-test file on pass keeps failed/ honest about the LAST result.
  {
    echo "===== $name (exit $exit_code) ====="
    cat "$tmpfile"
    echo
  } >> "$RUN_LOG"
  if [ $exit_code -ne 0 ]; then
    cp "$tmpfile" "$FAILED_DIR/$name.log"
    failed_names+=("$name")
  else
    rm -f "$FAILED_DIR/$name.log"
  fi
  rm "$tmpfile"

  ok_count=$(echo "$output" | grep -c '^  ok' || true)
  # Match TAP-style failure lines ("not ok …" / "  not ok: …"), not summary
  # text like "# 54 ok, 0 not ok" which also contains the substring.
  not_ok_count=$(echo "$output" | grep -cE '^[[:space:]]*not ok' || true)
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
echo "  Planner mode:    $PLANNER_MODE"
echo "  Files:           $files_passed passed, $files_failed failed, $files_skipped skipped"
total_assertions=$((total_ok + total_not_ok))
echo "  Assertions:      $total_ok ok, $total_not_ok not ok (${total_assertions} total)"
echo "  Page errors:     $total_pageerrors"
echo "═══════════════════════════════════════════════════════════"

# ── Persist the summary ──────────────────────────────────────
# Fold the human summary into the saved logs, then write a machine-readable
# last-run record. The stamped copy is for history; last-run.* are the "latest".
# The current run is staged in a temp file so the old .last-run.json can be
# read before it is overwritten (the redirect truncates it first).
CURRENT_RUN_FILE=$(mktemp)
{
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  SUMMARY"
  echo "═══════════════════════════════════════════════════════════"
  for r in "${results[@]}"; do echo "  $r"; done
  echo "───────────────────────────────────────────────────────────"
  echo "  Planner mode:    $PLANNER_MODE"
  echo "  Files:           $files_passed passed, $files_failed failed, $files_skipped skipped"
  echo "  Assertions:      $total_ok ok, $total_not_ok not ok (${total_assertions} total)"
  echo "  Page errors:     $total_pageerrors"
  echo "═══════════════════════════════════════════════════════════"
} >> "$RUN_LOG"
cat "$RUN_LOG" >> "$STAMPED_LOG"

run_status='passed'; [ "$files_failed" -gt 0 ] && run_status='failed'
if [ ${#failed_names[@]} -eq 0 ]; then
  failed_json="[]"
else
  failed_json=$(printf '"%s",' "${failed_names[@]}")
  failed_json="[${failed_json%,}]"
fi
cat > "$CURRENT_RUN_FILE" <<JSON
{
  "status": "$run_status",
  "plannerMode": "$PLANNER_MODE",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "files": { "passed": $files_passed, "failed": $files_failed, "skipped": $files_skipped },
  "assertions": { "ok": $total_ok, "notOk": $total_not_ok, "total": $total_assertions },
  "pageErrors": $total_pageerrors,
  "failedTests": $failed_json,
  "logs": {
    "lastRun": "$RUN_LOG",
    "stamped": "$STAMPED_LOG",
    "failedDir": "$FAILED_DIR"
  }
}
JSON

# Fold the previous run into .last-run.json as "previousRun" (stripped of its
# own previousRun so history stays flat: exactly the last-to-last run).
if [ -f "$RESULTS_DIR/.last-run.json" ]; then
  prev_content=$(cat "$RESULTS_DIR/.last-run.json")
  jq --argjson prev "$prev_content" \
     '. + { previousRun: ($prev | del(.previousRun)) }' \
     "$CURRENT_RUN_FILE" > "$RESULTS_DIR/.last-run.json" \
    || cp "$CURRENT_RUN_FILE" "$RESULTS_DIR/.last-run.json"
else
  cp "$CURRENT_RUN_FILE" "$RESULTS_DIR/.last-run.json"
fi
rm -f "$CURRENT_RUN_FILE"

# Keep history bounded: retain only the 20 most recent run-* logs.
ls -1t "$RESULTS_DIR"/run-*.log 2>/dev/null | tail -n +21 | while read -r old; do rm -f "$old"; done

echo "  Results saved:   $RUN_LOG  (+ $STAMPED_LOG)"
echo "  Failed outputs:  $FAILED_DIR/  ($files_failed file(s))"
echo "  Last-run record: $RESULTS_DIR/.last-run.json"
echo "═══════════════════════════════════════════════════════════"

if [ $files_failed -gt 0 ]; then exit 1; fi
