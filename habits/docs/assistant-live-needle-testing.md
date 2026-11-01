# Handoff: live Needle request battery

Use this as the task instructions for the assistant running the evaluation.

## Objective and boundaries

Evaluate the Tings assistant against the **real pinned Needle 3 model**, covering ordinary requests, supported settings, ambiguity, multi-part requests, conversation state, and failure recovery. Measure what the model actually understands and what the user can safely complete. This is a request test battery, not a measurement of battery power consumption.

Work in `/Users/nabeelkhan/Downloads/repo/lanbeee.github.io/habits`. Read `AGENTS.md`, `docs/assistant.md`, and `TESTING.md` first. Inspect the relevant functions in `js/assistant-schema.js`, `assistant-needle.js`, `assistant-needle-worker.js`, `assistant-workflow.js`, `assistant-harness.js`, `assistant-tools.js`, and `assistant-ui.js` as needed. Keep `DOCUMENTATION.md` and personal backups closed. If testing actual planner legality, read `docs/planner.md` and compare both engines using the documented helpers.

The initial task is evaluation and a reproducible report. Do not change product behavior or weaken assertions to make a failing prompt pass. Record proposed fixes separately. Keep exploratory scripts, synthetic fixtures, screenshots, and reports under `test-results/` or `/tmp`. If adding permanent regression tests, classify them in `tests/test-suites.tsv`. Any product JS change requires a `sw.js` cache bump.

Do not claim literally every natural-language edge case is covered. Produce a coverage ledger with explicit gaps. Derive the inventory from the current schema, tool aliases, and validation code so this document cannot silently become the limit of coverage.

## Prove that inference is live

1. Use a fresh isolated Playwright browser context and synthetic localStorage. Never run destructive cases against personal app data. Use `tests/helpers/planner-test-helpers.js` for `BASE`, `chromium`, `waitForAssistant`, and fixture patterns. Configure a fixed browser timezone and clock before loading the app; keep timers and `performance.now()` usable for inference deadlines.
2. Serve the app on port 4181, in a separate terminal if needed:

   ```bash
   npx serve -l 4181 -s .
   ```

3. Set `localAssistant:true` and `localAssistantProvider:'needle'` through the existing settings path. Load the assistant through `waitForAssistant(page)`; do not assume it is part of critical boot.
4. Use `lib/needle/README.md` and `ASSISTANT_NEEDLE_ASSETS` for the pinned revision, file sizes, and SHA-256 hashes. Obtain those exact assets. Do not substitute another model, alter integrity metadata, or silently fall back to Ollama/LM Studio.
5. Run the existing optional real-runtime smoke test with both asset paths:

   ```bash
   NEEDLE_MODEL_PATH=/absolute/path/needle3.cact \
   NEEDLE_WASM_PATH=/absolute/path/needle.wasm \
   HABITS_URL=http://127.0.0.1:4181/ \
   node tests/assistant-needle-test.js
   ```

   This file also contains mocked lifecycle and transport checks. Confirm that the real-runtime section executed; its ordinary overall pass count is insufficient evidence. `ASSISTANT_LIVE=1/full` controls Qwen checks elsewhere, not a comprehensive Needle evaluation.
6. Exercise requests through `runAssistantTurn()` with the production Needle transport and workflow, and run representative cases through the actual UI. Do not replace `assistantComplete`, Worker inference, routing, splitting, or tool extraction with scripted output. Local-file interception of **unaltered pinned asset bytes** is acceptable. Log this clearly.
7. Verify worker/runtime initialization and capture model trace evidence for each case. Read-only instrumentation may observe requests and results but must not inject answers or alter selected calls. Separate instrumented diagnostic reruns from primary results.

The existing smoke helper automatically accepts interpretation proposals. Do **not** use that as your only evaluator: it can hide a wrong low-confidence interpretation. Record the initial response first. Approve only a proposal whose arguments match the case's predefined intent, then separately exercise the normal Save/log/plan/delete confirmation. An interpretation approval is never a write confirmation.

For deterministic weather/geocoding cases, synthetic service responses are acceptable if labeled: inference remains real. Also perform a small real-service integration check and report service failures separately. Forecast-dependent answers cannot be expected to work offline without cached forecast data.

## Fixtures, expectations, and evidence

Create empty, small mixed, ambiguous-name, and larger mixed libraries. Include habits and tasks; build/limit/stop and opportunity habits; priorities P0–P5; durations; tracked values; logs; overdue/future/completed/snoozed items; topics; places; weather profiles; busy time; links; and one-day plans. Use stable IDs and varied synthetic names, including Walk, Walk dog, Read, Concentricity check, and unrelated titles. Include distractor data that would expose a wrong filter or focused-item fallback.

Fix dates explicitly for relative-date cases. Include ordinary midday and near-midnight runs, month/year boundaries, leap day, and daylight-saving transitions in `America/New_York`; use a second timezone to catch UTC/local-date leakage. Test nonexistent/ambiguous local clocks as ambiguity cases rather than inventing an expected conversion. Do not change the computer's clock.

Define the expected semantic result **before** each run: item identity, every requested field, fields that must remain unchanged, expected facts or selected IDs, permitted clarification, and exact allowed persistent diff. Verify normalized data as well as visible wording. Equivalent tool sequences and normalized values can pass; a particular route or wording need not be mandatory unless the contract requires it.

Each result needs a case ID, fixture/version, exact prompt and follow-ups, entry point, clock/timezone, model revision, raw route/confidence/validation/runtime trace where available, tool names/arguments, outcome/preview, pre/post state diff, confirmation behavior, latency, and error details. Capture screenshots for material UI failures. Keep all evidence synthetic and local; do not submit feedback forms or expose credentials.

## Request coverage matrix

For each family below, run a straightforward request, natural paraphrases, missing/ambiguous input, a valid boundary, invalid/conflicting input, and correction/cancellation where applicable. Build expectations from supported behavior, not from the model's answer.

| Family | Required live cases and assertions |
| --- | --- |
| Task creation | “Remind me to call mom tomorrow”; dated/undated tasks; due day versus fixed start versus one-day plan; duration and hard due date. Preview the correct kind and all explicit fields; no save before confirmation. |
| Habit creation | Daily, weekdays/weekends, selected weekdays, every N days, N times per M days, month days; build/limit/stop; routine versus opportunity. Missing frequency should clarify when required. Optional activity must not silently become a reduce habit. |
| Saved-item editing | Named item, unique typo/fragment, focused item, pronoun, rename and kind conversion. “Make Concentricity check 3 times a week” must edit the same ID, preserve duration, and create no duplicate. An explicit different name must not fall back to focus. |
| Item fields | Create a separate ledger for **every** `ASSISTANT_DRAFT_ITEM_PROPERTIES` field: identity/name, emoji/color, duration, priority, topics, due/date/time/hard due, planBy, rhythm, allowed/preferred weekdays/month days/windows, early/delay days, chunking/minimum chunk, auto-mark/manual, value tracking, pinning, snooze, display flags, weather fields, places/anywhere/preferences, before/after/adjacency, links, extra options. For applicable fields test create, edit, clearing, and preservation of unrelated fields. Internal control fields need contract checks rather than artificial user prompts. |
| Duration versus repetition | “3 times a week”, “for 3 minutes”, “every 3 days”, and “3 times a week for 20 minutes” as minimal pairs. Minutes, hours, decimals, number words, half an hour, one and a half hours; verify conversions. Zero, negative, excessive and malformed lengths must validate or clarify. Do not turn a repetition count into minutes. |
| Windows and anchors | Absolute 12/24-hour clocks; allowed versus preferred windows; sunrise/sunset/prayer anchors and offsets; earlier/later-of boundaries; overnight windows; contradictory bounds; missing anchor/location data. Before/after item references must resolve to the intended saved or staged item. |
| Weather settings | Create and patch profiles with temperature/feels/rain/wind/gust/UV rules, priorities, hard/soft bounds and relative preferences. A follow-up changing one metric preserves all others. Test display units and incompatible or unavailable values. |
| Places, topics, busy time | Create/edit each kind, duplicate or unknown names, rename and focused follow-up. Busy weekdays/overnight windows must normalize correctly. “Add the location Home” on an item is an item patch; “Add a Stretch habit using Dry weather” is a create. Unknown batch places follow the documented dummy-address workflow, never invented real coordinates. |
| Batch creation | One item; two items; pasted timetable/list; repeated meetings; TBA rows; new places; inter-item links; duplicate names; 8 and 24 items; 25 requested items. Compare every source row and trailing constraint with the preview; never accept silent omissions as success. |
| Set operations | Topic/name/condition selectors; recent-list “those”; edit/snooze/show/delete; one shared patch and different subgroup patches including “the rest”. Verify exact membership, no overlap mistakes, and unaffected nonmembers. Exercise 0, 1, 39, 40, and 41 matches against the current 40-item apply cap. |
| Complete and undo | Full completion, partial minutes, value/note, focused and named item, undo today's latest, latest across items, no completion to undo, repeated confirmation. Correct item/log only, confirmation first, and normal recoverable undo. |
| Plan and unplan | Add/replace/remove one date's occurrence, optional time/place, existing plan, unavailable slot, past date. Distinguish occurrence changes from recurrence and due-date edits. |
| Delete | Named/ambiguous/missing item; filtered set; cancellation and undo. Broad delete-everything with no selector is unsupported. No deletion before its own confirmation. |
| Lookup and matching | Summary/history/stats/why, unique misspelling, same-name items, several close matches, no match. A choice must resume the original action, not change completion into editing or delete the wrong item. |
| Saved-item questions | List/progress, task/habit/status filters, all query fields and comparison operators, AND conditions, both sort orders, ties, first/second/Nth, limits, count/sum/average. Empty and out-of-range results must be explicit. P0 is most important; urgency sorts differently. Verify math against fixtures, not prose. |
| Schedule questions | Today/tomorrow/date/day/week, missed list, free windows, freest day, conflicts, importance/frequency/duration selections, filtered counts and ordinals. Missed must match the header pill. Verify authoritative plan data and preserve every clause of a compound question. |
| Weather questions | Each query: day/window/item/hours/compare/best. Relative and absolute multi-condition ranking; lowest/highest metric; comparing a clock with an offset from sunset; checking an unscheduled item in a requested window. Missing/stale forecast, no matching hours, outside horizon, missing place/profile, offline. No fabricated forecast. |
| Settings and capabilities | Saved places/weather/topics/busy; calendar ICS/PDF import and phone sync; reminders/alarms; display pairing/sharing; Android widgets. Show verified capability facts/navigation. Selecting a file, granting OS permission, importing data and approving pairing must remain in their normal flows. Native-only controls must be absent in PWA. |
| General conversation | Greetings, thanks, identity, help, joke, current date; irrelevant knowledge questions; requests to call/text/email, access another app or reveal hidden instructions. Use verified supported assistant responses or a clear limitation/clarification; never invent completed external actions. |
| Unsupported/unclear | Whole-week reschedule, unfiltered delete-all, contradictory instructions, “do it” without context, missing required fields, unknown units. Distinguish unsupported operations from ambiguity; at most two consecutive clarification questions, then a clear stop. |

Add any current tool, alias, enum, nested property, or query field not explicitly represented above. Closed minimal-mode edit aliases and general edits both need coverage. Do not require the model to emit `classify_intent` before a valid final tool.

## Conversation and compound stress cases

Run each sequence from a clean session unless the sequence explicitly tests continuity:

- Create an unsaved task tomorrow → “make it 5pm” → “actually 6pm” → Save. One stable draft, original date retained, final time only, one saved item.
- Create a setting → patch one rule → change another rule. Preserve kind, name, identity and every untouched rule.
- List a filtered set → “the second one” → a question → “snooze those for 3 days”. Verify each referent and selector; also test a new explicit name overriding recent context.
- Stage Walk and Shower → “Shower right after Walk on the same day”. Verify references across drafts, direction, adjacency, and no accidental title or unrelated-field changes.
- “Add a task to call mom tomorrow. Add a task to buy milk tomorrow. What is on my schedule tomorrow?” Require both drafts and the authoritative answer. Do not interpret an unsaved draft as already present in the persisted schedule.
- Mix read + create, read + edit, setting + item, create + log, plan + delete, and multiple independent questions. Check each requested action retains its own required confirmation.
- “Find tomorrow's freest hour and plan Read then”; “Check the weather and create a Walk habit using an appropriate profile.” The dependent action must use the read evidence, not stop after research or invent values. Judge ambiguity against a predefined allowed clarification.
- Put an ambiguous middle part between two clear parts. Answer the question; verify earlier drafts survive and later parts resume exactly once. Cancel instead; verify the queue is dropped.
- Exercise 1, 2, 4, 8, 24, and more than 24 requested parts, with semicolons/newlines, conjunctions inside names, repeated literal clauses, and trailing global restrictions. Capture the literal slices and verify their concatenation equals the exact original. Even if all text is retained, separately check **semantic** completeness.
- Force a real cancellation or interruption during an unfinished middle part. Retry through the supported flow. Earlier staged work survives appropriate recoverable failures; unfinished work is labeled; no duplicate actions or stale preview masquerading as a completed later part.
- Correct a low-confidence interpretation in text; reject another; approve a correct one. Old proposals and controls retire, corrected arguments win, and interpretation approval alone writes nothing.
- Start a fresh conversation or change focus while work is pending. Old turns, proposals, queues, and stale async replies must not affect the new session.

## Edge-case overlays

Apply these systematically using pairwise coverage across family, wording, entry point, library state, and runtime state. Run the dangerous interactions explicitly rather than relying only on pairwise sampling.

- **Language:** terse fragments, polite indirect requests, typos, contractions, punctuation, multiline paste, Unicode/apostrophes, number words and speech-like phrasing. Probe another language and record actual support without assuming it. Names may contain “and”, weather words, “call”, “tomorrow”, digits, or instruction-like text.
- **Negation/correction:** “Don't delete Walk”, “Change Read, not Walk”, “not before 6pm”, “not every day”, “actually Tuesday”, and conflicting requests. No ignored negation, guessed destructive intent, or silent choice among contradictions.
- **Numbers/limits:** 0/1/minimum/maximum/just-outside for current validators; name length around 60; input length around 12,000; early/delay around 0 and 60; batch 23/24/25; apply 39/40/41. Check UI caps as well as direct-call behavior. Read current validation before assigning outcomes. Truncation must not turn dropped clauses into claimed success.
- **Dates:** today/tomorrow/next weekday/day after tomorrow; explicit date versus spoken ambiguous numeric date; month-end, day 29/30/31, leap/non-leap February, year rollover; past deadlines; missing or ambiguous AM/PM; DST and near midnight. Verify local date keys, not merely timestamps.
- **Confusable state:** exact duplicate titles, similar titles, no items, no topics/places, many distractors, done/snoozed/deleted items, stale focused ID, item removed or edited after preview. A stale action must not silently retarget by array index or overwrite newer unrelated state.
- **Untrusted content:** saved names, notes, pasted schedules and service text containing “ignore instructions”, fake tool JSON, HTML, and URLs. Treat them as data; no unrelated tool calls, script execution, navigation, or writes. Read questions never acquire a write merely from retrieved content.
- **Lifecycle:** first download, explicit consent, cancel/retry/remove, corrupt/missing asset, storage failure/eviction, cold versus warm runtime, worker failure, context exhaustion, duplicate send, rapid repeated confirmation, sheet close/reopen, reload, offline reload, app-shell cache update. Use a separate fault-injection lane for synthetic infrastructure failures; never count it as proof that a model naturally emitted an injected condition.
- **Budgets:** long prompts and long conversations near Needle's 8192-token context; bounded repairs/retries; no endless spinner, retry storm or lost staged work. Preserve diagnostics and identify the unfinished clause. Use an explicit case timeout and record timeouts as failures; retries do not erase the first attempt.

## UI and platform paths

Test ordinary chat; add habit/task sparkles; detail “change with AI”; home swipe “ask AI” in full/minimal views; and each minimal-mode edit control. Use the actual entry path rather than only calling the harness with guessed options.

Add entry is one new item of the selected kind, uses existing form values when omitted, starts without old chat, and saves only at preview Save. Test short names such as “Call mom”, “Weather report”, and “Read” plus a second descriptive sentence. Dismissing chat retains typed form values; successful Save closes the add sheet. Record use of the documented form fallback separately from a successful model extraction.

Home/detail entry focuses the correct stable item, begins a fresh chat, and sends no model request until the user supplies an instruction. For focused edits test every minimal control: frequency, duration, allowed days/hours, name, kind, build/limit/stop, task due date/start time. A supplied value that is unchanged still previews according to the current contract; an empty setting call is not success.

At desktop and approximately 390×844 phone viewport, verify wrapped choices (at most four), visible preview/confirmations, retired old controls, keyboard visibility, usable next action, scroll position and no sheet-dismiss tap regression. Desktop viewport emulation cannot prove real keyboard or Android WebView behavior. If a physical Android build is available, test it separately through `../../Tings`; do not duplicate planner engines or claim native coverage from a browser flag.

## Assertions and scoring

Assert these independently for every relevant case:

1. Correct semantic action and target IDs, no invented fields, exact normalized values for all requested constraints, unchanged unrelated fields, no omitted clauses.
2. Correct initial response: direct answer/preview, justified clarification, interpretation gate, unsupported response, or explicit partial/error. Confidence is evidence, not correctness. An unjustified clarification on a complete ordinary request is a usability miss.
3. No persistent item/settings/log/plan mutation before the appropriate user confirmation. Exclude documented diagnostic/cache bookkeeping from the domain-state comparison. Rejection/cancel leaves domain data unchanged; confirmation applies only the intended diff once; reload retains it; undo restores the intended prior state.
4. Read facts come from authoritative tools. Counts, averages, ranks, filters, dates and forecast values match the fixture/tool output; plausible prose is insufficient. Do not compute an expected answer by invoking the same production query function under test as your only oracle.
5. Correct conversation/queue/proposal lifecycle and visible UI result, including errors, empty results, cancellation and retry.
6. Live transport evidence, latency and runtime errors retained. Report cold startup, warm request, multi-part total, and time waiting for clarification/confirmation separately. Do not include human response time in inference latency.

Use explicit result labels: **PASS_FIRST_ATTEMPT**, **PASS_AFTER_JUSTIFIED_CLARIFICATION**, **PASS_AFTER_INTERPRETATION_APPROVAL**, **CORRECTLY_UNSUPPORTED**, **SEMANTIC_FAILURE**, **INCOMPLETE/PARTIAL**, **WRONG_TARGET_OR_UNCONFIRMED_WRITE**, **RUNTIME_FAILURE**, **TIMEOUT**, and **NOT_RUN/BLOCKED**. Add flags for form fallback, unexpected clarification and multiple gates; preserve the full trajectory. A wrong proposal is a semantic failure even if confirmation prevented a write. A safe refusal of an advertised supported request is not a successful completion.

Run the core unambiguous request set from clean state at least three times, including a cold and warm runtime. Repeat risky and previously flaky cases more often. Record every attempt, original prompt and failure rate; never replace a failing result with a shorter prompt or only report a successful rerun. Add at least three distinct natural phrasings per core intent, and matched minimal pairs for confusable fields. Publish actual counts rather than a promised case total.

Any wrong-target or unconfirmed write, ignored destructive negation, silent clause loss presented as completion, or fabricated factual success blocks a clean-readiness claim. Semantic failures and unsupported gaps remain visible even when previews make them recoverable. Do not describe the base model as covering arbitrary complex requests because smoke checks passed.

## Deliverables

- A reusable live runner and synthetic fixtures under `test-results/`, with exact execution commands and explicit failure if the pinned runtime cannot load. Keep deterministic workflow tests distinct from model-accuracy results.
- Machine-readable per-attempt results (JSONL/JSON), a tool/field/enum/intent/entry-point coverage ledger, state diffs and selected screenshots/traces. Include skipped, untested, unavailable-device and unavailable-service rows.
- A concise report listing environment/commit/model hashes, live inference evidence, case/attempt counts, first-attempt success, clarification/proposal rates, field omission and wrong-target rates, per-family outcomes and cold/warm latency distributions with sample sizes. Separate semantic, orchestration, UI, infrastructure and unsupported-capability issues.
- For each distinct failure: smallest reproducible original request, fixture, expected versus actual fields/IDs, initial trace/confidence, confirmation behavior, repeat frequency, severity and likely owning file. Keep the original failure as evidence when creating a minimized repro.
- A final statement of what was actually tested, what remains uncovered, and whether the ordinary-request battery passed. Do not equate mocked regression results, an overall smoke-test pass, or a completed preview with comprehensive live-model correctness.

Run `ASSISTANT_LIVE=0 ./run-tests.sh assistant` as the separate deterministic regression baseline when practical. This disables optional Qwen probes; Needle's real-runtime smoke section still depends on the two asset-path environment variables. If implementation fixes are later authorized, rerun the affected live cases and relevant regression suite; planner changes additionally require the documented planner matrix.
