# Local assistant (side feature)

Read this only when the task is the Tings assistant. For planner, home, settings, and habit work, leave this file and every `js/assistant-*.js` file closed. `js/assistant-tools.js` is about 5,300 lines and is not on that path.

The assistant is optional local Qwen3.8 chat. `js/assistant-loader.js` loads it after the first home render. It must not participate in critical boot.

User-facing sheet behavior is the "Local assistant" section of `DOCUMENTATION.md`. Grep that heading. Do not read the rest of `DOCUMENTATION.md` for an assistant code change.

## Which file

| File | Owns |
|---|---|
| `js/assistant-schema.js` | Frozen tool and intent contract |
| `js/assistant-parse.js` | Clock, date, and duration normalization. Routing does not call it to choose intent |
| `js/assistant-tools.js` | Argument validation, draft merge, catalogs, save |
| `js/assistant-harness.js` | The model loop and system prompt |
| `js/assistant-client.js` | Ollama / LM Studio transport |
| `js/assistant-ui.js` | Sheet, preview, settings |
| `js/assistant-loader.js` | Deferred script load |

Open the one file that owns the change. Grep the function and read that range.

## Routing

Natural-language routing is model-first. Parser output does not choose intent, split clauses, populate the model envelope, merge tool arguments, or recover from a failed model call. Deterministic helpers validate tool schemas, normalize dates and clocks, read authoritative app data, and perform confirmed writes.

Fields that name another item (`before` / `after`, habit-window anchors) resolve against saved items plus in-flight drafts from this turn. The model supplies those titles. Parsers do not invent the link.

The first model pass exposes final validated tools, so `classify_intent` is optional. The add-sheet sparkles button and the detail "change with AI" row pass `startIntent` / `draft` via `assistantOpenWithInstruction`, so the turn starts at extract. Trace provenance is `entry-add` / `entry-detail`.

## Tools

- `draft_item` creates or changes item settings.
- `draft_setting` handles weather profiles, places, busy times, and topics.
- `draft_batch` handles new lists and pastes.
- `apply_items` changes, snoozes, shows, or deletes a queried set (topic, name, conditions, or the previous list), including different patches for different subsets.
- Read-only tools: `answer_weather`, `answer_schedule`, `answer_items`, `answer_settings`, `lookup_item`.
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

That follow-up is capped at two, and the whole turn at four model calls (six for a multi-item turn). Past the cap, staged work is kept and the model is not asked again. Sibling `tool_calls` all run, including after a no-op, and multiple writes retain separate confirmation actions.

Focusing a saved item for complete, plan, delete, or lookup is pronoun context, not a staged edit, so a model stop still returns those confirmations or the tool answer. A `draft_setting` emitted beside a `prepare_action` read stays staged and does not end the turn, because that setting has not seen the result. The model then calls whichever action the user asked for. It does not invent a task or habit. Repeating the same `draft_setting` finishes a request whose action is the setting itself.

The next user turn sees `recent.items` / `recent.referent` in the envelope, so "that one" can `lookup_item` and "those" repeats the same read with sort and position. Explicit names never fall back to a focused or recent item. Only omitted names and pronouns may use context.

`ask_user` (and classify `unclear`) asks one short question when the request is confusing, at most twice in a row, then stops. A whole-week reschedule, or deleting every saved item with no topic, name, or filter, is `classify_intent` `unsupported`. Changing, snoozing, or deleting a matching set is `apply_items`.
