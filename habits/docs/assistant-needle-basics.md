# Needle basics pass

November 1, 2026. **This improves regression requests, but does not establish
reliable general understanding. Needle is not ready to be described as a finished
sole assistant interface.** The pinned model weights are unchanged.

## Scope and implementation

Focus: one-action task/habit creation, frequency or duration edits, saved-item
lists, completion and deletion. A create can contain its necessary attributes.
Combined edits and independent compound actions are outside this quality claim.
The existing multi-part workflow remains, but was not improved in this pass.

- Start with twelve stable basic schemas and their core properties. The old
  retrieval path could hide frequency behind availability and exhaust output.
  The broader catalogue remains a fallback; its accuracy was not certified.
- Check basic field coverage after model selection. Isolated record extraction
  repairs up to three fields, with one bounded item-operation reconsideration
  for incompatible slot types. Preserve valid values and require semantic
  grounding for repaired values. A failed repair asks instead of previewing a
  known omission.
- Normalize a model-supplied frequency/duration value into its uniquely valid
  field within the same saved-item edit. This does not change create/edit intent,
  invent a target, or derive a missing value from the prompt.
- Accept verified clock/date conversions and unambiguous snake/camel-case native
  validation keys. Preserve negation, unknown-field rejection, lower confidence,
  interpretation approval and separate write confirmation.
- Correct quarter-hour, hyphenated-duration, bare-duration reply and counted
  daily-repetition normalization. Pass the bounded 24-name catalogue to Needle.
- Offer an explicit action selector on clarification/proposal replies. It retries
  the original request with the user-selected tool and `ask_user` only. The model
  extracts the arguments; validation and confirmation still apply. The Mark done
  selection cannot turn into undo. Retire stale controls and clear the selection
  when the user types different text.
- Present basic starters and one-action guidance. Reject a combined
  frequency/duration edit rather than offering only half of it.

## Real-model results

All inference used the actual pinned Needle WASM and model, synthetic data, a
fixed November 1 noon clock in America/New_York, and fresh logical requests.
There was no personal-data access, training, provider substitution or simulated
inference in these measurements. One attempt per request, not repeated trials.

| Interpretation evaluation | Correct / total |
| --- | ---: |
| Previous integration, matched 45-request corpus | 17 / 45 |
| Initial implementation iteration | 32 / 45 |
| Final interpretation changes, same corpus | **38 / 45** |
| Fresh 20-request set with new names/wording | **11 / 20** |

The 45 requests include 24 earlier single-action comparison requests and 21
extensions used during development. They are regression evidence, not held-out
generalization. The fresh set was frozen before its model run; its outputs were
not used to tune schemas or prompts afterward. The subsequent action-selector
UI is a separate guided-recovery feature, not credited to free-form accuracy.

Scores require the intended operation and target, all requested values, no extra
changes and the existing applicable draft checks. A correct uncertain proposal
can count before interpretation approval. Pure negation counts when no action
survives safety checks. The missing-frequency case requires a frequency question.
The shared offline judge has 13 independent fixtures, including wrong targets,
omitted clocks/windows, extra edits and wrong completion action. Articles in
synthetic task titles and equivalent morning windows are normalized explicitly.

The matched corpus retains the earlier comparison's ten-item adapter facts,
including `keepup` labels for habits. The fresh set uses fourteen items and the
browser catalogue's normalized `habit` labels. These are adapter/worker-level
measurements, not a production success percentage across users or devices.

Five additional cases ran through an isolated real browser, production harness,
interpretation approval, validation and save. **Three completed correctly**:
frequency, duration and the 1.5-hour duration paraphrase. Their saved identities
and unaffected settings were checked; no persistence occurred before Save.
Two exposed further failures: a fully staged habit was followed by a needless
continuation that exhausted the model budget, and a time record copied
“tomorrow at 3pm” where the clock normalizer expected a clock alone. These remain
failures, despite correct-looking intermediate candidates. No browser page errors
were recorded. The new action-selector flow has deterministic interaction and
scope tests; it has not been credited as a real-model recovery success rate.

## Remaining blockers

The fresh-set result prevents a “basics are solid” claim. Remaining failures
include edit-versus-create confusion, ordinary paraphrases, output-budget
failures, dropped creation fields, correction targets, and missing-input handling.
For example, an intended recurrence edit can become a new habit, and “tick Gym
off” can become a new task. Confirmations still matter.

The browser run also shows that improving first interpretation is insufficient:
the harness can lose a correct staged result during continuation. A future
single-action completion policy needs its own implementation and browser tests.
Structured action recovery gives users a direct correction path, but does not
make these model errors disappear.

Untested: physical Android performance, cold/offline timing in this pass, large
or ambiguous libraries, broad feature routing, other languages, comprehensive
conversation follow-ups and compound completeness. Timing is retained in the
artifacts, but is not a device performance benchmark.

## Reproduction and regression material

The versioned synthetic corpus is
[`tests/fixtures/assistant-needle-basics-corpus.json`](../tests/fixtures/assistant-needle-basics-corpus.json).
It preserves all 65 requests, expectations and fixture distinctions.

Local, Git-ignored evidence is in
[`test-results/needle-basics/`](../test-results/needle-basics/): source snapshots,
raw JSONL inferences, intermediate and final runs, frozen fresh prompts, the
read-only adapter runner, offline judge, audited scores, browser script/results
and regression logs. See its `README.md` for commands. Failed experiments and
the initial browser failures are retained, not silently replaced.

The assistant regression suite covers field repair, typed edit normalization,
grounding, source retention, bounded schemas, action-choice scope, stale controls,
write confirmation and recovery. These scripted tests verify implementation;
the real-model tables above measure understanding. Service-worker cache v704
ships the JavaScript changes. No commit or deployment was made in this pass.
