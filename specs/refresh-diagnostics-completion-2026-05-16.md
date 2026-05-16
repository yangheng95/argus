# Task: 补全缺失的 `refresh-diagnostics.ts`（修复 overlay 构建中断）

## 背景 / 根因（已由编排器调查确认，禁止重新质疑结论，直接据此实施）

- `bun run build:overlay` 失败：`Could not resolve "./refresh-diagnostics" from "src/services/sse.ts"`。
- 提交 `7c6c463ac [overlay-cpu] pause polling timers while window hidden` 往 `packages/overlay/src/services/sse.ts`
  的 `performSseReconnect` 注入了一套 `recordConversationRecovery*` 恢复埋点，并 `import ... from "./refresh-diagnostics"`，
  但**配套模块 `refresh-diagnostics.ts` 从未在任何分支/远端被创建**（已遍历所有 ref 确认）。
- 这是一次半成品误提交。本任务：**按文档与既有调用点契约补全该模块**，使构建恢复且符合项目规则。

## 唯一权威 API 契约（来自 `packages/overlay/src/services/sse.ts` 4 个调用点，禁止改动这些调用点的入参形状）

```ts
recordConversationRecoveryStarted({ channel: string; reason: string; taskID: string; source: string })
recordConversationRecoveryFailed   ({ channel: string; reason: string; taskID: string; source: string; durationMs: number; error: string })
recordConversationRecoveryAborted  ({ channel: string; reason: string; taskID: string; source: string; durationMs: number; error: string })
recordConversationRecoverySucceeded({ channel: string; reason: string; taskID: string; source: string; durationMs: number; resumeSequence: number })
```

当前实参：`channel/source = "sse-reconnect"`，`reason = "sse stream reconnect"`，`error` 为字符串，
`durationMs = Date.now() - startedAt`，`resumeSequence` 为 hydrate 返回的序号。

## 文档依据（须先通读）

- `specs/new-arch/2026-05-14-overlay-refresh-single-source-plan.md`：single-source refresh / selected-task
  原子恢复总体方案。本模块是该架构下**恢复遥测的单一来源**（single source），未来 selected-task 恢复路径也可能复用同一入口。
- 项目根 `CLAUDE.md`：硬性规则，违反任一条视为不合格。

## 实现约束（硬性，逐条遵守）

1. **rule 5/6 禁止过度工程**：最小实现。只满足 4 个调用点所需。**不得**新增服务端路由、store、UI 面板、状态机。
2. **rule 13 禁止状态机**：不得用 status 枚举 / if-else 状态流转来"跟踪恢复阶段"。四个函数各自独立、无状态耦合。
3. **rule 8/7 单一来源、禁止 fallback**：单一 sink，不得写 fallback 链或双源输出。
4. **rule 15 禁止伪消息**：这是开发期遥测（结构化 console），不是聊天消息，不得进入会话消息流。
5. **rule 10 禁止硬编码散落**：日志前缀等常量在模块内定义一次复用。
6. **rule 19**：任何缩写写注释（如 SSE = Server-Sent Events）。
7. **rule 36 必须配测试**：新增 `packages/overlay/test/refresh-diagnostics.test.ts`，对四个函数各断言产出一条结构化记录；
   sink 须可注入/可覆盖以便断言（单一可替换 sink，不是 fallback 多路）。
8. 风格对齐既有 service：参考 `packages/overlay/src/services/trace.ts` 与 `sse.ts` 中 `console.error("[sse] ...")` 约定。
9. 不得为"宽容缺失"去改 `sse.ts` 调用点（契约以调用点为准）。

## Sink 设计指引（已定，照做）

overlay 当前**没有**任何 client 侧 diagnostics sink。把本模块设计为单一来源的结构化记录器：
每个恢复生命周期事件输出一条带稳定前缀（如 `[recovery-diagnostics]`）的结构化记录；
sink 为模块内单一可替换函数（供测试覆盖），默认走 `console`。
**不要**自造 server route / store / UI —— 无 spec 依据即过度工程。

## 验收

- `bun run build:overlay` 成功。
- `bun run typecheck`（或 overlay 包的 typecheck）通过。
- 新单测通过。
- 完成后 `git add` 相关文件并以清晰信息提交（保留改动痕迹）。提交信息末尾保留 Co-Authored-By。
