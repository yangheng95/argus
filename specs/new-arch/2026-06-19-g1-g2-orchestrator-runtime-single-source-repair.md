# G1/G2 Orchestrator Runtime Single-Source Repair

Date: 2026-06-19

## Acronyms

- G1: Goal 1, the first task goal in the observed economy clone task.
- G2: Goal 2, the second task goal that should have become the next executable workflow step after G1.
- API: Application Programming Interface, the HTTP route and generated client contract exposed by OpenCorvus.

## Evidence

Observed task `tsk_edf5a295e001TwqVPOdWkTzevn` passed G1, then the orchestrator wake ended with prose saying G2 was next. G2 was not durably projected from the top-level task runtime at that moment. Later evidence showed a build session writing under the goal worktree's nested `.opencorvus/r`, while the task debug and trace readers used the primary task runtime.

Independent review split the fault into four design defects:

| Surface | Evidence | Repair decision |
| --- | --- | --- |
| Orchestrator decision contract | `classifyOrchestratorDecisionStop` accepted any wake containing at least one `orchestratorDecisionEffect=decision`. A same-wake `build(G1)` followed by `read_context` and prose stop was therefore accepted. | The latest non-decision tool after a decision invalidates a clean stop. The orchestrator must make a new decision after observing state. |
| Agent trace runtime root | `AgentTrace` derived write paths from ambient `Instance.directory`; build sessions run with `session.directory=worktreeDir`. | Trace writes carrying `taskID` use `task.project_id -> Project.get(...).worktree` as the primary runtime root. |
| External executor runtime context | `runWithExternalProvider` passed `ProjectRuntimePaths.sessionRoot(Instance.directory, ...)`, so external executors launched from worktrees got a worktree runtime. | External executor `runtimeDir` uses the task's primary project worktree. `worktreeDir` remains the edit cwd. |
| Run liveness | `EngineRuntime.syncNoLiveGoalRuns` could treat an `orchestrator_stream_error` blocked run with no live goal runs as a liveness wake candidate. | Stream-error blocked runs are already stopped for a recorded orchestrator failure and must not be implicitly resumed by liveness. |
| Overlay/debug projection | Mission and task debug blobs are assembled client-side from partial projections, and cross-directory task selection can lose `directory`. | Defer UI projection changes until the runtime and decision facts are single-source; do not add read-two-directory lookup or implicit task global lookup. |

## Call-Point Audit

Commands:

```powershell
rg -n "OrchestratorNoDecisionStop|classifyOrchestratorDecisionStop|collectOrchestratorWakeToolNames|decisionEffectForTool|ProjectRuntimePaths|readTaskEvents|readSessionEvents|OPENCORVUS_RUNTIME_DIR|OPENCORVUS_WORKTREE_DIR|DirectoryRequired|buildTaskDebugBlob|buildMissionDebugBlob|onSelectTask|missionStatusRecord|projectMissionTasks" packages specs -S
rg -n "runWithExternalProvider\\(|runtimeDir|worktreeDir|Instance\\.directory|Project\\.get\\(|task\\.project_id" packages/opencorvus/src/build/agent.ts packages/opencorvus/src/trace/index.ts packages/opencorvus/src/engine/event-log.ts -S
```

Relevant existing constraints:

- `specs/orchestrator-no-decision-stop-2026-06-18.md` already defines no-decision stop as a typed orchestrator contract failure, not an auto-dispatch path.
- `specs/new-arch/2026-05-23-task-session-runtime-isolation.md` requires `ProjectRuntimePaths` as the only runtime path source and says task-scoped runtime paths resolve against the primary project directory, not the goal worktree.
- `specs/new-arch/2026-06-07-goal-batch-notification-preserve-stream-error.md` requires blocked stream-error facts to remain durable; recovery must not silently clear them.
- `specs/new-arch/2026-06-10-mission-task-status-api.md` keeps task status projection derived from existing task rows and board projections, not a new stored status column.

## Fix

1. Tighten `classifyOrchestratorDecisionStop` so a stop is accepted only when the wake's final tool suffix ends with a real decision effect. A decision followed by `read_context`, `query_failed_goals`, `wait`, `browser_preview`, `bash`, or any `none` / missing decision effect is a no-decision stop.
2. Add a trace runtime resolver for task events. If `OPENCORVUS_AGENT_TRACE_DIR` is explicitly configured, use it. Otherwise, resolve the task row and its project row, then write session trace, task rollup, index, and blobs under that project's primary runtime root.
3. Pass task primary project runtime into external build providers. `OPENCORVUS_RUNTIME_DIR` must point to `<primary>/.opencorvus/r/s/...`; `OPENCORVUS_WORKTREE_DIR` and `cwd` must remain the build worktree.
4. Keep liveness from dispatching `orchestrator_stream_error` blocked runs. Runtime may still wake other no-live-goal states that existing tests mark as LLM-decision work, but stream-error recovery needs an explicit orchestrator/user recovery decision.
5. Do not repair this by auto-dispatching G2, scanning nested worktree runtimes, or making overlay retry task routes without an explicit directory. Those are fallback paths and would create a second source of truth.

## Tests

- Extend `packages/opencorvus/test/orchestrator/no-decision-stop.test.ts` with a same-wake `build(decision) -> read_context(observation) -> stop` regression.
- Extend `packages/opencorvus/test/session/trace-task-rollup.test.ts` with a worktree ambient `Instance.directory` regression proving trace writes to the primary task runtime and not to the worktree runtime.
- Add a focused build-agent test for external executor runtime input proving `runtimeDir` is primary-rooted and `worktreeDir` remains worktree-rooted.
- Add an engine runtime test proving a blocked orchestrator stream-error run with no live goals does not dispatch another wake.

## Acceptance

- The economy task shape cannot be accepted as a successful orchestrator wake when G1's build decision is followed by a state observation and only prose about G2.
- A build session whose cwd is a goal worktree writes task/session trace into the primary project runtime.
- No nested `.opencorvus/r` is created in a build worktree by trace recording.
- External executors receive distinct runtime and worktree directories.
- Blocked orchestrator stream-error runs are not implicitly resumed by no-live-goal liveness.
- No fallback reads from both primary and worktree runtimes are introduced.
