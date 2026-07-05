# Overlay Task Queue Dialog Retirement

Date: 2026-07-05
Status: planned

## Recall

- 用户原始要求：删除 overlay 发布 task 时弹出的“是否排队”弹窗，但保留 API 的排队选项。
- 验收标准：
  - overlay 在未显式传 `queue` 时发布 task 不再打开 `task-queue-decision` 弹窗。
  - overlay 仍可在调用 `createTask({ queue: true | false })` 时把显式 queue 选项原样传给 `POST /task`。
  - 真实前端页面截图/浏览器验证证明发送新 task 后不会出现该弹窗。
- 硬约束：
  - 禁止 fallback / 兜底逻辑；必须保持单一来源。
  - 改动前先读取落盘方案并 recall。
  - 代码改动必须带测试。
  - 前端交付必须做真实页面截图复核，不能只靠单测或 DOM 断言。
  - 不重启、不干预用户正在运行的 overlay 进程；验证使用独立测试进程。
- 已读取落盘资料：
  - `specs/README.md`
  - `specs/records/2026-06/2026-06-18-app-dialog-segmented-control.md`
  - `specs/records/2026-06/2026-06-20-app-dialog-task-decision-keyboard.md`
  - `specs/records/2026-06/2026-06-29-overlay-task-create-model-forwarding.md`
- 全仓 grep 结果：
  - `packages/overlay/src/services/task.ts::resolveTaskQueueDecision()` 是 overlay 新建 task 时打开 `task-queue-decision` 的唯一生产调用点。
  - `packages/overlay/src/components/AppDialogHost.tsx`、`packages/overlay/src/services/app-dialog.ts`、`packages/overlay/test/browser/app-dialog-segmented-control.test.ts`、`packages/overlay/test/task-init-git-retry.test.ts`、`packages/overlay/test/dialog-service-single-source.test.ts` 直接依赖该弹窗链路。
  - `packages/overlay/src/services/chat.ts::panelMessage()` 在无选中 task 时调用 `createTask()`，未显式传 `queue`，因此当前 overlay 发送新 task 一定会走弹窗。
  - 后端和 API 仍然接受显式 `queue` 布尔值：`packages/opencorvus/src/task-api/index.ts` 及相关测试继续覆盖 `queue: true | false`。
- 独立 agent 反馈：本轮未再委托子 agent；证据来自本地 grep、spec、源码和现有测试。

## Root Cause

overlay 把“是否排队”建模成 `createTask()` 的必经前端决策，而不是调用方可选参数：

- `CreateTaskOptions.queue` 已经是显式 API 入参。
- 但 `createTask()` 在 `queue` 缺失时并不直接采用固定行为，而是调用 `resolveTaskQueueDecision()` 弹出 `task-queue-decision`。
- `panelMessage()` 新建 task 的常见路径没有传 `queue`，因此用户每次从 overlay 发布新 task 都会被迫做一次 UI 选择。

如果目标是“删 overlay 弹窗但保留 API queue 选项”，正确边界是退休 overlay 默认弹窗决策，让未显式传 `queue` 的创建路径直接使用固定的立即启动语义，同时保留显式 `queue` 透传能力；不应改后端 API，也不应引入新的隐藏 gate。

## Implementation Plan

1. 在 `packages/overlay/src/services/task.ts` 删除 `resolveTaskQueueDecision()` 对 `showAppDialog()` 的依赖；当 `options.queue` 缺失时，`createTask()` 直接使用单一默认值 `false`。
2. 保留 `CreateTaskOptions.queue?: boolean`，让显式传入的 `true`/`false` 仍然原样进入 `POST /task` body。
3. 删除或改写所有只验证 task queue 弹窗的 overlay 测试，改成：
   - 未传 `queue` 时不打开弹窗并发送 `queue: false`；
   - 显式 `queue: true` 时继续发送 `queue: true`。
4. 删除 production 中不再可达的 `task-queue-decision` 专用渲染/结算逻辑，并同步更新相关 source-guard 测试，避免留下死分支。
5. 使用独立浏览器测试启动真实 overlay 页面，提交新 task 并截图，确认不会再出现该弹窗。

## Validation

- `bun test packages/overlay/test/task-init-git-retry.test.ts packages/overlay/test/panel-message-new-task-directory.test.ts packages/overlay/test/dialog-service-single-source.test.ts packages/overlay/test/app-dialog-timeout.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `node --test --test-reporter=dot --test-timeout=60000 <updated browser test>`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- 真实浏览器截图：发送新 task 后页面不出现 `task-queue-decision`，且 `POST /task` 请求 body 仍包含正确 `queue` 值。
