# Compaction runtime evidence retry repair — 2026-05-24

## Problem

Task `tsk_e5894b981001dZJs5p0E2Dt6P1` G28 repeatedly failed in build-session compaction, not in the chart implementation. The durable error was:

`StructuredOutputPayloadError: Compaction handoff did not match the required structured contract.`

Concrete failures alternated between omitted `files` and omitted `errorsAndBlockers` runtime evidence. The prior bad repair `2c11b5cb4` made the host synthesize missing evidence after model output. That violated the project rules because it introduced fallback, dual evidence sources, and host-fabricated handoff facts.

## Call-site inventory

| Surface | Location | Decision |
| --- | --- | --- |
| Compaction structured format | `packages/opencorvus/src/session/compaction.ts::handoffOutputFormat` | Change retry budget from zero to a bounded retry count so validation feedback can reach the model. |
| Compaction provider call | `packages/opencorvus/src/session/compaction.ts::process` | Pass a structured-output step limit to the existing stream call. |
| LLM stream wrapper input | `packages/opencorvus/src/session/llm.ts::StreamInput` | Thread `stopWhen` through to AI SDK `streamText`; no behavioral change unless a caller opts in. |
| Handoff prompt | `packages/opencorvus/src/session/compaction-handoff.ts::MODEL_OUTPUT_INSTRUCTIONS` | Clarify that a StructuredOutput tool error must be corrected by reissuing the tool call. |
| Evidence validator | `packages/opencorvus/src/session/compaction-handoff.ts::validateMinimumEvidence` | Keep strict; do not synthesize or relax required evidence. |

## Design

The schema and runtime evidence validator remain the single source of truth. When the model omits required evidence, the StructuredOutput tool returns a real tool error. Compaction now allows bounded additional model steps so the model can read that error and call StructuredOutput again with a corrected handoff.

No host-generated `files`, `errorsAndBlockers`, or evidence entries are created. The host only sets the number of allowed tool-feedback steps and preserves the validator's error text.

## Tests

- Assert compaction format exposes retry budget.
- Assert compaction passes `stopWhen` derived from that retry budget.
- Keep existing evidence tests that reject missing file/error evidence at `validateMinimumEvidence`.
