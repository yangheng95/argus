# 04 — 扩展入口

> 对应代码：`src/executor/` · `src/plugin/` · `src/mcp/` · `src/acp/`

## 四条扩展入口

系统对外提供四个**语义不同**的扩展点，常被混淆，必须区分：

| 入口         | 位置        | 扩展的是                                  | 典型对象                                 |
| ------------ | ----------- | ----------------------------------------- | ---------------------------------------- |
| **Executor** | `executor/` | 内置执行队列与外部 coding 进程            | opencorvus / codex / claude-code         |
| **Plugin**   | `plugin/`   | 非 executor 语义的外部插件（hook / auth） | `@opencorvus-ai/plugin` API 下的任意实现 |
| **MCP**      | `mcp/`      | Model Context Protocol server             | 任意实现 MCP 的工具服务                  |
| **ACP**      | `acp/`      | Agent Client Protocol（编辑器集成）       | Zed 等外部编辑器                         |

## Executor —— 执行器

**代码**：`src/executor/`

当前执行器名 × 多种形态：

| 执行器名      | CLI / 本地形态        | Agent / SDK 形态   | App-server 形态                                      |
| ------------- | --------------------- | ------------------ | ---------------------------------------------------- |
| `opencorvus`  | `opencorvus.ts`       | —                  | —                                                    |
| `codex`       | `codex-cli.ts`        | `codex.ts`         | `codex-app-server.ts` + `codex-app-server-client.ts` |
| `claude-code` | —                     | `claude-agent.ts`  | `claude-code.ts`                                     |

当前执行器名以 `executor/contract.ts` 的 `ExecutorName` 为准：`opencorvus`、`codex`、`claude-code`。

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
Orchestrator build tool → build/agent.ts (`build.worktreeUsage` 由 LLM 选择 managed_worktree / current_project；省略时 goal 默认 managed worktree、task-level implementation build 默认当前 caller-owned workDir) →
   ExecutorRegistry.requireCoding() → external coding executor → diff evidence
   + goal/runner.ts::cleanupGoalWorkspace 在 worktree 生命周期末端回收
```

（旧 pipeline executor 与 goal-pool 模块已删除。`goal/runner.ts` 只导出
`cleanupGoalWorkspace`，不承担 worktree 创建或 executor dispatch 职责；managed worktree 创建走
`BuildAgent.run` 内的 `Worktree.create` 或 Orchestrator 复用已记录 goal worktree；current-project build 由 orchestrator 传入当前项目 `workDir`，external coding executor 调用走 `ExecutorRegistry.requireCoding`。）

## Plugin —— 非执行器插件

**代码**：`src/plugin/index.ts` + `src/plugin/isolate.ts`（`runHookIsolated`）

- 通过 `@opencorvus-ai/plugin` SDK 加载第三方 Hook / auth plugin
- 内置示例：`GitlabAuthPlugin`
- 运行时注入 `Plugin.state`，暴露 `Bus` / `Session` / `Config` / `Server` 给 plugin
- `isolate.ts` 用 isolated runtime 跑第三方 hook，避免污染主进程

**与 executor 的区别**：plugin 提供 hook 能力（生命周期回调、auth、rewrite），**不承担**"在 worktree 里跑完整任务产生 diff" 的职责。

> 旧版本的 `plugin/codex.ts` · `plugin/copilot.ts` 已删除 —— 这两家都作为 executor（`executor/codex-*`）收编，不再存在 plugin 形态。

## Expert Squad Package —— Agent 能力包

**代码**：`src/expert-squad/` · `src/agent/prompt-profile.ts` · `src/skill/` ·
`src/engine/workflow.ts`

Expert squad 是 OpenCorvus 内部的 scenario / agent capability package，不是外部
Codex skill。运行时内置 package 只保留通用 `general`；非通用 squad 的分发形态是
payload，必须先释放成项目目录 `.opencorvus/expert-squads/<id>/`，再通过普通
package discovery / catalog 进入运行时。分发 payload 由
`packages/opencorvus/script/generate-expert-squad-payload.ts` 在构建前从仓库
`.opencorvus/expert-squads/<id>/` 明文包生成，禁止手写平行清单：

- `expert-squad.jsonc` 声明 profile identity、agent prompt overlays、skills、
  package tools、package MCP servers/tools；
- `selector.md` 是 Orchestrator-visible selector skill 的完整说明来源；
- `PromptProfile.builtIns` 只保留通用内置 profile；非通用 squad 即使随应用分发，
  也先释放为明文项目 package，再通过 package 发现 / 加载进入 catalog；
- `PromptProfileResolver` 负责把当前 active expert squad 投影成 scheduler
  capability、worker capability、visible selector skills、skills、package tools
  和 scoped package MCP providers；
- 普通 `agents/<role>` 目录必须由 `expert-squad.jsonc` 的 `agents.<role>`
  声明，禁止保留未声明 role 的空目录或资源目录；
- 声明了 `virtual_agents.<role>` 的 package-owned agent 使用
  `virtual-agents/<role>/system.md` 及同目录下的 `skills/`、`tools/`、`mcp/`
  作为 role-scoped package resource；同 role 的 `agents/<role>` 目录不得同时存在；
- workflow 仍由 scheduler scope 的 `WorkflowRegistry` 声明。Expert squad 可以声明
  可见能力和 role overlays，但不能创建第二套 workflow、dispatch、context packet
  或 broad task-manipulation tool。

Personal Codex skills, local checklists, or historical task records may describe
how a developer once edited these packages, but they are not runtime authority
for expert-squad behavior. When they disagree with current code, tests, or
`specs/current/**`, current repository sources win.

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
3. **"Executor 多态怎么选内置队列 / CLI / agent / app-server？"** — 由 `engine_task.executor` 字段决定，用户或 capability `set_executor` 在创建 task 时指定；当前合法值是 `opencorvus`、`codex`、`claude-code`。

## 相关文档

- [01-agents.md](01-agents.md) — Orchestrator 如何通过 tools 调 executor
- [03-control.md](03-control.md) — ACP 作为入站入口与 channel/control 的关系
- [06-provider.md](06-provider.md) — LLM Provider（另一条独立扩展轴，不与上述 4 条混淆）
