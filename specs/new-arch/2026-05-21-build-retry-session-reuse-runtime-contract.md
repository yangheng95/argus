# 2026-05-21 Build Retry Session Reuse + Runtime Contract Plan

## Problem

Goal build retry currently opens a new build session and replays a full build prompt.
That loses the operator-visible continuity of the original build session, makes retry
feedback depend on prompt recomposition timing, and contradicts the intended recovery
shape: the same agent should receive an incremental feedback message and continue the
same conversation.

There is a second coupled failure: agent-specific tools are not purely described by
`Message.User.tools`. That field only stores a boolean allowlist. The actual stage
tools (`report_build_result`, `merge_back`, integrity/prosecutor submit tools, and
orchestrator dispatch tools) are runtime tool objects with closures over collectors,
worktrees, goal ids, and stream hooks. A same-session retry without re-binding that
runtime contract can resume as a bare chat turn or can keep stale collector state from
the previous attempt.

Compaction adds the third failure mode: build's upstream context (requirements,
architect contract graph, sibling goals, fidelity contract, retry rejection facts) is
currently rendered into the first build user prompt. It is not a durable session-level
contract. Once compaction replaces old messages with a handoff summary, the first full
prompt can be reduced to prose, so retry continuation may lose exact upstream work.

## Current Evidence

| Surface                                                                         | Current behavior                                                                                 | Consequence                                                                                                                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/opencorvus/src/build/agent.ts::runWithExternalProviderImpl`           | Always calls `Session.createNext` and `provider.run` for external build sessions.                | External build retry cannot reuse provider-native sessions even though provider `resume` exists.                                                 |
| `packages/opencorvus/src/agent/runner.ts::runAgentSession`                      | Always creates a child session, then installs `setSessionRuntimeContract` once for that session. | Worker tools survive direct replies only for that session, but retry cannot target an existing session through this entry point.                 |
| `packages/opencorvus/src/task-api/index.ts::appendDirectAgentSessionReply`      | Appends a user message with copied prompt envelope and calls `SessionPrompt.loop`.               | Good for manual steering, not enough for build retry lifecycle because it does not open/finalize a goal attempt or bind a fresh build collector. |
| `packages/opencorvus/src/session/loop.ts::withExtraTools`                       | Sets ephemeral tools for a callback and clears them in `finally`.                                | Any resumed turn after the callback loses those tools.                                                                                           |
| `packages/opencorvus/src/orchestrator/agent.ts`                                 | Still uses `SessionPrompt.withExtraTools` for orchestrator tools.                                | Orchestrator itself is not safe for long-lived same-session continuation if resumed outside the original callback.                               |
| `packages/opencorvus/src/session/compaction.ts` + `message.ts::filterCompacted` | Keeps a validated handoff summary and tail messages, not the original full prompt.               | Build's upstream context can be summarized away instead of being re-injected from a canonical source.                                            |

Historical plans confirm the split:

- `specs/new-arch/16-unified-teardown.md` introduced `withExtraTools` as a one-shot extra-tool injection channel.
- `specs/new-arch/2026-05-15-orchestrator-resume-ladder-plan.md` added child steering/cancel recovery but still re-dispatches after cancel.
- `specs/new-arch/2026-05-13-compaction-handoff-hardening.md` already identifies that compaction must preserve durable instruction/context sources separately from transcript summary.

## Design Decision

Replace build retry as "new session + full prompt replay" with:

1. New artifact-backed logical `goal_run_id` attempts still record retry counts and terminal state in `engine_artifact[kind="goal_run_attempt"]`.
2. The build session id is reused across retries for the same goal implementation chain.
3. Retry sends one real incremental user feedback message into that session.
4. Before the message is processed, the host re-binds the session runtime contract for the new attempt:
   - fresh build collector
   - fresh terminal tool contract
   - current worktree/branch/base refs
   - current retry attachments and rejection facts
   - current stream hooks
5. The session then continues with `SessionPrompt.loop`, and the retry attempt is finalized from the fresh collector/output.

This is not a fallback path. The old new-session retry path must be removed when this lands.

## Runtime Tool Contract

`Message.User.tools` remains a visible prompt envelope of enabled tool names. It is not the tool source.

The single source for per-session stage tool objects becomes `SessionRuntimeContract`.

Required changes:

1. Production code must stop using `withExtraTools` for resumable agent sessions.
2. `withExtraTools`, `setExtraTools`, and the `ephemeralTools` map should be deleted after call sites are migrated. If a remaining test-only helper is needed, it should be private to tests, not exported from `SessionPrompt`.
3. `SessionPrompt.cancel(sessionID)` may clear runtime contract because cancellation terminally invalidates in-process closures.
4. A same-session retry must rebuild and replace the runtime contract before appending feedback. It must not reuse the prior attempt's contract.
5. A stale contract is a structural error. These cases must fail before model contact:
   - no contract is installed and the stage requires one
   - installed `agentKind` does not match the session kind
   - installed `goalID` does not match the target goal
   - installed `goalRunID` / attempt id does not match the retry attempt
   - installed terminal collector is already satisfied from a previous attempt
6. Runtime contracts are process-local closures. Crash recovery must rebuild them from persisted task/goal/worktree state before resuming. If rebuild is impossible, surface a hard retry infrastructure error.

Do not move stage submit tools into the global agent registry. They are scoped executable contracts, not static capabilities.

The contract must carry identity, not just tool objects:

```ts
type SessionRuntimeContractIdentity = {
  sessionID: string
  agentKind: "build" | "requirements" | "architect" | "integrity" | "acceptance" | "prosecutor" | "orchestrator"
  contractKind: "stage-attempt" | "orchestrator-wake"
  goalID?: string
  goalRunID?: string
  attemptID?: string
  installedAt: number
}
```

`resolveTools` may read the tool objects only after the identity check for the current continuation passes.
That is not sufficient by itself: the same validation must run before any path enters
`processor.process`, because stale terminal collectors can otherwise reach the model and
then short-circuit as already satisfied after the provider call. Add one validator:

```ts
validateSessionRuntimeContractForContinuation({
  sessionID,
  sessionKind,
  expectedAgentKind,
  expectedContractKind,
  expectedGoalID,
  expectedGoalRunID,
  expectedAttemptID,
})
```

Required call sites:

- `SessionPrompt.prompt`
- `SessionPrompt.loop` before `processTurn` calls `processor.process`
- the new build continuation entry point before appending retry feedback
- manual direct reply before waking stage sessions

`validateSessionRuntimeContractForContinuation` must also reject an already-satisfied
terminal collector for a new attempt. The stale collector check is part of the validator,
not a later terminal-tool-choice side effect.

The phrase "fixed agent tools" means "fixed by the current session runtime contract". It does not mean globally fixed forever. Skill-required registry tools and per-wake orchestrator tools remain dynamic inputs to the contract builder.

The old ephemeral contract maps are not part of the new single source. After migration,
remove or stop exporting these production APIs together:

- `withExtraTools` / `setExtraTools` / `ephemeralTools`
- `withTerminalToolContract` / `setTerminalToolContract` / `ephemeralTerminalToolContracts`
- `withStructuredOutputGuard` / `ephemeralStructuredOutputGuards`

All terminal-tool and structured-output contracts must enter through `SessionRuntimeContract`.

## Build Retry Flow

### First Attempt

1. Create goal worktree if needed.
2. Create build session once.
3. Open the initial artifact-backed logical `goal_run_id` only after the build session id exists.
4. `beginBuildAttempt` for build sessions must receive `sessionID`; `payload.session_id=null` is invalid on the new build path.
5. Persist the running `goal_run_attempt` artifact with `payload.session_id = buildSessionID` in its first write.
6. Compose canonical build context from requirements, architect contract graph, collaboration state, fidelity, acceptance feedback, and retry facts.
7. Store that canonical build context as a session-level build contract artifact, not only as first user-message text.
8. Install runtime contract for the attempt.
9. Send the first full build user message.
10. Run and finalize attempt.

### Retry Attempt

1. Find latest terminal attempt for the goal.
2. Reuse its `session_id`; do not call `Session.createNext`.
3. Open a new artifact-backed logical `goal_run_id` via `engine_artifact[kind="goal_run_attempt"]`, with `payload.session_id` set to the reused build session.
4. Recompute canonical build context from current DB/artifacts.
5. Install a fresh runtime contract for this attempt.
6. Append one user message containing only incremental feedback:
   - previous attempt id and status
   - concrete error/rejection facts
   - required fixes
   - changed worktree state/merge conflict facts if relevant
   - instruction to edit in place
7. Continue the existing session.
8. Finalize the new attempt from the fresh collector.

The incremental feedback message is visible as a normal user message. No hidden/synthetic model-only message is allowed.

The retry attempt still preserves the existing artifact-chain semantics:

- new logical `goal_run_id` per retry attempt
- `supersede_of` points at the prior terminal attempt
- `retry_count` increments through the existing version chain
- `workspace_dir`, `workspace_branch`, and `workspace_base_ref` remain on the attempt payload
- `session_id` is the reused build session id, not a newly created child session

Delete the retry/first-run build path that opens attempts with `session_id=null` and
later backfills session id from `onSessionCreated` or completion. That backfill shape
is a race and a second session identity source under this design.

## External Executor Resume

External executor build currently bypasses `ManagedCodingExecutor` and calls providers directly. That path must gain a true resume branch:

1. Persist provider-native session refs on the build session metadata, as already started by `persistExecutorSessionRef`.
2. On retry, read the previous build session's persisted native ref.
3. Append the incremental feedback message to the OpenCorvus session for UI/history.
4. Call `provider.resume`, not `provider.run`.
5. Resolve a provider-native resume id for every external retry. If no native id can be resolved, fail structurally.
6. Materialize the resumed provider events into a new assistant turn in the same OpenCorvus session.

No provider-specific fallback to full replay is allowed.

The implementation must split first-run and resume paths explicitly:

```ts
type ResumeExternalBuildSessionInput = {
  executor: Exclude<TaskRow["executor"], "opencorvus">
  existingSessionID: string
  nativeSessionRef: PersistedExecutorSessionRef
  incrementalMessage: string
  assistantMessageID: string
  taskID: string
  target: BuildTarget
  worktreeDir: string
  worktreeBranch?: string
  ownsWorktree: boolean
  signal?: AbortSignal
}
```

`resumeExternalBuildSession` may only call `provider.resume`. It must use a resolver:

```ts
resolveNativeResumeRef(executor, persistedRef): string
```

The resolver must never fall back to the OpenCorvus session id. If it cannot return a
provider-native resume id, the retry fails structurally and does not call `provider.resume`
or `provider.run`.

## Compaction Contract

Build's upstream context must stop being only a large first user prompt.

Single source:

- `engine_artifact` keeps task/goal contracts: requirements, architect contract graph, fidelity, acceptance/retry evidence.
- A build-session contract projection pins the exact context snapshot used for the attempt and exposes its source artifact ids.
- Compaction handoff records the source ids and active build contract identity, not a paraphrased copy as the only truth.

New artifact:

```ts
kind: "build_session_contract"
payload: {
  session_id: string
  task_id: string
  goal_id: string
  goal_run_id: string
  spec_snapshot_id: string
  plan_version_id: string
  goal_contract_snapshot: {
    title: string
    kind: string
    objective: string
    owned_paths: string[]
    depends_on: string[]
    requirement_ids: string[]
    acceptance_specs: unknown
  }
  collaboration_goals_snapshot: Array<{
    id: string
    title: string
    kind: string
    status: string
    objective: string
    owned_paths: string[]
    depends_on: string[]
    acceptance_specs: string[]
  }>
  requirements_snapshot: Array<{
    id: string
    type: "explicit" | "implicit"
    description: string
  }>
  contract_graph_artifact_id: string
  contract_graph_digest: string
  design_specs_snapshot: unknown[]
  frontend_design_sources: Array<{ phase: string; key: string; digest: string }>
  fidelity_source: {
    task_metadata_key: "architect_fidelity"
    digest: string
    source_coverage: unknown[]
    reference_coverage: unknown[]
    assembly_owners: unknown[]
  }
  retry_evidence: Array<{ id: string; source: string; digest: string }>
  acceptance_feedback: Array<{ id: string; source: string; digest: string }>
  retry_attachment_refs: Array<{ sha: string; url: string; mime: string; filename?: string }>
  rendered_context_digest: string
  workspace_dir: string
  workspace_branch: string | null
  workspace_base_ref: string | null
}
```

The artifact is append-only per attempt. The latest `goal_run_id` contract is the active build contract for that attempt. The attempt payload remains the session identity source; `build_session_contract.session_id` is a validated assertion that must equal `goal_run_attempt.payload.session_id`. Any mismatch is structural corruption.

Compaction handoff records `build_session_contract` artifact ids and source instruction paths only; it does not become the source of build context. `CompactionHandoff.Schema` must gain a strict field:

```ts
activeBuildContracts: Array<{
  sessionID: string
  goalID: string
  goalRunID: string
  buildSessionContractArtifactID: string
  contextDigest: string
}>
```

Tests must assert artifact ids and context digests, not prose mentions.

Continuation behavior:

1. Normal turns still reconstruct system prompt from disk/config.
2. Build retry reconstructs build context from canonical artifacts before appending feedback.
3. Compaction summary may mention the context, but it is not authoritative.
4. If the canonical build contract cannot be reconstructed, retry fails before contacting the model.

This aligns with the existing compaction hardening principle: durable rules and structured task state are separate sources from historical transcript.

## API / Call-Site Inventory

| Area                                                      | Required decision                                                                                                                                                                                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BuildAgent.run`                                          | Split create-new-session from continue-existing-session. New retry path must accept an existing session id and install a fresh runtime contract.                                                                                                        |
| `runAgentSession`                                         | Keep create-new-session behavior for first attempt/stage agents. Add a separate continue/resume entry point instead of overloading this function silently. It must install a contract with identity metadata.                                           |
| `orchestrator/tools.ts build`                             | Open new `goal_run_attempt` with reused `session_id` on retry, then call build continuation path.                                                                                                                                                       |
| `engine/persist.ts beginBuildAttempt`                     | Require explicit `sessionID` for build attempts under the new path and preserve retry chain. Do not create session identity here and do not allow null-session build attempt writes.                                                                    |
| `task-api replyAgentSession`                              | Remains manual steering. It must reject stage sessions that require runtime contract when no fresh matching contract is installed/rebuildable. Build retry must not use this generic path.                                                              |
| `session/loop.ts`                                         | Remove exported ephemeral extra-tool APIs after migration. `resolveTools` reads registry/MCP/StructuredOutput plus session runtime contract only.                                                                                                       |
| `orchestrator/agent.ts`                                   | Replace `withExtraTools` with a per-wake runtime contract carrying `contractKind="orchestrator-wake"`, then clear it at wake completion; or reject external continuation of orchestrator sessions. Do not persist stale per-wake closures indefinitely. |
| `session/compaction.ts` / `session/compaction-handoff.ts` | Handoff schema must include durable instruction paths and active `build_session_contract` artifact ids.                                                                                                                                                 |
| `engine/engine.sql.ts` / `storage/ddl.ts`                 | Add `build_session_contract` to the artifact kind union / schema source.                                                                                                                                                                                |
| Engine store/read models/export/archive                   | Treat `build_session_contract` as an append-only task/goal artifact and keep export/import projections coherent.                                                                                                                                        |
| Overlay board/files                                       | Multiple attempts can share one session id. UI attempt labels must key attempt state by `goal_run_id`, and message cards by session/message turn.                                                                                                       |

## Acceptance Criteria

1. Retrying a failed goal creates no new build session row.
2. The new `goal_run_attempt` points to the original build session id.
3. The resumed session receives exactly one incremental feedback user message before the retry assistant turn.
4. Build tools remain available on the retry turn.
5. The retry collector is fresh; previous attempt terminal state cannot satisfy the new attempt.
6. External executors call `provider.resume` on retry and never `provider.run`.
7. If runtime contract rebuild fails, retry fails with a visible structural error and does not call the model.
8. Compaction before retry does not remove requirements / architect / fidelity context because retry reconstructs it from canonical artifacts.
9. Production code has no `SessionPrompt.withExtraTools` call sites after migration.
10. Tests cover both in-process OpenCorvus build and one external provider adapter at the contract boundary.
11. A stale satisfied collector from a previous attempt cannot suppress terminal-tool pinning for a new attempt.
12. Direct manual steering of a build session cannot continue with stale stage tools.
13. The first running `goal_run_attempt` artifact for a build attempt has non-null `payload.session_id`.
14. Build retry does not call `Session.createNext`, `EngineService.replyAgentSession`, or `appendDirectAgentSessionReply`.
15. `CompactionHandoff.Schema` validates `activeBuildContracts[]` and rejects summaries that omit the active build contract id.

## Test Plan

- Unit: `SessionRuntimeContract` tools remain visible across appended user messages.
- Unit: `SessionRuntimeContract` identity mismatch rejects continuation before model contact.
- Unit: `withExtraTools` production exports removed after migration; old re-export tests are deleted/replaced.
- Unit: terminal/structured ephemeral contract exports are removed or cannot override `SessionRuntimeContract`.
- Unit: build retry opens a new goal attempt but reuses session id.
- Unit: the initial running attempt artifact is written with non-null `payload.session_id`; no later session backfill is needed.
- Unit: retry appends only incremental feedback text, not the full build prompt.
- Unit: retry installs a fresh collector; old `report_build_result` state cannot leak.
- Unit: stale satisfied collector fails before `processor.process`.
- Unit: missing runtime contract rebuild rejects direct continuation for stage sessions.
- Unit: compaction handoff includes build contract/source ids.
- Adapter test: external build retry invokes provider `resume`.
- Adapter test: missing provider-native resume ref calls neither `provider.resume` nor `provider.run`.
- Orchestrator tool test: `steer_subagent` for a build session without fresh rebuildable contract fails structurally.
- Spy test: retry path does not call `Session.createNext`, `EngineService.replyAgentSession`, or `appendDirectAgentSessionReply`.
- Regression: mutate the goal row after the first attempt; retry still reconstructs the original attempt context from `build_session_contract`.
- Integration: failed build -> retry -> passed build shows one session with multiple user/assistant turns and multiple goal attempts.

## Non-Goals

- Do not keep a compatibility branch that creates a new build session when resume fails.
- Do not move closure-bound stage tools into the global tool registry.
- Do not rely on compaction summary as the source of build contracts.
- Do not add hidden model-only feedback messages.
