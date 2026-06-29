# All Agent Auto Compaction Coverage - 2026-06-17

## Acronyms

- API: Application Programming Interface, the backend contract used by tests.
- ID: Identifier, a task, session, message, control, or descriptor key.
- LLM: Large Language Model, the runtime that owns agent turns.
- UI: User Interface, the visible overlay surface.

## Task

Add automated coverage for every agent-owned session kind so context pressure
cannot reach an untested direct overflow path. The required behavior is not
"every agent always auto-compacts"; it is "every agent has an explicit automatic
compaction outcome":

- live-continuation workflow agents queue automatic compaction only when the
  live runtime contract and worker descriptor validate
- unsupported workflow agents reject with a typed, visible policy reason
- agent kinds that do not require live continuation queue the existing
  compaction control record

2026-06-25 scheduler amendment: `orchestrator` moved out of the unsupported
workflow partition and into a dedicated `orchestrator-wake` runtime-continuation
partition. It queues automatic compaction only while the live scheduler wake
runtime contract validates. `acceptance` remains explicitly disabled.

## Recall

Read before implementation:

- `deleted pre-June record 2026-05-29-compaction-continuation-rewrite`
- `specs/records/2026-06/2026-06-03-workflow-auto-compaction-kind-single-source.md`
- `specs/records/2026-06/2026-06-04-workflow-auto-compaction-live-continuation.md`
- `packages/opencorvus/src/session/session.sql.ts`
- `packages/opencorvus/src/session/agent-runtime-metadata.ts`
- `packages/opencorvus/src/session/auto-compaction.ts`
- `packages/opencorvus/src/session/compaction.ts`
- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/test/session/compaction-continue-inherit.test.ts`

Key recall conclusions:

- `SESSION_KINDS` is the single source for valid session kinds.
- `AgentRuntimeMetadata.AGENT_OWNED_SESSION_KINDS` is the single source for
  "all agents" in this test.
- `AutomaticCompaction.decision()` is the single policy entry point.
- `SessionCompaction.create({ auto: true })` is the durable queueing/rejection
  path to test; provider overflow and predictive overflow must route through
  the same decision helper.
- The current live-continuation set is all `runAgentSession`-managed worker
  kinds: `architect`, `build`, `explore`, `fact-check`, `frontend-design`,
  `frontend-research`, `goal-workload-analyst`, `integrity`,
  `intent-analysis`, `deep-research`, `requirements`, and `visual-qa`.
- The direct automatic compaction set is explicit metadata, currently `root`,
  `assistant`, `mission`, `goal`, `executor`, `evaluator`, and `system`; new
  kinds must be categorized instead of silently inheriting allowed behavior.
- Unsupported workflow kinds must fail visibly instead of attempting a compact
  continuation without executable runtime evidence.
- 2026-06-17 migration recall: `explore` has two direct prompt call sites,
  `packages/opencorvus/src/orchestrator/tools.ts` and
  `packages/opencorvus/src/tool/task.ts`. Both must become runner-owned before
  `explore` can move from direct automatic compaction to live-runtime
  continuation. `mission` remains a primary session/control lane, not a
  `runAgentSession` stage worker; do not add it to the stage runtime set as a
  workaround.

## Call Point Sweep

Command:

```powershell
rg -n "SESSION_KINDS|AGENT_OWNED_SESSION_KINDS|RUNTIME_CONTRACT_REQUIRED_AGENT_KINDS|LIVE_RUNTIME_CONTINUATION_SESSION_KINDS|DISABLED_AUTOMATIC_COMPACTION_SESSION_KINDS|AutomaticCompaction\.decision|SessionLoop\.automaticCompactionDecision|SessionCompaction\.create|disabledAutomaticCompactionMessage|stopTurnWithPredictiveBudgetError|compaction_request" packages/opencorvus/src packages/opencorvus/test/session specs/new-arch -S
```

| Surface                               | Decision                                                                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `session.sql.ts`                      | Derive valid session-kind coverage from `SESSION_KINDS`; do not re-list a stale session enum.                                                                                              |
| `agent-runtime-metadata.ts`           | Derive all agent-owned kinds and compact policy partitions from metadata arrays, including the direct automatic compaction set.                                                            |
| `auto-compaction.ts`                  | Keep one policy function and test every agent-owned kind against it.                                                                                                                       |
| `loop.ts`                             | Keep predictive and reactive overflow paths routed through `automaticCompactionDecision`; visible errors remain the rejection path.                                                        |
| `compaction.ts`                       | Test `SessionCompaction.create` because it is the durable control-record boundary.                                                                                                         |
| `compaction-continue-inherit.test.ts` | Extend this file with an all-agent matrix rather than creating a second policy test source.                                                                                                |
| `orchestrator/tools.ts::explore`      | Replace direct `SessionPrompt.prompt` with `runAgentSession` so the explore subagent gets a worker descriptor and live runtime contract.                                                   |
| `tool/task.ts::TaskTool`              | Route `@explore` dispatches through `runAgentSession(existingSessionID)` after creating or validating the task child session; keep non-explore subagents on their existing assistant lane. |

## Phase 1 Migration - Explore

Decision:

- Move `explore` from `DIRECT_AUTOMATIC_COMPACTION_SESSION_KINDS` to
  `LIVE_RUNTIME_CONTINUATION_SESSION_KINDS`.
- Add `explore` to `RUNTIME_CONTRACT_REQUIRED_AGENT_KINDS` so direct prompt
  loops without a live contract fail visibly instead of silently continuing.
- Do not add `explore` to `EXACT_RUNTIME_CONTRACT_AGENT_KINDS`; its read-only
  registry tools still come from the `explore` agent include list, with explicit
  task/bashing/writing tool switches carried by the user message and descriptor.
- Keep `mission` in the direct automatic compaction set for this phase because
  it is not a stage worker runtime contract. The next migration step must first
  define a mission-owned live runtime contract rather than treating it as a
  `runAgentSession` agent.

Acceptance additions:

- Orchestrator `explore` dispatch writes a source user message with
  `extra.workerTurnDescriptor` and installs a matching live runtime contract.
- Task-tool `@explore` dispatch writes the same descriptor/contract on both
  fresh and resumed explore child sessions.
- Automatic compaction for `explore` rejects without the live contract and
  queues a `compaction_request` with the live contract.

## Phase 2 Migration - Runner-Managed Workers

Decision:

- Move every remaining `runAgentSession`-managed worker session kind from
  disabled automatic compaction to live-runtime continuation:
  `architect`, `requirements`, `intent-analysis`, `goal-workload-analyst`,
  `fact-check`, `frontend-research`, and `deep-research`.
- Keep `build`, `explore`, `frontend-design`, `integrity`, and `visual-qa` in
  the same live-runtime set.
- Keep `orchestrator` disabled because it owns an `orchestrator-wake` runtime,
  not a worker turn descriptor installed by `runAgentSession`.
- Keep `acceptance` disabled because the current acceptance rows are engine
  artifacts / acceptance facts, not a `runAgentSession` worker invocation.
- Keep `mission` direct for now per
  `2026-06-06-mission-session-agent-identity.md`: mission is a primary
  session/control lane, not a stage worker runtime contract.

Acceptance additions:

- The live-runtime compaction matrix derives its tested kinds from
  `AgentRuntimeMetadata.LIVE_RUNTIME_CONTINUATION_SESSION_KINDS`, so adding or
  removing a migrated worker cannot leave the tests stale.
- Disabled agent-owned automatic compaction is reduced to `acceptance` and
  `orchestrator`.
- The runner prompt contract test proves all live-runtime worker kinds are
  installed through `runAgentSession` with a durable
  `extra.workerTurnDescriptor` and matching `SessionRuntimeContract`.

## Case Matrix

### Case A - Metadata Partitions Cover Every Session Kind

Every kind in `SESSION_KINDS` must be in exactly one automatic compaction
partition:

- runtime-continuation required
- disabled unsupported workflow
- allowed without live runtime continuation

Acceptance:

- No missing session kind.
- No overlapping partition membership.
- Every agent-owned session kind is covered by one of the partitions.

### Case B - Direct Policy Decision For Every Agent

Run `AutomaticCompaction.decision()` for each agent-owned kind.

Acceptance:

- runtime-continuation kinds reject without readiness and allow with readiness
- disabled kinds reject with `unsupported_workflow_kind`
- allowed kinds return `{ enabled: true, reason: "allowed" }`

### Case C - Durable Queue Path For Allowed Agents

Run `SessionCompaction.create({ auto: true })` for each allowed-without-runtime
agent kind.

Acceptance:

- exactly one `compaction_request` control is queued
- no synthetic user/assistant compaction message is inserted
- payload records the source user message ID and overflow flag

### Case D - Durable Reject Path For Disabled Agents

Run `SessionCompaction.create({ auto: true })` for each disabled workflow kind.

Acceptance:

- the call rejects with `reason=unsupported_workflow_kind`
- no pending compaction control is queued

### Case E - Live Runtime Agents Keep Existing Continuation Tests

The existing per-kind tests for `build`, `frontend-design`, `integrity`, and
`visual-qa` remain the executable coverage for live runtime continuation.

Acceptance:

- runtime-ready versions queue `compaction_request`
- missing-runtime versions reject with `runtime_contract_required`
- worker descriptor drift rejects with the validation error

## Acceptance

- `bun test packages/opencorvus/test/session/compaction-continue-inherit.test.ts`
  passes.
- No new compact policy list is introduced outside `agent-runtime-metadata.ts`.
- The tests fail if a new agent-owned session kind is added without being
  categorized for automatic compaction.
