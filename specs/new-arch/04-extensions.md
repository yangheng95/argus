# 04 — 扩展入口

> 对应代码：`src/executor/` · `src/plugin/` · `src/mcp/` · `src/acp/`

## 四条扩展入口

系统对外提供四个**语义不同**的扩展点，常被混淆，必须区分：

| 入口         | 位置        | 扩展的是                                  | 典型对象                                 |
| ------------ | ----------- | ----------------------------------------- | ---------------------------------------- |
| **Executor** | `executor/` | 跑代码的外部进程                          | claude-code / codex / opencode           |
| **Plugin**   | `plugin/`   | 非 executor 语义的外部插件（hook / auth） | `@opencorvus-ai/plugin` API 下的任意实现 |
| **MCP**      | `mcp/`      | Model Context Protocol server             | 任意实现 MCP 的工具服务                  |
| **ACP**      | `acp/`      | Agent Client Protocol（编辑器集成）       | Zed 等外部编辑器                         |

## Executor —— 执行器

**代码**：`src/executor/`

三家实现 × 多种形态：

| 实现         | CLI 形态       | Agent 形态        | App-server 形态                                      |
| ------------ | -------------- | ----------------- | ---------------------------------------------------- |
| claude       | —              | `claude-agent.ts` | `claude-code.ts`                                     |
| codex        | `codex-cli.ts` | —                 | `codex-app-server.ts` + `codex-app-server-client.ts` |
| opencode     | `opencode.ts`  | —                 | —                                                    |
| （共享基座） | —              | `codex.ts`        | —                                                    |

**历史变更**：旧的 `claude-cli.ts` 已删除（commit `11fe9bf30` — 从未在生产使用）。

**关键文件**：

- `registry.ts` — 执行器注册表（`ExecutorRegistry.has / require / autoRegister`）
- `bootstrap.ts` — 启动器（`ExecutorBootstrap.autoRegister`）
- `discovery.ts` — 能力探测
- `contract.ts` — `ExecutorNotConfiguredError` 等契约 + 错误类型（原名 `compat.ts`，已改名）
- `managed.ts` — 托管进程生命周期
- `external-process.ts` — 外部进程封装
- `protocol/` — 执行器协议定义（`adapter/` · `json-rpc.ts` · `model.ts` · `tool.ts`）

**调用链**：

```
Orchestrator build tool → build/agent.ts (LLM 决策 + Worktree.create) →
   ExecutorRegistry.require() → Executor 进程 → diff / acceptance
   + goal/runner.ts::cleanupGoalWorkspace 在 worktree 生命周期末端回收
```

（旧 `pipeline/executor.ts` 与 `engine/goal-pool.ts` 已删除。`goal/runner.ts` 当前仅
121 行，只导出 `cleanupGoalWorkspace`，**不再**承担 worktree 创建或 executor dispatch
职责；worktree 创建走 `Worktree.create`（在 `build/agent.ts` · `orchestrator/tools.ts`
直接调用）。`ExecutorRegistry.require()` 调用点在 `build/agent.ts` · `engine/runtime.ts`
· `task-api/index.ts` 三处。）

## Plugin —— 非执行器插件

**代码**：`src/plugin/index.ts` + `src/plugin/isolate.ts`（`runHookIsolated`）

- 通过 `@opencorvus-ai/plugin` SDK 加载第三方 Hook / auth plugin
- 内置示例：`GitlabAuthPlugin`
- 运行时注入 `Plugin.state`，暴露 `Bus` / `Session` / `Config` / `Server` 给 plugin
- `isolate.ts` 用 isolated runtime 跑第三方 hook，避免污染主进程

**与 executor 的区别**：plugin 提供 hook 能力（生命周期回调、auth、rewrite），**不承担**"在 worktree 里跑完整任务产生 diff" 的职责。

> 旧版本的 `plugin/codex.ts` · `plugin/copilot.ts` 已删除 —— 这两家都作为 executor（`executor/codex-*`）收编，不再存在 plugin 形态。

## MCP —— Model Context Protocol

**代码**：`src/mcp/`

| 文件                                      | 作用                                            |
| ----------------------------------------- | ----------------------------------------------- |
| `index.ts`                                | MCP client 管理（连接、生命周期）               |
| `serve.ts`                                | OpenCorvus 自身作为 MCP server 暴露工具         |
| `stdio.ts`                                | stdio transport 适配（本地子进程）              |
| `materialize.ts`                          | 把 MCP 工具实例化进 ToolRegistry / agent 上下文 |
| `auth.ts`                                 | MCP 鉴权                                        |
| `oauth-callback.ts` · `oauth-provider.ts` | OAuth 流                                        |

两种角色：

- **作为 client / host**：接入外部 MCP server，把工具暴露给 agent（Orchestrator / sub-agent 决定调用）
- **作为 server**：对外暴露 OpenCorvus 自己的能力（见 `mcp/serve.ts`）

## ACP —— Agent Client Protocol

**代码**：`src/acp/`

- 外部编辑器（Zed 等）通过 ACP 协议调用 OpenCorvus
- 编辑器扮演 client，OpenCorvus 扮演 agent
- 与 `ChannelIngress` / `ControlMessage` 并列为入站入口之一（见 [03-control.md](03-control.md)）

文件：`agent.ts` · `session.ts` · `types.ts`（README 存于目录内）。

## 常见误区

1. **"把 codex 当 executor 用还是 plugin 用？"** — 已统一为 executor，不存在 plugin 形态。
2. **"MCP 能不能替代 plugin？"** — 理论上可以，实际上 plugin 更紧耦合（in-process 调用，类型共享），MCP 是远程协议（有序列化开销 + 权限/鉴权流）。
3. **"Executor 多态怎么选 CLI / agent / app-server？"** — 由 `engine_task.executor` 字段决定，用户或 capability `set_executor` 在创建 task 时指定。

## 相关文档

- [01-agents.md](01-agents.md) — Orchestrator 如何通过 tools 调 executor
- [03-control.md](03-control.md) — ACP 作为入站入口与 channel/control 的关系
- [06-provider.md](06-provider.md) — LLM Provider（另一条独立扩展轴，不与上述 4 条混淆）
