# Disable Snapshot Capture and Card Rewind

日期: 2026-06-23
状态: verified

## 用户要求

- 禁用 Snapshot 功能。
- 禁用卡片上的撤回按钮。

## 用户澄清

- 2026-06-23: “临时禁用”不是删除。撤回实现、服务调用、i18n、样式和测试覆盖应保留；卡片上的撤回按钮应保持在 UI 中但处于 disabled 状态，不能触发确认弹窗或后端请求。

## 已核对的历史约束

- The retired task rewind code-resource record 明确区分 task rewind 与 Snapshot 子系统：task rewind 不应接入 `Snapshot.*`，Snapshot 只服务 session/message 级文件差异证据。
- `2026-06-06-snapshot-global-root-cache-fix.md` 明确 `Snapshot.track()` 是正常消息/session 流里产生 snapshot hash 的入口；`patch/restore/revert/diff` 消费已有 hash 或显式调试命令。
- 前端卡片撤回按钮的唯一 TSX owner 是 `CardHeaderChrome.tsx`；`Card.tsx` 和 `ChatBubble.tsx` 只负责把 `submitTaskRewind` 传入。

## 全仓调用点

| 调用点                                                        | 当前行为                                                         | 本次处理                                                   |
| ------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- |
| `packages/opencorvus/src/snapshot/index.ts::Snapshot.track()` | `cfg.snapshot === false` 时跳过，否则默认生成 snapshot tree      | 改为只有 `cfg.snapshot === true` 才生成；默认禁用          |
| `packages/opencorvus/src/session/processor.ts`                | step-start/step-finish 调 `Snapshot.track()`，有 hash 才写 patch | 保持调用，依赖 `track()` 单一开关；默认不写 snapshot/patch |
| `packages/opencorvus/src/executor/managed.ts`                 | executor submit/acceptance 用 `Snapshot.track()` 计算 diff       | 保持调用，默认无 hash 时 diff 为空                         |
| `packages/opencorvus/src/engine/git.ts`                       | baseline metadata/progress payload 存 `Snapshot.track()` 结果    | 保持调用，默认 metadata 不再有 snapshot hash               |
| `packages/opencorvus/src/cli/cmd/debug/snapshot.ts`           | 显式 debug 命令调用 `Snapshot.track/patch/diff`                  | 不改；debug 是手动入口                                     |
| `packages/overlay/src/components/Card.tsx`                    | stage card 传 `onRewind` 到 header                               | 保留提交链路                                               |
| `packages/overlay/src/components/ChatBubble.tsx`              | agent bubble 传 `onRewind` 到 header                             | 保留提交链路                                               |
| `packages/overlay/src/components/CardHeaderChrome.tsx`        | `canRewind()` 为真时渲染 `data-ui="card-rewind"` 按钮            | 保留按钮渲染，固定 disabled，不绑定可触发提交的点击路径    |
| `packages/overlay/src/services/rewind.ts`                     | 提供 task rewind HTTP 客户端                                     | 暂不删除；非卡片入口和测试仍可能直接覆盖 route contract    |
| `packages/opencorvus/src/server/routes/orchestrator.ts`       | 暴露 `POST /task/:taskID/rewind`                                 | 暂不删除；用户要求限定为卡片按钮，不改后端 API             |

## 实施方案

1. 将 `Snapshot.track()` 的默认语义改为 disabled-by-default: 只有 `snapshot: true` 才允许生成 hash。
2. Snapshot 子系统单测使用 `tmpdir({ config: { snapshot: true } })` 显式启用，保证低层 primitive 仍可被验证。
3. 新增默认禁用回归测试：未配置 `snapshot` 时，`Snapshot.track()` 返回 `undefined` 且不初始化 snapshot git 目录。
4. 更新 git checkpoint 测试：默认 baseline 不再写 snapshot hash。
5. 前端卡片 owner 继续向 `CardHeaderChrome` 注入 `onRewind`，避免删除撤回链路；`CardHeaderChrome` 继续渲染 `data-ui="card-rewind"`，但按钮固定 `disabled`，且 `useCardHeadActions` 对卡片撤回点击提前返回，不弹确认框、不调用后端。
6. 更新 overlay 单元测试，断言 `card-rewind` 仍在卡片 header action rail 中但处于 disabled 状态，且点击不会调用 app dialog 或 `submitTaskRewind`。
7. 更新命令文档：`/undo` 依赖显式启用 `snapshot: true`，默认不会产生可回滚 snapshot。

## 验收

- `bun test packages/opencorvus/test/snapshot/snapshot.test.ts packages/opencorvus/test/engine/git-checkpoint-scenarios.test.ts`
- `bun test packages/overlay/test/card-header-chrome.test.ts packages/overlay/test/chat-bubble.test.ts packages/overlay/test/use-card-head-actions.test.ts`
- 前端截图验收：构建 overlay dist 后启动隔离静态 fixture，截图确认卡片 header 保留撤回按钮且 disabled，页面无布局破损。

## 验收结果

- `bun test packages/opencorvus/test/snapshot/snapshot.test.ts packages/opencorvus/test/engine/git-checkpoint-scenarios.test.ts --timeout 60000`: 62 pass, 1 skip, 0 fail。
- `bun test packages/opencorvus/test/config/config.test.ts --timeout 60000`: 64 pass, 0 fail。
- `bun test packages/overlay/test/card-header-chrome.test.ts packages/overlay/test/chat-bubble.test.ts packages/overlay/test/use-card-head-actions.test.ts packages/overlay/test/i18n-discipline-round2.test.ts --timeout 60000`: 19 pass, 0 fail。
- `bun run --cwd packages/overlay typecheck`: pass。
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/rewind-visual-stress.test.ts`: 1 pass, 0 fail。截图 `packages/overlay/.scratch/rewind-visual-stress/01-baseline.png` 已查看；`report.json` 记录 `rewindRequests: []`，所有 `data-ui="card-rewind"` 控件均为 `disabled: true`、`dataState: "disabled"`。
