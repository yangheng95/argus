# Dispatch occurrence process-recovery root repair

## Recall

- User request: identify the real failure behind Task `tsk_fbdb0624c001NcNw5aKfoberff`, obtain independent Agent review, explain the root cure, and implement it in a new worktree.
- Acceptance: after an ungraceful backend exit, the recovered parent tool names the exact immutable dispatch lineage and logical workflow occurrence; ownerless worker Sessions become durably terminal before the root wake runs; the root wake cannot mistake an already-created occurrence for an initial dispatch; a later Mission Task can import an exact Artifact from the failed terminal source Task.
- Hard constraints: preserve Task/Session ownership, immutable dispatch lineage, prompt-owned scheduling, and the explicit coordination continuation protocol. Do not introduce a Host workflow gate, compatibility path, fallback, synthetic message, UI automation test, or negative regression test. Validate through real persistence/process boundaries and focused non-UI contracts.
- Records and architecture read: `specs/current/architecture/03-control.md`, `specs/current/architecture/13-agent-communication-matrix.md`, root `AGENTS.md`, the failing Task/session/artifact ledger, and the current queue/session/import implementations.
- Whole-repository searches covered `terminalizeRecoveredIncompleteAssistant`, `reconcileInterruptedTaskExecutions`, `interruptedSessionEvidence`, `listOwnedPromptSessionsForTask`, `dispatch_lineage`, `publishSettledSessionTerminalStatus`, `requireMissionArtifactSource`, `query_task_artifacts`, and every current process-recovery/import test caller.
- Independent Agent review: three read-only reviews agreed that the first child was genuinely created and worked, the parent dispatch receipt was lost with the process, two later children were aborted by real `/shutdown` requests, broad Task-level ownership suppresses orphan recovery, and completed-only source authority makes the advertised failed-Task recovery path impossible. The first process disappearance and shutdown caller identity remain unknown and are not asserted as root causes.

## Proven cause chain

1. `dispatch_agent` created a child Session and persisted immutable lineage, but the backend process disappeared before the parent tool part reached a terminal result.
2. Recovery changed the open parent tool into a generic `ProcessExecutionInterruptedError`. Its failure data omitted the existing lineage, child Session, workflow node, and logical occurrence; the renderer also discarded all structured failure data from model history.
3. Project bootstrap drained persisted root wakes before orphan reconciliation. Once the root prompt acquired process-local ownership, reconciliation skipped the entire Task because it tested “any owned prompt” rather than ownership of each interrupted Session.
4. The abandoned worker remained durably `streaming`, while the recovered Orchestrator saw no exact statement that the node occurrence already existed. It chose another initial dispatch and created another physical occurrence.
5. After failure, the Mission recovery path instructed the next Task to import exact evidence, but source authorization admitted only `completed` Tasks. Exact Artifacts from terminal `failed` Tasks were therefore inaccessible and work had to be repeated.

## Single-source repair

| Authority / call site                  | Change                                                                                                                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine/dispatch-lineage.ts`           | Add one exact lookup by Task + parent tool part + tool call, with ambiguity treated as corrupted immutable data.                                                                   |
| `session/loop.ts`                      | When recovering an open `dispatch_agent`, attach the existing lineage Artifact, dispatch, child Session, workflow node, and logical occurrence to the terminal tool failure.       |
| `session/tool-failure-cause.ts`        | Render the already-redacted structured failure data into model-visible tool history.                                                                                               |
| `prompt/core/orchestrator-core.txt`    | State that a recovered dispatch interruption carrying lineage data proves the logical occurrence already exists; never issue a fresh initial dispatch for it.                      |
| `project/bootstrap.ts`                 | Reconcile interrupted executions before any persisted root wake is drained; abort bootstrap instead of draining when lifecycle convergence fails.                                  |
| `engine/queue.ts`                      | Reconcile per ownerless interrupted worker Session, exclude the root Session, reuse an existing pending root wake, publish terminal-aborted lifecycle facts, and deliver one wake.  |
| `session/status-publication.ts`        | Reuse the canonical restart-safe terminal lifecycle publisher; no parallel status writer.                                                                                          |
| `engine/cross-task-artifact-import.ts` | Admit exact Artifacts from every terminal same-Mission source Task, including failed Tasks; active Tasks remain outside the terminal-source contract.                              |
| `tool/panel.ts`, `task-api/index.ts`   | Keep their existing single authority call; behavior changes only at the shared authority.                                                                                          |
| focused tests                          | Prove exact lineage recovery, model-visible structured evidence, ownerless worker terminalization before root wake, and failed-source exact Artifact import.                       |

No same-node Host admission gate is added. Scheduling remains Orchestrator judgment over truthful immutable facts; data-integrity checks only ensure an exact parent tool execution resolves to at most one lineage.

## Validation

- Focused session/dispatch lineage recovery tests.
- Focused engine queue recovery test using isolated durable database lifecycles.
- Cross-Task Artifact import contract test for a terminal failed source.
- Package typecheck and relevant non-UI test suites.
- Spec link/document-health checks, including `historical-docs-links.test.ts`.
- Independent diff review before commit, merge back to `v0.0.28beta`, and push to `myhexin` without bypassing hooks.

## Independent implementation review

The first read-only implementation review found that an interrupted root Turn can already own a durable pending wake. Creating an additional recovery wake would deliver the same Task twice, and allowing bootstrap to continue after terminal publication failure would violate the required ordering. The implementation was corrected to reuse the original wake, create a recovery wake only when none exists, and rethrow reconciliation failure before global wake drain. The real replacement-process test now leaves both a durable streaming child and the original pending wake, then proves one terminalized child and exactly one drained wake. The reviewer rechecked the corrected diff and reported no blocker, high, or medium finding.
