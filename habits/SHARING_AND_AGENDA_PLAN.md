# Encrypted Item Sharing and Household Agenda Displays

## Summary

Add one dedicated Cloudflare sharing service with two distinct modes:

1. **Collaborative item sharing** — two people independently track the same owner-managed habit or task.
2. **Household agenda display** — several read-only tablets, fridge screens, or family devices display the owner’s rolling seven-day agenda.

Tailscale is not required. The owner’s browser remains the planner of record. It publishes an encrypted agenda projection whenever Tings opens or its plan changes; Cloudflare stores and serves ciphertext but cannot inspect item names, notes, addresses, or agenda content.

Use SQLite-backed Durable Objects rather than Workers KV. Durable Objects provide strongly consistent, transactional per-share storage; KV can expose stale values due to eventual consistency. See [Durable Objects storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/) and [Workers KV consistency](https://developers.cloudflare.com/kv/reference/faq/).

## Shared Cloudflare Foundation

Create a new `habits-share` Worker, separate from the existing push Worker, with two Durable Object namespaces:

- `ItemShare` for collaborative individual items.
- `AgendaFeed` for read-only agenda projections.

Use client-generated random secrets:

- 128-bit opaque share/feed ID.
- 256-bit AES-GCM content key.
- Independent 256-bit owner, recipient, and viewer credentials.
- One-time claim secret for collaborative-item invitations.

Encrypt each definition, location bundle, log operation, and agenda snapshot separately with AES-256-GCM and a unique 96-bit nonce. Authenticate the schema version, object ID, record kind, revision, and operation ID as additional data.

The Worker stores only:

- Credential hashes.
- Ciphertext and nonces.
- Revisions and sequence numbers.
- Opaque operation IDs.
- Creation/access/expiry timestamps.
- Payload sizes and lifecycle status.

The encryption key remains in invitation URL fragments and is never sent to Cloudflare. Clear fragments from browser history immediately after processing.

Configure:

- Production and explicit localhost CORS origins.
- A 256 KiB item-definition limit.
- A 64 KiB individual activity-operation limit.
- A 512 KiB agenda-snapshot limit.
- A 5 MiB total limit per share/feed.
- Creation rate limiting by source IP and authenticated limits by credential/feed.
- Seven-day expiry for unclaimed item invitations.
- Thirty-day retention after revocation.
- Twelve-month expiry after the last authenticated request for abandoned active objects.
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

1. Builds the normal rolling seven-day plan using Fast or GLPK.
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

- Include today plus the next six days.
- Preserve the owner’s timezone; do not reinterpret times using the viewer device’s timezone.
- Include the full visible timeline: habits, tasks, planned items, travel, busy time, and open-time summaries.
- Replace custom blocked-time labels with the generic title `Busy`.
- Include saved location names used in visible rows, but never addresses or coordinates.
- Include travel endpoint labels only when already displayed by the owner.
- Exclude notes, log history, numeric values, phone/web links, unrelated habits, planner diagnostics, scarcity scores, and settings.
- Use random projection row IDs rather than local habit IDs or array indices.

Publish the agenda currently shown to the owner. If an initial Fast plan is later replaced or refined by GLPK, publish a new revision. This keeps the household display aligned with the owner’s actual screen rather than claiming every projection is solver-optimal.

### Viewer enrollment

Create one reusable, revocable viewer link per agenda feed:

```text
https://tings.example/agenda-display.html#feed=<id>&key=<content-key>&viewer=<credential>
```

Provide:

- Web Share support for messages/WhatsApp.
- Copy-link fallback.
- A locally generated QR code for fridge and wall-mounted displays.
- A neutral message that does not contain agenda titles or locations.

The same link may enroll multiple read-only household screens. Because they share one viewer credential, v1 revocation applies to all viewers together.

Rotating access:

1. Generate a new content key and viewer credential.
2. Publish the current agenda under the new key.
3. Invalidate the previous viewer credential.
4. Generate a replacement link/QR code.
5. Require desired screens to enroll again.

### Standalone display page

Add a lightweight `agenda-display.html` that loads only:

- Shared crypto/network utilities.
- Agenda-display rendering code.
- Display-specific CSS and icons.

It must not load the planner, GLPK, habit editor, settings UI, or the owner’s local dataset.

Display behavior:

- Store feed credentials and the latest encrypted snapshot locally after enrollment.
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
- Share link.
- Show QR code.
- Copy/share invitation.
- Last published time and revision.
- Current planner provenance.
- Publish now.
- Pause automatic publishing.
- Rotate viewer access.
- Revoke and delete feed.

Only one household agenda feed is supported per owner installation in v1. Individual viewer-device management is deferred because the selected reusable-link model intentionally uses one shared viewer credential.

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

- `POST /v1/agendas` — create feed and register owner/viewer credential hashes.
- `GET /v1/agendas/:id` — viewer-authorized latest encrypted snapshot.
- `PUT /v1/agendas/:id` — owner-only conditional snapshot publication.
- `POST /v1/agendas/:id/rotate` — owner-only credential/key-generation transition.
- `POST /v1/agendas/:id/pause` — owner-only pause/resume state.
- `DELETE /v1/agendas/:id` — revoke viewers and begin retention window.

Return ETags/revisions for agenda snapshots. Reject stale owner writes with `409`; the client should discard the stale projection, rebuild from current local state, and retry once.

## Testing and Acceptance Criteria

### Encryption and relay

- AES-GCM round-trip and tamper tests.
- Wrong-key and modified-AAD rejection.
- Confirmation that no plaintext content reaches Worker handlers or logs.
- Role enforcement for owner, recipient, and viewer credentials.
- One-time claim consumption and reusable agenda-view enrollment.
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
- Rolling seven-day dates remain correct across midnight and daylight-saving transitions.
- Owner timezone is preserved on viewers in a different device timezone.
- Fast, feasible GLPK, optimal GLPK, and later refinement publications replace one another by revision.
- Busy labels are generalized while travel and open-time rows render correctly.
- Multiple browser contexts can enroll from the same viewer link.
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
