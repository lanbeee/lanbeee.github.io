# Search quality rework — settings + detail (Needle-safe)

## 1. Compatibility contract (verified anchors)
Preserve signatures + navigation behavior of `syncDetailSearchAssistant`, `renderDetailSearch`, `setDetailSearchOpen`, `revealDetailSearchEntry`, `openDetailAssistant` (assistant-ui.js:49-52, :1918; detail-view-search.js:117-168). Preserve all `#detail-search-*` / `#settings-search-*` ids, settings section body ids, collapse-head `aria-controls`, the tune-dirty guard, item identity checks, assistant-aware empty state, Enter→first-result (or Ask when no match), arrow/Escape/scroll-restoration, prerequisite-reveal toasts. Typing/highlighting/navigating never saves settings or invokes inference.

## 2. Settings coverage first — js/settings-search.js
- Entries become `{target, label, path, labelN, aliasN, pathN, descN, order}`.
- Alias resolution per entry: existing keys (`target.id`, `data-setting-toggle`, collapse-head `aria-controls`) **plus** `label[for]` association (a `label[for="x"]` entry inherits `SETTINGS_SEARCH_ALIASES['x']`) **plus** a small explicit mapping for unassociated heading spans, keyed by normalized label text (verified pattern: index.html:1127 "delete completed tasks after" is a bare span; `label[for]` exists at :196, :558, :562).
- Synonyms attach to the narrowest destination (backup→export action, font→font size control). Section body aliases stay section-scoped (current behavior).
- Index only app-authored metadata: no input values, no saved place/topic/profile names, no addresses (privacy assert stays: "address"→locations, never "Photon").
- Keep DOM-driven inclusion rules (minimal mode, hidden, platform).

## 3. Shared primitives — js/detail-view-search.js (loads first; no new files)
- Keep `detailSearchNormalize`.
- Replace the 2-pointer fuzzy loop with a bounded one-edit matcher supporting insertion, deletion, substitution, and adjacent transposition (bounded Damerau-Levenshtein ≤1).
- Shared conservative plural variants (original token always retained).
- Detail: substring matching + fuzzy threshold ≥5 unchanged. Settings: exact-word / prefix ≥5 / fuzzy ≥7 rules unchanged, but its fuzzy path calls the pure edit-distance helper **directly** — not `detailSearchTokenMatch` — so it does not inherit the permissive substring fast-path.
- All query tokens required. No stop-word removal, no unrestricted substring for settings, no semantic search.

## 4. Ranking on matched evidence
- Matcher returns the matched field + kind; ranking and highlighting use the same decision.
- Order: whole-label equality → exact/prefix label → exact curated alias → typo-in-label → weaker alias → path/description. Exact alias outranks fuzzy label coincidence. Each token contributes its best match once (no description/repetition inflation). Deterministic ties.
- Empty query preserves current browse order (settings alphabetical; detail catalog/render order). No result cap.

## 5. Detail dynamic-row noise fix — detail-view-search.js:69-88
- Schedule links: selected partner (`option:checked`) + selected relationship only.
- Schedule options: selected location + applicable row labels only.
- Link/call rows: displayed name + current link value (input `.value`, which `textContent` misses).
- Exclude unselected options and rows with a hidden ancestor (template/editor rows are currently indexed — `add()` never checks row-level hidden).
- `ITEM_DETAIL_SEARCH_FIELDS` stays untouched; any new aliases are search-local only (shared-catalog alias changes would be a separate Needle-affecting change).

## 6. Result feedback
- Highlights: text nodes + `<mark>`, never innerHTML; label/path only; same normalization + matching rules; accent-safe by comparing normalized whole words and wrapping the original word node (no NFKD offset math); typo matches marked as whole words; no marking when the match came only from an alias; accessible names and status messages preserved.
- Subtle shared `mark` style in css/detail.css, readable across themes.
- IME: skip render/activation during composition in both searches; render on `compositionend`. Settings Enter/arrow guards + defensive Escape null checks (settings-search.js:222).

## 7. Caching: deferred
- Normalize fields once per entry build, but keep live index rebuilding this change (indexes are small; stale targets are the worse regression; detail-view-sheet.js:211-212 re-renders the same item with a preserved query). No cache, no invalidation surface.

## 8. Tests — extend the two existing classified files
Table-driven cases in settings-search-test.js + detail-search-navigation-test.js:
- Destination + first result (incl. weather → weather guidance); alias on individual controls incl. a `label[for]`-owned key.
- Typos: insertion, deletion, substitution, transposition; plurals, case, accents.
- Existing night/mute/ai/address precision assertions unchanged.
- Selected vs unselected dynamic-row content; hidden template rows excluded.
- Safe highlights, preserved accessible names, script-tag query still 0 results.
- Explicit privacy fixtures: distinctive saved place name + address never surface.
- Empty-query browsing order + persisted data unchanged.
- IME completion + Enter behavior; Needle instruction >120 chars reaches Ask in full.
- Keep all geometry/navigation/duraton/count>40 assertions.

## 9. Verify and ship
- Focused: `node tests/settings-search-test.js`, `node tests/detail-search-navigation-test.js`.
- Needle regressions: assistant-detail-entry, assistant-entry-points, assistant-summary-navigation, assistant-focus, assistant-minimal-edit, assistant-reminder-options.
- `./run-tests.sh ui`. No shared-catalog changes → field-retrieval suites unaffected (will re-run if that changes).
- Preserve script order + precache paths (no new files). Bump sw.js `CACHE` once for the JS change (v827 → v828; re-check current value at ship).

**Files:** js/detail-view-search.js, js/settings-search.js, css/detail.css, sw.js, tests/settings-search-test.js, tests/detail-search-navigation-test.js. No index.html change (detail input keeps `maxlength="12000"` — it doubles as the Ask Needle instruction box; the 120-char cap stays local to query normalization and the full value passes to Needle at detail-view-search.js:358).

**Out of scope:** planner behavior, assistant chat's settings browser, value search in settings, result grouping, combobox redesign.