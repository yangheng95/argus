# Async Pipeline & Instance Isolation Refactor

## Problem Statement

OpenCorvus 的 orchestrator pipeline 有三个结构性缺陷导致竞态、超时和不可观测性：

1. **POST /task 同步阻塞**：spec → goal → plan 全部在一个 HTTP 请求里同步完成（4-5 分钟），导致 API 超时、overlay 无法观测中间状态、任何阶段失败都丢失所有进度。
2. **Instance 共享 + 隐式 dispose**：Config.updateGlobal、DELETE /global、TUI reload 都会触发 Instance.disposeAll()，杀死正在运行的 executor session。
3. **无阶段边界**：spec/goal/plan/execute/evaluate/deliver 没有独立的生命周期，共享同一个 async context，任意一个阶段的异常能级联影响其他阶段。

---

## Design

### 1. POST /task 异步化

**Before:**
```
POST /task → [spec → goal → plan → persist → dispatch] → 202 {task_id}
             ~~~~~~~~~ 4-5 min sync blocking ~~~~~~~~~
```

**After:**
```
POST /task → [validate input → persist task(status=queued)] → 202 {task_id}
             ~~~~~~ <100ms ~~~~~~

Background: poll loop 每 1.5s 调用 advanceTaskStage(taskID)
  status=queued           → 启动 spec    → status=spec_generating
  status=spec_generating  → (等待完成)   → spec 完成后写 DB, status=goal_decomposing
  status=goal_decomposing → (等待完成)   → goal 完成后写 DB, status=planning
  status=planning         → (等待完成)   → plan 完成后写 DB + 创建 run, status=planned
  status=planned          → dispatch()   → status=running
  status=running          → (executor)   → status=evaluating
  status=evaluating       → (evaluator)  → status=delivering
  status=delivering       → (publisher)  → status=completed
```

#### 1.1 Task Status 状态机

```typescript
type TaskStatus =
  | "queued"           // 刚创建，等待 spec 生成
  | "spec_generating"  // spec agent 运行中
  | "goal_decomposing" // goal compiler 运行中
  | "planning"         // planner agent 运行中
  | "planned"          // plan 就绪，等待 dispatch
  | "running"          // executor 执行中
  | "evaluating"       // evaluator 评估中
  | "delivering"       // publisher 发布中
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked"          // 需要用户交互（clarification）
```

合法转换（除 → failed/cancelled 可从任何状态触发外）：
```
queued → spec_generating → goal_decomposing → planning → planned → running
running → evaluating → delivering → completed
running → blocked → running  (interaction resolved)
```

#### 1.2 createTask() 只做 DB insert

```typescript
// service.ts
async function createTask(raw) {
  const input = CreateTaskInput.parse(raw)
  // validate, create session, set permissions — 和现在一样
  const taskID = Identifier.ascending("task")
  persistQueuedTask({
    taskID, sessionID, projectID, title, request,
    executor, routing, goals, milestones,
    budget, priority, metadata, channelBinding,
  })
  // 不调用 compileTransition(), 不调用 dispatch()
  return taskID  // <100ms 返回
}
```

`persistQueuedTask()` 只做：
- INSERT engine_task (status="queued")
- INSERT orchestrator_progress_snapshot
- persist channel binding
- emit Event.TaskCreated
- 把 executor/routing/goals/milestones 存入 task.metadata._pipeline，供 advanceTaskStage 读取

#### 1.3 advanceTaskStage() — 核心：每次只推进一个阶段

```typescript
// pipeline.ts (新文件，不放在 persist.ts 避免文件膨胀)
export async function advanceTaskStage(
  taskID: string,
  hooks: RuntimeHooks,
): Promise<void> {
  const task = requireTask(taskID)
  const pipeline = task.metadata?._pipeline as PipelineMetadata

  switch (task.status) {
    case "queued":
      return runSpecStage(task, pipeline, hooks)
    case "spec_generating":
      return // 正在运行，跳过（由 in-memory tracking 判断）
    case "goal_decomposing":
      return // 正在运行，跳过
    case "planning":
      return // 正在运行，跳过
    case "planned":
      return runDispatch(task, pipeline, hooks)
    default:
      return // 非 pipeline 状态，跳过
  }
}
```

每个 stage function 的执行模式：
```typescript
async function runSpecStage(task, pipeline, hooks) {
  // 1. 更新状态 → spec_generating
  task = await hooks.updateTask(task, { status: "spec_generating" }, "Spec generation started")

  // 2. 创建独立 AbortController + timeout
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort("spec timeout"), stageTimeout("spec"))

  try {
    // 3. 执行 spec agent（传入 signal）
    const specDraft = await SpecService.initial({
      title: task.title,
      request: task.request,
      signal: ctrl.signal,     // ← 关键：传入 signal
      ...
    })

    // 4. 立即写 DB
    const specSnapshotID = Identifier.ascending("spec")
    Database.transaction(db => {
      persistSpecSnapshot(db, { taskID: task.id, specSnapshotID, specDraft, ... })
      db.update(EngineTaskTable)
        .set({ active_spec_version_id: specSnapshotID })
        .where(eq(EngineTaskTable.id, task.id))
        .run()
    })

    // 5. 推进到下一状态 → goal_decomposing
    //    下一个 poll cycle 的 advanceTaskStage 会执行 goal stage
    await hooks.updateTask(task, { status: "goal_decomposing" }, "Spec done, starting goal decomposition")

  } catch (error) {
    await hooks.updateTask(task, {
      status: "failed",
      error: `Spec failed: ${error.message}`,
      time_completed: Date.now(),
    }, "Spec stage failed")
  } finally {
    clearTimeout(timer)
  }
}
```

**关键设计决策**：每个 stage function 执行完后将状态设为下一阶段的**起始状态**（不是 "xxx_done"）。下一个 poll cycle 看到新状态后 advanceTaskStage 会触发下一阶段。但因为 stage 内是 async 的（可能运行几分钟），poll loop 需要 in-memory tracking 来避免重复启动。

#### 1.4 Poll loop 集成

```typescript
// runtime.ts
const runningStages = new Map<string, Promise<void>>()  // taskID → stage promise

export async function poll(hooks) {
  // 1. 查找 pipeline 状态的 task
  const pipelineTasks = Database.use(db =>
    db.select({ id: EngineTaskTable.id, status: EngineTaskTable.status })
      .from(EngineTaskTable)
      .where(and(
        eq(EngineTaskTable.project_id, Instance.project.id),
        inArray(EngineTaskTable.status,
          ["queued", "spec_generating", "goal_decomposing", "planning", "planned"]),
      ))
      .all()
  )

  for (const row of pipelineTasks) {
    // 跳过正在执行的 stage
    if (runningStages.has(row.id)) continue

    // spec_generating / goal_decomposing / planning 正在运行中 → 跳过
    // 只有 queued 和 planned 需要启动新 stage
    if (row.status === "spec_generating"
      || row.status === "goal_decomposing"
      || row.status === "planning") {
      continue
    }

    const p = advanceTaskStage(row.id, hooks)
      .finally(() => runningStages.delete(row.id))
    runningStages.set(row.id, p)
  }

  // 2. 原有的 syncRun 逻辑（不变）
  // ...

  // 3. 恢复 stranded tasks（扩展支持 pipeline 状态）
  recoverStrandedTasks(hooks)
}
```

**问题**：如果 spec_generating 阶段的 stage function 内部完成了 spec 并把状态改成 goal_decomposing，那下一个 poll cycle 会看到 goal_decomposing 但 runningStages 里没有这个 task（因为 spec stage 的 promise 已经 resolve）。这时需要启动 goal stage。

修正：advanceTaskStage 在每个 stage function 完成后，如果有下一阶段，**不靠 poll loop 触发，而是直接链式调用下一个 stage**：

```typescript
async function runSpecStage(task, pipeline, hooks) {
  // ... spec 执行 + 写 DB ...
  task = await hooks.updateTask(task, { status: "goal_decomposing" }, "...")

  // 直接链式调用下一个 stage（不等 poll loop）
  return runGoalStage(task, pipeline, hooks)
}

async function runGoalStage(task, pipeline, hooks) {
  // ... goal 执行 + 写 DB ...
  task = await hooks.updateTask(task, { status: "planning" }, "...")
  return runPlanStage(task, pipeline, hooks)
}

async function runPlanStage(task, pipeline, hooks) {
  // ... plan 执行 + 写 DB + 创建 run ...
  await hooks.updateTask(task, { status: "planned" }, "...")
  // dispatch 由 poll loop 在 "planned" 状态触发
}
```

这样每个 stage 仍然独立持久化（crash recovery），但正常执行时不需要等 1.5s poll 间隔。Poll loop 的作用是：
- **正常路径**：只触发第一个 stage（queued → spec），后续链式执行
- **Recovery 路径**：server crash 后，poll loop 看到 goal_decomposing 状态，启动 goal stage（从 DB 读取 spec 结果）
- **Dispatch 路径**：poll loop 看到 planned 状态，调用 dispatch()

#### 1.5 Crash recovery

每个 stage function 需要能从 DB 恢复输入：

```typescript
async function runGoalStage(task, pipeline, hooks) {
  // Recovery: 如果 task 已有 active_spec_version_id，从 DB 读取 spec
  const specSnapshotID = task.active_spec_version_id
  if (!specSnapshotID) {
    // 不应该在 goal stage 没有 spec，回退到 failed
    return hooks.updateTask(task, { status: "failed", ... }, "No spec for goal stage")
  }
  const specDraft = reconstructSpecFromDB(specSnapshotID)
  // ... 执行 goal ...
}
```

recovery 条件：
| 状态 | DB 中应该有 | recovery 动作 |
|------|------------|--------------|
| spec_generating | task row | 重新执行 spec stage |
| goal_decomposing | task + spec snapshot | 从 DB 读 spec，执行 goal stage |
| planning | task + spec + goal snapshot | 从 DB 读 spec+goal，执行 plan stage |
| planned | task + spec + goal + plan + run(queued) | 直接 dispatch |

#### 1.6 recoverStrandedTasks 扩展

```typescript
function recoverStrandedTasks(hooks) {
  const stranded = Database.use(db =>
    db.select().from(EngineTaskTable).where(and(
      eq(EngineTaskTable.project_id, Instance.project.id),
      inArray(EngineTaskTable.status, [
        "spec_generating", "goal_decomposing", "planning",  // pipeline
        "evaluating", "delivering",                          // execution
      ]),
    )).all()
  )
  for (const task of stranded) {
    const age = Date.now() - (task.time_updated ?? task.time_created ?? 0)
    const isPipeline = ["spec_generating", "goal_decomposing", "planning"].includes(task.status)
    const threshold = isPipeline ? PIPELINE_STALE_MS : EVALUATING_STALE_MS

    if (age < threshold) continue
    if (runningStages.has(task.id)) continue  // 正在运行
    if (task.active_run_id && evaluatingRuns.has(task.active_run_id)) continue

    // 对 pipeline 状态：不直接 fail，而是重新触发 stage（recovery）
    if (isPipeline) {
      const p = advanceTaskStage(task.id, hooks)
        .finally(() => runningStages.delete(task.id))
      runningStages.set(task.id, p)
      continue
    }
    // 对 execution 状态：fail（和现在一样）
    hooks.updateTask(task, { status: "failed", error: "...", time_completed: Date.now() }, "...")
  }
}
```

### 2. Instance 隔离

#### 2.1 审计结果

Instance.dispose() / disposeAll() 的调用点审计：

| 文件 | 触发 | 影响 | 处理 |
|------|------|------|------|
| `config.ts:1459` Config.updateGlobal() | 全局配置更新 | disposeAll — 杀死所有 session | **改为 global.reset()** |
| `server/routes/app.ts:100` DELETE /app | 用户主动 | dispose — 杀死当前 instance | **加 isSessionActive guard** |
| `server/routes/project.ts:76` POST /project/init-git | git 初始化成功 | dispose — 杀死当前 instance | **加 isSessionActive guard** |
| `server/routes/global.ts:174` DELETE /global | 用户主动 | disposeAll — 杀死所有 session | **加 isSessionActive guard + 警告** |
| `cli/cmd/tui/worker.ts:114,120` TUI reload/shutdown | TUI 操作 | disposeAll — 杀死所有 session | **加 isSessionActive guard** |
| `cli/bootstrap.ts:13` CLI cleanup | CLI 退出 | dispose — cleanup | OK（CLI 没有 long-running session） |
| `goal/runner.ts:355` workspace cleanup | goal 完成后 | dispose — 清理 workspace instance | OK（已完成的 goal） |

#### 2.2 Instance.provide() 安全性

审计结论：
- `Instance.provide()` **不会内部调用 dispose()**  ✅
- cache hit 时只 scope context，不 recreate  ✅
- cache miss 时创建新 instance，不 dispose 旧的  ✅
- Server middleware (server.ts:118) 每个 HTTP request 都调用 provide()，但只是 scope context  ✅

**不需要改动 Instance.provide()**。

#### 2.3 Config.updateGlobal() 修复

```typescript
// config.ts — Config.updateGlobal()
// Before: await Instance.disposeAll()
// After:
global.reset()  // 只重置配置缓存，不 dispose instance
```

#### 2.4 isSessionActive() guard

```typescript
// runtime.ts 或 instance-guard.ts
export function hasActiveSessions(): boolean {
  return Database.use(db =>
    db.select({ id: EngineRunTable.id })
      .from(EngineRunTable)
      .innerJoin(EngineTaskTable, eq(EngineRunTable.task_id, EngineTaskTable.id))
      .where(and(
        eq(EngineTaskTable.project_id, Instance.project.id),
        inArray(EngineRunTable.status, ["accepted", "running"]),
      ))
      .limit(1)
      .get()
  ) !== undefined
}

// 在 DELETE /app, DELETE /global, POST /project/init-git, TUI reload 之前调用：
if (hasActiveSessions()) {
  log.warn("skipping dispose: active executor sessions exist")
  return  // 或者返回 409 Conflict
}
```

#### 2.5 SessionPromptState 解耦

```typescript
// prompt-state.ts
// Before:
export const state = Instance.state(
  () => ({ ... }),
  async (current) => {
    for (const item of Object.values(current)) {
      item.abort.abort()  // ← 这行杀死所有 session
    }
  },
)

// After:
export const state = Instance.state(
  () => ({ ... }),
  // 不提供 dispose callback — session 只通过 cancel(sessionID) 显式终止
)
```

### 3. 阶段隔离

#### 3.1 StageRunner 接口

```typescript
// pipeline.ts
interface StageRunner<Input, Output> {
  name: string
  timeout: () => number  // 从环境变量读，单位 ms
  run(input: Input, signal: AbortSignal): Promise<Output>
}
```

#### 3.2 AbortSignal 传播链修复

当前状态（审计结果）：
| 服务 | 接受 signal? | 实际使用? | 传给 LLM? |
|------|-------------|----------|----------|
| SpecService.initial() | ✅ 有参数 | ✅ 使用 | ✅ 传给 SpecAgent |
| HeadlessGoalService.initial() | ✅ 有参数 | ❌ 未使用 | ❌ |
| PlannerService.initial() | ❌ 无参数 | N/A | N/A |

**需要修复**：

1. **GoalService**: `run()` 函数需要把 `input.signal` 传递到内部的 LLM 调用
2. **PlannerService.initial()**: 增加 `signal?: AbortSignal` 参数，传递到 `PlannerAgent.plan()`

```typescript
// planner/service.ts — PlannerService.initial()
export async function initial(input: {
  title: string
  request: string
  spec?: SpecDraft
  goals?: GoalInput[]
  allowClarification?: boolean
  executor?: ExecutorNameInfo
  routing?: StageRouting
  signal?: AbortSignal           // ← 新增
  timeoutMs?: number
  stream?: TextHooks
  onStatus?: StatusHook
}): Promise<PlanDraft>

// goal/service.ts — run() 内部
// 确保 signal 传递到 LLM agent 调用
```

#### 3.3 Stage timeout 配置

该设计稿里的 stage-level timeout helper 已被删除。当前实现不再为 requirements / architect / planner / delivery 维护单独的 agent timeout 配置入口；保留的超时只属于底层外部 I/O 边界。

#### 3.4 withStageRetry 集成

```typescript
async function runSpecStage(task, pipeline, hooks) {
  task = await hooks.updateTask(task, { status: "spec_generating" }, "...")
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), stageTimeout("spec"))
  try {
    const specDraft = await withStageRetry("spec", async () => {
      return SpecService.initial({
        ...,
        signal: ctrl.signal,
      })
    })
    // persist + advance
  } catch (error) {
    // fail task
  } finally {
    clearTimeout(timer)
  }
}
```

### 4. Event Bus 改造

#### 4.1 当前问题

`Bus.publish()` 是同步 in-memory dispatch，subscriber 和 emitter 共享 async context。如果 subscriber 阻塞或抛异常，会影响 emitter。

#### 4.2 方案：双写 + 渐进迁移

**Phase 4a**: 双写（不破坏现有行为）
```typescript
// bus/index.ts — Bus.publish()
export async function publish<D extends BusEvent.Definition>(def: D, properties: ...) {
  // 1. 原有 in-memory dispatch（不变）
  for (const sub of [...]) { sub(payload) }

  // 2. 新增：写 protocol_event 表（audit log）
  try {
    ProtocolStore.appendEvent({
      type: def.type,
      aggregate: "bus",
      payload: properties,
      ...
    })
  } catch {
    // best effort — 不影响原有流程
  }
}
```

**Phase 4b**: inbox delivery loop（独立 poll loop）
```typescript
// protocol/inbox-delivery.ts
export function startInboxDelivery() {
  Schedule.register({
    name: "protocol-inbox-delivery",
    interval: 500,  // 500ms
    scope: "instance",
    run: async () => {
      const pending = ProtocolStore.readPendingInbox()
      for (const item of pending) {
        try {
          await deliverToSubscriber(item)
          ProtocolStore.markDelivered(item.id)
        } catch {
          ProtocolStore.markFailed(item.id)
        }
      }
    },
  })
}
```

**Phase 4c**: 迁移 subscriber 到 inbox delivery（后续 PR）
- 逐个 subscriber 从 `Bus.subscribe()` 迁移到 inbox-based delivery
- 最终移除 in-memory dispatch

#### 4.3 protocol_event / protocol_inbox 表

DDL 已就绪（storage/ddl.ts 已添加）。schema:
- `protocol_event`: id, type, aggregate, aggregate_id, task_id, payload, emitted_at
- `protocol_inbox`: id, event_id, subscriber, status(pending/delivered/failed), delivered_at

### 5. Replan 流程

Replan 仍使用 `compileTransition()` + `persistReplanTransition()`（同步执行，在 poll loop 的 handleEvaluationFailure 中调用）。原因：
- Replan 在 completeRun → handleEvaluationFailure 中触发，此时已经在 poll loop 的 async context 中
- Replan 不阻塞 HTTP handler
- 将 replan 也异步化是后续优化，不在本次范围

### 6. 向后兼容

需要更新以下检查 task.status 的代码：

| 位置 | 当前检查 | 需要更新 |
|------|---------|---------|
| `service.ts` listTasks counts | `running`, `evaluating`, `blocked`, `completed`, `failed` | 加 `spec_generating`, `goal_decomposing`, `planning`, `planned` 到 running_tasks |
| `TASK_TERMINAL_STATUSES` | `blocked`, `completed`, `failed`, `cancelled` | 不变（新状态不是 terminal） |
| `model.ts` Task.status Zod enum | 9 个值 | 加 `spec_generating`, `goal_decomposing`, `planned` |
| `model.ts` ProgressSnapshot.status Zod enum | 6 个值 | 加 pipeline 状态 |
| `orchestrator.sql.ts` EngineTaskStatus | 9 个值 | 加 3 个 |
| `helpers.ts` progressStatus() | 只映射 5 个 | 加 pipeline 状态映射 |
| overlay-web-benchmark | 检查 taskStatus | 需要等待 pipeline 状态过渡，不把 `spec_generating` 当作 stall |

---

## 文件清单

| 文件 | 改动类型 | 内容 |
|------|---------|------|
| `orchestrator/orchestrator.sql.ts` | 修改 | 加 `spec_generating`, `goal_decomposing`, `planned` |
| `orchestrator/model.ts` | 修改 | Task.status + ProgressSnapshot.status Zod enum |
| `orchestrator/helpers.ts` | 修改 | progressStatus() |
| **`orchestrator/pipeline.ts`** | **新建** | advanceTaskStage(), runSpecStage(), runGoalStage(), runPlanStage(), runDispatch(), StageRunner 接口 |
| `orchestrator/persist.ts` | 修改 | 加 persistQueuedTask()；不动 compileTransition (replan 用) |
| `orchestrator/service.ts` | 修改 | createTask() 只调 persistQueuedTask() |
| `orchestrator/runtime.ts` | 修改 | poll() 加 pipeline advancement; recoverStrandedTasks() 加 pipeline recovery |
| `session/prompt-state.ts` | 修改 | 移除 dispose callback |
| `config/config.ts` | 修改 | Config.updateGlobal() 不再 disposeAll |
| `server/routes/app.ts` | 修改 | DELETE /app 加 isSessionActive guard |
| `server/routes/global.ts` | 修改 | DELETE /global 加 isSessionActive guard |
| `server/routes/project.ts` | 修改 | POST /project/init-git 加 isSessionActive guard |
| `planner/service.ts` | 修改 | initial() 加 signal 参数 |
| `goal/service.ts` | 修改 | run() 传递 signal 到 LLM 调用 |
| `bus/index.ts` | 修改 | publish() 加 protocol_event 双写 |

---

## 实施顺序

1. **类型 + 状态**：orchestrator.sql.ts, model.ts, helpers.ts
2. **Instance 保护**：prompt-state.ts 解耦, config.ts updateGlobal 修复, isSessionActive guard
3. **Signal 修复**：planner/service.ts 加 signal, goal/service.ts 传 signal
4. **新文件 pipeline.ts**：StageRunner, advanceTaskStage, stage functions, crash recovery
5. **persist.ts**：加 persistQueuedTask()
6. **service.ts**：createTask() 只调 persistQueuedTask()
7. **runtime.ts**：poll() 加 pipeline advancement + recovery
8. **Event Bus 双写**：bus/index.ts
9. **Benchmark 验证**

---

## Verification

每步必须通过 overlay-web-benchmark：
```bash
cd packages/opencorvus
bun run script/benchmark/overlay-web-benchmark.ts \
  "--request-file=D:\myhexin-local\argus-opencode\specs\prd-moment-diary-frontend.txt" \
  "--stall-timeout-ms=1200000" \
  "--planning-stall-timeout-ms=7200000"
```

验收标准：
- taskStatus: "completed"
- evaluation: "accepted"
- changedFiles 包含实际源码文件（非空）
- qualityVerdict: "accepted"
- POST /task 响应 <1s
