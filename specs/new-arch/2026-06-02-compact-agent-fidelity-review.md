# 2026-06-02: Compact Agent Fidelity Review

## Trigger

User report: the compact agent loses too much context after compaction, making the resumed agent behave as if core working memory was removed. The requested fix is to preserve actionable context without making summaries bloated.

## Call-Point Audit

`rg -n 'SessionCompaction\.create|SessionCompaction\.process|SessionCompaction\.prune|filterCompacted|assistant\.summary|isValidSummaryMessage|maintenanceSummaryFailureMessage|selectPromptFinalMessageFromNewest|flushPromptFinalMessage|result_mode|experimental\.session\.compacting|agent\.compaction\.prompt|tail_start_id|anchor_id' packages/opencorvus/src packages/opencorvus/test packages/plugin/src specs/new-arch`

Relevant decisions:

| Surface | Decision |
| --- | --- |
| `SessionCompaction.create` | Keep control-record creation; not the root of lossy summaries. |
| `SessionCompaction.process` | Replace the prior-summary merge input with structured handoff JSON and keep Markdown display derived-only. |
| `SessionCompaction.prune` | Leave unchanged in this patch; it remains a broader compression side path for later deletion/rewrite. |
| `Message.filterCompacted` | Keep assistant-tail rejection; fix the producer so it never emits assistant `tail_start_id`. |
| `assistant.summary` / `CompactionHandoff.isValidSummaryMessage` | Keep structured boundary validation as the only accepted compact boundary. |
| `maintenanceSummaryFailureMessage` / `flushPromptFinalMessage` / `result_mode` | Keep current summary-mode distinction; not the fidelity root. |
| `experimental.session.compacting` | Keep context-only plugin extension. |
| `agent.compaction.prompt` | Keep host-owned prompt contract; config prompt cannot replace the schema. |
| `tail_start_id` / `anchor_id` | Replace assistant tail generation with complete user-turn tail only. |

## Findings

1. `selectCompactionInput()` still allows assistant step boundaries as retained tails for long dispatcher sessions.
2. `Message.filterCompacted()` correctly rejects assistant-only tails. The combined behavior means the selector writes a tail marker that replay later discards, so the recent tail is not actually preserved.
3. Follow-up compaction merges the previous rendered Markdown summary instead of the validated `assistant.structured` object. Repeated compactions therefore compress already-compressed display text and lose machine-readable field boundaries.
4. The compaction transcript truncates every rendered part at 2,000 characters. That is too small for command output, patch evidence, and long user requirements; the head/tail strategy is good, but the field budget needs more room.
5. The handoff schema lacks explicit fields for the active working set and ordered progress. A model can pass the old schema while still omitting the "mental state" the next agent needs to continue intelligently.

## Implementation

- Only emit `tail_start_id` for a real user message boundary.
- For dispatcher sessions with one user anchor and many assistant step messages, compact the assistant steps into the handoff instead of pretending to retain an assistant-only tail.
- Pass the prior structured `CompactionHandoff.Info` to the compaction prompt as JSON. Rendered Markdown remains display-only.
- Increase per-part transcript budget from 2,000 to 30,000 characters so exact evidence has a strong chance to survive while still bounding prompt growth.
- Add required `workingContext` and `chronology` fields to `CompactionHandoff`. Minimum-evidence validation rejects handoffs that saw real user content but omit these fields.

## Tests

- Update build-session tail selection test to assert assistant tails are compacted, not retained.
- Add a prompt test proving prior structured handoff JSON is preserved in the merge prompt and rendered Markdown is not used as the source.
- Add a transcript truncation test proving head/tail evidence survives with the larger bounded budget.
- Add schema/renderer/minimum-evidence assertions for `workingContext` and `chronology`.
