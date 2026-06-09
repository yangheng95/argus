# 2026-05-13: Compaction Handoff Hardening

## Trigger

User report: after context compaction, system prompt / project rules appear lost, and the produced summary is too shallow to safely resume work. The earlier threshold change to `0.9` reduces premature compaction but does not solve summary fidelity.

This plan is intentionally scoped to compaction quality and resumability. It is not an implementation patch.

## External Product Findings

- Claude Code treats compaction as replacement of old messages with a summary, but persistent project rules belong in `CLAUDE.md` and are re-injected rather than trusted to summary text. It also supports compaction-specific preservation instructions and pre-compact hooks.
- VS Code / GitHub Copilot exposes context usage and supports manual `/compact` with custom focus instructions.
- Cursor separates chat summarization from large-file condensation; code files are reduced to structural elements rather than generic prose.
- Aider combines chat summarization with repository maps, token reporting, explicit context dropping, and copyable context.

Implication for OpenCorvus: compaction must produce a task handoff artifact, not a generic conversation recap. Durable rules and code structure must remain separate sources of truth.

## Current Implementation Impact Map

| Area                               | File                                                                                                                                           | Current behavior                                                                                                                                                               | Impact                                                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Summary prompt                     | `packages/opencorvus/src/session/compaction.ts`                                                                                                | `SUMMARY_TEMPLATE` asks for broad sections but has no required acceptance criteria, test evidence, exact current task state, or rule reload audit.                             | Summary can satisfy the template while omitting the facts needed to resume.                                                                         |
| Compaction agent prompt            | `packages/opencorvus/src/agent/prompt/compaction.txt`                                                                                          | Generic "helpful AI assistant summarizing conversations".                                                                                                                      | Conflicts with the stricter task-handoff role needed here.                                                                                          |
| Compaction input selection         | `packages/opencorvus/src/session/compaction.ts`                                                                                                | `selectCompactionInput()` selects old head and preserves recent tail by turns/token budget.                                                                                    | The compactor only sees selected history plus previous summary; runtime session-state blocks are not directly injected.                             |
| Prior summary merge                | `packages/opencorvus/src/session/compaction.ts`                                                                                                | `buildPrompt()` asks to update previous summary.                                                                                                                               | No schema/checklist forces stale-vs-current distinction.                                                                                            |
| Prompt contract continuation       | `packages/opencorvus/src/session/compaction.ts`, `packages/opencorvus/src/session/loop.ts`, `packages/opencorvus/src/server/routes/session.ts` | Recent change makes continuation inherit `format/system/systemMode/tools/variant/extra` from source user message.                                                              | Correct direction; must remain the only source for structured-output/system contract preservation.                                                  |
| Conversation projection            | `packages/opencorvus/src/session/message.ts`                                                                                                   | `Message.toModelMessages(..., { stripMedia, toolOutputMaxChars })` truncates tool outputs and replaces media with markers.                                                     | Summary can only preserve tool evidence if projection keeps command/file/error identity.                                                            |
| Compacted history read path        | `packages/opencorvus/src/session/message.ts`                                                                                                   | `filterCompacted()` keeps compaction summary and newer/tail turns.                                                                                                             | The summary is the durable substitute for older turns; bad summary causes permanent loss.                                                           |
| Runtime rules injection            | `packages/opencorvus/src/session/instruction.ts`, `packages/opencorvus/src/session/system.ts`, `packages/opencorvus/src/session/loop.ts`       | `InstructionPrompt.system()` re-reads root `AGENTS.md` / `CLAUDE.md` into normal turns; dynamic memory/scratchpad/task-plan is injected into the last user message at runtime. | Root rules should not be summarized as primary truth. Summary should record loaded instruction paths and state that disk sources are authoritative. |
| Instruction file shadowing         | `packages/opencorvus/src/session/instruction.ts`                                                                                               | `FILES = ["AGENTS.md", "CLAUDE.md"]`, but `systemPaths()` breaks after the first filename with matches.                                                                        | In this repo `AGENTS.md` can shadow `CLAUDE.md`; compaction is not the only reason rules appear lost.                                               |
| Memory flush                       | `packages/opencorvus/src/memory/flush.ts`                                                                                                      | Flushes summary text into memory as an episode.                                                                                                                                | Bad summaries become bad long-term memory.                                                                                                          |
| Memory recall                      | `packages/opencorvus/src/memory/injection.ts`                                                                                                  | Recalls up to 4 memories, including episodes.                                                                                                                                  | Compaction summary quality affects future sessions beyond the current one.                                                                          |
| Task plan                          | `packages/opencorvus/src/memory/task-plan.ts`                                                                                                  | Stored separately and injected at runtime.                                                                                                                                     | Current task state should be preserved through TaskPlan, not only natural-language summary.                                                         |
| Manual summarize route             | `packages/opencorvus/src/server/routes/session.ts`                                                                                             | `/session/:sessionID/summarize` creates a compaction message using the last real user message.                                                                                 | Manual compaction needs optional focus instructions in a later change; no parallel route should be added.                                           |
| Manual summarize callers           | `packages/opencorvus/src/acp/agent.ts`, `packages/opencorvus/src/cli/cmd/tui/routes/session/index.tsx`, SDK users                              | ACP and TUI call `session.summarize` with the generated request shape.                                                                                                         | Route contract changes must preserve callers and expose optional focus without breaking existing calls.                                             |
| Manual summarize success semantics | `packages/opencorvus/src/server/routes/session.ts`                                                                                             | Route awaits `SessionPrompt.loop()` then returns `true` without inspecting compaction result.                                                                                  | Validation failure could still look successful unless the route checks the result.                                                                  |
| SDK/OpenAPI contract               | `packages/sdk/openapi.json`, `packages/sdk/js/src/gen/types.gen.ts`, `packages/sdk/js/src/gen/sdk.gen.ts`                                      | Generated clients expose `session.summarize` request shape and config descriptions.                                                                                            | Any route body/schema change must regenerate SDK/OpenAPI; stale `0.7` threshold descriptions already show this surface is easy to miss.             |
| Plugin prompt override             | `packages/opencorvus/src/session/compaction.ts`                                                                                                | `experimental.session.compacting` may replace the whole compaction prompt.                                                                                                     | This can bypass the single handoff contract unless the hook is narrowed or validator blocks non-conforming output.                                  |
| Agent prompt override              | `packages/opencorvus/src/agent/agent.ts`                                                                                                       | `cfg.agent.compaction.prompt` can replace the built-in compaction prompt.                                                                                                      | The handoff contract must be host-owned; config prompt override cannot be allowed to weaken it.                                                     |
| Legacy compaction boundaries       | `packages/opencorvus/src/session/message.ts`, `packages/opencorvus/src/session/compaction.ts`, `packages/opencorvus/src/memory/flush.ts`       | Any completed `assistant.summary` without error is accepted as a boundary or memory source.                                                                                    | Invalid legacy summaries can continue deleting history unless boundary validation is single-source.                                                 |
| Assistant-level errors             | `packages/opencorvus/src/session/message.ts`                                                                                                   | `toModelMessages()` skips assistant messages with most `msg.info.error` values.                                                                                                | Provider/structured-output/context errors can disappear from compaction evidence.                                                                   |
| Patch/file evidence                | `packages/opencorvus/src/session/message.ts`, `packages/opencorvus/src/session/processor.ts`, `packages/opencorvus/src/session/summary.ts`     | Patch parts and session diff are not projected as ordinary model messages.                                                                                                     | File-change evidence may be missing from the handoff unless explicitly injected.                                                                    |
| Thresholds                         | `packages/opencorvus/src/session/context-budget.ts`, `packages/opencorvus/src/session/loop.ts`                                                 | Post-turn threshold now `0.9`; predictive threshold already `0.9`.                                                                                                             | Trigger timing is separate from summary fidelity.                                                                                                   |
| Predictive compaction placeholder  | `packages/opencorvus/src/session/loop.ts`                                                                                                      | `processTurn()` creates an assistant message before the predictive compaction gate. If the gate returns `compact`, the assistant has no parts and zero tokens.                 | DB timeline looks like compaction happened after an empty assistant response; it also pollutes history with a non-message.                          |
| Handoff display format             | `packages/opencorvus/src/session/compaction-handoff.ts`                                                                                        | Host renderer emits OpenCorvus-specific headings such as `Continuation Contract`.                                                                                              | The format is less familiar than Claude Code's compact summary and does not make "primary request / current work / next step" visually obvious.     |
| Predictive fail-fast placeholder   | `packages/opencorvus/src/session/loop.ts`                                                                                                      | `fail-tool-schema` and `fail-prompt-budget` throw after the assistant placeholder has been inserted.                                                                           | Empty assistant rows can still be left behind outside the compact-success branch, and the error is not attached to the visible assistant message.   |
| Predictive/reactive budget source  | `packages/opencorvus/src/session/loop.ts`, `packages/opencorvus/src/session/context-budget.ts`                                                 | Reactive compaction uses `ContextBudget.isUsageOverflow()`, but predictive compaction directly reads `model.limit.input                                                        |                                                                                                                                                     | model.limit.context` plus env threshold. | `compaction.auto=false`, `compaction.reserved`, and configured `compaction.threshold` can be ignored by predictive compaction. |
| Handoff quality gate               | `packages/opencorvus/src/session/compaction-handoff.ts`, `packages/opencorvus/src/session/message.ts`                                          | Structured handoff validates shape, but important arrays can be empty and are not checked against compacted history evidence.                                                  | A low-information but schema-valid handoff can become a compact boundary and hide older history.                                                    |
| Tail split boundary                | `packages/opencorvus/src/session/compaction.ts`, `packages/opencorvus/src/session/message.ts`                                                  | `splitTurn()` can set `tail_start_id` to an assistant or other non-user message.                                                                                               | After compaction, replay can start mid-turn without the corresponding user request.                                                                 |
| Plugin hook contract drift         | `packages/plugin/src/index.ts`, `packages/opencorvus/src/session/compaction.ts`                                                                | Runtime only uses plugin `context`, but plugin type/docs still imply a `prompt` override can replace the compaction prompt.                                                    | Future maintainers can reintroduce prompt bypass and break the single handoff contract.                                                             |
| Historical compaction residue      | Local DB, `packages/opencorvus/script/repair-empty-snapshot-patch-evidence.ts`                                                                 | Current repair script removes empty-tree patch evidence only.                                                                                                                  | Failed compaction assistant rows, empty placeholders, and legacy summaries can remain in old local DBs and still add noise.                         |

## Root Cause

OpenCorvus currently conflates three different context surfaces:

1. **Durable instructions**: `AGENTS.md`, `CLAUDE.md`, config instructions, skills, system prompt.
2. **Live task state**: task plan, scratchpad, recalled memory, current source user message contract.
3. **Historical transcript**: old user/assistant/tool messages that compaction actually replaces.

The compactor only produces a prose summary for surface 3, but the prompt does not clearly tell it that surfaces 1 and 2 must be referenced by source path/state and not paraphrased as the sole truth. This makes it easy for system prompt, project rules, task requirements, and acceptance criteria to appear "lost" after compaction.

There is also a pre-existing rule-loading bug: project `AGENTS.md` and `CLAUDE.md` are treated as alternatives rather than both authoritative sources. That must be fixed before judging compaction quality, otherwise the system can still lose `CLAUDE.md` rules even with perfect summaries.

For task `tsk_e1f9c2cd4001z5TZEezacMOY84`, the early compaction evidence is:

- `msg_e1fc7e13c001UHdj4er2tQoSjS` and `msg_e1fcd3557001HIzX3TYwQeNbKC` are auto compaction user messages.
- Each is immediately preceded by an empty build assistant message with `tokens.input=0`, `tokens.output=0`, and no parts.
- This does not mean post-turn usage crossed the threshold. It means the predictive gate fired after `processTurn()` had already inserted the assistant placeholder.
- The predictive input was inflated by the invalid empty-tree patch evidence investigated in `2026-05-13-build-context-spike-empty-snapshot-plan.md`.

## Design Principles

- No fallback summary path. There must be one compaction handoff template and one validation contract.
- Do not duplicate durable instruction sources. The summary must point to disk-loaded instruction paths and current source message contract; it must not become a second copy of `AGENTS.md` / `CLAUDE.md`.
- Preserve evidence, not vibes: exact file paths, commands, exit status, error strings, task IDs, goal IDs, acceptance criteria, and current blocker must be mandatory.
- Keep structured state structured. TaskPlan/Scratchpad/Memory remain the canonical state sources; compaction may include their current rendered state as evidence but must not invent a parallel state store.
- Code context condensation is separate from chat summary. Tool output projection should preserve command/file/error identities so the summary can cite them.
- Budget decisions must have one source. Predictive and reactive compaction must use the same `ContextBudget` contract and config semantics.
- Transcript rows must mean something. If no provider call or tool activity happened, do not leave an assistant message behind; if a budget failure happens, attach the typed error to the created assistant or remove the placeholder before surfacing the failure.

## Revised Priority After Independent Review #2

Review agent `019e1fee-e78e-7f63-99b5-7716afcd9709` found no P0, but rejected the claim that all hidden risks are solved. The remaining work must be ordered as:

1. **P1-A: Single budget source**: predictive compaction must respect `compaction.auto`, `reserved`, `threshold`, and model input/context the same way reactive compaction does.
2. **P1-B: Predictive fail-fast transcript hygiene**: all predictive branches that do not call the provider must either remove the assistant placeholder or persist a typed visible error on it. No empty assistant rows.
3. **P1-C: Handoff quality gate**: schema validity alone is insufficient; the accepted handoff must contain minimum evidence for the actual compacted input.
4. **P2-A: Tail boundary correctness**: retained tail must start at a user turn boundary, never an assistant-only suffix.
5. **P2-B: Plugin/API contract sync**: remove the stale prompt override contract from plugin types/docs so context-only extension is the single surface.
6. **P2-C: Historical residue handling**: provide explicit diagnostics/repair for old failed compaction rows and empty placeholders; do not silently rewrite old summaries into valid ones.

## Proposed Implementation

### Phase 0: Fix Instruction Source Loading Before Compaction

Files:

- `packages/opencorvus/src/session/instruction.ts`
- `packages/opencorvus/test/session/instruction.test.ts`

Change:

- Decide the single authoritative behavior for project instruction files. For this repo, load both `AGENTS.md` and `CLAUDE.md` when both exist instead of breaking after the first matched filename.
- Preserve precedence deterministically: broader/global sources first, project sources after, config instructions after their documented layer.
- Do not summarize these files into compaction output; only list authoritative paths in handoff metadata.

Acceptance:

- Test both project `AGENTS.md` and `CLAUDE.md` are included when both exist.
- Test global/config instruction loading still works.
- Test `InstructionPrompt.systemPaths()` returns deterministic ordering.

### Phase A: Replace Generic Summary With Structured Handoff Contract

Files:

- `packages/opencorvus/src/session/compaction.ts`
- `packages/opencorvus/src/agent/prompt/compaction.txt`

Change:

- Replace the prose-only `SUMMARY_TEMPLATE` with a single `CompactionHandoff` Zod schema owned by `session/compaction.ts`.
- The LLM output is validated as structured data, then host-rendered to Markdown for storage in the assistant summary message. Do not validate quality by scanning Markdown headings.
- The host-owned handoff prompt/schema is authoritative even if `cfg.agent.compaction.prompt` exists; the agent prompt may only add generic role text and must not replace the handoff contract.
- Required schema fields:
  - `objective: string`
  - `acceptanceCriteria: string[]`
  - `durableInstructionSources: { path: string; role: string }[]`
  - `currentState: { phase: string; activeTask: string; sourceUserMessage: object }`
  - `decisions: { decision: string; rationale: string; evidence?: string }[]`
  - `evidence: { kind: "file" | "command" | "test" | "error" | "tool" | "artifact"; value: string; detail: string }[]`
  - `files: { path: string; status: "read" | "modified" | "created" | "deleted" | "referenced"; detail: string }[]`
  - `testsAndCommands: { command: string; result: string; evidence: string }[]`
  - `errorsAndBlockers: { issue: string; evidence: string; nextAction: string }[]`
  - `userMessages: string[]`
  - `nextActions: string[]`
  - `openRisks: string[]`
- Update compaction agent prompt to act as a "state handoff writer" whose output must be resume-safe and machine-scannable.
- Empty arrays are allowed only for fields where no evidence exists in the provided context; generic strings like "continue implementation" are explicitly invalid in schema-level tests.

Acceptance:

- Unit test asserts the schema requires objective, acceptance criteria, source user message metadata, evidence arrays, and exact path/command fields.
- Unit test asserts the Markdown renderer emits every required section from schema data.
- Test config overriding `agent.compaction.prompt` cannot remove or replace the host-owned handoff schema.

### Phase B: Inject Runtime State Into Compaction Prompt

Files:

- `packages/opencorvus/src/session/compaction.ts`
- `packages/opencorvus/src/session/instruction.ts`
- `packages/opencorvus/src/memory/task-plan.ts`
- `packages/opencorvus/src/memory/scratchpad.ts`

Change:

- Build compaction prompt context from:
  - `InstructionPrompt.systemPaths()` rendered as a list of authoritative instruction files.
  - `TaskPlan.toMarkdown(sessionID)` if present.
  - Scratchpad only if the existing product decision is that scratchpad is safe to persist into summaries. Otherwise record a `scratchpad-present` evidence item and leave full scratchpad content in its canonical table.
  - last source user message fields: `agent`, `model`, `format.type`, `systemMode`, `tools`, `variant`, `extra`.
  - Memory references only as source IDs/titles when already recalled; do not copy recalled memory episode content into compaction summaries.
  - Patch/session diff evidence from `PatchPart` or `SessionSummary.diff` so file changes do not depend on prose history.
- Keep `InstructionPrompt.system()` out of compaction context to avoid copying full rules into summary. Paths and source metadata are enough because normal turns reload rules from disk.

Acceptance:

- Unit test constructs a session with task plan, scratchpad, and a source user message with `format/systemMode/tools/extra`; captured compaction prompt must include those sections.
- Test must assert full `AGENTS.md` content is not copied into the summary prompt through this new path.
- Test compaction does not recursively summarize recalled compaction memory episodes.
- Test file-change evidence appears when the only source is a patch part/session diff.

### Phase C: Preserve Tool Evidence During Compaction Projection

Files:

- `packages/opencorvus/src/session/message.ts`

Change:

- Keep the current truncation behavior, but ensure truncated tool output always retains:
  - tool name
  - normalized input
  - output head/tail
  - truncation count
  - status
- Add a compaction-only projection for assistant-level errors that preserves error `name`, message, and relevant status without changing normal replay behavior.
- Do not add a second tool-output summarizer. The projection is the single compaction input surface.

Acceptance:

- Existing media stripping test remains.
- New test for a failed command/tool output verifies command, exit/error text, and truncation marker survive compaction projection.
- New test verifies `ContextOverflowError`, `StructuredOutputError`, and provider `APIError` assistant messages are visible to compaction input.

### Phase D: Validate Structured Handoff Before Accepting

Files:

- `packages/opencorvus/src/session/compaction.ts`
- `packages/opencorvus/test/session/compaction*.test.ts`

Change:

- Parse and validate the model's handoff object with the `CompactionHandoff` Zod schema.
- Render the accepted object to Markdown in host code. The stored assistant summary remains Markdown for existing transcript display and memory episodes.
- If validation fails, mark the compaction assistant message as error and do not publish `session.compacted` or flush memory.
- Do not retry blindly. A malformed summary is a failed compaction, not a reason to generate another weaker summary.
- Expose one `SessionCompaction.validateHandoffSummary(text)` / parser contract and use it consistently in new summary acceptance, legacy boundary checks, and memory flush.
- The validator is a shape/data-integrity gate only. It must not infer semantic truth through keyword matching.
- Add deterministic minimum-evidence validation derived from the compaction input:
  - If compacted history contains user text parts, `userMessages.length >= 1`.
  - If runtime instruction paths are present, `durableInstructionSources.length >= 1`.
  - If compacted history contains patch parts or session diff evidence, `files.length >= 1` or an explicit evidence item explains no file changes.
  - If compacted history contains assistant/tool errors, `errorsAndBlockers.length >= 1` or an evidence item cites the error as resolved.
  - If source user message or task plan contains acceptance language, `acceptanceCriteria.length >= 1`.
- This validation must be computed from structured facts already available to host code, not keyword matching on rendered Markdown.

Acceptance:

- Test invalid summary text does not publish `Compacted` and does not call `MemoryFlush.flush`.
- Test valid handoff summary does publish and flush.
- Test renderer output is deterministic for the same handoff object.
- Test invalid legacy `assistant.summary` messages are not accepted as `filterCompacted()` boundaries.
- Test a schema-valid but empty `userMessages` handoff is rejected when compacted history contains user text.
- Test a schema-valid but missing file evidence handoff is rejected when patch evidence exists.
- Test a schema-valid handoff with explicit empty arrays is accepted only when the derived input facts prove those categories were absent.

### Phase D2: Preserve Plugin Extensibility Without Prompt Bypass

Files:

- `packages/opencorvus/src/session/compaction.ts`
- `packages/opencorvus/src/session/message.ts`
- `packages/opencorvus/src/memory/flush.ts`
- `packages/plugin/src/index.ts`

Change:

- Keep `experimental.session.compacting` for additional context only.
- Remove the documented `prompt` override from the public plugin contract. Do not deprecate while keeping it callable; that would preserve a second source. The hook returns `{ context: string[] }` only.
- OpenCorvus owns the prompt template and schema. Plugin context is appended as evidence only.

Acceptance:

- Test a plugin-provided context string appears in the compaction prompt.
- Test a plugin cannot cause a non-handoff summary to be accepted.
- Test `MemoryFlush.flush` rejects errored, unfinished, and invalid summary messages even if called directly.
- Typecheck proves plugin callers cannot provide a `prompt` replacement.

### Phase E: Manual Compact Focus Without Parallel Route

Files:

- `packages/opencorvus/src/server/routes/session.ts`
- `packages/opencorvus/src/session/compaction.ts`
- `packages/opencorvus/src/session/message.ts`
- `packages/opencorvus/src/acp/agent.ts`
- `packages/opencorvus/src/cli/cmd/tui/routes/session/index.tsx`
- `packages/sdk/openapi.json`
- `packages/sdk/js/src/gen/types.gen.ts`
- `packages/sdk/js/src/gen/sdk.gen.ts`

Change:

- Extend the existing summarize route body with optional `focus: string`.
- Store focus only on `Message.CompactionPart`; do not store it in inherited source `extra`.
- `buildPrompt()` includes focus as a directive only for this compaction run.
- Do not add a new route or a separate summary mode.
- Regenerate OpenAPI and SDK artifacts in the same change.
- Update ACP/TUI call sites only if needed for type compatibility; existing calls without focus must remain valid.
- Route must inspect the compaction loop result. If validation fails, return a failed response or `false`, not unconditional success.

Acceptance:

- Route test verifies manual focus reaches compaction prompt.
- Existing route without focus remains the same contract.
- SDK type for `SessionSummarizeData["body"]` exposes `focus?: string`.
- Test source user `extra` remains unchanged when manual focus is provided.
- Test manual summarize reports failure when compaction validation fails.

### Phase F: Sync Public Generated Descriptions

Files:

- `packages/sdk/openapi.json`
- `packages/sdk/js/src/gen/types.gen.ts`
- `docs/product/*/opencorvus/configuration.md` if they mention compaction defaults

Change:

- Ensure compaction threshold docs say `0.9`, not stale `0.7`.
- This is documentation/schema synchronization, not behavior.

Acceptance:

- `rg -n "Defaults to 0\\.7|70%.*compaction|compaction.*0\\.7" packages docs` returns no stale generated/public default references.

### Phase G: Claude-Style Compact Summary Rendering

Files:

- `packages/opencorvus/src/session/compaction-handoff.ts`
- `packages/opencorvus/test/session/compaction.test.ts`

Change:

- Keep `CompactionHandoff` as the single structured source.
- Render accepted handoffs into a Claude Code-like Markdown shape:
  - opening continuation sentence,
  - `Summary:`,
  - numbered sections for primary request, technical concepts, files, errors/fixes, problem solving, user messages/source contract, pending tasks, current work, and optional next step.
- Do not ask the model for Markdown. The model still returns JSON; host rendering owns the display format.

Acceptance:

- Renderer output starts with the continuation sentence and includes numbered sections.
- Existing structured validation remains the boundary check.

### Phase H: Remove Empty Assistant Placeholder On Predictive Compact

Files:

- `packages/opencorvus/src/session/loop.ts`

Change:

- When the predictive gate creates a compaction user message before any provider call, remove the pre-created assistant placeholder before returning.
- For predictive fail-fast (`fail-tool-schema`, `fail-prompt-budget`), do not throw past the placeholder with no visible row. Either:
  - attach the typed `ToolSchemaBudgetError` / `PromptBudgetOverflowError` to the pre-created assistant message, mark `finish="error"`, publish `Session.Event.Error`, and return `stop`; or
  - remove the placeholder and surface the typed error through a single outer message path.
- Preferred design: attach the typed error to the assistant message. This gives the UI and DB a visible failure row and avoids hidden orchestration errors.
- This is not a fallback path; it preserves the transcript invariant that assistant rows represent actual assistant output, tool activity, or errors.

Acceptance:

- Predictive compaction no longer leaves a zero-token assistant row before the compaction user message.
- Predictive `fail-tool-schema` creates one errored assistant message with `ToolSchemaBudgetError`, no empty assistant.
- Predictive `fail-prompt-budget` creates one errored assistant message with `PromptBudgetOverflowError`, no empty assistant.
- Tests assert the error row is visible to compaction projection when later history is summarized.

### Phase I: Unify Predictive And Reactive Budget Semantics

Files:

- `packages/opencorvus/src/session/context-budget.ts`
- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/test/session/predictive-compaction-decision.test.ts`
- `packages/opencorvus/test/session/compaction.test.ts`

Change:

- Move predictive budget calculation into `ContextBudget`, e.g. `ContextBudget.predictiveLimit({ config, model })`.
- The predictive path must call `Config.get()` and respect:
  - `compaction.auto === false`: skip predictive auto compaction entirely.
  - `compaction.threshold`: same default and override semantics as reactive.
  - `compaction.reserved`: same usable-budget calculation as reactive.
  - `model.limit.input` vs `model.limit.context`: same `ContextBudget.usable()` source.
- Remove direct `model.limit.input || model.limit.context` from `SessionLoop.processTurn`.
- Keep env-only threshold overrides out of the production decision unless they are already part of `Config`. Environment-only budget behavior creates a hidden second config source.

Acceptance:

- Test `compaction.auto=false` prevents predictive compaction from creating a compaction message.
- Test configured `threshold` changes predictive and reactive trigger points consistently.
- Test configured `reserved` reduces predictive usable budget consistently with reactive.
- `rg -n "model\\.limit\\.input \\|\\| model\\.limit\\.context|OPENCORVUS_COMPACTION_PREDICTIVE_THRESHOLD" packages/opencorvus/src/session` finds no production predictive-budget source outside `ContextBudget`.

### Phase J: Preserve Tail On User Turn Boundaries

Files:

- `packages/opencorvus/src/session/compaction.ts`
- `packages/opencorvus/src/session/message.ts`
- `packages/opencorvus/test/session/compaction.test.ts`
- `packages/opencorvus/test/session/message.test.ts`

Change:

- `splitTurn()` must only return a `Tail` whose `id` belongs to a user message.
- If a turn is too large and no user boundary inside it can fit, do not split into assistant suffix. Either keep the whole turn if budget allows or compact the whole turn into the handoff.
- `tail_start_id` remains the single source for retained tail start. Do not add a second tail marker.

Acceptance:

- Test a huge turn does not produce `tail_start_id` for an assistant message.
- Test `filterCompacted()` never returns a retained tail starting with assistant when the source history contains a user message boundary.
- Test ordinary tail preservation still keeps recent complete turns.

### Phase K: Historical Compaction Residue Diagnostics

Files:

- `packages/opencorvus/script/repair-empty-snapshot-patch-evidence.ts` or a renamed broader script if scope expands
- Optional dedicated read-only diagnostic script under `packages/opencorvus/script/`

Change:

- Add a dry-run diagnostic for historical compaction residue:
  - empty assistant messages adjacent to compaction messages,
  - failed compaction assistant messages,
  - legacy prose `assistant.summary` rows that no longer pass `CompactionHandoff.isValidSummaryMessage`,
  - oversized patch/session diff artifacts.
- Repair mode may delete invalid empty placeholders and failed compaction rows only when they match exact structural criteria. It must not rewrite old prose summaries into valid structured summaries.
- Keep DB backup before any mutation.

Acceptance:

- Dry-run on `tsk_e1f9c2cd4001z5TZEezacMOY84` reports the known empty/failure residue separately from patch evidence.
- Apply mode, if used, only removes structurally invalid rows and leaves valid patch parts intact.
- Re-running dry-run after apply returns zero residue for the targeted task.

## Non-Goals

- Do not implement another memory system.
- Do not summarize or rewrite `AGENTS.md` / `CLAUDE.md` into memory as a substitute for disk reload.
- Do not change workflow/orchestrator scheduling.
- Do not add compatibility fallback for old summary formats.
- Do not introduce non-streaming LLM calls.

## Test Plan

Targeted tests:

- `bun test packages/opencorvus/test/session/compaction.test.ts`
- `bun test packages/opencorvus/test/session/compaction-continue-inherit.test.ts`
- `bun test packages/opencorvus/test/session/instruction.test.ts`
- `bun test packages/opencorvus/test/session/message.test.ts`
- `bun test packages/opencorvus/test/session/predictive-compaction-decision.test.ts`
- `bun test packages/opencorvus/test/server/session-routes.test.ts`
- `bun test packages/opencorvus/test/memory/index.test.ts packages/opencorvus/test/memory/stages.test.ts`

Quality gates after implementation:

- `bun run typecheck`
- `bun run api:routes-check` if route schema changes
- `bun run docs:check` if public docs are updated
- `rg -n "SessionCompaction\\.create\\(|experimental\\.session\\.compacting|session\\.summarize|Defaults to 0\\.7" packages specs docs` before final review
- `rg -n "model\\.limit\\.input \\|\\| model\\.limit\\.context|OPENCORVUS_COMPACTION_PREDICTIVE_THRESHOLD|prompt\\?: string" packages/opencorvus/src packages/plugin/src` before final review

## Review Questions

1. Is the plan still single-source, or does any phase create a second durable instruction store?
2. Is output validation strong enough to prevent low-fidelity summaries from becoming memory episodes?
3. Does the compaction prompt receive enough live state without bloating itself by copying full instruction files?
4. Are manual focus instructions modeled as a per-compaction directive rather than a new summary mode?
5. Are there missing call sites for `SessionCompaction.create/process`, `Message.filterCompacted`, or `/summarize`?

## Independent Review Feedback Incorporated

Review agent `019e1f3e-2900-75d0-a763-ca1b109cfcce` identified and this revision incorporates:

- Phase 0 for lossy instruction loading (`AGENTS.md` shadowing `CLAUDE.md`).
- Plugin prompt override and config prompt override as contract bypass risks.
- Legacy summary boundaries and memory flush as unsafe acceptance paths.
- Assistant-level errors and patch parts as missing evidence sources.
- Runtime memory policy: reference IDs/titles only, no recursive memory-content summaries.
- Focus storage single source: `CompactionPart`.
- ACP/TUI/generated SDK summarize call sites.
- Manual route success semantics.
- Replacement of Markdown heading validation with structured Zod handoff validation.

Second review agent `019e1fee-e78e-7f63-99b5-7716afcd9709` identified remaining gaps and this revision incorporates:

- Predictive fail-fast branches still leaving empty assistant placeholders.
- Predictive/reactive budget split and config bypass.
- Schema-valid but low-quality handoffs becoming compact boundaries.
- Repair script not covering legacy/failed compaction residue.
- Plugin hook type still advertising prompt override.
- `splitTurn()` possibly retaining assistant-only tail suffixes.
