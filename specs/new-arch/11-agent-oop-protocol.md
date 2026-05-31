# 11 — Agent OOP 协议设计

> 状态：未来方案 / 部分落地（见下方 §实施进度）。
>
> 当前运行时并未实现本文中的 `BaseAgent`、`AgentRegistry`、`AgentMailbox`、
> 白名单点对点消息或统一 mailbox 协议。现行实现仍然以 orchestrator tool 调度、
> `task.design_specs` / `decision_log` 持久化、以及 per-stage session prompt 注入为准。
> 修改现网消息路径时，必须先以当前实现为真源，不得把本文当作已生效协议。
>
> **§实施进度（2026-05-18）**：`codex/agent-boundary-role-contract` 分支已落地**阶段一**：
> `packages/opencorvus/src/agent/role-contract.ts` 定义了 `AgentRoleContract` 接口（含
> `id`、`description`、`promptEditable`、`defaultPromptRequired`、`promptConfigMode` 等字段）
> 与 `AgentRoleID` 联合类型（覆盖全部 16 个 native agent 角色：`coding` · `build` · `general` ·
> `explore` · `compaction` · `title` · `summary` · `control` · `delivery` · `orchestrator` ·
> `requirements` · `architect` · `frontend-design` · `intent-analysis` · `integrity` · `prosecutor`）。
> OOP 继承体系（`BaseAgent` / `AgentMailbox` / `AgentRegistry`）及 mailbox 数据库表仍**待实现**。
>
> 抽象修正：本文把未来 agent 家族拆成 `PipelineAgent` / `SessionAgent`，这是对当前
> 执行器分流的直接映射，不是更好的最终抽象。关于“单一 AgentSpec + RuntimeMode /
> ContextStrategy / BudgetPolicy” 的修正方案，见 [14-agent-runtime-mode.md](14-agent-runtime-mode.md)。
> 对应代码（待实现）：`src/agent/base.ts` · `src/agent/registry.ts` · `src/agent/mailbox.ts` ·
> `src/agent/contract.ts` · `src/agent/prompt/` · `src/prompt/core/`
>
> 本文档定义全局统一的 Agent 抽象层。所有现有及新增 agent 必须继承此抽象，
> 禁止任何不符合本设计的 agent 实现。

---

## 一、为什么需要这个设计

当前 agent 家族存在以下结构性问题：

| 问题 | 现状 |
|---|---|
| 无统一基类 | 10 个 agent 各自独立，接口不统一，无法多态调用 |
| 系统 prompt 散乱 | Orchestrator、Delivery 使用内联字符串常量；其余用 `.txt` 文件；无统一管理 |
| 通信无协议 | orchestrator tools 直接调用子 agent 函数，无任何消息约束 |
| 无白名单声明 | 任何 tool 都可调任何 agent，通信关系隐式且不可查 |
| 无能力契约 | LLM 无法查询"某个 agent 能做什么、接收什么"，路由靠硬编码 |
| 无可视化管理 | prompt 只能改源码，无 UI 编辑入口 |

本设计用 OOP 抽象层解决上述问题，**不改变现有执行引擎**（`AgentRuntime.run` 保留），
仅在其上增加统一的类型边界、通信协议和注册机制。

---

## 二、核心抽象

### 2.1 `BaseAgent<TInbox, TOutbox>`

所有 agent 的抽象基类。封装邮箱、白名单检查、schema 验证、prompt 加载。

```typescript
// src/agent/base.ts

abstract class BaseAgent<
  TInbox extends z.ZodType,
  TOutbox extends z.ZodType
> {
  // ── 身份 ────────────────────────────────────────────────
  abstract readonly agentId: string;
  abstract readonly contract: CapabilityContract<TInbox, TOutbox>;

  // ── 邮箱 ────────────────────────────────────────────────
  readonly inbox:  AgentMailbox<z.infer<TInbox>>;
  readonly outbox: AgentMailbox<z.infer<TOutbox>>;

  // ── 抽象接口（子类必须实现）────────────────────────────
  /** 从 .txt 文件或 config override 加载 system prompt */
  protected abstract buildSystemPrompt(ctx: AgentContext): string;

  /** 核心执行逻辑，由子类用 AgentRuntime.run / SessionPrompt.prompt 实现 */
  protected abstract execute(
    input: z.infer<TInbox>,
    ctx: AgentContext
  ): Promise<z.infer<TOutbox>>;

  // ── 公开接口（外部唯一调用点）────────────────────────────
  /**
   * 向本 agent 发送消息。调用方必须在本 agent 的 receiveWhitelist 内。
   * 消息进入 inbox，schema 验证通过后触发 execute()，结果写入 outbox。
   */
  async receive(
    message: MailboxMessage<z.infer<TInbox>>,
    senderAgentId: string
  ): Promise<z.infer<TOutbox>>;

  /**
   * 向目标 agent 发送消息。目标必须在本 agent 的 sendWhitelist 内。
   * payload schema 验证通过后放入目标 agent 的 inbox。
   */
  protected async send(
    targetAgentId: string,
    payload: z.infer<TOutbox>
  ): Promise<void>;

  // ── 白名单查询 ──────────────────────────────────────────
  canReceiveFrom(agentId: string): boolean;
  canSendTo(agentId: string): boolean;
}
```

**封装原则**：
- 外部只能调用 `receive()`，禁止直接调用 `execute()` 或访问 `inbox`/`outbox`
- `send()` 是 `protected`，只有 agent 自身在 `execute()` 内部可以调用
- `buildSystemPrompt()` 是 `protected`，只有基类在组装 `AgentContext` 时调用

---

### 2.2 `CapabilityContract<TIn, TOut>`

每个 agent 的机器可读能力声明。注册到 `AgentRegistry`，供 LLM 查询做动态路由。

```typescript
// src/agent/contract.ts

interface CapabilityContract<TIn extends z.ZodType, TOut extends z.ZodType> {
  agentId:     string;
  displayName: string;
  description: string;            // 一句话：这个 agent 做什么

  inputSchema:  TIn;              // inbox 接收的消息 schema（Zod）
  outputSchema: TOut;             // outbox 产出的消息 schema（Zod）

  toolSet:      string[];         // agent 可调用的工具 ID 列表

  receiveWhitelist: string[];     // 哪些 agentId 可以向本 agent 发消息
  sendWhitelist:    string[];     // 本 agent 可以向哪些 agentId 发消息

  promptFile:   string;           // 相对于 src/ 的 .txt 文件路径
  configKey:    string;           // config.agent.<configKey>.prompt 覆盖键
}
```

**白名单语义**：
- `receiveWhitelist`：本 agent 的"可接收发件人"列表
- `sendWhitelist`：本 agent 的"可发送收件人"列表
- 两个 agent 之间的通信必须双方都在对方的对应白名单内
- 违反白名单 → 抛出 `AgentProtocolError`，禁止 fallback

---

### 2.3 `AgentMailbox<T>` / `MailboxMessage<T>`

邮箱是 agent 的收发件容器。每条消息有完整生命周期状态。

```typescript
// src/agent/mailbox.ts

type MessageStatus = "pending" | "processing" | "processed" | "failed";

interface MailboxMessage<T> {
  id:          string;          // nanoid
  from:        string;          // 发件人 agentId
  to:          string;          // 收件人 agentId
  payload:     T;               // 消息体（已通过 schema 验证）
  status:      MessageStatus;
  createdAt:   number;          // unix ms
  processedAt: number | null;
  traceId:     string;          // 关联到 engine_task / session
  error?:      string;          // 仅 status="failed" 时有值
}

class AgentMailbox<T> {
  readonly agentId: string;
  readonly kind: "inbox" | "outbox";

  enqueue(message: MailboxMessage<T>): void;
  dequeue(): MailboxMessage<T> | undefined;    // FIFO
  peek():    MailboxMessage<T> | undefined;
  markProcessing(id: string): void;
  markProcessed(id: string): void;
  markFailed(id: string, error: string): void;

  // 查询接口（供 config panel SSE 推送）
  list(filter?: { status?: MessageStatus }): MailboxMessage<T>[];
  recent(n: number): MailboxMessage<T>[];
}
```

**消息状态流转**：
```
enqueue → pending
  │
  └─ dequeue → processing
       │
       ├─ execute() 成功 → processed  （结果写入 outbox）
       └─ execute() 抛出 → failed     （error 记录，不重试，上抛给调用者）
```

**持久化**：邮箱消息写入 DB 表 `agent_mailbox_message`，字段对应上面结构。
inbox/outbox 各一张表（`kind` 列区分）。`traceId` 关联到 `engine_task.id`。

---

### 2.4 `AgentRegistry`

全局单例。管理所有 agent 实例和 CapabilityContract。
LLM 通过 `query_registry` 工具查询，做运行时动态路由。

```typescript
// src/agent/registry.ts

class AgentRegistry {
  // 注册 / 查询
  register(agent: BaseAgent<any, any>): void;
  get(agentId: string): BaseAgent<any, any>;        // 不存在则抛出
  getContract(agentId: string): CapabilityContract<any, any>;

  // LLM 可查询的快照（序列化为 JSON 传入 tool result）
  snapshot(): AgentRegistrySnapshot;

  // 白名单校验（BaseAgent.receive / send 内部调用）
  assertCanReceive(targetAgentId: string, senderAgentId: string): void;
  assertCanSend(senderAgentId: string, targetAgentId: string): void;
}

interface AgentRegistrySnapshot {
  agents: Array<{
    agentId:     string;
    displayName: string;
    description: string;
    inputSummary:  string;   // inputSchema 的一句话描述
    outputSummary: string;   // outputSchema 的一句话描述
    toolSet:     string[];
    receiveWhitelist: string[];
    sendWhitelist:    string[];
  }>;
}
```

---

## 三、继承层次

```
BaseAgent<TInbox, TOutbox>          (抽象基类)
├── PipelineAgent<TInbox, TOutbox>  (抽象，使用 AgentRuntime.run)
│   ├── RequirementsAgent           inbox: RequirementsInput   outbox: RequirementsResult
│   ├── ArchitectAgent              inbox: ArchitectInput      outbox: ArchitectResult
│   ├── FrontendDesignAgent          inbox: FrontendDesignInput  outbox: FrontendDesignResult
│   ├── DeliveryAgent               inbox: DeliveryInput       outbox: DeliveryVerdictType
│   ├── IntentAnalysisAgent         inbox: IntentInput         outbox: IntentAnalysisResult
│   ├── IntegrityAgent              inbox: IntegrityInput      outbox: IntegrityResult
│   ├── ProsecutorAgent             inbox: ProsecutorInput     outbox: ProsecutorResult
│   └── OrchestratorAgent           inbox: OrchestratorTrigger outbox: void
└── SessionAgent                    (抽象，使用 SessionPrompt.prompt)
    ├── BuildAgent                  inbox: BuildInput          outbox: BuildSummary
    ├── GeneralAgent                inbox: GeneralInput        outbox: GeneralSummary
    └── ExploreAgent                inbox: ExploreInput        outbox: ExploreSummary
```

> **注**：`PlannerAgent` 已从层次中移除——`src/planner/` 整目录已删除，planning
> 现由 architect contract + build agent 直接消费，不再独立成 agent。BuildAgent
> 同时存在 SessionAgent（用户交互态，见 `agent/agent.ts:122`）和 PipelineAgent
> （orchestrator build tool 自建子 session，见 `build/agent.ts`）两条路径，本表只
> 列前者；后者属于"不走 ToolRegistry"那类，见 [08-agent-tool-adapter.md](08-agent-tool-adapter.md)。

### `PipelineAgent` 抽象

```typescript
abstract class PipelineAgent<TIn extends z.ZodType, TOut extends z.ZodType>
  extends BaseAgent<TIn, TOut>
{
  // 通用 execute 框架：组装 system prompt → 调 AgentRuntime.run → 解析输出
  protected async execute(input: z.infer<TIn>, ctx: AgentContext): Promise<z.infer<TOut>> {
    const system = this.buildSystemPrompt(ctx);
    const tools  = filterAgentTools(this.contract.toolSet, this.agentId);
    const result = await AgentRuntime.run({ system, tools, input, ...ctx });
    return this.parseOutput(result);          // 子类实现
  }

  protected abstract parseOutput(raw: AgentRuntimeResult): z.infer<TOut>;
}
```

### `SessionAgent` 抽象

```typescript
abstract class SessionAgent<TIn extends z.ZodType, TOut extends z.ZodType>
  extends BaseAgent<TIn, TOut>
{
  protected async execute(input: z.infer<TIn>, ctx: AgentContext): Promise<z.infer<TOut>> {
    const system = this.buildSystemPrompt(ctx);
    const reply  = await SessionPrompt.prompt({ system, request: this.formatRequest(input), ...ctx });
    return this.parseOutput(reply);
  }

  protected abstract formatRequest(input: z.infer<TIn>): string;
  protected abstract parseOutput(reply: SessionReply): z.infer<TOut>;
}
```

---

## 四、System Prompt 管理

### 4.1 存储规范

**规则：所有 agent 的 system prompt 必须存储在 `.txt` 文件中，禁止内联字符串常量。**

| 目录 | 存放内容 |
|---|---|
| `src/agent/prompt/` | SessionAgent 的 prompt（实际盘上：`coding.txt` / `general.txt` / `explore.txt` / `compaction.txt` / `title.txt` / `judge.txt`，**无** `summary.txt`） |
| `src/prompt/core/` | PipelineAgent 的 prompt（实际盘上：`requirements-core.txt` / `architect-core.txt` / `delivery-core.txt` / `frontend-design-core.txt` / `intent-analysis-core.txt` / `orchestrator-core.txt` / `integrity-core.txt` / `prosecutor-core.txt` / `build-core.txt`——`build-core.txt` 服务于 `build/agent.ts` 这条 pipeline-agent 路径；direct interactive SessionAgent 路径使用 `agent/prompt/coding.txt`） |

**迁移状态（2026-05-12）**：
- ✅ `orchestrator/agent.ts:ORCHESTRATOR_INSTRUCTIONS` 已迁移：`= ORCHESTRATOR_CORE`（来自 `src/prompt/core/orchestrator-core.txt`，常量在 `orchestrator/agent.ts:642`）
- ✅ `delivery/agent.ts:DELIVERY_AGENT_SYSTEM` 已迁移：`= DELIVERY_CORE`（来自 `src/prompt/core/delivery-core.txt`，常量在 `delivery/agent.ts:494`）
- ⚠️ `planner-core.txt` 不再存在（`src/planner/` 整目录删除；planner-as-agent 概念已下线）

### 4.2 运行时分层（三级覆盖）

```
优先级 1（最高）：config.agent.<configKey>.prompt     # 项目级覆盖，写入 opencorvus.jsonc
优先级 2：        import from "@/prompt/core/*.txt"   # 源码内置默认
优先级 3（注入）：loadStageSkills(agentId)            # skills 追加到末尾
```

`buildSystemPrompt()` 基类默认实现：

```typescript
protected buildSystemPrompt(ctx: AgentContext): string {
  const override = Config.get().agent?.[this.contract.configKey]?.prompt;
  const base     = override ?? this.loadPromptFile();    // 读 .txt
  const skills   = loadStageSkills(this.agentId, ctx);
  return skills ? `${base}\n\n${skills}` : base;
}

private loadPromptFile(): string {
  // 编译时 import，运行时直接返回已加载的字符串
  return PROMPT_MAP[this.contract.promptFile];
}
```

### 4.3 Config Panel 集成

在 `07-panel.md` 的 **Agent Config** 区域新增 **System Prompts** 子面板：

```
▼ Agent Config
  ├ Requirements  max_steps:30  timeout:5min  [编辑 Prompt ▸]
  ├ Architect     max_steps:20  timeout:3min  [编辑 Prompt ▸]
  ├ Planner       max_steps:30  timeout:5min  [编辑 Prompt ▸]
  ├ Delivery      max_steps:40  timeout:10min [编辑 Prompt ▸]
  ├ Orchestrator  max_steps:20              [编辑 Prompt ▸]
  └ ...

  ── 点击 [编辑 Prompt ▸] 展开：──────────────────────────
  │  来源：src/prompt/core/requirements-core.txt          │
  │  ┌────────────────────────────────────────────────┐  │
  │  │  You are a requirements analyst...             │  │
  │  │  （可编辑 textarea）                            │  │
  │  └────────────────────────────────────────────────┘  │
  │  [恢复默认]  [保存为项目覆盖]                          │
  └──────────────────────────────────────────────────────
```

**保存路径**：
- **保存为项目覆盖** → `PATCH /config { agent: { requirements: { prompt: "..." } } }` → 写 `opencorvus.jsonc`，下次运行生效（不修改 `.txt` 源文件）
- **恢复默认** → 删除 `config.agent.<key>.prompt`，退回 `.txt` 文件内容

**SSE 事件**：`agent.prompt.changed` → 通知 overlay 刷新 prompt 显示。

---

## 五、通信协议 — 邮递员模型

### 5.1 通信规则

1. **点对点**：agent A 直接向 agent B 的 inbox 投递消息，禁止经过任何中心化 broker
2. **白名单强制**：`A.send(B)` 要求 `B ∈ A.sendWhitelist` 且 `A ∈ B.receiveWhitelist`，任一不满足即抛出 `AgentProtocolError`
3. **Schema 验证**：消息在进入 inbox 和离开 outbox 时均经过 Zod 验证，验证失败抛出 `AgentProtocolError`，禁止静默跳过
4. **禁止跨 agent 访问内部状态**：任何 agent 不得直接读取另一个 agent 的 `inbox`、`outbox` 字段或调用 `execute()`

### 5.2 消息流全过程

```
调用方（agent A）
  │
  ▼ A.send("agentB", payload)
  │  1. assertCanSend("agentA", "agentB")      ← 白名单检查
  │  2. contract.outputSchema.parse(payload)   ← outbox schema 验证
  │  3. A.outbox.enqueue(message)              ← 写 outbox（状态: pending）
  │  4. registry.get("agentB").receive(msg, "agentA")
  │
  ▼ B.receive(message, "agentA")
     1. assertCanReceive("agentB", "agentA")   ← 白名单检查
     2. contract.inputSchema.parse(payload)    ← inbox schema 验证
     3. B.inbox.enqueue(message)               ← 写 inbox（状态: pending）
     4. B.inbox.markProcessing(id)             ← 状态: processing
     5. result = await B.execute(payload, ctx) ← LLM 推理
     6. B.inbox.markProcessed(id)              ← 状态: processed
     7. B.outbox.enqueue(resultMessage)        ← 写 outbox（状态: processed）
     8. return result                          ← 返回给调用方
```

### 5.3 当前通信拓扑白名单

> **2026-05-12 数据现状**：`planner` agent 已下线（`src/planner/` 整目录删除），从下表
> 移除；`integrity` / `prosecutor` 在 orchestrator tool 集里已实装（见 §七表格），
> 一并补入。orchestrator 实际可调用的子 agent 集合权威来源是
> `agent/agent.ts:276-310` 的 `orchestrator.tools.include`。

```
agent              receiveWhitelist              sendWhitelist
──────────────────────────────────────────────────────────────
orchestrator       [system_entry]                [requirements, architect,
                                                  frontend-design, delivery,
                                                  build, intent-analysis,
                                                  integrity, prosecutor,
                                                  cancel_subagent（task-control tool，
                                                  不派发新 agent，终止现有子 session）]

requirements       [orchestrator]                [orchestrator]
architect          [orchestrator]                [orchestrator]
frontend-design     [orchestrator]                [orchestrator]
delivery           [orchestrator]                [orchestrator]
intent-analysis    [orchestrator]                [orchestrator]
integrity          [orchestrator]                [orchestrator]
prosecutor         [orchestrator]                [orchestrator]

build              [orchestrator]                [orchestrator, general, explore]
general            [build, orchestrator]          [orchestrator]
explore            [build, general, orchestrator] [orchestrator]
```

`system_entry` 是虚拟 agentId，代表外部系统（`EngineService.createTask` 入口），
是触发 orchestrator 的唯一合法入口。

### 5.4 禁止的通信模式

```typescript
// ✗ 禁止：直接调用子 agent 函数（绕过白名单和 schema 验证）
const result = await RequirementsAgent.run(input);

// ✗ 禁止：读取其他 agent 的内部状态
const msgs = someAgent.inbox.list();

// ✗ 禁止：中心化消息总线
EventBus.emit("requirements_done", result);

// ✓ 正确：通过 registry 获取 agent 实例，调用 receive()
const agent = AgentRegistry.get("requirements");
const result = await agent.receive(message, "orchestrator");
```

---

## 六、LLM 驱动执行

### 6.1 `query_registry` 工具

注册到 Orchestrator 的工具集。LLM 调用此工具获取 agent 能力快照，做动态路由决策。

```typescript
// orchestrator/tools.ts 新增

{
  name: "query_registry",
  description: "查询所有可用 agent 的能力契约，包括输入输出描述和通信白名单。用于决定下一步应该调用哪个 agent。",
  parameters: z.object({
    agentId: z.string().optional().describe("指定查询某个 agent，不填则返回全部"),
  }),
  execute: async ({ agentId }) => {
    const snapshot = AgentRegistry.snapshot();
    if (agentId) return snapshot.agents.find(a => a.agentId === agentId);
    return snapshot;
  }
}
```

### 6.2 LLM 如何使用

Orchestrator system prompt 中明确指引：

> 在决定下一步行动前，你可以调用 `query_registry` 了解各 agent 的能力边界。
> 根据当前任务状态和各 agent 的 `inputSummary`/`description`，选择最合适的 agent 投递消息。
> 禁止假设某个 agent 存在或能做某事——先查询，再决策。

**禁止的 LLM 路由方式**：
- 硬编码工具调用顺序（`requirements → architect → planner → build → delivery`）
- 根据任务类型关键词匹配 agent
- 任何形式的 if-else 状态机

---

## 七、现有 Agent 迁移映射

| 现有实现 | 新基类 | inbox schema | outbox schema | prompt 迁移 |
|---|---|---|---|---|
| `RequirementsAgent.run()` | `PipelineAgent` | `RequirementsInputSchema` | `RequirementsResultSchema` | 已在 `.txt`，无需迁移 |
| `ArchitectAgent.coordinate()` | `PipelineAgent` | `ArchitectInputSchema` | `ArchitectResultSchema` | 已在 `.txt`，无需迁移 |
| `FrontendDesignAgent.analyze()` | `PipelineAgent` | `FrontendDesignInputSchema` | `FrontendDesignResultSchema` | 已在 `.txt`，无需迁移 |
| ~~`planGoal()` 函数~~ | — | — | — | **已删除**：`src/planner/` 整目录下线，build agent 直接读 architect contract 推进 |
| `DeliveryAgent.verify()` | `PipelineAgent` | `DeliveryInputSchema` | `DeliveryVerdictSchema` | ✅ 已迁移：`DELIVERY_AGENT_SYSTEM = DELIVERY_CORE` |
| `Orchestrator.runTaskLoop()` | `PipelineAgent` | `OrchestratorTriggerSchema` | `z.void()` | ✅ 已迁移：`ORCHESTRATOR_INSTRUCTIONS = ORCHESTRATOR_CORE` |
| `IntentAnalysisAgent.analyze()` | `PipelineAgent` | `IntentInputSchema` | `IntentResultSchema` | 已在 `.txt`，已接线 `analyze_intent` tool |
| `reviewIntegrity()` （`integrity/agent.ts:257`，函数式入口；本文 §三的 `IntegrityAgent` 类是未来形态） | `PipelineAgent` | `IntegrityInputSchema` | `IntegrityResultSchema` | 已在 `.txt`，已接线 orchestrator `integrity` tool（`tools.ts:2811`） |
| `runProsecutor()` （`prosecutor/agent.ts:322`，函数式入口；本文 §三的 `ProsecutorAgent` 类是未来形态） | `PipelineAgent` | `ProsecutorInputSchema` | `ProsecutorResultSchema` | 已在 `.txt`，已接线 orchestrator `prosecute` tool（`tools.ts:2858`） |
| `Agent.Info["build"]` via `SessionPrompt` | `SessionAgent` | `BuildInputSchema` | `BuildSummarySchema` | 已在 `.txt`，无需迁移 |
| `Agent.Info["general"]` | `SessionAgent` | `GeneralInputSchema` | `GeneralSummarySchema` | 已在 `.txt`，无需迁移 |
| `Agent.Info["explore"]` | `SessionAgent` | `ExploreInputSchema` | `ExploreSummarySchema` | 已在 `.txt`，无需迁移 |

**迁移状态（2026-05-12）**：Orchestrator + Delivery 内联 prompt 已全部移到 `.txt`。整张表的所有 `.txt` 迁移项已完成；剩下未完成的只有 base-class / mailbox / whitelist 等结构性抽象，本文整体仍标记 "未来方案"。

---

## 八、数据库扩展

新增表 `agent_mailbox_message`：

```sql
CREATE TABLE agent_mailbox_message (
  id            TEXT    PRIMARY KEY,
  agent_id      TEXT    NOT NULL,       -- 消息归属 agent
  kind          TEXT    NOT NULL,       -- "inbox" | "outbox"
  from_agent_id TEXT    NOT NULL,
  to_agent_id   TEXT    NOT NULL,
  payload       TEXT    NOT NULL,       -- JSON，已通过 schema 验证
  status        TEXT    NOT NULL DEFAULT "pending",
  trace_id      TEXT    NOT NULL,       -- engine_task.id
  created_at    INTEGER NOT NULL,
  processed_at  INTEGER,
  error         TEXT
);

CREATE INDEX idx_mailbox_agent_status ON agent_mailbox_message (agent_id, kind, status);
CREATE INDEX idx_mailbox_trace        ON agent_mailbox_message (trace_id);
```

---

## 九、Anti-patterns

| 违规 | 原因 |
|---|---|
| 子类直接调用 `AgentRuntime.run()` 而不通过基类框架 | 绕过白名单检查和 mailbox 状态更新 |
| `execute()` 内部调用另一个 agent 的 `execute()` | 绕过 `receive()` 入口，跳过白名单和 schema 验证 |
| 在 `CapabilityContract` 外定义 agent 输入输出类型 | 双源设计，契约与实现脱节 |
| system prompt 以字符串常量内联在 `.ts` 文件中 | 无法通过 config panel 编辑，违反 prompt 管理规范 |
| 新增 agent 不注册到 `AgentRegistry` | LLM 无法查询其能力，无法动态路由 |
| 白名单以外的 agent 通信 | 绕过通信协议，制造隐式依赖 |
| 任何形式的消息 broker / pub-sub / EventEmitter | 中心化通信机制，违反 P2P 约束 |

---

## 十、相关文档

- [01-agents.md](01-agents.md) — Agent 家族调用链与职责
- [05-config.md](05-config.md) — Config.Info 层级与 PATCH 协议
- [07-panel.md](07-panel.md) — Panel 配置 UI（Agent Config 区域扩展点）
- [13-agent-communication-matrix.md](13-agent-communication-matrix.md) — 本文的未来 whitelist 与当前 runtime 真相对照
- [99-principles.md](99-principles.md) — 核心原则与 Anti-patterns（宪章）
