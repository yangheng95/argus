# OpenCorvus 算法流程文档

> 版本：2026-03-09 · spec-first 编排草案

---

## 1. 系统架构总览

```
┌─────────────────────────────────────────────────────────┐
│  入口层 (Entry)                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │ HTTP API │  │  Slack   │  │ Overlay  │               │
│  │ (Hono)   │  │ Gateway  │  │ (Tauri)  │               │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘               │
│       └──────────────┼────────────┘                      │
│                      ▼                                   │
│  ┌─────────────────────────────────────┐                 │
│  │  OrchestratorService               │  ← 公开 API     │
│  │  createTask / retryTask / replan   │                  │
│  │  cancelTask / handleTaskMessage    │                  │
│  └───────────────┬─────────────────────┘                 │
│                  │                                       │
│  ┌───────────────▼─────────────────────┐                 │
│  │  OrchestratorRuntime               │  ← 状态机引擎   │
│  │  dispatch / poll / syncRun         │                  │
│  │  completeRun / retryOrReplan       │                  │
│  └──┬────────────┬─────────────┬──────┘                  │
│     │            │             │                         │
│  ┌──▼───┐  ┌────▼────┐  ┌────▼──────┐                   │
│  │Planner│  │Executor │  │Evaluator  │                   │
│  │Service│  │Registry │  │Service    │                   │
│  └──────┘  └────┬────┘  └───────────┘                   │
│                 │                                        │
│  ┌──────────────▼──────────────────────┐                 │
│  │  Session / Tool / Provider          │  ← 内核层      │
│  │  PlannerTool · TaskPlan · Prompt    │                 │
│  └─────────────────────────────────────┘                 │
│                                                         │
│  ┌─────────────────────────────────────┐                 │
│  │  Storage (SQLite + Drizzle ORM)     │  ← 持久层      │
│  └─────────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────┘
```

说明：

- `spec agent` 与 `plan agent` 是并列的一等 agent，`spec` 不再作为 builtin skill 从属存在。
- 目标调度顺序固定为 `spec -> plan -> execute -> spec check -> delivery`。
- 对于中大型或信息不完备的任务，系统应被鼓励主动调用 `spec agent`，先补完 spec，再开始 plan。

---

## 2. 核心状态机

### 2.1 Task 状态

```
                    ┌───────────────────────────────────────────┐
                    │                                           │
                    ▼                                           │
  ┌────────┐   dispatch   ┌─────────┐   executor done   ┌──────────┐
  │ queued ├──────────────►│ running ├───────────────────►│evaluating│
  └────────┘               └────┬────┘                   └────┬─────┘
                                │                              │
                           interaction                    ┌────┴────┐
                           pending                        │         │
                                │                    all goals   evaluation
                           ┌────▼────┐               met         failed/
                           │ blocked │                │         goals pending
                           └────┬────┘                │              │
                                │                ┌────▼────┐    retryOrReplan
                           interaction           │completed│         │
                           resolved              └─────────┘    ┌────▼────┐
                                │                               │ running │
                                └─► running                     └────┬────┘
                                                                     │
                                                                budget exhausted
                                                                     │
                                                                ┌────▼────┐
              cancel ──────────────────────────────────────────►│ failed  │
                                                                └─────────┘
              cancel ──────────────────────────────────────────► cancelled
```

### 2.2 Run 状态

```
  queued ──► accepted ──► running ──► completed
                │                        │
           interaction              executor error
           pending                       │
                │                   ┌────▼───┐
           ┌────▼────┐              │ failed │
           │ blocked │              └────────┘
           └────┬────┘
                │
           interaction     operator abort
           resolved ──►       ──► aborted
           accepted
```

### 2.3 Interaction 状态

```
  pending ──► answered
         └──► rejected
         └──► expired
```

---

## 3. 完整任务生命周期

### 3.1 Phase 1: 任务创建与 spec 启动

```
POST /task { request, title?, executor?, goals?, checks?, budget?, channelBinding? }
         │
         ▼
  OrchestratorService.createTask()
         │
         ├─ 1. 幂等检查: requestID 存在? → 返回已有 taskID
         │
         ├─ 2. 验证: 解析输入、校验 executor 已注册
         │
         ├─ 3. SpecAgent.initial() ──────────────────────────────┐
         │      │                                                 │
         │      ├─ 读取 request / notes / memory / preference      │
         │      ├─ 识别事实缺口、外部依赖、边界条件与验收范围        │
         │      ├─ 鼓励主动调用 WebSearch / WebFetch / Read / Grep │
         │      │  / Agent(Explore) 补齐 spec 所需信息             │
         │      └─ 输出可执行 spec 与 required spec items           │
         │                                                 │
         ├─ 4. PlanAgent.initial(spec) ────────────────────────────┤
         │      │                                                 │
         │      ├─ normalizeGoals(): 基于 spec 推断默认目标         │
         │      │   └─ inferSelectors(): 从 spec 推断              │
         │      │      check_selector (build/test/lint/spec_check  │
         │      │      /ui_review/code_quality/startup 等)         │
         │      │                                                 │
         │      └─ renderPlanModePrompt(): 生成执行提示词           │
         │         └─ 包含 5 阶段工作流:                            │
         │            Phase 1: 探索代码库 (read/glob/grep/agent)   │
         │            Phase 2: 编写/补完 spec                      │
         │            Phase 3: 用 plan agent / planner 工具分解任务 │
         │            Phase 4: 逐步执行子任务                       │
         │            Phase 5: 运行 spec-driven 验收检查            │
         │                                                 ◄──────┘
         ├─ 5. Session.create({ title })
         │
         ├─ 6. Database.transaction() 原子写入:
         │      ├─ OrchestratorTaskTable       (status: "queued")
         │      ├─ OrchestratorSpecSnapshotTable (status: "ready")
         │      ├─ OrchestratorSpecItemTable[] (status: "pending")
         │      ├─ OrchestratorPlanVersionTable (version: 1, status: "active")
         │      ├─ OrchestratorGoalTable[]     (status: "pending")
         │      ├─ OrchestratorMilestoneTable[] (如有)
         │      ├─ OrchestratorRunTable        (status: "queued", phase: "execute")
         │      ├─ OrchestratorChannelBindingTable (如有 Slack 绑定)
         │      └─ OrchestratorProgressSnapshotTable ("Task created")
         │
         ├─ 7. 发布事件: TaskCreated, SpecCreated, SpecUpdated, PlanCreated, PlanActivated, RunCreated
         │
         ├─ 8. WorkbenchService.recordTaskRequest()
         │
         └─ 9. OrchestratorRuntime.dispatch(runID)
                │
                └─► 进入 Phase 2
```

### 3.2 Phase 2: spec 编制与确认

```
  SpecAgent.run(task)
         │
         ├─ 1. 汇总 request / notes / memory / preference / channel 上下文
         │
         ├─ 2. 主动补齐上下文:
         │      ├─ 仓库内探索: Read / Grep / Glob / Agent(Explore)
         │      ├─ 外部资料: WebSearch / WebFetch
         │      └─ 缺口仍然阻断? → 通过 Question / Permission 进入 blocked
         │
         ├─ 3. 输出并持久化 spec:
         │      ├─ 范围 / 非目标
         │      ├─ 功能与行为要求
         │      ├─ 边界条件 / 失败模式 / 约束
         │      ├─ required spec items
         │      ├─ 证据来源 / 未决问题
         │      └─ spec.status = "ready" | "blocked"
         │
         └─ 4. spec.status = "ready"
                └─► 进入 Phase 3
```

### 3.3 Phase 3: plan 生成与运行派发 (dispatch)

```
  OrchestratorRuntime.dispatch(runID)
         │
         ├─ 1. 获取 run (验证 status === "queued")
         │
         ├─ 2. PlanAgent 基于当前 spec 生成 / 确认 active plan:
         │      ├─ base = plan.prompt (或 run.metadata.prompt_override)
         │      ├─ spec = current spec snapshot
         │      ├─ brief = WorkbenchService.compileBrief()
         │      │    ├─ 任务请求原文
         │      │    ├─ 当前 spec 摘要 + required spec items
         │      │    ├─ 全局偏好 + 会话偏好 (session overrides global)
         │      │    ├─ 操作员笔记 (notes)
         │      │    ├─ 目标概要 (goals)
         │      │    ├─ 全局记忆 + 会话记忆召回结果
         │      │    └─ 前次运行上下文 (如 retry / replan)
         │      └─ prompt = brief + "\n\n" + spec + "\n\n" + base
         │
         ├─ 3. executor.submit({ sessionID, prompt, priority })
         │      │
         │      ├─ [内置执行器] TaskQueueService.enqueuePrompt()
         │      │   └─ 加入任务队列、触发 runNow()
         │      │
         │      └─ [codex/claude-code] ManagedCodingExecutor
         │          └─ provider.run({ model, prompt, cwd, system })
         │
         ├─ 4. run.status = "accepted", 记录 executor_ref
         │
         └─ 5. task.status = "running"
```

### 3.4 Phase 4: 执行期 (Session 内部)

```
  Session 执行期 (内置执行内核)
         │
         ├─ 系统提示词注入:
         │    ├─ SystemPrompt.environment() (模型/平台信息)
         │    ├─ InstructionPrompt.system() (CLAUDE.md / AGENTS.md)
         │    ├─ Preference.systemPromptSection() ← 全局/会话偏好直接注入
         │    ├─ MemoryInjection.systemPromptSection() ← 先检索记忆/偏好再规划
         │    ├─ Scratchpad 内容
         │    ├─ Spec.toMarkdown()     ← 当前 spec 与 required spec items
         │    ├─ TaskPlan.toMarkdown() ← planner 工具产出的任务树
         │    └─ Goal.toMarkdown()     ← session-level 目标
         │
         ├─ 可用工具 (tool/registry.ts):
         │    ├─ 文件操作: Read, Edit, Write, Glob, Grep, LS
         │    ├─ 执行: Bash, Task (子进程管理)
         │    ├─ 代理: Agent (Explore / Spec / Plan 子代理)
         │    ├─ 规划: PlannerTool (add_task/update_task/list_tasks)
         │    │         └─ TaskPlan 持久化到 task_plan 表
         │    │         └─ toMarkdown() 注入后续系统提示
         │    ├─ 目标: GoalTool
         │    ├─ 记忆: MemoryTool, Scratchpad
         │    ├─ 偏好: PreferenceTool
         │    ├─ 网络: WebFetch, WebSearch
         │    ├─ 其他: ApplyPatch, TodoWrite, Skill, Schedule
         │    └─ 实验性: LSP, Batch
         │
         ├─ LLM 按照 spec-first 提示词执行:
         │    ├─ Phase 1: 探索代码库
         │    │    └─ 调用 Read/Grep/Glob/Agent(Explore) 了解架构
         │    ├─ Phase 2: 主动调用 spec agent 编写/补完 spec
         │    │    └─ spec 未完成时不得跳过进入 plan
         │    ├─ Phase 3: 用 plan agent / planner 工具建立任务树
         │    │    └─ planner({ action: "add_task", goal: "..." })
         │    ├─ Phase 4: 逐步执行
         │    │    ├─ planner({ action: "update_task", taskId, status: "in_progress" })
         │    │    ├─ 执行代码修改 (Edit/Write/Bash)
         │    │    ├─ 记忆写入默认 `scope=global`
         │    │    ├─ 偏好写入默认 `scope=global`
         │    │    ├─ 仅临时指令才写入 `scope=session`
         │    │    └─ planner({ action: "update_task", taskId, status: "completed" })
         │    └─ Phase 5: 验证并沉淀 spec evidence
         │         └─ 运行 build/test/lint 并准备 spec_check 所需证据
         │
         └─ 交互点:
              ├─ Permission 请求 → PermissionNext.Event.Asked
              │    └─ Interaction 创建 → Run blocked → 等待用户回复
              └─ Question 请求 → Question.Event.Asked
                   └─ Interaction 创建 → Run blocked → 等待用户回复
```

### 3.5 Phase 5: 轮询与同步 (poll)

```
  Scheduler: 每 1500ms 调用 OrchestratorRuntime.poll()
         │
         ├─ 查询所有 status IN ("accepted", "running", "blocked") 的 Run
         │
         └─ 对每个 Run 调用 syncRun():
              │
              ├─ 检查 pending interactions
              │    └─ 有未解决交互? → run.status = "blocked"
              │                       task.status = "blocked"
              │                       return (等待回复)
              │
              ├─ 查询 executor.status(queueTaskID):
              │
              ├─ status = "queued" / "retrying"
              │    └─ 如果之前 blocked, 恢复为 accepted/running
              │       return (继续等待)
              │
              ├─ status = "running"
              │    └─ 更新 run/task 状态
              │       return (继续轮询)
              │
              ├─ status = "failed"
              │    └─ failRun(): 创建失败 evaluation → task.status = "failed"
              │
              └─ status = "completed"
                   └─ completeRun() → 进入 Phase 6
```

### 3.6 Phase 6: 交付与评估

```
  completeRun(run)
         │
         ├─ 1. 提取交付物:
         │      executor.delivery({ sessionID, since: run.time_started })
         │      └─ 返回 { summary, diffs: FileDiff[] }
         │
         ├─ 2. 创建 Delivery 记录:
         │      ├─ OrchestratorDeliveryTable  (status: "ready")
         │      └─ OrchestratorArtifactTable[] (report, diff, changed_file)
         │
         ├─ 3. 触发 Plugin "delivery.ready"
         │
         ├─ 4. EvaluatorService.evaluate(task, delivery, spec)
         │      │
         │      ├─ 解析 CheckConfig (从 task.metadata.checks)
         │      │
         │      ├─ 阻断性检查 (任一失败立即返回 FAILED):
         │      │   ├─ build   → 执行构建命令
         │      │   ├─ test    → 执行测试命令
         │      │   ├─ lint    → 执行 lint 命令
         │      │   └─ verify_cmd → 执行自定义验证命令
         │      │
         │      ├─ 可选检查 (soft/strict 模式):
         │      │   ├─ startup      → 启动进程并检查 ready_url/ready_text
         │      │   ├─ artifact     → 验证文件变更数量
         │      │   ├─ visual       → fetch 页面检查 title/text
         │      │   ├─ puppeteer    → 启动浏览器截图 + DOM 断言
         │      │   ├─ ui_review    → LLM 审查 UI (generateObject)
         │      │   ├─ code_quality → LLM 代码质量评审
         │      │   ├─ code_review  → LLM 代码审查
         │      │   ├─ dead_code    → LLM 死代码检测
         │      │   └─ spec_check   → 对照 spec 与 required spec items 做最终核验 (默认 enabled)
         │      │
         │      ├─ Plugin 检查 ("evaluation.checks" hook)
         │      │
         │      └─ 汇总判决:
         │           ├─ 任一 strict 检查失败 → FAILED / rejected
         │           ├─ spec_check 发现遗漏、错误或未完成项 → FAILED / rejected
         │           ├─ 所有检查跳过 → INCONCLUSIVE
         │           └─ 阻断命令通过 + spec_check 确认 required spec 全部准确完备实现 → PASSED / accepted
         │
         ├─ 5. 创建 Evaluation 记录
         │
         ├─ 6. 标记通过的 Goal / SpecItem:
         │      ├─ 匹配: goal.metadata.check_selector ∩ evaluation.checks
         │      ├─ 更新匹配 goal.status = "passed"
         │      ├─ 更新 required spec items.status = "done"
         │      └─ 推导 Milestone 状态
         │
         └─ 7. 后续决策:
              │
              ├─ PASSED + 所有 required spec items 完成 + 所有 blocking goals 通过
              │    └─ task.status = "completed" ✅
              │
              ├─ PASSED 但仍有 pending spec items 或 blocking goals
              │    └─ handleEvaluationFailure() → 进入 Phase 7
              │
              └─ FAILED
                   └─ handleEvaluationFailure() → 进入 Phase 7
```

### 3.7 Phase 7: 重试 / 重规划决策

```
  handleEvaluationFailure(task, run, summary)
         │
         └─ retryOrReplan(task, run, summary)
              │
              ├─ 预算检查:
              │   totalRuns = findRuns(task.id).length
              │   totalRuns >= maxRuns (默认 3)?
              │     └─ YES → return false → 任务失败 ❌
              │
              ├─ 重试判断:
              │   run.retry_count < SAME_PLAN_RETRY_LIMIT (默认 1)?
              │     └─ YES → createRetryRun()
              │              │
              │              ├─ 新 Run:
              │              │   phase: "execute"
              │              │   retry_count: run.retry_count + 1
              │              │   prompt_override: buildRetryPrompt(summary)
              │              │     └─ 注入失败上下文到提示词
              │              │   strategy: "retry_same_plan"
              │              │
              │              └─ dispatch(nextRunID)
              │                 └─ 回到 Phase 3 (同一 spec, 同一 plan, 同一 session)
              │
              └─ 重规划判断:
                  replans = findPlans(task.id).length - 1
                  replans < maxReplans (默认 1)?
                    └─ YES → createReplanRun()
                             │
                             ├─ SpecAgent.rewrite()
                             │   └─ 基于失败分析修订 spec
                             │
                             ├─ PlanAgent.replan()
                             │   └─ 基于新 spec 生成新提示词 (含失败分析 + 新策略)
                             │
                             ├─ 旧 plan.status = "superseded"
                             │
                             ├─ 新 PlanVersion:
                             │   version: plan.version + 1
                             │   status: "active"
                             │
                             ├─ 新 Goals (来自 replan 输出)
                             │
                             ├─ 新 Run:
                             │   phase: "replan"
                             │   retry_count: 0
                             │   strategy: "replan"
                             │
                             └─ dispatch(nextRunID)
                                └─ 回到 Phase 2 (先修订 spec，再生成新 plan, 同一 session)
```

---

## 4. 预算与限制常量

| 常量 | 默认值 | 说明 |
|------|--------|------|
| `ORCHESTRATOR_POLL_INTERVAL_MS` | 1500 | 轮询间隔 (ms) |
| `SAME_PLAN_RETRY_LIMIT` | 1 | 同一 plan 最大重试次数 |
| `DEFAULT_MAX_RUNS` | 3 | 单任务最大运行总数 |
| `DEFAULT_MAX_REPLANS` | 1 | 单任务最大重规划次数 |

**决策树简化:**

```
总运行数 >= max_runs?                     → 失败
当前 plan 重试次数 < SAME_PLAN_RETRY_LIMIT? → 重试 (同 plan)
已重规划次数 < max_replans?                → 重规划 (新 plan)
否则                                      → 失败
```

**典型场景 (默认预算):**

```
Run 1: 首次执行 (plan v1, retry 0)
  └─ 失败 → retry_count(0) < 1 → 重试

Run 2: 重试 (plan v1, retry 1)
  └─ 失败 → retry_count(1) >= 1 → 检查重规划
           → replans(0) < 1 → 重规划

Run 3: 重规划执行 (plan v2, retry 0)
  └─ 失败 → totalRuns(3) >= 3 → 任务失败 ❌
```

---

## 5. 交互处理流程

```
  Session 执行中遇到需要权限或提问
         │
         ├─ Permission 请求:
         │    PermissionNext.Event.Asked
         │      └─ OrchestratorInteraction.upsertPermission()
         │           ├─ 创建 InteractionRequest (type: "permission", status: "pending")
         │           ├─ 发布 InteractionRequested 事件
         │           └─ syncRun() → run.status = "blocked"
         │                          task.status = "blocked"
         │
         ├─ Question 请求:
         │    Question.Event.Asked
         │      └─ OrchestratorInteraction.upsertQuestion()
         │           ├─ 创建 InteractionRequest (type: "question", status: "pending")
         │           ├─ 发布 InteractionRequested 事件
         │           └─ syncRun() → run.status = "blocked"
         │
         │  ─── 等待用户回复 ───
         │
         ├─ POST /interaction/:id/reply
         │    ├─ permission → PermissionNext.reply({ reply: "once"|"always" })
         │    └─ question  → Question.reply({ answers })
         │    └─ 更新 interaction.status = "answered"
         │    └─ syncRun() → 无 pending interactions → run.status = "accepted"
         │
         └─ POST /interaction/:id/reject
              ├─ permission → PermissionNext.reply({ reply: "reject" })
              └─ question  → Question.reject()
              └─ 更新 interaction.status = "rejected"
```

---

## 6. 操作员介入点

| 操作 | API | 效果 |
|------|-----|------|
| 发送消息 | `POST /task/:id/message` | WorkbenchService 解析意图 → 记录 note/preference/goal → 如有必要创建新 Run |
| 重试 | `POST /task/:id/retry` | 在已完成/失败任务上创建新 Run (同一 plan) |
| 重规划 | `POST /task/:id/replan` | 创建新 PlanVersion + 新 Run |
| 取消 | `POST /task/:id/cancel` | 中止执行器 → run=aborted, task=cancelled |
| 中止运行 | `POST /run/:id/abort` | 仅中止特定 Run |
| 回复交互 | `POST /interaction/:id/reply` | 解除阻塞、恢复执行 |
| 拒绝交互 | `POST /interaction/:id/reject` | 拒绝权限/问题 |

---

## 7. 事件流 (SSE)

**端点:** `GET /task/:id/events`

| 事件类型 | 载荷 |
|----------|------|
| `task.created` | taskID, status, summary |
| `task.updated` | taskID, status, summary |
| `spec.created` | taskID, specID, summary |
| `spec.updated` | taskID, specID, status, summary |
| `spec.approved` | taskID, specID, summary |
| `plan.created` | taskID, planID, summary |
| `plan.activated` | taskID, planID, summary |
| `run.created` | taskID, runID, status, summary |
| `run.updated` | taskID, runID, status, summary |
| `interaction.requested` | taskID, runID, interactionID, type, title |
| `interaction.resolved` | taskID, runID, interactionID, status |
| `delivery.ready` | taskID, runID, deliveryID, summary |
| `evaluation.completed` | taskID, runID, evaluationID, status, verdict |
| `goal.passed` | taskID, goalID, summary |
| `goal.failed` | taskID, goalID, summary |
| `milestone.passed` | taskID, milestoneID, summary |
| `milestone.failed` | taskID, milestoneID, summary |
| `task.message.recorded` | taskID, kind, source, text |

---

## 8. 评估检查清单

`spec_check` 默认勾选，并作为最终验收门。只要 required spec 仍有遗漏、歧义或未完成项，任务就不能被标记为验收通过。

```
┌──────────────────────────────────────────────────────────────┐
│  阻断性检查 (任一失败 → 整体 FAILED)                         │
│                                                              │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌───────────┐       │
│  │  build  │  │  test   │  │  lint   │  │verify_cmd │       │
│  │ 构建命令 │  │ 测试命令 │  │ 代码检查 │  │ 自定义验证 │       │
│  └─────────┘  └─────────┘  └─────────┘  └───────────┘       │
├──────────────────────────────────────────────────────────────┤
│  可选检查 (soft = 不阻断 / strict = 阻断)                    │
│                                                              │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐ │
│  │ startup │  │ artifact │  │  visual  │  │  puppeteer    │ │
│  │启动就绪  │  │ 文件变更  │  │ 页面加载  │  │ 浏览器截图+DOM│ │
│  └─────────┘  └──────────┘  └──────────┘  └───────────────┘ │
│  ┌───────────┐  ┌────────────┐  ┌───────────┐  ┌─────────┐  │
│  │ ui_review │  │code_quality│  │code_review│  │dead_code│  │
│  │LLM UI审查 │  │LLM质量评审  │  │LLM代码审查 │  │LLM死代码 │  │
│  └───────────┘  └────────────┘  └───────────┘  └─────────┘  │
│  ┌────────────┐  ┌──────────┐                                │
│  │ spec_check │  │  custom  │                                │
│  │按 spec 验收│  │ 插件检查  │                                │
│  └────────────┘  └──────────┘                                │
└──────────────────────────────────────────────────────────────┘
```

---

## 9. 数据模型关系

```
  Task (1)
    │
    ├── SpecVersion (1..N)     ← active_spec_version_id 指向当前
    │     │
    │     └── SpecItem (1..N)  ← required acceptance items
    │
    ├── PlanVersion (1..N)     ← 基于当前 spec 生成
    │     │
    │     ├── Goal (1..N)      ← 每个 plan 版本有独立的 goals
    │     │
    │     └── Milestone (0..N) ← 可选的里程碑分组
    │
    ├── Run (1..N)             ← active_run_id 指向当前
    │     │
    │     ├── Delivery (0..1)  ← 运行完成后生成
    │     │
    │     ├── Evaluation (0..1)← 交付后评估
    │     │
    │     └── Artifact (0..N)  ← 产物 (diff, report, screenshot 等)
    │
    ├── InteractionRequest (0..N)  ← 权限/问题请求
    │
    ├── ProgressSnapshot (0..N)    ← 状态变更历史
    │
    └── ChannelBinding (0..1)      ← Slack/Telegram 绑定

  Session (1) ◄──── Task.session_id
    │
    ├── TaskPlan (0..N)       ← PlannerTool 在 session 中创建的任务树
    ├── Session Memory (0..N) ← MemoryTool scope=session
    └── Session Preference (0..N) ← PreferenceTool / task message scope=session

  Project (1)
    ├── Global Memory (0..N)      ← MemoryTool 默认 scope=global
    └── Global Preference (0..N)  ← PreferenceTool / task message 默认 scope=global
```

---

## 10. 执行器适配

```
  ExecutorRegistry
    │
    ├── "opencode" → OpencodeExecutor
    │     ├─ submit: TaskQueueService.enqueuePrompt()
    │     ├─ status: 查询 TaskQueueTable
    │     ├─ delivery: Session.messages() + Session.diff()
    │     ├─ abort: SessionPrompt.cancel()
    │     └─ events: Bus.subscribeAll() 过滤 sessionID
    │
    ├── "codex" → ManagedCodingExecutor(codexProvider)
    │     └─ provider.run({ model, prompt, cwd, system })
    │
    └── "claude-code" → ManagedCodingExecutor(claudeCodeProvider)
          └─ provider.run({ model, prompt, cwd, system })
```

---

## 11. Overlay / Console 创建任务与查看状态

```
  Overlay 表单提交
    │
    ├─ 收集表单数据:
    │    ├─ request (必填)
    │    ├─ title (可选)
    │    ├─ executor: "opencode" | "claude-code" | "codex"
    │    ├─ priority: "normal" | "high" | "low"
    │    ├─ 右侧控件区: spec / plan / goals / checks / evaluation / delivery
    │    │   └─ spec 位于 plan 之前，展示当前 spec 与 required spec items
    │    └─ checks: 复选框映射
    │         ├─ c_lint      → { lint: [] }
    │         ├─ c_build     → { build: [] }
    │         ├─ c_test      → { test: [] }
    │         ├─ c_code_quality → { code_quality: { enabled: true } }
    │         ├─ c_code_review  → { code_review: { enabled: true } }
    │         ├─ c_puppeteer    → { puppeteer: { target: "web", url: "..." } }
    │         └─ c_spec_check   → { spec_check: { enabled: true, strict: true } }  (默认勾选)
    │
    ├─ POST /task  (带 Basic Auth)
    │
    └─ 轮询 SSE /task/:id/events 获取实时状态
```
