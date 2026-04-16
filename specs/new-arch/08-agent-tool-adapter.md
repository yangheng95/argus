# 08 — Agent Tool Adapter

> 对应代码：`src/agent/agent.ts` · `src/tool/registry.ts` · `src/session/loop.ts` ·
> `src/task-agent/tools.ts` · `src/config/config.ts`

## 问题

所有 agent 共享同一个全局 `ToolRegistry.tools()` — 不区分调用者。
build agent 在 task-agent 快速通道里拿到 `task` 工具后无限套娃调 sub-agent。
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
| build | exclude | `["planner", "panel", "tui", "task_report", "analytics"]` | 交互模式需要大部分工具，排除 orchestrator 专用的 |
| spec | include | `["read", "glob", "grep", "codesearch", "lsp", "question", "spec_exit", "task", "memory", "webfetch", "websearch"]` | 只读 + 规格相关 |
| plan | include | `["read", "glob", "grep", "codesearch", "lsp", "question", "plan_exit", "task", "memory", "webfetch", "websearch"]` | 只读 + 计划相关 |
| explore | include | `["read", "glob", "grep", "bash", "codesearch", "lsp", "webfetch", "memory"]` | 搜索专用 |
| general | exclude | `["planner", "panel", "tui", "task_report", "analytics", "plan_enter", "plan_exit", "spec_enter", "spec_exit"]` | 通用但不进入 spec/plan 模式 |
| compaction | include | `[]` | 无工具 |
| title | include | `[]` | 无工具 |
| summary | include | `[]` | 无工具 |
| evaluator | include | `["read", "glob", "grep", "bash", "codesearch", "question"]` | 只读 + 验证命令 |
| delivery | exclude | `["task", "plan_enter", "plan_exit", "spec_enter", "spec_exit", "planner", "panel", "tui", "task_report", "analytics"]` | 完整编码能力，无 orchestration |
| requirements | — | 不走 ToolRegistry（task-agent/tools.ts 自建） | |
| architect | — | 不走 ToolRegistry（task-agent/tools.ts 自建） | |
| planner | — | 不走 ToolRegistry（task-agent/tools.ts 自建） | |
| task | — | 不走 ToolRegistry（task-agent/tools.ts 自建） | |

### Build 快速通道（task-agent build tool）

task-agent 的 `build` tool 创建 session 时注入 session 级 deny，覆盖 build agent 的默认声明：

```typescript
// task-agent/tools.ts — build tool
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
| `task-agent/tools.ts` | build tool 创建 session 时注入 deny 规则 |

## 不动的

- `task-agent/tools.ts` 的 orchestrator 工具（requirements / architect / planner 等）—— 它们不走 ToolRegistry，已经是独立构建的
- `PermissionNext` 基础设施 —— 复用现有 deny/allow/ask 语义
- agent prompt 内容 —— 工具不可见后，prompt 中 "use the Task tool" 之类的指示自然失效，无需改 prompt

## 验证

1. build 交互模式：`task` 工具可见、可调用
2. build 快速通道（task-agent）：`task` 工具不可见、LLM 不会尝试调用
3. spec agent：只有 include 列表中的工具可见
4. 自定义 agent（config）：`tools` 声明生效
5. 无 `tools` 声明的自定义 agent：全量工具（向后兼容）
