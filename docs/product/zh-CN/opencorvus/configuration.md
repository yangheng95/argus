# 配置

OpenCorvus 的配置分三层：**CLI flag > 环境变量 > `opencorvus.jsonc` 文件**。后者优先级最低，但最稳定。

## 配置文件位置

| 位置                                   | 用途                          |
| -------------------------------------- | ----------------------------- |
| `~/.opencorvus/config/opencorvus.json` | 全局默认                      |
| `<repo>/.opencorvus/opencorvus.jsonc`  | 项目级覆盖（支持 JSONC 注释） |
| `OPENCORVUS_CONFIG_CONTENT` env        | 运行时注入（CI / 容器推荐）   |

同名字段，**后者覆盖前者**（managed → global → project → local → env）。

## 最小配置

```jsonc
{
  "$schema": "https://opencorvus.ai/config.json",
  "model": "openai/gpt-5.5",
}
```

## 字段分组（来自 `src/config/config.ts::ConfigSchema`）

```
顶层：
  $schema · logLevel · server · network · share · autoupdate · snapshot · watcher
  disabled_providers · enabled_providers · tool_permissions
  provider · model · small_model · default_agent · agent · mcp · lsp
  formatter · permission · compaction · terminal
  channel · command · skills · plugin · prompt · instructions
  username · locale

assistant:
  auto_iteration
  requirements{} · architect{} · acceptance{} · acceptance_visual{}
  frontend_design{} · intent_analysis{} · build{} · activity{} · debug{}
  default_workflow · workflows[] · max_executor_groups
  （每个 agent 子项是 agent 特化的：build 只有 max_steps + skills；
    acceptance 多一个 max_retries；acceptance_visual 全是数值硬门槛阈值。
    **没有**统一的 max_steps / timeout_ms / quality_threshold / max_attempts / skills 模板。）

experimental:
  auto_question · batch_tool · disable_paste_summary · continue_loop_on_deny
  memory{} · mcp_timeout · primary_tools · openTelemetry
```

### 不再存在的字段（2026-05 清理）

- ~~`assistant.spec{}`~~ / ~~`assistant.goal{}`~~ / ~~`assistant.planner{}`~~ / ~~`assistant.evaluator{}`~~ / ~~`assistant.adaptive{}`~~ —— planner / acceptance review 整体下线（见 [Agent 家族](../../../specs/new-arch/01-agents.md)），spec / goal / adaptive 在 workflow 系统替代后删除
- ~~`experimental.unattended`~~ / ~~`experimental.auto_permission`~~ —— 仅剩 `experimental.auto_question`
- ~~`max_replans` · `same_plan_retry_limit` · `stage_max_retries`~~

## 完整示例

参考仓库中的真实配置 `packages/opencorvus/.opencorvus/opencorvus.jsonc`：

```jsonc
{
  "$schema": "https://opencorvus.ai/config.json",
  "model": "github-copilot/claude-haiku-4.5",
  "locale": "zh-CN",

  "network": {
    "proxy": {
      "enabled": true,
      "url": "http://127.0.0.1:7890",
    },
  },

  "skills": {
    "paths": [
      "D:/myhexin-local/argus-opencode/packages/opencorvus/skills-market/github.com-openai-skills",
      "D:/myhexin-local/argus-opencode/packages/opencorvus/skills-market/github.com-anthropics-skills",
    ],
    "urls": [],
  },

  "plugin": [],

  "permission": {
    "skill": {
      "local-note": "deny",
      "sora": "ask",
      "figma": "ask",
      "doc-coauthoring": "ask",
    },
  },

  "assistant": {
    "auto_iteration": false,
    "max_executor_groups": 3,
    "default_workflow": "pipeline",
    "acceptance": { "max_retries": 2 },
    "build": { "max_steps": 80 },
  },

  "experimental": {
    "auto_question": true,
  },
}
```

## 关键字段

### `model`

默认 LLM。格式 `<providerId>/<modelId>`，provider 需在 `provider` 块或内置列表里注册（内置 20 个，见 [Providers](./providers.md)）。

### `small_model`

供 summary / title 等轻量任务使用的小模型；不设置时与 `model` 同。

### `locale`

`"en-US" | "zh-CN"`，operator 选定的系统语言，影响 LLM 回复语言与 SDK 透传。**与 Overlay UI 偏好的 `locale`（localStorage，仅控制前端文案）是两件事**——前者属配置（行为），后者属 UI 偏好。

### `network.proxy`

模型 Provider 请求的 HTTP(S) 代理。`enabled: false` 或空 `url` 表示直连；`url` 仅支持 `http://` / `https://`。

```jsonc
{
  "network": {
    "proxy": {
      "enabled": true,
      "url": "http://127.0.0.1:7890",
    },
  },
}
```

### `skills.paths` / `skills.urls`

本地 skill 市场路径与远程 skill URL。OpenCorvus 启动时加载全部 skill，供 agent 按需调用。详见 [Skills](./skills.md)。

### `permission`

每个 skill / tool 的 `allow / ask / deny`。**规则顺序 matters，后声明的覆盖前声明的**（last-match-wins）。详见 [Permissions](./permissions.md)。

> 2026-04 起 auto approval paths 机制已移除（commit `8d672db37`）——permission 系统只有声明式规则，没有自动放行白名单。

### `experimental.auto_question`

`question` tool 主动澄清的细粒度开关。默认 `true`。

### `assistant` 子块

各 agent 的精细调优与编排策略（合并入口 `src/engine/config.ts`，合并 DEFAULTS 后返回 typed config）：

```jsonc
{
  "assistant": {
    "auto_iteration": false,
    "requirements": { "max_steps": 20 },
    "architect": { "max_steps": 40 },
    "build": { "max_steps": 80, "skills": [] },
    "acceptance": { "max_retries": 2 },
    "max_executor_groups": 3,
    "default_workflow": "pipeline",
    "workflows": [],
  },
}
```

`assistant.auto_iteration` 默认 `false`。关闭时，failed goal wave 或 rejected
`deliver` 是可见终点：OpenCorvus 报告阻塞与下一步选项并等待 operator
follow-up。只有设为 `true` 时，OpenCorvus 才会在证据明确且非重复失败的情况下自动重新打开 rework attempt 并继续 build/deliver 修复循环。

- `max_executor_groups`：同一任务内 build / goal 的并行上限，默认 3
- `default_workflow`：`direct`（单文件 / bugfix）或 `pipeline`（多文件 / 复杂功能），见 [架构总览](../concepts/architecture.md#miniworkflow--两种声明式模板)
- `workflows[]`：用户自定义 MiniWorkflow，注册到 `WorkflowRegistry`

### `enabled_providers` / `disabled_providers`

显式启用 / 禁用 provider 集合。优先级高于"未配置 env 即不启用"的启发式。详见 [Providers](./providers.md)。

### `tool_permissions`

任务级 tool 权限默认值（与 `permission.tool` 区别：前者影响新建任务时的快照默认，后者是项目持久规则）。

### `terminal`

`terminal`：Workspace 外部终端 profile（命令、shell flag），用于"在系统终端打开 worktree"功能，详见 [Quickstart](../start/quickstart.md#workspace-与-terminal)。

## 配置加载顺序

1. 读 managed config（如有）
2. 读 `~/.opencorvus/config/opencorvus.json`
3. 读 `$OPENCORVUS_CONFIG_DIR/opencorvus.json`（若设置）
4. 读 `<repo>/.opencorvus/opencorvus.jsonc`
5. 合并 `OPENCORVUS_CONFIG_CONTENT` 环境变量（JSON 字符串）
6. CLI flag 覆盖

Env 快照时机：`Env.state()` 在实例创建时快照 `process.env`，因此 `.env` 文件必须在进程启动**前**加载。这是 benchmark 里要显式注入 env 的原因，详见 [Benchmark](../operations/benchmark.md)。

## 热重载与变更广播

`PATCH /config` 接受 JSON Merge Patch（RFC 7396），写入后通过 `Bus.publish("config.changed")` SSE 广播，所有 Overlay 实例自动 `setAppStore("config", newConfig)` 刷新。**Overlay 不再做 `GET → clone → mutate → PATCH` 全量替换**，只发 partial diff。

## 你接下来要看的

- [Providers](./providers.md)
- [Permissions](./permissions.md)
- [Acceptance 检查与判决](./evaluator.md)
- 完整 schema：[specs/new-arch/05-config.md](../../../specs/new-arch/05-config.md)
