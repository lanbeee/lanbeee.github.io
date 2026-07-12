# Locations Expansion Plan

## Purpose

Tings already has **topics** — free-text tags that power search, filtering, and
activity reporting without ever touching the ranking math. Topics are abstract:
"relationships", "health", "deep work". This plan adds **locations** — the
physical, spatial analog.

A location is a real place with a latitude/longitude: "Home", "Office",
"Gym", "Mom's house". Each habit/task/event may declare:

- **one allowed location** (it can only happen there), **multiple allowed
  locations** (any of these), and optionally a **preferred location**; or
- **no location constraint at all** (the default — it can happen anywhere,
  like every item behaves today).

The part that makes locations *different* from topics: **moving between
locations is not instantaneous.** Two habits scheduled on the Today agenda are
not interchangeable if one is at the gym and the other is at the office — there
is a real travel cost between them. This plan models that cost, caches it so we
never pay for it twice, and lets the Today agenda sequence the day to minimise
travel rather than treating every item as location-agnostic.

The home list ranking is **deliberately left alone** (locations are filter/
search only there, exactly like topics). The one surface where location changes
behaviour is the Today agenda — that is where "travel isn't free" actually
matters day-to-day.

---

## Design principles

1. **Locations are a first-class registry, not free-text.** Unlike topics
   (which are loose strings stored inline on each habit), a location has
   structure: an id, a name, and a lat/lng at minimum. So locations live in a
   **master registry** (a new settings field, same shape pattern as
   `sortSettings.topics` but richer), and habits reference locations by **id**,
   not by name. This is what makes travel-time caching possible — you can only
   compute the distance between two stable, identifiable points.
2. **Reuse the topic UX vocabulary.** The chip-row picker, the per-view filter
   bar, the settings-manager add/remove list, and the `showXOnCards` toggle are
   all proven patterns. Locations copy them almost verbatim — one new chip row
   in the add sheet, one in the detail sheet, one filter bar, one settings
   section. No new interaction paradigm.
3. **One provider interface, three backends, graceful degradation.** Travel
   time is fetched from **OSM (OSRM) by default** (no key, no cost), falls back
   to **Google Maps Directions** if the app owner configures an API key, and
   always has a **pure haversine** floor when the network is unavailable or the
   provider fails. Every result is cached so the same pair is never fetched
   twice. The app never *blocks* on a network call — if nothing is cached and
   the network is slow, the agenda sequences on haversine and silently refines
   once a real result lands.
4. **Stay anti-rigid.** The temptation with "the app knows where you are" is to
   turn the home list into a location-graded feed. Resist it. Only the Today
   agenda — which is already the one surface that sequences items through time
   — gets location-aware ordering. Everything else (home ranking, attention
   score, reminders) treats locations as a tag, not a weight.
5. **Privacy: on-device, opt-in geolocation.** The app's core promise is that
   habit data never leaves the device. Geolocation is **opt-in**, requested
   from a user gesture, used only to pick which saved location you are nearest
   to (your raw coordinates are never stored or transmitted — only the matched
   location id). Map API calls carry only coordinate pairs, never habit names.
   Matches the existing `pushDetailed` privacy posture.
6. **Web first, native later.** Matches the `EGO's_EXPANSION.md` / iOS port
   plan convention: this plan only touches the web codebase, and the new
   `locations.js` module is annotated RENDER/HANDLER/PURE from the start per
   R6 of the iOS port plan.

---

## New data shapes

### Location registry entry

```js
/**
 * @typedef {Object} Location
 * @property {string} id            — stable opaque id (crypto.randomUUID()), never shown
 * @property {string} name          — display name ("Home"), max 48 chars
 * @property {string} [address]     — optional human address ("12 Main St"), max 120 chars
 * @property {number}  lat          — WGS84 latitude, -90..90
 * @property {number}  lng          — WGS84 longitude, -180..180
 * @property {number}  [radiusM]    — optional "you are here" geofence radius in metres (default 75)
 * @property {string}  [emoji]      — optional pin emoji, mirrors the habit emoji convention
 *
 * @property {number|null} [allowedTimeStart] — minutes-from-midnight, location open window start (null = no restriction / 24h)
 * @property {number|null} [allowedTimeEnd]   — minutes-from-midnight, location open window end (null = no restriction; end <= start means overnight wrap, e.g. 1380->300)
 * @property {number|null} [preferredTimeStart] — soft hint: best arrival-time start (null = none)
 * @property {number|null} [preferredTimeEnd]   — soft hint: best arrival-time end (null = none)
 * @property {number[]}  [closedDays]  — weekday numbers (0=Sun..6=Sat) when the location is entirely closed, default []
 * @property {Object<string,{start:number,end:number}|null>} [hoursByDay] — per-weekday override map {0..6: {start,end} | null(closed)}; absent day falls back to allowedTimeStart/End
 */
```

- Stored as `sortSettings.locations` — an array of these, max **32** entries
  (cap mirrors `MAX_LOGS`/`MAX_TINGS` philosophy; enough for personal use,
  small enough to keep the travel-time matrix — 32² = 1024 edges — bounded).
- No creation timestamp needed; insertion order is the display order, same as
  topics.
- `radiusM` governs geolocation matching: if your live position is within
  `radiusM` metres of a location's lat/lng, you are "at" that location. Default
  75 m covers most room-level / building-level resolution without false-matching
  a neighbour.
- **The hours fields are the key addition over a pure lat/lng pin.** They reuse
  the *exact* `allowedTimeStart`/`allowedTimeEnd`/`preferredTimeStart`/
  `preferredTimeEnd` encoding already used on habits (minutes-from-midnight,
  same overnight-wrap rule), so every existing window helper in `today-view.js`
  (`fillTimeWindow`, `hasTimeWindow`, `windowStillDoableToday`) generalises with
  zero new concepts. See [Location time windows](#location-time-windows).

#### Location time windows

A location's hours constrain **every habit done there**. This is the spatial
analog of a habit's own time window — and the two *compose by intersection*.

The hours model is layered, covering real-world business hours with minimal
data entry:

1. **`allowedTimeStart`/`allowedTimeEnd`** — the default open window, applies to
   every day. `null`/absent means 24h (the default for places like "Home" that
   have no hours). This is the 90% case: "Gym is 6am–10pm."
2. **`closedDays`** — weekdays when the location is shut entirely (e.g. `[0]`
   for "closed Sundays"). Cheap to type, mirrors the inverted sense of the
   habit-level `allowedWeekdays` already in the schema.
3. **`hoursByDay`** — optional per-weekday overrides for days that differ from
   the default (e.g. `{6:{start:720,end:1200}}` for "Saturday 12pm–8pm"). A
   `null` entry means "closed that day." Absent days fall back to the default
   window. Power-user field — the common case leaves it empty.

Resolution order for a given weekday: `hoursByDay[day]` (if present) → else
`closedDays.includes(day) ? closed : allowedTimeStart/End`. A location with no
hours fields at all resolves to 24h every day — the default, so "Home" and
"Office desk" cost nothing to set up.

**`preferredTimeStart`/`preferredTimeEnd`** is a soft hint (e.g. "café is best
2–4pm off-peak") — never closes a location, only nudges placement, identical in
spirit to `preferredTimeStart` on a habit.

**Effective window for a habit at a location** is the *intersection* of the
habit's own window and the location's resolved window for that day. Returns a
merged list of `{start,end}` minute-intervals (empty list = not placeable here
today — e.g. no overlap, or the location is closed):

```js
// PURE: minutes windows are [start, end); end <= start means overnight wrap.
// Returns a merged interval list [] on the same day-base. Empty = the habit
// cannot be done at this location on this weekday at all.
function effectiveLocationWindow(h, loc, weekday){
  const locWin = loc ? resolveLocationWindow(loc, weekday) : {start:0,end:1440}; // null loc = 24h
  if(!locWin)return [];                               // closed today
  if(!hasTimeWindow(h))return unwrapMinuteWindow(locWin); // habit unconstrained -> loc wins
  return intersectWindows({start:h.allowedTimeStart, end:h.allowedTimeEnd}, locWin);
}
```

The interval-list return shape (rather than a single `{start,end}`) is what
keeps overnight-wrap intersections correct — an overnight location ∩ a daytime
habit can yield two disjoint intervals, and the agenda (Phase 6) needs to see
both. `intersectWindows` + `unwrapMinuteWindow` + `mergeMinuteIntervals` are
the three pure primitives backing it.

This helper is what the Today agenda consults instead of the habit's window
alone, and is what `windowStillDoableToday()` calls into so the home list's
"today vs overdue" categorisation stays in sync with the agenda (a habit whose
only open location just closed is genuinely overdue, not "today").

### Habit location fields

```js
/**
 * @typedef {Object} LocationFields — optional, on every Habit regardless of type
 * @property {string[]} locationIds      — allowed location ids (empty = anywhere, the default)
 * @property {string|null} preferredLocationId — the preferred one when multiple are allowed (optional)
 */
```

- `locationIds: []` is the **default and means "anywhere"** — this is how the
  feature stays invisible for users who don't care about locations, and how
  every existing habit loads with zero behaviour change. This directly mirrors
  the user's "by default a task can be at any location" requirement.
- The array is capped at the registry length (you can't reference a location
  that doesn't exist — `normalizeLocations()` strips dangling ids, the same way
  `removeTopic()` strips a deleted topic from every habit).
- `preferredLocationId` is `null` unless the user explicitly picks one, and must
  be a member of `locationIds` (normalized away otherwise). When the Today
  agenda has freedom to choose among a habit's allowed locations, it prefers
  this one — same "soft hint, not a hard constraint" idea as
  `preferredTimeStart` in `today-view.js`.

### Travel-time edge (cached)

```js
/**
 * @typedef {Object} TravelEdge
 * @property {string} a               — location id (lexically smaller of the pair)
 * @property {string} b               — location id (lexically larger of the pair)
 * @property {number} seconds         — travel time in seconds (both directions share one edge; routing is assumed symmetric)
 * @property {number} metres          — travel distance in metres
 * @property {string} provider        — 'osrm' | 'google' | 'haversine'
 * @property {number} fetchedAt       — ms timestamp of the fetch
 */
```

- Stored as `sortSettings.travel` — an object keyed by `"${a}|${b}"` (the two
  ids joined, lexically sorted so A→B and B→A hit the same key). Object map,
  not array: O(1) lookup, trivially serialisable, no dedupe needed.
- Edges are **undirected** in v1 — we cache one travel time per pair and use it
  for both directions. Routing engines occasionally return asymmetric times
  (one-way streets), but for a habits app the difference is noise. Flagged in
  [Open design decisions](#open-design-decisions).
- **TTL: 30 days.** Roads don't move. A `fetchedAt` older than 30 days is
  re-fetched lazily on next access (stale-while-revalidate: the old value is
  used immediately, a refresh fires in the background). Constant
  `TRAVEL_TTL_MS = 30 * 86400000` in `config.js`.
- The registry also carries a **`haversineMetres`** value computed once at
  registry-edit time (pure, deterministic, free) so a fallback distance is
  always available instantly even before any network edge exists.

---

## Travel-time provider layer — `js/locations.js`

This is the one genuinely new subsystem (topics had no analog), so it gets its
own module. Loaded **immediately after `data.js`** in `index.html` (it consumes
`sortSettings`, `saveSortSettings`, `cleanLocationId`, `normalizeTravelMode`
from `data.js`; data.js itself stays self-contained and never calls into
locations.js). Annotated PURE/ASYNC/IMPURE per the iOS port plan convention.

### Provider interface (implemented in Phase 1)

```js
// PURE: great-circle distance in metres between two lat/lng points. No deps.
function haversineMetres(aLat, aLng, bLat, bLng){ ... }

// PURE: approximate travel *seconds* from a haversine distance, using a
// mode-dependent average speed (walk 5 km/h, bike 15, drive 40, transit 20).
// Used as the instant floor before any network result lands and as the
// permanent fallback when the network is unavailable.
function haversineTravelSeconds(metres, mode){ ... }

// PURE: edgeKey(aId,bId) — lexically-ordered "a|b" so A→B === B→A.
// PURE: haversineEdge(locA,locB,mode) — a synthetic non-cached edge (fetchedAt:0).
// PURE: edgeIsFresh(edge) — within TRAVEL_TTL_MS.

// ASYNC: resolve a single edge {seconds, metres, provider} for a pair of
// locations. Driving tries OSRM first (Google slot reserved for Phase 2);
// haversine is the floor on any failure. Bounded by TRAVEL_FETCH_TIMEOUT_MS.
async function fetchEdge(locA, locB, mode){ ... }

// ASYNC: fetch + write one edge into sortSettings.travel, fire onTravelRefresh,
// and schedule a debounced persistTravelDebounced() (2s coalescing window).
async function refreshEdge(locA, locB, mode){ ... }

// SYNC (the public read path used by the agenda): best-available edge right now.
//   fresh cache  → return cached
//   stale cache  → kick background refreshEdge, return the stale value
//   no cache     → kick background refreshEdge, return a haversine floor
// Never throws, never blocks, never returns null. Sync (not async) so it drops
// directly into the synchronous render path (buildTodayTimeline); refreshed
// edges land on the next render via the onTravelRefresh hook the view wires up.
function travelBetween(locA, locB, mode){ ... }

// IMPURE: flushTravelCache() — drain any pending debounced write immediately
// (called before backup export / teardown so the cache on disk matches memory).
// IMPURE: persistTravelDebounced() — coalesce many refreshEdge calls into one
// saveSortSettings() so warming a full matrix is one localStorage write.
// HOOK: onTravelRefresh(edge) — set by the view layer to trigger re-render.
```

> **Refinement vs original plan:** `travelBetween` is **sync**, not async. The
> agenda's render path (`buildTodayTimeline`) is fully synchronous, and a sync
> read that returns cached-or-haversine and fire-and-forgets the background
> refresh genuinely never blocks — so it drops straight in without async
> plumbing. `refreshEdge` stays async for explicit cache-warming.

### OSRM (default provider)

- Endpoint: `https://router.project-osrm.org/route/v1/driving/{lng},{lat};{lng},{lat}?overview=false`
  (public demo server, no key). Walking mode uses the same server with
  `?annotations=false` and a walked-distance heuristic, since the demo server
  only routes driving — see [Open design decisions](#open-design-decisions) for
  a self-hosted/alternative walking option.
- Response shape used: `routes[0].duration` (seconds), `routes[0].distance`
  (metres). One row, no alternatives.
- **Rate limit etiquette:** the public OSRM server has no published quota but
  asks for reasonable use. With a max 32-location registry (1024 edges),
  populating the full matrix once is a one-time cost; day-to-day only new/
  edited locations trigger fetches. Edges are cached for 30 days, so steady-
  state network use is near zero.

### Google Maps Directions (optional provider)

- Enabled by `MAPS_API_KEY` in `config.js` (the `YOUR_`-placeholder guard
  pattern, identical to `VAPID_PUBLIC_KEY` / `pushConfigured()`).
- Endpoint: `https://maps.googleapis.com/maps/api/directions/json?origin=...&destination=...&mode=...&key=${MAPS_API_KEY}`
- Response: `routes[0].legs[0].duration.value` (seconds),
  `routes[0].legs[0].distance.value` (metres).
- Used **only** when configured **and** OSRM fails — Google is the more
  accurate but paid option, and we default to free. Travel mode is richer here
  (driving/walking/bicycling/transit all supported by the API).

### Haversine floor

- `haversineMetres()` is pure, deterministic, offline, instant. It is *always*
  available — for a brand-new pair before any fetch has landed, during a
  network failure, in airplane mode, or for a user who never grants network.
- The haversine **distance** is accurate; the haversine **time** is an
  underestimate (straight-line / avg-speed). The agenda treats it as "good
  enough to sequence by, refine later" — exactly the stale-while-revalidate
  posture.

### Geocoding (address → lat/lng)

- Used only in the settings-manager "add location" flow, to turn a typed
  address ("12 Main St, Springfield") into lat/lng.
- **Nominatim** (`https://nominatim.openstreetmap.org/search?q=...&format=json&limit=5`)
  by default — free, no key, usage policy requires a valid HTTP `Referer` /
  `User-Agent` and ≤ 1 req/sec (we fire one on submit, never in a loop).
- Google Geocoding API as the optional fallback when `MAPS_API_KEY` is set.
- Results shown as a pick list (the user confirms the right match before the
  location is created) — never silently auto-pick the first result, because
  geocoding ambiguity is common and a wrong pin silently corrupts every edge.

---

## Data layer changes — `data.js`

### Typedef

Extend the `Habit` typedef block (lines 20–49) with `LocationFields`, and the
`Settings` typedef (lines 51–98) with `locations`, `travel`, plus the
`showLocationOnCards` and agenda toggles.

### `normalize()` additions (in the `h = {...}` literal, before `lastLog`)

```js
locationIds: normalizeLocationIds(raw.locationIds),
preferredLocationId: normalizePreferredLocation(raw.preferredLocationId, raw.locationIds),
```

Both default such that an old record (no location fields) loads as
`locationIds: []` / `preferredLocationId: null` — i.e. "anywhere", zero
behaviour change.

### New pure helpers (alongside `normalizeTopics` at lines 393–405)

- `cleanLocationId(value)` — trims, caps at 64 chars, returns `''` if falsy.
- `normalizeLocationIds(value, registry)` — accepts array or comma-string,
  dedupes, strips ids not present in the registry (the dangling-id sweep —
  same idea as `removeTopic` but done lazily at load time so a deleted
  location can never orphan a habit). Caps at registry length. Returns `[]`
  for old records. When `registry` is omitted (e.g. during `normalize()` before
  settings are loaded), it does a best-effort dedupe only and defers the
  dangling sweep to a `reconcileLocations()` pass run once at app start after
  both habits and settings are loaded.
- `normalizePreferredLocation(value, ids)` — returns `null` unless `value` is a
  non-empty string present in `ids`.
- `reconcileLocations(data, settings)` — PURE sweep run once at startup: for
  every habit, drop any `locationIds` not in `settings.locations`, and null out
  `preferredLocationId` if it's no longer allowed. Returns `{data, changed}`
  so `main.js` can persist only if something actually moved.
- `normalizeLocationHours(value)` — coerces a single location's hours fields:
  clamps `allowedTimeStart/End`/`preferredTimeStart/End` to `0..1440` or `null`,
  normalises `closedDays` to a deduped `0..6` array (default `[]`), coerces
  `hoursByDay` to a `{0..6:{start,end}|null}` map dropping invalid keys.
- `resolveLocationWindow(loc, weekday)` — PURE resolver implementing the layered
  hours model: `hoursByDay[weekday]` → else `closedDays.includes(weekday) ? null`
  → else `allowedTimeStart/End` → else `null` (= 24h). Returns `{start,end}` in
  minutes or `null` (closed/24h-unconstrained is distinguished by the caller
  via `hasLocationHours(loc)`).
- `hasLocationHours(loc)` — PURE: true iff the location has *any* hours
  constraint (a set window, a non-empty `closedDays`, or any `hoursByDay`
  entry). Locations with no hours (the default "Home" case) short-circuit to
  "24h, never closed" and skip all window math — keeps zero-cost locations
  literally zero-cost.
- `intersectWindows(a, b)` — PURE: returns the overlap `{start,end}` of two
  minute-windows (handling overnight wrap on either side) or `null` if they
  don't overlap. The core composition primitive.
- `effectiveLocationWindow(h, loc, weekday)` — PURE: the habit's window ∩ the
  location's resolved window. Returns `{start,end}` or `null`. This is the one
  function the Today agenda and `windowStillDoableToday()` both call instead of
  the habit's window alone.

### Settings load/save

`loadSortSettings()` / `saveSortSettings()` (lines 118–150) gain explicit
normalisation of the new fields after the merge, mirroring how `topics` is
already re-normalised at lines 130 / 144:

```js
merged.locations = normalizeLocationRegistry(merged.locations);
merged.travel = normalizeTravelCache(merged.travel);
```

- `normalizeLocationRegistry(value)` — coerces to array, validates each entry's
  `id`/`name`/`lat`/`lng`, drops invalid entries, caps at 32, re-keys `travel`
  edges that reference removed ids.
- `normalizeTravelCache(value)` — coerces to object, drops edges older than
  `TRAVEL_TTL_MS * 2` (a hard ceiling so the cache can't grow unbounded even if
  the lazy refresh path somehow never runs), caps at `MAX_TRAVEL_EDGES`.

### New config constants — `config.js`

```js
const LOCATIONS_KEY_SUFFIX = '';           // locations ride inside SORT_SETTINGS_KEY (no new storage key)
const MAX_LOCATIONS = 32;
const MAX_TRAVEL_EDGES = 1024;             // 32² upper bound
const TRAVEL_TTL_MS = 30 * 86400000;       // 30 days
const TRAVEL_FETCH_TIMEOUT_MS = 3000;      // hard cap on any single provider call
const DEFAULT_LOCATION_RADIUS_M = 75;
const MAPS_API_KEY = 'YOUR_MAPS_API_KEY_HERE';
const OSRM_BASE = 'https://router.project-osrm.org';
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const TRAVEL_MODES = ['driving','walking','bicycling','transit'];
const DEFAULT_TRAVEL_MODE = 'driving';
```

`MAPS_API_KEY` follows the exact `YOUR_`-placeholder convention already used by
`VAPID_PUBLIC_KEY`, and a sibling `mapsConfigured()` guard (mirroring
`pushConfigured()` in `push-client.js:15`) gates every Google call.

### Storage decision: **no new localStorage key**

Locations and the travel cache ride inside `tings_app_settings_v2` alongside
`topics`, `availabilityMinutes`, and `blockedTimes`. Rationale:

- Consistent with topics (no dedicated key).
- The travel cache is bounded (`MAX_TRAVEL_EDGES = 1024`, each edge ~120 bytes
  → ~120 KB worst case) and well under the `QUOTA_HARD_KB` budget that
  `save()` already enforces.
- One less storage key to migrate, back up, or forget. The existing
  `buildBackup`/`restoreBackup` (lines 256–295) carries settings through
  unchanged, so locations and travel survive export/import for free.

If the travel cache ever needs to grow beyond the settings-key budget, the
escape hatch is a dedicated `tings_travel_v1` key — but that's a v2 concern,
not needed for this plan.

---

## Service worker — `sw.js`

Two changes:

1. **Precache** the new module: add `'./js/locations.js'` to `PRECACHE`
   (lines 4–28), and bump `CACHE` to `'tings-v15'` so the new file reaches
   existing installed clients.
2. **A dedicated maps cache** so API responses are isolated from app assets and
   survive app-shell version bumps:

   ```js
   const MAPS_CACHE = 'tings-maps-v1';
   const MAPS_ORIGINS = [
     'https://router.project-osrm.org',
     'https://nominatim.openstreetmap.org',
     'https://maps.googleapis.com'
   ];
   ```

   In the `fetch` handler (lines 63–75), add an **early route** before the
   generic stale-while-revalidate block: if `req.url` starts with any
   `MAPS_ORIGINS`, serve `cache-first` from `MAPS_CACHE` and only hit the
   network on miss (travel data is far more static than app assets — a 30-day
   cache-first TTL is correct here, where SWR is correct for app shells).

   Critically, the activate handler (line 45) currently deletes every cache
   `!== CACHE`. **Exempt `MAPS_CACHE`** so a new app version doesn't blow away
   the user's populated travel matrix:

   ```js
   keys.filter(k => k !== CACHE && k !== MAPS_CACHE)
   ```

   This means the SW and the in-memory `sortSettings.travel` cache *double-cover*
   travel responses — intentional redundancy: the SW cache keeps the raw HTTP
   response across reloads, the in-memory cache gives the agenda a zero-latency
   synchronous lookup. `locations.js` writes to both: it updates
   `sortSettings.travel` immediately on a successful fetch (so the agenda sees
   it next render) and lets the SW intercept store the HTTP response.

---

## UI — add & detail sheets

Mirrors the topic chip-row pattern exactly. One new chip row per surface.

### Add sheet (`#add-sheet`, wired in `main.js`)

A new `#add-locations-section` block (sibling to `#add-topics-section`,
index.html ~line 159), behind the same "more options" disclosure:

| Field shown | keepup/reduce | zero | task | event |
|---|---|---|---|---|
| Location chips (`#ting-location-chips`) | yes | yes | yes | yes |
| Preferred-location chip (new) | yes | yes | yes | yes |

- `renderLocationChips(containerId, selectedIds, opts)` — the analog of
  `renderTopicChips` (list-view.js:142). Renders one chip per registry entry,
  plus the inline "new location" pill (which opens the geocode search flow).
- `selectedLocationIds()` / `selectedPreferredLocationId()` — analogs of
  `selectedAddTopics()` (list-view.js:28).
- On save (main.js ~line 215), the new habit is built with
  `locationIds: selectedLocationIds(), preferredLocationId: selectedPreferredLocationId()`.
- **Preferred-location picker:** a second, smaller chip row (or a long-press on
  an already-selected chip that promotes it to "preferred") shown only when 2+
  locations are selected. Defaults to `null`. This is the only UX detail with
  no direct topic precedent — flagged in [Open design decisions](#open-design-decisions).

### Detail sheet (`detail-view.js`)

Same `renderLocationChips('detail-location-chips', h.locationIds, {preferred: h.preferredLocationId})`
call in `openDetail()` (mirroring line 39). Added to the dirty-tracking set in
`currentDetailTune()` / the compare in `setDetailDirty()` (mirroring the
`topics.join('|')` compare at line 234), and persisted in the save path
(main.js ~line 690).

### Settings manager — locations section

A new collapsible `<section>` (sibling to the topics section at index.html
497–510), containing:

1. **The registry list** — each entry shows name, address (dimmed), a compact
   hours summary (e.g. `"11a–5p · closed Sun"`, omitted when no hours set), and
   a remove button. Tapping an entry expands an inline editor (reuses the
   `.settings-collapse-body` pattern). Reuses the `.topic-list` /
   `.topic-manage-row` styles.
2. **The add-location flow** — name input + address input + a "search"
   button that fires Nominatim (or Google if configured) and shows a results
   pick list. On confirm, the chosen lat/lng creates a new registry entry.
   There's also a **"use my current location"** button that fires
   `navigator.geolocation` and reverse-geocodes (or just drops a pin at the
   returned coordinate with the name the user typed) — the opt-in geolocation
   entry point.
3. **Per-location hours editor** (expanded inline) — reuses the *exact* inputs
   the habit time-window editor already uses (`allowedTimeStart/End`,
   `preferredTimeStart/End`), so users learn one control and apply it twice.
   Layout:
   - A default open-window pair (`allowedTimeStart`→`allowedTimeEnd`), with an
     "open 24h" checkbox that nulls both.
   - A "closed days" weekday-toggle row (same 7-chip pattern as
     `allowedWeekdays` on habits, inverted sense).
   - An optional "different hours some days?" expander revealing a per-weekday
     `{start,end}` editor + per-day "closed" checkbox (writes `hoursByDay`).
     Hidden by default — most locations only need the default window + closed
     days.
   - A preferred-time window pair (soft hint), collapsed under a "best time to
     go" expander.
   This mirrors the existing add/detail-sheet time-window UI verbatim — no new
   control vocabulary, just placed inside the location editor.
4. **Default travel mode** — a small segmented control (driving / walking /
   bicycling / transit) that sets `sortSettings.defaultTravelMode`. Per-pair
   mode override is a v2 nicety; v1 uses the global default for all edges.

`addLocation()` / `removeLocation()` mirror `addTopic()` / `removeTopic()`
(list-view.js:238 / 267) — remove also runs the dangling-id sweep across all
habits (same as removing a topic strips it from every habit) and invalidates
every `travel` edge that referenced the removed id.

---

## Today agenda — location-aware sequencing

This is the part that makes locations *useful* rather than decorative, and the
only place locations change ordering. `buildTodayTimeline()` (today-view.js:142)
currently walks open slots in priority order, placing each fill item at the
walking clock. That walk is location-blind.

### The change

After the existing priority sort produces the candidate fill order, we add a
**location-clustering pass** that, within each priority band, re-orders items
to minimise total travel **and** respect each location's hours. This is now a
joint spatial-temporal optimisation, not just nearest-neighbour:

1. **Anchor:** if geolocation is on and you are currently at a known location,
   that location is the starting anchor. Otherwise the anchor is the
   `preferredLocationId` of the first item in the band (or "anywhere" if it has
   none).
2. **Greedy nearest-neighbour within the band, gated by hours:** starting from
   the anchor at the current clock time, repeatedly pick the next item whose
   chosen location is **(a) reachable and (b) open at the arrival time** — i.e.
   `effectiveLocationWindow(h, loc, todayWeekday)` must contain the arrival
   timestamp. Among the feasible candidates, pick the **cheapest to reach**
   (preferred location breaks ties, then travel seconds). This is the classic
   TSP-heuristic with a time-window constraint; with ≤ a dozen agenda items in
   a band it's trivially fast and near-optimal.
3. **Closed-now deferral:** if an item's only open-able location is closed at
   the current clock time, the item is deferred to the **earliest minute its
   window opens** (e.g. a "Gym" habit deferred to 6am tomorrow if the gym
   already closed). The clock jumps forward to that opening time, a travel row
   is inserted to cover the gap, and sequencing continues. An item with *no*
   feasible window today (closed all day) is dropped from today's agenda and
   left on the home list as overdue — exactly how `windowStillDoableToday()`
   already treats a habit whose own window has closed.
4. **Multi-location choice:** when a habit allows several locations, the pass
   evaluates each allowed location's `effectiveLocationWindow` at the arrival
   time and picks the one that is (open → preferred → cheapest). This is what
   makes the layered hours model pay off: "Call mom" can happen at Home (24h)
   now, or be deferred to Mom's house (11am–5pm) later — the agenda picks Home.
5. **"Anywhere" items** (no location constraint) are treated as zero-cost to
   place anywhere and slotted freely — they neither cause nor avoid travel and
   ignore hours (no location = no location hours).
6. **Insert travel rows:** when two consecutive placed items have different
   non-null locations, the timeline inserts a synthetic `{kind:'travel', from,
   to, seconds, metres}` row, rendered as a distinct (lighter, dashed) band
   between the two agenda rows with copy like `"12 min · 3.1 km · driving"`.
   This makes the spatial cost **visible** without forcing a rigid schedule.
   Travel rows are also inserted across a *wait* (closed-now deferral) so a
   "Gym opens 6am" gap reads correctly on the timeline.

### What does *not* change

- The **home list** (`visibleIndices` / `attentionScore`) is untouched. A
  habit's location never moves it up or down the home ranking. This preserves
  every existing scoring test and the "locations are like topics — non-scoring"
  guarantee.
- The **capacity budget** (`availabilityMinutes`) still only counts task
  minutes; travel minutes and closed-now *wait* gaps are *displayed* but do not
  consume the day's task budget in v1 (a travel minute is not a work minute,
  but it isn't free either — see [Open design decisions](#open-design-decisions)
  for whether travel should eat availability).
- Scheduled (fixed-time) tasks keep their literal placement; travel rows are
  only inserted between *soft fill* items, never around a scheduled block.
  Scheduled tasks still consult their location's hours at *creation/edit* time
  (a warning is shown if you book a 3pm event at a location closed at 3pm), but
  the agenda never silently moves a scheduled block — its placement is rigid by
  design.
- `windowStillDoableToday()` is *widened* (not replaced) to consult
  `effectiveLocationWindow(h, loc, weekday)` instead of the habit's window
  alone, but its return semantics and every existing caller are unchanged: a
  habit whose only open location just closed returns `false` and falls out of
  "today" exactly as a window-closed habit already does today.

### Geolocation integration

- `currentLocationId()` — PURE selector: returns the location id you're
  currently at (matched by `radiusM` against your last known coordinate), or
  `null` if geolocation is off / denied / you're not within any geofence.
- The live coordinate is held in a module-level `let currentCoord = null`
  (never persisted — privacy: raw coordinates are ephemeral, only the matched
  id is ever written to settings as `lastKnownLocationId`).
- `requestLocationAccess()` — called from a user gesture (a "where am I"
  button in the Today sheet header). On grant, starts a
  `watchPosition` with low power options; on deny, silently falls back to the
  manual "I am at: ___" picker (a chip row of your saved locations, defaulting
  to `lastKnownLocationId`).
- `lastKnownLocationId` *is* persisted (it's just an id, not a coordinate) so
  the agenda has a sane anchor on cold start before the first geolocation fix.

---

## Filtering & search — `list-view.js`, `overview-view.js`, `scoring.js`

Direct analogs of the topic filter machinery:

- `homeLocationChoices(data)` / `matchesHomeLocation(h, id)` /
  `renderHomeLocationFilter(data)` — mirror lines 286 / 293 / 301, including
  the `'__none__'` sentinel for habits with no location constraint.
- A new `#home-location-filter` chip bar in `index.html` (sibling to
  `#home-topic-filter` at line 63), and a `homeLocationFilter` global in
  `config.js` (sibling to `homeTopicFilter` at line 132).
- Applied in `filteredVisibleIndices()` (scoring.js:741) — composed with the
  existing topic filter (both must pass; it's an AND).
- `searchText()` (scoring.js:738) includes location names in the haystack, so
  searching "gym" finds gym-located habits even if the word isn't in the name.
- Overview view gets its own parallel `overviewLocationFilter` /
  `renderOverviewLocationFilter` (mirroring the topic one at overview-view.js
  20–44), plus a location-activity tally (which locations saw the most logs
  this month — the spatial analog of the topic activity tally at lines 170–187).
- `showLocationOnCards` toggle (settings, default `false`) — when on, each home
  card shows its location(s) as a small pin label, mirroring
  `showTopicsOnCards`.

---

## Reminders & push — `reminders.js`

Minimal, opt-in, mirrors the topic handling:

- When `pushDetailed` is on, the reminder body appends the location name after
  the topic: `"Call mom · relationships · Home"` (reminders.js lines 41 / 152).
- Travel time is **not** used to fire reminders early in v1 — that's a v2 idea
  ("leave in 12 min to reach the dentist by 3:00") flagged in
  [Open design decisions](#open-design-decisions).

---

## Phased rollout

| Phase | Deliverable | Files touched | Depends on |
|---|---|---|---|
| 0 ✅ | `Location` (incl. hours fields) / `LocationFields` typedefs, `normalize()` clamps, `normalizeLocationHours` / `resolveLocationWindow` / `intersectWindows` / `effectiveLocationWindow` pure helpers, config constants, registry normalisation | `data.js`, `config.js` | none |
| 1 ✅ | `locations.js` module: haversine, provider interface, OSRM fetcher, edge cache, geocode helper | new `js/locations.js`, `index.html` (script tag), `sw.js` (precache + maps cache) | 0 |
| 2 | Google Maps Directions + Geocoding provider behind `mapsConfigured()` | `js/locations.js`, `config.js` (`MAPS_API_KEY`) | 1 |
| 3 | Settings-manager locations section: registry CRUD, add-via-geocode, remove-with-sweep, **per-location hours editor** (default window + closed-days + per-day overrides + preferred) | `js/settings.js`, `js/list-view.js`, `index.html`, `styles.css` | 0, 1 |
| 4 | Add-sheet + detail-sheet location chip rows, preferred-location picker | `js/list-view.js`, `js/detail-view.js`, `js/main.js`, `index.html` | 0, 3 |
| 5 | Home + overview location filter bars, `searchText` + `filteredVisibleIndices` wiring, `showLocationOnCards`, widen `windowStillDoableToday` to `effectiveLocationWindow` | `js/list-view.js`, `js/overview-view.js`, `js/scoring.js`, `js/today-view.js`, `index.html` | 4 |
| 6 | Today agenda: **hours-gated** location-clustering pass (open-at-arrival filter + closed-now deferral), travel-row + wait-row rendering, capacity display | `js/today-view.js`, `js/locations.js`, `styles.css` | 4, 5 |
| 7 | Geolocation: opt-in `requestLocationAccess`, `watchPosition`, `currentLocationId`, manual "I am at" fallback, `lastKnownLocationId` | `js/locations.js`, `js/today-view.js`, `js/main.js`, `index.html`, `styles.css` | 6 |
| 8 | Reminder body location append (opt-in via `pushDetailed`) | `js/reminders.js` | 4 |
| 9 (stretch) | Travel-aware "leave by" reminders (accounts for location hours when computing departure time) | `js/reminders.js`, `js/locations.js` | 7, 8 |

Phases 0–1 are load-bearing. Phase 6 is the feature that delivers on "travel
isn't free." Everything else is refinement and can ship independently.

---

## Interplay with the other plans

- **`EGO's_EXPANSION.md`**: fully compatible. Locations are an orthogonal axis
  to type (keepup/reduce/zero/task/event) — every type can carry location
  fields. The Today agenda changes (Phase 6) layer *on top of*
  `buildTodayTimeline`; they don't alter the existing priority/capacity logic,
  only re-order within bands and insert travel rows.
- **`IOS_PORT_PLAN.md`** R6 (RENDER/HANDLER/PURE annotations): applied to
  `locations.js` from the first commit, matching the convention in
  `today-view.js` / `overview-view.js`. R1's typedef widening absorbs
  `Location`/`LocationFields` with no conflict.

---

## Open design decisions

These need a decision before or while building — flagged rather than silently
assumed:

1. **Should travel minutes eat the day's availability budget?** v1 says no —
   travel is displayed but doesn't consume task capacity. The alternative
   (travel counts against `availabilityMinutes`) is more honest about a day's
   real capacity but risks the agenda constantly "filling up" on commutes,
   which feels punishing. Worth deciding from real usage after Phase 6 ships.
2. **Asymmetric routing.** v1 caches one edge per pair (A→B === B→A). OSRM and
   Google both *can* return direction-aware durations. If one-way-street
   asymmetry matters in practice, switch the cache key to an ordered pair and
   double the edge budget. Probably not worth it for a habits app.
3. **Walking/cycling routing on OSRM.** The public OSRM demo server only
   routes driving. For a `walking` travel mode, v1 uses driving-distance + a
   walked-time heuristic (haversine-style). A more accurate option is a
   foot-routing service (e.g. self-hosted OSRM with a foot profile, or
   GraphHopper) — out of scope for v1, but the provider interface makes it a
   drop-in addition.
4. **Preferred-location picker UX.** Long-press-to-promote (no new UI, but
   discoverable?) vs. a dedicated second chip row (clear, but more clutter)?
   Recommend shipping the explicit second row first and A/B-ing long-press
   later — consistency with the chip-row vocabulary beats a hidden gesture.
5. **Travel-aware "leave by" reminders (Phase 9).** Fire a reminder at
   `eventTime − travelSeconds − buffer` instead of a flat 1 h. Powerful, but
   requires a reliable travel edge cached ahead of time and a decision about
   which origin (home? last known? calendar-predicted?). Defer until Phases
   6–7 prove the travel cache is dependable.
6. **Location sharing with the push relay.** The `pushDetailed` setting
   already leaks habit names to the Worker. Appending the location name
   (`"· Home"`) leaks slightly more context. Default off, opt-in only —
   matches the existing posture, but worth calling out explicitly.
7. **Registry cap (32).** Enough for a personal set of meaningful places; the
   travel matrix stays bounded at 1024 edges. If power users want more, raise
   `MAX_LOCATIONS` and `MAX_TRAVEL_EDGES` together — there's no algorithmic
   cost, only a storage-budget one (`QUOTA_HARD_KB` already enforces a hard
   ceiling).
8. **Should closed-now *wait* gaps consume availability?** v1 displays them
   (like travel rows) but doesn't charge them against `availabilityMinutes`.
   A 3-hour wait for the gym to open is arguably "used capacity" even though
   you weren't working. Symmetric to decision 1 — decide both together after
   Phase 6 shows real days.
9. **Per-day hours granularity.** v1's `hoursByDay` is keyed by weekday
   (0–6), so "open 11a–5p Mon–Fri, closed weekends" is two entries. It cannot
   express date-specific exceptions ("closed Dec 25" or "open late Jul 4").
   Date-exception support is a clean future addition (`hoursByDate:
   {'YYYY-MM-DD': {start,end}|null}`) layered on the same resolver, but adds
   a migration/refresh concern (exceptions expire). Deferred unless real usage
   demands it.
10. **Habit-window vs location-window precedence when they don't overlap.**
    v1 intersects them — if they don't overlap at all, the habit is simply
    unschedulable at that location today (drops to overdue). The alternative
    (habit window wins, location hours become a soft warning) is more lenient
    but undermines the point of location hours. Intersection is recommended;
    revisit if it feels too strict in practice.
11. **Preferred time: location's vs habit's.** When both a habit and its chosen
    location have a `preferredTimeStart`, v1 lets the **location's** preferred
    win (you're optimising the location's best hours, e.g. off-peak café). The
    habit's preferred is used only for anywhere/24h locations. This is a soft
    hint so either choice is low-stakes; flagged for explicitness.
