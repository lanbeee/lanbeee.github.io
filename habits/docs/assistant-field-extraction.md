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
- A crashed/timed-out runtime receives one automatic job retry. Continue retries
  unfinished work, including failed retrieval/discovery/coverage. Completed
  siblings remain staged. Cancellation stops all runtimes and queued work.
- Long requests use overlapping unchanged contexts for discovery/coverage and
  bounded source windows for extraction. A required field with more than twelve
  relevant windows asks for clarification rather than accepting a truncated set.

The resulting editable preview still requires interpretation approval when
uncertain and a separate Save. Existing commit conflict checks and undo apply.
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

## Recorded results

- Ten live complex requests passed every predefined expected field and confirmed
  persistence. The largest produced seventeen field proposals. These cases
  cover habits, tasks and local events, both Add and Edit, including the previously
  omitted duration-plus-sunset edit.
- Sixteen scripted scheduler/trust-boundary checks passed. The joined hour/minute
  parser remains supported, while conflicting alternative lengths are rejected.
- The real-model/UI focused test passed 29 checks, including two actual add-sheet
  runs, native inference overlap across all three lanes and a terminated-worker
  recovery that retried only its own job.
- The focused regression test passed 30 checks across scripted/live modes,
  including save/undo, concurrent edits, event scope and ambiguous-place choices.
- Detail search/navigation passed after moving its aliases into the shared file.
- The broad assistant matrix passed 15 of 16 test files with zero page errors;
  the remaining file has the three independently reproduced baseline failures
  described below. Those failures were not changed or suppressed.

## Limits and baseline failures

This is an evaluated improvement on these requests, not proof that every field
or natural-language paraphrase works. The catalog covers registered settings;
that is distinct from end-to-end language coverage. Retrieval/model omissions
remain possible. Unknown/contradictory values must remain visible, and complex
linked alternatives without a supported structured interpretation require
clarification. Keywords can nominate extra jobs; a nomination is not evidence
that a value should change. Confidence still governs interpretation approval.

Measurements are desktop Chrome tests. Physical Android throughput and memory
pressure have not been measured. Three independent contexts do not form one
24K-token input.

The broad assistant suite currently has three query/weather failures: ordinal
overdue ranking, a multi-condition count, and weekly best-weather scoring. They
also reproduce when the modified runtime scripts and index are replaced by the
previous commit's bytes. Baseline evidence is in
`test-results/baseline-queries-final.log`; these are separate from the field scheduler
and are not counted as passing.
