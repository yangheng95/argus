# Legacy assistant conversation identity repair

## Recall

### User request

- 修复历史会话 `ses_08175b603ffeKlGyP6wTqXPiYs` 因子会话 `ses_081721f53ffeXGQ7FFsizM6wBW` 的 `assistant -> chat` identity drift 而无法在前端打开的问题。

### Acceptance criteria

1. `GET /session/:sessionID/conversation` 能读取 `kind=assistant`、无新版 Chat metadata、但消息持久化 `agent=chat` 的历史子会话并返回 HTTP 200。
2. `ConversationSessionView.agentID` 与 `ConversationMessageView.sessionAgentID` 投影为真实持久化参与者 `chat`；结构类型仍保持 `stage=assistant`。
3. 两个不同的真实非-helper Agent 共用同一 session 时继续严格报错，不能放宽 identity invariant。
4. 不修改历史 SQLite 数据，不增加标题、session ID、目录或时间条件，不增加前端 fallback 或部分 conversation 响应。
5. 添加投影与真实路由回归，运行 focused tests、类型检查、文档健康检查和二次 diff review。

### Hard constraints

- 不重启、刷新、停止或操作用户正在运行的 OpenCorvus/Overlay。
- 不增加数据库迁移、数据回填猜测、兼容 alias、双源 active identity 或 HTTP 降级路径。
- 只使用持久化 session kind、正式 Agent role contract 和持久化 message `agentID` 作为证据。
- 保留工作区中所有并行修改，尤其是 Provider profile/model 和相邻 2026-07-20 records/index edits。
- commit subject 必须以 `dsw-33987` 开头，并 push 到 `myhexin/v0.0.12beta`。

### Sources read

- `AGENTS.md`
- `specs/current/architecture/12-overlay-card-system.md`
- `specs/records/2026-07/2026-07-18-crypto-trading-long-mission-benchmark.md`
- `specs/records/2026-07/2026-07-20-task-message-origin-source-projection.md`
- `packages/opencorvus/src/agent/role-contract.ts`
- `packages/opencorvus/src/agent/persisted-session-identity.ts`
- `packages/opencorvus/src/chat/session.ts`
- `packages/opencorvus/src/conversation/view.ts`
- `packages/opencorvus/src/orchestrator/task-event.ts`
- `packages/opencorvus/src/orchestrator/protocol/message-bridge.ts`
- `packages/opencorvus/src/protocol/session-mirror.ts`
- `packages/opencorvus/src/server/routes/session.ts`
- conversation projection, session route and task route tests

### Whole-repository search evidence

Repository-wide `rg` enumerated every `projectConversationView`, `projectConversationAgentView`, `persistedSessionAgentID`, conversation ledger loader, `ConversationSessionView`, `ConversationMessageView`, `kind=assistant`, and assistant/chat identity test call site.

| Call point | Disposition |
| --- | --- |
| `projectConversationView` | Repair the conflation between structural `assistant` kind and a persisted native primary Agent participant; keep ordinary owner drift strict. |
| `projectConversationAgentView` | Reuse the same resolved display-session owner when merging the ledger so Agent Rail and display projection cannot disagree. |
| Task hydrate, task session/history and standalone session routes | Keep unchanged; all consume the repaired shared projection. |
| `persistedSessionAgentID` and ledger loaders | Keep strict current metadata/worker-descriptor identity resolution; do not mutate or guess historical database rows. |
| message bridge/session mirror | Keep message `agentID` as the canonical persisted participant evidence. |
| Overlay tree writer | Keep strict hydrate identity checks; backend must return one coherent projection. |
| Existing helper projection | Keep registered helper participant separation introduced by `fa5272d85`. |

### Independent agent feedback

- None. The user did not request sub-agent or parallel-agent work; the primary Agent owns implementation and second review.

## Causal chain

- Observable: selecting the parent history calls `/session/ses_08175b603ffeKlGyP6wTqXPiYs/conversation` and receives HTTP 500.
- Direct trigger: the child ledger projects `agentID=assistant` from `session.kind`, while its real persisted messages project `agentID=chat`; `projectConversationView` compares them as if both were Agent identities.
- Deep cause: `assistant` is a native direct-reply session structure, not an `AgentRoleContract` identity. New right-sidebar sessions carry explicit metadata and resolve to `chat`; older sessions retain only the truthful message identity. Conversation projection incorrectly treats the structural kind as stronger identity evidence than the message.
- Why the 2026-07-19 repair did not close it: that repair distinguishes registered helper participants such as `compaction`; `chat` is a primary Agent, so the old structural placeholder still reaches the non-helper drift branch.
- Why tests missed it: route coverage creates right-sidebar sessions with current metadata, while generic child fixtures use `agent=assistant`; no test builds the historical `kind=assistant` plus `agent=chat` shape without metadata.

## Implementation plan

1. Add one conversation-projection identity resolver based on the formal Agent role contract: structural `assistant` ownership may be completed by a persisted native primary participant whose role has no fixed session kind.
2. Use that resolver in both display and Agent Rail ledger projection, while retaining hard failure for multiple real non-helper identities.
3. Add direct projection tests for successful `assistant -> chat` resolution and rejected `chat -> coding` drift.
4. Add a parent/child session route regression reproducing the historical database shape and asserting HTTP 200 plus coherent owner/message identities.
5. Run focused tests, OpenCorvus typecheck, historical document links/document health, inspect the diff twice, then commit only owned files and push git-cc.

## Verification ledger

- PASS: exact historical projection for `ses_081721f53ffeXGQ7FFsizM6wBW` now produces `session.agentID=chat`, `message.sessionAgentID=chat`, `message.agentID=chat`, and `stage=assistant` in both display and Agent Rail views.
- PASS: 39 focused backend projection/session-route tests with 159 expectations, including the real parent/child HTTP route and the negative `chat -> coding` drift case.
- PASS: 15 strict Overlay hydrate/tree-writer tests with 51 expectations; frontend identity validation remains unchanged and accepts the coherent backend projection.
- PASS: 121 focused backend and document-health tests with 1,515 expectations; historical links and tracked record/index health are clean.
- PASS: `git diff --check` reports no whitespace errors.
- BLOCKED by unrelated concurrent work: OpenCorvus package typecheck currently reports four errors only in `src/provider/hexin-discovery.ts`, caused by the uncommitted Hexin profile/model edits preserved outside this task.
- UNRELATED existing failure: the broader `task-conversation-routes.test.ts` run passed 44/45 tests; `A2A sibling decisions expose visible action chains through conversation replay` independently reproduces `ZodError: expected object, received null` and does not traverse the repaired legacy assistant projection.
