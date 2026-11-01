# Needle as the everyday assistant

Assessment: 2026-11-01. This is an implementation review and a small live probe,
not a comprehensive readiness certification. The local-server providers should
remain optional advanced integrations; the ordinary experience must stand alone.

The subsequent [basics implementation](assistant-needle-basics.md) improves the
matched 45-request regression set from 17 to 38 correct interpretations, but gets
only 11/20 on fresh requests. It implements bounded field repair and explicit
action recovery; the remaining model and harness failures are still blockers.

The subsequent [LFM2.5 Q5 comparison](assistant-model-comparison.md) measured
30 requests three times per model. LFM did not outperform Needle under the shared
tool contract. The separate current-worker reference also reproduced all four
known failures. These results support investigating interpretation scope and
completeness before selecting a replacement model; neither tested configuration
is ready as the sole assistant interface.

## Architecture today

The architecture has changed substantially since the initial Needle integration.
The current path is deferred loader → explicit verified model download → worker
inference → literal request workflow → validated tools → confirmation → existing
app persistence. It already shares the application's tools and planner rather
than maintaining a second planner or database.

The worker retrieves candidate schemas with embeddings, tries extraction, and
can fall back to an identity menu and another extraction pass. There are narrow
aliases for common item controls, an 8192-token context, bounded continuation,
clarification state, and a queue for compound requests. These are useful building
blocks. Replacing the entire architecture would throw away working validation,
confirmation, offline support, and entry-point integration.

The remaining difficulty is semantic accuracy and interaction cost. Keeping all
the words in literal slices does not prove every requested constraint was applied.
Likewise, a valid tool call or a high confidence score does not prove correctness.

## Evidence from this pass

The reproducible local probe is `test-results/needle-first-attempt-audit.js`;
initial responses and traces are in `needle-first-attempt-audit.json` beside it.
It uses the actual pinned worker/model, verified local asset bytes, ten synthetic
saved items, a frozen 2026-11-01 noon clock in America/New_York, and fresh sessions
for each request. It does not approve interpretations or save previews. Runtime
is warm after the first case. Other tests ran concurrently, so timings are not a
device performance benchmark.

Ten requests returned seven interpretation proposals, two clarifications, and
one runtime error. All ten left persisted domain data unchanged. Examples:

| Request | Initial observation |
| --- | --- |
| Add a task to buy milk | Correct-looking proposed task, but an extra approval before preview |
| Remind me to call mom tomorrow | Correct-looking title and November 2 due date, extra approval |
| Add a 20 minute Stretch habit every day | Native JSON token-budget failure |
| Change Gym to 3 times a week | Empty `create:false, name:Gym` edit offered for approval |
| Change Walk to 45 minutes | Clarification about confusing duration and clock time |
| Change Gym to 3 times a week for 30 minutes | Frequency extracted as allowed hours; requested duration absent |
| What habits do I have? | Correct-looking read proposal, extra approval |
| Mark Walk as done | Correct-looking completion proposal, extra approval |
| Don't delete Walk | Clarification; no deletion |
| Two dated task requests | Approval for first task; later completion not tested |

The existing optional live smoke test also failed its daily-habit assertion.
Its helper automatically approves proposals, so even a passing smoke run would
not measure first-response usability. The earlier scratch failure report describes
older code; its percentages must not be presented as current results.

This sample is deliberately small: one attempt per wording, one library, one
desktop browser, no approved-action completion score, no actual Android keyboard,
no weather-service coverage, and no comprehensive field or conversation matrix.
Use `assistant-live-needle-testing.md` for the wider proposed evaluation, when
available. Scratch artifacts are local and excluded from commits.

## Follow-up: why the changes can feel ineffective

The user reported that the latest commit still misinterprets ordinary requests.
The live failures support that report. Recovery, validation, and staging tests
cannot substitute for exact semantic completion against the actual model.

The current first pass selects at most two closed edit aliases by embedding
similarity. It does not expand every sibling control, despite the routing notes
in `assistant.md`. An actionable partial call also bypasses fallback routing;
being actionable does not mean it covers every requested field. These are
specific integration concerns, not evidence that either alone explains all
errors.

Diagnostic ablations are reproducible in `test-results/needle-schema-ablation.js`
and `needle-frequency-ablation.js`, with JSON results beside them. They load the
unaltered pinned WASM and model directly in Node, use production schema/envelope
helpers with synthetic data, and run the production worker. They do not test the
browser UI or workflow. Oracle variants supply the edit operation or field family
in advance; their results must never count as end-to-end assistant successes.

Across three original edit requests, production-schema inference misread frequency,
hit a token-budget error on duration, and misread/omitted fields on the combined
request. A small edit menu extracted duration correctly but still misread frequency
and omitted the frequency in the combined request. One generic edit record also
lost frequency. A smaller schema alone is therefore not a demonstrated solution.

An isolated frequency tool extracted the frequency phrase in both frequency
requests, although the combined request's call was suppressed. A typed record
with `name`, integer `repetitions`, and enum `period` returned Gym / 3 / week for
both requests. This supports testing typed extraction as a component; it does
not establish routing, duration merging, general recurrence coverage, confidence
calibration, or full-request completion. Each variant was run once.

The upstream [tool-design guide](https://cactuscompute.com/blog/designing-tools-for-needle)
recommends narrow tools and small toolsets, and explains that instruction text
does not steer Needle like a chat model. Its
[extraction guide](https://cactuscompute.com/blog/structured-extraction-with-needle)
describes single-record typed extraction. These current upstream guides inform
experiments; they do not prove the pinned engine's behavior or Tings accuracy.

The next implementation should compare the unchanged baseline against explicit
operation selection plus typed field extraction, using original prompts and
held-out paraphrases. Keep the existing executor, confirmation, persistence,
and offline transport. If that approach cannot pass ordinary requests, evaluate
specialization or a different on-device model rather than adding more repair
prompts and reporting plumbing passes as understanding improvements.

## Implemented in this pass

1. Runtime resets now differ from user cancellation. Worker crashes and timeouts
   release the worker and reject pending calls without invalidating the workflow
   generation. Earlier drafts and the remaining queue survive for retry. Explicit
   cancellation still invalidates that generation.
2. Retry diagnostics retain the earlier attempt as well as resumed work.
3. Native failures returned as JSON use the same error path as thrown failures.
   Token-budget failures now reach the existing short clarification handler.
4. An explicitly empty edit is rejected before interpretation approval. The
   user is asked for a concrete setting/value instead of approving “Change Gym”.

These changes improve recovery and prevent a misleading interaction. They do
not make the model understand the missing frequency or fix the wrong window
extraction. Tests cover crashes, timeout cleanup, restart, cancellation, multi-part
retry without duplicate drafts or writes, retained diagnostics, JSON failures,
and the empty-edit approval boundary. The service-worker cache is bumped.

## Next implementation stages

| Priority | Change | Evidence required before shipping |
| --- | --- | --- |
| 1 — understanding | Make item extraction a typed operation with explicit target and requested fields. Keep frequency, duration, date, clock and window extraction separate when needed; merge through existing validators. Preserve original text and stable item identity. | Matched minimal pairs and ordinary paraphrases with every requested field asserted, including unchanged fields and no duplicate item |
| 1 — completeness | Maintain per-request status: pending, needs clarification, staged, confirmed, failed. Record source spans for model-extracted constraints and which validated field covers each. An uncertain or unaccounted-for constraint stays visible. | Multi-part and trailing-constraint cases; missing-field detection; continuation through ambiguity, failure, correction and cancellation |
| 1 — review | Show exact changes with before/after values and inline corrections. For uncertain proposals, include every argument and filter, not just a subset of friendly labels. | Users can see the actual target, frequency, duration, dates, filters and affected item count before any write |
| 2 — conversation | Let users answer a focused question or tap a structured choice when extraction fails. Keep corrections bound to the current request/draft and expose the unfinished part. | Follow-up chains, ambiguous names, rename, pronouns, focus changes and stale controls |
| 2 — latency | Measure split, retrieval, extraction, continuation and cold load separately. Avoid unnecessary passes using explicit entry intent and structured interaction state. Bound selected schema size before initialization. | Cold/warm distributions on actual Android hardware and desktop; identical accuracy corpus before and after |
| 2 — onboarding | Present one on-device setup flow with download, progress, retry, removal and offline status. Put server configuration under advanced settings. Offer a few tested examples matched to the current screen. | First-use completion on a phone, interrupted download, storage eviction, offline reload, keyboard-visible next action |
| 3 — model specialization | Evaluate product-specific training or a replacement runtime only against a held-out Tings corpus, including realistic library sizes and unsupported requests. | Material improvement in exact semantic completion without unacceptable device memory, download size or latency costs |

Source spans and additional extraction passes are hypotheses to evaluate, not a
proof of completeness. Do not add a keyword router that bypasses the documented
model-first contract, or trust a second model pass merely because it agrees with
the first. Structured controls can call validated tools directly when the user
explicitly selected that operation.

Keep interpretation approval distinct from write confirmation while that is the
current contract. Removing a gate requires a deliberate redesign with a complete
editable preview and corresponding tests. Lowering the 0.7 threshold alone would
make the observed wrong proposals easier to accept; it would not improve extraction.

## Release standard

Maintain a versioned, semantic real-model corpus in addition to mocked regression
tests. Report first-attempt completion, valid-clarification completion, interpretation
approval rate, wrong-target/field rates, omissions, total interactions, and latency
by family. Keep failed attempts and unsupported cases in the denominator. Set
numeric targets after collecting a representative baseline; do not manufacture a
readiness percentage from ten examples.

Any unconfirmed write, wrong-target destructive action, ignored destructive
negation, fabricated factual answer, or silent omission presented as completion
blocks a readiness claim. Physical Android and keyboard checks remain necessary.

The next substantial step is the typed extraction/completeness work backed by
that corpus. Recovery hardening is useful groundwork, but the current evidence
does not support calling Needle a reliable sole assistant interface yet.
