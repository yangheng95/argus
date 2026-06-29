# 2026-06-29 Overlay Task Create Model Forwarding

## Recall

- 用户原始要求：启动 overlay 并发布测试任务 `帮我复刻这个页面：https://www.tradingview.com/markets/etfs/`，验证功能是否正常。
- 最新纠偏：用户指出应该怀疑代码有问题，不能把 `MissingModelConfigError` 当成环境偶发问题绕过。
- 可观察失败：向 `http://127.0.0.1:7878/task?init-git=true&directory=...demos\economy\etfs` 发布任务时返回 400，错误名 `MissingModelConfigError`，消息说明未配置 `model` 且不允许 fallback。
- 硬约束：禁止 fallback / 默认模型兜底；工具链异常先修工具；改动前读取硬盘方案并 recall；代码改动必须配测试；不能重启或杀掉用户运行中的 overlay 进程来掩盖问题。
- 已读取落盘资料：`specs/README.md`、`specs/artifacts/tv2ainvest.md`、`specs/current/architecture/01-agents.md`、`specs/current/architecture/03-control.md`、`specs/current/architecture/06-provider.md`。
- 全仓 grep 结果：`packages/overlay/src/services/chat.ts` 的 `panelMessage()` 在无选中 task 时调用 `createTask()`；`packages/overlay/src/services/task.ts` 的 `panelRequestBody()` 已经使用 `currentOpenCorvusModel()`；`packages/overlay/src/main.tsx` 的 mission 分支会向 `wakeMission({ text, model, promptProfile })` 传 model；`packages/opencorvus/src/task-api/index.ts` 在 `input.model` 缺失时调用 `resolveConfiguredModelRef()` 并按 strict no-fallback 抛错；`packages/opencorvus/test/agent/model*.test.ts` 已覆盖缺 model 不得 fallback。
- 独立 agent 反馈：本轮未再委托子 agent；当前证据来自本地代码、spec、测试和真实 task API 返回。先修主链路，不用猜测替代证据。

## Root Cause

后端行为是符合架构约束的：新 task 没有 `model` 时必须失败，不能使用历史默认值或隐式 fallback。代码缺口在 overlay 新建任务分支：

- `panelRequestBody()` 已把当前项目配置中的 OpenCorvus model 放入 panel stream 请求。
- mission 提交流程也显式传入当前 model。
- `panelMessage()` 无选中 task 时走直接 `createTask()`，但没有传当前 model，导致新目录没有 `opencorvus.jsonc` 时直接触发 `MissingModelConfigError`。

因此修复点应在 overlay 创建新 task 的调用契约，而不是后端放宽模型解析。

## Implementation Plan

1. 将 `currentOpenCorvusModel()` 从 `packages/overlay/src/services/task.ts` 暴露为共享 helper，仍然只接受合法的 `provider/model` 字符串，不制造默认值。
2. 在 `packages/overlay/src/services/chat.ts` 的新 task 创建分支中传入 `model: currentOpenCorvusModel()`，与 panel stream 和 mission 分支保持同一来源。
3. 在 `packages/overlay/test/panel-message-new-task-directory.test.ts` 增加断言：空 workspace 通过 `panelMessage()` 新建 task 时，请求 body 必须包含当前 app config model。
4. 保留 `createTask()` 的显式 model override 语义，不让底层 service 自行读取 app store，避免 API 层隐式状态扩散。

## Validation

- `bun test packages/overlay/test/panel-message-new-task-directory.test.ts packages/overlay/test/executor-settings.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`
- 重新发布 ETF 复刻任务时，请求必须带 model，不能再返回 `MissingModelConfigError`。
