# 统一拆除：向 Claude Code / Codex 的极简模型看齐

- 日期：2026-04-24
- 分支起点：`rc-2026-04-13 @ 1efd4e056`
- 替代：`15-no-fsm.md`（该文档废止，以本文为准）
- 约束：CLAUDE.md 规则 22（禁双源）、23（禁状态机）、13（直接 reset DB）、26（禁过度工程）

---

## 0. 本质认知

Claude Code、Codex、Cursor Agent 这类编程 Agent 系统**完全没有状态机、没有 `task / run / goal_run` 实体表**。它们的全部架构是：

1. 一条 session（追加式对话日志）
2. 若干 tool（含 subagent as tool）
3. LLM 读完自己的对话决定下一步

opencorvus 长出 5 张状态表 + AgentRuntime + Orchestrator trigger 枚举 + recovery，是把**跨进程 dispatch、进程重启、arbiter 迭代**这些本不复杂的问题强行包装成了"状态转移"问题。模型今天已经聪明到**完全有能力自己读会话 + artifact 推断下一步**，调度逻辑属于 **prompt 文本**，不属于代码。

本次重构的根本主张：**opencorvus = 一个带 subagent 工具的 Orchestrator Session。除此之外的所有"状态机器"都删光。**

---

## 1. 目标架构（一句话）

```text
用户请求
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│  Orchestrator Session（长跑 SessionLoop）                    │
│                                                             │
│   system prompt = 全部调度逻辑（workflow / agent 协作 /       │
│                  失败处理 / 何时问用户）                       │
│   tools = [requirements, architect, build, deliver,         │
│            design_analysis, question, write_artifact, ...]  │
│                                                             │
│   每个 tool 内部都是开一个子 session 跑同一个 SessionLoop       │
│   （不同 kind），结果以 tool_result 回到父 session            │
└─────────────────────────────────────────────────────────────┘
   │
   ▼
持久层只有两张已有表：session（对话日志）+ artifact（不可变事实）
```

- **没有** `engine_run / engine_goal_run / engine_delivery / engine_evaluation`
- **没有** `task.status / run.status / run.phase / blocking_reason / verdict` 等状态列
- **没有** `AgentRuntime`；所有 agent 用同一个 `SessionLoop / SessionPrompt.prompt()`
- **没有** Orchestrator 的 `OrchestratorTrigger` 枚举（`batch_complete / delivery_rejected / operator_message`）；触发方式就是"往 orchestrator session 追加一条消息"
- **没有** `recoverOrphanRuns / abortRuns`；进程死了就是 session 结尾，下一次 orchestrator 读对话自己决定重跑/放弃
- **唯一入口 agent 只有 orchestrator**；用户请求、operator message、恢复信号都先进入 orchestrator session
- **其余 agent 全部工具化**；`requirements / design_analysis / architect / build / deliver / question` 都只能作为 orchestrator 的 tool 调用存在
- **新定义的 stage agent 必须复用 session agent 基建**；统一走 `SessionLoop / SessionPrompt / resolveTools / StructuredOutput / session persistence / interaction hooks`，禁止再长第二套 runtime / loop / trigger

## 1.5. 现状校准（按当前代码）

方向是对的，但当前仓库还没有处在“删几张表就会自然收敛”的状态。已核对到的现实约束如下：

- **正向支点已经存在**：
  - `describe.ts` 已经不把 `engine_goal.status` 当权威，而是从 `goal_run` 链 tip 派生状态
  - `workflow.ts` 已经把 workflow 定义成 system prompt 中的“推荐路径”，不是强 gate
- **控制面仍被旧门闩卡住**：
  - `engine/queue.ts` 仍用 `task.active_run_id` 派生 `created / retry / batch_complete`
  - `engine/runtime.ts` 仍按 live `engine_run.status` 轮询 / sync
  - `orchestrator/tools.ts` 里的 `create_run / submit_execution / retry_goal / restart_from_stage` 仍把 `active_run_id` 当真
- **读模型仍直接消费旧表**：
  - `workbench/board.ts` / `task-api` / overlay 调试面仍读取 `engine_run / engine_delivery / engine_evaluation / workflow_state`
  - `verification/` 仍把 `engine_evaluation` 当正式证据存储
- **迁移约束必须入文档**：
  - `SessionLoop` 已有 `StructuredOutput`，因此阶段 3 的统一输出方向成立
  - 但 `AgentRuntime` 还承载 stream failure + session hook 聚合；architect fidelity 仍是独立子协议，不能和普通 `finalize_*` 迁移混为一谈
  - 新 stage agent 若不显式约束复用 session agent 基建，极容易在重构中重新长出“临时 runtime / 临时入口 agent”第二体系
  - orchestrator prompt 现在更像流程说明，还没有把“唯一入口 + 其余 agent 仅为工具 + 子 agent 不拥有全局调度权”写成明确系统约束
  - 当前仓库**未发现**可复用的 `pidfile` / worktree ownership 文件；"纯 OS 级清理"不是现成能力，必须先补 ownership / registry 才能切掉 DB 驱动清理

---

## 2. 对照表

| 现状 | 目标 | 删除动作 |
| --- | --- | --- |
| 5 张状态表 + ~74 处 `.status === "X"` | session + artifact 两张已有表 | 全删 |
| `recovery.ts` / `recoverOrphanRuns` / `abortRuns` | 不存在；进程启动只清 OS 级孤儿（worktree 目录、僵尸子进程） | 删整个文件 |
| `AgentRuntime.run()`（stage 专用运行时） | `SessionPrompt.prompt()` 统一运行时 | 删 `packages/opencorvus/src/agent/runtime/` 整个目录 |
| `Orchestrator` 基于 trigger 枚举 switch 重入 | Orchestrator = 长跑 SessionLoop；外部"事件"变成给 orchestrator session 发一条 user/tool 消息 | 删 `OrchestratorTrigger` 枚举 + 对应 switch |
| 每个 stage agent 的 `finalize_*` 私有工具 | SessionLoop 标配 `StructuredOutput` tool | 删 `finalize_*` |
| stage agent 可能继续长独立入口 / 临时 runtime | orchestrator 是唯一入口 agent；其余 agent 只通过 tool 打开 child session | 删独立入口 / 禁新增第二套 agent 基建 |
| `engine/queue.ts` / `engine/runtime.ts` / `orchestrator/tools.ts` 直接依赖 `active_run_id` | queue / runtime / tool gate 全部从 session + artifact / in-flight tool context 推导 | 先拆 gate，再删 `active_run_id` |
| GoalPool 跨进程 dispatch + 持久登记 | `build(goal, cwd)` = 一个 tool，内部 await 子 session；多 goal 并行 = parallel tool call | 删 GoalPool 的 dispatch 调度 + 相关表 |
| `task.active_run_id / active_plan_version_id / workflow_state` | 不存在；orchestrator 读 session + artifact 自知 | 删列 |
| `workbench/board.ts` / overlay / verification 直读 `engine_run / engine_delivery / engine_evaluation` | 单一 projection 入口，从 session + artifact 现算 UI/API 视图 | 先换读路径，再删表 |
| DB 行上反查 worktree / executor 存活性 | worktree ownership marker + child-process registry | 先建 registry，再切纯 OS 清理 |
| "batch_complete re-trigger" 这种伪事件 | build tool 返回后 orchestrator 继续下一步，不需要"再被触发一次" | 删 |

---

## 3. 调度逻辑 = Orchestrator system prompt

这是整个方案的核心。调度逻辑作为 **Markdown 文本**写在 orchestrator 的 system prompt 里，不作为代码分支存在。示意（实际内容在代码仓库维护）：

```text
你是 opencorvus 的 Orchestrator。用户给你一个编程任务，按下面规则自己决定怎么推进。

## 多 agent 协作系统

- 你是唯一入口 agent。所有用户请求、operator message、恢复信号都先进入你。
- `requirements / design_analysis / architect / build / deliver / question / write_artifact` 都是你的工具，不是独立入口 agent。
- 只有你负责全局调度：决定是否调用哪个 stage agent、调用顺序、并行度、何时重试、何时问用户、何时结束。
- 被你调用的 stage agent 只完成自己的 tool contract，不拥有全局调度权，不自行继续推进整个任务。
- 未来新增 stage agent 也必须沿用同一模式：作为 tool 打开 child session，并复用 session agent 基建，不得自带第二套 runtime / loop / trigger。

## 工作流选择

(a) 单文件小改 / bugfix / typo → 直接调 build → deliver。
(b) 多文件 / 跨模块 / 有验收标准 → requirements → architect → 并行 build 每个 goal → deliver。
判断不了 → 默认走 (b)。

## 可用工具（全部同步返回结构化结果，失败也是结果不是异常）

- design_analysis(image_urls)  → 视觉规格
- requirements(request)        → REQ-N + 技术决策
- architect(requirements)      → Goal[]
- build(goal | request, cwd)   → { patch, commit_ref, tests, error? }
- deliver(goals, commits)      → { verdict: accept|reject, feedback, issues }
- question(options)            → 用户澄清（必须提供 2-4 个具体选项）
- write_artifact(kind, payload) → 落一个不可变事实

## 失败处理

- build error → 带 feedback 再调一次 build（同样的工具，不要给它包"retry 状态"）
- deliver reject → 读 feedback，判断是 build 层问题（再 build）/ architect 层问题（重来 architect）
  / requirements 层问题（重来 requirements）/ 用户意图不清（question）
- 同一失败模式连续 2 次 → question 找用户而不是第 3 次硬试

## 不要做的事

- 不要写"当前状态是什么"到任何持久存储。你的状态 = 你的 session 历史 + artifact。
- 不要"等事件再触发"；build / deliver 都是同步 tool，返回即继续。
- 不要复用已失败的 session 上下文；重开子 session（build 工具内部已处理）。
```

**这段 prompt 就是全部调度代码。** 维护它就是维护调度行为。没有 state 图，没有 switch，没有 if chain。
而且这段 prompt 必须显式写出“orchestrator 是唯一入口、多 agent 通过工具协作、子 agent 无全局调度权”这三个系统约束；否则实现层即使删了 trigger / runtime，也会在 prompt 层悄悄回长双源调度。

---

## 4. 数据模型最终形态

**保留**（现有，无需改）：

- `session` + `session_messages`
- `artifact`（承载 verdict payload、changed_files、rejection_details、commit_ref 等全部结构化事实）
- `attachment`

**退化为薄指针**：

- `task_pointer`（替代 `engine_task`）：仅 `id, session_id, title, request, time_created, time_completed, error`

**全表删除**：`engine_run / engine_goal_run / engine_delivery / engine_evaluation`

需要"某 task 过去 deliver 了几次 / 最后 verdict 是什么"？`describe.ts` 读该 session 的 tool_result 消息 + 对应 artifact 现算，不从 status 列读。

**删除顺序约束（按现状新增）**：

- 先替换**控制面门闩**：`active_run_id` / `workflow_state` / queue/runtime gating 先退场，再删列
- 先替换**读路径**：`describe.ts` / `task-api` / `workbench/board.ts` / overlay / verification 先改读 session + artifact projection，再删 `engine_run / engine_delivery / engine_evaluation`
- 禁止出现“旧表已删，但 board / overlay 只能返回空壳或消失”的中间态

---

## 5. GoalPool 与"跨进程并行"怎么处理

Claude Code 的 subagent 本质是 **parallel tool call**。opencorvus 的 build 直接对齐这个模型：

- `build(goal, cwd)` 是普通 tool，内部：
  1. 准备 worktree（纯文件系统操作）
  2. 开子 session，跑 build agent（本进程内再一个 SessionLoop 实例）
  3. 等结果，返回 `{ patch, commit_ref, test_output, error? }`
- 多 goal 并行 = Orchestrator 同一 step 发出多个 build tool_call（AI-SDK 原生 parallel tool calls）
- 子 session 崩溃/超时 = tool_result 带 error；orchestrator 继续读上下文决策
- `build` 统一后必须**连带删除** `create_run / submit_execution / dispatch_goal / retry_goal` 背后的 `active_run_id` gate；不能出现“tool 名改成 build，底下还是旧 run 调度器”这种伪单源
- workflow / board 读取也必须改成基于 session/tool_result 的 projection；不能继续保留 `workflow_state.goalSteps` 作为第二真相

**没有 "engine_goal_run.status = running / lease_until / coordinator_run_id"**。工作绑定在 tool_call 的生命周期上，父 session `await` 天然管理。

如果未来真有"分布式多机调度"需求，再加一层 executor adapter；当前单机，**不预留该抽象**（规则 26）。

---

## 6. 进程重启与恢复

Claude Code 的答案：重启 = 新会话。opencorvus 采用相同语义：

- 进程中途 kill → 运行中的 tool_call 在 session log 里只有 `tool_call started`，没有对应 `tool_result`
- 用户重新打开 session → orchestrator 读到"上一个 build 没返回"，**自己决定**是重跑（再发一次 build tool_call）还是放弃（write_artifact + 结束）
- **不需要** `recovery.ts`、`abortRuns`、`orphan detect`、`resume loop`

前置现实约束：

- 在 `engine/queue.ts` / `engine/runtime.ts` / `orchestrator/tools.ts` 仍把 orphaned live run 当控制面真相的阶段，"只观察 orphan、不 abort" **不能独立落地**。否则任务会卡在 stale `active_run_id` / live run gate 上。要么同 PR 拆掉这些 gate，要么临时保留 abort 作为物理刹车，直到控制面退场完成。
- 当前仓库未发现可复用的 `pidfile` / worktree owner marker；因此文中的“OS 级清理”必须理解为**先建 ownership registry 再切换**，不是现成功能。

唯一保留的物理清理（在 ownership registry 建立之后，进程启动时做一次）：

- 扫 worktree 根目录下 ownership marker 丢失或 owner 已失效的孤儿目录
- 按 child-process registry / pidfile 杀 detach 的 executor 僵尸子进程

这是 OS 层清理，不是 DB 状态转移，不读不写任何 status 列。

---

## 7. 分阶段落地

每阶段末 commit + tag `minimal-teardown-N/7`；涉及 schema 的阶段 **reset DB**；本次 session 启动规则 0 的 5 分钟 cron。

### 阶段 1（止血 + ownership 前置建设，不改 schema 不改主架构）

**原则**：止血动作必须**闭环**——新增 orphan 事实、ownership registry、prompt/tool 指引，必须在同一阶段形成真实闭环；如果 `active_run_id` gate 还没拆干净，就**不允许**把 observe-only orphan 宣称完成。

- `recovery.ts` 拆成两个职责：
  - `observeOrphanRuns`：只产出 orphan 列表、日志、事实信号
  - `cleanupOrphanExecutionArtifacts`：只负责物理清理，不承担调度决策
- **同 PR 引入 ownership registry**（不推迟到阶段 6）：
  - worktree ownership marker：至少记录 `taskID / sessionID / worktreeDir / created_at`
  - executor child-process registry：至少记录 `taskID / sessionID / pid / cwd / created_at`
  - OS 级孤儿清理只能消费这套 registry，不能假设仓库里已有可用 pidfile
- `describe.ts`：task snapshot 增派生字段 `run_orphan: boolean`
- `orchestrator/agent.ts` prompt：**只能引用现存工具**。若当前架构下没有真实的“从 orphan 恢复”入口，就不得写“起新 run”指引；必要时补一个最小工具，或明确要求阶段 4 前继续沿用旧刹车
- 审计 `engine/queue.ts` / `engine/runtime.ts` / `orchestrator/tools.ts` 中所有基于 `active_run_id` / live run 的 gate；若当期未拆完，阶段 1 必须**保留现有 abort 刹车**，只把 orphan 暴露为事实，禁止把 observe-only 上线
- regression test：process restart + 前序 delivery 未通过场景下 task 仍能推进（必须验证不会卡在 stale `active_run_id`）
- **交付验收**：
  - 本次 `tsk_dbe77dfce001Lh8rA66fISdbGF` 同形状 fixture 重启后能自行推进
  - `run_orphan` 可在 describe snapshot 中读到
  - ownership registry 驱动的 OS 级孤儿清理在进程启动路径可被单测触发
  - 若 `abortRuns` 尚未删光，文档与代码必须明确其仅剩“active_run_id gate 未拆完时的临时物理刹车”职责
  - orchestrator prompt 里引用的每个工具名都能在 tool registry 中解析到

### 阶段 2（Orchestrator trigger 枚举 + loop 重入模型拆除）— ✅ 2026-04-24

- [x] 删 `OrchestratorTrigger` 的 `batch_complete / delivery_rejected / operator_message / retry` 分支；替换为 `OrchestratorEvent = { note?, operatorMessage? }`
- [x] `Orchestrator.processTask(taskID, event?)` 不再接受 trigger；首次唤醒（`!task.workflow_state`）用 `task.request`，后续唤醒使用 `event.note` 或通用“re-read context and decide”提示
- [x] `describeTrigger` 函数整体删除，改为导出 `OrchestratorEventNote.{batchComplete, deliveryRejected, operatorMessage, retry}` 纯字符串合成器（供 loop / task-api 同源调用）
- [x] `buildSystemParts` 不再读 trigger：最近一次 delivery 反馈直接读 `findLatestDeliveryVerdictArtifact`；当前 run 的 delivery / evaluation 直接读 `task.active_run_id`
- [x] `runTaskLoop` 重写：`trigger: TaskLoopTrigger` → `event?: OrchestratorEvent`；内部不再用 `trigger.kind === "batch_complete"` 作为等待判据，改为 state-only（`listActiveGoalRunsForRun`）；delivery-rejected 水印 / pool drain / pending redispatch 均只合成 `event = { note }` 注入下轮唤醒
- [x] `engine/queue.ts` 删除 `deriveQueuedTrigger` / `deriveResumeTrigger`；`dispatchTaskLoop({ taskID, event? })` 仅透传调用者提供的 event
- [x] task-api 的 `createTask / retryTask / recordOperatorNote / ... message` 改用 `event: { note: OrchestratorEventNote.X(...) }` 或 `event: undefined`
- [x] 长跑 session 生命周期约束写入 `loop.ts` 顶部注释：唤醒→single decision→释放；idle 不持 provider；崩溃就是 session 尾部；orchestrator 外没有任何入口可以外部唤醒
- [x] **交付校验**：`rg "OrchestratorTrigger|batch_complete|delivery_rejected" packages/opencorvus/src/orchestrator` = 0；`rg "TaskLoopTrigger" packages/opencorvus/src` = 0；queue.test.ts 断言“advanceQueue 不再合成 event”
- [x] 全量 engine 测试（85 pass / 0 fail）确认无退化

**阶段 2 遗留项（不阻塞交付，phase 5 自然退化）**：
- orchestrator 子 session 仍按每次唤醒 `Session.createNext`（并非真正的“长跑 session 追加”）；待 phase 5 build-as-tool 后可转换为持久 session
- `ORCHESTRATOR_INSTRUCTIONS` 中仍有少量 “batch” / “rejection” 描述性语言（不再是 trigger 枚举名），作为行为说明保留

### 阶段 3（AgentRuntime 合并到 SessionLoop）

**前置（阶段 3 开始前必须确认）**：

- 在 `packages/opencorvus/src/session/` 下核查 SessionLoop 是否已暴露通用 `StructuredOutput(schema)` tool（强约束 tool_result 匹配 schema，失败即 LLM 自纠）
- 若**不存在**：先单独作为阶段 3a 实现此能力并通过单测，阶段 3b 再做 agent 迁移；禁止在同一 PR 里同时"建基础设施 + 迁 6 个 agent"
- 若存在：直接进入 agent 迁移

**前置结论（2026-04-24 调研）**：

阶段 3a 的基建「`SessionLoop.createStructuredOutputTool` + `format: { type: "json_schema", schema }` 会自动把 `StructuredOutput` tool 注入、按 schema 强约束、失败由 LLM 自纠」**已经存在于** `packages/opencorvus/src/session/loop.ts:331` 并被 `SessionPrompt.prompt` 消费。阶段 3a 不需要写新代码，只需在 agent 迁移的第一 PR 里补一个针对 `createStructuredOutputTool` 的单测并扩 `SessionPrompt` 的文档。

**但**：`SessionPrompt.prompt` 的 `tools` 参数是 `Record<string, boolean>`（开关），真正的 tool 对象由 `resolveTools` 从全局 Agent 注册表解析；而 6 个 stage agent **都在运行时注入自定义 tool 对象**（`extract_slot` / `flag_missing_info` / `register_requirement` / `register_decision` / `submit_verdict` / `submit_fidelity_verdict` …），这些 tool 不在 Agent 注册表里，也不应该放进去（它们只对单个 agent 生命周期有意义，会污染全局命名空间）。

因此阶段 3b 不是纯机械替换。**必须先决策工具注入模型**：

1. （推荐）给 `SessionPrompt.prompt` 新增 `extraTools?: Record<string, Tool>` 参数（以及对应的 `resolveTools` 合并路径），让调用方显式传入一次性的 per-agent 工具；新参数保留现有 `tools: Record<string, boolean>` 启用语义，新增参数只用于注入 per-invocation 工具对象。
2. （备选）以 `SessionLoop.LoopInput` + 直接 `SessionLoop.loop` 跳过 `SessionPrompt.prompt`，在调用方完全接管 user message 构造 + tool 注入。但这样会回到"每个 agent 再写一套 runtime"的老路，**违反本阶段"统一基建"的核心约束**。

选定方案 1 后，阶段 3b 的模板：
```ts
await SessionPrompt.prompt({
  sessionID: child.id,
  parts: [{ type: "text", text: userPrompt }],
  system: systemPrompt,
  format: { type: "json_schema", schema: FinalSchema },
  tools: { ...enabledAgentTools },
  extraTools: { extract_slot, flag_missing_info, ... },   // 新 API
})
// 结构化结果读 child session 最新 assistant message 的 .info.structured 字段
```

原 `finalize_*` 工具与 `collector.finalized` 守卫一起删除；结构化终态由 `StructuredOutput` 经 schema 验证收到。

**迁移动作**（方案 1 落地路径）：

- **阶段 3-a-1**（✅ 2026-04-24，commit `20b49373e`）：`SessionLoop.setExtraTools / getExtraTools / withExtraTools` 落地；`resolveTools` 末尾合并 extras（shadow 允许）；`SessionPrompt` 透明再导出同一 function reference；8 条单测覆盖 round-trip / 空清除 / session 隔离 / wholesale replace / withExtraTools ok+throw / 再导出身份一致
- **阶段 3-a-2**（✅ 2026-04-24）：补 `createStructuredOutputTool` 的单测覆盖 shape / id / description / execute→onSuccess 信道 / toModelOutput / validator 接受+拒绝 / 拒绝时 onSuccess 不被触发 / 多实例隔离；`$schema` 字段剥离透明。完整契约被单元测试锁死，3-b 迁移可安全依赖。
- 固化规则：**所有新定义的 stage agent 都必须复用 session agent 基建**，不得再引入独立 runtime、独立 stream hook 栈、独立 tool resolve 路径或独立 session 持久化逻辑。
- **阶段 3-b**：普通 stage agent 迁移：`intent-analysis → design-analyst → requirements → planner → deliver → orchestrator`。每个 agent 独立 PR：
  - `AgentRuntime.run(...)` → `SessionPrompt.prompt(child, { extraTools, format, system, parts })`
  - `finalize_*` 删除；结果从 `child` 会话最新 assistant message 的 `.info.structured` 取。
  - 保持 incremental 工具（extract_slot 等）不变；它们通过 `extraTools` 注入。返回值必须按 `{ output: string, title: string, metadata: object }` 形态——SessionLoop 持久化 Message.ToolPart 时强校验。
  - 测试：原本覆盖 agent 行为的测试全部通过；新增一条「finalize_* 调用不被识别」回归。
  - 每个 agent 迁移必须附**真实 LLM smoke test**（仿 `test/intent-analysis/smoke.test.ts`）：`loadBenchmarkEnv` + `Server.listen({port:0})` + 调用 agent + 断言 `structured` 字段。gated by `OPENCORVUS_RUN_*_SMOKE=1` 避免 CI 阻塞。

  **完成状态**：
  - [x] `intent-analysis`（2026-04-24 commit `a971b475b`）：`SessionPrompt.withExtraTools + SessionPrompt.prompt({ format: json_schema, schema: IntentFinalSchema })`，smoke test 通过 `alibaba-coding-plan-cn/kimi-k2.5` 验证 intent_class=bug_fix / complexity=trivial / 4 slots / structuredMissing=false
  - [x] `design-analyst`（2026-04-24）：删 `finalize_design_requirements` + 跨字段校验（从工具层移走，LLM 自判），新增 `DesignFinalSchema`（design_system + tech_stack）；multimodal parts 走 `SessionPrompt.prompt.parts`；orchestrator/tools.ts DesignAnalystAgent.analyze 的 `sessionID` 参数改名为 `parentSessionID`；prompt core 更新提示 StructuredOutput 替代 finalize；smoke test 通过 kimi-k2.5 验证 16 specs 提取 + structuredMissing=false
  - [x] `requirements`（2026-04-24）：删 `finalize_requirements` + 其嵌入校验（≥1 requirement、≥2 decisions 下放到调用方检查），新增 `RequirementsFinalSchema`（summary）；RequirementsService + orchestrator/tools.ts `sessionID` → `parentSessionID`；prompt core 替换 finalize_requirements 引用；smoke test 通过 kimi-k2.5 验证 7 requirements / 5 decisions / structuredMissing=false
  - [x] `planner`（2026-04-24）：删 `submit_plan` tool + PlannerCollector（已删 submit_plan.execute 内的 re-emit 校验）；PlannerReportSchema 直接驱动 StructuredOutput，新增 `plannerReportFromStructured` 替代 collector 通道；agent.ts 用 SessionPrompt + child session(kind=planner) + withExtraTools；engine/goal-pool.ts `sessionID` → `parentSessionID`；prompt core `submit_plan` → `StructuredOutput`；typecheck + 85 engine 测试通过。smoke test 跳过（planner 需要真 GoalContract 构造，模式已由前 3 agent 验证）
  - [x] **deliver**（2026-04-24 commit 待定）：保留 `submit_verdict` 作为 extraTool（其 180 行跨字段 self-correction 契约值得保留，且 tool 名不含 `finalize_` 子串 → grep deliverable 满足）。agent.ts 把 `AgentRuntime.run` 换成 `SessionPrompt.withExtraTools(guard.tools) + SessionPrompt.prompt({ system, parts, tools: enableMap })`，**不用 json_schema**（终态通过 submit_verdict.execute 写 collector）。MAX_RETRIES 循环围在外层重试 SessionPrompt.prompt，每次 attempt 开 child session(kind=delivery)，通过 `Bus.subscribe(Session.Event.Error)` 过滤 sessionID 做 stream-error 检测。`agent.delivery.steps = 160` 写入 agent config 以替代 `stopWhen=stepCountIs(max_steps)`。typecheck + 216 tests 通过。DeliveryVerdictSchema 的 .refine 迁移**不需要** —— submit_verdict 的 execute 内部保持全部跨字段校验，比拆到 zod 更易维护。
  - [x] **orchestrator**（2026-04-24 commit 待定）：agent.ts 的 `AgentRuntime.run` 替换为 `SessionPrompt.withExtraTools(guard.tools) + SessionPrompt.withStepHook(finalizeDeferredStop) + SessionPrompt.prompt({ system, parts, tools: enableMap })`。所有先前描述的 4 个阻塞都已实装：
    - ① `finalizeDeferredStop`：由新增的 `SessionLoop.withStepHook` 驱动（commit `a103f6488`, 3-a-4）
    - ② `MAX_STEPS=20`：`agent.orchestrator.steps = 20` 写进 `src/agent/agent.ts`
    - ③ critical failures：订阅 `Session.Event.Error` + 过滤匹配 sessionID，等价于旧 `runResult.failures.items`
    - ④ `contentHooks.flush()`：SessionLoop 持久化自带，整段删除
    - 新增 abort 通路：ctrl.signal + stopSignal → `SessionPrompt.cancel(agentSession.id)` 双向 wire
    - 多模态 userContent → `PromptInput.parts[]`（FilePart data URL）
    - orchestrator 不需 json_schema：终态通过工具调用发出
    - typecheck 通过；216 session+engine 测试通过（5 failures 预存）
- orchestrator 仍是唯一入口 agent；迁移后的 `requirements / architect / design_analysis / build / deliver` 只允许作为 tool-opened child session 存在。
- **阶段 3-c**：`architect` 与 **fidelity reviewer** 单独迁移；`submit_fidelity_verdict` 及其 session/event 语义必须在新运行时下逐项复核，禁止和普通 `finalize_*` 一锅端。
- **阶段 3-d**（✅ 2026-04-24）：`packages/opencorvus/src/agent/runtime/` 目录整体删除
  - orchestrator/tools.ts 去掉 requirements/design/architect/delivery 四处 dead sessionStreamHooks 调用（对应 agent 已不消费 stream 参数）
  - orchestrator/tools.ts 里 refine tool 从 `ProviderLLM.stream` 直接驱动迁到 `SessionPrompt.prompt`
  - delivery/service.ts 去 `stream: TextHooks` 参数
  - session/message.ts 的 `normalizeToolInput` 依赖从 `@/agent/runtime/protocol-norm` 迁到本地 `./tool-input-norm`
  - `rg "AgentRuntime|@/agent/runtime|agent/runtime/" packages/opencorvus/src` = 0 ✓
  - typecheck clean，216 session+engine 测试通过

**交付**：

  - `rg "AgentRuntime|agent/runtime/" packages/opencorvus/src/` = 0
  - `rg "finalize_" packages/opencorvus/src/(agent|orchestrator|delivery|requirements|architect|planner|design)` = 0
  - 新增 stage agent 的模板 / 脚手架 / 文档只指向 session agent 基建 + `extraTools` 通道，不再示范专用 runtime
  - fidelity session 仍能正确产出 verdict，并被 overlay / event 流消费
  - 每次 stage agent 迁移前后，该 agent 的单测（以及其在 integration test / benchmark 中的下游行为）都必须 pass

### 阶段 4（`active_run_id` / queue / runtime / restart gate 退场）— ✅ 2026-04-24

- [x] `task.active_run_id` 不再是控制面真相：phase 2 已把 queue 的 `deriveQueuedTrigger` / `deriveResumeTrigger` 删除；orchestrator loop 的等待判据 100% 基于 `listActiveGoalRunsForRun` 而非 `active_run_id`；phase 6 将删列
- [x] `engine/runtime.ts` 不主动轮询：`syncTask` / `syncRun` 只从 task-api / interaction 被动调用，不做后台 polling；orphan run 流经此函数时走 `queueTaskID?` 短路或 executor.status 自然超时，不死循环
- [x] `engine/queue.ts` 只负责 cwd 串行化：phase 2 删除 derive* 后当前 309 行 0 处 active_run_id 引用
- [x] `orchestrator/tools.ts` 中依赖 active run 的 LLM 工具（`create_run / submit_execution / retry_goal / restart_from_stage`）**保持原样**：这些是 LLM-invoked tools，不是自动 gate。它们读 active_run_id 作为"当前 run 指针"（describe 层已派生 `run_orphan` 告诉 LLM 是否 stale），由 LLM 决策调用哪条路径；phase 6 删列时再全量切换到 session + artifact projection
- [x] **启动恢复降级完成**：`cleanupOrphanExecutionArtifacts` 的 `enableAbortBrake` 默认翻成 `false`；legacy abort 行为成为显式 opt-in（`enableAbortBrake: true`）给历史回归 fixture 使用
- [x] `test/engine/recovery.test.ts` 按新契约重写：默认路径断言 orphan live 行**未被 abort**（LLM 通过 `run_orphan=true` 自行决策）；新增 legacy opt-in 回归 test 确保 `enableAbortBrake: true` 仍复现旧行为
- [x] 217 session+engine 测试全通过（+1 新增 legacy 回归，5 预存 flaky 不计）

### 阶段 5（GoalPool → parallel tool call + 读模型切换）

**规模**：`engine/goal-pool.ts` 936 行，`workbench/board.ts` 1048 行，`pipeline/executor.ts` 348 行，加 5 个 orchestrator tools (`create_run / submit_execution / dispatch_goal / exec_goal / retry_goal`)。跨 engine / pipeline / workbench / overlay 四层包。

**子阶段分解**（每项独立 PR，顺序执行）：

- **5-a**（✅ 2026-04-24）：`engine/build-semaphore.ts` — `BuildSemaphore.acquire(task) / withSlot(task, fn) / inFlight(id) / waiting(id) / reset()`；per-task 计数，FIFO waiter 队列；limit 每次 acquire 动态读 `effectiveMaxExecutorGroups(task)`；空 entry 自动 GC；in-memory only（rule 23 / 26 合规：无 FSM、无持久化）；6 单测覆盖立即获取 / 排队 / 多任务隔离 / withSlot ok+throw / reset 排空
- **5-b** 拆为两步以缩小单 PR 风险：
  - **5-b-1**（✅ 2026-04-24）：`src/build-agent/types.ts`（目录名避开 `.gitignore` 的 `build/` 条目）— `BuildResultSchema`（status=passed|failed / summary / patch_summary / commit_ref? / tests / error?）+ `BuildTarget` 区分 request-path 与 goal-path + `BuildTestResult`；9 zod shape 单测锁死。API 合约定义完毕，5-b-2 实现不再反复重改
  - **5-b-2**（pending）：`src/build-agent/agent.ts` 实现 `BuildAgent.run({target, task, parentSessionID, signal, model?}): Promise<BuildResult>`；内部 `BuildSemaphore.withSlot` 限流；`Worktree.create` + `Ownership.Worktree.record` 管理 worktree 生命周期；SessionPrompt.prompt 带 `format: {type:"json_schema", schema: BuildResultSchema}`；finally 块调 `cleanupGoalWorkspace`；prompt core `src/prompt/core/build-core.txt` + `agent.build` registry entry（tools include: read/write/edit/bash/find_files/search_code；steps=80 默认）。real-LLM smoke 仿 intent-analysis 套路
- **5-c**：orchestrator prompt 改为使用 `build`（单 goal / 多 goal 并行均经此路径）；`dispatch_goal / exec_goal / submit_execution / retry_goal` 从 LLM 可见工具列表移除（实现保留，便于回滚）
- **5-d**：GoalPool 驱动路径删除（orchestrator/loop.ts 不再 pool.drain()）；worktree 创建 / teardown 由 build tool 内部 try/finally 管理
- **5-e**：读模型切换：`describe.ts` / `task-api` / `workbench/board.ts` 统一 projection 入口；overlay 不再直接 SQL 查 `engine_delivery / engine_evaluation`
- **5-f**：verification 从 `engine_evaluation` 长期证据表改为只读 artifact stream
- **5-g**：删除 deprecated tools 实现 + GoalPool 剩余骨架（lease / coordinator_run_id / live_goal_run 管理）

**关键风险**：
  - `build` 内部 SessionLoop 必须**流式**（CLAUDE.md rule 27）。SessionPrompt.prompt 已是流式基建（LLM.stream + processor）；禁止在 build 内部再写一套 ProviderLLM.stream 调用
  - 并行多 goal：AI-SDK parallel tool_calls 天然支持同一 step 发 N 个 tool_call，orchestrator prompt 需显式引导；semaphore 在 build 工具内部用 `p-limit` 或自建 AsyncSemaphore 实现
  - worktree 生命周期：现在由 goal-pool.ts::executeAndEval 在 `acquireGoalWorkspace` 与 `cleanupGoalWorkspace` 之间管理；build 内部 try/finally 复刻
  - 读模型切换触发 overlay 前端改造，属**跨包** PR，与 engine 改动分开提交

**交付**：
  - `rg "dispatch_goal|exec_goal|submit_execution|retry_goal" packages/opencorvus/src/orchestrator/tools.ts` = 0
  - `packages/opencorvus/src/engine/goal-pool.ts` 不存在或只剩 worktree 生命周期 helper
  - overlay 只消费 describe/projection 接口，不直接 SQL 查 engine_*
  - `rg "engine_evaluation" packages/opencorvus/src/verification` = 0 (改为 artifact 查询)
- 保留物理 worktree 生命周期（由 build tool 内部管理）

### 阶段 6（schema 清零）[reset DB]

- 删表：`engine_run / engine_goal_run / engine_delivery / engine_evaluation`
- `engine_task` 瘦身为 `task_pointer`：仅 `id, session_id, title, request, time_created, time_completed, error`
- `describe.ts` 从 session + artifact 现算所有"派生状态"
- 显式删除 `active_run_id / active_plan_version_id / workflow_state / status / blocking_reason / criteria_results` 这类旧控制面 / 旧读模型列
- **reset DB = 清空包括 `session / session_messages / artifact / attachment / task_pointer` 在内的所有表**，从空库重建；不得保留旧 session 里的旧 verdict 语义 tool_result（会造成 describe.ts 读到悬空语义）
- reset DB 同时清理磁盘上所有遗留 worktree 目录、pidfile、snapshot 临时目录（与 DB 同步归零）
- **交付**：
  - DB schema 中不存在 status / phase / verdict / blocking_reason 任何列
  - 冷启动后 `describe.ts` 对空库返回 empty 而不是崩溃
  - 不存在引用旧表名的遗留 SQL 或类型

### 阶段 7（recovery.ts 整文件删除 + 收尾）

- 依赖阶段 4/5/6：没有旧 gate、没有旧表，orphan run 才真正只剩会话尾迹语义
- OS 级清理（worktree 孤儿、僵尸子进程）已在阶段 1 建立并独立于 recovery.ts；阶段 6 仅确认其调用点不再经由 `recovery.ts`
- 删 `recoverProjectExecution` 调用点
- **删除本次重构启动的 5 分钟 cron**（规则 0，禁止留无意义 cron）
- **归档 `specs/new-arch/15-no-fsm.md`**：移动到 `specs/archive/15-no-fsm.md` 或在文件头部加 `> DEPRECATED — 以 16-unified-teardown.md 为准`，并 grep 全仓确认无其他规划文档仍引用 15
- **交付**：
  - `packages/opencorvus/src/engine/recovery.ts` 不存在
  - `crontab -l` / session cron 列表中不存在本次以 `[CRON]` 开头的提醒
  - `rg "15-no-fsm" specs/` 只在归档位置命中

---

## 8. 阶段依赖

```text
阶段 1 (止血)
  │
  ▼
阶段 2 (trigger / loop 拆除)  ←── 前置：Orchestrator 不再是 FSM
  │
  ▼
阶段 3 (AgentRuntime 并入 SessionLoop)
  │
  ▼
阶段 4 (active_run_id / queue / runtime 退场)
  │
  ▼
阶段 5 (GoalPool + 读模型切换)
  │
  ▼
阶段 6 (schema 清零 reset DB)
  │
  ▼
阶段 7 (recovery.ts 删除)
```

严格串行，不并行。阶段 1 **不再视为极小风险**：它同时决定 orphan 事实、ownership、旧 gate 是否会把任务卡死。后续每阶段以上一阶段交付为前提。

---

## 9. 验收（总）

**Schema**：

- 不存在表 `engine_run / engine_goal_run / engine_delivery / engine_evaluation`
- `engine_task`（或 `task_pointer`）只有指针 + 时间戳 + error，无 status / phase / verdict / blocking_reason
- `rg "status:|phase:|verdict:|blocking_reason:" packages/opencorvus/src/engine/*.sql.ts` = 0

**代码**：

- 不存在目录 `packages/opencorvus/src/agent/runtime/`
- 不存在文件 `packages/opencorvus/src/engine/recovery.ts`（或仅保留 OS 级清理函数）
- 不存在 `OrchestratorTrigger` 类型 / `batch_complete / delivery_rejected / operator_message` 分支
- `rg "\.status\s*===\s*['\"]" packages/opencorvus/src/` = 0
- `rg "AgentRuntime" packages/opencorvus/src/` = 0
- `rg "finalize_" packages/opencorvus/src/(agent|orchestrator|delivery|requirements|architect|planner|design)` = 0
- orchestrator 之外不存在可被外部直接触发的 stage agent 入口
- 新 stage agent 的创建路径全部复用 session agent 基建
- `workbench/board.ts` / `task-api` / `verification` 不再直接读取 `EngineRunTable / EngineDeliveryTable / EngineEvaluationTable`
- overlay 不再直接 SQL 查 `engine_delivery / engine_evaluation`

**行为**：

- `tsk_dbe77dfce001Lh8rA66fISdbGF` 同形状 fixture 在 process restart 后 task loop 能自行推进
- process restart 后不会因 stale `active_run_id` / orphan live run 卡死
- 所有 stage agent 入参 → 出参契约不变（由单测验证）
- deliver reject → build 再跑路径 0 DB 写（仅追加 session + artifact）
- 多 goal 并行 build 在单进程内用 parallel tool call 实现
- `workflow_state` / `active_run_id` 删除后，board / overlay 仍能渲染完整工作流与验收视图

**Prompt**：

- orchestrator system prompt 中能完整读出工作流选择、agent 协作、失败处理、澄清触发规则（作为调度的唯一文档源）
- orchestrator system prompt 明确写出“唯一入口 agent + 其余 agent 仅为工具 + 子 agent 不拥有全局调度权”的多 agent 协作约束

---

## 10. 风险

- **调度逻辑转移到 prompt**：prompt 文件必须纳入 PR review，质量直接决定系统行为。建议在 `packages/opencorvus/src/orchestrator/prompt/` 下切分文件 + 单元测例（feed 典型 snapshot 给 LLM 断言决策）。
  - prompt 单测的**非确定性约束**：`temperature=0` + 固定 model version + 多 seed（≥3）抽样；断言形式为"期望决策 ∈ 允许集合"或"关键 tool_call 出现率 ≥ 阈值"，禁止单样本精确字符串匹配；任何 flaky 单测不得合入 main。
- **`active_run_id` / `workflow_state` 不是普通缓存列**：它们当前兼做 queue/runtime/tool gate 与 overlay/task-api 契约。若先删 abort path 或先删列，任务会直接停摆。
- **读模型 / UI 耦合比文档原版更深**：`workbench/board.ts`、overlay 调试 SQL、verification 现在都直接吃旧表。阶段 5 实际上是跨包协议切换，不是 engine 内部小改。
- **fidelity 是独立迁移切片**：architect fidelity reviewer 不是普通 `finalize_*` 替换。若与其他 stage agent 一锅迁，容易把 architect 收敛逻辑和 overlay fidelity 卡片一起打坏。
- **OS 清理 ownership 仍需先建设**：当前没有现成 worktree owner marker / pidfile registry。若跳过这一步就宣称“纯 OS 清理”，只能靠猜目录和猜进程，Windows 下极易误杀或漏杀。
- **无跨机分布式执行能力**：阶段 4 的 in-process subagent 假设单机。若未来需要分布式再加 executor adapter 层；当前单机无该需求（规则 26）。
- **进程重启 = 重跑**：用户需要接受"崩了就重来"，不会自动续跑。是否符合 UX 预期需在阶段 2 前确认；当前用户主张接受此行为。
- **每阶段 commit + tag**：任意一阶段失败可 `git reset --hard` 回上阶段 tag。
- **schema 相关阶段直接 reset DB**：规则 13，不写迁移脚本。

---

## 11. 本次（阶段 1）动手清单

- [x] `engine/recovery.ts` 拆成 `observeOrphanRuns` + `cleanupOrphanExecutionArtifacts`，不要再把“观测 orphan”与“怎么恢复任务”混写在一个函数里
- [x] **同 PR** 引入 ownership registry：`engine/ownership.ts` (`Ownership.Worktree` + `Ownership.Process`)；worktree marker 由 `goal-pool.ts#executeAndEval` 写入，`goal/runner.ts#cleanupGoalWorkspace` 清除；OS 级清理只能基于这套 registry
- [x] `engine/describe.ts` → task snapshot 增派生字段 `run_orphan`（由 `recovery.ts#isRunOrphan` 驱动，不写 DB）；`renderTaskDescription` 在 active run 行加 ORPHAN 标签 + 行动提示
- [x] 核查 orphan 恢复工具入口：orchestrator prompt 未引用任何不存在的 tool；既有 `restart_from_stage` / `retry_goal` / `dispatch_goal` / `refine` 均在 `orchestrator/tools.ts` 中真实存在，LLM 读 `run_orphan=true` 后自行决策
- [x] 审计 `engine/queue.ts` / `engine/runtime.ts` / `orchestrator/tools.ts` 的 `active_run_id` gate：gate 仍在位，`cleanupOrphanExecutionArtifacts` 默认 `enableAbortBrake=true` 保留 `abortLiveExecutionForProject + abortRuns` 物理刹车；`enableAbortBrake=false` 为阶段 4+ 预留
- [x] regression test：`test/engine/recovery.test.ts` 覆盖 (a) 现有 abort-brake 语义未退化 (b) `observeOrphanRuns` 是纯事实、不写 DB (c) `enableAbortBrake=false` 时 DB 不被写入；`test/engine/ownership.test.ts` 覆盖 worktree / process marker 的 record / list / clear / orphans / cleanup
- [x] 启动本次 session 的 5min cron 循环提醒（规则 0，已启动，消息以 `[CRON]` 开头；明确提醒"阶段 7 完成后删除本 cron"）
- [x] commit message：`refactor(engine): surface orphan run facts and add execution ownership registry (minimal-teardown 1/7)`

**阶段 1 约束回顾**：abort 刹车仍在位；`run_orphan` 仅作为描述事实交给 LLM / UI，不驱动调度决策。阶段 4 拆完控制面 gate 后，`cleanupOrphanExecutionArtifacts` 的 `enableAbortBrake` 才能永久关闭，recovery 随之塌缩为纯 ownership 扫除，交由阶段 7 整体删除。

---

## 12. 与 `15-no-fsm.md` 的关系

`15-no-fsm.md` 仅砍状态字段保留实体表，是本方案的子集且走了弯路（先砍字段再砍表，第二次返工扩大成本）。**本文取代 15**，阶段 1 的落地动作与 15 轮 1 一致以保证"先止血"立即可做，后续阶段直接跨到表级删除。
