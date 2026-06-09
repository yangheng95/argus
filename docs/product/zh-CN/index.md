# OpenCorvus

> AI 编码代理的开源工程化外壳（harness）。

## 是什么

编码代理（coding agent）擅长写代码，但单次输出**不可靠**：没有规格、没有验收、没有重试、没有状态。

OpenCorvus 把「一次性的代码生成」包装成**可重复、可验收、可自愈的研发工作流**。你给一个任务，它自动走一遍 **spec → goals → plan → execute → evaluate → deliver**，失败时自动重规划或重试，直到达成验收标准或预算耗尽。

## 核心能力

| 能力                | 说明                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| **Spec-first 规划** | Spec Agent 把模糊需求转写成可测试的规格书（含验收标准、证据链）                                |
| **目标分解**        | Architect 先分析边界，再把规格分解成至少 2 个小型、可独立验收的实现目标                        |
| **多执行器调度**    | 内置 OpenCorvus，可自动发现并调度 Codex / Claude Code                                          |
| **评估驱动重试**    | build/test/lint/startup/artifact/visual/Playwright/LLM review + 默认开启的 `spec check` 验收门 |
| **多通道接入**      | HTTP API、Overlay 桌面端、14 个 IM channel（Slack/Telegram/Feishu/Discord/…）                  |
| **状态持久化**      | 任务、计划、运行、交互、交付、评估全部落 SQLite；会话与项目级记忆跨会话复用                    |
| **人工参与**        | 权限 ask/allow/deny、follow-up 消息、手动反馈，均可在无人值守流程中无缝嵌入                    |

## 谁应该用

- **需要把 AI 编码代理接进生产线**的研发团队：需要审计、重试、状态、一致性。
- **需要远程驱动编码代理**的使用者：Slack 群里发一条需求，看着它把 PR 干完。
- **有自有 coding CLI** 想要编排层的工程师：OpenCorvus 不替代你的 agent，它把 agent **变可靠**。

## 三层架构

```
┌─ Channel 层 ─────────────────────────────────────────────┐
│  Overlay UI / HTTP API / 14 个 IM channel               │
├─ Orchestrator 层 ────────────────────────────────────────┤
│  Task Agent → GoalPool → Planner → Executor → Evaluator │
│  （SQLite 持久化 + permission + 预算 + 重试/重规划）     │
├─ Executor 层 ────────────────────────────────────────────┤
│  OpenCorvus 内核 / Codex / Claude Code                   │
└──────────────────────────────────────────────────────────┘
```

详见 [架构总览](./concepts/architecture.md)。

## 快速上手

```bash
curl -fsSL https://opencorvus.ai/install | bash
cd /path/to/your/repo
opencorvus serve
# 打开 http://127.0.0.1:7878/ui/
```

完整步骤见 [Quickstart](./start/quickstart.md)。

## 文档地图

- **[Start](./start/install.md)** — 安装、最小可跑示例
- **[Concepts](./concepts/architecture.md)** — 架构、[数据模型](./concepts/goal-run-task.md)、[agentic loop](./concepts/agent-loop.md)
- **[OpenCorvus 核心](./opencorvus/configuration.md)** — [配置](./opencorvus/configuration.md)、[provider](./opencorvus/providers.md)、[权限](./opencorvus/permissions.md)、[评估](./opencorvus/evaluator.md)
  - [Skills（技能扩展）](./opencorvus/skills.md)
  - [Plugins（插件扩展）](./opencorvus/plugins.md)
  - [MCP（Model Context Protocol）](./opencorvus/mcp.md)
- **[Overlay 桌面端](./overlay/overview.md)** — Tauri 图形界面
- **[Channels](./channels/overview.md)** — 14 个 IM channel 的接入指南
- **[Operations](./operations/benchmark.md)** — [benchmark](./operations/benchmark.md)、[故障排查](./operations/troubleshooting.md)、[GitHub Action](./operations/github-action.md)、[ACP](./operations/acp.md)
- **[Reference](./reference/env.md)** — [环境变量](./reference/env.md)、[CLI](./reference/cli.md)、[HTTP API](./reference/api.md)、[SDK](./reference/sdk.md)
