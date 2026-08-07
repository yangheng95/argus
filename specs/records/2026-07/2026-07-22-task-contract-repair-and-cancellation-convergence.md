# Task Contract Repair And Cancellation Convergence

Date: 2026-07-22
Status: Completed
Owner: Codex

## Recall

### User request

The user supplied debug evidence for Task `tsk_f850292fd001nTF6NnDCwsTX1Z`, asked why the
WP-05 Mission repeatedly revisited planning, and then asked to repair the diagnosed
problems.

### Acceptance criteria

- The Orchestrator must treat a latest operator question or diagnostic request as the
  current request, not silently continue a stale implementation plan.
- After execution starts, a point contract correction must stay on the active Goal graph;
  the scheduler must not re-run requirements and thereby supersede the executable spec
  unless evidence proves a structural task-contract replacement is required.
- A completed scheduler wake must make a real tool decision. It must not describe a
  terminal child as live or use prose-only "waiting" as a decision.
- Task cancellation must quiesce existing and concurrently arriving task-loop launches
  before terminal cancellation is recorded. No post-cancel Orchestrator epoch may start
  from a wake admitted during cancellation.
- The invocation DAG/board must not return HTTP 500 while a newly created projected-worker
  Session exists briefly before its worker descriptor. The incomplete row must not be
  misidentified as another Agent.
- Debug output must distinguish task-scoped outcomes from Goal-scoped build outcomes and
  must expose retry intent (`needs_redispatch`) so a historical `passed` label is not
  presented as current satisfaction after `modify_goal`.
- Double-click Task diagnostics must synchronize a fresh board before copying so a
  terminal task cannot retain a stale `streaming` invocation row in the clipboard.
- Focused regressions, OpenCorvus and Overlay type checks, document-health tests, and Git
  diff checks must pass.

### Hard constraints

- Do not add a workflow gate, compatibility path, fallback identity, keyword intent
  matcher, synthetic message, hidden message, or status machine.
- Preserve the LLM-owned scheduler decision boundary. Behavioral routing repairs belong in
  the Orchestrator prompt; host changes are restricted to lifecycle concurrency and
  evidence-projection integrity.
- Preserve worker descriptor identity as the only projected-worker identity source.
- Preserve immutable terminal Goal attempts and their retry-intent evidence; improve the
  read/debug projection instead of rewriting history.
- Do not restart, refresh, close, or otherwise interfere with the running OpenCorvus or
  Overlay process.
- Preserve unrelated dirty expert-squad runtime-loading work. This repair must not stage or
  commit those files.
- Commit subjects use the `dsw-33987` prefix and push to `myhexin/v0.0.13beta` without
  bypassing hooks.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/13-agent-communication-matrix.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-07-dependency-contract-single-source-repair.md`
- `specs/records/2026-07/2026-07-20-task-research-dispatch-observability-systemic-repair.md`
- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`
- `packages/opencorvus/src/orchestrator/loop.ts`
- `packages/opencorvus/src/orchestrator/task-loop-control.ts`
- `packages/opencorvus/src/orchestrator/agent.ts`
- `packages/opencorvus/src/orchestrator/goal-lifecycle-tools.ts`
- `packages/opencorvus/src/orchestrator/task-event.ts`
- `packages/opencorvus/src/task-api/index.ts`
- `packages/opencorvus/src/engine/queue.ts`
- `packages/opencorvus/src/engine/describe.ts`
- `packages/opencorvus/src/engine/persist.ts`
- `packages/opencorvus/src/engine/goal-status.ts`
- `packages/opencorvus/src/agent/runner.ts`
- `packages/opencorvus/src/agent/worker-turn-descriptor.ts`
- `packages/opencorvus/src/agent/persisted-session-identity.ts`
- `packages/opencorvus/src/agent/outcomes.ts`
- `packages/overlay/src/utils/debug-info.ts`
- Runtime SQLite, protocol-event, message, Part, decision-log, and server-log evidence for
  the supplied Task.

### Whole-repository search evidence

- `rg -n "NoDecisionStop|decision contract|modify_goal|superseded spec|active spec|worker_turn_descriptor|persistedSessionAgentID|cancelTask|runTaskLoop|operator message|read_task_message|collectTaskAgentOutcomes" specs/current specs/records/2026-07 packages/opencorvus/src packages/opencorvus/test`
- `rg -n "interruptTaskLoop|awaitTaskLoopIdle|registerTaskLoopPass|beginTaskLoopLaunch" packages/opencorvus/src packages/opencorvus/test`
- `rg -n "WorkerTurnDescriptor|Session.createNext|persistedSessionAgentID" packages/opencorvus/src packages/opencorvus/test`
- `rg -n "goalStatusByID|needs_redispatch|superseded_reason|modify_contract" packages/opencorvus/src packages/opencorvus/test`
- `rg -n "Task Agent Outcomes|Agent Invocation DAG|retry:" packages/overlay/src packages/overlay/test`

### Independent agent feedback

No sub-agent was used. The user did not request parallel agents, and runtime/database
evidence plus the existing architecture and focused tests are sufficient for this repair.

## Causal diagnosis

The Task contained two real downstream contract conflicts. The scheduler correctly
repaired the database conflict on the third attempt, but later routed a local REST catalog
correction through the requirements adapter. That adapter persisted a new active spec,
which made every existing Goal belong to a superseded spec and forced Architect re-entry.
An operator diagnostic question arrived while that long adapter call was in progress; the
old scheduler turn continued its stale recovery path instead of treating the latest
operator request as authoritative.

The confusing runtime symptoms were independently amplified by three host-side integrity
issues:

1. `cancelTask()` cancelled the handles visible in its initial snapshot but did not hold a
   task-loop quiescence ownership. A concurrent operator wake could register a new pass
   after cancellation had interrupted the prior pass and before terminal state was written.
2. Projected-worker Session creation precedes worker-descriptor persistence. The board's
   strict identity projection throws during that expected incomplete evidence window,
   producing a transient HTTP 500.
3. The debug blob labels only task-scoped outcomes and prints historical Goal status
   without the canonical `needs_redispatch` fact, making a modified completed Goal look
   currently accepted.

## Call-site disposition

| Surface | Callers / consumers | Repair |
| --- | --- | --- |
| Orchestrator core prompt | Every task scheduler wake | Make latest operator intent authoritative; forbid requirements/spec replacement for point correction after execution; forbid prose-only internal waiting. |
| `task-loop-control` launch/pass registration | Engine queue, operator wakes, task loop | Add an in-memory quiescence ownership used only by destructive lifecycle settlement; newly registered launches/passes inherit an already-aborted signal while quiescence is held. |
| `EngineService.cancelTask()` | Task cancel route, Mission cleanup, project/task deletion | Acquire quiescence, interrupt/settle loop ownership, cancel task-owned Agent handles, persist terminal cancellation, then release quiescence. |
| `listConversationAgentSessionsForSessionTree()` | Board DAG, conversation agent ledger, debug projection | Omit only projected-worker rows that have neither descriptor nor lifecycle evidence yet; continue throwing for partial/corrupt descriptors or descriptor-less workers that have become observable. |
| Goal board/debug projection | Overlay Task clipboard debug | Print retry intent and explain task-scoped outcome count; retain immutable historical attempt status. |
| Task debug-copy interaction | Overlay conversation title | Require a fresh synchronized board before building the clipboard payload; surface refresh failure instead of copying stale evidence. |
| Current architecture docs | Maintainers and future repairs | Record operator-intent precedence, cancellation quiescence, and incomplete worker-session projection semantics. |

## Implementation plan

1. Tighten the Orchestrator core prompt and its exact-string regression tests around latest
   operator requests, point repair, requirements/spec replacement, and internal waiting.
2. Add task-loop quiescence ownership and integrate it into cancellation with focused race
   tests that register a wake during cancellation.
3. Make the conversation Agent ledger evidence-complete: hide an unobservable newborn
   worker row, but fail once lifecycle/message evidence makes a missing descriptor a real
   integrity defect.
4. Extend Task debug output with task-scope wording and Goal retry-intent facts.
5. Synchronize fresh Task board evidence at the debug-copy interaction boundary.
6. Update current architecture and this record, run focused tests and type checks, then
   perform a second diff review before committing only this repair's files.

## Validation plan

- `bun test packages/opencorvus/test/orchestrator/orchestrator-core-prompt.test.ts`
- `bun test packages/opencorvus/test/orchestrator/task-loop-control.test.ts`
- `bun test packages/opencorvus/test/task-api/cancel-task-live-ownership.test.ts`
- `bun test packages/opencorvus/test/workbench/board.test.ts`
- `bun test packages/opencorvus/test/orchestrator/task-event.test.ts`
- `bun test packages/overlay/test/task-debug-info.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/overlay typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`
- `git diff --check`

## Implementation result

Completed without adding a workflow gate, fallback identity, compatibility path, keyword
intent matcher, or synthetic message:

- Task-loop cancellation now owns an in-process quiescence token. Existing launch/pass
  ownership is interrupted, concurrently arriving ownership inherits an aborted signal,
  and `cancelTask()` proves the loop idle before writing terminal cancellation.
- Newborn projected-worker Sessions are omitted only while they have no descriptor,
  message, or lifecycle evidence. Once observable, the existing strict descriptor
  integrity error remains authoritative.
- The Orchestrator prompt treats the latest persisted operator message as the current
  request, keeps local contract correction on the active Goal graph, reserves requirements
  replacement for proven user-level contract changes, and forbids prose-only waiting after
  a terminal worker result.
- Task board/debug projection now exposes immutable historical Goal status separately from
  retry intent and labels direct outcomes as task-scoped.
- The Task debug-copy action synchronizes a fresh board before building clipboard text, so
  terminal state and invocation-DAG evidence come from the same current backend snapshot.
- OpenAPI and generated TypeScript SDK contracts include optional `retryIntent`.

## Validation evidence

- 47 focused Orchestrator, task-loop, task-event, and board tests passed.
- 2 live cancellation race tests passed; cancellation timeout and running-task deletion
  settlement regressions also passed.
- 9 Overlay debug tests passed.
- OpenCorvus and Overlay TypeScript type checks passed.
- `api:routes-check` passed with 31 route files clean; `docs:check` passed with 285
  operations in 23 groups.
- Historical documentation link/structure tests passed (21 tests).
- A separate Vite preview against the existing backend rendered the supplied cancelled
  Task, the double-click diagnostic action completed with the visible `已复制` feedback,
  and the resulting viewport was visually reviewed. No running OpenCorvus/Overlay process
  was restarted or refreshed.
- Final document-health, product-docs single-source, diff, hook, commit, and push evidence
  is recorded by the repository history and command results for this change.
