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

## 2026-07-15 Tool Result Fidelity Repair

### Recall

- User request: inspect whether message compaction discards tool results before compacting, determine the correct behavior, then repair the confirmed loss.
- Acceptance criteria:
  - A completed tool result selected for compaction must remain exactly readable by the compaction agent even when the inline transcript is bounded.
  - The compact request must remain bounded; large results must not be blindly re-inlined into the initial provider request.
  - Retrieval is limited to completed tool parts in the selected compaction head and reads the persisted part output, or the exact truncation file when `metadata.truncated === true`.
  - Missing or inconsistent persisted evidence fails visibly. The reader must not fall back from a declared truncation file to the stored preview.
  - Evidence reads must not consume the StructuredOutput validation retry budget.
  - Existing structured-boundary, retained-tail, and post-success prune behavior remains unchanged.
- Hard constraints:
  - No fallback, compatibility path, keyword routing, host workflow gate, second compaction engine, synthetic message, or second evidence source.
  - MessageStore tool parts and their declared truncation files remain the single durable evidence source.
  - Do not restart or refresh a running OpenCorvus or Overlay process.
  - Preserve unrelated dirty worktree changes.
- Sources read:
  - `AGENTS.md`
  - `specs/current/architecture/99-principles.md`
  - this compaction fidelity record
  - `specs/records/2026-06/2026-06-21-frontend-design-research-adversarial-repair.md`
  - `packages/opencorvus/src/session/{compaction.ts,message.ts,loop.ts,message-store.ts}`
  - `packages/opencorvus/src/tool/{tool.ts,read.ts,truncation.ts,registry.ts}`
  - focused compaction tests under `packages/opencorvus/test/session/`
- Whole-repository grep:
  - `rg -n "filterCompacted|time\\.compacted|CompactionHandoff|tool.*result|result.*tool" packages/opencorvus/src/session packages/opencorvus/test/session -S`
  - `rg -n "largeTextProjection|outputForToolTranscript|compaction_large_text|TOOL_INPUT_STRING_MAX_CHARS" packages/opencorvus/test specs -S`
  - `rg -n "Tool\\.define|ToolRegistry|resolveTools|prepareProviderTool|MessageStore\\.parts|offset|limit" packages/opencorvus/src packages/opencorvus/test -S`
  - `rg -n "SessionCompaction\\.process|SessionCompaction\\.prune|Message\\.filterCompacted" packages/opencorvus/src packages/opencorvus/test -S`
- Independent agent feedback: not collected because the current collaboration contract forbids spawning sub-agents unless the user explicitly requests delegation.

### Confirmed Causal Chain

1. The historical CTX-1 failure was caused by very large persisted tool inputs, especially write/edit payloads.
2. The June 21 repair reused the same 1,000-character projection for completed tool outputs.
3. `outputForToolTranscript()` therefore exposes only 240 head characters, 160 tail characters, length, and SHA-256 for any larger result; the middle is unavailable to the compaction model.
4. `selectedHeadEvidenceRequirements()` only records that rich tool context exists. It cannot prove that a successful tool result's omitted fact reached the structured handoff.
5. The database output is not deleted before compaction, and prune only marks `time.compacted` after a valid boundary, but the compact agent currently has no tool with which to recover the omitted persisted content.

### Owning Design

- Keep historical tool entries flattened as inert transcript text; provider tool-call replay is not the evidence transport.
- Separate tool-input structural projection from tool-result evidence access.
- Inline small completed outputs. Represent large outputs with an exact part reference plus bounded preview.
- Add one compaction-only reader tool. It accepts a selected-head `part_id` and character range, resolves the authoritative result variant, and returns exact content with total length, hash, and next offset.
- When a completed part declares `metadata.truncated === true`, its `metadata.outputPath` file is authoritative. Missing paths are data-integrity failures; the stored preview is not a fallback source.
- Count only StructuredOutput calls against the structured handoff retry budget so read calls preserve the natural tool-feedback loop.

### Verification Plan

- Regression: a marker placed only in the middle of a large stored output is absent from the bounded initial transcript but returned by the reader.
- Regression: pagination reconstructs the exact persisted output and reports a stable SHA-256.
- Regression: a declared truncation file is read as the authority, while a missing file rejects instead of returning the preview.
- Regression: non-selected and non-completed parts are rejected.
- Regression: evidence-read steps do not exhaust the StructuredOutput retry count.
- Existing compaction transcript, structured handoff, filter, and prune suites remain green.
- Run package typecheck and the required historical/document health tests after implementation.

### Implementation and Verification

- `compaction.ts` now leaves the initial transcript bounded but emits an exact result reference for every large or file-truncated completed tool part.
- `ReadCompactionToolResult` is mounted only for the compaction turn and only indexes completed parts in the selected compaction head. It returns exact range content, total characters, SHA-256, and the next offset.
- File-truncated parts read only their declared `outputPath`; source validation rejects a missing path before the provider request instead of using the stored preview.
- The structured handoff stop condition counts only `StructuredOutput` attempts, so evidence pagination does not consume validation retries.
- A MessageStore integration regression persists a large tool part, reloads it through `Session.messages()`, and recovers a marker found only in the omitted middle.
- Passed: focused compaction tests, including transcript, reader, dynamic identity, evidence contract, handoff, prune, and retained-tail coverage.
- Passed: `packages/opencorvus/test/session/message.test.ts`, package TypeScript typecheck, and `document-health.test.ts`.
- Repository-wide `historical-docs-links.test.ts` remains blocked by eight retired documentation paths introduced in the unrelated dirty `packages/opencorvus/src/expert-squad/payload.ts`; the compaction record itself passes the monthly-link checks.
- The broad `compaction*` prefix also exposes a pre-existing stale `compaction-continue-inherit.test.ts` fixture that still supplies the retired runtime `tools` field, old worker descriptor schema, and user messages without required authors. That clean, unrelated test file was not folded into this repair.
