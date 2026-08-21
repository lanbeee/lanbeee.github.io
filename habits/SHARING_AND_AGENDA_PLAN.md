# Encrypted Item Sharing and Household Agenda Displays

## Summary

Add one dedicated Cloudflare sharing service with two distinct modes:

1. **Collaborative item sharing** — two people independently track the same owner-managed habit or task.
2. **Household agenda display** — one authorized read-only tablet, fridge screen, or family device displays a capped view of today and tomorrow.

Tailscale is not required. The owner’s browser remains the planner of record. It publishes an encrypted agenda projection whenever Tings opens or its plan changes; Cloudflare stores and serves ciphertext but cannot inspect item names, notes, addresses, or agenda content.

Use SQLite-backed Durable Objects rather than Workers KV. Durable Objects provide strongly consistent, transactional per-share storage; KV can expose stale values due to eventual consistency. See [Durable Objects storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/) and [Workers KV consistency](https://developers.cloudflare.com/kv/reference/faq/).

## Shared Cloudflare Foundation

Create a new `habits-share` Worker, separate from the existing push Worker, with two Durable Object namespaces:

- `ItemShare` for collaborative individual items.
- `AgendaFeed` for read-only agenda projections.

Use client-generated random secrets:

- 128-bit opaque share/feed ID.
- 256-bit AES-GCM content key.
- Independent 256-bit owner, recipient, and per-device credentials.
- One-time claim secret for collaborative-item invitations.

Encrypt each definition, location bundle, log operation, and agenda snapshot separately with AES-256-GCM and a unique 96-bit nonce. Authenticate the schema version, object ID, record kind, revision, and operation ID as additional data.

The Worker stores only:

- Credential hashes.
- Ciphertext and nonces.
- Revisions and sequence numbers.
- Opaque operation IDs.
- Creation/access/expiry timestamps.
- Payload sizes and lifecycle status.

Collaborative-item encryption keys remain in invitation URL fragments. Agenda links contain only a PBKDF2-wrapped content key; a separate 10-character code is required to unwrap it. Clear agenda invitation fragments immediately after successful enrollment.

Configure:

- Production and explicit localhost CORS origins.
- A 256 KiB item-definition limit.
- A 64 KiB individual activity-operation limit.
- A 128 KiB encrypted agenda-snapshot limit plus a client-side 50-row cap.
- A 5 MiB total limit per share/feed.
- Creation rate limiting by source IP and authenticated limits by credential/feed.
- Seven-day expiry for unclaimed item invitations.
- Thirty-day retention after revocation.
- Twelve-month expiry after the last authenticated request for abandoned active objects.
- Fifteen-minute, single-use agenda invitations; burn after five invalid proofs.
- Seven- or thirty-day agenda device credentials with no silent refresh.
- Logs and traces that never record credentials, fragments, ciphertext bodies, decrypted data, titles, notes, or locations.

Cloudflare’s Worker rate-limit binding can enforce these controls, with limits treated as abuse protection rather than exact accounting. See [Worker rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

## Mode 1: Collaborative Item Sharing

### Product behavior

Support all Tings item types, with exactly one owner and one recipient installation in v1.

- The owner controls the item definition and planning fields.
- Each participant has separate completion history and task status.
- Remote activity never enters local `habit.logs`, changes local `lastLog`, or satisfies the local planner.
- Sharing starts when the invitation is created; existing history is not uploaded.
- Future full log entries are shared, including timestamps, planned status, minutes, numeric values, source markers, and notes.
- The recipient may customize local display choices such as emoji, color, topics, and pin.
- Revocation leaves the recipient with an unlocked local copy and an archived shared-activity feed.

### Portable item definition

Synchronize owner-controlled fields such as:

- Name and type.
- Rhythm, due date, event time, and plan-by date.
- Priority and flexibility.
- Duration, breakability, minimum chunks, and automatic logging.
- Allowed/preferred dates and clock windows.
- Prayer-based timing that does not reference another habit.
- Value tracking and ordinary call/web links.
- Selected location preferences after ID remapping.

Keep local or omit:

- `hid`, local `logs`, and derived `lastLog`.
- Active timers and agenda commitments.
- External calendar IDs and importer metadata.
- Schedule links and dynamic timing references to unrelated habits.
- Recipient display overrides.

### Location transfer

Place referenced location definitions inside the encrypted invitation—not readable WhatsApp text.

On acceptance:

1. Preview each place, including name and address.
2. Match an existing local place by normalized address, or by normalized name plus coordinates within 50 metres.
3. Never overwrite a matched local place.
4. Otherwise create a fresh local location ID and remap the item’s references.
5. If the location limit is reached, accept the item without that place and show a setup warning.

Treat transferred locations as an invitation-time snapshot. Later changes to the owner’s global location registry do not silently change the recipient’s registry.

### Activity synchronization

Add an optional stable `logId` to object-form log entries created after sharing begins. Legacy numeric logs remain supported and unshared.

Store local sharing metadata separately:

```js
{
  shares: {
    [sharedItemId]: {
      localHid,
      role: "owner" | "recipient",
      contentKey,
      credential,
      lastSequence,
      definitionRevision,
      status,
      localDisplayOverrides,
      locationIdMap,
      remoteActivity
    }
  },
  outbox: []
}
```

Use append-only, idempotent activity operations:

- `add`
- `update`
- `delete`

Each operation contains a random operation ID and stable log ID. The relay accepts corrections or deletions only from the credential belonging to that log’s actor.

Synchronize immediately after local changes, on startup/foreground/reconnect, and every three minutes while visible. Persist operations to the outbox before network delivery and retry with exponential backoff capped at three minutes.

## Mode 2: Household Agenda Display

### Architecture

Publish a derived, read-only agenda projection rather than the complete habit database.

The owner PWA:

1. Builds the normal rolling plan using Fast or GLPK.
2. Waits until the plan currently shown to the owner is available.
3. Removes raw habit objects, private settings, history, addresses, coordinates, scores, solver diagnostics, and internal indices.
4. Encrypts the resulting display projection.
5. Publishes it to the owner’s `AgendaFeed` Durable Object.

Cloudflare cannot recompute an agenda because the planner inputs remain encrypted. If every owner device is closed, the display continues showing the last published plan with its age.

### Projection schema

Use a versioned shape similar to:

```js
{
  schemaVersion: 1,
  feedId,
  title,
  revision,
  generatedAt,
  timezone: "America/New_York",
  rangeStart,
  plannerProvenance: "glpk-opt" | "glpk-feasible" | "fast",
  days: [{
    dateKey,
    weekdayLabel,
    dateLabel,
    openMinutes,
    plannedMinutes,
    rows: [{
      rowId,
      kind: "item" | "busy" | "travel" | "open",
      start,
      end,
      title,
      emoji,
      status,
      durationMinutes,
      locationLabel,
      travelFromLabel,
      travelToLabel
    }]
  }]
}
```

Projection rules:

- Include only today and tomorrow.
- Include either the next 1–50 activity rows or 1–48 hours ahead, as selected by the owner, with an unconditional 50-row ceiling.
- Resolve stale planner rows against fresh local data and omit completed/logged work before encryption.
- Preserve the owner’s timezone; do not reinterpret times using the viewer device’s timezone.
- Include the full visible timeline: habits, tasks, planned items, travel, busy time, and open-time summaries.
- Replace custom blocked-time labels with the generic title `Busy`.
- Include saved location names used in visible rows, but never addresses or coordinates.
- Include travel endpoint labels only when already displayed by the owner.
- Exclude notes, log history, numeric values, phone/web links, unrelated habits, planner diagnostics, scarcity scores, and settings.
- Use random projection row IDs rather than local habit IDs or array indices.

Publish the agenda currently shown to the owner. If an initial Fast plan is later replaced or refined by GLPK, publish a new revision. This keeps the household display aligned with the owner’s actual screen rather than claiming every projection is solver-optimal.

### Viewer enrollment

Create a short-lived, single-use invitation link that does not contain the content key or a device credential in plaintext:

```text
https://tings.example/agenda-display.html#feed=<id>&invite=<id>&salt=<salt>&nonce=<nonce>&wrap=<wrapped-key>
```

Provide:

- Copy/share support for the non-authorizing link.
- A separately displayed 10-character enrollment code.
- A clear instruction to communicate the code in person or through a different service.
- A neutral message that does not contain agenda titles or locations.

The Worker consumes the invitation exactly once. The display generates a random device credential, and the Worker stores only its hash. Creating a replacement invitation immediately revokes the prior display session and invitation. Five invalid server proofs burn the invitation; a normal mistyped code fails local AES-GCM verification without consuming an attempt.

Rotating access:

1. Generate a new content key, code, and one-time invitation ID.
2. Wrap the content key locally using PBKDF2-SHA-256 and AES-GCM.
3. Invalidate the previous device credential and pending invitation.
4. Publish the current agenda under the new content key.
5. Require the display to enroll within 15 minutes and again after 7 or 30 days.

### Standalone display page

Add a lightweight `agenda-display.html` that loads only:

- Shared crypto/network utilities.
- Agenda-display rendering code.
- Display-specific CSS and icons.

It must not load the planner, GLPK, habit editor, settings UI, or the owner’s local dataset.

Display behavior:

- Store the expiring device credential, content key, and latest encrypted snapshot locally after enrollment; never retain the code or invitation ID.
- Decrypt only in memory for rendering.
- Poll every three minutes while visible.
- Refresh on startup, focus, `pageshow`, and reconnect.
- Continue showing the cached agenda offline.
- Highlight the current day and current/next row.
- Allow day navigation but no logging, editing, dragging, snoozing, or detail access.
- Show `Updated … ago` at all times.
- Show a prominent stale warning after 24 hours without a newer owner publication.
- Show a revoked/expired screen without deleting the last cached agenda until the viewer explicitly clears it.
- Support fullscreen/kiosk-friendly layout, large text, dark/light system theme, screen-safe spacing, and automatic current-day return at midnight.

### Owner controls

Add a Settings section named “household agenda display” with:

- Create display feed.
- Feed title.
- Create a one-time invitation (revoking previous display access).
- Copy the invitation link and separate code independently.
- Choose weekly or monthly display reauthorization.
- Choose next-activity count or hours-ahead publication scope.
- Last published time and revision.
- Current planner provenance.
- Publish now.
- Pause automatic publishing.
- Revoke and delete feed.

Only one household agenda feed and one enrolled display session are supported per owner installation in v1.

### Publication triggers

Publish a debounced projection:

- After the initial home agenda finishes.
- When Fast is replaced or refined by GLPK.
- After a habit/task add, edit, log, undo, delete, plan, or reorder changes the visible week.
- After blocked time, availability, location, travel, or planner settings change.
- When the app starts or returns after being hidden long enough for the agenda to refresh.
- On manual “publish now.”
- Once after the local date changes.

Do not publish on presentation-only changes that do not alter the projection.

If offline, retain only the newest pending agenda snapshot; older unsent snapshots may be replaced because the feed is latest-state rather than an event history.

## Relay API

### Collaborative items

- `POST /v1/items` — create encrypted item share.
- `POST /v1/items/:id/claim` — consume one-time recipient invitation.
- `GET /v1/items/:id/changes?after=<sequence>` — pull changes.
- `PUT /v1/items/:id/definition` — owner-only conditional definition update.
- `POST /v1/items/:id/activity` — append actor-owned activity operation.
- `POST /v1/items/:id/revoke` — owner revocation.
- `POST /v1/items/:id/leave` — recipient departure.

### Agenda feeds

- `POST /v1/agendas` — create feed and register the owner credential hash.
- `POST /v1/agendas/:id/invite` — owner-only one-time invitation and access rotation.
- `POST /v1/agendas/:id/enroll` — consume the invitation and register an expiring device credential hash.
- `GET /v1/agendas/:id` — owner/device-authorized latest encrypted snapshot.
- `PUT /v1/agendas/:id` — owner-only conditional snapshot publication.
- `POST /v1/agendas/:id/pause` — owner-only pause/resume state.
- `DELETE /v1/agendas/:id` — revoke viewers and begin retention window.

Return ETags/revisions for agenda snapshots. Reject stale owner writes with `409`; the client should discard the stale projection, rebuild from current local state, and retry once.

## Testing and Acceptance Criteria

### Encryption and relay

- AES-GCM round-trip and tamper tests.
- Wrong-key and modified-AAD rejection.
- Confirmation that no plaintext content reaches Worker handlers or logs.
- Role enforcement for owner, recipient, and viewer credentials.
- One-time claim and agenda-invitation consumption, invitation expiry/burning, and display-session expiry.
- Conditional revision conflicts, retry idempotency, CORS, payload limits, rate limits, expiry, and purge behavior.
- Agenda viewers cannot call any mutation endpoint.

### Collaborative items

- Separate progress for keep-up, reduce, zero, breakable, and task items.
- Independent task completion for both participants.
- Remote activity never changes local planning in Fast or GLPK mode.
- Pre-share history is never uploaded.
- Full future log details and notes are visible to the collaborator.
- Offline concurrent activity, corrections, deletions, and duplicate retries.
- Location preview, deduplication, fresh-ID remapping, limit fallback, and omitted habit dependencies.
- Owner revocation produces a frozen recipient copy.

### Agenda display

- Projection contains only approved display fields and never raw habits, addresses, coordinates, history, settings, or internal habit IDs.
- Today/tomorrow dates remain correct across midnight and daylight-saving transitions.
- Owner timezone is preserved on viewers in a different device timezone.
- Fast, feasible GLPK, optimal GLPK, and later refinement publications replace one another by revision.
- Busy labels are generalized while travel and open-time rows render correctly.
- A copied link alone cannot enroll, and an invitation cannot enroll a second browser context.
- Viewer polling, offline cache, reconnect, 24-hour stale warning, rotation, pause, revocation, and expiry.
- QR/link fragments never appear in Worker request URLs, referrers, history, or diagnostic logs.
- Standalone display page works without loading GLPK or the owner application state.

### Repository verification and rollout

- Add the new sharing and display scripts to the service-worker precache.
- Bump `sw.js` from `tings-v115` for the JavaScript release.
- Run the full Fast/GLPK test matrix because sharing hooks modify persistence and agenda-publication timing.
- Deploy `habits-share` separately from `habits-push`.
- Stage with two isolated collaborative browsers plus three simultaneous agenda viewers.
- Enable the production sharing URL only after ciphertext inspection, revocation, offline, and stale-display tests pass.
