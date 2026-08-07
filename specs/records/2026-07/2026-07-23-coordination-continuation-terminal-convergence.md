# Coordination Continuation Terminal Convergence

Date: 2026-07-23
Status: Implemented; live task resumed
Owner: Codex

## Recall

### User request

The user reported that the Mirror Prism Mission cloning
`www.tradingview.com/spaces` had stalled again, asked whether this was systemic,
and then asked to repair the problem and restore the existing task.

Affected runtime identities:

- Mission: `69ddd1553a755e35`
- Task: `tsk_f8d50b623001TIy1vATb7zc56T`
- Goal: `gol_f8d560d340011fQphq0PquOyBQ`
- Orchestrator Session: `ses_072af44bcffe4Sgs6TNE7nvhC9`
- Author worker Session: `ses_07299e959ffdXW2nDQt4g9aRt2`

### Acceptance criteria

- A projected worker that calls `request_orchestrator_decision` returns the
  declared coordination handoff through its adapter instead of being rewritten
  as a missing-finalizer failure.
- A `continue` response invokes the existing worker runtime's runner-owned
  continuation boundary. It must not call `SessionPrompt.loop()` through a
  second Orchestrator-owned lifecycle path.
- A successful continued turn is validated against the same hard model-error,
  durable handoff, terminal-finalizer, report, trace, and Session terminal
  publication rules as the initial worker turn.
- A failed continued turn records the same visible failure evidence and
  terminal error as the initial worker turn.
- `respond_agent_coordination` waits for and returns the continued worker's
  real outcome, so the Orchestrator can schedule dependent work from terminal
  evidence rather than a “scheduled” acknowledgement.
- Focused tests reproduce the production failure without manually forcing a
  terminal Session status in a `SessionPrompt.loop()` mock.
- The existing Mirror Prism Mission resumes from the already-produced Author
  artifact and advances to its next declared workflow node.

### Hard constraints

- No timeout watchdog, keyword inference, status reconciler, gate, fallback,
  compatibility path, hidden message, synthetic message, or state machine.
- `runAgentSession` remains the single owner of projected-worker completion
  validation and terminal Session publication.
- The durable coordination request, response, action, worker-message,
  descriptor, projection, and execution-lease identity checks remain strict.
- Preserve the existing unrelated modification in
  `2026-07-22-mirror-prism-full-workflow-distillation.md`.
- Do not restart, stop, refresh, or reload the running OpenCorvus/Overlay
  processes without explicit user authorization.
- Do not create a worktree. Commit subjects use `dsw-33987` and delivery is
  pushed to `legacy-remote/v0.0.16beta`.

### Sources read

- `AGENTS.md`
- Runtime Mission, Task, Goal, Session, Message, Part, coordination request,
  coordination response, coordination action, ownership, and decision-log
  evidence for the identities above
- `specs/current/architecture/07-panel-reactivity.md`
- `specs/current/architecture/08-agent-tool-adapter.md`
- `specs/records/2026-07/2026-07-22-turn-projection-and-coordination-handoff-repair.md`
- `packages/opencorvus/src/agent/dispatch-adapter-contract.ts`
- `packages/opencorvus/src/agent/runner.ts`
- `packages/opencorvus/src/session/runtime-contract.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/orchestrator/delegated-worker-tool.ts`
- `packages/opencorvus/src/delegated-worker/agent.ts`
- `packages/opencorvus/src/delegated-worker/output-tools.ts`
- `packages/opencorvus/src/engine/agent-coordination.ts`
- `packages/opencorvus/src/engine/projected-agent-execution-lease.ts`
- `packages/opencorvus/src/engine/stage-continuation.ts`
- `packages/opencorvus/src/orchestrator/stage-continuation-runtime.ts`
- `packages/opencorvus/src/engine/tool-ownership.ts`
- `packages/opencorvus/test/server/task-conversation-routes.test.ts`
- `packages/opencorvus/test/tool/request-orchestrator-decision.test.ts`

### Whole-repository search evidence

- `rg -n "scheduleAgentCoordinationContinuation|SessionPrompt\\.loop\\(" packages/opencorvus/src packages/opencorvus/test`
- `rg -n "request_orchestrator_decision|coordinationHandoff|handoff_drain" packages/opencorvus/src packages/opencorvus/test`
- `rg -n "runAgentSession\\(" packages/opencorvus/src packages/opencorvus/test`
- `rg -n "agentCoordinationHandoffResult" packages/opencorvus/src packages/opencorvus/test`
- `rg -n "SessionStatus\\.Event\\.Status|publishSessionStatus|type: \"terminal\"" packages/opencorvus/src packages/opencorvus/test`
- `rg -n "completeAgentCoordinationAction|failAgentCoordinationAction|transferToTerminal" packages/opencorvus/src packages/opencorvus/test`
- `rg -n "executionAdapter|SessionRuntimeContractStore" packages/opencorvus/src packages/opencorvus/test`
- `rg -n "terminalToolCompletion\\(|coordinationHandoffToolID" packages/opencorvus/src/agent packages/opencorvus/test`

### Independent agent feedback

No sub-agent was used because the user did not request delegation or parallel
agents.

## Causal diagnosis

The visible `streaming` Session is not the root cause. The Author worker
produced `.mirror/prd/subpage-spaces.md`, committed it as `19f3d43`, and
successfully called `submit_delegated_worker_result`. The lifecycle split
happened in two stages:

1. The initial delegated-worker turn called
   `request_orchestrator_decision`. `runAgentSession` correctly returned a
   typed coordination handoff, but `DelegatedWorkerAgent.run` ignored that
   completion alternative and immediately required its domain collector.
   The dispatch therefore surfaced a false missing-finalizer error.
2. After the Orchestrator answered `continue`, `orchestrator/tools.ts`
   appended a real continuation message and launched a raw
   `SessionPrompt.loop()`. That path only attached a rejection handler. It
   bypassed `runAgentSession`'s hard-error conversion, collector/finalizer
   validation, report construction, trace write, success terminal
   publication, and returned outcome. The worker completed useful work, but
   its Session remained stale `streaming` and the Orchestrator had no terminal
   Author evidence with which to dispatch Reviewer.

The existing server regression concealed the second defect by mocking
`SessionPrompt.loop()` and manually setting Session terminal `completed`.
Production has no equivalent write, so the test asserted a state that the
actual continuation path never produced.

This is systemic for any projected adapter that both exposes
`request_orchestrator_decision` and resumes through the raw continuation
function. It is not caused by the Mirror PRD title, TradingView source, model,
or Author output content.

## Call-site disposition

| Surface                                                              | Callers / consumers                                                                                                          | Disposition                                                                                                                                               |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runAgentSession`                                                    | Delegated Worker, Requirements, Architect, frontend design, workload analysis, intent analysis, Visual QA, Fact Check, Build | Extract one runner-owned finished-turn boundary used by both initial and coordination-continuation turns.                                                 |
| Projected-worker runtime `executionAdapter`                          | `SessionRuntimeContractStore`, Session loop, coordination target validation                                                  | Carry the runner-owned continuation function in the frozen process-local runtime contract and retain it when snapshotting.                                |
| `scheduleAgentCoordinationContinuation`                              | `respond_agent_coordination(decision="continue")` only                                                                       | Remove the raw Orchestrator-owned `SessionPrompt.loop()` path; invoke the projected worker execution adapter instead.                                     |
| Coordination action completion                                       | Continue response replay and task evidence                                                                                   | Complete the action only after the continued worker outcome is known; persist the exact completion/report facts in the action result.                     |
| Continuation execution lease                                         | Projected-agent concurrency pool                                                                                             | Transfer the same lease to the runner-owned continuation promise until it settles.                                                                        |
| `DelegatedWorkerAgent.run`                                           | `createDelegatedWorkerTool`                                                                                                  | Return `AgentCoordinationHandoffResult` before reading the domain collector.                                                                              |
| Build adapter                                                        | `BuildAgent.run`, Orchestrator build tool                                                                                    | Audit the declared handoff against the wrapper result contract; do not let Build reinterpret a handoff as a missing build report.                         |
| Requirements/Architect/frontend/workload/intent/Visual QA/Fact Check | Their stage wrappers                                                                                                         | Retain their existing explicit `agentCoordinationHandoffResult` propagation.                                                                              |
| Research adapters                                                    | Shared research runner and frontend/deep research stages                                                                     | Retain their existing explicit handoff propagation.                                                                                                       |
| Explore/Integrity adapters                                           | Their own execution paths                                                                                                    | Verify their declared handoff surface and outcome propagation; change only if the real path has the same mismatch.                                        |
| Server A2A regression                                                | `task-conversation-routes.test.ts`                                                                                           | Replace the manual terminal-status mock with assertions over runner-owned continuation completion, action evidence, returned report, and terminal status. |

## Implementation plan

1. Add a typed process-local projected-worker continuation function and
   outcome to the runtime execution adapter.
2. Extract the runner's completed-turn and failed-turn handling so initial and
   continued generations use the same validation, report, trace, and terminal
   publication implementation.
3. Make `respond_agent_coordination(continue)` await that function, transfer
   the execution lease to its promise, and store/return the real outcome.
4. Repair adapter wrappers that currently discard the typed initial handoff,
   beginning with the reproduced delegated-worker path and auditing Build,
   Explore, and Integrity.
5. Add focused unit and route regressions, then run typecheck, document-health
   checks, relevant coordination/runner tests, and `git diff --check`.
6. Perform a second diff review, commit, push to `legacy-remote`, then restore the
   supplied Mission without restarting the running application.

## Verification commands

- `bun test packages/opencorvus/test/agent/runner-prompt.test.ts`
- `bun test packages/opencorvus/test/tool/request-orchestrator-decision.test.ts`
- `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts`
- `bun test packages/opencorvus/test/agent/dispatch-adapter-contract.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `git diff --check`

## Implementation

- `ProjectedWorkerExecutionAdapter` now carries a process-local
  `continueSession` callback and a typed domain-or-handoff completion result.
- `runAgentSession` owns shared successful-turn and failed-turn completion
  functions. Both the initial turn and a coordination continuation use those
  functions for model-error conversion, durable handoff validation, terminal
  tool validation, report construction, trace persistence, and terminal
  Session publication.
- `respond_agent_coordination(decision="continue")` now awaits the installed
  runner continuation, retains the projected execution lease until it
  settles, and records the actual report or next handoff in the durable action
  result. The raw background `SessionPrompt.loop()` continuation path was
  removed.
- The delegated-worker wrapper returns the canonical typed coordination
  handoff before attempting to read its domain collector.
- Runtime fixtures and route tests install the same continuation contract
  instead of manually publishing a successful Session state.

## Verification result

Passed:

- `bun run --cwd packages/opencorvus typecheck`
- Full `packages/opencorvus/test/orchestrator/tools.test.ts`: 132 passed
- Full `packages/opencorvus/test/server/task-conversation-routes.test.ts`: 37
  passed
- Focused runner continuation and handoff cases: 3 passed
- Full delegated-worker agent suite: 7 passed
- Focused A2A task-conversation route cases: 5 passed
- Full runtime-contract tool suite: 14 passed
- Dispatch-adapter and coordination-request tool focused cases
- `packages/opencorvus/test/script/historical-docs-links.test.ts`: 21 passed
- `git diff --check`

Two broader suites retain failures outside this change:

- `packages/opencorvus/test/session/extra-tools.test.ts` has three existing
  projection/schema expectation failures: two expect a projected Build agent
  that the current catalog does not expose, and one expects a nullable
  `dispatch_agent` request schema that the current route declares non-null.
  This repair changes only the required runtime-continuation callback in that
  suite's fixture.
- The full `packages/opencorvus/test/agent/runner-prompt.test.ts` has three
  stale exact-copy assertions for the active projection sentence. The current
  checked-in prompt already uses the resolved projection wording; this repair
  does not change that prompt or those assertions.

The coordination continuation, delegated-worker, route, typecheck, and
document-health surfaces affected by this repair pass.

## Live-task recovery

The source repair was committed as `81fcde049` and pushed to
`legacy-remote/v0.0.16beta`. The already-running desktop sidecar uses an embedded
binary, so this recovery did not restart, refresh, or replace that process.

An operator recovery message was injected into Task
`tsk_f8d50b623001TIy1vATb7zc56T` with the Author artifact, commit, and
successful finalizer evidence. The API returned:

- `appended=true`
- `orchestratorWoken=true`
- `status=active`

The Orchestrator then acknowledged that the stale Author `streaming` status
was not unfinished work and dispatched the required independent Reviewer:

- Reviewer Session: `ses_072431e0fffevtAqm2YexCUZGW`
- Agent: `mirror-prd-reviewer`
- Kind: `integrity`
- Observed status after dispatch: `streaming`

The Mission and Task remain `running` while Reviewer works, which is the
expected resumed state. Loading the source repair into the desktop sidecar
still requires a separately authorized application restart; no such restart
was performed during recovery.
