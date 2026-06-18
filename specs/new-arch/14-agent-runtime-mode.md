# 14 — Agent Runtime Mode 抽象修正

> 状态：方案 / 未落地实现。
>
> 本文修正 [11-agent-oop-protocol.md](11-agent-oop-protocol.md) 中把 agent 按
> `SessionAgent` / `PipelineAgent` 二分的做法。该二分描述了当前执行器分流，
> 但不是更好的业务抽象。未来实现应当保留单一 agent 身份模型，只把运行方式
> 抽象为 runtime mode。
>
> 对应代码（现状真源，2026-05-12）：
> `src/agent/agent.ts` · `src/agent/runner.ts`（旧 `src/agent/runtime/runtime.ts` 已删，
> 现统一为 `runAgentSession`） · `src/session/loop.ts` · `src/session/compaction.ts` ·
> `src/session/llm.ts` · `src/orchestrator/agent.ts`
>
> 注：`ProviderLLM.stream` 已从 `src/provider/llm.ts` 移除，该文件仅保留 `wrapModel` /
> `baseHeaders`。下文 §1 描述的"双执行路径"在 phase-3-d 后已收口到单一 `runAgentSession`，
> 本文剩余价值在于 spec / runtime / context / budget 四层语义切分本身。

---

## 一、问题定义

当前仓库里存在两条不同的执行路径：

1. `SessionPrompt` / `SessionLoop` / `SessionProcessor`
2. `AgentRuntime.run` / `ProviderLLM.stream`

这两条路径在实现上差异很大，于是 2026-04 的 OOP 文档把 agent 进一步命名为：

- `SessionAgent`
- `PipelineAgent`

这个命名解决了“如何包裹现有代码”的问题，但也引入了新的抽象泄漏：

| 问题                           | 当前后果                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| 把执行方式抬成 agent 身份      | `acceptance` / `architect` / `requirements` 被当作另一类 agent，而不是同一种 agent 的另一种运行模式 |
| `Agent.Info` 混入 runtime 细节 | `permission`、`steps`、`compaction` 可读性下降，配置边界不清晰                                      |
| 上下文来源与 agent 概念耦合    | transcript 累积与 DB 派生状态被误解为“不同 agent”而不是“不同 context strategy”                      |
| compaction 语义失真            | session checkpoint summary 与 episodic pre-run budget control 被混称为 compact                      |

结论：

> 现状中的 `session agent / stage agent`、`SessionAgent / PipelineAgent` 只是执行器分流，
> 不是目标架构里最好的 agent 抽象。

---

## 二、设计目标

新抽象必须满足以下要求：

1. **单一 agent 身份**：agent 只表达“能力和契约”，不表达“今天怎么执行”。
2. **执行方式外置**：interactive / episodic 是 runtime mode，不是 agent kind。
3. **上下文策略外置**：transcript 累积与 derived-state 重建必须单独建模。
4. **预算策略外置**：compaction / prompt reduction 必须依附 runtime + context，而不是挂在 agent 身份上。
5. **无双源定义**：agent registry、runtime policy、context policy 各有唯一职责，不允许一份信息出现在两处。

---

## 三、核心抽象

### 3.1 `AgentSpec`

`AgentSpec` 是唯一的 agent 身份模型。

它只回答 3 个问题：

1. 这个 agent 是谁
2. 它接收什么输入，产出什么输出
3. 它具备哪些工具和 prompt contract

```ts
interface AgentSpec<TIn, TOut> {
  id: string
  displayName: string
  description: string

  inputSchema: TIn
  outputSchema: TOut

  systemPrompt: PromptSource
  toolContract: ToolContract
  modelHint?: ModelRef
}
```

`AgentSpec` 中**禁止**出现以下字段：

- `runtimeMode`
- `permission`
- `compaction`
- `waitForUser`
- `contextSource`

这些都不是 agent 身份，而是执行时策略。

### 3.2 `RuntimeMode`

`RuntimeMode` 描述一次调用如何执行。

```ts
type RuntimeMode = "interactive" | "episodic"
```

语义如下：

- `interactive`
  适用于多轮对话、可等待用户、可恢复继续执行的流。
  现状对应：`SessionPrompt` / `SessionLoop`。
- `episodic`
  适用于一次构造 prompt、一次 stream、结束即完成的流。
  现状对应：`AgentRuntime.run`。

`RuntimeMode` 是执行器选择键，不是 agent 分类键。

### 3.3 `ContextStrategy`

`ContextStrategy` 描述提示词上下文从哪里来。

```ts
type ContextStrategy =
  | { kind: "transcript" }
  | { kind: "derived-state" }
  | { kind: "hybrid"; primary: "derived-state" | "transcript" }
```

语义如下：

- `transcript`
  从消息链累积上下文。适用于 build/general/explore 这类真实会话。
- `derived-state`
  每次从 DB/engine state 渲染上下文。适用于 orchestrator、requirements、architect、acceptance。
- `hybrid`
  保留扩展位，供未来“有派生状态，也允许 operator 追问继续”的 agent 使用。

### 3.4 `BudgetPolicy`

`BudgetPolicy` 描述 token 预算接近上限时的行为。

```ts
type BudgetPolicy = { kind: "checkpoint-summary" } | { kind: "pre-run-reduction" } | { kind: "epoch-restart" }
```

语义如下：

- `checkpoint-summary`
  只适用于 `interactive + transcript`。现状对应 `SessionCompaction`。
- `pre-run-reduction`
  适用于 `episodic + derived-state`。在调用模型前压缩 prompt block，
  不允许 mid-stream 裁剪。
- `epoch-restart`
  适用于超长 episodic agent。结束当前 run，产出结构化 summary，
  再以下一轮 run 继续。它是协议级续跑，而不是偷偷删上下文。

---

## 四、组合关系

目标架构中，agent 运行不再通过“agent 是哪一类”来决定，而是通过显式的 execution plan 组合：

```ts
interface AgentExecutionPlan {
  agent: AgentSpec<any, any>
  runtime: RuntimeMode
  context: ContextStrategy
  budget: BudgetPolicy
  permission: PermissionPolicy
}
```

解释：

- `agent` 负责身份、schema、tool contract
- `runtime` 负责 interactive/episodic 执行器选择
- `context` 负责 prompt 来源
- `budget` 负责预算逼近时的处理方式
- `permission` 负责 tool gating

这 5 者各自单一职责，禁止互相借位。

---

## 五、现状映射

### 5.1 现有 interactive 类调用

| 现状                            | 推荐建模                                                    |
| ------------------------------- | ----------------------------------------------------------- |
| `build` / `general` / `explore` | `AgentSpec + interactive + transcript + checkpoint-summary` |
| `compaction` / `title`          | internal helper agent，不作为一类 agent 暴露                |

### 5.2 现有 episodic 类调用

| 现状                    | 推荐建模                                                   |
| ----------------------- | ---------------------------------------------------------- |
| `orchestrator`          | `AgentSpec + episodic + derived-state + pre-run-reduction` |
| `requirements`          | `AgentSpec + episodic + derived-state + pre-run-reduction` |
| `architect`             | `AgentSpec + episodic + derived-state + pre-run-reduction` |
| `frontend-design`       | `AgentSpec + episodic + derived-state + pre-run-reduction` |
| `intent-analysis`       | `AgentSpec + episodic + derived-state + pre-run-reduction` |
| `integrity`             | `AgentSpec + episodic + derived-state + pre-run-reduction` |
| `visual-qa`             | `AgentSpec + episodic + derived-state + pre-run-reduction` |
| `fact-check`            | `AgentSpec + episodic + derived-state + pre-run-reduction` |
| `deep-research`         | `AgentSpec + episodic + derived-state + pre-run-reduction` |
| `frontend-research`     | `AgentSpec + episodic + derived-state + pre-run-reduction` |
| `goal-workload-analyst` | `AgentSpec + episodic + derived-state + pre-run-reduction` |
| `summary`               | `AgentSpec + episodic + derived-state + pre-run-reduction` |

> 注：`planner` 已不在表中——the removed planning package 整目录已删除，相关 episodic 调用并入
> orchestrator 自身的 LLM 推理（详见 [01-agents.md](01-agents.md) 与
> [11-agent-oop-protocol.md](11-agent-oop-protocol.md)）。

注意：这里的“derived-state”不是说它们完全不写 session，而是说**LLM 的输入真源**不是 session transcript。
现状里 orchestrator 已明确如此：每个 task root 下只有一个持久 orchestrator child session 承载真实 wake 消息与 UI/audit persistence，真正 prompt 每次仍从 DB state 重建。

---

## 六、对当前代码的修正规则

### 6.1 `Agent.Info` 不再承担 runtime 分类

当前 `src/agent/agent.ts` 把 agent 注册与 runtime 说明混在一起，甚至用注释显式区分
“SessionProcessor / SessionPrompt flow” 与 “Stage agents dispatched through AgentRuntime”。

未来应改为：

1. `Agent.Info` 只保留 `AgentSpec` 语义字段
2. runtime 相关字段迁移到 `ExecutionPlan` / `RuntimePolicy`
3. 注释和配置项统一改称 `interactive` / `episodic`

### 6.2 `permission` 移出 agent 身份层

当前 `permission` 字段在 session 路径和 AgentRuntime 路径语义不一致。

未来应改为：

- `permission` 归属 runtime policy
- interactive runtime 走 session tool gate
- episodic runtime 走 AgentRuntime tool gate

同一个 agent 在不同 runtime mode 下可以选择不同 permission profile，
不需要复制成两种 agent。

### 6.3 compaction 改称 budget policy

当前 “compact” 一词已经混合了两种完全不同的事情：

1. transcript checkpoint summary
2. episodic prompt 预算控制

未来命名规则：

- transcript 路径继续叫 `compaction`
- episodic 路径一律叫 `prompt reduction` 或 `budget reduction`
- 禁止把 episodic 的 pre-run 裁剪实现为 mid-stream prune

原因很简单：sub-agent stream 历来不允许 mid-run context pruning（已删除的 `ProviderLLM.stream` 的旧
注释记录过这一约束；现在统一走 `LLM.stream` / `SessionLoop`，约束本身未变）。

---

## 七、推荐的最小落地方案

### 阶段 1：术语收口

目标：先消灭错误抽象，不急着重构执行器。

变更：

1. 文档中不再把 `SessionAgent / PipelineAgent` 当作最终 agent 分类
2. 统一改称 `runtime mode: interactive | episodic`
3. `stage agent` 仅作为“现状实现别名”保留，不作为目标术语

### 阶段 2：类型拆分

目标：把 agent 身份与执行策略解耦。

变更：

1. 新建 `AgentSpec`
2. 新建 `AgentExecutionPlan`
3. `src/agent/agent.ts` 从“注册 + runtime 说明”拆成“spec registry + runtime policy registry”

### 阶段 3：episodic 预算控制

目标：给 requirements / architect / acceptance / orchestrator 一套正确的自动预算策略。

变更：

1. 在 `AgentRuntime.run` 之前插入 prompt budget estimation
2. 对大块 derived-state context 做 pre-run reduction
3. 如需超长执行，采用 epoch restart，而不是 mid-stream prune

### 阶段 4：统一 config 语义

目标：让配置也遵循单一职责。

变更：

1. `agent.<id>` 只描述 agent 本体
2. `runtime.interactive` / `runtime.episodic` 描述执行器策略
3. `budget.*` 描述预算控制策略

---

## 八、非目标

本文**不**要求立即做以下改动：

1. 不要求现在统一成单一执行器
2. 不要求删除 `SessionLoop` 或 `AgentRuntime`
3. 不要求一次性重写全部 agent 注册
4. 不要求引入 fallback 或兼容双写

现阶段只要求先统一抽象语言和边界，避免继续在错误概念上扩展功能。

---

## 九、最终结论

更好的抽象不是：

- `session agent`
- `stage agent`
- `SessionAgent`
- `PipelineAgent`

更好的抽象是：

> **Agent 是能力单元；Runtime 是执行单元；Context 是提示词来源；BudgetPolicy 是预算策略。**

只有这 4 层分开，后续的 permission、compact、resume、derived-state prompt、
multi-run continuation 才不会继续互相污染。
