# Make personal-clone settings device-local except shared registries

## Root cause
When the phone publishes the clone library, `buildHouseholdReplica` (`js/agenda-share.js:573`) seals the **entire** settings object into the replica envelope. On every 3-minute poll, `mergeReplicaSnapshot` (`js/display-mode.js:616-621`) wholesale-replaces local settings: `Storage.write(SORT_SETTINGS_KEY, replica.settings)`. So the laptop's theme (and every other setting) is clobbered by the phone's.

## Change: filter at the install choke point

### 1. `js/agenda-share.js` — define the shared-settings contract
Next to `buildHouseholdReplica`, add:
- `CLONE_SHARED_SETTING_KEYS` allowlist — the only settings a clone install adopts from the owner payload:
  - `locations`
  - `blockedTimes`, `cancelledBlocks`, `blockedTimeOverrides` (busy times + per-date cancels/edits)
  - `weatherProfiles`
  - `homeCityName`, `homeCityLat`, `homeCityLng`, `homeCityCountry` (weather/prayer home city)
- `sharedReplicaSettings(settings)` — returns only allowlisted keys present in the payload, or null.

Everything else — `themeMode`, `fontScale`, `minimalMode`, card display prefs, planner engine choice, weights, prayer method, assistant settings, GPS-derived keys, etc. — becomes device-local. Absent key = keep local (the publisher already omits empty registries via `replicaOmitEmpty`, so absence means "no opinion", not deletion).

### 2. `js/display-mode.js` — merge instead of replace in `mergeReplicaSnapshot`
Replace the wholesale write with: pick shared keys via `sharedReplicaSettings`, spread onto `loadSortSettings()`, persist, then refresh in-memory `sortSettings`, `syncSettingsControls()`, `applyAppearanceSettings()`, and `refreshWeatherForecast()`.

Deliberately **no publish-side change**: filtering at install only is safe against an out-of-date clone running stale service-worker-cached JS (AGENTS.md gotcha #2) — a slimmed payload would wipe an old clone's settings to defaults. `selected` (shared-items) mode is untouched (it never installed settings). Clone→owner direction unchanged (clone publishes no replica).

### 3. `tests/device-replica-sync-test.js` — new evaluate block (mirrors the existing `libraryPull` block)
Seed device-local settings (dark theme, large font, own location), merge a clone-mode replica carrying owner settings (light theme, different locations/blockedTimes/weatherProfiles), assert: registries adopted, theme/fontScale preserved; then a second snapshot lacking `locations` keeps local locations while adopting changed busy times.

### 4. `sw.js` — bump `CACHE` v403 → v404 (JS changed).

### 5. `DOCUMENTATION.md` — one sentence in the shared-display sync bullets (~line 1329): personal clone installs only places, busy times, and weather profiles (+ home city) from the owner payload; every other setting is device-local per installation.

## Verification
Serve on 4181 and run `./run-tests.sh data` (contains `device-replica-sync-test`); the planner engines are untouched.