
# 架构审查报告 — OpenCorvus

---

## 🔴 高严重性问题

### 1. God File: `orchestrator/model.ts`
**文件规模**：796 行  
**问题**：5 种职责混于一体

一个文件同时承担：

- 领域实体 schema（Task / Run / Goal / Evaluation…）
- HTTP 输入验证 schema（CreateTaskInput / ReplyInteractionInput…）
- UI ViewModel（TaskBoard / TaskBoardCard / ProjectBoard…）
- 配置 schema（CheckConfig / Budget / StageRouting）
- 20+ Bus 事件定义

**问题说明**：

- `evaluator/service.ts` 为了使用 `CheckConfig` 必须 import 整个 `TaskBoard` UI 类型图。
- 每次修改 Bus 事件都会改动核心领域类型。
- 形成典型 **Big Ball of Mud 汇聚点**。

---

### 2. 跨层耦合（DIP 违反）
**依赖链**

```
orchestrator/goal-runner.ts
      ↓
evaluator/service.ts
      ↓
@/orchestrator/model
```

**问题**

Evaluator 是独立的质检层，却 **反向依赖 Orchestrator 的领域模型**：

- `CheckConfig`
- `EvaluationCheck`

**正确依赖方向应该是：**

```
Orchestrator → Evaluator
```

而不是

```
Evaluator → Orchestrator
```

**其他类似问题**

`evaluator/agent.ts` 和 `spec/agent.ts` 都直接 import：

```
@/planner/tools/createPlannerTools
```

导致 **三个独立 Agent 层通过工具定义文件形成横向耦合**。

---

### 3. `orchestrator/store.ts` 数据层越权访问 Instance 单例

```ts
// store.ts 第648行
eq(OrchestratorTaskTable.project_id, Instance.project.id)
```

**问题**

数据访问层直接读取全局 `Instance` 单例。

导致：

- 同一个 `findTask()` 在不同项目上下文下行为不同
- 无法显式传入 `projectId`
- 多租户 / 多项目场景 **结构性不可能实现**

---

### 4. JSON 修复逻辑重复实现

在两个位置各自实现：

- `planner/agent.ts`
- `evaluator/agent.ts`

重复逻辑：

- `repairTruncatedJSON()` — 括号计数状态机
- `sanitizeJSON()` — 转义序列规范化
- `extractJSON()` — fenced block 提取 + fallback 链

**问题**

两份几乎相同的代码。

- 修复 bug 只会修一处
- 另一处 **永久携带相同 bug**

---

### 5. Timeout 模式重复实现

示例：

```ts
const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), timeoutMs)

let planTimeout: ReturnType<typeof setTimeout>

const agentResult = await Promise.race([
  PlannerAgent.plan(...).finally(() => clearTimeout(planTimeout)),
  new Promise<never>((_, reject) => {
    planTimeout = setTimeout(...)
  })
]).finally(() => {
  clearTimeout(timer)
  controller.abort()
})
```

重复位置：

- `planner/service.ts` → `plan()`
- `planner/service.ts` → `replan()`
- `spec/service.ts`

但 **`llm/api.ts` 已经提供带 retry/timeout 的 `call()`**。

Agent Service 层没有复用。

---

## 🟡 中严重性问题

### 6. `workbench/board.ts` 四合一模块（1200 行）

同时承担：

- 查询引擎
- View Builder
- 业务逻辑
- 缓存系统

具体表现：

- `buildBoard()` 发出 **14+ SQLite 查询**
- `boardTagForTask()` 为计算缓存 key 又执行 **15 次查询**
- `boardOverview()` 包含 **115 行条件业务逻辑**
- ViewModel mapping 直接内联在查询循环中

属于 **Repository + ViewModel Builder + Business Logic + Cache 的混合体**。

---

### 7. `planner/service.ts` 职责混杂（1012 行）

同时包含：

- `preAnalyzeRequest()` — 90 行正则静态分析
- `renderAgentPrompt()` / `renderReplanPrompt()` — Prompt 模板引擎
- `heuristicClarification()` — NLP 启发式检测
- `inferSelectors()` — check selector 推断
- `buildWorkflowSection()` / `resolveStages()` — 策略路由逻辑

一个 Service 文件同时扮演：

- 静态分析器
- Prompt 模板引擎
- NLP 分类器
- 路由器

---

### 8. `metadata: Record<string, unknown>` 无类型数据袋

示例：

```ts
const context = dict(run.metadata?.retry_context)
const files = strings(context.changedFiles)
```

```ts
const value = row?.metadata?.queue_task_id
return typeof value === "string" && value ? value : undefined
```

**问题**

结构化字段放入无类型 JSON：

- `retry_context`
- `queue_task_id`
- `previous_run_id`
- `changedFiles`

跨越

```
Orchestrator → Executor → Evaluator
```

整个数据流 **无法静态类型检查**。

---

### 9. 全局 `Instance` 单例滥用

被 **10+ 模块直接访问**：

- store.ts
- goal-runner.ts
- evaluator/agent.ts
- planner/agent.ts
- planner/service.ts
- spec/agent.ts
- agent/agent.ts
- session/llm.ts
- session/system.ts
- workbench/board.ts

影响：

- 单元测试需要 mock 全局
- 多项目架构几乎不可实现

---

### 10. Namespace 与函数风格混用

| 模式 | 使用模块 |
|-----|-----|
| `export namespace` | OrchestratorService, EvaluatorAgent, HeadlessPlannerService, WorkbenchService, ControlMessage, Flag, Config |
| 纯函数 `export function` | store.ts, goal-scheduler.ts, state.ts, checks.ts, llm/api.ts |
| 静态对象 | ManagedCodingExecutor = `{ create() }` |

问题：

- Namespace **阻止 tree-shaking**
- import 语法不统一
- 风格混乱

---

## 🔵 低严重性 / 设计异味

### 11. `workbench/service.ts` 零价值 Facade

```ts
export namespace WorkbenchService {
  export const taskNotes = _taskNotes
  export const preferences = _preferences
  export const compileBoard = _compileBoard
}
```

22 行纯转发代码：

- 无逻辑
- 无封装
- 无抽象

仅增加 import 路径层级。

---

### 12. `flag/flag.ts` 使用 `declare` 绕过类型系统

```ts
export declare const OPENCORVUS_DISABLE_CLAUDE_CODE: boolean
```

运行时实际实现：

```ts
Object.defineProperty(Flag, "OPENCORVUS_DISABLE_CLAUDE_CODE", {
  get: () => ...
})
```

问题：

TypeScript 认为它是 **普通 boolean 常量**，

但实际上是 **运行时 getter**。

正确方式：

```ts
export function isClaudeCodeDisabled(): boolean
```

---

### 13. Goal 类型四处定义

| 位置 | 类型 |
|-----|-----|
| orchestrator/model.ts | GoalInput |
| orchestrator/store.ts | GoalRow |
| spec/agent.ts | SpecGoalSchema |
| evaluator/agent.ts | GoalInfo |

问题：

- 四种 Goal 定义
- 无正式 mapping 函数
- 字段重命名需修改 **4 个位置**

---

# 架构问题统计

| 类别 | 严重性 | 数量 |
|-----|-----|-----|
| God File / God Object | 🔴 | 4 |
| SRP 违反 | 🔴 | 6 |
| DIP 方向错误 | 🔴 | 3 |
| 重复逻辑 | 🔴 | 2 |
| 无类型 metadata 袋 | 🟡 | 1（但贯穿系统） |
| Instance 单例滥用 | 🟡 | 10+ |
| Namespace / 函数模式混乱 | 🟡 | 全库 |
| 零价值 Facade | 🔵 | 1 |
| Flag 类型绕过 | 🔵 | 1 |
| Goal 类型散落 | 🔵 | 1 |

---

# 优先解决建议

最需要优先解决的两件事：

### 1️⃣ 拆分 `orchestrator/model.ts`

将以下内容拆分为独立模块：

- Bus 事件定义
- UI ViewModel
- Check 类型
- Domain 实体
- API 输入 schema

目标：**消除全局耦合汇聚点**。

---

### 2️⃣ 抽取通用工具

统一抽取：

- JSON 修复工具
- Timeout 工具
- LLM 调用工具

防止多处实现导致 **bug 分叉演化**。

---
