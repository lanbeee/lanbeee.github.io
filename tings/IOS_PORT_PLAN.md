# Habits — iOS Port Plan

## Two Purposes

1. **Build guide** — step-by-step phases to create the native iOS app.
2. **Refactoring roadmap** — tasks to change the web codebase now so the RN port is minimal effort.

Work on Purpose 2 first. The refactoring tasks are incremental, self-contained improvements. Each one pays off immediately in a cleaner codebase, and makes the eventual RN port trivial.

---

## Goal
Convert the existing vanilla-JS web app into a real native iOS app using React Native + Expo. Ship to the App Store.

## Stack

| Concern | Choice |
|---------|--------|
| Framework | **React Native** (New Architecture: Fabric + TurboModules) |
| Tooling | **Expo Prebuild** — owns `ios/` folder, EAS Build as fallback |
| Language | **TypeScript** |
| State | **Zustand** + `zustand/middleware` persist backed by MMKV |
| Storage | **react-native-mmkv** — ~30× faster than AsyncStorage |
| Navigation | **React Navigation 7** — bottom tabs + native stacks |
| Gestures | **react-native-gesture-handler** + **react-native-reanimated 3** |
| Sheets | **@gorhom/bottom-sheet** v5 |
| Icons | **@react-native-vector-icons/tabler** (same icon set as web) |
| Charts | **react-native-svg** + **victory-native** |
| Calendar | Custom **FlatList** grid (colored cells, month nav) |
| Theming | Custom **ThemeProvider** + `useColorScheme()` |

---

## Purpose 2: Current Codebase Refactoring

The web codebase works today, but it's tightly coupled — data logic is tangled with DOM manipulation, global state is implicit, and there are no clear interfaces. Refactoring it in this order makes the RN port straightforward.

### Why this matters
The RN port's hardest part isn't writing new code — it's cleanly separating what you already have. If `scoring.js` has zero DOM dependencies and `data.js` is a pure storage layer, porting them to TS takes hours. If they're intertwined with event binding and DOM manipulation, it takes days to untangle.

### The golden rule
**Data and logic must have zero awareness of the DOM, browser APIs, or UI state.**

### Refactoring Tasks (in order — do these before starting RN)

#### [x] R1 — Add JSDoc type comments to all data schemas

**Files:** `js/data.js`, `js/config.js`

The RN type definitions (`Habit`, `Settings`, `LogEntry`, etc.) are almost entirely derivable from the current data structures. Make this explicit by adding JSDoc `@typedef` comments that also serve as the source of truth for both the web app and the eventual RN types.

```js
/**
 * @typedef {Object} Habit
 * @property {string} name
 * @property {'keepup'|'reduce'|'zero'} type
 * @property {number|null} target         — rhythm in days; null for zero type
 * @property {Array<number|{ts:number,plan:true}>} logs
 * @property {string} emoji
 * @property {boolean} pinned
 * @property {boolean} sample
 * @property {number|null} snoozedUntil
 * @property {string[]} topics
 * @property {number[]} allowedWeekdays    — 0=Sun…6=Sat; empty=all
 * @property {number[]} allowedMonthDays    — 1-31; empty=all
 * @property {number[]} preferredWeekdays
 * @property {number[]} preferredMonthDays
 * @property {number|null} allowedTimeStart — minutes since midnight
 * @property {number|null} allowedTimeEnd
 * @property {number|null} preferredTimeStart
 * @property {number|null} preferredTimeEnd
 * @property {number} flexibilityDays
 * @property {number} durationMinutes
 * @property {number|null} lastLog
 */

/**
 * @typedef {Object} Settings
 * @property {'balanced'|'build'|'planned'|'todayFirst'|'custom'} preset
 * @property {boolean} showSnoozed
 * @property {boolean} showDurationOnCards
 * @property {boolean} showRepetitionOnCards
 * @property {boolean} showFlexibilityOnCards
 * @property {boolean} showTopicsOnCards
 * @property {boolean} reachAssist
 * @property {string} defaultType
 * @property {number} defaultTarget
 * @property {string[]} topics
 * @property {number[7]} availabilityMinutes
 * @property {Object} availabilityOverrides
 * @property {number} planWeight
 * @property {number} dueWeight
 * @property {number} progressWeight
 * @property {number} trendWeight
 * @property {number} rhythmWeight
 * @property {number} buildWeight
 * @property {number} limitWeight
 * @property {number} stopWeight
 * @property {number} newWeight
 * @property {number} buildRiseAt
 * @property {number} rhythmBias
 * @property {number} planWindowDays
 * @property {string} newBuildMode
 * @property {string} dueMode
 * @property {number} buildLookAheadDays
 * @property {string} limitMode
 * @property {string} stopMode
 */

/** @typedef {number|{ts:number,plan:true}} LogEntry */
```

Add these to the top of `js/data.js`, after the `MAX_TINGS`/`MAX_LOGS` constants. Export nothing yet — just comments. This is a pure documentation step with zero risk.

**Done when:** Every property access in scoring.js and view files traces back to a field in these JSDoc types.

---

#### [x] R2 — Extract pure functions from `scoring.js`

**File:** `js/scoring.js`

`scoring.js` is 546 lines of pure arithmetic — it computes numbers from data structures. It has zero DOM dependencies and should port to TS almost line-for-line. The current issue is it's a flat file with shared mutable state via module-level variables.

Steps:
1. Identify every non-trivial helper function and mark it clearly
2. Ensure no function closes over browser globals (`Date` is fine, `document` is not — currently none do)
3. Group related functions with a section comment: `// ─── Schedule helpers ───`, `// ─── Score components ───`
4. Add JSDoc `@param` and `@returns` to every public function
5. No behavioral changes — this is a documentation + structure refactor only

**RN port note:** These become `src/logic/scoring.ts` verbatim with TypeScript types.

**Done when:** `scoring.js` reads like a library of pure functions with clear contracts. Every function takes data in, returns data out.

---

#### [x] R3 — Extract pure date/schedule helpers from `data.js`

**File:** `js/data.js`

`data.js` is 395 lines but only ~150 are pure: the date utilities (`todayIso`, `dateKey`, `dayStart`, `daysSince`, `dayDistance`) and the schedule helpers (`scheduledDays`, `preferredDays`, `hasDaySchedule`, `isDateEligibleForHabit`, `nextEligibleDate`, `retentionWeight`).

The storage load/save (`load`, `save`, `pruneForStorage`) touches `localStorage` — that's the only browser dependency.

Steps:
1. Move pure functions to a clearly marked section at the top of the file
2. Add JSDoc to each
3. Storage functions (`load`, `save`) remain where they are — they'll be swapped for MMKV in the RN port
4. Add a comment `// PURE — no browser deps` and `// IMPURE — localStorage` to each section

**RN port note:** Pure section becomes `src/data/dates.ts` + `src/data/schedules.ts`. Storage section becomes `src/data/storage.ts` (MMKV).

**Done when:** The top half of `data.js` has no `localStorage`, `document`, or event binding code.

---

#### [x] R4 — Replace string-keyed localStorage with a storage adapter

**Files:** `js/data.js` (load/save)

Currently `load()` does:
```js
return JSON.parse(localStorage.getItem('tings_v2') || 'null');
```

Wrap this behind a `Storage` module with a swappable backend:

```js
// js/storage.js — NEW FILE
const STORAGE_KEY = 'tings_v2';

export const Storage = {
  read() {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
  },
  write(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  },
  // future: replace with MMKV in RN
};
```

Then in `js/data.js`, replace `localStorage.getItem/setItem` calls with `Storage.read/write`.

**RN port note:** Only `storage.js` needs updating — it becomes a 5-line MMKV wrapper. Every `import { Storage } from './storage'` across the codebase works unchanged.

**Done when:** `js/data.js` has zero `localStorage` calls. `js/storage.js` exists and is imported by `data.js`.

---

#### [x] R5 — Extract CSS design tokens to a single token block

**File:** `styles.css`

Your CSS already uses custom properties (`--bg`, `--text`, `--teal-bg`, etc.) — that's excellent. The problem is they're spread across the full `:root` block and `prefers-color-scheme` overrides.

Steps:
1. Copy the full token set (both light and dark values) into a comment block at the top of `styles.css` — this is the source of truth for the RN theme
2. Group tokens semantically: `// Color primitives`, `// Semantic colors`, `// Component tokens`
3. Add a `// Design token source — keep in sync with RN theme/tokens.ts` comment

The token list from the current CSS:

```css
/* DESIGN TOKENS — sync with src/theme/tokens.ts in RN
   Light:  --bg:#f5f4f0, --bg2:#ffffff, --bg3:#e8e7e2
           --text:#1a1a1a, --text2:#6b6a65, --text3:#9e9d98
           --border:rgba(0,0,0,0.11), --border2:rgba(0,0,0,0.2)
   Dark:   --bg:#1c1c1e, --bg2:#2c2c2e, --bg3:#3a3a3c
           --text:#f2f2f7, --text2:#aeaeb2, --text3:#6e6e73
           --border:rgba(255,255,255,0.09), --border2:rgba(255,255,255,0.18)
   Semantic (light): --teal-bg:#E1F5EE --teal-icon:#0F6E56 --teal-text:#085041
                      --amber-bg:#FAEEDA --amber-icon:#BA7517 --amber-text:#633806
                      --red-bg:#FCEBEB --red-icon:#A32D2D --red-text:#791F1F
                      --purple-bg:#EEEDFE --purple-icon:#534AB7 --purple-text:#3C3489
                      --blue-bg:#E6F2FA --blue-icon:#176B91 --blue-text:#0B4E6E
                      --green-bg:#E8F5E9 --green-icon:#2E7D32 --green-text:#1B5E20
   Typography: --font-stack: system-ui, -apple-system, BlinkMacSystemFont...
               --text-xs:11px, --text-sm:13px, --text-base:15px, --text-lg:17px...
               --radius-sm:8px, --radius-md:12px, --radius-lg:16px, --radius-full:9999px
   Spacing:   --space-1:4px --space-2:8px --space-3:12px --space-4:16px...
*/
```

**RN port note:** These tokens become `src/theme/tokens.ts` — a plain object exported as `lightTokens` and `darkTokens`. The RN `StyleSheet.create()` call uses these directly.

**Done when:** A comment block at the top of `styles.css` contains the full token inventory, verified accurate against the current CSS values.

---

#### [x] R6 — Decouple UI event binding from state mutation

**Files:** `js/main.js`, `js/list-view.js`, `js/detail-view.js`, etc.

Currently, UI files read state via global variables (`window.tings`, `sortSettings`) and write state by directly manipulating the DOM. This creates a tight loop: event → DOM mutation → re-render → DOM mutation.

For RN, this needs to be: event → state update → re-render.

Steps:
1. In each view file, identify every function that writes to the DOM (render functions)
2. Add a comment `// RENDER — pure DOM write, no state` before each
3. Identify every function that reads global state and mutates data
4. Add a comment `// EVENT HANDLER — reads state, writes state` before each
5. No code changes yet — just marking the boundaries

The goal is a mental model where the render functions are a pure function: `render(state) → DOM`. When that property holds, moving to React is `render(state) → JSX`.

**RN port note:** Render functions map directly to React functional components. Event handlers map to `onPress`/`onChange` handlers. The state object maps to Zustand store.

**Done when:** Every function in the view files is clearly marked as either a "render" function or an "event handler" — not both.

---

#### [ ] R7 — Add a `src/` mirror of the pure logic (optional but recommended)

This is a forward-looking step: create a parallel pure-JS library that mirrors the web app's data and logic, with zero browser dependencies.

```
src-pure/
├── types.js         — JSDoc typedefs (same as R1 output)
├── dates.js          — pure date helpers (from data.js, R3)
├── schedules.js      — pure schedule helpers (from data.js, R3)
├── scoring.js        — pure scoring (from scoring.js, R2)
├── emoji-suggest.js  — pure keyword map (from emoji-suggest.js)
└── storage.js        — storage adapter interface (from R4)
```

The web app continues to use `js/` files unchanged. But `src-pure/` is kept in sync manually — it contains only the parts that will become `src/logic/` and `src/data/` in the RN app.

**Why optional:** R1–R6 already make the port straightforward. `src-pure/` is belt-and-suspenders — useful if a lot of time passes between the last web update and the RN port, or if multiple people touch the codebase.

**Done when:** `src-pure/` exists with passing tests, and every function in `src-pure/` has a corresponding test in `__tests__/`.

---

### Refactoring Completion Checklist

Before starting Phase 1 of the RN build, verify:

- [x] R1: `js/data.js` has `@typedef {Habit}` and `@typedef {Settings}` matching every field actually used
- [x] R2: `js/scoring.js` — every function has JSDoc; no `document`, `window`, or `localStorage` references
- [x] R3: `js/data.js` — top section has zero `localStorage`; pure helpers are clearly marked
- [x] R4: `js/storage.js` exists; `js/data.js` imports it; zero `localStorage` calls remain in `data.js`
- [x] R5: `styles.css` top comment block lists every CSS custom property with its light/dark value
- [x] R6: Every render function in every view file is annotated `// RENDER`; every event handler annotated `// EVENT HANDLER`
- [ ] R7 (optional): `src-pure/` mirrors the logic layer with passing tests

---

## Purpose 1: Build Guide

### Keep vs. Rewrite (from current codebase)

| What | Action |
|------|--------|
| `js/config.js` | Port to TS, keep logic |
| `js/data.js` (pure helpers) | Port to TS → `src/data/` |
| `js/data.js` (storage) | Replace `localStorage` → MMKV in `src/data/storage.ts` |
| `js/scoring.js` | Port to TS verbatim → `src/logic/scoring.ts` |
| `js/emoji-suggest.js` | Port to TS → `src/utils/emoji-suggest.ts` |
| `js/storage.js` (new) | Replace `localStorage` → MMKV → 5-line change |
| `styles.css` | Port tokens → `src/theme/tokens.ts`; UI → `StyleSheet.create()` |
| All view files | Full rewrite in React Native |
| `js/main.js` | Replaced by React state/effects |
| `js/shell-ui.js` | Replaced by `@gorhom/bottom-sheet` |
| `js/settings.js` | Rewrite as form screens |
| `js/viewport.js` | Drop — use `useWindowDimensions` |
| `js/sw.js`, `manifest.json`, PWA meta | Delete |
| Tabler icons CDN | Replace with `@react-native-vector-icons/tabler` |

### RN App Structure

```
HabitsApp/
├── app.json
├── src/
│   ├── components/   (SwipeableCard, CrownDial, ChipRow, BarGraph, Ring, SegmentedControl, CalendarGrid, Toast)
│   ├── screens/      (HomeScreen, DetailScreen, OverviewScreen, SettingsScreen)
│   ├── navigation/   (AppNavigator, BottomTabs, stacks)
│   ├── store/        (Zustand: habitsStore, settingsStore, uiStore)
│   ├── data/         (storage.ts — MMKV, dates.ts, schedules.ts)
│   ├── logic/        (scoring.ts — verbatim from scoring.js)
│   ├── theme/        (tokens.ts — from CSS custom properties)
│   ├── types/        (Habit, Settings, LogEntry — from JSDoc)
│   ├── hooks/        (useHabit, useSortedHabits, useCalendar)
│   └── utils/        (emoji-suggest.ts, dates.ts)
└── assets/
```

### Phases

| # | Phase | Deliverable | Est. (FT) | Depends |
|---|-------|-------------|-----------|---------|
| 0 | **Refactor web app** | All R1–R7 tasks complete | 1-2 wk | None |
| 1 | **Setup** | Xcode, CocoaPods, Watchman, simulator verified | 2h | None |
| 2 | **Bootstrap** | `create-expo-app`, `expo prebuild`, deps installed, app on sim | 2h | 1 |
| 3 | **Data + Logic** | `src/data/`, `src/logic/`, `src/types/` from refactored web code | 4-6h | 0, 2 |
| 4 | **Theme + Nav** | ThemeProvider (light/dark), bottom-tabs + stacks, screens scaffolded | 4-6h | 3 |
| 5 | **MVP** | Home list, tap to log, detail screen (ring + graph), add-habit sheet, basic settings | 1-2 wk | 4 |
| 6 | **Advanced** | SwipeableCard, CrownDial, CalendarGrid, Overview, Sort Lab, haptics, icon + splash | 1 wk | 5 |
| 7 | **Ship** | TestFlight, App Store release | 3-5 d | 6 |

**Phase 0 (refactoring) is the critical path.** Doing it right means Phases 3–5 are copy-paste-and-type, not archaeology.

**Total to MVP:** ~3 weeks FT / ~7 weeks part-time.

### MVP Scope (Phase 5)

| In | Out |
|----|-----|
| Home list with habit cards | Swipe actions (pin/snooze/delete) |
| Tap habit card to log | Crown dial animation |
| Tap and hold for detail | Calendar overview screen |
| Add-habit bottom sheet | Sort lab |
| Detail: ring, stats row, bar graph | Fine-tune priority weights |
| Settings: preset selector, toggles | Sample habit builder |
| Empty state, search bar | Topics management |

### High-Risk Components (spike early in Phase 5)

1. **CrownDial** — web uses HTML canvas. RN needs SVG arcs + circular PanGesture via Reanimated.
2. **SwipeableCard** — multi-action swipe with forgiving tap-vs-drag discrimination.
3. **CalendarGrid** — colored cells, month nav, tap to drill into day.
4. **Sheet stack** — nested sheets require a state machine for correct open/close order.

### Out of Scope (Future)

- Push notifications / reminders
- iCloud sync
- Widgets (Lock Screen / Home Screen)
- Siri / Shortcuts
- Apple Watch
- PWA data migration (fresh start)
