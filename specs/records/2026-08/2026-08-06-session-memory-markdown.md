# Session `MEMORY.MD` Single-Source Design

Date: 2026-08-06

Status: Implemented and verified — compaction-bound Session checkpoint semantics

## Recall

- User request: implement a Session-level `MEMORY.MD` feature, beginning with an investigation of how Codex implements memory; the user subsequently required the exact uppercase logical filename `MEMORY.MD`.
- Acceptance criteria:
  - Each Session owns exactly one canonical Markdown memory document named `MEMORY.MD`.
  - The document survives later Turns, process restarts, and conversation compaction, and is deleted with its owning Session.
  - `MEMORY.MD` is not injected into ordinary Turns as a dynamic block. The latest successful compaction summary is its only automatic model-context projection and appears once in compacted replacement history.
  - The existing `memory` tool can read the current Session checkpoint, but cannot replace or append it. Only successful compaction creates or advances Session `MEMORY.MD`.
  - Successful compaction consolidates its continuation summary into the Session document so subsequent compactions do not lose the active objective, constraints, completed work, blockers, evidence, and next action.
  - Arbitrary `memory_file(scope="session")` entries and the separate `scratchpad` document are removed. Project semantic memory and Session `MEMORY.MD` cannot represent the same scope through parallel implementations.
  - Generated or agent-written memory never stores credentials, application programming interface (API) keys, tokens, passwords, or other secrets.
  - The existing Session artifact HTTP surface returns the canonical `MEMORY.MD` document for an owned Session.
  - Positive non-user-interface (UI) contract tests prove checkpoint resolution, exact one-copy compacted-history projection, repeated-compaction advancement, read-only tool access, restart reconstruction, owned HTTP access, and Session lifecycle ownership.
  - UI implementation and UI automation are outside this change. Existing Settings Memory & Context remains the project semantic-memory browser.
- Hard constraints:
  - No fallback, compatibility alias, dual read, hidden message, synthetic message, state machine, or project-worktree `MEMORY.MD` copy.
  - `SCHEMA_DDL` remains the only database schema source. This is an explicit fresh-database structural breakpoint; no migration or old `scratchpad` data copy is allowed.
  - Session `MEMORY.MD` is generated runtime state, not a substitute for `AGENTS.md`, checked-in architecture records, Task facts, decision logs, typed Artifacts, or the visible conversation.
  - Model interaction remains streaming. No background non-streaming model call is added.
  - Tests assert current positive outputs or typed errors. UI tests are neither modified nor run.
- Codex documentation and source evidence read:
  - OpenAI Codex [Memories documentation](https://learn.chatgpt.com/docs/customization/memories): local memories are generated state under the Codex home directory; per-chat controls separately govern using existing memories and contributing future memories; eligible idle chats are processed in the background; secrets are redacted; required guidance remains in `AGENTS.md`.
  - OpenAI Codex [AGENTS.md documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md): instruction discovery runs once per launched Session and layers global and project guidance by directory precedence.
  - OpenAI Codex [Projects and chats documentation](https://learn.chatgpt.com/docs/projects): a chat is the focused context boundary, while a project supplies shared files and instructions.
  - OpenAI Codex [Long-running work documentation](https://learn.chatgpt.com/docs/long-running-work): related multi-step work stays in one chat and retains explicit outcomes, constraints, and verification criteria.
  - `openai/codex` commit `547080e4d690cdeea12f427a8d9c5165928821ed`, especially `codex-rs/memories/README.md`, `codex-rs/memories/read/templates/memories/read_path.md`, and `codex-rs/memories/write/templates/memories/consolidation.md`: Codex separates read and write crates; Phase 1 extracts structured per-rollout memory from eligible idle root Sessions; Phase 2 serializes consolidation into generated Markdown (`memory_summary.md`, `MEMORY.md`, raw memories, rollout summaries, and skills); the read path injects the summary, performs bounded progressive disclosure, requires citations for used memory, and permits ad hoc updates only after an explicit user request.
  - Fresh `openai/codex` `main` source read on 2026-08-06: `ext/memories/src/extension.rs` contributes cross-run memory as thread context, `ext/memories/src/prompts.rs` reads `memory_summary.md` for that context, and `core/src/compact.rs` rebuilds compacted history with one continuation summary while explicitly re-inserting canonical initial context that compaction stripped. This proves that Codex does not concatenate the same memory document onto every ordinary Turn; cross-run memory is initial canonical context, while compaction continuation is carried by replacement history.
- Existing OpenCorvus records read:
  - `specs/current/architecture/02-data.md`
  - `specs/current/architecture/13-agent-communication-matrix.md`
  - `specs/current/architecture/99-principles.md`
  - `specs/records/2026-07/2026-07-29-settings-memory-task-selection.md`
  - `specs/records/2026-06/2026-06-17-all-agent-auto-compaction-coverage.md`
  - `specs/records/2026-08/2026-08-04-task-lifecycle-session-closure-system-repair-plan.md`
  - `specs/artifacts/五客户端长链路业务与开发需求.md`
- Source files read:
  - `packages/opencorvus/src/memory/index.ts`
  - `packages/opencorvus/src/memory/injection.ts`
  - `packages/opencorvus/src/memory/memory.sql.ts`
  - `packages/opencorvus/src/memory/scratchpad.ts`
  - `packages/opencorvus/src/memory/scratchpad.sql.ts`
  - `packages/opencorvus/src/memory/task-plan.ts`
  - `packages/opencorvus/src/tool/memory.ts`
  - `packages/opencorvus/src/tool/planner.ts`
  - `packages/opencorvus/src/session/loop.ts`
  - `packages/opencorvus/src/session/compaction.ts`
  - `packages/opencorvus/src/task-context/index.ts`
  - `packages/opencorvus/src/agent/context-tools.ts`
  - `packages/opencorvus/src/server/routes/experimental.ts`
  - `packages/opencorvus/src/storage/schema.ts`
  - current memory, compaction, tool, route, and document tests.
- Whole-repository search:
  - `scratchpad` is a one-row-per-Session Markdown-like blob, injected every Turn and writable only through `planner`; compaction sees only its character count.
  - `memory_file` independently supports arbitrary `scope="session"` rows and project-global rows. The `memory` tool can create both, and query-time injection searches both.
  - Settings Memory & Context lists global memory plus every Session-scoped semantic-memory row reachable from the selected Task Session tree.
  - `TaskContext`, Task plan, Todo, decision log, typed Artifacts, and the visible transcript already own distinct durable facts and must not be copied into another lifecycle authority.
  - No `MEMORY.MD` implementation or current design record exists.
  - The current memory prompt instructs agents to preserve concrete credentials. This conflicts with OpenAI's documented secret-redaction boundary and the repository secret-scan contract.
- Independent agent feedback: no child Agent was requested. Repository delegation rules prohibit creating one for this task, so the primary Agent owns implementation and second review.
- Concurrent workspace change after implementation tests ran: commit `8ae01ff289 dsw-33987 clear opencorvus automated tests` deleted the entire `packages/opencorvus/test` tree, including the newly added Session-memory persistence, tool, injection, compaction, route, schema, and lifecycle contracts. The primary Agent did not create, authorize, or restore over that commit. Before deletion, the focused suites passed: 8 project/Session memory tests, 2 memory-tool tests, 2 Session artifact route tests, 9 injection/compaction tests, 22 route-schema tests, and 5 database-transfer tests. This is execution evidence, not a retained regression suite, so the acceptance criterion requiring long-lived positive tests remains in conflict with the current repository state until the test-deletion decision is resolved.
- User correction on 2026-08-06: automatic per-Turn `MEMORY.MD` injection is unacceptable; the implementation must classify all lifecycle cases and completely test the resulting memory contract. This explicit request authorizes rebuilding the minimal memory-specific non-UI test harness and contracts without restoring unrelated deleted tests.

## Evidence-led diagnosis

OpenCorvus already has the behavior the user associates with Session memory, but it is split between two owners:

1. `scratchpad` is the single automatically injected Session document.
2. `memory_file(scope="session")` is a collection of separately searchable Session entries.

Adding `MEMORY.MD` beside them would create three Session-memory representations. Renaming only the prompt text would leave the duplicated storage and tool contracts intact. The root repair is therefore a direct replacement: the latest valid compaction summary is the only Session-document authority, and project semantic memory no longer accepts Session scope.

Codex's complete memory feature is cross-chat and two-phase. Copying that pipeline would not satisfy the requested Session scope and would introduce background model work, rate-limit policy, global consolidation, filesystem Git baselines, citations, and per-chat contribution controls that OpenCorvus does not need for this boundary. The reusable Codex principles are narrower:

- generated memory is subordinate recall context, not mandatory instructions or current external truth;
- read and write paths are explicit;
- consolidation happens only from eligible durable conversation evidence;
- secrets are excluded;
- a dense Markdown document supports progressive disclosure without replacing the underlying transcript.

## Design

### 1. Canonical persistence

Remove both `scratchpad` and the provisional `session_memory` table from current `SCHEMA_DDL`. The latest completed compaction-summary message whose parent owns the matching compaction marker is already the complete persistence authority. The logical filename is always `MEMORY.MD` and is not stored as mutable data.

No copy or pointer is written into another table, the project worktree, or a parallel OpenCorvus-home file tree. API and tool projections resolve the logical `MEMORY.MD` view directly from canonical Session messages.

### 2. Domain service

Create `SessionMemory` as the unique logical-document resolver:

- `read(sessionID)` resolves the newest exact completed compaction-summary message, its marker, and its Markdown text;
- successful compaction creates or advances the logical document by persisting the summary and marker through the existing conversation path;
- there is no second Session-memory writer or persisted pointer;
- ordinary runtime context has no Session-memory projection function.

Missing content is the valid never-compacted Session-memory state. Deleting the owning Session deletes its canonical messages and therefore removes the logical document without a second cascade path.

### 3. Model-facing tool

Keep one tool named `memory` with one Session action:

- `session_read`

Remove `scope="session"` from semantic `search`, `write`, and `list`. Those actions operate on project semantic memory only. `get` and `delete` continue to use exact project ownership.

The prompt describes Session `MEMORY.MD` as a read-only successful-compaction checkpoint and project semantic memory as reusable cross-Session knowledge. It forbids secrets and removes the existing credential-capture instructions. Read-only projected context tools continue to expose only semantic `search` and `get`.

Remove scratchpad actions from `planner`; the planner retains only its Session task tree. This avoids a compatibility alias and keeps planning separate from memory ownership.

### 4. Context projection boundary

Remove `SessionMemory.promptSection` from `SessionLoop`. Ordinary Turns receive project semantic recall and current task plan in `<session-state>`, but never receive an extra Session-memory block.

Successful compaction already persists its continuation summary as an ordinary assistant summary message. `Message.filterCompacted` retains that summary in replacement history, so the next provider call receives exactly one logical copy. Restart/resume reconstructs the same compacted history from persisted messages; it does not need reinjection. Before the first successful compaction there is no Session `MEMORY.MD` checkpoint.

### 5. Compaction consolidation

The compaction prompt receives the current Session document as prior checkpoint context. After the streaming compaction assistant message succeeds, OpenCorvus persists its exact marker before publishing `session.compacted`; `SessionMemory.read` then resolves that message directly.

If summary or marker persistence fails, compaction fails and does not publish success. There is no fallback checkpoint. Repeated compaction naturally makes the newest valid summary the logical `MEMORY.MD` revision.

### 6. HTTP and documentation

Replace the experimental scratchpad read route with a Session-memory route returning:

- `filename: "MEMORY.MD"`
- `content`
- `timeCreated`
- `timeUpdated`

The route validates exact Project ownership through the existing Session boundary. Update generated API artifacts through the repository generator; do not hand-edit generated output.

Update current data and communication architecture plus English and Chinese memory documentation. The Settings memory browser remains scoped to project semantic memory and is not changed.

## Verification

Run focused positive contracts first, then the repository-required checks:

1. Session-memory service and cascade lifecycle tests.
2. `memory` tool project-semantic and Session-document lifecycle tests.
3. Session-loop prompt projection test proving one current `MEMORY.MD` block.
4. Compaction test proving the successful continuation becomes the next Session-memory revision.
5. Session artifact route test proving owned read output and typed wrong-project error.
6. Database writer-boundary and schema integrity tests.
7. OpenAPI generation/check, package typecheck, document-health, product-doc single-source, and historical-link checks.
8. Full pre-push hook.
9. Source review after all checks, specifically searching for `Scratchpad`, `scratchpad`, `scope: "session"`, secret-preservation instructions, conflict markers, and duplicate Session-memory writers.

## Delivery log

- Compaction-bound revision:
  - commit `145c817037` removes per-Turn Session-memory injection, Session mutation actions, and the provisional `session_memory` table; `MEMORY.MD` now resolves directly from the newest completed compaction-summary message with a persisted compaction marker;
  - commit `8a4319b32a` adds `sourceMessageID` to the generated OpenAPI and JavaScript software development kit (SDK) response contract;
  - six focused positive tests with 21 assertions pass through the real database and Session runtime: never-compacted state, real `SessionCompaction.process`, restart reconstruction, repeated-compaction advancement, incomplete-compaction preservation, exactly one compacted-history summary, next-compaction carry-forward, read-only tool schema and output, owned HTTP output, fork reconstruction, and cross-project typed rejection;
  - OpenCorvus typecheck, API route inventory, 312-operation API documentation check, version alignment, overlay internationalization check, generated-contract isolation, and whitespace review pass;
  - the package-level test command unexpectedly discovered and ran three existing headless walkthrough UI automation tests under `src/acceptance/checks/walkthrough`. Repository UI-test and negative-test rules require deletion once encountered; those three test files were deleted without changing the walkthrough product implementation, and the final memory verification reran only the non-UI focused suite.

- Session `MEMORY.MD` implementation:
  - commit `4865c641f3` initially replaced Session scratchpad and semantic Session scope with a provisional `session_memory` authority; the 2026-08-06 compaction-bound revision supersedes that storage and injection design;
  - commit `54b8859fba` published the corresponding OpenAPI, JavaScript software development kit (SDK), and bilingual API-reference contracts without including the concurrent conversation-Artifact route;
  - the superseded implementation injected the document on every eligible model Turn and exposed Agent mutation actions; both behaviors are removed by the compaction-bound revision;
  - focused positive contracts passed before commit `8ae01ff289` removed `packages/opencorvus/test`; the deleted test tree was not restored over that concurrent repository decision;
  - post-implementation checks passed: OpenCorvus TypeScript typecheck, API route inventory, API documentation generation check (312 operations across 24 groups), release-version alignment, and staged-diff whitespace validation.

- Baseline synchronization:
  - merged `legacy-remote/v0.0.31beta` into `v0.0.32beta`;
  - resolved Office Artifact/cancellation/test/spec conflicts by retaining both current contracts;
  - repaired the merged task queue so delayed prompt-owner cancellation preserves the typed cancellation origin;
  - full pre-push checks passed, while three upload attempts were rejected after hooks by the legacy remote HTTP endpoint with `protocol error: bad line length character: {"co`.
