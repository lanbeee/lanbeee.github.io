# Needle 3 focused edit release — November 10, 2026

The supported product scope is one saved item: edit its settings, excluding
renaming; log or undo a completion for today or a past day; add or remove a
one-day plan for today or a future day. Actions require confirmation. Creation,
switching items and general chat are outside this entry point.

This change preserves `2352e14` and the other agent's guidance improvements in
`520fec2`. It closes the remaining reproduced edit failures and strengthens the
item boundary. The recommendation is to release this existing opt-in feature
with that scope. This is a targeted readiness assessment, not a claim that every
possible sentence or the entire 1,651-case battery has passed.

## Changes

- Renaming is excluded from edit extraction, setting suggestions, corrections,
  summary navigation and Save. It remains available in the manual detail editor.
- Requests explicitly targeting another saved item ask the user to open it.
  Log/plan confirmation checks the original item ID again. Deletion, replacement,
  a closed editor, or an unfinished request cannot redirect a pending action.
  Reordering the list preserves the original target.
- Conversational topic requests no longer save trailing courtesy words. URLs
  returned by discovery cannot become outside-action labels at their colon.
- Complete monthly lists and ordinal rules survive polite framing. Alternative
  slots keep their days and hours together. Occurrence clock edits preserve
  their scope, and redundant cancellation clauses do not reopen unrelated fields.
- Compound effort edits retain an explicit splitting instruction beside a chunk
  length. Common reproduced spelling variants and abbreviated logged minutes
  resolve to their intended fields.
- Completeness decoding that exhausts its budget retries once with a closed menu
  of original clauses. Values still require grounded extraction and validation.
- Modal “may” is no longer mistaken for a month. Reminder lead requests do not
  acquire an unrelated duration/early-window question from guidance.
- Completion logs are day-based. Exact-clock log or undo requests ask rather
  than promise a timestamp normal habit logs do not preserve. One-day plans
  continue to support clock times. The preview's log day survives midnight.
- The service worker cache advances from `tings-v797` to `tings-v799`.

## Verification

The full assistant suite passes **26/26 executions, 2,171 assertions, no page
errors** with `ASSISTANT_LIVE=0 ./run-tests.sh assistant`. These are host and UI
regressions; optional live tests are measured separately.

Real inference uses the pinned, unmodified Needle 3 model and WASM with synthetic
browser data. The final item-action run passes **25/25 cases**, including other
item requests, past/future boundaries, explicit confirmation, persistence and undo.
The eight final wording regressions pass live, including confirmed Save.

The final historical replay selects the 39 remaining non-rename failures from
an earlier recovery run, plus 74 safety guards. Its raw report must be read with
one audited harness issue: eight calendar tests project a saved empty recurrence
cutoff string to `null`, then compare it with an expected empty string. Their
raw saved records preserve the expected empty string and their other checks pass.
The raw result is **31/39 supported edits**, with all eight reported failures
passing the raw-persistence audit. There were no runtime failures.

The same run reports **73/74 safety guards**, with one pre-confirmation write
flag. Comparing a fresh fixture with that checkpoint identifies exactly one
changed setting: `lastRetentionCleanupAt`, from zero to the frozen current time.
`main-boot.js` schedules automatic monthly retention cleanup; `settings-state.js`
stamps this bookkeeping value even when no items change. A separate replay
marks cleanup current before the case begins, isolating this boot activity;
that replay passes with no issues. Thus all 74 guard scenarios are verified,
including the isolated replay. The raw battery score remains intact; see the separate safety-write audit.

Earlier live checks cover the other new edit cases, literal topic names,
renaming guards, color ambiguity, reminder ownership and occurrence persistence.
The final host suite covers all affected paths after the wording fixes.

Ignored local evidence:

- `test-results/release-scope-suite-complete.log`
- `test-results/release-item-actions-live-complete.json`
- `test-results/release-fields-live-final.json`
- `test-results/release-final-phrasing-live.json`
- `test-results/release-effort-live.json`
- `test-results/needle-live/edit-battery/report-release-scope-verified.md`
- `test-results/needle-live/edit-battery/results-release-scope-verified.jsonl`
- `test-results/release-calendar-audit-verified.json`
- `test-results/release-safety-write-audit.json`

Browser/mobile viewport checks do not measure physical Android keyboard behavior,
notification delivery, model-download connectivity, or phone inference speed.
Unclear or unsupported instructions can still require rephrasing or the manual
editor. They must not imply an action succeeded or silently bypass confirmation.
