# 2026-06-27 A2A Adversarial Audit

## Goal

对当前 OpenCorvus A2A（Agent-to-Agent）协议做对抗式审查，直接回答：

- 现在的 A2A 协议是否成熟。
- A2A 是否单源。
- 当前 agent 是否全部具备 A2A 能力。
- 新 agent 是否会自动具备 A2A 能力。
- 每个子 agent 的 steer 干预是否完美可用。

本轮审查基于硬盘当前代码，不基于历史记忆。并行审计 agent：Herschel、Locke、Zeno、Epicurus。

## Executive Verdict

当前 A2A 不是“企业级成熟且全域单源”的状态。

核心 worker-to-orchestrator mailbox 已经比上一轮强很多：`request_orchestrator_decision` 持久化 request，`respond_agent_coordination` 持久化 response/action 后再执行 continue/cancel/ask/fail/redispatch，restart E2E 已覆盖 queued request recovery。

但对抗式审查发现并修复了三个会破坏结论的缺陷：

1. `POST /task/:taskID/session/:sessionID/cancel` 可绕过 pending A2A request。
2. `POST /task/:taskID/session/:sessionID/reply` 可绕过 pending A2A request。
3. 多个 live task worker 的静态 tool-pool 声称有 A2A，但 exact runtime toolKit 实际没有暴露 `request_orchestrator_decision`。

修复后可以成立的结论是：

- pending A2A request 的 direct reply / direct cancel 已经不能绕过 `respond_agent_coordination`。
- 所有 live task-owned worker role 现在都在 role tool-pool 暴露 `request_orchestrator_decision`。
- exact runtime stage agents 现在通过共享 runtime helper 显式注入 A2A request tool。

仍不能成立的结论是：

- “所有 operator steer 都是 A2A 单源”不成立。
- “新增 agent 自动具备完整 A2A 能力”不成立。
- “A2A 已无成熟度隐患”不成立。

## Current Capability Matrix

### Covered live task workers

以下 role 当前应具备 worker-originated A2A request 能力：

- `build`
- `visual-qa`
- `explore`
- `requirements`
- `architect`
- `frontend-design`
- `intent-analysis`
- `integrity`
- `fact-check`
- `deep-research`
- `frontend-research`
- `goal-workload-analyst`

已新增测试锁定：所有 `archetype=worker && agentOwnedSessionKind && runtimeContractRequired && liveRuntimeContinuation` 的 role 必须暴露 `request_orchestrator_decision`。

### Not A2A participants by design

以下不是 task-owned live worker request 方，不应被口头归入“全部 agent 具备 A2A”：

- `coding`
- `coding-assistant`
- `general`
- `mission`
- `compaction`
- `title`
- `summary`
- `control`
- `orchestrator`（responder，不是 worker request 方）

## Single Source Boundary

### Now enforced

Pending A2A request 的调度控制单源现在是 `respond_agent_coordination`。

已修复并测试的旁路：

- direct reply：如果目标 session 有 pending A2A request，返回 `AgentSessionPendingCoordinationError`，不写入 child-session user message，不创建 action，不消费 request。
- direct cancel：如果目标 session 有 pending A2A request，HTTP route 返回 409，不 abort child session，不消费 request。
- `cancel_subagent`：已有 guard 继续复用同一 pending coordination session-control helper。

### Still not single-source

Operator steer 总体仍不是 A2A 单源：

- 非 pending 的 direct reply 仍直接写 `overlay_direct_reply` 并 resume child session。
- build card steer 仍走 task-root operator message。
- task message / inject / retry / replan 是 task-root orchestration surface，不是 request/response/action 三件套。
- 非 pending 的 session cancel 仍是 direct session control。

这不一定全部是错误，但必须被定义成显式协议边界。不能再把它们包装成“所有 steer 都走 A2A”。

## New Agent Inheritance

新 agent 不能“注册一次自动具备完整 A2A”。

至少仍需要同步这些点：

- `AgentRoleContract` 定义 role 是否是 live task-owned worker。
- `AgentToolPool.roleAssignments` 暴露 `request_orchestrator_decision`。
- exact runtime agent 必须把 `createAgentCoordinationRuntimeTools()` 合入实际 `runAgentSession` toolKit。
- 非 exact runtime agent 必须能通过 registry 解析该 global tool。
- 如果支持 `redispatch_worker`，还要有 concrete dispatcher binding 和 replay/recovery branch。

本轮新增的 role coverage test 可以防止 live worker 角色漏掉 request tool-pool；但它不能自动生成 redispatch binding，也不能自动证明新 exact runtime agent 的 toolKit 已接入 helper。

## Repairs Made In This Audit

### Pending A2A direct-control single source

- Added shared pending session-control query:
  - `listPendingAgentCoordinationSessionControlRequests`
- Rewired:
  - `cancel_subagent`
  - `POST /task/:taskID/session/:sessionID/cancel`
  - `POST /task/:taskID/session/:sessionID/reply`
- Added `AgentSessionPendingCoordinationError` and HTTP 409 mapping.
- Added overlay structured-error handling and i18n text.

### Runtime A2A coverage

- Added `createAgentCoordinationRuntimeTools()`.
- Merged runtime A2A tool into:
  - requirements
  - architect
  - intent-analysis
  - goal-workload-analyst
  - fact-check
  - deep-research / frontend-research
- Added `request_orchestrator_decision` to explore role tool-pool.

## Remaining Risks

These are not fixed in this audit and block calling the protocol fully mature:

- Event-log restart backfill: `EngineEventLog.init()` subscribes to new `ProtocolStore` events but does not replay persisted `protocol_event` rows after restart.
- Queued wake active re-entry half commit: one branch can mark a wake drained before the task loop launch path has proven success.
- Malformed A2A artifact HTTP/SSE diagnostics: lower-level fail-loud tests exist, but route/overlay diagnostic projection is not fully covered.
- Backend SSE startup buffer ordering: persisted replay plus live delta ordering has unit coverage but lacks a route-level after-live E2E.
- Duplicate concurrent `respond_agent_coordination`: sequential/idempotent coverage exists, but concurrent claim race coverage is still missing.
- Terminal queued coordination wake: terminal task passive wake discard path is not yet proven to cancel or diagnose the pending request.
- Operator message / retry / replan / inject vs pending A2A concurrency remains under-specified.
- UI E2E for pending A2A reply/cancel/build steer is still missing.

## Verification Snapshot

Passed in this audit:

- `bun test packages/opencorvus/test/server/reply-error-taxonomy.test.ts --test-name-pattern "pending A2A request rejects direct reply"`
- `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts --test-name-pattern "cancel refuses to bypass a pending A2A request"`
- `bun test packages/overlay/test/agent-reply-box-structured-errors.test.ts`
- `bun test packages/opencorvus/test/agent/agent.test.ts --test-name-pattern "all live task-owned worker roles expose|explore agent limits"`
- `bun test packages/opencorvus/test/requirements/agent.test.ts --test-name-pattern "answered clarifications"`
- `bun test packages/opencorvus/test/architect/agent.test.ts --test-name-pattern "ArchitectAgent"`

Also passed after final runtime coverage repair and report update:

- `bun run --cwd packages/opencorvus typecheck`
- `bun run docs:check`
- `git diff --check -- <changed A2A audit files>`
