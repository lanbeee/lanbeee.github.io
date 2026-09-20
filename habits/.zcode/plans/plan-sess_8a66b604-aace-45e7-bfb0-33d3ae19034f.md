# Context-aware assistant entry points: skip classify by construction

The entry point already knows the intent, so the harness starts straight at `extract` — one LLM call instead of two, deterministically, with no model-whim involved. Provably-simple instructions can even take the existing local fast path (0 calls). This is the reliable classify-skip; prompt-based merging from the earlier plan is dropped.

## How it works today (anchors)

- `runAssistantTurn(text, opts)`: `opts.draft` seeds `session.draft` (`assistant-harness.js:847`); a named draft makes the turn **start at `step='extract'`** with the "changing currentDraft" steer (`:912-920`) — the edit flow's mechanics already exist, nothing outside assistant-ui.js uses them yet.
- `assistant-ui.js`: `openAssistantSheet()` (:140), `sendAssistantMessage(text)` (:520), `syncAssistantChrome()` (:22) + `body.assistant-on` = the settings-visibility pattern; `assistantAfterSave` (:591) shows the close-then-open sheet pattern (assistant z-index is below detail's 110).
- Lazy bundle: callers outside the bundle must go through `window.tingsLoadAssistant().then(...)` (assistant-loader.js:65).
- Add sheet: `#ting-message` inside `.name-icon-row` (`index.html:126-129`, pattern to copy: `#ting-emoji-preview`), kind in global `selectedType` (`'keepup'|'task'`), handlers in `main-boot.js`.
- Detail sheet: `.habit-actions` rows (`index.html:562-603`, e.g. `#detail-snooze` wired `main-boot.js:1532`), focused item = global `detailIdx` → `load()[detailIdx]`.

## Changes

**1. Harness — `startIntent` (assistant-harness.js)**
- `runAssistantTurn` accepts `opts.startIntent` (`'create_habit'|'create_task'|'create_setting'`). When set and no focused draft: skip classify → `step='extract'` + `assistantDraftItemSteerText(startIntent, factsHint)`. Parser still runs; facts trusted per the existing residue audit only. Trace gets `t:'path', via:'entry-add'` / `via:'entry-detail'` so provenance stays auditable.

**2. assistant-ui.js — `assistantOpenWithInstruction(text, {intent, draft})`**
- Fresh session; seed `draft` (edit) or `entryIntent` (add); close the source sheet; open the assistant sheet.
- **Add entry**: run the normal local-path gates first — if the parse is residue-free and a local create handler accepts, answer instantly via the fast path (with the standard "use AI instead" button); otherwise one LLM call at `extract`.
- **Detail entry**: if text is empty, render a local say-bubble ("Editing ⟨name⟩ — tell me what to change.") and focus the input — **no LLM call** until the user types. Typed messages go straight to `extract` scoped to `currentDraft`.
- Export as `window.assistantOpenWithInstruction`.

**3. Add-sheet AI button**
- `#ting-ask-ai` in `.name-icon-row` (`index.html`), hidden unless `body.assistant-on` (CSS mirrors `css/assistant.css:2-3`); `syncAssistantChrome()` toggles it.
- Handler in `main-boot.js` (near the `#do-save` wiring): empty text → focus `#ting-message`; else `tingsLoadAssistant().then(() => assistantOpenWithInstruction(text, {intent: selectedType === 'task' ? 'create_task' : 'create_habit'}))`. `closeSheet('add-sheet')` only (no `cancelAdd`) so typed text survives if the user dismisses the assistant.
- After save, existing `assistantAfterSave` flow takes over (opens detail schedule).

**4. Detail chat button**
- `#detail-ask-ai` row in `.habit-actions` (`index.html:562-603`), same visibility gating; handler near `main-boot.js:1532`: `assistantOpenWithInstruction('', {draft: load()[detailIdx]})`.
- Buttons in both places only render when the local assistant setting is on (same pattern as `#open-assistant`).

**5. Telemetry (small, needed to verify the win)**
- Wall-clock ms per LLM call + Ollama `prompt_eval_count`/`eval_count` into `t:'model'` trace events; `totalMs` + entry path on `t:'done'`; one debug-bubble line per call. No other prompt/envelope changes.

**6. Docs/tests/sw**
- New `tests/assistant-entry-points-test.js` (TSV `ui`/`once`, scripted-`complete` pattern): `opts.draft` → first call is `extract` (no `classify_intent` in tools), `opts.startIntent` → create steer + single scripted call finishes the turn with `llmCalls===1`, entry fast path still routes trivial adds locally with "use AI instead", empty-text detail entry makes zero LLM calls, buttons hidden when assistant off.
- DOCUMENTATION.md: Local assistant section + add/detail field entries; AGENTS.md assistant line; **sw.js `tings-v408` → `v409`** (gotcha #2).

## Deferred follow-ups (not in this change)
Adaptive thinking tiers / effort setting, model warm-up ping on sheet open, same entry pattern for settings sheets (weather profile, place, busy time) — the `startIntent` hook makes those trivial later.

## Verification
`./run-tests.sh ui` (and `--test '*assistant*'`); manual: add-sheet AI with a simple and a gnarly instruction; detail chat on a habit; assistant off → buttons hidden.