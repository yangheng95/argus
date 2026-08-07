# Terminal Refill and Prompt Loop Convergence

Date: 2026-07-30
Status: implemented and verified

## Recall

### User request

- Diagnose why Task `tsk_fb3100c3d001Fn6H1T3dqzL4y7` first stalled after a successful Goal Build and later failed with `session prompt loop finished`.
- Consult multiple independent Agents on the infrastructure repair.
- Repair the shared infrastructure rather than the individual failed Task.

### Acceptance

- A Goal-scoped Build terminal occurrence reaches the Orchestrator as a typed current lifecycle ingress carrying the exact Goal, Goal-attempt, and child Session identities.
- The durable Task snapshot remains the only source for whether an attempt is currently unresolved and for its Host observation, publication, and dependency facts.
- A naturally closed Session prompt loop cannot be misclassified as an Orchestrator hard failure or terminalize an otherwise active Task.
- A real terminal refill in a reused Orchestrator Session produces a visible `complete_goal` or `reject_goal_attempt` decision and continues with the complete dependency-ready frontier.
- All new or rewritten automated coverage is positive and non-User Interface. No User Interface automated test is added, modified, or run.
- Existing parallel worktree changes remain untouched.

### Hard constraints

- No Host workflow gate, automatic Goal completion, retry counter, fallback, state machine, hidden message, synthetic message, or task-specific branch.
- `event.note` remains diagnostic only; no logic may parse identities from free text.
- A queued lifecycle occurrence says why the current wake exists. It does not assert that the referenced attempt is still unresolved when the wake is consumed.
- Preserve the durable Orchestrator Session and visible conversation history.
- Commit subjects use the `dsw-33987` prefix and the completed change is pushed to `legacy-remote`.

### Read records and architecture

- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/15-agent-facts-and-turns.md`
- `specs/records/2026-07/2026-07-18-crypto-trading-long-mission-benchmark.md`
- `specs/records/2026-07/2026-07-25-goal-worker-evidence-continuation-repair.md`
- `specs/records/2026-07/2026-07-28-goal-attempt-shutdown-retry-convergence.md`
- `specs/records/2026-07/2026-07-30-orchestrator-ready-frontier-parallel-dispatch.md`

### Repository-wide search

The repository-wide searches covered:

- `OrchestratorEvent`, `dispatchTaskLoop`, `Goal Build child terminal`, `renderWakeProvenanceNotice`, `hasCurrentWakeIngress`;
- `Terminal Goal Refill`, `complete_goal`, `reject_goal_attempt`, `goalAttemptID`;
- `session prompt loop finished`, `SessionPromptState.finish`, `SessionPrompt.loop`, `attach`, `flushCallbacks`;
- `triggerTaskWaitFromActivity`, `renderTaskWaitEarlyActivityNote`, scheduled Task wait callers and tests.

Call-point disposition:

| Surface | Current role | Required change |
| --- | --- | --- |
| `orchestrator/event.ts` | Typed wake envelope; `note` is diagnostic | Add typed Goal terminal-refill and Task-wait-activity occurrence identities |
| `orchestrator/build-tool.ts` | Produces Goal Build terminal wake | Populate exact typed Goal/attempt/Session identity; keep note only for logs |
| `engine/queue.ts` | Persists and replays the complete event | Classify typed occurrence source kinds without creating another store |
| `orchestrator/agent.ts` | Builds current wake provenance and executes Session prompt loop | Project typed lifecycle ingress and treat typed natural prompt-loop closure as non-failure |
| `scheduler/automation-service.ts` | Converts accepted scheduled Task wait activity into a wake | Populate a typed activity occurrence instead of relying on diagnostic prose |
| `scheduler/task-wake-runtime.ts` | Narrow scheduler-to-queue dispatch boundary | Accept the canonical typed Orchestrator event rather than a note-only shadow shape |
| `session/prompt/state.ts` | Owns prompt callbacks and physical generation cleanup | Replace the anonymous generic finish error with a typed natural-closure signal |
| `engine/describe.ts` | Rebuilds current unresolved terminal refills from durable facts | Retain unchanged as the single current-state source |
| `orchestrator/goal-lifecycle-tools.ts` | Validates exact latest attempts for lifecycle decisions | Retain unchanged |
| `test/orchestrator/tools.test.ts` | Covers Goal Build terminal wake production and queue persistence | Replace note-string expectations with exact typed events |
| `test/orchestrator/operator-message.test.ts` | Covers wake provenance but contains negative-source assertions | Rewrite touched cases as complete positive provenance outputs |
| `test/session/prompt-state-terminal.test.ts` | Covers callback and prompt-owner lifetime | Add positive typed natural-closure contract |
| `test/scheduler/automation-service.test.ts` | Covers early Task wait ownership | Assert the exact typed activity occurrence |
| real runtime acceptance | Currently absent for this causal chain | Reuse one Orchestrator Session with long history and prove terminal refill convergence |

### Independent Agent feedback

Three read-only Agent reviews agreed on the same root:

- The durable Queue does not lose the event; the semantic loss occurs because exact lifecycle identity is reduced to `note` and omitted from current Wake Provenance.
- A typed occurrence field is necessary but insufficient unless the producer, durable source classification, current-ingress test, Wake Provenance, and delayed-event semantics are updated together.
- Existing prompt text already requires terminal-refill convergence. Repeating that text is not a repair.
- The roughly 77,000-token history amplified the error but was not the missing-data root.
- Static renderer tests cannot prove model behavior. Acceptance must include a real same-Session terminal-refill replay.
- The delayed wake may be stale; current Task Context, not the occurrence, decides whether to complete, reject, or continue the ready frontier.

## Proven causal chain

### Terminal refill stall

1. Goal Build produced a terminal child Session, final message, Host observation, and published commit.
2. `build-tool.ts` encoded Goal, attempt, and Session only inside `event.note`.
3. Queue persisted the event, but `renderWakeProvenanceNotice()` ignored `note` and described the turn as having no current ingress.
4. Historical assistant prose still said the Build was running.
5. The model reused that historical claim, emitted status-only prose, and entered standby without `complete_goal`, `reject_goal_attempt`, or a frontier dispatch.

### Prompt-loop failure

1. The Orchestrator called `wait` while an internal Goal Build was still streaming, despite the existing contract that internal child completion supplies its own refill.
2. A terminal write tool result consumed the scheduled wait and dispatched an early Task wake.
3. A Session prompt callback remained attached until the physical prompt owner finished.
4. `SessionPromptState.finish()` rejected the callback with the untyped generic `Error("session prompt loop finished")`.
5. The Orchestrator catch path treated that natural physical-loop closure as a hard prompt failure, stamped `task.error`, and made the Task terminal before the real Goal terminal refill could converge.

## Design

### Typed lifecycle occurrences

Add exact optional fields to `OrchestratorEvent`:

```ts
goalTerminalRefill?: {
  goalID: string
  goalAttemptID: string
  sessionID: string
}

taskWaitActivity?: {
  source: string
  detail: string
  jobIDs: string[]
}
```

These fields are immutable occurrence identity only. They do not carry current Goal status, Host-observation bodies, authorization, or a scheduler outcome.

### Wake projection

`renderWakeProvenanceNotice()` renders every current occurrence. A Goal terminal occurrence directs the model to cross-check the exact attempt against the current `Terminal Goal Refill` and complete or reject only when it remains unresolved. A Task-wait activity occurrence explains which accepted scheduled wait caused the wake and directs the model back to the current Task snapshot.

### Natural prompt-loop closure

Introduce a typed `SessionPromptLoopFinishedError` from the Session prompt state owner. It means that a callback attached to a physical prompt owner did not receive a result before that owner closed. Provider, stream, tool, cancellation, and data-integrity failures retain their existing concrete errors.

The Orchestrator recognizes this exact typed signal as a natural physical-loop disposition, records an informational trace, and leaves the Task lifecycle unchanged. The subsequent already-durable wake remains responsible for the next scheduling decision.

## Positive verification

- Exact typed Goal terminal event from successful and infrastructure-failure Build outcomes.
- Durable queued wake round-trip with `goal_terminal_refill` source classification.
- Exact typed Task-wait activity event after an accepted early wake.
- Wake Provenance containing all simultaneous occurrence identities and the current-ingress summary.
- Session prompt callback resolving to the typed natural-closure contract.
- Orchestrator natural closure preserving the active Task and later refill opportunity.
- Real same-Orchestrator-Session terminal refill with long history, visible `complete_goal`, and complete ready-frontier dispatch.
- Focused TypeScript typecheck, relevant non-User Interface tests, `git diff --check`, historical-doc links, document-health tests, and pre-push hooks.

## Second review

The post-implementation review re-read the complete diff against the causal
chain, the current architecture chapter, and the three independent Agent
reviews.

- The repair has one event source and one current-state source: Queue replays
  the typed occurrence, while `describe` remains authoritative for unresolved
  Goal state and Host evidence.
- The scheduler's Task-wake adapter now accepts the canonical
  `OrchestratorEvent`; it no longer narrows the shared event to a note-only
  shadow contract.
- Natural prompt-owner closure is distinguished by exact error type before the
  hard-error funnel. Provider, stream, tool, cancellation, and integrity errors
  retain their existing paths.
- No workflow gate, automatic completion, retry reaction, fallback, second
  inbox, hidden message, or Task-specific condition was introduced.
- `processRecovery`, which was already typed but omitted from the same current
  ingress projection, was brought through the canonical renderer in the same
  repair.

Verification completed:

- Goal Build producer and durable Queue tests: 3 passed.
- Wake provenance tests: 8 passed.
- Typed prompt-owner closure and active-Task preservation tests: 2 passed.
- Scheduled Task-wait activity test: 1 passed.
- Terminal Goal Refill projection tests: 6 passed.
- Immutable exact Goal-attempt completion/rejection contracts: 7 passed.
- `packages/opencorvus` TypeScript typecheck: passed.
- Historical documentation links: 2 passed.
- Product documentation single-source checks: 8 passed.
- Full document-health run: 62 passed before the new record was staged; its
  sole tracking-index failure then passed after the record became tracked.
- Worktree and staged `git diff --check`: passed.

The active production Task and database were not mutated during acceptance.
The same-Session collision path was exercised in an isolated real
`Orchestrator.processTask` runtime with the typed terminal-refill occurrence;
the Task remained `active`. Exact current refill rendering and exact
`complete_goal` / `reject_goal_attempt` persistence were verified through their
existing database-backed integration suites.
