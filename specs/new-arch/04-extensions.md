# 04 — 扩展入口

> 对应代码：`src/executor/` · `src/plugin/` · `src/mcp/` · `src/acp/`

## 四条扩展入口

系统对外提供四个**语义不同**的扩展点，常被混淆，必须区分：

| 入口 | 位置 | 扩展的是 | 典型对象 |
|---|---|---|---|
| **Executor** | `executor/` | 跑代码的外部进程 | claude-code / codex / opencode（各 3 种形态） |
| **Plugin** | `plugin/` | 非 executor 语义的外部工具 | codex（plugin 形态） · copilot |
| **MCP** | `mcp/` | Model Context Protocol server | 任意实现 MCP 的工具服务 |
| **ACP** | `acp/` | Agent Client Protocol（编辑器集成） | Zed 等外部编辑器 |

## Executor —— 执行器

**代码**：`src/executor/`

三类形态 × 三家实现 = 9 种组合：

| 实现 | CLI 形态 | Agent 形态 | App-server 形态 |
|---|---|---|---|
| claude | `claude-cli.ts` | `claude-agent.ts` | `claude-code.ts` |
| codex | `codex-cli.ts` | — | `codex-app-server.ts` + `codex-app-server-client.ts` |
| opencode | `opencode.ts` | — | — |

**关键文件**：
- `registry.ts` — 注册表
- `bootstrap.ts` — 启动器
- `discovery.ts` — 能力探测
- `compat.ts` — `ExecutorNotConfiguredError` 等兼容错误
- `managed.ts` — 托管进程生命周期
- `external-process.ts` — 外部进程封装
- `protocol/` — 执行器协议定义

**调用链**：
```
Orchestrator tool → pipeline/executor.ts → ExecutorRegistry
                → worktree 隔离 → Executor 进程 → diff / delivery
```

## Plugin —— 非执行器工具

**代码**：`src/plugin/`

```
plugin/codex.ts       Codex 作为 plugin（区别于 Codex executor）
plugin/copilot.ts     Copilot
plugin/index.ts       注册表
```

**与 executor 的区别**：plugin 提供工具能力（代码补全、代码建议），但不承担
"在 worktree 里跑完整任务产生 diff" 的职责。这是语义分层，不可混用。

## MCP —— Model Context Protocol

**代码**：`src/mcp/`

- argus 作为 MCP client / host，接入外部 MCP server
- 工具暴露给 agent，由 Orchestrator 或 sub-agent 决定调用

## ACP —— Agent Client Protocol

**代码**：`src/acp/`

- 外部编辑器（Zed 等）通过 ACP 协议调用 argus
- 编辑器扮演 client，argus 扮演 agent
- 与 Gateway / Channel 并列为入站入口之一（见 [03-control.md](03-control.md)）

## 常见误区

1. **"把 codex 当 executor 用还是 plugin 用？"** — 看需要什么：要跑完整任务产生 diff 用
   executor；只要代码建议用 plugin。不要两头都接。
2. **"MCP 能不能替代 plugin？"** — 理论上可以，实际上 plugin 更紧耦合（in-process 调用，
   类型共享），MCP 是远程协议（有序列化开销）。
3. **"Executor 多态怎么选 CLI / agent / app-server？"** — 由 `executor` 字段决定
   （见 `engine_task.executor`），用户/gateway 在创建 task 时指定。

## 相关文档

- [01-agents.md](01-agents.md) — Orchestrator 如何通过 tools 调 executor/plugin
- [03-control.md](03-control.md) — ACP 作为入站入口与 channel/gateway 的关系
- [06-provider.md](06-provider.md) — LLM Provider（另一条独立扩展轴，不与上述 4 条混淆）
