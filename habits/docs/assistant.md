# Tings assistant

Read this only when the task is the Tings assistant. For planner, home, settings, and habit work, leave this file and every `js/assistant-*.js` file closed. `js/assistant-tools.js` is about 5,300 lines and is not on that path.

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
| `js/assistant-workflow.js` | Lossless multi-part queue, staged work, clarification and retry |
| `js/assistant-ui.js` | Sheet, preview, settings |
| `js/assistant-loader.js` | Deferred script load |
| `js/assistant-external.js` | Native AppFunctions reads and confirmation previews |

Open the one file that owns the change. Grep the function and read that range.

## Routing

Natural-language routing is model-first. Parser output does not choose intent, split clauses, populate the model envelope, merge tool arguments, or recover from a failed model call. Deterministic helpers validate tool schemas, normalize dates and clocks, read authoritative app data, and perform confirmed writes.

Needle has an 8192-token context. A model pass proposes separate requests as
verbatim strings. `assistantNeedleSlices` uses their positions only as boundaries:
the slices concatenate to the exact original, including omitted clauses and
trailing constraints. Generated paraphrases never become executable requests.
Up to 24 parts run through the normal validated harness, each with its own call
budget. Drafts, references, tool answers and separate action confirmations survive
between parts. A clarification retains the remaining queue; a failure keeps work
and exposes a retry of the unfinished part. Cancelling or clearing focus drops
the queue. No workflow operation saves before normal confirmation.

Calendar import, display pairing and widgets have a dedicated model discovery
pass with a tiny read-only toolset. After the focused action pass declines a
request, another small-schema pass sees settings and saved-item query tools. The worker
uses this route for settings/features and saved-item queries. Ordinary reminder tasks keep their
focused action schemas, so phone-reminder setup does not steal task creation. Nested filters and bulk-change
groups can now be selected rather than being excluded from Needle's grammar.
Fixed alias arguments are removed from both properties and required fields.
Grounded suppressed writes can stage a preview only on the first pass. Suppressed
settings reads can return verified feature information; other suppressed reads,
negations and ungrounded arguments are refused. Tool results continue the native
model conversation without the large server-model steering prose. Replay and
context budgets are bounded.

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
