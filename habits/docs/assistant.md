# Tings assistant

For the current Needle architecture assessment and staged improvement plan, see
[Needle as the everyday assistant](assistant-needle-next.md).
For the measured LFM2.5 Q5 versus Needle evaluation, see
[the model comparison](assistant-model-comparison.md).
For the subsequent single-action implementation and its measured limits, see
[the Needle basics pass](assistant-needle-basics.md).

Read this only when the task is the Tings assistant. For planner, home, settings, and habit work, leave this file and every `js/assistant-*.js` file closed. `js/assistant-tools.js` is about 5,300 lines and is not on that path.

When Needle is the provider, the only entry is one item. Add, Edit with AI on a card, and Change with AI in details open a focused session. The top-bar and bottom-bar chat buttons stay hidden. The chat opens on that item's Edit or New summary, and the working-on bar stays hidden so the name is not listed twice. Clearing the chat keeps the same item and shows that summary again. A session creates one habit, task, or local event, or edits the item the host already selected. Needle cannot switch items, add a second item, answer a general question, log a completion, or run a planner action. Several settings in one message are staged together. Words the model returns are kept only when they appear in the original request; the app's parsers then check rhythm, duration, dates, and windows. A copied snippet that belongs to a different setting is ignored. Save stays blocked while a requested field is missing, contradictory, or still being read. Save writes the summary; Edit opens those changes in the detail editor without saving. Ollama, LM Studio, and the external Android bridge still use the general assistant.

Focused saves apply the staged fields to the current saved item. A concurrent
change to a field in the preview requires another review; unrelated edits and
logs survive. Undo reverses this action’s item, topic, weather-profile, and
reminder changes while preserving later edits and newly shared dependencies.
An occurrence-scoped event edit writes time, duration, emoji, and color into
that date’s exception. A new event starts with series scope.

The focused path keeps the latest message separate from its request history,
so a follow-up can replace an earlier value. A completeness pass can recover
another field in a family already processed. A bounded model menu handles
unlabeled groups; routing text cannot itself
supply an executable value. Invalid or missing values stay unresolved. Clarification
choices stage real values. Reminder previews show the actual mode and lead time.
Save writes the staged item. Edit opens the detail editor with those changes
filled in and leaves them unsaved until the detail save.

Focused create and edit now use the same semantic-field pipeline: a baseline
record plus validated field proposals. Create starts from form values and app
defaults; Edit starts from the saved item. The field catalog reuses the detail
search labels and aliases in `js/item-field-catalog.js`. Keyword cues nominate
jobs immediately; Needle embeddings and model discovery nominate additional
candidates. Retrieval supplies no executable values. Frequency keeps its count
and period together; windows retain their endpoints and modifiers.

Create freezes its baseline when the session opens. Essential frequency and
duration use the chosen Add form values first, then the kind's configured
creation defaults (including the separate task profile). The review is a short summary in the chat, on screen as soon as the item opens. It lists only the
settings this request set, the same way an edit lists only what changed.
Add-form values and new-item defaults stay on the draft and are not listed.
The note is the last line of the summary. Save and Edit appear under it once a change is
staged or a value still needs an answer. Omission
may use a default; a requested value that fails extraction stays unresolved.
Names still need user-supplied evidence, and events need an actual date/start
time. Edit omission preserves the existing item, including its essentials.

A lazy pool has at most **three** independent Needle runtimes. Extraction,
embedding retrieval, discovery and coverage all use those same leases. Each
extraction exposes one tool with one evidence field. The model selects an exact
original-source excerpt or declines it with an empty string. The host enforces
that evidence enum again, including its original source offsets, before applying
only that job's field normalizer. Shortened replies cannot drop negation,
preferences or time-window endpoints. Empty, failed and invalid results never
cause parsers to supply a value from the query. Unsupported negative restrictions,
conflicting lengths and ambiguous place matches remain visible questions.

Core name/frequency/duration checks and discovered jobs share a continuously
drained queue. Completed jobs update the editable preview while siblings run.
Kind, habit mode and recurrence prerequisites merge in a fixed order; chunk size
waits for splitting. The original text stays with each job. Follow-ups replace
only the affected setting and preserve unrelated interrupted work; revision
checks reject late replies. Long discovery/coverage input uses overlapping
original-text contexts; embeddings process every query batch. An excessive
number of instructions for one required field asks for clarification rather
than silently truncating that field's results.

Field ownership policies are shared by candidate retrieval, source boundaries,
extraction and coverage. A preferred weekday is not an allowed weekday; a
departure reminder is not an item-start reminder; an end date is not a start
date. Quantities keep their leading numbers and qualifiers. Coverage tracks an
unaccounted original instruction rather than demanding every sibling in a
guessed family. Invalid calendar dates and conflicting scalar values ask for
clarification instead of rolling over or choosing the first number.

Numeric evidence uses shared cardinal/ordinal readers and explicit unit tables.
Needle still selects the field and exact original excerpt; no declined or failed
model result is filled by a parser. Repetition intervals accept “every third
day,” “each fourth day,” and counted week periods. Month-day lists accept spoken
ordinals without treating interval ordinals as month dates. Fractions, hours,
weeks and kilometers retain their units through validation. Unsupported units,
ambiguous counts and lengths outside app limits ask rather than clamp. Source
boundaries preserve compound numbers and signs. A model-selected but invalid
value reports its validation question; omission still uses creation defaults.
Incomplete automatic completion never silently switches to manual completion.
Duration normalization consumes a complete mixed quantity before converting
standalone fractions: “one and a half hour” is 90 minutes, and “an hour and a
quarter” is 75. The shared conversion applies to sessions, chunks, gaps, timer
targets and automatic completion; grounding cannot accept only the fractional
tail of a larger quantity.
Source boundaries retain fraction symbols such as “1½ hours” and “¾ hour”
along with the complete quantity, so a later word such as “long” cannot remove it.

On follow-up turns, each field receives a stable snapshot of its draft value
and bounded, relevant earlier user excerpts. A reference may nominate earlier
evidence, with its original message and offsets retained. Only the model's exact
selection can be normalized and staged. First/last references narrow that
evidence; several distinct earlier values without a clear reference ask which
one. The current explicit value takes precedence, and earlier unrelated edits
are not replayed. A field question accepts a bare value; a successful correction
retires that question. History and these provenance records stay in session
memory and disappear when the focused chat is cleared.

Tasks interpret “plan by” as their due date, preserving the clock and deadline
strictness. Habits retain their separate soft plan-by date. “Next week” uses the
existing seven-calendar-day convention; a week range such as “first week of
2027” asks for an exact date. Naming the date setting without a value never
clears its existing date.

Crashes and timeouts restart only the failed runtime/job, with one automatic
runtime retry. Completed sibling proposals remain staged. While a read is still
running, the summary keeps the settings found so far and shows a short progress
line for the current setting. Continue appears only after that read stops with
unfinished settings, and retries those jobs, including discovery, retrieval and
coverage. Workers that fail memory allocation fall back to surviving pool members. Cancellation or changing
provider stops the whole pool. All workers reuse the same verified cached assets.
Checkpoints remain in the current session; they are not persisted across reload.

Save remains blocked during inference, unfinished work, errors, and
clarifications. Confirmed writes and undo still use the existing
focused commit path. The older family extractor remains explicitly selectable
by scripted regression adapters; the product uses semantic-field jobs. See
[the field-extraction evaluation](assistant-field-extraction.md) for live results
and the limits of this approach.

The assistant is optional local chat. New setups default to on-device Needle 3;
existing Ollama / LM Studio selections remain available. `js/assistant-loader.js`
loads the assistant code after the first home render. It must not participate in
critical boot. Model assets are never fetched at boot or merely by enabling the
assistant. The user chooses **download Needle 3** in Settings or the assistant
sheet (36.3 MB, including WASM). Progress, cancellation, retry and removal share
one download state. Verified immutable assets live in `tings-needle-v1`, outside
the versioned app-shell cache, and are reused offline. Storage eviction requires
a new download. Only public model files are fetched; inference runs in a worker.

For external Android agents (Gemini / Google Assistant), see [Android assistant integration](android-assistant.md). That native-only bridge reuses these tools without requiring the local model.

## Which file

| File | Owns |
|---|---|
| `js/assistant-schema.js` | Frozen tool and intent contract |
| `js/assistant-parse.js` | Clock, date, and duration normalization. Routing does not call it to choose intent |
| `js/assistant-tools.js` | Argument validation, draft merge, catalogs, save |
| `js/assistant-harness.js` | The model loop and system prompt |
| `js/assistant-client.js` | Ollama / LM Studio transport |
| `js/assistant-needle.js` | Needle download, integrity, storage, transport adapter |
| `js/assistant-needle-worker.js` | Needle WASM inference, model routing, bounded schemas and request boundaries |
| `js/assistant-focus-registry.js` | Editable fields for one focused item |
| `js/assistant-focus.js` | Focused session, review, save, and undo |
| `js/assistant-focus-needle.js` | Grounding helpers, trace and older family extraction |
| `js/assistant-focus-fields.js` | Shared create/edit semantic jobs, retrieval, scheduling and proposals |
| `js/item-field-catalog.js` | DOM-independent setting labels and search aliases |
| `js/assistant-workflow.js` | Lossless multi-part queue, staged work, clarification and retry |
| `js/assistant-ui.js` | Sheet, preview, settings |
| `js/assistant-feedback.js` | Local diagnostic snapshots and opt-in Google Form prefill |
| `js/assistant-loader.js` | Deferred script load |
| `js/assistant-external.js` | Native AppFunctions reads and confirmation previews |

Open the one file that owns the change. Grep the function and read that range.

## Feedback

Failed replies offer **send feedback**; other replies offer **report a problem**.
Ask Tings keeps **feedback** in the header. It opens a short card: the form
link, a copy action, and collapsed diagnostics. It prefills the same form
from the open Needle item: the typed requests, staged changes, and model
trace. The saved item stays out of that report. **debug** stays hidden until
the ask Tings title is tapped three times. That shows the header control,
which opens a trace tray over the composer. Tap it again, or the tray’s close
control, to dismiss the tray. The tray bar compacts the log in place.
About → send feedback uses the same form. Both open it with answers already
filled where this device can tell: how long Tings has been in use
(`entry.457400724`) and which planning kinds are in use (`entry.593100343`,
one value per checked option). The user can change every answer. The rating,
email, what’s working, and the day-plan questions stay blank.

An assistant report also puts a short editable expectation in
`entry.1988333965` and the diagnostic snapshot in `entry.1563652333`. That
snapshot is the turn's request, response, retained trace, model and device
details even when debug display is off. Partial Needle failures retain the
traces of earlier parts. Saved libraries and server settings are excluded;
recognizable credentials are redacted. Review and copy happen locally. Only
the user's **open feedback form** link sends the prefill to Google.

Keep those entry ids in `js/config.js` in sync if the form changes. Reports
too long for the bounded URL use an explicitly shortened prefill, with the
full local report available to copy and paste. Register new assistant slices
in both the deferred loader and service-worker precache.

## Routing

The general assistant route is model-first. The focused item editor uses the candidate retrieval described above; only model-returned evidence can supply field values. On the general route, parser output does not choose intent, split clauses, populate the model envelope, merge tool arguments, or recover from a failed model call. Deterministic helpers validate tool schemas, normalize dates and clocks, read authoritative app data, and perform confirmed writes.

Needle has an 8192-token context. A model pass proposes separate requests as
verbatim strings. `assistantNeedleSlices` uses their positions only as boundaries:
the slices concatenate to the exact original, including omitted clauses and
trailing constraints. Generated paraphrases never become executable requests.
Up to 24 parts run through the normal validated harness, each with its own call
budget. Drafts, references, tool answers and separate action confirmations survive
between parts. A clarification retains the remaining queue; a failure keeps work
and exposes a retry of the unfinished part. Cancelling or clearing focus drops
the queue. No workflow operation saves before normal confirmation.

Needle first tries a stable twelve-tool basic scope with core fields. This avoids
retrieving availability instead of frequency and exposing oversized schemas.
If that pass declines, an identity-only menu exposes ordinary actions,
settings, features and saved-item queries together, with `ask_user` available.
Only the selected schemas are expanded for extraction. Item edits get a separate
small control menu. Features have no privileged first pass; a capability tool
also needs a quoted feature word grounded in the actual request. This validates
model output rather than routing natural language with a parser.

Single-action extraction checks coverage of names, frequency, session length,
task dates/clocks and habit windows. Missing or invalid values get at most three
separate one-field Needle extractions. Values still come from the model and must
match the request through the normalizers. A duration accidentally returned in
the frequency slot can move to the duration slot of the same saved-item edit;
this never changes create/edit intent or supplies a missing value. An incompatible
item candidate can get one bounded reconsideration with five item schemas.
Unresolved fields ask a focused question. Native snake-case argument diagnostics
are matched unambiguously to returned fields before checking converted units.

On the general Needle tool path, the welcome asks for one action at a time. A combined frequency/session
length edit asks for separate requests instead of presenting a partial change. The focused item editor does not use that split: one message may change frequency and duration together.
An ask or interpretation proposal offers an optional action selector: choosing
an action retries the unchanged request with only that action and clarification
available. This is explicit user steering, not automatic model understanding.
The choice survives approval of that request and clears on different text.
Stale selectors are disabled, and selecting Mark done fixes logging rather than
undo. Interpretation approval and the normal write confirmation remain separate.

Routing sees compact item identities, focus and clarification context. Embeddings
also rank optional fields inside selected schemas. Field order and short
descriptions matter: frequency precedes duration, dates and clocks have separate
slots, and illustrative names or quantities must not become extraction evidence.

Needle confidence is retained, including the routing passes. Below 0.7, or for
a suppressed candidate, the assistant asks about the specific interpretation
before executing tools. **Use this interpretation** approves only those tool
arguments. Normal validation and the separate Save/log/plan/delete confirmation
still follow. A typed correction clears the old proposal. Native negation and
ungrounded arguments remain blocked; equivalent spoken lengths and normalized
frequencies can be validated without inventing a field. Missing habit frequency,
invalid units and empty tool responses ask a short question instead of waiting
for repeated failures. Context exhaustion returns a clarification and preserves
the unfinished workflow. Diagnostics retain route, confidence and runtime errors.

Unsaved drafts survive follow-up messages, including dates and stable draft
identity. Prior drafts remain references; an unanswered later part cannot reuse
an old preview as a successful result. Clarification answers retain the original
request in the model envelope. The phone UI shows at most four wrapping choices
and retires earlier choices and confirmations when a new response arrives.

The base Needle weights still sometimes omit requested fields or choose an
incorrect argument on advanced requests, including opportunity recurrence,
compound frequency/window/chunk settings and filtered counts. More model passes
alone did not make these cases reliable in live testing. Confirmation previews
remain essential; do not describe arbitrary complex requests as fully supported
or treat this base model as a proven replacement for every app control. The
workflow improves multi-part execution but is not a guarantee of semantic
completeness. Product-specific fine-tuning and a wider real-model evaluation are
still needed for that standard.

Fields that name another item (`before` / `after`, habit-window anchors) resolve against saved items plus in-flight drafts from this turn. The model supplies those titles. Parsers do not invent the link.

The first model pass exposes final validated tools, so `classify_intent` is optional. The add-sheet sparkles button and the detail "change with AI" row pass `startIntent` / `draft` via `assistantOpenWithInstruction`, so the turn starts at extract. Trace provenance is `entry-add` / `entry-detail`.

The add-sheet button is only for a new habit or task of the kind already chosen on that sheet. The model request says so, and Needle is offered only the matching create tool. A short name is not a weather question, a phone call, or an edit of a saved item. Frequency, length, and date already showing on the form fill anything the description leaves out. If the model returns no create call, the host still drafts that one item from the typed name and those form values. The chat starts blank, shows the typed words, and does not send earlier turns. Nothing is saved until the preview **save**, which also closes the add sheet. Dismissing the chat leaves the typed draft on the add sheet.

When enabled, the assistant also appears as **ask AI** when swiping right on a
home habit or task card, in full and minimal views. It opens a fresh conversation
focused on that saved item's identity: earlier turns are removed and are not sent, and there is no model call until an instruction
is sent. Item actions and questions share the detail entry's draft context;
home turns retain `entry: home` in their trace. The minimal-mode controls
each have a closed Needle alias that stages one `draft_item` change: how often,
duration, allowed days and hours, name, habit or task, build/limit/stop, and a
task's due date and start time. A repetition count cannot share a schema with
minutes. Duration fields keep the user's words, including hours, fractions, and
number words; Tings converts them, and a minute count is still grounded when it
is that same spoken length. The first pass retrieves at most two closed control
aliases; the fallback edit menu exposes a broader selection. Retrieval can omit
a relevant sibling control, and an actionable partial call does not itself
prove the whole request was understood. A call that includes no new setting is rejected and repaired. A value
that is invalid, or that already matches the item, still previews. Other
settings stay on the general edit alias. Repair feedback continues the worker
conversation separately from the literal request.

## Tools

- `draft_item` creates or changes item settings.
- `draft_setting` handles weather profiles, places, busy times, and topics.
- `draft_batch` handles new lists and pastes.
- `apply_items` changes, snoozes, shows, or deletes a queried set (topic, name, conditions, or the previous list), including different patches for different subsets.
- Read-only tools: `answer_weather`, `answer_schedule`, `answer_items`, `answer_settings`, `lookup_item`.
- `answer_settings` also exposes verified calendar import/sync, native reminders, display pairing and Android widget capabilities. Calendar and pairing return buttons to the existing controls. File selection, OS permissions and pairing approval stay in their normal flows. Native-only controls remain absent in the PWA.
- `answer_weather` query `hours` ranks a window (several conditions, or the lowest or highest of one metric). Query `compare` scores two times, including an offset from sunset. Query `item` with a start checks a habit in that window even when it is not already planned.
- `answer_schedule` query `missed` is the same list as the today-header missed pill. Day and list payloads include priority and frequency.
- `complete_item` logs minutes, value, or note, or undoes today's latest completion.
- `plan_item` adds, replaces, or removes one-day plans.
- `delete_item` removes an item.
- `find_item` ranks saved titles by deterministic fuzzy match. A unique hit is used. Several close hits ask the user.

Every action creates a confirmation preview and uses the normal recoverable undo toast. One confirmation saves every staged draft.

Direct-object setting patches ("add the location home") stay edit-like even with a create verb. A descriptive weather clause inside a create ("add a Stretch … using Dry weather") stays a create. Keep `assistantLooksLikeEdit`'s three-way order intact: object patch, then create guard, then heuristics.

## Turn loop

Compound questions, follow-ups, and several asks in one message share one model loop. After a read, `draft_item`, `draft_setting`, `apply_items`, or complete / plan / delete, Tings returns the tool payload and gives the model another turn. A lone `draft_batch` already holds every new item, so that call publishes the preview. Sibling tools in the same response still run. The model decides whether a part remains. The harness does not infer that from phrasing.

Within one harness turn, follow-up is capped at two, with four model calls (six for a multi-item turn). Needle workflows give each literal request part a fresh harness budget. Past the cap, staged work is kept and the model is not asked again. Sibling `tool_calls` all run, including after a no-op, and multiple writes retain separate confirmation actions.

Focusing a saved item for complete, plan, delete, or lookup is pronoun context, not a staged edit, so a model stop still returns those confirmations or the tool answer. A `draft_setting` emitted beside a `prepare_action` read stays staged and does not end the turn, because that setting has not seen the result. The model then calls whichever action the user asked for. It does not invent a task or habit. Repeating the same `draft_setting` finishes a request whose action is the setting itself.

The next user turn sees `recent.items` / `recent.referent` in the envelope, so "that one" can `lookup_item` and "those" repeats the same read with sort and position. Explicit names never fall back to a focused or recent item. Only omitted names and pronouns may use context.

`ask_user` (and classify `unclear`) asks one short question when the request is confusing, at most twice in a row, then stops. A whole-week reschedule, or deleting every saved item with no topic, name, or filter, is `classify_intent` `unsupported`. Changing, snoozing, or deleting a matching set is `apply_items`.
