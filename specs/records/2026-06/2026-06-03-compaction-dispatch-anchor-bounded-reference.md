# 2026-06-03: Compaction Dispatch Anchor Bounded Reference

## Trigger

Independent scans of temporary benchmark databases found one true compact-agent provider overflow:

- Task `tsk_e8bec4c750018Kcr5TWYo2AZka`
- Build session `ses_173f9d6b6ffe6oQtBlb28PeUtz`
- Goal `gol_e8c0317c8001azy6EE0JLW7Fed`
- Compact assistant message `msg_e8c154821001ot2jVvX3yuG6yn`
- Provider error: input `204692` tokens exceeded context `202752`

The same scan also found architect/integrity `ContextOverflowError` rows whose message says automatic workflow compaction is disabled. Those are workflow budget failures, not compact-agent failures.

## Call-Point Audit

Command:

`rg -n "dispatchAnchor|buildPrompt\\(|compaction_request|Automatic compaction|ContextOverflowError|errorReason" packages/opencorvus/src packages/opencorvus/test`

Relevant decisions:

| Surface                                           | Decision                                                                                                                                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SessionCompaction.process`                       | Keep preserving the first dispatcher user message by `anchor_id`, but pass only anchor metadata and a bounded excerpt into the compact-agent prompt.                                                         |
| `SessionCompaction.buildPrompt`                   | Stop embedding the full dispatch anchor in the final compact-agent user prompt. The anchor is already preserved in replay by `Message.filterCompacted`; duplicating it makes the provider request too large. |
| `Message.filterCompacted`                         | Keep current anchor replay behavior. It is the durable source for the full dispatch anchor.                                                                                                                  |
| `SessionCompaction.create` / `compaction_request` | Keep control-record creation unchanged. This fix is payload sizing, not a new route or fallback.                                                                                                             |
| Workflow `ContextOverflowError` rows              | Keep typed context-overflow failures for workflow kinds. They should be diagnosed separately from compact-agent `agent=compaction` errors.                                                                   |

## Decision

Represent the dispatch anchor in the compact-agent prompt as a bounded reference:

- message id
- total character count
- short head/tail excerpt only when needed
- explicit instruction that the full anchor remains visible after compaction and must not be duplicated into `userMessages[]`

This removes the duplicated giant prompt payload while preserving the single source of truth: the original user message retained by `anchor_id`.

## Tests

- Existing dispatch-anchor prompt test now asserts selected head excludes the anchor and the prompt carries a reference, not the full anchor contract.
- New large-anchor prompt test asserts a huge anchor is bounded, includes total size metadata, includes head/tail markers, and omits the middle content.
