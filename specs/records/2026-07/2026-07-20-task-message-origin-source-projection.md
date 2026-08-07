# Task message origin-source projection repair

## Recall

### User request

- 修复 Mission 中断后继续发送消息时出现的 `tree-writer: message ... missing originSource`。
- 检查普通 Chat 是否存在同类问题。

### Acceptance criteria

1. `POST /task/:taskID/message` 对 active、cancelled、completed、failed 等任务状态返回完整的 `Message.VisibleWithParts`；即时投影包含 `originSource`、消息 `orderKey` 和 part `orderKey`。
2. Overlay 继续严格拒绝缺失来源的消息；不得通过前端 fallback、放宽 tree-writer invariant 或伪造 optimistic message 掩盖后端缺陷。
3. 既有任务上的普通 Chat 与 Mission 共用任务消息路径，修复后均可立即投影持久化用户消息。
4. 独立 Session Chat 的 `POST /session/:sessionID/prompt_async` 保持现有 `enrichStandaloneSessionTranscript` 路径，并用测试证明其来源投影仍完整。
5. 添加 route/投影回归测试，执行 focused tests、typecheck、文档健康测试和二次 diff review。

### Hard constraints

- 不重启、刷新、终止或操作用户正在运行的 OpenCorvus/Overlay。
- 不增加状态 gate、前端 fallback、第二套消息 DTO 投影或兼容路径；复用 backend message bridge。
- 保留工作区所有既有未提交修改和未跟踪 `C:/`，只提交本任务文件/hunk。
- commit subject 以 `dsw-33987` 开头，并 push 到 `myhexin/v0.0.11beta`。

### Sources read

- `AGENTS.md`
- 用户截图与 Task Debug Info
- `packages/opencorvus/src/task-api/index.ts`
- `packages/opencorvus/src/orchestrator/protocol/message-bridge.ts`
- `packages/opencorvus/src/protocol/session-mirror.ts`
- `packages/opencorvus/src/server/routes/orchestrator.ts`
- `packages/opencorvus/src/server/routes/session.ts`
- `packages/overlay/src/services/chat.ts`
- `packages/overlay/src/services/task.ts`
- `packages/overlay/src/services/tree-writer.ts`
- 相关 task-message、session-mirror、conversation 和 overlay tests

### Whole-repository search evidence

Repository-wide `rg` covered `originSource`, `tree-writer`, `ingestPersistedConversationMessage`, `continueTaskMessage`, `appendTaskSessionMessage`, `overlayMeta`, `user_message`, task/session message routes, and all task-root provenance consumers.

| Call point | Disposition |
| --- | --- |
| `overlay.panelMessage` selected-task branch | Retain `/task/:id/message`; it serves both Mission and existing-task Chat and immediately ingests `user_message`. |
| `overlay.submitMessage` selected standalone Session branch | Retain `/session/:id/prompt_async`; route already uses `enrichStandaloneSessionTranscript`. |
| `EngineService.handleTaskMessage` / `continueTaskMessage` | Replace the partially annotated return DTO with the shared persisted-message bridge projection. |
| `appendTaskSessionMessage` | Continue persisting one task-root message; do not create a frontend-specific copy or parallel message. |
| `enrichMessageEventProperties` | Reuse as the authoritative task-owned message/part projection, including source and timeline order keys. |
| `annotateTaskTranscriptMessages` | Retain current hydration projection; follow-up consolidation is outside this focused defect unless tests prove drift. |
| `tree-writer.requireMessageOrigin` | Retain strict rejection; the invariant correctly exposed the backend response bug. |
| `TaskRootMessageProvenance` consumers | Retain nested wake provenance; it is scheduler/audit identity, while `originSource` is a DTO projection derived by the bridge. |

### Independent agent feedback

- None. The user did not request sub-agent or parallel-agent work; the primary agent performs the second review.

## Causal chain

- Observable: sending a follow-up after cancelling a Mission persists and wakes the task, then the UI reports `missing originSource`.
- Direct trigger: `panelMessage` immediately passes `result.user_message` to strict `tree-writer`, but the task route response does not contain `info.originSource`.
- Deep cause: the task append path manually spreads only `overlayMeta` onto the persisted info. `overlayMeta` owns routing identity and intentionally does not own persisted-source or timeline projection; the response therefore bypasses the shared message bridge that adds `originSource` and order keys.
- Why prior tests missed it: cancelled-task tests asserted reopen/dispatch state, and task route tests asserted persistence/order keys, but neither asserted the complete visible DTO consumed by tree-writer.
- Chat impact: empty/standalone Chat is unaffected because `prompt_async` explicitly enriches its response. Chat on an existing task is affected because it uses the same `/task/:id/message` response as Mission.

## Implementation plan

1. Add one exported persisted task-message projection in the existing backend message bridge, built from the same message/part event enrichment path.
2. Make the task append response use that projection and remove its partial manual overlay metadata assembly.
3. Extend route, bridge, and Node browser regressions to assert `originSource`, message/part order keys, and successful cancelled-task submission without a send-failure dialog.
4. Run focused tests, typecheck, historical-doc links, diff review, then commit only owned hunks and push `myhexin/v0.0.11beta`.

## Verification ledger

- PASS: 69 focused backend/overlay tests across task routes, terminal-task revive, message bridge, session mirror, and persisted tree-writer ingestion; 443 expectations, zero failures.
- PASS: task package `tsc --noEmit` after preserving the projected message's user-role type.
- PASS: generated OpenAPI and TypeScript SDK expose `originSource`, routing identity, and timeline order keys; SDK contract plus historical-doc health reports 39 tests and 427 expectations with zero failures.
- PASS: `api:routes-check` reports 31 route files clean; `docs:check` reports 281 operations in 23 groups.
- PASS: real Node browser submission from a selected cancelled task uses `/task/:id/message`, consumes the complete persisted response, renders the user bubble, and produces no browser/runtime errors or Send failed dialog.
- PASS: visually inspected `.scratch/task-message-origin-source-projection.png`; the reopened task header and real `continue cancelled task` user bubble are visible, with no blocking modal.
- PASS: final root `bun run typecheck` reports 9/9 package tasks successful after the concurrent managed-sidecar owner settled its independent changes.
