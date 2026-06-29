# 2026-06-29 Sub-Agent Infrastructure Homogeneity

Status: implementation in progress

## Goal

Make task sub-agent infrastructure homogeneous without flattening agent
responsibilities.

Every task sub-agent must share one infrastructure substrate:

- AgentSession runtime entry and session lifecycle;
- streaming loop and `session.status` projection;
- operator steer, cancel, and teardown control plane;
- A2A (Agent-to-Agent) coordination artifacts and wake semantics;
- artifact/evidence visibility;
- error mapping;
- queue/wake/ownership handling;
- overlay card rendering and controls.

Agent differences are allowed only as declarative role manifest data:

- prompt/core prompt append policy;
- tool policy;
- output schema or terminal tool contract;
- mutation permission;
- evidence requirement;
- runtime contract policy.

The implementation must not preserve `if kind === "build"` or equivalent
infrastructure routing branches for task worker control paths. If a difference is
real, it must move into the role manifest or a role-owned tool/output contract.

## Recall

### User Request

The user clarified that the required end state is not "all sub-agents have the
same job", but "all sub-agents are infrastructure-homogeneous". The user asked
to define a complete goal and start modifying.

### Acceptance Criteria

- A dated plan with this Recall exists under `specs/records/2026-06/`.
- The plan records the current branch/worktree truth before code changes:
  current IDE worktree is `C:\Users\chuan\myhexin-local\opecorvus`, branch
  `coding-assistant`, with many pre-existing modified files.
- Current task worker roles are enumerated and classified as:
  `build`, `explore`, `frontend-research`, `visual-qa`, `fact-check`,
  `deep-research`, `goal-workload-analyst`, `requirements`,
  `frontend-design`, `architect`, `integrity`, and `intent-analysis`.
- Task worker infrastructure control paths use one substrate. No overlay/API
  steer path may split by worker kind.
- Role differences live in one manifest source. The code must not mirror role
  facts across separate runtime/tool/status whitelists.
- Existing non-task primary surfaces (`coding`, `coding-assistant`, `control`,
  `mission`, `orchestrator`) are not silently collapsed into task workers.
  Their boundaries must be explicit.
- Tests prove the old kind-specific infrastructure branches are gone, not only
  that the new path works.
- Frontend changes require Node-launched browser verification and visual
  screenshot review.
- Docs and indexes remain healthy after spec changes.
- Effective code changes are committed and pushed.

### Hard Constraints

- No fallback or compatibility alias.
- No double source for role/runtime/tool/status truth.
- No hidden or synthetic message fork.
- No host-side gate that teaches the model which branch to take.
- No keyword parsing from visible text to recover structured control intent.
- No state-machine routing by agent kind.
- Do not implement the future `AgentMailbox` design from
  `11-agent-oop-protocol.md` as a second mailbox beside the current durable A2A
  mailbox. A second mailbox would violate the current single-source A2A contract.
- Do not rewrite user dirty files blindly. Current worktree already has
  unrelated modified files; edits must be scoped and reviewed with diffs.

### Current Worktree State

`git status --short --branch` in the IDE worktree showed:

- branch: `coding-assistant...origin/coding-assistant [ahead 13]`;
- many modified files, including `packages/opencorvus/src/agent/agent.ts`,
  `packages/opencorvus/src/agent/tool-pool-contract.ts`,
  `packages/opencorvus/src/visual-qa/agent.ts`, overlay settings/i18n/MCP files,
  SDK/OpenAPI, and several current architecture docs;
- untracked:
  `packages/opencorvus/src/tool/browser-preview-reference-regions.ts` and
  `specs/records/2026-06/2026-06-29-browser-preview-reference-regions-tool.md`.

The previous operator steer fix exists in a separate worktree:

`C:\Users\chuan\myhexin-local\opecorvus-operator-steer-single-source`

with HEAD:

- `341c1f0a48 docs(operator): record stable steer verification`;
- `22d383d3f9 fix(operator): route targeted steer through coordination`.

That fix is not present in the IDE worktree: current source grep finds no
`operatorSteerAgentSession`, no `/operator-steer`, and no `sendOperatorSteer`.

### Read Persisted Plans

| Source | Relevant Constraint |
| --- | --- |
| `specs/current/architecture/01-agents.md` | Orchestrator is the only task lifecycle decision owner; sub-agents are called by explicit workflow tools. Current tool surface lists requirements, frontend_design, frontend_research, deep_research, architect, workload_analysis, build, visual_qa, integrity, fact_check, analyze_intent, and explore. |
| `specs/current/architecture/08-agent-tool-adapter.md` | Tool visibility is already intended to be declarative. Current truth is `Agent.Info.tools` plus `ToolRegistry`; orchestrator workflow tools are private self-built tools. |
| `specs/current/architecture/11-agent-oop-protocol.md` | Future `BaseAgent` / `AgentMailbox` design is not implemented. Current runtime must be treated as truth. The OOP doc itself points to `14-agent-runtime-mode.md` for the corrected abstraction. |
| `specs/current/architecture/13-agent-communication-matrix.md` | Worker-to-orchestrator scheduling is durable A2A: `request_orchestrator_decision` -> `agent_coordination_request`, then `respond_agent_coordination` -> response/action. Task-root messages/direct reply are not worker scheduling protocol. |
| `specs/current/architecture/14-agent-runtime-mode.md` | Correct target abstraction: AgentSpec, RuntimeMode, ContextStrategy, BudgetPolicy, PermissionPolicy. Runtime mode is not agent identity. This doc is marked plan/not implemented. |
| `specs/current/architecture/16-unified-teardown.md` | New stage agents must reuse session agent infrastructure and must not grow a second runtime/loop/trigger. Current document is historical and partly superseded, so use it for constraints, not as proof of current code. |
| `specs/current/architecture/07-panel-reactivity.md` | `session.status` is the single lifecycle channel for all sessions; overlay card writer should not have phase-specific terminal paths. |
| `specs/records/2026-06/2026-06-29-operator-steer-single-source.md` | The accepted steer direction is one route plus one operator-originated coordination artifact chain. Current IDE worktree still has the old multi-source implementation, so this must be integrated here before claiming control-plane homogeneity. |

### Full-Repository Grep Evidence

#### Runtime and role substrate

Command:

```powershell
rg -n "runAgentSession|AgentRuntime|Agent\\.Info|Agent\\.register|Agent\\.get|createOrchestratorTools|SessionPrompt|SessionLoop|resolveTools|AgentRoleContract|role-contract|SessionKind|session\\.status" packages/opencorvus/src packages/overlay/src
```

Findings:

| Surface | Evidence | Decision |
| --- | --- | --- |
| `packages/opencorvus/src/agent/runner.ts` | Header states `runAgentSession` is the single entry point every worker agent runs through. It also explicitly excludes orchestrator. | Keep orchestrator as host, not task worker. Worker homogeneity must target workers first. |
| `packages/opencorvus/src/agent/runner.ts` | `promptToolSwitchesForAgentRun` contains `if (input.kind !== "build") return switches`, and `BUILD_DEFAULT_DISABLED_TOOLS`. | This is a build-specific infrastructure branch. Move into role manifest/tool policy, then test no build-only switch logic remains in runner. |
| `packages/opencorvus/src/agent/role-contract.ts` | Role contract already stores `agentOwnedSessionKind`, `runtimeContractRequired`, `exactRuntimeContract`, `liveRuntimeContinuation`, `skillMountable`, prompt config mode, and archetype. | Treat this as the current manifest seed. Extend it instead of adding another role table. |
| `packages/opencorvus/src/agent/tool-pool-contract.ts` | `AgentToolPool.roleAssignments` maps every role to global/private tools. | Keep as tool policy source, but bind it to role contract tests so every worker role has one assignment and no runtime mirror. |
| `packages/opencorvus/src/session/session.sql.ts` | `SESSION_KINDS` is the single session kind tuple. | Preserve as persistence enum, but verify worker role IDs and agent-owned session kinds are derived from the manifest, not hand-listed. |
| `packages/opencorvus/src/session/agent-runtime-metadata.ts` | Metadata sets are derived from `AgentRoleContract` plus hard-coded compaction groups. | Good direction, but compaction groups need classification as runtime policy, not free-floating session-kind lists. |
| `packages/opencorvus/src/session/status.ts` | `SessionStatus` is one lifecycle bus. | Keep as the status substrate and add anti-regression tests for all worker roles. |

#### Current worker entry usage

Command:

```powershell
rg -n "runAgentSession\\(|runAgentSessionWithRetry\\(" packages/opencorvus/src
```

Findings:

| Caller | Status |
| --- | --- |
| `build/agent.ts` | Uses `runAgentSession`, but also has external-provider branch and build-local status calls. Needs boundary audit. |
| `architect/agent.ts` | Uses `runAgentSession`. |
| `requirements/agent.ts` | Uses `runAgentSession`. |
| `frontend-design/agent.ts` | Uses `runAgentSession`. |
| `intent-analysis/agent.ts` | Uses `runAgentSession`. |
| `integrity/team-agent.ts` | Uses `runAgentSession`. |
| `visual-qa/agent.ts` | Uses `runAgentSession`. |
| `goal-workload-analyst/agent.ts` | Uses `runAgentSession`. |
| `fact-check/index.ts` | Uses `runAgentSession`. |
| `research/agent.ts` | Uses `runAgentSession`; this covers deep-research style runtime. |
| `explore/agent.ts` | Uses `runAgentSession`. |

Conclusion: the central runner exists, but role-specific policy still leaks into
the runner, overlay, and some agent modules.

#### Direct SessionPrompt bypasses

Command:

```powershell
rg -n "SessionPrompt\\.prompt\\(|SessionPrompt\\.loop\\(" packages/opencorvus/src
```

Findings:

| Caller | Classification |
| --- | --- |
| `agent/runner.ts` | Expected worker substrate. |
| `orchestrator/agent.ts` | Host runtime, explicitly outside worker runner. |
| `tool/task.ts` | Generic task subagent path. Must be reconciled with worker role manifest or explicitly documented as non-task-worker custom subagent path. |
| `task-api/index.ts` | Direct reply path resumes a session. Must not be overlay steer. |
| `control/message.ts`, `coding-assistant/session.ts`, `server/routes/session.ts`, `session/wake.ts`, `scheduler/task-queue-service.ts` | Primary/control/coding/session surfaces. Not task worker homogeneity targets, but they must not be mistaken for task sub-agent dispatch. |
| `orchestrator/tools.ts` | Contains worker continuation and refine paths. Needs audit for direct `SessionPrompt.prompt` calls that should go through manifest/runAgentSession. |

#### Overlay steer split in current IDE worktree

Command:

```powershell
rg -n "replyToAgentSession|sendTaskOperatorMessage|overlay_build_steer|directAgentReplyMode|TaskMessageTarget" packages/overlay/src packages/opencorvus/src packages/sdk/openapi.json
```

Findings:

| Surface | Current Evidence | Required Action |
| --- | --- | --- |
| `packages/overlay/src/components/Card.tsx` | imports `replyToAgentSession`, `sendTaskOperatorMessage`; computes `directAgentReplyMode`; sends `source: "overlay_build_steer"` for build. | Replace by one `sendOperatorSteer` service. |
| `packages/overlay/src/components/ChatBubble.tsx` | same build/non-build branch. | Replace by one `sendOperatorSteer` service. |
| `packages/overlay/src/components/AgentSessionReplyBox.tsx` | comments say non-build uses `/reply`, build uses `/message`. | Update to operator steer semantics and structured error taxonomy. |
| `packages/opencorvus/src/engine/model.ts` and generated OpenAPI | `TaskMessageTarget` still exists. | Remove target-scoped payload from task-root `/message`. |

This is the first hard contradiction to infrastructure homogeneity and must be
fixed in this worktree before claiming success.

#### Overlay lifecycle/card substrate

Command:

```powershell
rg -n "session.status|phaseSessionKind|buildPhaseChildForStep|directAgentReplyMode|goalStagePhaseID|integrity" packages/overlay/src
```

Findings:

| Surface | Evidence | Decision |
| --- | --- | --- |
| `services/tree-writer.ts` | `session.status` is handled centrally. | Keep as lifecycle substrate. |
| `components/Card.tsx` / `ChatBubble.tsx` | control selection still branches by build/non-build. | Replace with route-agnostic operator steer. |
| `store/card-tree.ts` comments | still describe non-build reply vs build task message. | Update comments after code change. |
| `utils/workflow-step.ts` / card phase helpers | build phase nesting is presentation, not control plane. | Keep only if it does not choose backend control routes. |

## Design

### Scope Boundary

This goal targets task sub-agent infrastructure. It does not collapse all
OpenCorvus primary surfaces.

In scope:

- task worker roles listed in `AgentRoleContract` whose `archetype` is
  `"worker"` and that are dispatched as task sub-agents;
- `runAgentSession` substrate;
- `AgentToolPool` and role manifest policy;
- session lifecycle/status;
- A2A coordination and operator steer;
- overlay task agent cards and controls.

Out of scope except for boundary tests:

- `orchestrator`: host/decision owner, not a task worker;
- `mission`: primary coordinator for long-running user goals;
- `coding` / `coding-assistant`: direct user coding surfaces;
- `control`: panel/gateway natural-language action router;
- `compaction`, `title`, `summary`: helper/model-routing surfaces;
- public `/session/:id/prompt` and ACP session prompt surfaces.

### Single Manifest Shape

Use the existing `AgentRoleContract` as the role identity source. Extend it only
when a role fact is needed by more than one infrastructure layer.

Target additions:

```ts
runtimeMode: "interactive" | "episodic" | "host" | "helper"
contextStrategy: "transcript" | "derived-state" | "hybrid"
budgetPolicy: "checkpoint-summary" | "pre-run-reduction" | "manual"
mutationPolicy: "read-write" | "read-only" | "submit-only" | "review"
controlSurface: "task-worker" | "primary" | "host" | "helper"
```

The names must be defined once and consumed by:

- agent registry construction;
- tool pool validation;
- runtime metadata sets;
- auto-compaction policy;
- prompt catalog;
- overlay agent controls.

No separate `WORKER_ROLE_IDS`, `DIRECT_REPLY_AGENT_KINDS`,
`LIVE_RUNTIME_CONTINUATION_SESSION_KINDS`, or equivalent hand lists should
survive unless they are derived from `AgentRoleContract`.

### Runtime Substrate

The worker substrate remains `runAgentSession`. It owns:

- child session creation/continuation validation;
- system prompt composition;
- model resolution;
- runtime contract installation;
- `SessionPrompt` invocation;
- abort propagation;
- session status terminal projection;
- trace/error reporting.

The runner must not contain build-only infrastructure policy. Build-specific
tool visibility or mutation policy belongs in `AgentRoleContract` and
`AgentToolPool`.

### Control Substrate

Operator steer for every task worker uses one backend API and one durable
artifact chain:

```text
POST /task/:taskID/session/:sessionID/operator-steer
  -> agent_coordination_request(origin="operator_steer")
  -> orchestrator wake with coordinationRequest
  -> respond_agent_coordination
  -> visible action
```

This must be integrated into the current IDE worktree from the already verified
operator steer branch before broader homogeneity claims.

Direct reply may remain only as a low-level explicit session continuation
route, outside overlay steer and outside the homogeneous worker control plane.

### UI Substrate

Overlay task agent controls must be keyed by "has task-owned worker session id",
not by role-specific backend control branches.

Allowed role-specific UI differences:

- label/icon/color;
- read-only warning copy;
- body renderer for role-specific artifacts.

Forbidden UI differences:

- choosing different steer/cancel backend routes based on build/non-build;
- hiding unsupported worker kinds instead of surfacing structured errors;
- parsing visible prompt text to determine target session.

## Implementation Plan

### Phase 1: Adopt Single-Source Operator Steer In This Worktree

1. Port or merge the verified changes from
   `opecorvus-operator-steer-single-source`.
2. Add/verify:
   - backend `operator-steer` route;
   - `EngineService.operatorSteerAgentSession`;
   - strict `AgentSessionOperatorSteerInput`;
   - operator-originated `agent_coordination_request`;
   - overlay `sendOperatorSteer`;
   - Card/ChatBubble route-agnostic steer;
   - task-root `/message` target rejection.
3. Run the operator steer targeted test set and browser screenshot verification.

This is not optional. The current worktree still has the exact multi-source
control-plane defect.

### Phase 2: Manifest Derivation Tests

Add tests that fail if any current task worker role lacks exactly one role
contract and tool pool assignment.

Required assertions:

- every target worker role exists in `AgentRoleContract.all`;
- every target worker role has `AgentToolPool.roleAssignments[role]`;
- every `agentOwnedSessionKind` is a valid `SESSION_KINDS` value;
- `AgentRuntimeMetadata` sets derive from `AgentRoleContract`;
- no hand-written worker role whitelist exists in runtime code when it can be
  derived from the manifest.

### Phase 3: Move Build-Only Runner Policy Into Manifest/Tool Pool

Replace `promptToolSwitchesForAgentRun` build-only logic with a manifest/tool
pool field such as:

```ts
defaultRuntimeToolSwitches?: Record<string, boolean>
```

or an equivalent normalized tool policy owned by `AgentToolPool`.

Acceptance:

```powershell
rg -n "input\\.kind !== \"build\"|input\\.kind === \"build\"|BUILD_DEFAULT_DISABLED_TOOLS" packages/opencorvus/src/agent/runner.ts
```

must return no runner-owned build infrastructure policy.

### Phase 4: Reconcile SessionPrompt Bypasses

Classify every direct `SessionPrompt.prompt/loop` caller:

- expected substrate call;
- host/orchestrator boundary;
- primary/control/coding boundary;
- low-level session API;
- worker continuation path that must move through `runAgentSession` or a
  manifest-declared continuation adapter.

Only the first four categories may remain. Worker control paths may not bypass
the runner.

### Phase 5: Overlay Card/Status Homogeneity

Update overlay tests to assert:

- all worker cards receive the same steer control service;
- all worker card lifecycle state is driven by `session.status`;
- build phase presentation does not choose backend control route;
- role-specific artifact renderers do not create role-specific lifecycle or
  steer paths.

Run browser tests with Node and inspect screenshots.

### Phase 6: Docs, Health Tests, And Review

Update current architecture docs after implementation:

- `01-agents.md`;
- `08-agent-tool-adapter.md`;
- `13-agent-communication-matrix.md`;
- `14-agent-runtime-mode.md`;
- `07-panel-reactivity.md`;
- `16-unified-teardown.md` if the current historical wording conflicts with
  implemented truth.

Run document health and source scans. Perform independent/adversarial review
before marking the goal complete.

## First Code Slice

The first safe implementation slice after this plan is:

1. integrate the operator steer single-source patch into the IDE worktree;
2. add manifest/tool-pool anti-regression tests that do not alter dirty runtime
   files;
3. then move runner build-only tool switches into manifest-owned policy.

This order keeps the highest user-visible defect first and avoids building a
larger manifest abstraction while the current control plane still has a
known multi-source route split.

## Implementation Log

2026-06-29 first slice:

- Added `AgentRoleContract.controlSurface`.
- Classified role surfaces as `host`, `primary`, `task-worker`, or `helper`.
- Added `AgentRoleContract.controlSurface(id)` and
  `AgentRoleContract.taskWorkerIDs()`.
- Added `packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts`
  to pin the user-named task sub-agents to the manifest, verify every
  task-worker has one `AgentToolPool` assignment, verify agent-owned
  task-workers map to persisted `SESSION_KINDS`, and verify primary/host
  surfaces are not task workers.

This slice intentionally does not yet claim runtime homogeneity. It creates the
manifest-owned worker set needed to delete downstream kind mirrors.

## Tests And Verification

Targeted commands will include at least:

```powershell
bun test packages/opencorvus/test/server/task-session-operator-steer.test.ts
bun test packages/opencorvus/test/server/task-message-routes.test.ts --test-name-pattern "target-scoped|triggers scheduler|queues behind multiple live build owners|does not interrupt async goal"
bun test packages/opencorvus/test/server/reply-error-taxonomy.test.ts
bun test packages/overlay/test/agent-session-controls.test.ts packages/overlay/test/agent-reply-box-structured-errors.test.ts
cd packages/overlay; node test/browser-runner.mjs test/browser/agent-reply-box-primitives.test.ts
bun test packages/opencorvus/test/agent/agent.test.ts packages/opencorvus/test/agent/session-agent.test.ts packages/opencorvus/test/agent/runner-prompt.test.ts
bun run typecheck
bun run api:routes-check
bun run docs:check
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
```

Source scans:

```powershell
rg -n "directAgentReplyMode|overlay_build_steer|sendTaskOperatorMessage\\(|replyToAgentSession\\(" packages/overlay/src/components packages/overlay/src/services
rg -n "TaskMessageTarget" packages/opencorvus/src packages/sdk/openapi.json packages/sdk/js/src/gen packages/web/src/content/docs/reference/api.mdx packages/web/src/content/docs/zh-cn/reference/api.mdx
rg -n "input\\.kind !== \"build\"|input\\.kind === \"build\"|BUILD_DEFAULT_DISABLED_TOOLS" packages/opencorvus/src/agent/runner.ts
```

2026-06-29 first-slice verification:

- `bun test packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts packages/opencorvus/test/agent/session-agent.test.ts`
  passed: 6 pass, 0 fail.
- `bun test packages/opencorvus/test/agent/agent.test.ts --test-name-pattern "skill-mountable|default native agents|planner is not exposed"`
  passed: 3 pass, 0 fail.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts`
  passed before implementation-log update: 58 pass, 0 fail.
- `bun run typecheck` passed: 9 successful packages.
- `git diff --check` passed.
- After the implementation-log update, the combined docs-health command hit the
  30s Bun per-test timeout only on `scratch snapshots do not retain deleted
  spec trees`. The same `historical-docs-links.test.ts` file passed when rerun
  alone: 17 pass, 0 fail. The slow scratch scan completed in 23063ms on the
  isolated rerun, so this is recorded as a runner timing issue, not a failed
  assertion from this spec.

2026-06-29 second slice in current IDE worktree:

- Integrated the verified operator steer single-source implementation into the
  current dirty `coding-assistant` worktree without applying the conflicting
  `server/error.ts`, `16-unified-teardown.md`, or operator-steer spec hunks
  wholesale.
- Manually merged `operatorSteerRouteErrors(...)` into the current
  `server/error.ts` shape.
- Replaced overlay inline steer with `sendOperatorSteer(...)` and removed
  target-scoped `TaskMessageTarget` from backend/SDK/OpenAPI generated
  artifacts via the applied patch.
- Moved build default runtime tool switches out of `agent/runner.ts` and into
  `AgentToolPool.defaultRuntimeToolSwitches("build")`.
- Added `AgentRoleContract.isRoleID(...)`,
  `AgentRoleContract.unreadableReferencePromptMarker(...)`, and manifest-owned
  unreadable reference contract metadata for build.
- Tightened operator steer target validation to
  `controlSurface === "task-worker" && agentOwnedSessionKind` so role manifest
  classification, not `archetype === "worker"`, decides task-worker steer
  eligibility.
- Replaced `AgentRuntimeMetadata` role lookup with
  `AgentRoleContract.isRoleID(...)` so runtime metadata no longer mirrors a
  separate `Object.hasOwn(AgentRoleContract.all, kind)` expression.
- Added runner source anti-regression coverage proving `runner.ts` no longer
  owns `BUILD_DEFAULT_DISABLED_TOOLS` or `input.kind === "build"` /
  `input.kind !== "build"` runtime tool policy.

Second-slice verification:

- `bun test packages/opencorvus/test/server/task-session-operator-steer.test.ts`
  passed: 10 pass, 0 fail.
- `bun test packages/overlay/test/agent-session-controls.test.ts` passed as
  part of the first operator-steer targeted run.
- `bun test packages/opencorvus/test/agent/runner-tool-scope.test.ts packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts`
  passed: 15 pass, 0 fail.
- `bun test packages/opencorvus/test/agent/runner-prompt.test.ts --test-name-pattern "appends config|installs live runtime|continuation loop"`
  passed: 3 pass, 0 fail.
- `rg -n 'input\.kind !== "build"|input\.kind === "build"|BUILD_DEFAULT_DISABLED_TOOLS' packages/opencorvus/src/agent/runner.ts`
  returned no matches.
- `rg -n "directAgentReplyMode|overlay_build_steer|sendTaskOperatorMessage\(|replyToAgentSession\(" packages/overlay/src/components packages/overlay/src/services`
  returned no matches.
- `rg -n "TaskMessageTarget" packages/opencorvus/src packages/sdk/openapi.json packages/sdk/js/src/gen packages/web/src/content/docs/reference/api.mdx packages/web/src/content/docs/zh-cn/reference/api.mdx`
  returned no matches.
- A combined Bun process containing `task-session-operator-steer.test.ts`,
  `runner-tool-scope.test.ts`, and `session-agent.test.ts` hit
  beforeEach/afterEach SQLite foreign-key cleanup noise after several passing
  route cases. The operator steer route file passed in isolation immediately
  afterward, so this is tracked as test fixture interference, not proof of a
  route regression.

Additional second-slice verification:

- `bun run typecheck` passed: 9 successful packages.
- `bun run api:routes-check` passed: 6 rules and route inventory clean across
  28 files.
- `bun run docs:check` passed: 242 operations, 23 groups.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts`
  passed: 59 pass, 0 fail.
- `bun test packages/opencorvus/test/server/task-message-routes.test.ts --test-name-pattern "target-scoped|triggers scheduler|queues behind multiple live build owners|does not interrupt async goal"`
  passed in isolation: 4 pass, 0 fail.
- `bun test packages/opencorvus/test/server/reply-error-taxonomy.test.ts`
  passed: 11 pass, 0 fail.
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "respond_agent_coordination continue consumes|respond_agent_coordination continue supports frontend-research|respond_agent_coordination redispatch starts the build stage dispatcher|respond_agent_coordination redispatch starts the explore stage dispatcher|respond_agent_coordination cancel_worker completes"`
  passed: 5 pass, 0 fail.
- `cd packages/overlay; node test/browser-runner.mjs test/browser/agent-reply-box-primitives.test.ts`
  passed: 1 pass, 0 fail. The screenshot
  `.scratch/agent-reply-box-operator-target-error.png` was visually inspected:
  draft text remains visible, the Steer button is visible, and the structured
  operator-steer error panel does not overlap or render blank.
- `bun test packages/opencorvus/test/agent/agent.test.ts --test-name-pattern "skill-mountable|default native agents|planner is not exposed"`
  passed: 3 pass, 0 fail.
- Final source scans for old overlay steer paths, `TaskMessageTarget`, and
  runner-owned build tool policy returned no matches.
- `git diff --check` passed.

2026-06-29 third slice in current IDE worktree:

- Removed the hand-written A2A worker control-kind list from
  `orchestrator/direct-reply.ts`.
- `DIRECT_AGENT_SESSION_CONTROL_KINDS` is now an internal implementation detail
  derived from `AgentRoleContract.taskWorkerIDs().filter(agentOwnedSessionKind)`
  plus the separate low-level direct-reply session kinds.
- `server/routes/orchestrator.ts` no longer imports or reads the control-kind
  set directly; cancel validation calls `canReceiveDirectAgentSessionControl`.
- `task-api/index.ts` no longer imports or reads `DIRECT_REPLY_AGENT_KINDS`;
  direct-reply validation calls `canReceiveDirectAgentReply`.
- `DIRECT_REPLY_AGENT_KINDS` and `DIRECT_AGENT_SESSION_CONTROL_KINDS` are now
  private to `direct-reply.ts`, so other infrastructure layers cannot reuse
  those sets as parallel role truth.
- Added manifest tests proving every agent-owned task-worker shares the same
  session control surface and build remains cancellable without reopening
  direct reply.
- Added `AgentRoleContract.agentOwnedTaskWorkerIDs()` and
  `AgentRoleContract.isAgentOwnedTaskWorkerID(...)`.
- Operator steer target validation and direct session control now both consume
  that manifest helper, so neither layer mirrors the
  `controlSurface === "task-worker" && agentOwnedSessionKind` condition.
- Replaced the remaining retired root spec path reference in
  `2026-06-29-frontend-replica-tool-ownership-prompt.md` with natural-language
  deleted-file wording to keep the consolidated spec tree healthy.

Third-slice verification:

- `bun test packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts packages/opencorvus/test/server/task-session-cancel-error-contract.test.ts`
  passed: 7 pass, 0 fail.
- `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts --test-name-pattern "session/:sessionID/cancel"`
  passed: 3 pass, 0 fail.
- `bun test packages/opencorvus/test/server/reply-error-taxonomy.test.ts packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts`
  passed: 17 pass, 0 fail.
- `bun test packages/opencorvus/test/server/task-session-operator-steer.test.ts --test-name-pattern "current sub-agent kind|pending coordination|root and invalid-kind"`
  passed: 4 pass, 0 fail.
- After adding `agentOwnedTaskWorkerIDs()`, the manifest/cancel targeted test
  passed again: 8 pass, 0 fail.
- After adding `agentOwnedTaskWorkerIDs()`, the operator steer target test
  subset passed again: 3 pass, 0 fail.
- `rg -n 'controlSurface === "task-worker"|agentOwnedSessionKind\)' packages/opencorvus/src/task-api/index.ts packages/opencorvus/src/orchestrator/direct-reply.ts`
  returned no matches.
- `bun run typecheck` passed: 9 successful packages.
- The docs health trio passed again after the retired root spec path wording
  fix: 59 pass, 0 fail.

2026-06-29 fourth slice in current IDE worktree:

- Removed the hand-written protocol finalizer continuation stage list from
  `engine/stage-continuation.ts`.
- Added `AgentRoleContract.protocolStageContinuation` as the manifest-owned
  role fact for same-session continuation after missing terminal finalizers.
- Added `AgentRoleContract.protocolStageContinuationIDs()` and
  `AgentRoleContract.isProtocolStageContinuationID(...)`.
- `createStageContinuationRequest(...)` now fails fast when the input stage is
  not manifest-enabled for protocol continuation.
- `isStageContinuationStage(...)` now validates through
  `AgentRoleContract.isProtocolStageContinuationID(...)` instead of a
  `value === "build" || ...` chain.
- `explore` remains an agent-owned task worker with redispatch support, but is
  explicitly not a protocol finalizer continuation stage. This keeps
  redispatch bindings distinct from terminal-finalizer continuation semantics.

Fourth-slice verification:

- `bun test packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts`
  passed: 9 pass, 0 fail.
- `rg -n 'value === "build"|value === "requirements"|value === "architect"|value === "frontend-design"|value === "goal-workload-analyst"|value === "frontend-research"|value === "deep-research"|value === "visual-qa"|value === "intent-analysis"|value === "fact-check"|value === "integrity"' packages/opencorvus/src/engine/stage-continuation.ts`
  returned no matches.
- `bun test packages/opencorvus/test/agent/runner-prompt.test.ts --test-name-pattern "continuation"`
  passed: 2 pass, 0 fail.
- `bun test packages/opencorvus/test/build-agent/contract-error.test.ts`
  passed: 18 pass, 0 fail.
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "continuation|fact-check redispatch"`
  passed: 3 pass, 0 fail.
- `git diff --check` passed.
- `bun run typecheck` passed: 9 successful packages.

2026-06-29 fifth slice in current IDE worktree:

- Moved A2A redispatch dispatcher/stage/target-kind binding facts into
  `AgentRoleContract.agentCoordinationRedispatchBinding`.
- Added explicit null/non-null binding declarations for every role, so task
  worker redispatch support is no longer inferred from a separate map.
- Re-exported `AgentCoordinationRedispatchBinding` from
  `engine/agent-coordination.ts` as the manifest-owned type instead of keeping
  an engine-local union.
- Removed `AGENT_COORDINATION_REDISPATCH_REPLAY_BINDINGS` from
  `orchestrator/tools.ts`.
- Replaced all `respond_agent_coordination` redispatch response inline binding
  objects with `requireAgentCoordinationRedispatchBinding(...)`, which reads
  the manifest.
- Kept the concrete redispatch execution branches in `orchestrator/tools.ts`;
  they call role-specific dispatcher adapters and are not the binding source.

Fifth-slice verification:

- `bun test packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts`
  passed: 11 pass, 0 fail.
- `rg -n 'AGENT_COORDINATION_REDISPATCH_REPLAY_BINDINGS|redispatchBinding: \{|export type AgentCoordinationRedispatchBinding = \|' packages/opencorvus/src/orchestrator/tools.ts packages/opencorvus/src/engine/agent-coordination.ts`
  returned no matches.
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "respond_agent_coordination redispatch starts the frontend-design stage dispatcher"`
  passed: 1 pass, 0 fail.
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "respond_agent_coordination redispatch starts the build stage dispatcher"`
  passed: 1 pass, 0 fail.
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "respond_agent_coordination redispatch starts the explore stage dispatcher"`
  passed: 1 pass, 0 fail.
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "respond_agent_coordination redispatch resumes a fact-check continuation artifact"`
  passed: 1 pass, 0 fail.
- `bun test packages/opencorvus/test/agent/agent.test.ts --test-name-pattern "role contract metadata|all live task-owned worker roles expose"`
  passed: 2 pass, 0 fail.
- `bun test packages/opencorvus/test/agent/role-contract.test.ts --test-name-pattern "role contract keeps|every role contract id"`
  passed: 2 pass, 0 fail.
- `bun run typecheck` passed: 9 successful packages.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts`
  passed: 59 pass, 0 fail.
- `git diff --check` passed.

One broad redispatch filter run
`bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "respond_agent_coordination redispatch (starts|resumes|recovers)"`
hit fixture cleanup lock noise after several passing redispatch cases. The
locked file was the test database WAL under that Bun process root, and the
process was stopped after confirming the command line matched only that test
process. The affected branch was rerun with exact isolated patterns above and
passed.

2026-06-29 sixth slice in current IDE worktree:

- Added `AgentRoleContract.directSessionReply`.
- Moved task-worker direct session reply eligibility out of
  `orchestrator/direct-reply.ts` and into the role manifest.
- Kept non-role direct-reply session kinds (`assistant`, `goal`, `acceptance`,
  `evaluator`) local to `direct-reply.ts` because they are low-level session
  kinds, not task-worker role facts.
- `DIRECT_REPLY_AGENT_KIND_VALUES` now combines those non-role session kinds
  with `AgentRoleContract.directSessionReplyIDs()`.
- Build remains controllable through the shared session-control surface but
  still cannot receive generic direct reply.

Sixth-slice verification:

- `bun test packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts`
  passed: 13 pass, 0 fail.
- `bun test packages/opencorvus/test/server/reply-error-taxonomy.test.ts`
  passed: 11 pass, 0 fail.
- `bun test packages/opencorvus/test/server/task-session-cancel-error-contract.test.ts packages/opencorvus/test/server/task-conversation-routes.test.ts --test-name-pattern "session/:sessionID/cancel|POST /task/:taskID/session/:sessionID/reply"`
  passed: 5 pass, 0 fail.
- `bun test packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts --test-name-pattern "direct reply|build is controllable"`
  passed after Set type tightening: 2 pass, 0 fail.
- `rg -n 'DIRECT_REPLY_AGENT_KIND_VALUES = \[|"requirements",|"architect",|"frontend-design",|"intent-analysis",|"integrity",' packages/opencorvus/src/orchestrator/direct-reply.ts`
  returned only the derived `DIRECT_REPLY_AGENT_KIND_VALUES` declaration, with
  no task-worker role literals.
- `git diff --check` passed.
- `bun run typecheck` passed: 9 successful packages.

2026-06-29 seventh slice in current IDE worktree:

- Removed the hand-written `OPERATOR_STEER_TARGET_KINDS` list from
  `task-session-operator-steer.test.ts`.
- Operator-steer coverage now derives its target worker set from
  `AgentRoleContract.agentOwnedTaskWorkerIDs()`, so the test cannot drift from
  the manifest-owned control surface.

Seventh-slice verification:

- `bun test packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts`
  passed after adding the operator-steer source regression: 14 pass, 0 fail.
- `bun test packages/opencorvus/test/server/task-session-operator-steer.test.ts --test-name-pattern "current sub-agent kind|pending coordination|root and invalid-kind"`
  passed: 4 pass, 0 fail.
- `bun test packages/opencorvus/test/server/task-session-operator-steer.test.ts --test-name-pattern "accepted build steer|operator steer semantic entry"`
  passed: 3 pass, 0 fail.

2026-06-29 eighth slice in current IDE worktree:

- Added `AgentRoleContract.disableConfigurable`.
- Replaced `agent.ts`'s local `fixedReadonlyAgents` set with
  `role.disableConfigurable`.
- Added `AgentRoleContract.nonDisableConfigurableIDs()` to expose the
  manifest-owned list of fixed runtime evidence agents.
- The non-disable-configurable roles are `fact-check`, `deep-research`, and
  `frontend-research`.

Eighth-slice verification:

- `bun test packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts --test-name-pattern "non-disable|operator steer|direct reply"`
  passed: 4 pass, 0 fail.
- `bun test packages/opencorvus/test/agent/agent.test.ts --test-name-pattern "fixed evidence agents cannot be disabled or tool-overridden|deep-research agent tool config cannot reopen executor surfaces"`
  passed: 2 pass, 0 fail.
- `bun test packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts --test-name-pattern "non-disable"`
  passed after source-string cleanup: 1 pass, 0 fail.
- `rg -n 'fixedReadonlyAgents|new Set\(\["fact-check", "deep-research", "frontend-research"\]\)' packages/opencorvus/src/agent/agent.ts packages/opencorvus/test/agent`
  returned no matches.
- `git diff --check` passed.
- `bun run typecheck` passed: 9 successful packages.

2026-06-29 ninth slice in current IDE worktree:

- Added `AgentRoleContract.nonExecutorSourceBoundaryExempt`.
- Removed `SOURCE_BOUNDARY_EXEMPT_AGENT_IDS` from
  `prompt/non-executor-source-boundary.ts`.
- `shouldAppendNonExecutorSourceBoundary(...)` now reads
  `AgentRoleContract.isNonExecutorSourceBoundaryExempt(...)`.
- Removed alias exemptions for `integrity-team` and `visual_qa`; no production
  caller passes those aliases to the boundary helper, and retaining them would
  preserve a compatibility path outside role identity.
- The manifest-exempt roles are `build`, `visual-qa`, and `integrity`.

Ninth-slice verification:

- `bun test packages/opencorvus/test/agent/core-prompt-hygiene.test.ts --test-name-pattern "generic non-executor prompt boundary"`
  passed: 1 pass, 0 fail.
- `bun test packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts --test-name-pattern "source-boundary|non-disable"`
  passed: 2 pass, 0 fail.
- `rg -n 'SOURCE_BOUNDARY_EXEMPT_AGENT_IDS|new Set\(\["build", "integrity", "integrity-team", "visual-qa", "visual_qa"\]\)' packages/opencorvus/src/prompt/non-executor-source-boundary.ts packages/opencorvus/test/agent`
  returned no matches after source-string cleanup.
- `git diff --check` passed.
- `bun run typecheck` passed: 9 successful packages.

2026-06-29 tenth slice in current IDE worktree:

- Added `AgentRoleContract.orchestratorWorkflowToolName`.
- Moved the stage-continuation workflow tool name mapping out of
  `orchestrator/tools.ts` and into the role manifest.
- Removed the `stage.replaceAll("-", "_")` tool-name derivation from
  continuation recovery messages. A protocol continuation stage with no
  manifest-owned workflow tool binding now fails fast as an incomplete role
  contract instead of deriving a second naming rule.
- `explore` keeps its manifest workflow tool name for redispatch, while it
  remains outside protocol-finalizer same-session continuation.

Tenth-slice verification:

- `bun test packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts --test-name-pattern "workflow tool|protocol finalizer|stage continuation"`
  passed: 4 pass, 0 fail.
- `bun test packages/opencorvus/test/agent/runner-prompt.test.ts --test-name-pattern "continuation"`
  passed: 2 pass, 0 fail.
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "continuation|fact-check redispatch"`
  passed: 3 pass, 0 fail.
- `rg -n 'stage\.replaceAll|Partial<Record<StageContinuationStage|continuationToolName\(stage\): string' packages/opencorvus/src/orchestrator/tools.ts packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts`
  returned matches only in the regression test assertions, not in
  `orchestrator/tools.ts`.
- `git diff --check` passed.
- `bun run typecheck` passed: 9 successful packages.

2026-06-29 eleventh slice in current IDE worktree:

- Removed the build-specific `BuildSessionDirectReplyError` API taxonomy.
- Added the generic `AgentDirectReplyDisabledError`.
- `appendDirectAgentSessionReply(...)` now rejects a direct reply when the raw
  latest user envelope agent is not eligible for direct reply through
  `canReceiveDirectAgentReply(...)`. This preserves the old hybrid-envelope
  protection without naming build in the control-path code.
- The pure build-session case still rejects at target-kind validation through
  the manifest-owned direct-reply policy. The mixed case now rejects before
  prompt normalization and before runtime-contract validation.
- Regenerated `packages/sdk/openapi.json`, SDK client types, and API reference
  docs so the public contract names `AgentDirectReplyDisabledError`.

Eleventh-slice verification:

- `bun test packages/opencorvus/test/server/reply-error-taxonomy.test.ts --test-name-pattern "build sessions reject|non-direct-reply agents|kind not in direct-reply|pending A2A"`
  passed after moving the envelope-agent check before
  `SessionAgentIdentity.applyToPrompt(...)`: 4 pass, 0 fail.
- `bun test packages/opencorvus/test/server/reply-error-taxonomy.test.ts`
  passed: 12 pass, 0 fail.
- `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts --test-name-pattern "POST /task/:taskID/session/:sessionID/reply appends overlay direct user input"`
  passed: 1 pass, 0 fail.
- `bun test packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts`
  passed: 19 pass, 0 fail.
- `bun test packages/opencorvus/test/script/sdk-build-format-contract.test.ts`
  passed: 10 pass, 0 fail.
- `bun run api:routes-check` passed: 6 rules and route inventory clean across
  28 files.
- `bun run docs:check` passed: 242 operations, 23 groups.
- `rg -n 'BuildSessionDirectReplyError|AgentDirectReplyDisabledError' packages/sdk/openapi.json packages/sdk/js/src/gen/types.gen.ts packages/sdk/js/src/gen/sdk.gen.ts packages/web/src/content/docs/reference/api.mdx packages/web/src/content/docs/zh-cn/reference/api.mdx packages/opencorvus/src packages/opencorvus/test packages/overlay/test`
  showed `AgentDirectReplyDisabledError` in the source/generated API contract
  and old `BuildSessionDirectReplyError` only inside negative regression
  assertions.
- `git diff --check` passed.
- `bun run typecheck` passed: 9 successful packages.

2026-06-29 twelfth slice in current IDE worktree:

- Added `AgentRoleContract.liveOrchestratorToolOwnershipControl`.
- Moved live orchestrator tool ownership cancellation eligibility out of
  `orchestrator/tools.ts` build-kind checks and into the role manifest.
- `respond_agent_coordination cancel_worker` and `cancel_subagent` now use
  `AgentRoleContract.usesLiveOrchestratorToolOwnershipControl(kind)` to decide
  whether a live owned child needs the role-owned cancellation adapter.
- `cancel_subagent mode='recover_stale'` now rejects roles without manifest
  live-ownership control instead of hard-coding build as the only accepted kind.

Twelfth-slice verification:

- `bun test packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts --test-name-pattern "live tool ownership|direct reply|workflow tool"`
  passed: 6 pass, 0 fail.
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "live build ownership blocks contract mutation|Recovered stale live-owned build|No-op when there is no live build ownership|cancel_worker completes"`
  passed the two matching cases: 2 pass, 0 fail.
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "cancel_subagent recover_stale"`
  passed: 4 pass, 0 fail.
- `bun test packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts`
  passed: 20 pass, 0 fail.
- `rg -n 'staleRecovery && kind !== "build"|staleRecovery && kind === "build"|kind === "build" && liveOwner|usesLiveOrchestratorToolOwnershipControl' packages/opencorvus/src/orchestrator/tools.ts packages/opencorvus/src/agent/role-contract.ts packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts`
  showed the manifest helper and no remaining live-ownership control-path
  build checks.
- `git diff --check` passed.
- `bun run typecheck` passed: 9 successful packages.

2026-06-29 final verification pass in current IDE worktree:

- Old overlay steer path scan:
  `rg -n 'directAgentReplyMode|overlay_build_steer|sendTaskOperatorMessage\(|replyToAgentSession\(' packages/overlay/src/components packages/overlay/src/services`
  returned no matches.
- Old role-policy/source scan showed remaining old-string matches only inside
  negative regression assertions, test fixtures, or non-sub-agent task-kind
  parsing; no production sub-agent control path matched the retired patterns.
- `bun test packages/opencorvus/test/server/task-session-operator-steer.test.ts`
  passed: 10 pass, 0 fail.
- `bun test packages/overlay/test/agent-reply-box-structured-errors.test.ts packages/overlay/test/agent-session-controls.test.ts`
  passed: 13 pass, 0 fail.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts`
  passed: 59 pass, 0 fail.
- `bun run api:routes-check` passed: 6 rules and route inventory clean across
  28 files.
- `bun run docs:check` passed: 242 operations, 23 groups.
- `node test/browser-runner.mjs test/browser/agent-reply-box-primitives.test.ts`
  from `packages/overlay` passed: 1 browser test, 0 fail. The generated
  screenshot
  `C:\Users\chuan\myhexin-local\opecorvus\.scratch\agent-reply-box-operator-target-error.png`
  was inspected manually: the draft text remains visible, the Steer button is
  visible, and the structured operator-steer error panel is visible without
  overlap or blank rendering.

## Non-Acceptance

The goal is not complete if any of these remain true:

- current IDE worktree still lacks the `operator-steer` single source;
- overlay steer branches by build/non-build or role kind;
- task-root `/message` accepts target-scoped worker steer;
- direct session reply is used by overlay steer;
- worker role lists are duplicated outside the manifest without being derived;
- `runAgentSession` contains build-only infrastructure policy;
- worker continuation bypasses the runner without a manifest-owned adapter;
- lifecycle/terminal status is emitted through role-specific bus paths instead
  of `session.status`;
- browser visual verification is skipped for overlay changes;
- independent review finds unresolved double source, fallback, hidden message,
  state-machine routing, or whitelist mirror.
