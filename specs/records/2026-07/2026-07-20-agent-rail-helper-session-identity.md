# Agent Rail helper session identity repair

## Recall

### User request

- 修复任务 `tsk_f7f978be1001dHBrVL8MR2WGkN` 偶发无法渲染历史消息、双击任务后显示 `Conversation could not be loaded` 的问题。

### Acceptance criteria

1. 同一 worker session 内交错出现真实 helper 参与者（当前复现为 `compaction`）时，Task 初始 hydrate、tail merge、older history、session history 和实时消息都不再触发 Agent Rail `agentID drift`。
2. Agent Rail record 始终使用 `sessionAgentID` 作为执行 session owner；消息卡仍保留 `agentID` 作为真实消息参与者。
3. 两个不同的真实 session owner 仍必须严格失败；不得过滤 helper 消息、放宽 owner invariant 或添加 fallback。
4. 使用用户提供的正式 Task/SQLite 证据复核真实响应契约，并通过 focused tests、Overlay typecheck/build、文档健康检查和 Node 启动的真实桌面页面截图验收。
5. 不重启、刷新、停止或干预用户正在运行的 OpenCorvus/Overlay；commit subject 以 `dsw-33987` 开头并 push 到 `myhexin/v0.0.12beta`。

### Hard constraints

- `sessionAgentID` 是 session owner 的唯一消息级投影来源；`agentID` 只表达该条消息的真实参与者。
- 不修改正式 SQLite 数据，不增加任务/session/title/time 特判，不增加兼容 alias、过滤规则、重试 gate 或双源身份。
- 保留后端 `ConversationMessageView`、message bridge 和 tree writer 已有严格契约；修复遗漏的 Agent Rail 消费面。
- 前端视觉验收使用独立测试页面和 Node Playwright sidecar，不操作用户当前运行窗口。

### Sources read

- `AGENTS.md`
- `browser:control-in-app-browser` skill
- `specs/current/architecture/12-overlay-card-system.md`
- `specs/records/2026-07/2026-07-18-crypto-trading-long-mission-benchmark.md` Iteration 66
- `specs/records/2026-07/2026-07-20-legacy-assistant-conversation-identity.md`
- `packages/opencorvus/src/conversation/view.ts`
- `packages/opencorvus/src/orchestrator/protocol/message-bridge.ts`
- `packages/overlay/src/services/conversation.ts`
- `packages/overlay/src/services/events.ts`
- `packages/overlay/src/services/tree-writer.ts`
- `packages/overlay/src/store/conversation-agents.ts`
- Agent Rail, conversation hydrate, tree-writer and browser regression tests
- formal runtime response from `GET /task/tsk_f7f978be1001dHBrVL8MR2WGkN/conversation`
- formal SQLite `session` and `message` rows for the three affected integrity sessions
- Overlay runtime log `2026-07-20T151449-39815-1.log`

### Whole-repository search evidence

Repository-wide `rg` enumerated all `sessionAgentID`, `ConversationAgentMessageView`, `agentTargetRecordsFromMessages`, `hydrateConversationAgentView`, `attachConversationAgentViewTargets`, `applyLiveConversationAgentMessageUpdated`, `applyLiveConversationAgentPartUpdated`, Agent Rail target merges, server conversation projections, message bridges, tree-writer consumers and tests.

| Call point                                                      | Disposition                                                                                                                                                                                     |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend `ConversationMessageView` and `projectConversationView` | Keep unchanged: already emits canonical `sessionAgentID` plus truthful per-message `agentID`.                                                                                                   |
| Message bridge and session mirror                               | Keep unchanged: already stamps both identities on live message and part envelopes.                                                                                                              |
| Tree writer hydrate/live projection                             | Keep unchanged: already indexes sessions by `sessionAgentID` and cards by participant `agentID`.                                                                                                |
| `ConversationAgentMessageView`                                  | Add the missing required `sessionAgentID` field so the Overlay type mirrors the transport contract.                                                                                             |
| `agentTargetRecordsFromMessages`                                | Validate both identities and project Rail target ownership from `sessionAgentID`; retain participant `agentID` only as validated message evidence.                                              |
| `hydrateConversationAgentView`                                  | Reuse the repaired shared target projection; no parallel helper rule.                                                                                                                           |
| `attachConversationAgentViewTargets`                            | Reuse the same repaired target projection for older/session history.                                                                                                                            |
| `applyLiveConversationAgentMessageUpdated`                      | Require `info.sessionAgentID`; validate author against participant `agentID`; merge the target under the session owner.                                                                         |
| `applyLiveConversationAgentPartUpdated`                         | Require top-level `sessionAgentID`; validate author against participant `agentID`; merge the target under the session owner.                                                                    |
| `mergeTargetIntoRecord`                                         | Keep strict owner equality; repaired callers now pass the canonical owner instead of a participant.                                                                                             |
| Conversation hydrate/tail/history orchestration                 | Keep unchanged; all routes converge on the repaired Rail functions.                                                                                                                             |
| Agent Rail regression tests                                     | Add helper-before-owner and owner-before-helper hydrate coverage, older-history attachment, message-first live and part-first live coverage, plus missing-owner and real-owner-drift rejection. |
| Browser fixture                                                 | Add a compact helper-interleaving Task payload and assert the conversation plus one owner Rail record render without the task-load error.                                                       |

### Independent agent feedback

- None. The user did not request sub-agent or parallel-agent work; the primary Agent owns implementation and the required second review.

## Causal chain

- Observable: task selection shows `Conversation could not be loaded`; tail/history refresh logs repeat `Z6 -> X6/JI/H6` and later partial-projection errors.
- Direct trigger: `agentTargetRecordsFromMessages` groups by `sessionID` but stores each message participant `agentID` as the Rail record owner, then rejects the normal transition `frontend-innovate-integrity-reviewer -> compaction`.
- Deep cause: the 2026-07-19 identity repair added the explicit owner/participant split to backend DTOs, message bridge and tree writer, but the adjacent Agent Rail DTO and four consumers retained the former single-identity model.
- Why it is intermittent: only sessions whose selected hydrate/history window includes a registered helper message expose the mismatch; short sessions without compaction retain equal owner and participant identities.
- Why the whole conversation fails: selection resets the visible tree, hydrates cards, then hydrates Agent Rail. The Rail exception escapes the shared load and turns a valid HTTP 200 response into a task-level load error; repeated tail merges can observe the partially updated projection.
- Why existing tests missed it: the helper regression asserts only `hydrateConversationView`; Agent Rail fixtures stamp ordinary messages where owner and participant are always equal.

## Implementation plan

1. Make `sessionAgentID` required in the Agent Rail message DTO and centralize owner extraction in the existing target projector.
2. Route hydrate/history/live message/live part target ownership through that canonical owner while preserving strict participant-author checks.
3. Add exact helper interleaving and negative owner-contract tests across all four paths.
4. Add a Node-run browser fixture or extend the existing Agent Rail browser fixture with the same payload, capture the desktop conversation, and inspect the screenshot at original resolution.
5. Run focused tests, Overlay typecheck/build, historical links/document health, `git diff --check`, and a second diff review; update this verification ledger, commit owned files and push `myhexin/v0.0.12beta`.

## Verification ledger

- PASS: the formal Task conversation endpoint still returns HTTP 200 with a 4,666,555-byte payload, 19 Agent sessions and 79 projected messages. Five real `compaction` messages span the three reported integrity sessions, and every message `sessionAgentID` equals the corresponding projected session owner.
- PASS: 62 focused Agent Rail/conversation hydrate tests with 200 expectations cover helper-first, owner-first, missing owner, real owner drift, history, message-first live and part-first live paths.
- PASS: the broader six-suite Overlay projection run passed 138 tests with 492 expectations; strict tree-writer identity and message rendering contracts remain green.
- PASS: Overlay TypeScript, Vite production build and i18n checks pass. The root 11-package typecheck passes all 9 active package tasks; API route inventory and generated API documentation checks pass.
- PASS: the Node-launched real browser Agent Rail fixture hydrates a worker session containing an interleaved `compaction` message, retains one Rail owner for that session, reports no unexpected browser errors and passes its complete long-history locate/geometry suite.
- PASS: screenshots `.scratch/conversation-agent-rail-scroll-browser/single-activity-left-rail.png` and `.scratch/conversation-agent-rail-scroll-browser/chat-section-after-locate.png` were opened at original resolution. The helper renders as its truthful `compaction` card, the worker card and Rail remain present, and no task-load error, blank conversation or duplicate owner is visible.
- PASS: 82 historical-link/document-health tests with 1,356 expectations pass after the new record entered the tracked monthly index.
- PASS: final second review removed the test adapter's implicit owner fallback, made every retained fixture state its canonical `sessionAgentID`, and reran the six-suite projection set at 138/138 plus the Node browser test. `git diff --check` is clean; the owned diff is ready for commit and git-cc push.
