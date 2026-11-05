# Personal-clone security

Reviewed and hardened on 2026-11-04. This is an engineering record, not a claim
of a formal penetration test or a guarantee against every attack.

## Trust boundaries

- The PWA runs at `https://lanbeee.github.io`; the installed Capacitor app runs
  from packaged assets at `https://localhost`. Production permits exactly these
  two Origin values. Missing, opaque (`null`), HTTP, alternate-port, suffix and
  multi-origin values are rejected for API requests. The public health endpoint
  also supports monitors without an Origin header.
- The PWA repository is public; Android and Worker repositories are private.
  Public source is expected and contains no deployment or device secrets.
  Other pages on `lanbeee.github.io` share the PWA's browser origin and must be
  equally trusted: a URL path is not a storage/CORS isolation boundary. A pattern
  scan of 539 tracked text files found no fixed sync secrets/private keys/tokens
  or sensitive backup filenames. This was not a complete history secret audit.
- An Origin is **not an app identity or a credential**. Other Android apps can
  use `https://localhost`, and non-browser clients can forge Origin headers.
  Every private feed request independently requires its own random 256-bit
  bearer credential. Credentials from another library or installation do not
  authorize a request. CORS never grants access by itself.
- The relay holds encrypted planner envelopes, credential hashes and delivery
  metadata. AES-256-GCM encryption happens on the client with random 96-bit
  nonces. Authenticated associated data binds schema, object, record kind,
  revision and operation ID. Separate content and replica keys keep a glance
  session from decrypting the full library. Content keys are not sent to the
  relay in plaintext.
- Pairing uses a pinned P-256 public key in the scanned QR, a separately displayed
  eight-digit code, a 30-second request, owner authorization and a single-use
  consume step. Five incorrect authorized attempts destroy the request. The
  transfer is encrypted using ephemeral ECDH keys; its associated data binds
  the feed and pairing. Private pairing keys are non-exportable and remain in
  memory. Polling and device credentials are distinct.
- Device sessions expire after the selected week or month. Authorization checks
  enforce expiration without relying on cleanup alarms. A revoked credential
  cannot read updates or submit changes. Only the owner can delete the feed or
  publish its complete library envelope.

## Additional controls

- API bodies require JSON, are bounded while streaming, and reject invalid UTF-8.
  IP, creation, enrollment and credential rate limits restrict abuse. Only
  Cloudflare's connecting-IP header selects the IP bucket, not X-Forwarded-For.
- Preflights validate the requested method and headers. There are no wildcard
  origins or cookie credentials. CORS policy has a ten-minute preflight cache.
- The client accepts only the two exact HTTPS production/staging relay URLs,
  rejects unsafe API paths and redirects, and explicitly omits cookies and
  referrers. Responses are uncacheable in browsers and at the CDN, with HSTS,
  nosniff and framing restrictions. App pages use CSP; third-party executable
  libraries are pinned with integrity checks, including the PDF worker bytes.
- Android disables cleartext/mixed content, file/content access, automatic
  JavaScript windows, WebView debugging and Capacitor's HTTP fetch override.
  Only the exact packaged Home and display documents can navigate inside the
  privileged WebView. External links from a user gesture open outside it.
  HTTP/file/content proxy paths are rejected even as subresources.
- Notification, alarm and widget completions share a private durable journal.
  An event-driven WorkManager job runs shared completion/encryption code in a
  disposable asset-only WebView. Its native relay method allows only bounded
  HTTPS requests to the two pinned relay hosts and agenda GET/PUT or completion
  POST routes; redirects, arbitrary hosts and WebView network loads remain
  blocked. Local application and remote delivery acknowledge independently.
  Background publication never acknowledges inbound edits or writes the
  foreground WebView's editable storage; foreground resume cancels the runner.
  Paired Android installations also receive completions on a network-constrained
  15-minute job. Only validated actual logs enter the durable journal; background
  reception leaves definition edits and relay acknowledgements for foreground
  sync. Incoming logs cancel resolved reminders and invalidate older planner
  output before it can restore them. Unpaired installations do not poll.
- Android excludes app storage from cloud backup and device transfer. The main
  app window sets FLAG_SECURE to restrict screenshots, recordings and recent-app
  previews; obscured touches are filtered against overlay tapjacking. Native
  permissions remain subject to Android's permission system.
- Worker application logs contain method, route template and status rather than
  bodies, bearer values or encryption keys. Client diagnostic summaries describe
  key presence/format without exposing key bytes. Development tools are not
  included in the deployed Worker or APK's web runtime.

## Limits and incident response

Encryption protects planner contents from passive network observers and from a
relay database reader who lacks client keys. Cloudflare can still observe IP
addresses, request timing, sizes, opaque identifiers and credential hashes; this
is not an anonymous traffic system. Optional map/weather/location services also
receive the coordinates needed for those features.

An unlocked, rooted, compromised or maliciously modified device can access what
its user can access. Keys and decrypted planner data live in app-private WebView
storage protected by Android's sandbox and device encryption, not a separate
application Keystore vault. A four-digit display passcode is a local UI lock,
not encryption of the stored library. FLAG_SECURE cannot stop someone using an
external camera. An intentionally authorized clone receives its permitted data.

Revocation blocks future relay access; it cannot erase copies a device already
received. Targeted revocation does not rotate the shared encryption keys. If
device/key compromise is suspected, revoke the entire feed with the owner's
stop-sharing control and create/pair a new feed: this generates fresh feed IDs,
credentials, content and replica keys. Re-pair only devices you trust. Preserving
unaffected sessions during automatic cryptographic key rotation would require a
separate per-device key-distribution protocol; it is not implemented here.

PWA hosting/source integrity, signed Android releases, dependency updates and
the security of the owner's Cloudflare/GitHub accounts remain part of the trust
boundary. Do not enable arbitrary navigation, native HTTP proxying or wildcard
CORS to work around a pairing problem. Keep development servers on loopback.

## Verification

- Worker tests cover malformed origins/preflights, unauthenticated native
  requests, cross-library credentials, owner-only operations, expiry, revocation,
  replay/conflict handling, pairing attempt limits and payload limits.
- `tests/share-security-test.js` exercises real browser Web Crypto: round trips,
  nonce uniqueness, ciphertext/AAD tampering, wrong keys/devices, transfer
  binding and glance/library key separation. It also verifies real fetch
  redirects do not forward request bodies and that unsafe relay targets fail.
- `tests/native-clone-pairing-test.js` includes both real Capacitor detection
  and the native adapter flag, canonical QR validation and production selection.
- Android's `SecureAppWebViewClientTest` covers origin/port/path/scheme attacks,
  external navigation and proxy subresource rejection. Packaging checks enforce
  backup, debug, transport and native HTTP settings.
- Production dependency audit: no npm advisories in runtime dependencies at
  review time. Compatible dependency updates were applied. Development-only
  advisories remain in the Cloudflare test pool's pinned sharp/undici/zod and
  the local preview server's compression/minimatch dependencies. They are not
  shipped as Worker runtime dependencies or Android web assets; do not expose
  those development tools to untrusted traffic. Forced tool downgrades were not
  applied to silence the audit.

References: [Android native-bridge security](https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges),
[Capacitor configuration](https://capacitorjs.com/docs/config),
[Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).
