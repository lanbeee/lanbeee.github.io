# Needle semantic field extraction

The product's focused Add and Edit flows use one patch pipeline. Create has a
baseline from the form and defaults; Edit has a baseline from the selected saved
item. Neither operation lets the model choose another item or save directly.

Create requires a complete set of applicable essentials. Its baseline is frozen
at session open: Add form values override configured creation defaults, and
tasks use their independent creation profile. A name-only habit can therefore
use its configured frequency and duration. The review includes these essentials
with their form/default origins even when no extraction proposed them. Settings
changes in another tab cannot change the reviewed defaults before Save. Edit
keeps unmentioned values from the saved item.

Defaults handle omission, not extraction errors. Explicit frequency/duration
instructions that cannot be extracted still block Save. A missing name asks for
one, and an event without a valid date/start remains unresolved rather than
inventing a schedule. Stop habits do not require duration or frequency.

## Execution

- `item-field-catalog.js` supplies the detail UI's DOM-independent labels and
  search aliases. `assistant-focus-fields.js` maps editable semantic settings to
  that metadata, their small extraction tools and existing normalizers.
- Keyword cues enqueue candidates immediately. Needle's own embeddings rank the
  full request contexts and source excerpts; model discovery supplies additional
  candidates. All batches are processed. Retrieval only schedules extraction.
- At most three model runtimes exist in one pool. Embedding, discovery, coverage
  and extraction all acquire the same leases; no additional routing model runs
  outside the cap. Each runtime retains an independent 8192-token context.
- Each extraction has one tool and one string parameter. Its choices are an
  exact original-source excerpt and an empty string. The host validates that
  choice and the excerpt's original offsets again. Returning a substring that
  drops a negation, endpoint or preference is rejected.
- Normalizers operate only on that returned evidence for the job's own setting.
  They cannot fill a missing result from the original query. Frequency is one
  job producing a coupled count/period patch; windows preserve their bounds.
- Completed proposals merge through one host path. Kind, habit mode and repeat
  mode have ordered prerequisites; chunk size depends on splitting. Places
  precede place preferences when materializing; weather profiles precede custom
  rules. Competing profile/rule and deadline/delay proposals block Save.
- Idle scheduler slots pick up eligible jobs immediately. There is no batch
  barrier between independent field families. Dependent proposals can finish
  extraction early and wait to merge.
- Each job retains its source text, revision, attempt count, status and proposed
  fields. Follow-ups supersede affected settings and preserve unrelated
  unfinished work. Late replies cannot mutate a newer revision.
- A crashed/timed-out runtime receives one automatic job retry. While the read
  is still running, the summary shows a short progress line. Continue appears
  after the read stops and retries unfinished work, including failed
  retrieval/discovery/coverage. Completed siblings remain staged. Cancellation
  stops all runtimes and queued work.
- Long requests use overlapping unchanged contexts for discovery/coverage and
  bounded source windows for extraction. A required field with more than twelve
  relevant windows asks for clarification rather than accepting a truncated set.

The summary lists essentials and the settings this request changed. Save writes
that summary; Edit opens it in the detail editor without saving. Existing commit
conflict checks and undo apply.
Draft/job checkpoints are in session memory and do not survive page reload.

## Live evaluation

Use the immutable Needle 3 assets specified in `assistant-needle.js`. The live
battery intercepts asset requests with those unmodified local bytes, then runs
the actual WASM inference and production scheduler. It supplies no scripted
inference or routing answers. Browser data and saved catalogs are synthetic;
the browser timezone is America/New_York and request dates use a fixed session
clock of November 1, 2026 at noon.

The expectations in `tests/assistant-field-jobs-test.js` precede inference. Every
case checks the complete intended patch and unresolved work, no persistence
before confirmation, preservation of edit identity/history, and confirmed Save.
Cases include:

| Request | Expected settings |
|---|---|
| Create Walk | Name, every-other-day recurrence, duration, weekdays, sunset cutoff, priority, pin, emoji, topic |
| Create Submit report | Name, due date, start clock, duration, priority, pin, topic, color |
| Edit Gym to Strength | Rename, recurrence, duration, weekdays, evening window, priority, pin, emoji, topic |
| Create Read | Name, daily recurrence, duration, splitting, minimum chunk, gap, priority, pin |
| Create natural-language task | “Remind me to call mom tomorrow at 10am”: name, date, start clock, duration, priority, pin |
| Create Dentist | Name, event date/start, duration, emoji, color, topic |
| Edit duration and sunset | Both requested fields, with identity, priority, topics and emoji preserved |
| Edit restrictions and preferences | Frequency, duration, allowed weekdays/window and separate preferred weekdays/window |
| Create Study | Sixteen semantic settings producing seventeen field proposals, including saved Home/Dry references and a link |
| Edit negation | Do not pin, do not split, duration; preserve unrelated settings |
| Create with omitted essentials | Name-only habit uses configured rhythm/duration; an explicit recurrence retains default duration; a task uses its own duration profile |
| Edit after changing creation defaults | Pin an existing item while preserving its name, frequency and duration |

The original add-screen Walk flow and the four-setting Gym edit are also tested
through the existing real-model/UI tests. A real in-flight worker is terminated
to verify an isolated retry and preservation of completed siblings. The focused
save/undo regression battery runs both scripted and actual-model modes.

Run:

```bash
NEEDLE_MODEL_PATH=test-results/needle-live/needle3.cact \
NEEDLE_WASM_PATH=test-results/needle-live/needle.wasm \
node tests/assistant-field-jobs-test.js
```

Detailed evidence is `test-results/needle-field-jobs-live.json`. UI/recovery
artifacts remain `needle-focus-sunset-add-live.json` and
`needle-focus-worker-recovery-live.json`. The scripted field battery additionally
checks omitted/shortened evidence, competing proposals, dependency ordering,
ambiguous values, continuation, stale results and long-context trailing fields.

## Field audit and follow-up context

`tests/assistant-field-coverage-test.js` has a predefined language case for every
one of the 66 registered fields. Frequency checks its coupled count/period;
occurrence fields are covered through their scoped time/duration/appearance
aliases. All cases use the production scheduler, evidence validation, review and
commit path. The audit checks intended values, absence of unrelated proposals,
unchanged storage before confirmation, normalized saved values and preserved
history. Reminder cases emulate Android permissions and reconciliation only;
they use the real model, without testing actual OS notification delivery.

Ownership policies are now shared across retrieval, source boundaries, model
evidence and coverage. They distinguish preferences from restrictions, timer and
reminder lengths from session duration, event end dates from start dates, and
travel reminders from item reminders. Source excerpts preserve quantities before
their labels and qualifiers such as “immediately.” Scalar validation rejects
conflicting, negative or out-of-range values; date validation rejects calendar
rollover, including February 30. Named dates keep their explicit year across a
comma. A coverage report records an obligation for its original instruction,
rather than marking every sibling in a guessed family as required.

Task “plan by” language maps to the task's due date without changing its deadline
strictness. A date-only edit moves its existing clock to the new day. Habits keep
their separate soft plan-by date. The Pay rent request “Can you plan this by next
week” preserves its 7-minute duration and 28-day frequency. “Next week” retains
the existing seven-calendar-day convention; “first week of 2027” asks for a date.
An incomplete field label does not clear an existing value.

Each follow-up job receives a stable field-value snapshot and relevant earlier
user excerpts. Validated earlier evidence also retains its original message and
offsets, including bare replies to field questions. Explicit first/last references
narrow the candidate evidence. The field's model extraction reads that original
wording; only the model's exact returned quote can
supply a value. Several distinct earlier values without a clear reference ask
which one. A concrete current value cannot be replaced by historical evidence,
and old unrelated changes are not replayed. These reads share the same three
runtime leases. History and provenance are in memory only.

Run the complete field audit:

```bash
NEEDLE_MODEL_PATH=test-results/needle-live/needle3.cact \
NEEDLE_WASM_PATH=test-results/needle-live/needle.wasm \
node tests/assistant-field-coverage-test.js
```

Evidence is `test-results/needle-field-coverage-live.json`. Without the asset
variables the same file uses scripted adapters to test host behavior; those
results are not model-accuracy measurements. `FIELD_CASE` filters case ids for
diagnosis; omit it for the full audit.

## Numeric-language follow-up

The reported edit “I want to do this every third day” exposed a normalization
gap: Needle selected the correct literal frequency, but the host accepted only
cardinal intervals. Shared readers now validate cardinal and ordinal numbers,
coupled count/period values and explicit units. No field gets a value when its
model extraction declines or fails. Source boundaries preserve compound counts,
fractional lengths and numeric signs; a session length cannot borrow a chunk,
gap, timer or reminder value.

The extended field corpus declares expectations for ordinal/day/week recurrence,
spoken month dates, durations, chunks, gaps, timers, automatic completion,
early/delay allowances, radius and reminder leads. It includes correction and
historical frequency references. Negative or conflicting values, unsupported
units/recurrence, invalid month days and lengths outside app limits remain
questions. A selected but invalid excerpt reports its validation reason instead
of a generic extraction failure. An incomplete automatic-completion instruction
cannot silently clear the setting to manual.

Before changes, a live four-case reproduction failed the exact reported edit,
spoken month days, week-based delay and an hour-based reminder lead. In
particular, the old week-based delay proposed 2 days for “two weeks.” The new
unit tables validate the converted value against the field's actual limits.

## Recorded results

- The November 2 live Needle rerun passed all five supported test files. The
  field audit passed 92 positive language cases and 22 guards, covering all 66
  registered fields; the complex battery includes 16 create/edit cases. The
  Add-screen test exercised three concurrent workers and worker recovery. The
  assets and inference were real; Android notification delivery and physical
  device performance were not tested.
- The field audit passed **75 live Needle cases**: 69 positive cases, including
  date clarification/recovery and historical references, plus six guards for
  invalid dates, ambiguous week ranges, conflicting quantities, negative radius
  and ambiguous prior durations. It covers all 66 registered fields; each
  positive case checks confirmed persistence and no unintended sibling edits.
- The assistant suite passed **17 files / 1,257 assertions**, with zero page
  errors. It includes failure recovery, stale replies, evidence grounding,
  save/undo and concurrent-edit regressions. These suite assertions use scripted
  inference unless the individual test explicitly enables live assets.
- The **14 complex live create/edit cases** also passed every expected field and
  confirmed persistence, including natural “remind me to” task creation,
  simultaneous restrictions/preferences and the seventeen-proposal Study case.
- A further live recheck verifies historical references and actual saved
  reminder modes/lead times. Reminder reset now removes existing overrides in
  its own scope, preserves other dates and applies explicit replacement modes.
  The focused regression suite checks reset plus replacement in both scopes.
- Detail search/navigation passed after updating its shared date aliases.
- Earlier UI/runtime measurements include actual Add-sheet interactions,
  three-lane inference overlap and terminated-worker recovery. Those earlier
  measurements are distinct from this field audit.

## Fractional-duration regression, November 3, 2026

Live Needle returned “one and a half hour long” correctly, but the shared
normalizer converted its inner “a half hour” first and staged 30 minutes.
Complete quantities now normalize before standalone fractions. The same reader
handles mixed fractions before or after their unit across sessions, chunks,
gaps, timer targets and automatic completion. Evidence boundaries also retain
fraction symbols and their leading whole numbers.

The scoped recheck passed all **17 assistant files / 1,375 assertions**, with
all five live Needle test sections enabled and no page errors. The field audit
passed **106 positive cases and 25 guards**, including the exact reported
request, task and event-occurrence edits, and rejected negative, conflicting
and oversized lengths. All **17 complex live create/edit cases** passed,
including simultaneous fractional session, chunk and gap lengths. The related
swipe-shortcuts, detail-edit-flow and detail-search-navigation UI tests passed.
Optional live Qwen checks were disabled; these results use the pinned Needle
WASM in desktop Chrome with synthetic data.

## Focused everyday-language regression

The feedback request “Let's plan for tomorrow” already reached the date job.
The shared prefix remover consumed the connector “to” from “tomorrow,” leaving
an invalid date. Prefix removal now respects token boundaries across settings.
A fresh set of 24 everyday paraphrases then exposed nine additional failures,
despite the earlier field catalog passing. The initial live results remain in
`test-results/needle-focused-basics-initial-live.json`.

The shared pipeline now supplies focused-item and field context to extraction,
preserves literal names/topics and semantic modifiers, and handles dialogue
framing consistently. Needle selects correction scope from a bounded field
menu using prior original evidence. A declined scope decision cannot fall back
to parser inference. Original-source extraction and typed validation still
follow that decision. Explicit sibling instructions remain independent.
Optional fields also accept an explicit clear instruction; a topic literally
named “Clear” stays a topic. Omitted values never imply clearing.

The final assistant run passed **17 files / 1,439 assertions**, with every
optional Needle section enabled and **zero page errors**. Actual pinned Needle
WASM passed **160 positive field cases and 33 invalid-input guards**, plus all
**17 complex create/edit cases**. Positive cases check the complete intended
patch, absence of unintended sibling edits, no writes before confirmation and
confirmed persistence. The exact feedback request also passed through the home
item's real chat UI, preserving its identity, clock and unrelated item until
Save. These are desktop Chrome measurements with synthetic data; optional Qwen
checks were disabled and Android permission responses were emulated.

The run also corrected two test-fixture problems without relaxing assertions:
calendar-day ages now survive daylight-saving changes, and the live crash test
terminates the actual target worker even when it is assigned to worker zero.

Final local evidence: `test-results/last-run.log`,
`test-results/needle-field-coverage-live.json`,
`test-results/needle-field-jobs-live.json`, and
`test-results/needle-focused-request-ui.json`. Run all live sections with the
asset variables and assistant command in [TESTING.md](../TESTING.md).

## Focused reliability priorities

Needle's product scope is creating one item or editing the item already in
focus. The focused identity is supplied by the UI and is assumed throughout
the request; this pipeline does not route a request to a different saved item.
Score focused results independently of the historical general-chat battery.

| Priority | Error category | What to check |
| --- | --- | --- |
| High | Incorrect field or value | Compare the complete staged patch with the intended fields, even if another clarification blocks Save. An unintended proposal can otherwise survive a correction and be saved later. Check persisted values and preserved fields too. |
| High | Lost essential value | Name, duration, recurrence count/period, and applicable date/time must survive review and confirmed Save. An unrepresentable requested value must block Save. |
| Lower | Safe clarification or unsupported wording | A request remains unresolved with its prior values preserved and no unintended proposal. Record the usability failure without counting it as a wrong change. |
| Lower | Minor title wording | Track separately from wrong settings and lost essentials. |

Explicit setting assignments now retain ownership of their values through
candidate retrieval, source selection and extraction. The existing field
catalog supplies setting labels, with aliases for core quantities. A value
with an incompatible unit asks about that setting; it cannot become a proposal
for a sibling field. No executable value is supplied without model-selected
original evidence. The regression includes correction after an invalid
assignment, checking that the corrected draft retains no unintended patch.

Clock evidence uses the complete scalar clock token rather than all prose up
to the next field. This fixes “Go to park today at 12 pm and this will be for one
and a half hours”: the requested time is noon and the duration is 90 minutes.
Competing clock values and negative restrictions stay in the evidence and ask
for clarification. A task time without a date asks for the missing date in both
Create and Edit, instead of silently saving without the requested time.

After a confirmed create, another instruction in the same chat rebases onto
that saved item as an edit. It keeps the same ID and current history; it cannot
append a second item. Repeated Save without another change remains idempotent.

`tests/assistant-field-jobs-test.js` covers these host boundaries and the original
feedback request through the real pinned model when asset paths are provided.
Its live positive cases now reject unexpected staged fields as well as checking
requested values. `tests/assistant-field-coverage-test.js` includes invalid-unit
guards for duration, frequency, gap and timer assignments. Run the deterministic
assistant suite separately from live model scoring:

```bash
ASSISTANT_LIVE=0 ./run-tests.sh assistant
NEEDLE_MODEL_PATH=test-results/needle-live/needle3.cact \
NEEDLE_WASM_PATH=test-results/needle-live/needle.wasm \
node tests/assistant-field-jobs-test.js
```

The November 5, 2026 check passed all 17 deterministic assistant files (1,397
assertions, no page errors). The actual pinned Needle runtime passed 21 complex
Create/Edit cases, 21 selected essential-field language cases, and 18 invalid
input guards: 60 targeted case-runs in desktop Chrome with synthetic data. The
clock feedback request is among these cases. This is targeted focused coverage,
not a rerun of the general-route battery or a Safari/physical Android audit.
Local evidence is `test-results/needle-live/focused-regression-final.log`,
`focused-final-live.log`, `focused-priority-fields-final.log`,
`focused-priority-fields-final.json`, and
`test-results/needle-field-jobs-live.json`.

The follow-up focused battery review keeps title framing, count-plus-period
frequency and follow-up corrections in the shared field pipeline. Title
connectors are trimmed only when another setting actually cut the source;
literal titles such as “Carry On,” “New Task,” and “Not at Night” remain intact.
Day-part requests use the same candidate and ownership checks as other time
windows, including the distinction between required and preferred hours.
Unrepresentable night windows ask for concrete hours. A naming clause owns its
order words, while a separate ordering clause remains accounted for.

The reviewed November 5 check passed 17 deterministic assistant files (1,406
assertions, no page errors). The original 30 live focused cases yielded 26
completed saves and four justified questions, with no unexpected staged fields.
Ten additional live boundary cases yielded five completed saves and five
justified questions; three live literal-name cases also passed confirmed
persistence. These 43 targeted cases used the pinned model in desktop Chrome.
A justified question is a safe unresolved outcome, not a completed edit or a
demonstrated successful clarification exchange. The scratch harness now checks
expected values even when another field asks, enforces requested question
fields, and checks storage on cases without Save. Review evidence is in
`test-results/needle-live/review-live-audit.json`,
`results-review-extra-final.jsonl`, `review-live-literal-names.json`, and
`review-assistant-regressions-final.log`.

## Limits

Representative coverage of every field is not exhaustive natural-language
coverage. Unknown paraphrases, semantic omissions and complex linked alternatives
can still require clarification. A reference that needs an unsupported
transformation of an earlier value asks for a concrete value; history does not
justify inventing a new one. Several prior values without a clear reference
remain ambiguous. Over-budget historical references ask which instruction to use
instead of silently selecting one.

Measurements use desktop Chrome with synthetic data and the pinned live Needle
WASM. Physical Android throughput, memory pressure and notification delivery
have not been measured by this audit. Three independent contexts do not form one
24K-token input. The earlier query/weather baseline failures are historical;
the current broad suite passed, without a dedicated query/weather fix here.
