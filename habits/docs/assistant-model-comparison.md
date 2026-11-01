# LFM2.5-350M Q5 versus Needle 3

Evaluated November 1, 2026. **LFM did not improve reliability under the tested
Tings tool contract. Do not replace Needle on the strength of its model card.**
Neither configuration met the reliability needed for the ordinary assistant.

## Results

Thirty frozen requests, three attempts per request per model: 180 primary
inferences. Four requests reproduce earlier live failures, six are controls,
and twenty are new paraphrases. No prompt/answer examples, fine-tuning, or
outcome-driven schema changes were used. Both models received the same twelve
task-scoped tools and synthetic app facts. These are 30 unique prompts, not 90
unique prompts per model.

A **valid exact interpretation** includes the correct action and saved target,
every requested value, no unsolicited changes, and successful applicable draft
argument checks. Equivalent units, dates and task titles are allowed. Existing
saved-name resolution is applied identically to both models. Needle's native
negation/grounding filters remain active; a correctly blocked negated action
counts as correct non-action. Correct candidates requiring interpretation approval
can count; approval, execution and saved outcomes were not tested.

| Requests interpreted correctly | Needle | LFM2.5 Q5 |
| --- | ---: | ---: |
| Four known failures, repeated three times | 9 / 12 (75%) | 6 / 12 (50%) |
| Six controls, repeated three times | 15 / 18 (83%) | 7 / 18 (39%) |
| Twenty new paraphrases, repeated three times | 27 / 60 (45%) | 21 / 60 (35%) |
| **Total** | **51 / 90 (57%)** | **34 / 90 (38%)** |
| Unique requests correct on all three attempts | 17 / 30 | 11 / 30 |

These percentages describe this small corpus and interface, not a general model
ranking or production assistant success rate. No statistical generalization is
claimed. The test is sufficient to reject the hypothesis that this configuration
of LFM is an obvious large improvement.

## What the models got wrong

Both models failed all twelve attempts at the four combined frequency/duration
requests. A plausible partial edit was a failure: “3 times a week for 30 minutes”
needs both settings.

Representative original outputs:

| Request | Needle under shared scope | LFM under shared scope |
| --- | --- | --- |
| Change Gym to 3 times a week | Correct frequency | Correct frequency |
| Change Walk to 45 minutes | Correct duration | `change_frequency(..., frequency="45 minutes")` |
| Change Gym to 3 times a week for 30 minutes | Frequency only | Frequency only |
| Add a 20 minute Stretch habit every day | Correct full habit | Correct full habit |
| Don't delete Walk | Native negation flag blocks the deletion candidate | Invents an unrelated repeating Walk habit |
| Change Read, not Walk, to 25 minutes | Output-budget failure | Proposes a new habit instead of the edit |

LFM did have strengths: it interpreted all twelve frequency-only attempts
correctly versus nine for Needle, and preserved the 3pm start in all three Send
invoice requests where Needle omitted it. Those wins did not translate into a
better overall result. LFM also denied having habit-creation tools on one fully
specified paraphrase, despite having `add_habit` in its toolset.

The benchmark found an independent app defect: the existing duration parser reads
“three quarters of an hour” as 60 minutes. Needle returned the semantically
correct 45 minutes and the existing name resolver found Walk, but draft validation
rejected the length. Those three attempts remain failures in the primary valid
count. The model should not be blamed for that normalization error.

## Current Needle integration reference

The four known failures were also repeated three times through the current
Needle worker's full 35-tool catalogue and outer retrieval/fallback path.

| Same known requests and same weights | Valid exact interpretations |
| --- | ---: |
| Current Needle worker and full catalogue | 0 / 12 |
| Needle with the fixed twelve-tool task scope | 9 / 12 |

Frequency became an hours-window change; the combined edit remained wrong;
duration and habit creation exhausted the output budget. The six budget failures
were surfaced through the existing clarification path, not counted as success.

This reproduces the user's concern about current interpretation quality. It also
shows that task/tool scope and orchestration materially affect this model. This
reference changes both outer routing and schema scope, so it does not identify
one specific cause. It is the first worker response, not the complete browser
harness, conversation, or a user-approved action. There is no equivalent full
35-tool LFM production adapter in this evaluation; compare the two models using
the shared-scope table above.

## Runtime and timing

All inference was local on an Apple M1 Max, 64 GiB RAM. Needle used the pinned
production WASM and unmodified vendored glue in Node. LFM used Ollama 0.32.14 in
an isolated model store, CPU-only, one thread, with zero GPU-offloaded layers.
Both used an 8192-token context setting and a 768-token output limit. LFM used
temperature zero and seeds 42/43/44; Needle retained its pinned API arguments.
No concurrent model inference was run. Contexts were logically fresh, while
runtime embedding/prefix caches could remain warm.

| Inference wall time | Median | 95th percentile |
| --- | ---: | ---: |
| Needle, shared scope | 0.76 s | 1.47 s |
| LFM, shared scope | 5.56 s | 6.12 s |
| Needle, current full worker | 12.61 s | 17.84 s |

Native CPU versus WASM and their different cache behavior confound a model-only
speed comparison. LFM had already loaded for a transport smoke check; cold startup
was not compared. These figures do not establish browser or Android performance.
Ollama reported about 500 MB of loaded allocation for this 260 MB model at the
tested context; this is not a measured process-memory peak.

## Scoring audit

Full raw outputs and the original strict scores are retained. Initially strict
raw candidate scores were 45/90 for Needle and 34/90 for LFM. The audited score
credits the actual saved-name resolver and native safety checks, then checks
draft arguments. Before draft checks, Needle had 54 correct interpretations or
correct non-actions; the quarter-hour parser defect reduces that to 51. LFM
remains at 34. Fifteen independent judge fixtures cover missing combined fields,
wrong targets, duration, dates, negation, undo versus completion, defaults and
unrequested changes. Expected answers never changed.

Needle had three output-budget failures in the shared-scope test; LFM had no
runtime failures. Its three prose refusals of a supported habit create are
retained as failures. Thirty-nine of Needle's 51 valid results would still require
the existing interpretation approval. LFM has no matching confidence head in this
adapter; the absence of that gate is not evidence it is safe to auto-approve.
Both would still need the normal write confirmation.

Existing schema descriptions contain example values shared by both models. No
solved test conversations or expected answers were provided. “Unseen” means not
used to tune this evaluation, not a claim about either model's pretraining data.

## Artifacts and reproduction

The local evaluation directory is
[`test-results/lfm-needle-comparison/`](../test-results/lfm-needle-comparison/).
It contains the frozen corpus, reusable runner, safe literal-call parser, shared
schemas, source snapshots, complete JSONL responses, audited rows, summary,
runtime evidence, judge fixtures and reproduction instructions. Scratch results
are excluded from Git. The recorded application commit is supplemented by exact
working-source hashes because recovery edits were already uncommitted.

The official LFM Q5 file is 260,376,288 bytes, from repository revision
`657e078c94084481950a2d555a941481f715536b`, SHA-256
`e8985a31d95fab69e894216ce1712b57a55f1561093ec7cf408b781834eb8435`.
Needle's existing model and WASM hashes are also checked before every run.
See the [official Q5 artifact](https://huggingface.co/LiquidAI/LFM2.5-350M-GGUF/blob/657e078c94084481950a2d555a941481f715536b/LFM2.5-350M-Q5_K_M.gguf)
and [model's documented tool format](https://huggingface.co/LiquidAI/LFM2.5-350M).

No product behavior was changed during this comparison. Personal app data was
never loaded and no inferred action was executed or saved. Untested: actual
browser/Android inference and memory, UI, confirmation/persistence, conversation
follow-ups, larger libraries, broader tools, other languages, model-specific
schema optimization and fine-tuning.

## Decision

Keep LFM as an experimental candidate, not the replacement. First address tool
exposure, typed extraction, completeness of requested changes, and the existing
normalization defect. Evaluate those changes with this frozen corpus plus a new
held-out set. A future LFM-specific adapter or fine-tune needs its own measured
comparison; this result does not prove no such configuration can improve.

## Per-request ledger

Counts below are valid exact interpretations out of three attempts. Missing
fields and unsolicited changes fail the whole request; there is no partial credit.

| Request | Needle | LFM |
| --- | ---: | ---: |
| Change Gym to 3 times a week | 3/3 | 3/3 |
| Change Walk to 45 minutes | 3/3 | 0/3 |
| Change Gym to 3 times a week for 30 minutes | 0/3 | 0/3 |
| Add a 20 minute Stretch habit every day | 3/3 | 3/3 |
| Add a task to buy milk | 3/3 | 0/3 |
| Remind me to call mom tomorrow | 0/3 | 1/3 |
| What habits do I have? | 3/3 | 3/3 |
| Mark Walk as done | 3/3 | 0/3 |
| Don't delete Walk | 3/3 | 0/3 |
| Add a task to buy milk tomorrow. Add a task to call the bank tomorrow. | 3/3 | 3/3 |
| I'd like Gym to happen three times each week. | 3/3 | 3/3 |
| Set the repetition for Meditate to every other day. | 3/3 | 3/3 |
| Make Read twice a week instead. | 0/3 | 3/3 |
| Each Walk session should last three quarters of an hour. | 0/3 | 0/3 |
| Give Journal a session length of half an hour. | 3/3 | 0/3 |
| I want to spend 1.5 hours on Read each time. | 0/3 | 0/3 |
| Make Gym three times per week, with each session lasting half an hour. | 0/3 | 0/3 |
| For Meditate, use 15-minute sessions twice a week. | 0/3 | 0/3 |
| Read for 45 minutes per session, four times a week. | 0/3 | 0/3 |
| Create a daily habit called Stretch lasting twenty minutes. | 0/3 | 0/3 |
| I'd like a new habit named Sketch: ten minutes, three times a week. | 3/3 | 0/3 |
| Add Breathe as a habit, every other day for five minutes. | 0/3 | 0/3 |
| Put calling the bank on my task list for tomorrow. | 3/3 | 0/3 |
| Create a task called Book haircut, due November 3, 2026. | 3/3 | 3/3 |
| Add Send invoice to my tasks for tomorrow at 3pm. | 0/3 | 3/3 |
| I've finished Meditate; mark it complete. | 3/3 | 3/3 |
| Show me my repeating habits. | 3/3 | 3/3 |
| Keep Walk; I do not want it deleted. | 3/3 | 0/3 |
| Change Read, not Walk, to 25 minutes. | 0/3 | 0/3 |
| Set Walk to 45 minutes and make Gym twice a week. | 0/3 | 0/3 |
