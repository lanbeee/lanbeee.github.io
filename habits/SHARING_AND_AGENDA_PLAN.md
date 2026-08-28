# Encrypted Item Sharing and Shared Displays

## Summary

Add one dedicated Cloudflare sharing service with two distinct modes:

1. **Collaborative item sharing** — two people independently track the same owner-managed habit or task.
2. **Shared display** — one authorized tablet, fridge screen, or family device displays a capped view of today and tomorrow and can submit narrowly scoped completion events.

Tailscale is not required. The owner’s browser remains the planner of record. It publishes an encrypted agenda projection whenever Tings opens or its plan changes; Cloudflare stores and serves ciphertext but cannot inspect item names, notes, addresses, or agenda content.

Use SQLite-backed Durable Objects rather than Workers KV. Durable Objects provide strongly consistent, transactional per-share storage; KV can expose stale values due to eventual consistency. See [Durable Objects storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/) and [Workers KV consistency](https://developers.cloudflare.com/kv/reference/faq/).

## Shared Cloudflare Foundation

Create a new `habits-share` Worker, separate from the existing push Worker, with two Durable Object namespaces:

- `ItemShare` for collaborative individual items.
- `AgendaFeed` for encrypted agenda projections plus a bounded, completion-only event queue.

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

Collaborative-item encryption keys remain in invitation URL fragments. Agenda displays do not use enrollment links: a 30-second QR binds the display’s ephemeral public key, while a separate 8-digit code is visible only on the display. The owner phone encrypts the rotated content key directly to that display key.

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
- Two-minute, single-use agenda QR pairings; burn after five invalid display codes.
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

## Mode 2: Shared Display

### Architecture

Publish a derived agenda projection rather than the complete habit database. The display cannot edit snapshots or item definitions; its only write capability is submitting a completion event tied to a row in the current encrypted snapshot.

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
      completable,
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
- Omit any item whose `showOnSharedDisplay` switch is off; legacy and new items default on.

Publish the agenda currently shown to the owner. If an initial Fast plan is later replaced or refined by GLPK, publish a new revision. This keeps the shared display aligned with the owner’s actual screen rather than claiming every projection is solver-optimal.

### QR-only viewer pairing

There is no enrollment-link or copied-code fallback. An unpaired display creates:

- A random 128-bit pairing ID.
- An ephemeral P-256 ECDH key pair whose private key remains in display memory.
- A random 256-bit polling credential and 256-bit display credential; the Worker stores only their hashes.
- A separately generated 8-digit code shown on the display but omitted from the QR.

The QR opens Tings on the owner phone and contains only the pairing ID and display public key. The owner phone must already hold the feed owner credential, must retrieve and exactly match the Worker-held public key to the QR, must manually receive the 8-digit code from the visible display, and must explicitly approve.

On approval, the owner phone rotates the agenda content key and encrypts it directly to the QR-bound display public key using ECDH-derived AES-GCM. The Worker relays only that ciphertext. It cannot decrypt the content key. Successful approval revokes the previous display session; merely creating a QR does not, preventing unauthenticated denial of service.

Pairing requests work once, expire after 30 seconds, and are destroyed after five wrong codes. QR links opened by a phone Camera app are rejected; only Tings' in-app scanner can begin approval. The display consumes and destroys the delivered transfer after decrypting it. A fresh QR scan is mandatory after the selected 7- or 30-day session expires.

### Standalone display page

Add a lightweight `agenda-display.html` that loads only:

- Shared crypto/network utilities.
- Agenda-display rendering code.
- Display-specific CSS and icons.

It must not load the planner, GLPK, habit editor, settings UI, or the owner’s local dataset.

Display behavior:

- Store the expiring device credential, content key, and latest encrypted snapshot locally after pairing; never retain the pairing code, pairing ID, polling credential, or ephemeral private key.
- Decrypt only in memory for rendering.
- Poll every three minutes while visible.
- Refresh on startup, focus, `pageshow`, and reconnect.
- Continue showing the cached agenda offline.
- Highlight the current day and current/next row.
- Allow one-tap completion for completable rows scheduled for today. Tomorrow is view-only until its date; stop-type habits are never mislabeled as done.
- Allow no definition editing, dragging, snoozing, detail access, or arbitrary log payloads.
- Show `Updated … ago` at all times.
- Show a prominent stale warning after 24 hours without a newer owner publication.
- Erase the cached credential, key, and agenda as soon as expiry is known or the Worker returns `401`/`410`; an offline display cannot be remotely erased until it reconnects.
- Support fullscreen/kiosk-friendly layout, large text, dark/light system theme, screen-safe spacing, and automatic current-day return at midnight.

### Owner controls

Add a Settings section named “shared display” with:

- Create display feed.
- Feed title.
- Explain the stable, non-authorizing display-page address and QR-only pairing steps.
- Choose weekly or monthly display reauthorization.
- Choose next-activity count or hours-ahead publication scope.
- Last published time and revision.
- Current planner provenance.
- Publish now.
- Pause automatic publishing.
- Revoke and delete feed.

Only one shared-display feed and one enrolled display session are supported per owner installation in v1.

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
- `GET /v1/agendas/:id` — owner/device-authorized latest encrypted snapshot.
- `PUT /v1/agendas/:id` — owner-only conditional snapshot publication.
- `POST /v1/agendas/:id/completions` — paired-display-only encrypted completion for an opaque row in the current snapshot revision.
- `POST /v1/agendas/:id/completion-acks` — owner-only acknowledgement after the local log and replacement snapshot are saved.
- `POST /v1/agendas/:id/pause` — owner-only pause/resume state.
- `DELETE /v1/agendas/:id` — revoke viewers and begin retention window.

### Agenda pairings

- `POST /v1/agenda-pairings` — display creates a 30-second request.
- `GET /v1/agenda-pairings/:id` — owner phone verifies the QR-bound public key.
- `POST /v1/agenda-pairings/:id/approve` — owner-only approval using the display-visible code.
- `GET /v1/agenda-pairings/:id/status` — display-only polling for the encrypted key transfer.
- `POST /v1/agenda-pairings/:id/consume` — destroy the delivered transfer.

Return ETags/revisions for agenda snapshots. Reject stale owner writes with `409`; the client should discard the stale projection, rebuild from current local state, and retry once.

## Testing and Acceptance Criteria

### Encryption and relay

- AES-GCM round-trip and tamper tests.
- Wrong-key and modified-AAD rejection.
- Confirmation that no plaintext content reaches Worker handlers or logs.
- Role enforcement for owner, recipient, and viewer credentials.
- One-time claim and QR-pairing consumption, 30-second pairing expiry/burning, and display-session expiry.
- Conditional revision conflicts, retry idempotency, CORS, payload limits, rate limits, expiry, and purge behavior.
- Agenda viewers cannot mutate snapshots, definitions, pause state, acknowledgements, or feed lifecycle; their sole write capability is a bounded, deduplicated completion for a current opaque row.

### Collaborative items

- Separate progress for keep-up, reduce, zero, breakable, and task items.
- Independent task completion for both participants.
- Remote activity never changes local planning in Fast or GLPK mode.
- Pre-share history is never uploaded.
- Full future log details and notes are visible to the collaborator.
- Offline concurrent activity, corrections, deletions, and duplicate retries.
- Location preview, deduplication, fresh-ID remapping, limit fallback, and omitted habit dependencies.
- Owner revocation produces a frozen recipient copy.

### Shared display

- Projection contains only approved display fields and never raw habits, addresses, coordinates, history, settings, or internal habit IDs.
- Today/tomorrow dates remain correct across midnight and daylight-saving transitions.
- Owner timezone is preserved on viewers in a different device timezone.
- Fast, feasible GLPK, optimal GLPK, and later refinement publications replace one another by revision.
- Busy labels are generalized while travel and open-time rows render correctly.
- A QR alone cannot enroll without the owner credential, separately visible code, and explicit approval; a pairing cannot enroll a second browser context.
- Viewer polling, offline cache, reconnect, 24-hour stale warning, rotation, pause, revocation, and expiry.
- Pairing secrets and the display-visible code never appear in the QR, Worker request URLs, referrers, history, or diagnostic logs.
- Standalone display page works without loading GLPK or the owner application state.
- Per-item opt-out defaults on, removes the item from future projections, and is available from the item detail Actions page.
- Completion events use server timestamps, current-revision row binding, per-row deduplication, a 50-event queue cap, encrypted payloads, and owner-only acknowledgement after durable local application.

### Repository verification and rollout

- Add the new sharing and display scripts to the service-worker precache.
- Bump `sw.js` from `tings-v115` for the JavaScript release.
- Run the full Fast/GLPK test matrix because sharing hooks modify persistence and agenda-publication timing.
- Deploy `habits-share` separately from `habits-push`.
- Stage with two isolated collaborative browsers plus three simultaneous agenda viewers.
- Enable the production sharing URL only after ciphertext inspection, revocation, offline, and stale-display tests pass.
