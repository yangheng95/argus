# 08 — Agent Tool Adapter

> **状态（2026-05-12）**：核心 include/exclude 适配机制**已落地**（`Agent.Info.tools` schema +
> `ToolRegistry.tools(model, agent)` 过滤）。本文档若干细节仍为旧草稿，已在下方加注更正。
>
> 对应代码（真源）：`src/agent/agent.ts`（Agent.Info 注册） · `src/tool/registry.ts`
> （`tools(model, agent)` 过滤） · `src/session/loop.ts`（`resolveTools` 在 line 1732
> 附近——**没有** `src/session/tool-resolver.ts` 这个文件） · `src/orchestrator/tools.ts` ·
> `src/config/config.ts` · `src/mirror/`（`MIRROR_TOOL_IDS` 集合）
>
> **关键修正**：
> 1. `Agent.Info.tools` schema 是 `z.object({ include?: string[], exclude?: string[] }).optional()`，
>    include 与 exclude **同时可选并存**（不是 union；下文 §Agent.Info 的草稿写法不准确）。
> 2. `spec_enter` / `spec_exit` / `plan_enter` / `plan_exit` 这四个 tool **从未在代码里
>    存在**——下文 §各 native agent 工具声明 / §Build 快速通道里用到这些名字的行均为
>    早期草稿，不要照抄。spec / plan 这两个 native agent 也不存在。
> 3. 实际 build agent 的 `exclude` 集合（`agent.ts:125`）是
>    `["panel", "task_report", "analytics", ...MIRROR_TOOL_IDS]`——无 `planner` / `tui`。
> 4. 实际 general agent 的 `exclude`（`agent.ts:140`）是
>    `["planner", "panel", "task_report", "analytics", "todoread", "todowrite", ...MIRROR_TOOL_IDS]`。
> 5. 实际 explore agent 的 `include`（`agent.ts:157`）是
>    `["read", "glob", "search_code", "bash", "external_code_search", "lsp", "webfetch", "memory"]`
>    ——下文里写的 `grep` / `codesearch` 都已重命名为 `search_code` / `external_code_search`。
> 6. 实际 delivery agent（`agent.ts:233`）用 `tools: { include: [] }` 空白名单，
>    review/output tools 由 `DeliveryAgent.verify` 通过 SessionLoop extra tools 在运行时注入。
> 7. `requirements` / `architect` / `design-analyst` / `intent-analysis` / `integrity`
>    / `prosecutor` 等 stage agent **走** ToolRegistry（在 `agent.ts:316+` 注册，全部是
>    `mode: "primary" + hidden: true` 的 native），不属于"不走 ToolRegistry"那一类。
>    `integrity` / `prosecutor` 的 verdict / counter-example 工具是运行时通过 SessionLoop
>    extra tools 注入（registry `include: []` 故意留空——见 `agent.ts:382-405` 注释）。真正
>    "不走 ToolRegistry"的只有 orchestrator tools 内部自建工具集（`build` / `deliver` 等
>    tool 内部创建子 session 时手动组装）。
> 8. `task` / `planner` agent 不存在——`task` 是个 tool（`src/tool/task.ts`），
>    `planner` agent 已随 `src/planner/` 删除。
> 9. `orchestrator` 自己也走 ToolRegistry（`agent.ts:243`，`tools.include` 列出 dispatch /
>    observation / bookkeeping 三类约 30 个 tool id；见 §6 通信白名单与 11 spec 第五章）。
> 10. design-analyst 是 mirror 工具的**唯一**消费者（`tool/registry.ts:181` 显式跳过
>     `isMirrorToolId` 过滤）；其他 agent 的 registry 视图先剔除 `MIRROR_TOOL_IDS` 再做
>     include/exclude。本文 §各 native agent 工具声明表里 `MIRROR_TOOL_IDS` 没显式列出，
>     默认所有非 design-analyst agent 都看不到 mirror tools，与表格行为一致。

## 问题

所有 agent 共享同一个全局 `ToolRegistry.tools()` — 不区分调用者。
build agent 在 orchestrator 快速通道里拿到 `task` 工具后无限套娃调 sub-agent。
spec/plan agent 靠 permission deny 拦工具，但 LLM 仍能看到被 deny 的工具定义（浪费 token、诱导误调）。
`SessionPrompt.prompt({ tools })` 语义矛盾：session 层是 denylist，message 层是 allowlist。

## 设计

每个 agent 声明自己的工具集。`ToolRegistry.tools()` 按 agent 声明过滤，LLM 只看到该 agent 的工具。

### Agent.Info 新增字段

```typescript
// agent/agent.ts — Agent.Info schema
tools: z.union([
  z.object({ include: z.array(z.string()) }),
  z.object({ exclude: z.array(z.string()) }),
]).optional()
```

- `{ include: [...] }` — 白名单，只有列出的工具可见
- `{ exclude: [...] }` — 黑名单，列出的工具不可见，其余可见
- `undefined` — 全量（向后兼容自定义 agent）
- include 和 exclude 互斥，不共存

### ToolRegistry.tools() 过滤

```typescript
// tool/registry.ts — tools() 函数
export async function tools(model, agent?) {
  let items = await all()

  // Agent tool adapter: 按 agent 声明过滤
  if (agent?.tools) {
    if ('include' in agent.tools) {
      const set = new Set(agent.tools.include)
      items = items.filter(t => set.has(t.id))
    } else if ('exclude' in agent.tools) {
      const set = new Set(agent.tools.exclude)
      items = items.filter(t => !set.has(t.id))
    }
  }

  // 现有 model 级过滤 (apply_patch vs edit/write) 不动
  return items.filter(t => { ... }).map(...)
}
```

### 各 native agent 的工具声明

| Agent | 模式 | 声明 | 理由 |
|---|---|---|---|
| build | exclude | `["planner", "panel", "tui", "task_report", "analytics"]` | 交互模式需要大部分工具，排除 orchestrator 专用的；`goal_report` 对 build 开放，它就是 goal executor |
| spec | include | `["read", "glob", "grep", "codesearch", "lsp", "question", "spec_exit", "task", "memory", "webfetch", "websearch"]` | 只读 + 规格相关 |
| plan | include | `["read", "glob", "grep", "codesearch", "lsp", "question", "plan_exit", "task", "memory", "webfetch", "websearch"]` | 只读 + 计划相关 |
| explore | include | `["read", "glob", "grep", "bash", "codesearch", "lsp", "webfetch", "memory"]` | 搜索专用 |
| general | exclude | `["planner", "panel", "tui", "task_report", "analytics", "plan_enter", "plan_exit", "spec_enter", "spec_exit"]` | 通用但不进入 spec/plan 模式；`goal_report` 暂不排除（非 goal executor 也不会主动调用，调用则被 extractGoalReport 按 session 过滤） |
| compaction | include | `[]` | 无工具 |
| title | include | `[]` | 无工具 |
| summary | include | `[]` | 无工具 |
| evaluator | include | `["read", "glob", "grep", "bash", "codesearch", "question"]` | 只读 + 验证命令 |
| delivery | exclude | `["task", "plan_enter", "plan_exit", "spec_enter", "spec_exit", "planner", "panel", "tui", "task_report", "goal_report", "analytics"]` | 完整编码能力，无 orchestration；排除 `goal_report` — delivery 是 adversarial evaluator，不产出 goal report |
| requirements | — | 不走 ToolRegistry（orchestrator/tools.ts 自建） | |
| architect | — | 不走 ToolRegistry（orchestrator/tools.ts 自建） | |
| planner | — | 不走 ToolRegistry（orchestrator/tools.ts 自建） | |
| task | — | 不走 ToolRegistry（orchestrator/tools.ts 自建） | |

### Build 快速通道（orchestrator build tool）

orchestrator 的 `build` tool 创建 session 时注入 session 级 deny，覆盖 build agent 的默认声明：

```typescript
// orchestrator/tools.ts — build tool
const buildSession = await Session.createNext({
  parentID: input.agentSessionID,
  title: `Build: ${task.title}`,
  directory: Instance.directory,
  permission: [
    { permission: "task", pattern: "*", action: "deny" },
    { permission: "plan_enter", pattern: "*", action: "deny" },
    { permission: "spec_enter", pattern: "*", action: "deny" },
  ],
})
```

`resolveTools` 合并 agent.tools + session.permission 决定最终工具集：

```typescript
// 过滤顺序：
// 1. ToolRegistry.tools(model, agent) — agent adapter 过滤
// 2. session.permission deny 规则 — 进一步剔除
```

### Config.Agent 同步

```typescript
// config/config.ts — Config.Agent schema
tools: z.union([
  z.object({ include: z.array(z.string()) }),
  z.object({ exclude: z.array(z.string()) }),
]).optional()
```

用户自定义 agent 时可声明工具集：

```jsonc
// opencorvus.jsonc
{
  "agent": {
    "my-reviewer": {
      "description": "Code review agent",
      "mode": "subagent",
      "tools": { "include": ["read", "glob", "grep", "bash"] }
    }
  }
}
```

### 修复 SessionPrompt.prompt({ tools }) 语义

当前 `tools` 参数有双重行为：
1. 转为 session permission deny 规则（denylist 语义）
2. 存到 `Message.User.tools` → `resolveTools` 当 allowlist 过滤

两者矛盾。修复：

- `SessionPrompt.prompt({ tools })` 只走 session permission 路径（deny 规则）
- `resolveTools` 检查 session permission deny 规则来剔除工具（不再读 `lastUser.tools`）
- `Message.User.tools` 字段保留但不再用于工具过滤（向后兼容存储）

## 改动清单

| 文件 | 改动 |
|---|---|
| `agent/agent.ts` | `Agent.Info` 加 `tools` 字段；各 native agent 声明工具集 |
| `config/config.ts` | `Config.Agent` 加 `tools` 字段 |
| `tool/registry.ts` | `tools()` 加 agent adapter 过滤 |
| `session/loop.ts` | `resolveTools` 用 session.permission deny 代替 `lastUser.tools` allowlist |
| `session/tool-resolver.ts` | 同上（如果此文件的 resolveTools 有调用方） |
| `orchestrator/tools.ts` | build tool 创建 session 时注入 deny 规则 |

## 不动的

- `orchestrator/tools.ts` 的 orchestrator 工具（requirements / architect / planner 等）—— 它们不走 ToolRegistry，已经是独立构建的
- `PermissionNext` 基础设施 —— 复用现有 deny/allow/ask 语义
- agent prompt 内容 —— 工具不可见后，prompt 中 "use the Task tool" 之类的指示自然失效，无需改 prompt

## 验证

1. build 交互模式：`task` 工具可见、可调用
2. build 快速通道（orchestrator）：`task` 工具不可见、LLM 不会尝试调用
3. spec agent：只有 include 列表中的工具可见
4. 自定义 agent（config）：`tools` 声明生效
5. 无 `tools` 声明的自定义 agent：全量工具（向后兼容）
