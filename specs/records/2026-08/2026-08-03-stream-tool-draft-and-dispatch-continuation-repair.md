# Stream Tool Draft and Dispatch Continuation Repair

Date: 2026-08-03

## Objective

Repair Task `tsk_fc76a395e00166KkCcQycdCyVs`, where one abandoned streamed
`artifact_publish` input left an open tool part after a later publication
succeeded, and the Orchestrator could not reopen the exact persisted dispatch
lineage even though its Task-owned lineage Artifact still existed. Ensure the
Orchestrator distinguishes a failed worker Session from the durable Artifact
catalog facts that Session may already have published.

## Recall

| Item | Details |
| --- | --- |
| User request | The user first asked why Task `tsk_fc76a395e00166KkCcQycdCyVs` failed, then explicitly requested analysis and repair. |
| Acceptance criteria | A streamed tool-input draft that never reaches validated `tool-call` execution converges without corrupting the assistant message; executed/running tool calls remain strict corruption evidence if left open; the existing activity-retry cleanup passes again; an exact persisted `dispatch_id` reopens its prior Session and workflow occurrence; focused session/orchestrator tests, typecheck, document-health checks, and second review pass. |
| Hard constraints | Follow `AGENTS.md`; keep `ProcessorLostPartsError` strict for executed tools; no fallback, compatibility alias, state machine, keyword rule, or Host gate; no UI test work; no database migration/reset; preserve unrelated untracked files; use `apply_patch`; commit subjects start with `dsw-33987`; push the delivery branch to the configured legacy remote. |
| Runtime evidence | Researcher Session `ses_03895343affeImJIf26mtm8mHq` created pending part `prt_fc76d1bef001n7L91x35WQnuV6` for `artifact_publish` call `call_Thy41JVmTxQwtvWJ2HwZLZlH` with empty input at 11:40:44Z. The same assistant message later completed `artifact_publish` call `call_TL0y6zqJJ4KRte6g5PZ7UvNF` and persisted canonical `base/research-report` Artifact `art_idempotent_8758937180dedccb61c2c4b277d096755fec22d42e0d29a62f19fd479aab3813`. Final processor convergence then raised `ProcessorLostPartsError` for the earlier draft. The Orchestrator next passed exact dispatch ID `art_fc76acb17001AtipwLo1UlUEmO2`, but continuation lookup reported that it did not exist even though Task Artifact `art_fc76acbc8001jNube06Y9bLdXs` contained that exact `dispatch_id`; it then incorrectly retried with the lineage Artifact ID and parked for 20 minutes. |
| Existing regression signal | `bun test packages/opencorvus/test/session/processor-duplicate-tool-call.test.ts --test-name-pattern "activity retry"` currently fails because the processor returns `stop` instead of `continue`. The focused persisted-lineage continuation test currently passes in an isolated database, so the live lookup contradiction must be repaired at the canonical lookup boundary rather than represented as a deterministic isolated-test failure. |
| Sources read | `AGENTS.md`; `specs/current/architecture/03-control.md`; `specs/current/architecture/08-agent-tool-adapter.md`; `specs/current/architecture/13-agent-communication-matrix.md`; `specs/records/2026-07/2026-07-07-llm-activity-retry-attempt-isolation.md`; `packages/opencorvus/src/session/processor.ts`; `packages/opencorvus/src/llm/activity.ts`; `packages/opencorvus/src/llm/api.ts`; `packages/opencorvus/src/session/repair-hint.ts`; `packages/opencorvus/src/engine/dispatch-lineage.ts`; `packages/opencorvus/src/orchestrator/tools.ts`; relevant focused tests; live SQLite rows, Task trace, decision log, and session log. Official AI SDK documentation confirms that input-start/delta are partial streaming lifecycle events and complete validated input is only available at the later input-available/tool-call boundary. |
| Whole-repository grep | `rg -n "lost-open-tool-parts|ProcessorLostPartsError|tool-input-start|findDispatchLineageByDispatchID|continuation_dispatch_id|dispatch_lineage" specs/current/architecture specs/records/2026-07 packages/opencorvus/src packages/opencorvus/test -g "*.md" -g "*.ts"`; `rg -n "streamText\\(|maxRetries|experimental_repairToolCall|createToolCallRepair" packages/opencorvus/src -g "*.ts"`; `rg -n "findDispatchLineageByDispatchID|recordDispatchLineage|DispatchLineage" packages/opencorvus/test -g "*.test.ts"`. |
| Independent agent feedback | No sub-agent was spawned. The user did not request delegation or parallel agents, so direct runtime/database evidence and focused source inspection remain the authoritative inputs. |

## Root Cause

`tool-input-start` is a draft boundary, not proof that a validated tool call was
accepted or executed. `SessionProcessor` persists the draft immediately for
stream visibility, but final convergence currently treats both `pending`
drafts and `running` executed calls as equivalent lost parts. That collapses
two different contracts: a pending draft is safely discardable stream
material, while a running call has crossed the side-effect boundary and must
remain strict failure evidence. The July retry repair removes draft parts only
when `withLLMActivity` emits an explicit retry boundary; the observed provider
stream abandoned one call ID and later completed another inside the same
activity attempt, so that hook never ran.

The recovery defect is a separate identity-resolution failure. Dispatch
lineage payload is the canonical source of `dispatch_id`, but the continuation
path relies on a JSON-extraction SQL predicate that returned no row for a live
Task-owned Artifact whose parsed payload contained the exact requested ID. The
canonical Task lineage collection already parses and validates every payload;
exact dispatch lookup should select from that collection instead of maintaining
a second query shape with different visibility behavior.

The Orchestrator then compounded both failures by treating the Researcher
Session error as proof that no research Artifact existed. Session terminal
evidence and durable Artifact publication are separate observable facts: the
canonical research report had already been published successfully. Recovery
guidance must require a fresh same-Task catalog inspection before stating that
handoff evidence is absent or choosing continuation.

## Repair Plan

1. Add one processor convergence operation that removes pending tool-input
   drafts which never reached `tool-call`, cancels any matching MCP App draft
   lifecycle, and clears their in-memory ownership. Run it both before an
   activity retry and at normal stream completion.
2. Keep running tool calls in `openToolParts()` and preserve the existing typed
   `ProcessorLostPartsError` failure path for them.
3. Repair the existing activity-retry regression and express positive tests for
   both same-stream draft convergence and retry convergence, asserting the
   completed tool result/model message that remains.
4. Make `findDispatchLineageByDispatchID` resolve from the one parsed,
   Task-scoped lineage collection and fail explicitly if persisted identity is
   duplicated.
5. Add a focused positive lineage lookup/continuation contract using a real
   persisted lineage and exact dispatch identity.
6. Require the Orchestrator to enumerate the current same-Task Artifact catalog
   after a worker failure and distinguish persisted deliverables from missing
   terminal-success evidence before selecting a recovery action.
7. Run focused tests, full affected non-UI test files where practical,
   OpenCorvus typecheck, historical/docs health tests, and `git diff --check`;
   then perform a second diff review before commit and push.

## Verification Plan

```bash
bun test packages/opencorvus/test/session/processor-duplicate-tool-call.test.ts --test-name-pattern "tool input draft|activity retry"
bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "reopens one prior Session"
bun test packages/opencorvus/test/interactive-artifact/mcp-app-lifecycle-processor.test.ts
bun run --cwd packages/opencorvus typecheck
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
bun test packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

## Implementation

- `SessionProcessor` now removes only `pending` tool-input drafts at a clean
  stream convergence boundary and during a safe activity retry. It cancels the
  matching MCP Apps lifecycle before removing the durable part and in-memory
  call ownership. `running` tool parts remain owned by the existing typed
  `ProcessorLostPartsError` path. External activity failure still converts open
  parts into exact failure evidence before convergence.
- `findDispatchLineageByDispatchID` now selects exact identity from
  `listDispatchLineage(taskID)`, the canonical parsed Task lineage collection,
  and reports duplicate persisted identity explicitly.
- The Orchestrator recovery contract now requires a same-Task Artifact catalog
  inspection after worker failure and separates an already published Artifact
  from missing Session terminal-success evidence.
- The affected processor and MCP Apps lifecycle fixtures now execute inside a
  real `Instance` project context required by result-attachment
  materialization. Their former context-free execution had been turning
  unrelated assertions into `ProcessorUnsafeRetryError` before the intended
  contract ran.

## Verification Results

- `processor-duplicate-tool-call.test.ts`: 16 passed, 0 failed.
- `mcp-app-lifecycle-processor.test.ts`: 3 passed, 0 failed.
- Focused exact dispatch continuation: 1 passed, 0 failed.
- `orchestrator-core-prompt.test.ts`: 12 passed, 0 failed.
- OpenCorvus TypeScript typecheck: passed.
- Historical documentation links: 2 passed, 0 failed.
- Product documentation single source: 8 passed, 0 failed.
- Document health: 60 passed, 0 failed against this task's staged record and
  index ownership. A separate concurrent task's untracked August record and
  index entry were excluded from this task-owned check and restored unchanged
  in the working tree afterward.
