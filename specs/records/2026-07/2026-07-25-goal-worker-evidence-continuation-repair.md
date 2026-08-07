# Goal worker evidence and continuation repair

## Recall

### User request

Repair the infrastructure defects exposed by Mission `7a18cba92c55a6b9`, then restart the existing backend and test the same Mission without publishing a replacement Mission. The monitored project is `/Users/yangheng/Documents/OpenCorvus-Demos/prism`; the backend is expected at `http://127.0.0.1:7878`.

### Acceptance criteria

1. A goal-scoped background Build terminal turn durably publishes its Session lifecycle and causes one fresh Orchestrator decision pass based on the real terminal fact. The wake does not complete, fail, retry, or otherwise choose the Goal outcome.
2. A projected delegated worker receives the full canonical payload for every exact task-scoped `artifact:<id>` ref selected by the Orchestrator. Missing selected artifacts fail visibly instead of degrading to a label-only reference.
3. The Build runtime template does not expose interactive Coding-only `delegate_agent`.
4. Raw pending Goals remain pending in task and Mission status progress rather than being counted as running.
5. Agent invocation DAG lifecycle evidence is persisted for cross-directory workers without requiring the test or caller to manually drain the cross-instance bridge.
6. Focused regressions, typecheck, documentation health checks, commit, normal-hook push to `legacy-remote`, backend restart, and a bounded real Mission verification pass succeed.

### Hard constraints

- Preserve every unrelated staged, unstaged, and untracked parallel change. Do not stash, reset, restore, delete, broadly stage, or create a worktree.
- No fallback, compatibility path, state machine, gate, synthetic message, hidden message, retry loop, fabricated Mission, or weakened permission boundary.
- The terminal wake is an ingress notification for a real participant fact only. The Orchestrator remains the sole decision owner.
- Do not repeatedly publish the Mission. Restarting the backend is authorized only after the repair is verified locally.
- Every code change requires a regression test. Commit subjects start with `dsw-33987`; push only to `legacy-remote`.

### Sources read

- `AGENTS.md`
- `packages/opencorvus/src/orchestrator/build-tool.ts`
- `packages/opencorvus/src/orchestrator/loop.ts`
- `packages/opencorvus/src/orchestrator/protocol/message-bridge.ts`
- `packages/opencorvus/src/session/status-publication.ts`
- `packages/opencorvus/src/agent/runner.ts`
- `packages/opencorvus/src/delegated-worker/context.ts`
- `packages/opencorvus/src/orchestrator/delegated-worker-tool.ts`
- `packages/opencorvus/src/agent/tool-pool-data.ts`
- `packages/opencorvus/src/status/task-status-snapshot.ts`
- Existing lifecycle, scheduler, status, delegated-worker, and runtime-template tests.

### Whole-repository search evidence

- `awaitTaskMessageProtocolBridgeIdle` is exported by `orchestrator/protocol/message-bridge.ts`; production lifecycle publishers do not call it, while `agent-turn-lifecycle-persistence.test.ts` manually drains it after `publishSessionStatus`.
- Goal-scoped Build starts a detached promise in `orchestrator/build-tool.ts`. Its tool contract promises a terminal refill wake, but the detached completion path only validates that a Goal attempt opened.
- `delegatedWorkerContextSections` receives `evidence_refs` but renders only their string values. Artifact persistence and exact task-scoped lookup already exist in the engine artifact store and are reused rather than duplicated.
- `runtimeTemplateAssignments.build` inherits `taskCodingGlobal`, which inherits `codingGlobal`, which includes `delegate_agent`; `tool/delegate-agent.ts` rejects non-Coding and non-Chat sessions.
- `StatusSnapshotState`, `progressFromSnapshotStates`, `goalStatusFromRaw`, server status routes, Mission projection, Work Ledger projection, Overlay Mission DTOs, and the status tests are the complete status snapshot call surface.
- Session DAG lifecycle comes from persisted `protocol_event` rows produced by the message bridge. The live Mission exposed worker nodes with messages and descriptors but no persisted `session.status`.

### Independent agent feedback

No independent agent was requested for this repair, so no sub-agent was started.

## Observed failure chain

At `2026-07-24T18:48:44Z`, Build Session `ses_06a9acbdfffeeticQFGb7xiBMc` had a visible final message (`msg_f957517e20010Rbc25iwRlN32S`) and Host observation `art_f95755d1e0016LGAHAGEtMjFxU` for Goal attempt `b23d2667`, including contribution commit `c21482d7a56d`. The Task remained active with no streaming owner and no `goal_attempt_result`. This is not proof that Build should auto-complete the Goal: `complete_goal` is intentionally an Orchestrator decision. It is proof that the real child-terminal fact did not produce the promised next decision opportunity.

The same run exposed three adjacent data-plane defects: delegated PRD workers received selected artifact IDs without their payloads, Build saw an unusable `delegate_agent` tool, and seven raw pending Goals were projected as running. Null-status child nodes further showed that lifecycle publication was not durably settled before the cross-directory worker lease ended.

## Root repair

1. Make the lifecycle publication boundary await its own durable protocol projection. The lower-level bridge remains the single persistence owner; callers no longer need a second drain operation.
2. Emit one task-loop wake after a goal-scoped background Build promise reaches a real terminal result and its lifecycle/evidence publication has settled. The event names the terminal Session/attempt fact and contains no scheduler outcome.
3. Resolve only explicit `artifact:<id>` delegated-worker evidence refs against the current Task and render their canonical payloads into the worker context. Reject a missing explicit artifact ref.
4. Split Build's projected tool pool from interactive Coding so `delegate_agent` remains available only to Coding/Chat.
5. Add `pending` to the snapshot state model and preserve it through Goal progress, Task progress, Mission aggregation, server DTOs, Overlay DTOs, and tests.

## Verification plan

- Focused unit/integration tests for cross-directory lifecycle persistence, Build terminal wake behavior, delegated-worker artifact payload projection, runtime template tool scope, and status snapshots.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`
- Relevant package typecheck and normal Git hooks.
- After push, stop the authorized port-7878 backend, restart it in the Prism project directory, confirm process/port health, and perform one bounded Mission/task/session/interaction check on the existing IDs.

## Parallel-work note

Before this task's first edit, local `HEAD` was `f40471a2072c830f0bccd19cdcd4ee57eade2a0c` while `legacy-remote/v0.0.18beta` was `c1bea0824f9b2a25c741d971a86fe6d23127bdc3`; the worktree already contained extensive unrelated parallel changes. The repair owns only the files enumerated by its final staged diff.

## Verification evidence

- Focused lifecycle, delegated-worker artifact, status snapshot, runtime-template, Build success-wake, and Build failure-wake regressions pass.
- The complete `packages/opencorvus/test/orchestrator/tools.test.ts` suite passes after restoring the missing workspace dependency link for `@modelcontextprotocol/ext-apps`; 103 tests include both terminal-wake paths and prove no automatic Goal result is manufactured.
- Cross-instance protocol, Session status idempotency, and protocol bridge suites pass: 42 tests.
- `packages/opencorvus` TypeScript `tsc --noEmit` passes.
- The Mission and Task status route regression passes.
- Historical-links and product-docs single-source suites pass.
- The document-health suite initially had one shared-worktree-only failure: the monthly README referenced this record and five unrelated parallel records that were still untracked. No source/document-health assertion failed; this record is now tracked, while unrelated records remain owned by their parallel tasks.
- Overlay TypeScript initially exposed the parallel MCP App `mcp-app@1` host integration while it was between caller and props updates. The parallel owner completed that interface and Overlay `tsc --noEmit` now passes without this repair modifying those files.

## Restart verification

The port-7878 backend was stopped through its existing process handle and settled all process-owned prompts before exit. It restarted from the repaired source as PID `46496` in the Prism project directory; `/global/health` returned `healthy: true`, and interaction plus permission lists were empty.

The existing Mission was retained and resumed through a real `/mission/wake` message. The first post-restart status snapshot proved the corrected projection: seven raw pending Goals are reported as `pending`, with task progress `running: 0, pending: 7`, instead of seven false running Goals. Historical null lifecycle rows remain historical, but the new PRD Author Session `ses_06a6569ddffeKztWrhmDz2lPvp` immediately persisted `status.type=streaming` in the Agent invocation DAG. The resumed Orchestrator created that real delegated-worker Session from the exact existing Goal and selected artifact facts; the worker began by reading the PRD skill and verifying the persisted evidence index rather than repeating source discovery. This establishes live recovery, artifact consumption, and cross-instance lifecycle persistence on repaired code.

The recovery transcript also retained two non-blocking schema mistakes as visible evidence: Mission first omitted required `panel.source`, and Orchestrator first supplied Build-only fields to a delegated-worker dispatch. Both strict tools rejected the invalid call; each agent corrected its next call and execution continued. No fallback, hidden correction, or fabricated result was introduced.
