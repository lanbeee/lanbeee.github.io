#!/usr/bin/env bash

# Tings test runner. The default "smart" matrix runs every regression test once
# and repeats only tests whose rendered behavior genuinely depends on the page's
# planner mode. Full child-process output is saved under test-results/; normal
# terminal output stays deliberately compact for humans and coding agents.

PORT="${PORT:-4181}"
MANIFEST="tests/test-suites.tsv"
RESULTS_DIR="test-results"
FAILED_DIR="$RESULTS_DIR/failed"
RUN_LOG="$RESULTS_DIR/last-run.log"
VERBOSE=0
LIST_ONLY=0
CHANGED_ONLY=0
TEST_FILTER=""
FAIL_TAIL_LINES="${FAIL_TAIL_LINES:-20}"
MODE="${TEST_MODE:-smart}"
REQUESTED_SUITES=()

# Backward compatibility for direct forced-mode runs. Leaving PLANNER_MODE
# unset selects the smart matrix; the old two-command chain is no longer needed.
if [ -n "${PLANNER_MODE+x}" ]; then
  MODE="$PLANNER_MODE"
fi

usage(){
  cat <<'USAGE'
Usage: ./run-tests.sh [suite ...] [options]

Suites:
  planner        scheduling, Fast/GLPK parity, agenda regressions
  ui             general browser interactions and rendering
  data           persistence, backup, retention, normalization
  integrations   calendar, locations, prayer times, offline behavior
  diagnostics    exploratory zz-* scripts (excluded from normal full runs)
  all            all regression suites (default; excludes diagnostics)
  everything     regression suites plus diagnostics

Options:
  --changed          infer impacted suites from git changes
  --mode MODE        smart (default), default, or fast
  --test PATTERN     run matching manifest filenames only
  --verbose, -v      stream complete test output as well as saving it
  --list             show the selected execution matrix without running it
  --help, -h         show this help

Examples:
  ./run-tests.sh                    # smart full regression matrix
  ./run-tests.sh planner            # planner coverage, including both engines
  ./run-tests.sh ui data            # two focused suites
  ./run-tests.sh --changed          # suites affected by working-tree changes
  ./run-tests.sh planner --test '*deferral*'
  ./run-tests.sh planner --mode fast

Detailed output is always saved to test-results/last-run.log. Set
FAIL_TAIL_LINES=0 to suppress even the bounded failure excerpt.
USAGE
}

die(){ echo "run-tests.sh: $*" >&2; exit 2; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --verbose|-v) VERBOSE=1 ;;
    --list) LIST_ONLY=1 ;;
    --changed) CHANGED_ONLY=1 ;;
    --mode)
      shift
      [ "$#" -gt 0 ] || die "--mode requires smart, default, or fast"
      MODE="$1"
      ;;
    --mode=*) MODE="${1#*=}" ;;
    --test)
      shift
      [ "$#" -gt 0 ] || die "--test requires a filename pattern"
      TEST_FILTER="$1"
      ;;
    --test=*) TEST_FILTER="${1#*=}" ;;
    --*) die "unknown option '$1'" ;;
    *) REQUESTED_SUITES+=("$1") ;;
  esac
  shift
done

case "$MODE" in
  smart|both) MODE="smart" ;;
  default|fast) ;;
  *) die "unknown mode '$MODE' (use smart, default, or fast)" ;;
esac

[ -f "$MANIFEST" ] || die "missing $MANIFEST"

ALL_REGRESSION_SUITES="planner ui data integrations"
KNOWN_SUITES="$ALL_REGRESSION_SUITES diagnostics"

contains_word(){
  local needle="$1"
  shift
  local word
  for word in "$@"; do [ "$word" = "$needle" ] && return 0; done
  return 1
}

add_requested_suite(){
  local suite="$1"
  contains_word "$suite" "${REQUESTED_SUITES[@]}" || REQUESTED_SUITES+=("$suite")
}

suite_for_test(){
  awk -F '\t' -v wanted="$1" '$1 == wanted {print $2; exit}' "$MANIFEST"
}

infer_changed_suites(){
  local base_ref="${TEST_BASE:-HEAD}"
  local changed path suite repo_prefix
  repo_prefix="$(git rev-parse --show-prefix 2>/dev/null || true)"
  changed="$({ git diff --name-only "$base_ref" 2>/dev/null || true; git ls-files --others --exclude-standard 2>/dev/null || true; } | sort -u)"
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    if [ -n "$repo_prefix" ]; then path="${path#"$repo_prefix"}"; fi
    case "$path" in
      tests/*.js)
        suite="$(suite_for_test "$(basename "$path")")"
        [ -n "$suite" ] && add_requested_suite "$suite"
        ;;
      tests/helpers/*) add_requested_suite planner ;;
      js/agenda-*)
        add_requested_suite planner
        ;;
      js/today-view.js|js/scoring.js)
        add_requested_suite planner
        add_requested_suite ui
        ;;
      js/locations.js)
        add_requested_suite planner
        add_requested_suite integrations
        ;;
      js/calendar-*|js/prayer-times.js)
        add_requested_suite planner
        add_requested_suite integrations
        ;;
      js/reminders.js|js/push-client.js)
        add_requested_suite integrations
        ;;
      js/data.js|js/config.js|js/storage.js)
        add_requested_suite data
        add_requested_suite planner
        ;;
      js/settings.js)
        add_requested_suite data
        add_requested_suite ui
        add_requested_suite integrations
        ;;
      js/list-view.js|js/detail-view.js)
        add_requested_suite planner
        add_requested_suite ui
        ;;
      js/overview-view.js)
        add_requested_suite ui
        add_requested_suite integrations
        ;;
      js/main.js)
        add_requested_suite data
        add_requested_suite ui
        ;;
      js/shell-ui.js|js/viewport.js|js/emoji-suggest.js|css/*|index.html)
        add_requested_suite ui
        ;;
      run-tests.sh|tests/test-suites.tsv|TESTING.md|AGENTS.md|DOCUMENTATION.md|sw.js)
        # Test infrastructure/docs do not imply an application regression suite.
        ;;
      js/*)
        # Unknown application JS is shared enough that guessing narrowly is risky.
        local fallback
        for fallback in $ALL_REGRESSION_SUITES; do add_requested_suite "$fallback"; done
        ;;
    esac
  done <<EOF
$changed
EOF
}

if [ "$CHANGED_ONLY" -eq 1 ]; then
  [ "${#REQUESTED_SUITES[@]}" -eq 0 ] || die "--changed cannot be combined with explicit suites"
  infer_changed_suites
  if [ "${#REQUESTED_SUITES[@]}" -eq 0 ]; then
    echo "No impacted regression suites found in changes relative to ${TEST_BASE:-HEAD}."
    exit 0
  fi
fi

if [ "${#REQUESTED_SUITES[@]}" -eq 0 ]; then REQUESTED_SUITES=(all); fi

expanded_suites=()
for suite in "${REQUESTED_SUITES[@]}"; do
  case "$suite" in
    all)
      for item in $ALL_REGRESSION_SUITES; do
        contains_word "$item" "${expanded_suites[@]}" || expanded_suites+=("$item")
      done
      ;;
    everything)
      for item in $KNOWN_SUITES; do
        contains_word "$item" "${expanded_suites[@]}" || expanded_suites+=("$item")
      done
      ;;
    planner|ui|data|integrations|diagnostics)
      contains_word "$suite" "${expanded_suites[@]}" || expanded_suites+=("$suite")
      ;;
    *) die "unknown suite '$suite' (use --help to list suites)" ;;
  esac
done
REQUESTED_SUITES=("${expanded_suites[@]}")

task_files=()
task_suites=()
task_modes=()
manifest_files=()

matches_filter(){
  local name="$1"
  [ -z "$TEST_FILTER" ] && return 0
  case "$name" in $TEST_FILTER) return 0 ;; *) return 1 ;; esac
}

while IFS=$'\t' read -r name suite policy; do
  case "$name" in ''|'#'*) continue ;; esac
  manifest_files+=("$name")
  [ -f "tests/$name" ] || die "$MANIFEST references missing tests/$name"
  contains_word "$suite" "${REQUESTED_SUITES[@]}" || continue
  matches_filter "$name" || continue
  case "$policy" in
    once|default-only|page-both) ;;
    *) die "invalid mode '$policy' for $name in $MANIFEST" ;;
  esac
  case "$MODE" in
    smart)
      task_files+=("tests/$name"); task_suites+=("$suite"); task_modes+=("default")
      if [ "$policy" = "page-both" ]; then
        task_files+=("tests/$name"); task_suites+=("$suite"); task_modes+=("fast")
      fi
      ;;
    default)
      task_files+=("tests/$name"); task_suites+=("$suite"); task_modes+=("default")
      ;;
    fast)
      if [ "$policy" != "default-only" ]; then
        task_files+=("tests/$name"); task_suites+=("$suite"); task_modes+=("fast")
      fi
      ;;
  esac
done < "$MANIFEST"

# Catch the old failure mode where adding tests/*.js silently made it part of
# every run. Every top-level test now needs an explicit suite decision.
for path in tests/*.js; do
  name="$(basename "$path")"
  contains_word "$name" "${manifest_files[@]}" || die "tests/$name is not classified in $MANIFEST"
done

[ "${#task_files[@]}" -gt 0 ] || die "selection matched no runnable tests"

suite_csv="$(IFS=,; echo "${REQUESTED_SUITES[*]}")"
if [ "$LIST_ONLY" -eq 1 ]; then
  echo "Suites: $suite_csv | mode: $MODE | executions: ${#task_files[@]}"
  i=0
  while [ "$i" -lt "${#task_files[@]}" ]; do
    printf '%-13s %-12s %s\n' "${task_suites[$i]}" "${task_modes[$i]}" "$(basename "${task_files[$i]}")"
    i=$((i + 1))
  done
  exit 0
fi

cleanup(){
  if [ -n "${server_pid:-}" ]; then kill "$server_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

npx serve -l "$PORT" -s . &>/dev/null &
server_pid=$!

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

mkdir -p "$FAILED_DIR"
: > "$RUN_LOG"
STAMPED_LOG="$RESULTS_DIR/run-$(date +%Y%m%d-%H%M%S)-$$.log"
echo "run-tests.sh — suites=$suite_csv — mode=$MODE — $(date)" > "$STAMPED_LOG"

total_ok=0
total_not_ok=0
total_pageerrors=0
files_passed=0
files_failed=0
failed_names=()
started_at=$(date +%s)

echo "Running ${#task_files[@]} test executions: suites=$suite_csv, mode=$MODE"
echo "Full output: $RUN_LOG"

i=0
while [ "$i" -lt "${#task_files[@]}" ]; do
  f="${task_files[$i]}"
  suite="${task_suites[$i]}"
  planner_mode="${task_modes[$i]}"
  name="$(basename "$f")"
  if [ "$planner_mode" = "fast" ]; then
    habits_url="http://127.0.0.1:$PORT/?planner=fast"
  else
    habits_url="http://127.0.0.1:$PORT/"
  fi
  tmpfile=$(mktemp)
  test_started=$(date +%s)

  printf '[%d/%d] %-13s %-7s %s ... ' "$((i + 1))" "${#task_files[@]}" "$suite" "$planner_mode" "$name"
  if [ "$VERBOSE" -eq 1 ]; then
    echo
    HABITS_PLANNER_MODE="$planner_mode" HABITS_URL="$habits_url" node "$f" 2>&1 | tee "$tmpfile"
    exit_code=${PIPESTATUS[0]}
  else
    HABITS_PLANNER_MODE="$planner_mode" HABITS_URL="$habits_url" node "$f" >"$tmpfile" 2>&1
    exit_code=$?
  fi
  elapsed=$(( $(date +%s) - test_started ))

  ok_count=$(grep -c '^  ok' "$tmpfile" 2>/dev/null || true)
  not_ok_count=$(grep -cE '^[[:space:]]*not ok' "$tmpfile" 2>/dev/null || true)
  pe_count=$(grep -c 'pageerror:' "$tmpfile" 2>/dev/null || true)
  total_ok=$((total_ok + ok_count))
  total_not_ok=$((total_not_ok + not_ok_count))
  total_pageerrors=$((total_pageerrors + pe_count))

  {
    echo "===== $suite / $planner_mode / $name (exit $exit_code, ${elapsed}s) ====="
    cat "$tmpfile"
    echo
  } >> "$RUN_LOG"

  failure_key="$name.$planner_mode"
  if [ "$exit_code" -eq 0 ]; then
    files_passed=$((files_passed + 1))
    rm -f "$FAILED_DIR/$failure_key.log" "$FAILED_DIR/$name.log"
    [ "$VERBOSE" -eq 1 ] || echo "PASS (${elapsed}s, $ok_count assertions)"
  else
    files_failed=$((files_failed + 1))
    failed_names+=("$failure_key")
    cp "$tmpfile" "$FAILED_DIR/$failure_key.log"
    [ "$VERBOSE" -eq 1 ] || echo "FAIL (${elapsed}s)"
    echo "  log: $FAILED_DIR/$failure_key.log"
    if [ "$FAIL_TAIL_LINES" -gt 0 ] 2>/dev/null; then
      echo "  last $FAIL_TAIL_LINES lines:"
      tail -n "$FAIL_TAIL_LINES" "$tmpfile" | sed 's/^/    /'
    fi
  fi
  rm -f "$tmpfile"
  i=$((i + 1))
done

elapsed_total=$(( $(date +%s) - started_at ))
total_assertions=$((total_ok + total_not_ok))
run_status='passed'
[ "$files_failed" -gt 0 ] && run_status='failed'

summary(){
  echo
  echo "SUMMARY — $run_status"
  echo "  Suites:       $suite_csv"
  echo "  Matrix:       $MODE (${#task_files[@]} executions)"
  echo "  Tests:        $files_passed passed, $files_failed failed"
  echo "  Assertions:   $total_ok ok, $total_not_ok not ok ($total_assertions counted)"
  echo "  Page errors:  $total_pageerrors"
  echo "  Time:         ${elapsed_total}s"
  echo "  Full log:     $RUN_LOG"
  [ "$files_failed" -eq 0 ] || echo "  Failed logs:  $FAILED_DIR/"
}
summary
summary >> "$RUN_LOG"
cat "$RUN_LOG" >> "$STAMPED_LOG"

CURRENT_RUN_FILE=$(mktemp)
if [ "${#failed_names[@]}" -eq 0 ]; then
  failed_json="[]"
else
  failed_json=$(printf '"%s",' "${failed_names[@]}")
  failed_json="[${failed_json%,}]"
fi
cat > "$CURRENT_RUN_FILE" <<JSON
{
  "status": "$run_status",
  "plannerMode": "$MODE",
  "suites": "$suite_csv",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "durationSeconds": $elapsed_total,
  "files": { "passed": $files_passed, "failed": $files_failed, "executions": ${#task_files[@]} },
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

if [ -f "$RESULTS_DIR/.last-run.json" ] && command -v jq >/dev/null 2>&1; then
  prev_content=$(cat "$RESULTS_DIR/.last-run.json")
  jq --argjson prev "$prev_content" \
     '. + { previousRun: ($prev | del(.previousRun)) }' \
     "$CURRENT_RUN_FILE" > "$RESULTS_DIR/.last-run.json" \
    || cp "$CURRENT_RUN_FILE" "$RESULTS_DIR/.last-run.json"
else
  cp "$CURRENT_RUN_FILE" "$RESULTS_DIR/.last-run.json"
fi
rm -f "$CURRENT_RUN_FILE"

ls -1t "$RESULTS_DIR"/run-*.log 2>/dev/null | tail -n +21 | while IFS= read -r old; do
  [ -n "$old" ] && rm -f "$old"
done

if [ "$files_failed" -gt 0 ]; then exit 1; fi
