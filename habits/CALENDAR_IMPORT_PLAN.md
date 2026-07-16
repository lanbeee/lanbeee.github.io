# Calendar Import Plan

## Purpose

Tings already exports a habit to the device calendar (the "export to calendar"
button on the detail sheet). The reverse — pulling events **out of** an
external calendar and into Tings — does not exist yet. This plan adds it,
starting with **Microsoft (Outlook / Office 365 / personal Microsoft account)**
and following with **Google Calendar**.

Why import at all: a user's real day is already written down in their calendar.
Today's agenda (the `showWeekOnHome` week strip, the Today sheet) sequences
habits, tasks, and blocked time, but it has no view of the *actual* fixed
appointments that eat the day. Letting a user bring their calendar events in as
timed tasks means the agenda can treat a dentist appointment and a "call mom"
task with the same machinery — both become `type:'task'` rows with `eventTime`
set, and the existing `showScheduledTasksInAgenda` flag decides whether they
appear on the home plan. No new rendering surface, no new data family.

The import is **read-only and opt-in**. Tings never writes back to the source
calendar. A user connects once, picks a window (next 7 / 30 / 90 days), and the
matching events land as tasks. Re-importing the same window de-duplicates by the
calendar's stable event id instead of stacking copies.

---

## Design principles

1. **Calendar events are timed tasks, not a new type.** The EGO's_EXPANSION
   plan already collapsed the legacy `event` type into `type:'task'` with an
   `eventTime` (a "timed task = appointment"). Imported calendar events use the
   exact same shape. One pipeline, one renderer, one set of agenda rules — this
   plan adds zero new `type` values.
2. **Local-first, token-in-localStorage, no server-side user data.** Everything
   the app already does lives in `localStorage`; the only server is the
   Cloudflare Worker, and it stores push subscriptions, never user content.
   OAuth tokens stay on the device alongside the rest of the dataset. The
   Worker may be used later for refresh-token relay (see
   [Security & token lifetime](#security--token-lifetime)) but never stores
   calendar data.
3. **One shared import pipeline, two thin provider adapters.** Auth differs
   per provider (MSAL vs GIS) but the post-auth work — fetch, normalize, map,
   dedupe, save — is identical. Mirror the locations/travel pattern
   (`LOCATIONS.md` principle 3): one provider interface, N backends, graceful
   degradation. A failed fetch is a toast, never a crash.
4. **Microsoft first, Google second — deliberately.** Microsoft Graph's SPA
   app registration, MSAL.js v3, and CORS story are the cleaner match for a
   static PWA served from GitHub Pages; the work done there (app registration,
   redirect-URI handling, the shared pipeline, the settings UI, the dedupe
   field) is 80% reusable for Google. See [Why Microsoft first](#why-microsoft-first).
5. **Re-fetch de-duplicates; it never mutates a user-edited task.** An imported
   task carries an `externalId` (the calendar's stable event id) and a `source`.
   A re-import overwrites the *imported* fields (time, title) only when the task
   has not been hand-edited since. If the user renamed it, moved it, or logged
   it, the local copy wins and the event is skipped — the same "local is
   source of truth" stance the backup/restore path already takes.
6. **Web first, native later.** Like the other expansion plans, this touches
   only the web codebase. The `externalId` field and the import pipeline are
   written so the RN port (see IOS_PORT_PLAN.md) can swap the provider adapters
   for native SDKs with no change to the data layer.

---

## Why Microsoft first

| Concern | Microsoft | Google |
|---|---|---|
| SPA app-registration type | First-class **"Single-page application (SPA)"** platform in Entra ID, built for auth-code + PKCE | "Web application" client; SPA guidance is newer and shifting |
| Auth library | **MSAL Browser (`@azure/msal-browser` v3)** — mature, actively maintained, token cache built in | Google Identity Services (GIS) — token client is simple but the code-client (PKCE) path is less ergonomic for SPAs |
| Read scope | `Calendars.Read` (delegated) — one consent click | `calendar.readonly` — one consent click |
| CORS on the data API | Graph supports CORS for browser clients | Google Calendar API supports CORS |
| Account breadth | One client covers **work/school (Entra) + personal (outlook.com/live)** when registered as multi-tenant | One Google account per client |
| Event model fit | `event.start.dateTime` / `isAllDay` / `location.displayName` / `recurrence` map cleanly to the Tings task fields | Same fields, slightly different shape (`start.dateTime`, `location`) |

The Microsoft path produces the shared pipeline, the `externalId` schema
addition, the settings UI, and the dedupe logic. The Google phase is then
"write one new provider adapter + one new app registration" — the bulk of the
risk is retired up front.

---

## Architecture

```
                       ┌──────────────────────────────────────────┐
                       │              settings sheet              │
                       │   "import calendar" section (new)        │
                       └─────────────────────┬────────────────────┘
                                             │ user taps connect
                                             ▼
   ┌──────────────────────┐         ┌─────────────────────────────┐
   │  MSAL Browser (MS)   │         │  Google Identity Services   │
   │  / GIS token (GCal)  │         │  (provider adapter, thin)   │
   │  auth-code + PKCE    │         │  js/calendar-import.js      │
   └──────────┬───────────┘         └────────────┬────────────────┘
              │ access token (+ refresh)          │
              ▼                                   ▼
   ┌──────────────────────┐         ┌─────────────────────────────┐
   │ Microsoft Graph      │         │ Google Calendar API         │
   │ /me/calendarview     │         │ /calendar/v3/.../events     │
   └──────────┬───────────┘         └────────────┬────────────────┘
              │ JSON events                       │ JSON events
              └───────────────┬───────────────────┘
                              ▼
              ┌────────────────────────────────────┐
              │  shared import pipeline             │
              │  normalize → map → dedupe → save    │
              │  (one implementation, both sources) │
              └────────────────┬───────────────────┘
                               ▼
              ┌────────────────────────────────────┐
              │  habits array (localStorage)       │
              │  type:'task', eventTime, dueDate,  │
              │  externalId, source, …             │
              └────────────────────────────────────┘
```

Two provider adapters feed one pipeline. The pipeline reads from and writes to
the same `habits` array every other feature uses; nothing about storage,
rendering, or scoring changes.

---

## Data model

### New optional fields on `Habit`

Two nullable fields, added for **all** types (not just tasks) so the import
story is uniform and so re-import / "disconnect" can find every imported row:

```js
/**
 * Added to the Habit typedef in js/data.js.
 * @property {string|null} externalId  — stable id from the source calendar
 *   (Graph event `id` / Google event `id` / iCal `iCalUId`). null for anything
 *   created inside Tings. Used for de-dup on re-import.
 * @property {'msgraph'|'gcal'|null} source — which provider produced this row.
 *   null for Tings-native items. Drives the "disconnect" sweep + the chip label.
 */
```

`normalize()` coerces both exactly like the other string fields:

```js
externalId: typeof raw.externalId === 'string' ? raw.externalId.slice(0, 256) || null : null,
source: (raw.source === 'msgraph' || raw.source === 'gcal') ? raw.source : null,
```

Legacy records migrate with `externalId:null, source:null` — fully backward
compatible, identical stance to `createdAt` in the EGO plan.

### Calendar event → Habit mapping

| Calendar field | Tings field | Notes |
|---|---|---|
| `subject` / `summary` | `name` | capped at 60 chars (existing limit) |
| `start.dateTime` | `eventTime` | the "fixed point in time" a timed task already uses |
| `start.dateTime` (day-only / `isAllDay`) | `dueDate` (day-level) + `eventTime:null` | an all-day event becomes an untimed dated task |
| `end.dateTime` − `start.dateTime` | `durationMinutes` | capped 1–720; all-day → falls back to default duration |
| `location.displayName` / `location` | `locationIds[]` | soft-matched against the existing location registry by name; unmatched → left empty (anywhere) |
| `bodyPreview` / `description` | — | not stored in v1 (no notes field exists) |
| `categories` / `colorId` | `topics[]` | optional; off by default, toggle in settings |
| `id` / `iCalUId` | `externalId` | dedupe key |
| provider | `source` | `'msgraph'` / `'gcal'` |
| — (computed) | `type` | always `'task'` |
| — (computed) | `hardDue` | `false` (calendars don't express hard deadlines) |
| — (computed) | `markDone` | `true` (user taps to complete, consistent with manual tasks) |

### Dedupe & conflict rules (applied by the pipeline)

1. An incoming event whose `externalId` matches no existing habit → **insert**.
2. An incoming event whose `externalId` matches an existing habit:
   - If the local habit is **untouched by the user** (no manual name change, no
     logs, no moved `eventTime`) → **overwrite** the imported fields. This is
     the "event moved on the server" case.
   - If the local habit **has been edited** (renamed, logged, rescheduled
     inside Tings) → **skip**. The user's edits are authoritative, exactly like
     backup/restore.
3. An existing imported habit whose `externalId` is **no longer present** in a
   fresh fetch of the same window → leave it in place. Tings never deletes on
   its own; a separate "disconnect" action removes every `source === X` row.

A small `importedAt` ms-timestamp is also written on insert/overwrite so the
settings sheet can show "last synced Nd ago" and so the overwrite-vs-skip
decision has a cheap "edited since import?" check (any log or any
`lastModified > importedAt`).

---

## Microsoft Graph integration (Phase A)

### A0 — App registration (Microsoft Entra ID)

One-time, in the Azure Portal. No code.

1. Azure Portal → **Microsoft Entra ID** → **App registrations** → **New registration**.
2. **Name:** `Tings` (or whatever shows in the consent screen).
3. **Supported account types:** *Accounts in any organizational directory
   (any Entra ID tenant) and personal Microsoft accounts (e.g. Skype, Xbox)*.
   This single setting covers work/school + outlook.com/live in one client.
4. **Redirect URI:** add platform **Single-page application (SPA)** — *not* Web.
   - Production: `https://lanbeee.github.io/habits/` (the deployed PWA origin)
   - Local: `http://localhost:*` (or the exact port you serve from)
5. **API permissions** → add Microsoft Graph → **Delegated**:
   - `Calendars.Read` (the only data scope we need)
   - `offline_access` (so MSAL can hand us a refresh token for silent renewal)
   - `User.Read` (basic profile for the "connected as …" label)
   - Keep **admin consent** off — these are all user-delegated, no tenant admin required.
6. **Authentication** → enable **Allow public client flows** → **No** (we are a
   SPA, not a public mobile client; PKCE handles it).
7. **Certificates & secrets** → **leave empty.** A SPA has no secret; the
   client id is public and PKCE is the protection.
8. Copy the **Application (client) ID** → goes into `config.js`.

**Done when:** A consent popup from the deployed PWA can grant `Calendars.Read`
and return to the app without an error.

### A1 — Provider config & sentinels

Follow the existing `YOUR_` sentinel pattern (`mapsConfigured`,
`pushConfigured`) so the feature is invisible until the deployer fills it in.

```js
// js/config.js — additions
const MS_CLIENT_ID = 'YOUR_MS_CLIENT_ID';          // Entra app (client) id
const MS_AUTHORITY = 'https://login.microsoftonline.com/common';  // multi-tenant
const MS_SCOPES = ['Calendars.Read', 'offline_access', 'User.Read'];
const GCAL_CLIENT_ID = 'YOUR_GCAL_CLIENT_ID';       // filled in Phase B
const GCAL_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

function calendarImportConfigured(){
  return Boolean(MS_CLIENT_ID) && !MS_CLIENT_ID.includes('YOUR_');
}
```

**Done when:** `calendarImportConfigured()` flips to true once a real client id
is pasted in; the settings section appears/disappears on that flag, mirroring
how the push section gates on `pushConfigured()`.

### A2 — Auth module (`js/msal-client.js`)

Use `@azure/msal-browser` (ESM from a CDN, same as Leaflet/Tabler are loaded).
No build step — the app is vanilla JS.

```js
// js/msal-client.js — sketch
// PURE-ish: wraps PublicClientApplication. Token cache in localStorage under
// a namespaced msal.* key (MSAL's default for browser). All async; every call
// silently no-ops + returns null on failure so the UI never hard-errors.

let msalApp = null;

function msalReady(){
  if(!calendarImportConfigured())return false;
  if(!msalApp){
    msalApp = new msal.PublicClientApplication({
      auth:{ clientId:MS_CLIENT_ID, authority:MS_AUTHORITY, redirectUri:location.origin + location.pathname },
      cache:{ cacheLocation:'localStorage', storeAuthStateInCookie:false }
    });
  }
  return true;
}

async function msLogin(){           // popup; redirect fallback for iOS Safari
  if(!msalReady())return null;
  const res = await msalApp.loginPopup({ scopes:MS_SCOPES });
  return res.account;
}

async function msAccessToken(){
  if(!msalReady())return null;
  const accounts = msalApp.getAllAccounts();
  if(!accounts.length)return null;
  try{
    const silent = await msalApp.acquireTokenSilent({ scopes:['Calendars.Read'], account:accounts[0] });
    return silent.accessToken;
  }catch{
    try{ return (await msalApp.acquireTokenPopup({ scopes:['Calendars.Read'] })).accessToken; }
    catch{ return null; }
  }
}
```

Notes:
- **Popup vs redirect:** iOS Safari blocks `loginPopup` when called without a
  user gesture, and some in-app browsers block popups entirely. Start with
  `loginPopup`; add `loginRedirect` + `handleRedirectPromise()` as the fallback.
  This is the single biggest cross-browser gotcha — spike it first.
- **MSAL token cache in localStorage** is consistent with the rest of the app.
  It does expose tokens to XSS; see [Security](#security--token-lifetime).

**Done when:** A "connect" tap shows the Microsoft consent screen, returns to
the PWA, and `msAccessToken()` returns a non-null token on the next call
without re-prompting.

### A3 — Graph fetch (`js/calendar-import.js`, MS adapter)

```js
async function fetchMsEvents(startIso, endIso){
  const token = await msAccessToken();
  if(!token)return [];
  const url = new URL('https://graph.microsoft.com/v1.0/me/calendarview');
  url.searchParams.set('startDateTime', startIso);
  url.searchParams.set('endDateTime', endIso);
  url.searchParams.set('$select', 'subject,start,end,isAllDay,location,id,lastModifiedDateTime');
  url.searchParams.set('$top', '50');
  const out = [];
  let next = url.toString();
  while(next){
    const res = await fetch(next, { headers:{ Authorization:`Bearer ${token}` } });
    if(!res.ok)break;
    const body = await res.json();
    out.push(...(body.value || []));
    next = (body['@odata.nextLink']) || null;   // pagination
  }
  return out;
}
```

- Use `/me/calendarview` (not `/me/events`): it expands recurring series into
  individual occurrences inside the window, which is what we want to import.
- `$select` keeps the payload small; `$top=50` + `@odata.nextLink` handles
  large calendars.
- All failures degrade to `return []` + a toast — no thrown exceptions cross
  into the UI, same contract as `push-client.js`.

**Done when:** `fetchMsEvents()` returns a flat array of occurrences for the
selected window, including expanded recurrences, on a real account.

### A4 — Shared pipeline (`js/calendar-import.js`)

The provider-agnostic core. Both adapters funnel through it.

```js
// PURE: one calendar event (provider-agnostic shape) → partial Habit fields
function mapEventToTask(ev, source){
  const allDay = ev.isAllDay;                       // MS; GCal adapter sets this
  const startMs = Date.parse(ev.start);
  const endMs = Date.parse(ev.end);
  const durationMin = allDay || !isFinite(endMs - startMs)
    ? DEFAULT_DURATION_MINUTES
    : Math.max(1, Math.min(720, Math.round((endMs - startMs) / 60000)));
  return {
    type:'task',
    name:(ev.subject || 'untitled').slice(0,60),
    emoji:'',
    target:null,
    eventTime: allDay ? null : startMs,
    dueDate: allDay ? dayStart(startMs) : null,
    hardDue:false,
    markDone:true,
    durationMinutes:durationMin,
    locationIds:matchLocationsByName(ev.locationText),  // soft match, may be []
    topics:[],
    logs:[],
    externalId:ev.id,
    source,
    importedAt:Date.now(),
    priority:DEFAULT_PRIORITY
  };
}

// HYBRID: merge a fresh fetch into the habits array using the dedupe rules.
function applyImport(incoming){
  const data = load();
  const byExternal = new Map(
    data.filter(h => h.externalId).map(h => [h.externalId, h])
  );
  let added = 0, updated = 0, skipped = 0;
  for(const ev of incoming){
    const existing = byExternal.get(ev.id);
    if(!existing){ data.push(normalize([mapEventToTask(ev, ev.source)])[0]); added++; continue; }
    if(userEditedSince(existing)){ skipped++; continue; }
    Object.assign(existing, mapEventToTask(ev, ev.source)); updated++;
  }
  save(data);   // existing quota/prune path runs
  return { added, updated, skipped };
}
```

`userEditedSince(h)` returns true when `h` has any log, or a name/emoji/time
that diverges from its last imported snapshot. Cheapest correct version: store
the imported field values alongside `importedAt` and compare; first cut is "has
any actual log → skip", which is good enough and matches "logged = done = user
owns it".

**Done when:** Running import twice in a row on the same window yields
`added:N, updated:0, skipped:N` the second time — never duplicates.

### A5 — Settings UI

A new collapsible block in the settings sheet (same pattern as "locations",
"availability", "blocked time"). Gated behind `calendarImportConfigured()`.

```
settings sheet
└── calendar import (collapsible)
    ├── account row:      "not connected" / "connected as alice@example.com"
    ├── connect button    (→ msLogin)         [disconnect button when connected]
    ├── window selector:  [ next 7d | 30d | 90d ]
    ├── import button     (→ fetch + applyImport + toast "added N · updated M · skipped K")
    ├── last synced:      "2h ago"
    └── options toggles:  • import location as topic   • auto-sync on launch
```

HTML follows the existing `settings-collapse-head` / `settings-collapse-body`
scaffold. The toggle wiring uses the same `data-setting-toggle` pattern as the
"today" block. No new CSS paradigm.

**Done when:** A user can connect, import the next 30 days, see the tasks land
on the home list with scheduled-time chips, and disconnect to remove them all.

---

## Google Calendar integration (Phase B)

Once Phase A ships, Phase B is one new adapter + one app registration. The
pipeline (`mapEventToTask`, `applyImport`, dedupe, UI) is reused unchanged.

### B0 — Google Cloud Console setup

1. Console → **APIs & Services** → enable **Google Calendar API**.
2. **OAuth consent screen** → External → add the `calendar.readonly` scope,
   app name, support email. Keep it in **Testing** for personal use, or submit
   for verification if the app goes public (verification is only needed for
   sensitive scopes; `calendar.readonly` is restricted but not sensitive, so
   testing mode + up to 100 test users is enough for a personal PWA).
3. **Credentials** → **Create OAuth client ID** → **Web application**
   (Google's SPA guidance now also supports the code flow; Web application is
   the stable choice for a static PWA).
   - **Authorized JavaScript origins:** `https://lanbeee.github.io`,
     `http://localhost`
   - **Authorized redirect URIs:** `https://lanbeee.github.io/habits/`,
     `http://localhost:*`
4. Copy the **Client ID** → `GCAL_CLIENT_ID` in `config.js`.

### B1 — GIS token client (`js/gis-client.js`)

Use Google Identity Services loaded from `https://accounts.google.com/gsi/client`.

```js
let tokenClient = null;
let gcalToken = null;

async function gcalInit(){
  if(!GCAL_CLIENT_ID || GCAL_CLIENT_ID.includes('YOUR_'))return;
  await google.accounts.oauth2.initTokenClientPromise;  // or onload callback
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id:GCAL_CLIENT_ID,
    scope:GCAL_SCOPES.join(' '),
    callback:(resp) => { gcalToken = resp.access_token; }
  });
}

async function gcalLogin(){
  await gcalInit();
  tokenClient.requestAccessToken({ prompt:'consent' });
}

async function gcalAccessToken(){
  // GIS tokens are short-lived (~1h); re-request silently with prompt:'none'.
  // For a read-only personal import this is fine.
  return gcalToken;
}
```

GIS is lighter than MSAL (no token cache library) — the trade-off is we
re-consent with `prompt:'none'` on expiry rather than refreshing with a stored
refresh token. For a read-only, user-initiated import that is acceptable; if
auto-sync on launch is desired, a refresh-token relay through the Worker
(see Security) becomes more attractive here than for Microsoft.

### B2 — Google Calendar fetch

```js
async function fetchGcalEvents(startIso, endIso){
  const token = await gcalAccessToken();
  if(!token)return [];
  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  url.searchParams.set('timeMin', startIso);
  url.searchParams.set('timeMax', endIso);
  url.searchParams.set('singleEvents', 'true');   // expand recurrences (mirrors /calendarview)
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', '250');
  const out = [];
  let pageToken = null;
  do{
    if(pageToken)url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url, { headers:{ Authorization:`Bearer ${token}` } });
    if(!res.ok)break;
    const body = await res.json();
    out.push(...(body.items || []));
    pageToken = body.nextPageToken || null;
  }while(pageToken);
  return out.map(normalizeGcalEvent);             // → same shape MS adapter emits
}
```

`normalizeGcalEvent` flattens Google's shape (`summary`, `start.dateTime`,
`start.date`, `location`, `id`) into the provider-agnostic shape the pipeline
already expects (`subject`, `start`, `end`, `isAllDay`, `locationText`, `id`).
This adapter function is the **only** Google-specific glue beyond `gis-client.js`.

**Done when:** The same settings UI, with a provider toggle, imports from
either connected calendar using the identical pipeline.

---

## Phases

Mirrors the IOS_PORT_PLAN phase table. Estimates assume one focused engineer.

| # | Phase | Deliverable | Est. | Depends |
|---|-------|-------------|------|---------|
| **A0** | MS app registration | Entra SPA client, redirect URIs, delegated `Calendars.Read` | 1h | None |
| **A1** | Config + sentinels | `MS_CLIENT_ID`, `calendarImportConfigured()`, feature-gated UI slot | 1h | A0 |
| **A2** | MSAL client | `msLogin` / `msAccessToken` working on desktop + iOS Safari (redirect fallback) | 1–2d | A1 |
| **A3** | Graph fetch | `fetchMsEvents()` returns expanded recurrences, paginated | 0.5d | A2 |
| **A4** | Shared pipeline | `mapEventToTask`, `applyImport`, dedupe, `externalId`/`source` in `normalize()` | 1d | A3 |
| **A5** | Settings UI | connect / window / import / disconnect / last-synced | 1d | A4 |
| **A6** | Polish + tests | location soft-match, quota behavior on big imports, edge cases, Playwright e2e | 1–2d | A5 |
| **B0** | Google console setup | Calendar API enabled, OAuth consent, Web client, origins/redirects | 1h | A4 |
| **B1** | GIS token client | `gcalLogin` / `gcalAccessToken` with silent re-consent | 0.5–1d | B0 |
| **B2** | Gcal fetch + adapter | `fetchGcalEvents` + `normalizeGcalEvent`, provider toggle in UI | 0.5d | B1 |
| **B3** | Polish + tests | both providers side by side, disconnect-per-source sweep | 1d | B2 |

**To Microsoft MVP (end of A6):** ~4–6 days.
**To both providers shipping (end of B3):** ~7–9 days total.

The critical path is A2 (MSAL cross-browser, especially iOS Safari popup/redirect)
and A4 (the dedupe rules) — spike those first.

---

## Security & token lifetime

- **PKCE everywhere.** Both providers use authorization-code + PKCE. No client
  secret ever ships in the bundle (a SPA can't keep one).
- **Tokens in localStorage.** Consistent with the rest of the app and with
  MSAL's default browser cache. The XSS blast radius is "the attacker can read
  the user's calendar for the token's lifetime" — bounded because access tokens
  are short-lived (~1h). The existing CSP (add to `index.html` / `_headers` if
  not present) is the real defence; lock `script-src` to the known CDNs.
- **Refresh tokens.** Microsoft hands back a refresh token (via `offline_access`)
  and MSAL renews silently — ideal for "auto-sync on launch". Google's GIS token
  client does implicit tokens and re-consents with `prompt:'none'`; that works
  for manual imports but re-prompts can fail silently. If silent Google
  background sync matters, add a tiny Worker route that holds the Google
  refresh token server-side and mints short-lived access tokens for the SPA.
  The Worker stores *only* the refresh token + the device id — never calendar
  contents — matching how it already stores push subscriptions.
- **Read-only.** `Calendars.Read` / `calendar.readonly`. Tings never writes,
  deletes, or RSVPs. State this plainly on the consent screen copy and in the
  settings UI so the permission scope is unsurprising.
- **Disconnect = local delete + token revoke.** Disconnecting a provider drops
  every `source === X` habit (with a confirm + undo toast, like delete-habit)
  and calls the provider's revoke endpoint so the consent is removed, not just
  forgotten.

---

## Testing strategy

- **Unit (pure):** `mapEventToTask`, the dedupe matrix (insert / overwrite /
  skip), `userEditedSince`, all-day vs timed, overnight duration clamp,
  unmatched-location fallback. These fit the existing `tests/*.js` pattern
  that seeds habits and asserts on `normalize()` output.
- **Provider adapters:** stub `fetch` / MSAL / GIS; assert the request URL,
  headers, pagination, and that any failure degrades to `[]` + toast.
- **E2E (Playwright):** the repo already has Playwright tests
  (`tests/habits-calendar-open.js`, `tests/stack-check.js`). Add
  `tests/calendar-import.js` that stubs the Graph response via route
  interception and asserts tasks appear on the home list with the right chips,
  that re-import dedupes, and that disconnect clears them.
- **Cross-browser smoke:** run the A2 auth spike on iOS Safari (popup vs
  redirect), Android Chrome, and desktop Chrome/Firefox/Safari before calling
  A2 done.

---

## Out of scope (future)

- **Two-way sync / write-back.** Editing an imported task in Tings and pushing
  the change back to the calendar. The skip-on-user-edit rule exists precisely
  to leave the door open for this without corrupting either side.
- **Multiple calendars per account.** v1 imports the primary/default calendar
  only. Listing calendars and letting the user pick is a settings follow-up.
- **Both providers' refresh via Worker.** Only add the Worker relay route if
  silent background sync proves flaky on Google.
- **Recurring-event authoring.** Imported recurrences land as individual timed
  task occurrences (the calendar already expanded them). Tings will not create
  or edit recurrence rules.
- **Reminders/alarms from the source calendar.** Only events are imported;
  Tings' own reminders (see `reminders.js` / `push-client.js`) fire on the
  imported tasks like any other.
- **Native iOS/macOS EventKit import.** The RN port (IOS_PORT_PLAN.md) would
  use EventKit instead of OAuth; the `externalId` / `source` fields are written
  with that in mind, but the native adapter is a separate plan.

---

## Interplay with the other plans

- **EGO's_EXPANSION.md** — This plan depends on the `task` type and `eventTime`
  field that the EGO plan introduced (the collapsed legacy `event` type).
  Imported calendar events are simply timed tasks; no EGO behaviour changes.
- **LOCATIONS.md** — The soft location match (`matchLocationsByName`) reuses the
  existing location registry and its `normalizeLocationRegistry` validator. No
  schema change; unmatched events stay location-free.
- **IOS_PORT_PLAN.md** — The `externalId` and `source` fields are added to the
  `Habit` typedef in R1 style, so the RN types pick them up automatically. The
  pipeline (`mapEventToTask`, `applyImport`) is written pure (no DOM) so it
  ports verbatim to `src/logic/import.ts`; only the two provider adapters get
  rewritten (MSAL Browser → MSAL Node/native, GIS → Google Sign-In SDK).
- **push-client.js / worker** — Unchanged in v1. The optional Google
  refresh-token relay is the only Worker addition, and it reuses the existing
  `device_id` + D1 pattern rather than a new table.

---

## Refactoring completion checklist

Before shipping Phase A (Microsoft):

- [ ] A0: Entra SPA app registered; both redirect URIs present; consent works
      from the deployed PWA
- [ ] A1: `MS_CLIENT_ID`, `MS_SCOPES`, `calendarImportConfigured()` in
      `config.js`; settings section hidden when unconfigured
- [ ] A2: `msLogin` + `msAccessToken` work on desktop Chrome and iOS Safari
      (redirect fallback verified)
- [ ] A3: `fetchMsEvents()` returns expanded recurrences, paginates, degrades
      to `[]` on any error
- [ ] A4: `externalId` + `source` + `importedAt` on `Habit`; `normalize()`
      coerces them; `applyImport` dedupe rules covered by unit tests
- [ ] A5: connect / window / import / disconnect UI; last-synced copy;
      undo toast on disconnect
- [ ] A6: location soft-match tested; quota/prune path survives a 500-event
      import; Playwright e2e green

Before shipping Phase B (Google):

- [ ] B0: Calendar API enabled; OAuth consent screen; Web client with correct
      origins + redirect URIs
- [ ] B1: `gcalLogin` + `gcalAccessToken`; silent re-consent (`prompt:'none'`)
      works for the manual import path
- [ ] B2: `fetchGcalEvents` + `normalizeGcalEvent`; provider toggle in the UI;
      `singleEvents=true` verified on a recurring event
- [ ] B3: both providers import side by side; per-source disconnect sweep
      tested; e2e green
