# Task cancel durable Agent status settlement

## Recall

### User request

Restart the current TradingView Spaces Task. Stop the old execution through the real cancellation lifecycle, load the already repaired backend, and start a clean Mission/Task without reusing the old Session or run directory. Continue to repair any evidenced shared Agent/Squad infrastructure defect rather than treating the restart as success by itself.

### Acceptance criteria

1. The old Task and Mission settle through their public cancel/abort routes before a fresh Mission is published.
2. A Task cancellation that has proved all current-process prompts and queue work settled publishes a durable terminal status for every Agent Session whose latest persisted lifecycle status is still non-terminal.
3. Already terminal completed/error/aborted Agent Sessions retain their first terminal reason.
4. Real prompt ownership, cross-directory ownership, activity monitors, queue activity, and settlement timeouts continue to return `TaskCancellationIncompleteError`; no terminal Task is stamped early.
5. The fix applies to the shared Task cancellation path for every projected Agent and Expert Squad, with no Agent/Squad special case, fallback, gate, retry, or restart loop.
6. Regression tests reproduce a process-restart shape: durable `streaming` protocol evidence with no current-process `SessionStatus` owner becomes durable `terminal/aborted` only after cancellation settlement.

### Hard constraints

- Preserve all parallel staged, unstaged, and untracked changes. Do not stash, reset, restore, delete, or create a worktree.
- Do not infer physical liveness from the persisted `session.status` projection. Current-process prompt ownership and queue ownership remain authoritative.
- Do not rewrite historical terminal status or delete the cancelled Task/Mission records.
- Do not restart backend PID `31053` while fresh Mission `a0326f635c659e7a` has a live owner.

### Runtime evidence

- Old Mission: `58bd3f2288e90736`; old Task: `tsk_f987349b1001GDIH3c4fdYiLJd`.
- `POST /task/tsk_f987349b1001GDIH3c4fdYiLJd/cancel` returned `true`.
- Task and Orchestrator became terminal cancelled/aborted, but Architect Session `ses_067707968ffetPavR5S0Pp09bR` remained `streaming` in the durable `agentInvocationDAG`.
- The restarted process `/session/status` contained no entry for that Architect, proving there was no current-process status owner.
- Exact child cancel returned HTTP 400: `Session ... has no projected worker runtime identity for agent session control`.
- The old Mission root and Orchestrator were then explicitly aborted. Fresh Mission `a0326f635c659e7a` was created with fresh-08 and did not reuse any old entity.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/01-agents.md`
- `specs/records/2026-07/2026-07-22-stale-session-status-cancellation-settlement.md`
- `packages/opencorvus/src/engine/cancellation-scope.ts`
- `packages/opencorvus/src/engine/task-agent-lifecycle.ts`
- `packages/opencorvus/src/orchestrator/task-event.ts`
- `packages/opencorvus/src/session/status.ts`
- `packages/opencorvus/src/session/status-publication.ts`
- `packages/opencorvus/src/task-api/index.ts`
- cancellation, Task status, Mission, session abort, board, and conversation regression tests

### Whole-repository call surface

| Call point | Disposition |
| --- | --- |
| `cancelSessionPromptInScope` and `assertSessionPromptSubtreeFinished` | Preserve as the physical prompt-owner settlement source. |
| `TaskQueueService.cancelSessionPrompts` and `awaitTaskQueuePromptsIdle` | Preserve as the queue-owner settlement source. |
| `requestTaskAgentLifecycleCancellation` | Preserve complete Task session-tree discovery and cancellation attempts. |
| `EngineService.cancelTask` | After both physical settlement sources succeed, converge stale durable Agent lifecycle projections before writing terminal Task status. |
| `SessionStatus.set` / `publishSessionStatus` | Preserve process-local first-terminal ownership; add one shared durable terminal publication helper for an already-terminal process latch whose protocol projection is missing. |
| `listTaskConversationAgentSessions` / `agentInvocationDAGForTask` | Reuse as the canonical durable latest-status projection; do not add a second session-status query. |
| Mission abort/delete, Task archive/delete, project delete | Continue through shared `cancelTask`; no route-specific repair. |
| Agent/Squad dispatch adapters | No changes; all dynamic Agent families consume the same Task lifecycle. |

### Independent Agent feedback

No sub-agent was started because the user did not request delegation.

## Causal chain

1. The original backend process died while the Architect's latest durable `session.status` was `streaming`.
2. After restart, the process-local `SessionStatus` map and prompt owners were empty, while the durable protocol ledger correctly retained the last observed streaming event.
3. Task cancellation proved the new process had no prompt or queue owner and terminalized the Task and Orchestrator.
4. Only Sessions with a current-process prompt cancellation receipt received terminal publication. The ownerless Architect had no receipt, so its durable streaming event remained the newest event forever.
5. Task status was terminal while `agentInvocationDAG` still advertised a streaming child. UI and API consumers therefore displayed contradictory execution state even though no live owner existed.

The July 22 repair handled ownerless stale state already present in the current process. It did not cover the complementary restart case where stale state exists only in the durable protocol ledger.

## Design

After prompt subtree and queue settlement succeed, read the canonical Task conversation Agent ledger. For each Agent Session whose latest durable status is non-terminal, publish one real `terminal/aborted` lifecycle event with the Task cancellation reason. Skip every already-terminal Session so first-terminal evidence is preserved. If the process latch is already terminal but its protocol event is missing, publish that exact existing terminal fact rather than replacing its reason.

This is lifecycle convergence after physical settlement, not liveness inference or a flow gate.

## Implementation

- `publishSettledSessionTerminalStatus` writes one canonical protocol lifecycle event after physical settlement. It preserves an existing process-local terminal latch and otherwise establishes the requested terminal status without first emitting a duplicate Bus event.
- `publishTaskAgentCancellationStatusesAfterSettlement` reads the existing Task conversation Agent ledger, excludes root/system and sessions without lifecycle evidence, skips every durable terminal status, and converges only the remaining Agent sessions.
- `cancelTask` and the shared archive/delete settlement path invoke convergence after prompt and queue settlement and before their terminal lifecycle mutations.
- The cancellation decision log records the exact converged Agent Session IDs.

## Verification

- `bun test packages/opencorvus/test/task-api/delete-running-task-settle.test.ts` — 8 passed.
- `bun test packages/opencorvus/test/task-api/cancel-task-abort-timeout.test.ts packages/opencorvus/test/server/task-session-cancel-error-contract.test.ts packages/opencorvus/test/server/mission-routes.test.ts` — 17 passed.
- `bun run typecheck` — 9 package tasks passed.
- Regression coverage proves three complementary cases: durable streaming with no process owner becomes aborted; an already durable completed status is untouched; and an existing process-terminal completed latch repairs a stale durable streaming projection without changing its reason.
