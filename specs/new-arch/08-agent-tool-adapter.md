# 08 — Agent Tool Adapter

> **状态（2026-05-12）**：核心 include/exclude 适配机制**已落地**（`Agent.Info.tools` schema +
> `ToolRegistry.tools(model, agent)` 过滤）。本文档若干细节仍为旧草稿，已在下方加注更正。
>
> 对应代码（真源）：`src/agent/agent.ts`（Agent.Info 注册） · `src/tool/registry.ts`
> （`tools(model, agent)` 过滤） · `src/session/loop.ts`（`resolveTools` 在 line 1732
> 附近——**没有** `src/session/tool-resolver.ts` 这个文件） · `src/orchestrator/tools.ts` ·
> `src/config/config.ts` · `src/frontend-design/tools/`（`WEBPAGE_EVIDENCE_TOOL_IDS` 集合）
>
> **关键修正**：
>
> 1. `Agent.Info.tools` schema 是 `z.object({ include?: string[], exclude?: string[] }).optional()`，
>    include 与 exclude **同时可选并存**（不是 union；下文 §Agent.Info 的草稿写法不准确）。
> 2. `spec_enter` / `spec_exit` / `plan_enter` / `plan_exit` 这四个 tool **从未在代码里
>    存在**——下文 §各 native agent 工具声明 / §Build 快速通道里用到这些名字的行均为
>    早期草稿，不要照抄。spec / plan 这两个 native agent 也不存在。
> 3. 实际 build agent 的 `exclude` 集合（`agent.ts:125`）是
>    `["panel", "task_report", "analytics", ...WEBPAGE_EVIDENCE_TOOL_IDS]`——无 `planner` / `tui`。
> 4. 实际 general agent 的 `exclude`（`agent.ts:140`）是
>    `["planner", "panel", "task_report", "analytics", "todoread", "todowrite", ...WEBPAGE_EVIDENCE_TOOL_IDS]`。
> 5. 实际 explore agent 的 `include`（`agent.ts:157`）是
>    `["read", "glob", "search_code", "bash", "external_code_search", "lsp", "webfetch", "memory"]`
>    ——下文里写的 `grep` / `codesearch` 都已重命名为 `search_code` / `external_code_search`。
> 6. 旧 acceptance review agent / `deliver` 路径已退役；最终验收由 `integrity` agent
>    通过运行时注入的 review/output tools 完成。
> 7. `requirements` / `architect` / `frontend-design` / `intent-analysis` / `integrity`
>    等 stage agent **走** ToolRegistry（在 `agent.ts:316+` 注册，全部是
>    `mode: "primary" + hidden: true` 的 native），不属于"不走 ToolRegistry"那一类。
>    `integrity` 的 review/output tools 是运行时通过 SessionLoop extra tools 注入。真正
>    "不走 ToolRegistry"的只有 orchestrator tools 内部自建工具集（`build` / `integrity` / `visual_qa` 等
>    tool 内部创建子 session 时手动组装）。
> 8. `task` / `planner` agent 不存在——`task` 是个 tool（`src/tool/task.ts`），
>    `planner` agent 已随 the removed planning package 删除。
> 9. `orchestrator` 自己也走 ToolRegistry（`agent.ts:243`，`tools.include` 列出 dispatch /
>    observation / bookkeeping 三类约 30 个 tool id；见 §6 通信白名单与 11 spec 第五章）。
> 10. frontend-design 是网页证据工具的**唯一**消费者（`tool/registry.ts:181` 显式跳过
>     `isWebpageEvidenceToolId` 过滤）；其他 agent 的 registry 视图先剔除 `WEBPAGE_EVIDENCE_TOOL_IDS` 再做
>     include/exclude。本文 §各 native agent 工具声明表里 `WEBPAGE_EVIDENCE_TOOL_IDS` 没显式列出，
>     默认所有非 frontend-design agent 都看不到 webpage evidence tools，与表格行为一致。

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
tools: z.union([z.object({ include: z.array(z.string()) }), z.object({ exclude: z.array(z.string()) })]).optional()
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

| Agent           | 模式    | 声明                                                                                                                                                      | 理由                                                                                                                       |
| --------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| coding          | exclude | `["panel", "task_report", "analytics", ...WEBPAGE_EVIDENCE_TOOL_IDS]`                                                                                     | 通用交互编码角色，**独立命名角色**（非 build 别名）；prompt = `agent/prompt/coding.txt`（`agent.ts:127`）                  |
| build           | exclude | `["panel", "task_report", "analytics", ...WEBPAGE_EVIDENCE_TOOL_IDS]`                                                                                     | goal executor，与 `coding` 同一 exclude 集合；orchestrator `build` tool 另注入 session 级 deny（见下节）（`agent.ts:142`） |
| general         | exclude | `["planner", "panel", "task_report", "analytics", "todoread", "todowrite", ...WEBPAGE_EVIDENCE_TOOL_IDS]`                                                 | 通用 sub-agent（`agent.ts:158`）                                                                                           |
| explore         | include | `["read", "glob", "search_code", "external_code_search", "lsp", "webfetch", "websearch", "panel", "memory"]`                                              | 只读调查 + panel 只读状态查询；默认不持有 `bash` / 写入工具                                                                |
| compaction      | include | `[]`                                                                                                                                                      | 无工具                                                                                                                     |
| title           | include | `[]`                                                                                                                                                      | 无工具                                                                                                                     |
| summary         | include | `[]`                                                                                                                                                      | 无工具                                                                                                                     |
| control         | include | `["panel"]`                                                                                                                                               | 仅 panel capability（`agent.ts:227`）                                                                                      |
| orchestrator    | include | dispatch / review / goal-control / task-control / observation / interaction / bookkeeping 共一组，含 `add_goal`、`modify_goal`、`cancel_subagent`、`wait` | include 列表是 agent 可见面；运行时的 workflow tools 由 `createOrchestratorTools()` 自建，少量通用工具来自 ToolRegistry    |
| requirements    | include | `["read_file", "find_files", "search_code", "list_directory", "memory_search", "memory_get", "skill", "todoread", "todowrite", "websearch"]`              | **走** ToolRegistry；允许 query search 验证当前框架/库事实，禁止 `webfetch`                                                |
| architect       | include | `["read_file", "find_files", "search_code", "list_directory", "memory_search", "memory_get", "skill", "todoread", "todowrite", "websearch"]`              | **走** ToolRegistry；允许 query search 验证当前技术事实，禁止 `webfetch`                                                   |
| frontend-design | include | `FRONTEND_DESIGN_STATIC_TOOL_IDS`（含 `skill`、`url_screenshot` 与 webpage render/evaluate evidence 工具）                                                | **走** ToolRegistry；由专用 evidence toolchain 获取视觉参考                                                                |
| intent-analysis | include | `["read_file", "find_files", "search_code", "list_directory", "memory_search", "memory_get", "skill", "todoread", "todowrite"]`                           | **走** ToolRegistry；第一层分类不做 web research                                                                           |
| integrity       | include | `["browser_preview"]`                                                                                                                                     | **走** ToolRegistry；专用 integrity team 的内部审查工具由 team runtime 注入                                                |

> 已删除的 agent 行（`spec` / `plan` / `planner` / `task` / `evaluator` / `prosecutor`）已从上表移除——这些 native agent 已在历次重构中删除或并入 integrity 团队，`agent.ts` 不再注册。`requirements` / `architect` / `frontend-design` / `intent-analysis` / `integrity` **均走 ToolRegistry**；orchestrator 的 workflow/control tools 由 `src/orchestrator/tools.ts::createOrchestratorTools()` 自建，`src/agent/agent.ts` 的 include 列表负责把这些工具暴露给 Orchestrator LLM。

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
tools: z.union([z.object({ include: z.array(z.string()) }), z.object({ exclude: z.array(z.string()) })]).optional()
```

用户自定义 agent 时可声明工具集：

```jsonc
// opencorvus.jsonc
{
  "agent": {
    "my-reviewer": {
      "description": "Code review agent",
      "mode": "subagent",
      "tools": { "include": ["read", "glob", "grep", "bash"] },
    },
  },
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

| 文件                           | 改动                                                                      |
| ------------------------------ | ------------------------------------------------------------------------- |
| `agent/agent.ts`               | `Agent.Info` 加 `tools` 字段；各 native agent 声明工具集                  |
| `config/config.ts`             | `Config.Agent` 加 `tools` 字段                                            |
| `tool/registry.ts`             | `tools()` 加 agent adapter 过滤                                           |
| `session/loop.ts`              | `resolveTools` 用 session.permission deny 代替 `lastUser.tools` allowlist |
| ~~`session/tool-resolver.ts`~~ | 已并入 `session/loop.ts` 的 `resolveTools()`，独立文件不存在              |
| `orchestrator/tools.ts`        | build tool 创建 session 时注入 deny 规则                                  |

## 不动的

- `orchestrator/tools.ts` 的 orchestrator **自建工具**（`requirements` / `architect` / `workload_analysis` / `build` / `visual_qa` / `integrity` / `add_goal` / `modify_goal` / `wait` 等 dispatch、observation、interaction、task-control tool）—— 这些不走普通 ToolRegistry，由 orchestrator tool 工厂独立构建；`src/agent/agent.ts` 的 orchestrator include 列表必须覆盖该工厂的全部工具。注意：`requirements` / `architect` / `frontend-design` / `intent-analysis` / `integrity` 同时也是 **native agent** 身份，走 ToolRegistry 只描述它们被单独唤醒时的自身工具集；`planner` / `prosecutor` agent 已删除；`deliver` / `publish_acceptance` 已退役。
- `PermissionNext` 基础设施 —— 复用现有 deny/allow/ask 语义
- agent prompt 内容 —— 工具不可见后，prompt 中 "use the Task tool" 之类的指示自然失效，无需改 prompt

## 验证

1. build 交互模式：`task` 工具可见、可调用
2. build 快速通道（orchestrator）：`task` 工具不可见、LLM 不会尝试调用
3. spec agent：只有 include 列表中的工具可见
4. 自定义 agent（config）：`tools` 声明生效
5. 无 `tools` 声明的自定义 agent：全量工具（向后兼容）
