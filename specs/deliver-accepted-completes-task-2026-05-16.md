# Deliver Accepted Completes Task (2026-05-16)

## User Requirement

用户要求：修改逻辑，走过 `deliver` 就认为 `completed`，并调查影响面。

本方案将“走过 deliver”限定为：`deliver` 产出 `verdict="accepted"`。`verdict="rejected"` 不是完成信号，仍是当前任务内的回修证据；否则会把失败验收误报为完成，破坏 Delivery 的验收职责。

用户补充约束：完成之后上下文不能丢；同一个 task 必须能恢复现场继续调度。这里的 `completed` 只能是 lifecycle 标记，不能表示删除 task/session/goals/run/delivery/evaluation，也不能让下一次 operator message 被历史 accepted verdict 误判为已处理。

## Recall

- `CLAUDE.md` / `specs/new-arch/01-agents.md`：Orchestrator 是唯一 lifecycle owner；Delivery 只产 verdict / evidence。
- `specs/new-arch/02-data.md`：`engine_task` 终态是 `completed / failed / cancelled`；运行产物集中在 `engine_artifact`。
- `packages/opencorvus/src/engine/task-status.ts`：task status 由 `time_started / time_completed / error / metadata.cancelled` 派生，没有 `status` 缓存列。
- `packages/opencorvus/src/engine/state.ts::updateTask`：`status: "completed"` 写 `time_completed`、清 `error`，并发布 `task.completed`；同时 `finalizeLiveRunForTerminalTask` 会把 active run 置为 `completed`。
- `packages/opencorvus/src/engine/task-message-open.ts`：terminal task 收到 operator message 时，清 `time_completed` 并重新排队同一个 task，不创建新 task，也不删除历史 artifact。
- `packages/opencorvus/src/workbench/board.ts`：Overlay 只消费 board projection；completed headline 依赖 task 派生状态，accepted delivery 依赖 accepted evaluation / verdict artifact。

## Call-Site Audit

| Surface | Current behavior | Change |
|---|---|---|
| `orchestrator/tools.ts::deliver` accepted branch | accepted 后先 auto-publish；只有 `Publisher.deliver` + `EngineGit.complete` 成功才 `updateTask(completed)` | accepted verdict 写入 evaluation 后立即 `updateTask(completed)`；publish 不再是 lifecycle 前置条件 |
| `orchestrator/tools.ts::deliver` rejected branch | 写 evaluation failed、按 verdict attribution 做 rework / wake loop | 保持不变，不 completed |
| `orchestrator/tools.ts::publish_delivery` | 可作为 accepted 后的终态路径，再次 publish 并 `updateTask(completed)` | 不能再作为正常终态路径；保留为显式 artifact/export 工具时不得决定 task lifecycle |
| `prompt/core/orchestrator-core.txt` | 多处要求 `deliver → publish_delivery` 才终止 | 改为 `deliver` accepted 即终止；`publish_delivery` 仅是显式 post-delivery export |
| `prompt/core/orchestrator-core.txt` terminal reopen | latest accepted verdict 可能被误读成新 operator message 已完成 | 明确 completed 不删除上下文；operator message 重新打开 task 后，历史 accepted verdict 只是 baseline |
| `agent/agent.ts` orchestrator tool include | 暴露 `publish_delivery` 给 Orchestrator | 保留工具但 prompt 限制用途，避免删除工具造成额外迁移 |
| Workbench / Overlay | 从 task 派生 status；从 accepted evaluation 找 acceptedDelivery | 无需改；只需保证 accepted deliver 更新 evaluation + task |
| Docs | `docs/product/zh-CN/opencorvus/evaluator.md` 写 accepted 进入 publish | 更新为 accepted 直接完成 task |

## Impact

- `task.completed` 会更早出现：Delivery verdict accepted 后出现，不再等待 publish/export/git checkpoint。
- `run.status` 会随 `updateTask(completed)` 同步变为 `completed`。
- `delivery.ready` plugin hook 应仍在 accepted deliver 后触发，因为这是 delivery-ready 的 lifecycle 信号。
- `delivery.result.artifacts/publish` 不再保证由 autonomous `deliver` 生成；显式 post-delivery publish/export 仍可写 artifacts。
- `publish_delivery` 在 completed 后不能依赖 active run；它必须从最新 accepted delivery 定位 run / verdict artifact，再执行显式 export。
- Completed task 被 operator message 重新打开时，必须保留同一个 `session_id` 和历史 run/delivery/evaluation，作为继续调度的现场基线。
- Rejected deliver 不触发 completed，仍驱动当前任务回修。

## Tests

- Add/adjust orchestrator tool test: accepted `deliver` marks task completed directly and emits accepted evaluation without requiring publish.
- Adjust publish gate test: publish gate failure is no longer a deliver lifecycle blocker.
- Adjust prompt hygiene test: orchestrator prompt states accepted `deliver` is the terminal path and does not require `publish_delivery`.
- Extend accepted-deliver test: after completion, reopening the same task for an operator continuation preserves `session_id`, run, delivery, and accepted evaluation.

## Acceptance

- Accepted deliver writes task `time_completed` and derived status is `completed`.
- Accepted deliver updates the task-level evaluation to accepted so board has `acceptedDelivery`.
- Rejected deliver remains active/rework and is not marked completed.
- Completed deliver preserves the recoverable scheduling context; operator continuation requeues the same task/session and keeps historical artifacts visible.
- No overlay-side fallback or status inference is added.
