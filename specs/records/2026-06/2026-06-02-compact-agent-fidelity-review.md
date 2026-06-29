# 2026-06-02: Compact Agent Fidelity Review

## Trigger

User report: the compact agent loses too much context after compaction, making the resumed agent behave as if core working memory was removed. The requested fix is to preserve actionable context without making summaries bloated.

## Call-Point Audit

`rg -n 'SessionCompaction\.create|SessionCompaction\.process|SessionCompaction\.prune|filterCompacted|assistant\.summary|isValidSummaryMessage|maintenanceSummaryFailureMessage|selectPromptFinalMessageFromNewest|flushPromptFinalMessage|result_mode|experimental\.session\.compacting|agent\.compaction\.prompt|tail_start_id|anchor_id' packages/opencorvus/src packages/opencorvus/test packages/plugin/src specs`

Relevant decisions:

| Surface                                                                        | Decision                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionCompaction.create`                                                     | Keep control-record creation; not the root of lossy summaries.                                                                                                                                                       |
| `SessionCompaction.process`                                                    | Replace the prior-summary merge input with structured handoff JSON and keep Markdown display derived-only.                                                                                                           |
| `SessionCompaction.prune`                                                      | Must not clear old tool outputs unless the newest accepted structured handoff has already covered the compacted history. Prune is projection cleanup after validated handoff, not an independent compression source. |
| `Message.filterCompacted`                                                      | Keep assistant-tail rejection; fix the producer so it never emits assistant `tail_start_id`.                                                                                                                         |
| `assistant.summary` / `CompactionHandoff.isValidSummaryMessage`                | Keep structured boundary validation as the only accepted compact boundary.                                                                                                                                           |
| `maintenanceSummaryFailureMessage` / `flushPromptFinalMessage` / `result_mode` | Keep current summary-mode distinction; not the fidelity root.                                                                                                                                                        |
| `experimental.session.compacting`                                              | Keep context-only plugin extension.                                                                                                                                                                                  |
| `agent.compaction.prompt`                                                      | Keep host-owned prompt contract; config prompt cannot replace the schema.                                                                                                                                            |
| `tail_start_id` / `anchor_id`                                                  | Replace assistant tail generation with complete user-turn tail only.                                                                                                                                                 |

## Findings

1. `selectCompactionInput()` still allows assistant step boundaries as retained tails for long dispatcher sessions.
2. `Message.filterCompacted()` correctly rejects assistant-only tails. The combined behavior means the selector writes a tail marker that replay later discards, so the recent tail is not actually preserved.
3. Follow-up compaction merges the previous rendered Markdown summary instead of the validated `assistant.structured` object. Repeated compactions therefore compress already-compressed display text and lose machine-readable field boundaries.
4. The compaction transcript truncates every rendered part at 2,000 characters. That is too small for command output, patch evidence, and long user requirements; the head/tail strategy is good, but the field budget needs more room.
5. The handoff schema lacks explicit fields for the active working set and ordered progress. A model can pass the old schema while still omitting the "mental state" the next agent needs to continue intelligently.
6. `MemoryFlush.flush()` writes the rendered Markdown text into memory. That keeps memory coupled to a display projection instead of the structured handoff source of truth.
7. `SessionCompaction.prune()` can clear old tool outputs after the loop without proving that a validated handoff covered the same historical region. This creates a second lossy path outside the compact agent.

## Implementation

- Only emit `tail_start_id` for a real user message boundary.
- For dispatcher sessions with one user anchor and many assistant step messages, compact the assistant steps into the handoff instead of pretending to retain an assistant-only tail.
- Pass the prior structured `CompactionHandoff.Info` to the compaction prompt as JSON. Rendered Markdown remains display-only.
- Increase per-part transcript budget from 2,000 to 30,000 characters so exact evidence has a strong chance to survive while still bounding prompt growth.
- Add required `workingContext` and `chronology` fields to `CompactionHandoff`. Minimum-evidence validation rejects handoffs that saw real user content but omit these fields.
- Flush memory from the validated structured handoff, rendering a compact memory episode from schema fields instead of reusing the display Markdown text.
- Make `prune()` require a newest valid handoff boundary before clearing old tool outputs, and stop pruning once it reaches the protected post-compaction tail.

## Tests

- Update build-session tail selection test to assert assistant tails are compacted, not retained.
- Add a prompt test proving prior structured handoff JSON is preserved in the merge prompt and rendered Markdown is not used as the source.
- Add a transcript truncation test proving head/tail evidence survives with the larger bounded budget.
- Add schema/renderer/minimum-evidence assertions for `workingContext` and `chronology`.

## Independent Review Follow-Up

Independent review found two P1 gaps in the first patch:

- `previousHandoff` was only prompt context. It was not part of the validation contract, so repeated compaction could legally drop prior `acceptanceCriteria`, `workingContext`, or `chronology`.
- Assistant-step-only compacted history could pass with empty `workingContext` and `chronology` because minimum evidence only required those fields when compacted history contained user text.

Follow-up implementation:

- `EvidenceRequirements.previousHandoff` now carries exact prior acceptance criteria, working context, and chronology events that must be retained.
- `renderRequiredEvidence()` emits a `<previous-handoff-required-retention>` block so the compaction model sees the exact retention contract.
- `validateMinimumEvidence()` rejects omission of those previous handoff facts.
- `selectedHeadEvidenceRequirements()` now sets `richContext` for assistant text, tools, patch parts, snapshots, and files, not only user text.
- Minimum evidence now requires non-empty `workingContext` and `chronology` whenever `richContext` is true.

Additional tests:

- Previous handoff sentinel facts must survive follow-up validation.
- Assistant-only selected head with real assistant content rejects empty `workingContext` and `chronology`.
- Runtime context carries previous handoff retention requirements into the prompt.

## Completion Follow-Up

After user review, the remaining fidelity risks are pulled into the same fix:

- Memory flush must use `assistant.structured` and `CompactionHandoff.renderMemoryEpisode()` so long-term memory cannot depend on a lossy display string.
- Tool-output prune must be disabled until a valid compact boundary exists. When a boundary exists, prune only older material before the preserved tail/user anchor and never prune post-compaction tail turns.
- Tests must assert that prune does nothing without a structured handoff, prunes eligible pre-tail tool output after a structured handoff, preserves post-tail tool output, and memory flush content is generated from structured handoff facts rather than rendered Markdown.

## Independent Review Closure

Second independent review found these remaining issues:

- P1: repeated compaction only forced prior `acceptanceCriteria`, `workingContext`, and `chronology`; prior `files`, `evidence`, `testsAndCommands`, `errorsAndBlockers`, `decisions`, `userMessages`, `nextActions`, and `openRisks` could still be dropped.
- P2: `prune()` treated missing or assistant `tail_start_id` as if no tail existed, while `filterCompacted()` rejects assistant tails.
- P2: `MemoryFlush.flush()` needed a direct test proving display Markdown is not the memory source.
- P3: malformed-tail prune rejection also needed a DB-path test proving `SessionCompaction.prune()` does not write `part.state.time.compacted`.

Closure:

- `EvidenceRequirements.previousHandoff` now carries every resumable array field, and `validateMinimumEvidence()` rejects omission of previous handoff facts by exact field identity.
- `renderRequiredEvidence()` emits every previous handoff retention field so the compaction model sees the complete contract.
- `latestCompactionPruneRange()` rejects missing tail ids and non-user tail ids before any tool output is eligible for clearing.
- Tests cover all previous handoff retained fields, malformed prune tails, and a real `MemoryFlush.flush()` path where stale display text conflicts with structured handoff facts.
- A DB integration test writes a malformed assistant tail marker, runs `SessionCompaction.prune()`, and asserts the covered tool part remains un-compacted.
