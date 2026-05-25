# Spec 1：Assistant Backend Foundation（v3，含 codex 三审修订）

> 日期：2026-05-25
> 修订：
> - v2 — 整合 codex 二审 must-fix（`_codex_spec_review_round2.log`）
> - v3 — 整合 codex 三审（3b）must-fix（`_codex_spec_review_round3b.log`）
> - **v3.1** — 整合 codex 四审 cleanup（`_codex_spec_review_round4.log`）：§5.2 `resolveOwner` 改用 `Session.peekSync` + `parentID` 字段；§5.9 route 校验改 `await Session.get` + `parentID`；§5.2 `syncSession` 明确**不重复 emit** InteractionResolved；§6.1.B schema 描述清理
> 状态：**APPROVED**（codex 六轮独立复检：round-1/2/3b/4/5/6，详见 v3.1 修订摘要前的版本链）
> 作者：Claude（基于 codex 一审 / 二审 / 三审 / 四审 / 五审 / 六审 APPROVE）
> 替代：`coding-assistant-right-panel-2026-05-25.md` 的后端部分
> 配套：`assistant-right-panel-ui-2026-05-25.md`（UI 层，硬依赖本 spec 完成）

## v3 修订摘要（相对 v2，整合 codex 三审 6 项 must-fix）

1. **§5.1 `scopeForSession()` 改同步**：`Session.get()` 是 async (`session/index.ts:342`)，bridge 是同步 dispatch。v2 示例 `Session.get(sessionID)` 在同步路径调用会 crash。改为新增 `Session.peekSync(id)` 同步 API（内部 `Database.use(db => db.select().from(SessionTable).where(eq(id, id)).get())` 已是同步），或维护 metadata in-memory cache。
2. **§6.1 schema 事实修正**：`engine_interaction_request.task_id` 当前是 **NOT NULL** (`storage/ddl.ts:578`)，`session_id` 当前是 **nullable** (`:580`)——v2 写反了。v3 改为 `task_id nullable, session_id NOT NULL` + CHECK 约束至少一个；rule 18 reset DB 重建。
3. **§5.4 `dispatchEphemeral` 必须泛化**：v2 只说"appendEvent 支持 session aggregate"，但 `dispatchEphemeral` (`protocol/store.ts:447-491`) 当前 `aggregateID = taskID ?? ""`、`taskLiveSequences/taskLiveReplayEvents` 全部 per-task。session ephemeral 会落成 `aggregateID=""`、**无 replay buffer**。v3 §5.4 / §6.3 明确 store 内部三个 Map 与 dispatch 路径同步泛化为 by-`(aggregate, aggregateID)`。
4. **§6.3 `/events` 加 `after_live` 参数**：v2 backend 只写 `after`，UI spec 写 `after=&after_live=`，两者协议不一致。v3 锁定 backend 与 task 端同形（`after` + `after_live` + `after_live_epoch`），UI 不变。
5. **§6.4 interaction hydrate 单源锁定**：v2 在 UI spec 留了"messages 附带 vs 独立 endpoint"两选项（rule 8 双源）。v3 锁定 **messages endpoint 附带 `pendingInteractions: InteractionRecord[]`**，**不**新增 `/interactions` endpoint。reducer 端按 `interactionID` upsert 去重（POST stream live event 与 hydrate 列同 ID 自然合并）。
6. **§6.2 / §6.3 SSE event union 完整化**：v2 §6.2 与 §6.3 之间事件 union 不严格一致。v3 明确列表：POST stream 8 类（`session/message/part/delta/interaction/status/error/done`）+ GET events 4 类（`status/error/interaction/interaction.resolved`，无 `done`/`session`/`message`/`part`/`delta`）。reducer 对所有 12 个 case 显式 switch，不依赖默认分支。

下方原 v2 内容保留，v3 改动在以下章节就地修订（§5.1、§5.2、§5.4、§6.1、§6.2、§6.3、§6.4、§7 改动表、§8 工作量）。

---

## v2 修订摘要（相对 v1）

1. **§0 / §1** 纠正了 bridge 机制描述：message events 走 `ProtocolStore.dispatchEphemeral`（**live SSE only，永不进 protocol_event 表**——`message-bridge.ts:275-283` 注释明示，rule 8 单源）；lifecycle / error events 走 `ProtocolStore.appendEvent`（进 protocol_event 表，可 replay）。v1 把这两条路径混为一谈是错的。
2. **§5.4 / §6.3 整段重写**：assistant resume **不再** 试图把 message/part/delta 写入 protocol_event（v1 设计违反单源）。改为与 task 端相同模式：messages endpoint 全量 hydrate + lifecycle/error events cursor replay。
3. **§5.1** 加入第三个 bridge 函数 `bridgeSessionError` (`message-bridge.ts:354`) 的改造，v1 漏写。
4. **§5.2** interaction 调用点全面修正：v1 引用了不存在的 `routes/interaction.ts`；真实链路是 `engine/model.ts:1219-1239` 的 schema + `task-api/index.ts:1330/1358` 的 `replyInteraction/rejectInteraction` + `engine/store.ts:1368` 的 `listInteractions(taskID)` + `orchestrator.ts:1366/1391` 的 reply/reject 路由。
5. **§6.1** schema：复用现有 `aggregate_type/aggregate_id` 列（`aggregate="session", aggregate_id=<sessionID>`），**不**新加 task_id/session_id 互斥列——后者会与现有所有 `aggregate="task"` 查询并存形成双轨。
6. **§5.3** 完善：(a) `coding.ts` SSE route 补订阅 `SessionStatus.Event.Idle` 与 `SessionEvents.Error`（bridge 已订阅但 route 没转发给客户端）；(b) 补订阅 `PermissionNext.Event.Asked` / `Question.Event.Asked` 并发 `interaction` 事件。
7. **新 §5.9** session 入参三联校验：`kind="assistant"` + `parent_id IS NULL` + `directory == Instance.directory`，否则 400。
8. **§6.2** 加入 `error` event；明确 `status` 的对象契约。
9. **新 §5.10** compaction 上限的后端数据契约（terminal reason）。
10. **§8** 工作量调到 16-24 天。

---

## 0. 一句话结论

把 OpenCorvus 的事件 / interaction / session 校验 / list / 输入 schema **从 task-scoped 升级为 task 或 session 二选一 scope（用现有 `aggregate_type/aggregate_id` 复用单源）**，让 `kind="assistant"` 顶层 session 与 task 平权地走完整生命周期。**严守现有不变式**：message/part 是 `message`/`part` 表的单源，永不进 `protocol_event`；lifecycle/error 在 `protocol_event` 表，可 cursor replay。前端 hydrate = messages endpoint 全量 + lifecycle events cursor 增量。这是 UI 侧动手的硬前提。

---

## 1. 问题陈述

v1 PRD 把 `/coding/message/stream` 路由判定为"已就绪"，全仓 grep 证伪：

- 路由确实注册（`server/routes/coding.ts:86-223`），但 `packages/overlay` 零调用者，从未端到端跑通。
- 真正阻塞它跑通的，是 OpenCorvus 整个事件 / interaction 平面**结构性地把 assistant 顶层 session 排除在外**。具体（codex 二审 file:line 已校准）：

  1. **bridge 三处 guard 全部 `if (!taskID) return`**：
     - `bridgeEvent` (`message-bridge.ts:405-406`)：message events 走 `ProtocolStore.dispatchEphemeral`（live-only）。
     - `bridgeSessionLifecycle` (`:300-301, :358-359`)：lifecycle 走 `ProtocolStore.appendEvent`（持久化）。
     - `bridgeSessionError` (`:354-359`)：error 走 `appendEvent`（持久化）。
     - `taskIDForSession` 对 assistant 顶层 session 返回 undefined → 全部事件丢弃。
  2. **interaction 入库链路全 task-scoped**：
     - `engine/model.ts:1219, 1230`：`Event.InteractionRequested/Resolved` zod schema 把 `taskID` 设为必填。
     - `engine/interaction.ts:127-132 resolveOwner()`：无 task → undefined → `upsertPermission/upsertQuestion` 都 `if (!owner) return`（`:25-27, :82-84`），request 不入库不发事件。
     - `engine/store.ts:1368 listInteractions(taskID)`：以 taskID 为唯一入参，没有 sessionID 路径。
     - `task-api/index.ts:1330 replyInteraction` / `:1358 rejectInteraction`：硬调 `EngineRuntime.syncTask(row.task_id, ...)`，无 task scope 时崩。
  3. **`/coding/message/stream` 事件契约不闭环**：
     - L121-139 先发 `session` → `delta`，但 `delta` 不带 message info；`message` 事件只在 `role === "assistant" && Updated` 才发（L158-170）→ 前端必须 fabricate 一个空 user 壳 / 空 assistant 壳才能挂 delta（rule 15 违规）。
     - 没订阅 `PermissionNext.Event.Asked` / `Question.Event.Asked` / `SessionStatus.Event.Idle` / `SessionEvents.Error` → 即便上游修了入库 + bridge，本 route 仍看不到、不转给客户端。
     - `CodingInput` (`coding.ts:16-27`) 只允许 `{type:"text", text}` parts，附件被 schema 拒。
  4. **`Session.list` 与 `/session` 没有 kind filter**（`session/index.ts:567-604`、`session.ts:109-134`）—— 无法可靠列 assistant sessions。
  5. **abort/delete 已有单源** 在 `/session/:id/abort` (`session.ts:495-516`) 与 `DELETE /session/:id` (`:363-390`)，v1 错写 `/coding/session/:id/*` 是 rule 8 双源风险。
  6. **SSE 不可恢复**：`/coding/message/stream` 是一次性 POST `streamSSE` (`:110-221`)，断连即丢。task 端有 `/task/:id/events?after=&after_live=`（`orchestrator.ts:445-520`）+ overlay `boardStore.taskSequence` resume（`services/sse.ts:131-272`）；assistant 无等价物。**v1 误以为可以把 message events 写入 protocol_event 来 resume——这违反 `message-bridge.ts:275-283` 明示的"message events 永不持久化"原则。正确做法：messages endpoint hydrate + lifecycle events cursor 双通道，与 task 端完全对齐。**

---

## 2. 设计原则与硬约束

| 约束 | 来源 | 实现含义 |
|---|---|---|
| **不引入 fallback** | rule 7 | bridge / interaction / SSE / list 都必须真正承载 session-scoped 路径，不允许"无 task 时退化到全局/广播/静默吞" |
| **单源** | rule 8 | (a) message/part 仍只在 `message`/`part` 表，**绝不**进 `protocol_event`；(b) lifecycle/error 在 `protocol_event` 复用 `aggregate_type/aggregate_id` 列，**不**新加 `task_id`/`session_id` 互斥列；(c) abort/delete/reply/reject 路由 100% 复用现有 `/session/*` 与 `/interaction/*`，**禁** `/coding/session/:id/*` alias；(d) list 在 `/session` 上加 `kind` filter，**禁** `/coding/sessions` 平行路由 |
| **禁状态机** | rule 13 | 后端继续直接发 `SessionStatus.Info` 对象（`status.ts:19-38`），不在 route 层做字符串状态翻译 |
| **禁合成消息** | rule 15 | `/coding/message/stream` 事件契约必须让前端"零合成"——所有 message info / 时间 / role / id 都由后端先发 `Message.Event.Updated`，再发 part / delta（含 user 侧） |
| **抽象设计模式** | rule 9 | bridge 三个函数共享一个 `scopeForSession()` helper 决定 `aggregate / aggregate_id`；`ProtocolEventStream` cursor 抽出共享给 task 与 session 端 |
| **方案落盘 + 调用点穷举** | rule 32 / 35 | 实施前必须把表格中每条"改动文件"全仓 grep 验证调用点，PR 描述贴 grep 结果 |
| **测试** | rule 36 | 每条改动必须有正反例测试；删除自动行为（如 bridge 吞 assistant）必须有"该自动行为不再发生"的反向断言测试 |

---

## 3. 目标 / 非目标

### 3.1 目标（本 spec 内）

1. assistant 顶层 session（`kind="assistant"`, `parent_id IS NULL`）的所有 message / lifecycle / status / error 事件可被 overlay 接收，**单源**。
2. assistant session 内工具调用 `ctx.ask()` 触发的 permission / question 请求可被持久化、可被 list、可被 reply / reject——复用 `/interaction/:id/reply|reject` route，不另开。
3. assistant session 流式 LLM 输出可断线恢复：messages endpoint 全量 hydrate + lifecycle events `after=<sequence>` cursor 增量；client 重连等同 task 端流程。
4. `/coding/message/stream` 事件契约自洽：前端零合成。
5. assistant session 可被 list（`/session?kind=assistant&directory=`）、可被 abort（`POST /session/:id/abort`）、可被 delete（`DELETE /session/:id`）。
6. assistant session 支持 `CodingInput.parts` 中的附件 part（与 `/session/:id/message` 同 schema）。
7. `/coding/message/stream` 与 messages/events endpoint 对入参 sessionID 强制校验 `kind="assistant" + parent_id IS NULL + directory match`。
8. compaction 在 assistant session 行为被验证；若不可在 v1 内修干净，**明确**后端 terminal reason 字段供 UI 显示"会话上限"——禁 try/catch 兜底。

### 3.2 非目标（本 spec 不做）

- 前端 UI（独立 spec）。
- 跨 assistant ↔ task 互转（v2）。
- Assistant 内嵌 IDE / 文件树 / 选区上下文（v2+）。
- Assistant session 的多客户端实时协同（v2+）。

---

## 4. 关键不变式（向 codex 二审承诺、不可破坏）

| 不变式 | 来源 |
|---|---|
| **message / part / message-delta 永不写 `protocol_event`** | `message-bridge.ts:275-283` 注释；historical "protocol_event.payload 涨到几百 MB" 教训 |
| **`protocol_event` 是 lifecycle / error / domain events 的唯一持久化总线** | 同上 |
| **scope 复用 `aggregate_type/aggregate_id`** | `ProtocolStore.appendEvent` 现有 schema（grep `aggregate:` in `message-bridge.ts` 已全部用此） |
| **`/interaction/:id/reply|reject` 单一外部入口** | `orchestrator.ts:1366/1391` |
| **abort / delete 走 `/session/:id/*`** | `session.ts:363/495` |
| **`SessionStatus.Info` 是对象 union** | `status.ts:19-38`；UI 直接显示，不翻译 |

---

## 5. 设计

### 5.1 改造 1：bridge 三函数同时支持 task / session 二 scope

**位置**：`packages/opencorvus/src/orchestrator/protocol/message-bridge.ts`

**问题**：三个函数（`bridgeEvent` `:397-422`、`bridgeSessionLifecycle` `:296-334`、`bridgeSessionError` `:354-395`）都在 `taskIDForSession()` 无 task 时 `return`，且都 hard-code `aggregate: "task", aggregate_id: taskID`。

**改法**：

1. 新增 helper（**v3 同步版本**——`Session.get` 是 async fn 不能在 bridge 同步路径调用）：
   ```ts
   type SessionScope =
     | { aggregate: "task"; aggregateID: string; taskID: string; sessionID: string }
     | { aggregate: "session"; aggregateID: string; sessionID: string }
   
   function scopeForSession(sessionID: string): SessionScope | null {
     const taskID = taskIDForSession(sessionID)  // 已是同步（in-memory session tree cache）
     if (taskID) {
       return { aggregate: "task", aggregateID: taskID, taskID, sessionID }
     }
     // ── v3 同步 lookup ──
     // Session.get() 是 async (`session/index.ts:342`)，bridge 是同步 dispatch，
     // 必须用同步 API。新增 Session.peekSync():
     //   export function peekSync(id: string): Session.Info | null {
     //     const row = Database.use(db => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get())
     //     return row ? fromRow(row) : null
     //   }
     // 内部 Database.use((db) => db.select()...get()) 本身就是同步——只是被 fn() 包成 async。
     // peekSync 暴露同步路径，仅供 bridge / scopeForSession 这类同步消费方用。
     const session = Session.peekSync(sessionID)
     if (session?.kind === "assistant" && session.parentID == null) {
       // Session.Info 字段是 parentID（驼峰）；SessionRow.parent_id（snake）是 DB 层。
       // 这里我们消费的是 Session.peekSync 返回的 Info 形态。
       return { aggregate: "session", aggregateID: sessionID, sessionID }
     }
     return null  // 其他 kind 的孤儿 session 仍丢弃，保持现有 isolation
   }
   ```
   **替代实现**（次选）：维护 `sessionMetadataCache: Map<sessionID, {kind, parent_id}>`，由 `Session.create` / `Session.touch` / `Session.delete` 触发 upsert / invalidate。优点：零 SQL；缺点：cache miss 时仍需要同步 lookup，最终还是要 peekSync 兜底。**v3 推荐选 peekSync 一条路径**（rule 6 / 9）。
2. 三个函数的 `taskIDForSession + if (!taskID) return` 全部替换为：
   ```ts
   const scope = scopeForSession(sessionID)
   if (!scope) return
   ```
   写入 `appendEvent` 时：`aggregate: scope.aggregate, aggregate_id: scope.aggregateID, task_id: scope.aggregate === "task" ? scope.taskID : null, session_id: scope.sessionID, ...`
3. `bridgeEvent` (走 `dispatchEphemeral`) 不写持久化，但 ephemeral payload 也带上 `aggregate` 标识：
   ```ts
   ProtocolStore.dispatchEphemeral({
     type,
     aggregate: scope.aggregate,
     taskID: scope.aggregate === "task" ? scope.taskID : undefined,
     sessionID: scope.sessionID,
     source: "session.bridge",
     payload: enriched,
   })
   ```
   ProtocolStore 的 `dispatchEphemeral` 入参需相应支持 `aggregate: "task" | "session"` + `sessionID` 单独字段。
4. **测试反向断言**（rule 36 删除自动行为反向测试）：对 `kind="assistant" + parent_id IS NULL` 的 session 触发 message event，断言不再 silent-drop；同时对 `kind="orchestrator"` 等子 session 仍被丢弃（保持隔离）。

### 5.2 改造 2：interaction 模型支持 session scope（全链路）

**位置**：
- `packages/opencorvus/src/engine/model.ts:1219-1239` — `Event.InteractionRequested/Resolved` schema
- `packages/opencorvus/src/engine/interaction.ts:25-67/82-125/127-132` — upsert + resolveOwner
- `packages/opencorvus/src/engine/*.sql.ts` — `engine_interaction_request` 表
- `packages/opencorvus/src/engine/store.ts:1368` — `listInteractions(taskID)`
- `packages/opencorvus/src/task-api/index.ts:1330/1358` — `replyInteraction/rejectInteraction`
- `packages/opencorvus/src/engine/runtime.ts`（或 hooks 定义文件）— 新增 `syncSession` hook
- `packages/opencorvus/src/server/routes/orchestrator.ts:1366/1391` — reply/reject 路由（**不动 URL**，rule 8）

**改法**：

1. **schema**（`engine/model.ts:1219-1239`）：
   ```ts
   InteractionRequested: BusEvent.define("interaction.requested", z.object({
     taskID: Identifier.schema("task").optional(),
     sessionID: Identifier.schema("session").optional(),  // 二选一，refinement: 至少一个
     runID: Identifier.schema("run").optional(),
     interactionID: Identifier.schema("interaction"),
     requestType: Interaction.shape.type,
     summary: z.string(),
   }).refine(d => d.taskID || d.sessionID, "must have taskID or sessionID"))
   // InteractionResolved 同样改造
   ```
2. **表 schema**（v3 校准，详见 §6.1.B）：`engine_interaction_request.task_id` 改 nullable（当前 NOT NULL）；`session_id` 改 NOT NULL（当前 nullable）；FK 改 `ON DELETE CASCADE`；CHECK `task_id IS NOT NULL OR session_id IS NOT NULL`。rule 18：直接 reset DB 重建，不写 migration。
3. **`resolveOwner()`**（`interaction.ts:127-132`）返回类型（**v3.1 用 peekSync + parentID**）：
   ```ts
   type Owner =
     | { scope: "task"; taskID: string; run?: ActiveRun }
     | { scope: "session"; sessionID: string }
     | undefined

   function resolveOwner(sessionID: string): Owner {
     const directRun = activeRunBySession(sessionID)
     if (directRun) return { scope: "task", taskID: directRun.task_id, run: directRun }
     const taskID = taskIDForSession(sessionID)
     if (taskID) return { scope: "task", taskID, run: findActiveRunForTask(taskID) }
     // 同步 lookup（resolveOwner 被 Bus 同步消费方调用）：用 §5.1 新增的 Session.peekSync。
     // 字段名按 Session.Info shape：parentID（驼峰），不是 parent_id（DB row 字段才是 snake）。
     const session = Session.peekSync(sessionID)
     if (session?.kind === "assistant" && session.parentID == null) {
       return { scope: "session", sessionID }
     }
     return undefined
   }
   ```
4. **`upsertPermission` / `upsertQuestion`** 根据 `owner.scope` 走不同入库 + emit：scope=task 时同今天；scope=session 时 `task_id=null, session_id=request.sessionID`，emit `Event.InteractionRequested({ sessionID, interactionID, requestType, summary })`。**禁** 复制粘贴；用一个 helper 收口。
5. **`engine/store.ts:1368 listInteractions`** 签名改：
   ```ts
   export function listInteractions(scope: { taskID: string } | { sessionID: string }) { ... }
   ```
   全仓 grep 现有调用点（`task-api/index.ts:589, 965, 1202` 等）逐个更新。
6. **`task-api/index.ts:1330/1358 replyInteraction/rejectInteraction`** 读 row 后按 scope 分支：
   ```ts
   if (row.task_id) await EngineRuntime.syncTask(row.task_id, hooks())
   else if (row.session_id) await EngineRuntime.syncSession(row.session_id, hooks())
   else throw new Error("interaction has no scope")  // 不允许 silent
   ```
7. **`EngineRuntime.syncSession`** 新增 hook（**v3.1：不重复 emit InteractionResolved**）：
   - `resolveInteraction()`（`engine/interaction.ts:150-`）当前已是 InteractionResolved 的**唯一** emit 位置——sync hook 必须**不再 emit**，否则双发。
   - assistant session 的"重新评估"是真正的**空操作**——assistant 没有 task workflow lifecycle，没有 run 状态机要重算。
   - syncSession 行为：**只**触发该 session 的 SSE 通知刷新（如果有 watcher），**不** emit BusEvent。具体实现：`async function syncSession(sessionID, hooks) { /* no-op for v1; future: trigger any session-scope watcher hook here */ }`。
   - 测试反向断言（rule 36）：调用 replyInteraction 后 BusEvent.InteractionResolved **只被 emit 一次**（grep emit 调用计数）。
8. **route 不动**：`/interaction/:interactionID/reply|reject`（`orchestrator.ts:1366/1391`）签名保持；它已经只接 interactionID，scope 完全由表里的 row 决定。

### 5.3 改造 3：`/coding/message/stream` 事件契约 + 订阅补全

**位置**：`packages/opencorvus/src/server/routes/coding.ts:86-223`

**目标**：前端**零合成**渲染；同时让所有 lifecycle / error / interaction 事件可见。

**契约改动**（事件类型严格清单）：

| Event 类型 | 何时发 | 来源订阅 |
|---|---|---|
| `session` | 一次（最先），携带 sessionID | route 内部 |
| `message` | 每条 `Message.Event.Updated`（user 与 assistant 都发，不再过滤 role）| `Bus.subscribe(Message.Event.Updated)` |
| `part` | 每条 `Message.Event.PartUpdated` | `Bus.subscribe(Message.Event.PartUpdated)` |
| `delta` | 每条 `Message.Event.PartDelta` | `Bus.subscribe(Message.Event.PartDelta)` |
| `interaction` | 每条 `PermissionNext.Event.Asked` / `Question.Event.Asked`，scope=session 时发 | `Bus.subscribe(PermissionNext.Event.Asked)` / `Bus.subscribe(Question.Event.Asked)` |
| `status` | 每条 `SessionStatus.Event.Status` 与 `SessionStatus.Event.Idle`（**v1 漏 Idle**）| 两个订阅都加 |
| `error` | 每条 `SessionEvents.Error`（**v1 漏写**）+ Promise reject | `Bus.subscribe(SessionEvents.Error)` |
| `done` | 一次（最后） | route 内部，`SessionPrompt.prompt()` resolve 后 |

**关键约束**：

- `message` 事件**先于**任何引用该 message 的 `part`/`delta`。`SessionPrompt.prompt()` 内部已先 emit `Message.Event.Updated` for user message——本 route 删除 L162 的 `if (info.role !== "assistant") return` 过滤即可让 user message 也流出。
- `status` 直接转 `SessionStatus.Info` 对象，**禁** 翻译成字符串（rule 13）。
- `interaction` 事件 payload 形状：`{ id, sessionID, requestType, title, body, payload }`（与 `engine_interaction_request` 行同构，但只暴露非内部字段），UI 端复用 `<InteractionCard>` 渲染。
- 所有订阅在 `try/finally` 内统一 unsub（route L218-220 已有结构，扩充列表即可）。

### 5.4 改造 4：assistant resume —— messages hydrate + lifecycle cursor + **ProtocolStore 三 Map 泛化**（v3 重写）

**v1 错误**：把 message/part/delta 写入 `protocol_event` 用于 resume → 违反"message events 永不持久化"不变式（§4 表第 1 行）。

**正确模型（与 task 端完全对齐）**：

1. **Live**：现有 `POST /coding/message/stream` 不变。客户端 send → SSE 流式拿 `message/part/delta/interaction/status/error/done`。
2. **Hydrate**（reconnect / 切到历史会话）：
   - `GET /coding/session/:sessionID/messages?limit=200` — 已存在（`coding.ts:224-246`），返回 messages + parts 的全量当前状态（hydrate "真相源" = `message`/`part` 表）。
   - 返回结构同 `Session.messages()` 的当前形状；客户端按时间 asc 装载到 store。
   - 同时返回 `watermark: { lastEventSequence: number }` 字段供下条增量订阅用。
3. **Live cursor**（lifecycle / error / interaction 增量，v3 含 ProtocolStore 改造）：
   - 新增 `GET /coding/session/:sessionID/events?after=<sequence>&after_live=<liveSeq>&after_live_epoch=<epoch>` — 返回 `protocol_event` 中 `aggregate_type="session", aggregate_id=sessionID` 的 row，`seq > after` 的尾巴 + live replay buffer 中 `liveSequence > after_live` 的事件。**`after_live` + `after_live_epoch` 与 task 端 `orchestrator.ts:446-462` 协议同形**——v2 漏写 after_live 是 UI/backend 协议不一致的根因。
   - 走 SSE 长连接；同形于 task 端 `/task/:id/events`（`orchestrator.ts:445-520`）。
   - 抽出共享模块 `packages/opencorvus/src/orchestrator/protocol/event-stream.ts`：参数化 `(aggregate, aggregateID)`，task 与 session 路由都接入。**禁** copy-paste。
   - **v3 ProtocolStore 三 Map 泛化**（`protocol/store.ts:70-71, 380-404, 447-491`，codex 三审揭示的实现遗漏）：
     - 当前：`taskLiveReplayEvents: Map<taskID, EventView[]>`、`taskLiveRetentionFloors: Map<taskID, number>`、`taskLiveSequences: Map<taskID, number>` —— 全部 per-task。
     - 当前 `dispatchEphemeral` (`:447-491`) 用 `aggregateID = taskID ?? ""` 推导——session aggregate 会落成 `aggregateID=""`。
     - v3 改造：三个 Map 都用 `aggregateKey = ${aggregate}:${aggregateID}` 作 key（与现有 `eventKey()` `store.ts:73-75` 形态一致）；`dispatchEphemeral` 入参从 `{taskID?, sessionID?}` 改 `{aggregate, aggregateID}` 显式传入，liveSequence 按 aggregateKey 独立累加。
     - `listTaskLiveEventsAfter` (`:380-404`) → 改名 `listLiveEventsAfter(aggregate, aggregateID, liveSequence, opts)` 同步切换 task 路由消费方（一次 PR 完成，避免双轨）。
     - `listTaskEventsAfter` (`:341-358`) / `latestTaskSequence` (`:364-374`) 同样泛化为 `listEventsAfter(aggregate, aggregateID, sequence)` / `latestSequence(aggregate, aggregateID)`。
     - **测试**：task 端既有 `/task/:id/events` 行为 0 回归；session 端 `/coding/session/:id/events` 同形通过；两者共用一份内部 store API。
4. **client 重连流程**：
   - 失联期间漏掉的 message 增量？→ 重新调 `GET /messages` 全量 hydrate（这就是 task 端今天的做法——message 不靠 cursor）。
   - 失联期间漏掉的 lifecycle/error/interaction？→ 调 `GET /events?after=<lastSequence>` 补齐。
5. **wire shape 与 POST stream 对齐**（codex 二审 must-fix）：`/events` SSE 同样以 `{ type: "status" | "error" | "interaction", ... }` 形式输出，handler 与 POST stream 共用一份 reducer——**不**让 GET 返回 raw protocol_event row 与 POST 的 typed event 形状混杂。route 层做 adapter：把 `protocol_event` 行映射成相同 `{type, ...}` 包。

### 5.5 改造 5：`Session.list` + 路由加 `kind` filter

**位置**：
- `packages/opencorvus/src/session/index.ts:567-604` — `list()` 与 `listGlobal()`
- `packages/opencorvus/src/server/routes/session.ts:109-134` — `/session` route

**改法**：

- `list({ ..., kind?: SessionKind | SessionKind[] })`，SQL conditions 加 `inArray(SessionTable.kind, kinds)`。
- `/session?kind=assistant&directory=<dir>` 即为 assistant 历史列表数据源。
- **禁** 新增 `/coding/sessions`。

### 5.6 改造 6：`CodingInput` schema 支持附件 parts

**位置**：`packages/opencorvus/src/server/routes/coding.ts:16-27`

**改法**：

- 直接复用 `/session/:id/message` 已有 parts schema（在 `server/routes/session.ts` grep `parts: z.array(`）。**禁** 重新定义。
- `SessionPrompt.prompt()` 已接受 `parts: MessagePart[]`。
- 测试：附件 part 路由可通过 + 持久化到 message。

### 5.7 改造 7：abort / delete / reply 单源化（v2 改：reject 同上）

**v1 错误澄清**：v1 写"新增 `POST /coding/session/:id/abort` / `DELETE /coding/session/:id`"——作废。

**对齐**：

- abort：UI 调 `POST /session/:sessionID/abort`（`session.ts:495-516`）。
- delete：UI 调 `DELETE /session/:sessionID`（`session.ts:363-390`）。
- interaction reply / reject：UI 调 `/interaction/:interactionID/reply|reject`（`orchestrator.ts:1366/1391`）。
- 文档：在 `/coding/message/stream` 的 OpenAPI describeRoute description 末尾加 "Abort/delete/interaction routes are shared with task sessions; see `/session/:id/*` and `/interaction/:id/*`."

### 5.8 改造 8：compaction 在 assistant session 的行为验证 + 数据契约

**位置**：
- `packages/opencorvus/src/session/compaction.ts`
- `packages/opencorvus/src/session/compaction-handoff.ts`
- memory feedback：`compaction-preserve-dispatch`

**做法**：

1. 以低阈值跑 50+ 轮 assistant 会话；断言：
   - 第一条 user 消息保留（dispatch anchor 等价规则）。
   - compaction 不查询不存在的 task / goal / plan / architect artifact（若存在，修根因）。
2. 若 compaction 重度耦合 task artifact 在 spec 内无法修干净：
   - 后端在 session terminal lifecycle 中返回 `terminal_reason: "compaction_unsupported"`（新增 enum 值，**统一**走 `SessionStatus.Info.type==="terminal"` 已有 reason 字段，**不**新加独立字段）。
   - `SessionStatus.Info` 类型扩展 reason union（codex 二审 must-fix #9 "compaction N 轮 UI 协议"对应数据契约）。
   - 同时在 `/coding/session/:id/messages` 响应里加 `metadata.limit: { kind: "compaction_unsupported", reached: true }` 供 UI 显式 disabled composer。
3. **禁** try/catch 兜底（rule 20）。

### 5.9 改造 9（**新增**）：session 入参三联校验

**位置**：`packages/opencorvus/src/server/routes/coding.ts`

**目标**：防止任意 sessionID 被 coding agent prompt（rule 7 类风险，且会让 task root session 被误用为 coding chat）。

**校验**（route 入口处，三个 endpoint 都加）：

- 入参 sessionID 不为空时：
  ```ts
  // route 是 async，用 await Session.get（fn() wrapper，已 async）；
  // 字段名按 Session.Info shape：parentID（驼峰），不是 parent_id（DB row 才是 snake）。
  const session = await Session.get(sessionID).catch(() => null)
  if (!session) throw new HTTPException(404)
  if (session.kind !== "assistant") throw new HTTPException(400, { message: "session.kind must be 'assistant'" })
  if (session.parentID != null) throw new HTTPException(400, { message: "session must be a top-level assistant session" })
  if (session.directory !== Instance.directory) throw new HTTPException(400, { message: "session.directory does not match request directory" })
  ```
- 新建（无 sessionID）路径不变：内部 `Session.create({ kind: "assistant", title: "...", directory: Instance.directory })`。

适用于：
- `POST /coding/message/stream` (`:86`)
- `GET /coding/session/:sessionID/messages` (`:224`)
- `GET /coding/session/:sessionID/events` (新增，§5.4)

### 5.10 改造 10（**新增**）：compaction terminal reason 契约

参见 §5.8 第 2 条；此处明确：

- `SessionStatus.Info` 的 terminal variant 扩展 `reason` enum 加入 `"compaction_unsupported"`（如 enum 不存在，新增 `reason?: "compaction_unsupported" | "aborted" | "completed" | "errored"`，与现有 reason 字段对齐）。
- `/coding/session/:id/messages` 响应增加 `metadata?: { limit?: { kind, reached, message? } }`——可选字段，不破坏现有 task 路径消费者（rule 8 单源：metadata 字段在所有 session 上通用，不专设 assistant 字段）。

---

## 6. 数据契约与协议

### 6.1 表 schema（v3 含两张表事实修正）

#### 6.1.A `protocol_event` 表 scope（复用现有列）

**事实校准**（codex 三审已验证）：

- `ProtocolAggregate` enum (`protocol/schema.ts:7`) 已包含 `"session"` 值。
- `ProtocolEnvelope` (`schema.ts:13-34`) `task_id` / `run_id` / `session_id` 已 optional。
- **schema 层支持 session aggregate**；改造点在 store **行为层**（§5.4 / §6.3 dispatchEphemeral + listEventsAfter + live replay）。

```sql
-- 现状（基本符合需要，零 DDL 改动）：
protocol_event (
  id INTEGER PK,
  seq INTEGER NOT NULL,
  aggregate_type TEXT NOT NULL,    -- 已 enum 含 "session"
  aggregate_id TEXT NOT NULL,
  task_id TEXT NULL,                -- 已 nullable
  session_id TEXT NULL,             -- 已 nullable
  type TEXT NOT NULL,
  source TEXT,
  payload JSON,
  emitted_at INTEGER NOT NULL,
  ...
)
```

**v3 不做 DDL 改动**——v2 写的 "CHECK 约束" 不必要（aggregate 列已能区分 scope，且现有逻辑全部按 aggregate_id 索引）。

**全仓 grep `WHERE` 影响**（rule 35）：现有所有 `WHERE aggregate_type = 'task'` 查询自动排除 session scope 行，**不需要改**。新代码（assistant 端 events stream）用 `WHERE aggregate_type = 'session' AND aggregate_id = ?`，与 task 端按 aggregate 物理隔离。

#### 6.1.B `engine_interaction_request` 表 scope（**v3 事实修正 + DDL 改动**）

**当前 schema**（`storage/ddl.ts:576-593`）：
```sql
CREATE TABLE engine_interaction_request (
  id            text PRIMARY KEY,
  task_id       text NOT NULL,           -- ← v3 改 nullable
  run_id        text,
  session_id    text,                    -- ← v3 改 NOT NULL
  external_id   text NOT NULL,
  ...
  FOREIGN KEY (task_id)    REFERENCES engine_task(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES session(id)           ON DELETE SET NULL
);
```

**v3 改动**（rule 18：reset DB，不写 migration）：

```sql
CREATE TABLE engine_interaction_request (
  id            text PRIMARY KEY,
  task_id       text,                       -- nullable
  run_id        text,
  session_id    text NOT NULL,              -- 始终有 session（task 路径也走某个 session）
  external_id   text NOT NULL,
  ...
  CHECK (task_id IS NOT NULL OR session_id IS NOT NULL),   -- 至少一个 scope
  FOREIGN KEY (task_id)    REFERENCES engine_task(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES session(id)     ON DELETE CASCADE
  -- 注：session_id 从 ON DELETE SET NULL 改 CASCADE，因为现在 session_id 是必填
);
```

**session-scope 查询模式**（必须显式排除 task 行）：

```ts
listInteractions({ sessionID })  // §5.2 改造后的签名
// SQL: WHERE task_id IS NULL AND session_id = :sessionID
```

**task-scope 查询模式**（保持现有，但确认排除 session-only 行）：

```ts
listInteractions({ taskID })
// SQL: WHERE task_id = :taskID
// 现有 board projection (workbench/board.ts:88-105, 400-417) 已是此模式，无需改
```

**全仓 grep 影响**（rule 35）：现有所有 `WHERE task_id = ?` 查询继续工作（task interaction 仍有 task_id）；新增 session-scope 查询必须显式带 `task_id IS NULL` 隔离条件。

### 6.2 `/coding/message/stream` SSE 事件序列（v2，含 error）

```
event-stream order (per request):
  1. { type: "session", sessionID }
  2. { type: "message", info: { id, sessionID, role:"user", time, ... } }
  3. { type: "part", part: <user-text-or-attachment> }    × N
  4. { type: "message", info: { id, sessionID, role:"assistant", time:{ created } } }
  5. { type: "delta", messageID, partID, field, delta }    × N
  6. { type: "part", part: <tool/file/...> }    × N
  7. { type: "interaction", interaction: { id, sessionID, requestType, title, body, payload } }    × N (可能交错于 5/6)
  8. { type: "status", status: <SessionStatus.Info 对象> }    × N
  9. { type: "message", info: { ..., finished:true, tokens } }
 10. { type: "error", error: { name, message, summary? } }    (可选；仅出错时)
 11. { type: "done", sessionID }
```

**规则**：

- 任何 `part`/`delta` 出现前，其 `messageID` 对应的 `message` 必须已经发过（前端可 lookup）。
- `status` 透传 `SessionStatus.Info` 对象（含 `type` 字段：`"streaming"|"idle"|"retry"|"terminal"`），UI 直显，不翻译。
- `error` 即便出现，`done` 也会发（finally 块），所以客户端 `done` 是终止判定，`error` 是失败原因。

### 6.3 `GET /coding/session/:sessionID/events?after=<seq>&after_live=<liveSeq>&after_live_epoch=<epoch>` 与 POST stream 形状对齐（v3）

**输出**：

```
{ type: "status" | "error" | "interaction" | "interaction.resolved", sequence, liveSequence?, ...payload }
```

**事件 union 完整定义**（v3 锁定）：

| event type | POST stream `/coding/message/stream` | GET events `/coding/session/:id/events` |
|---|---|---|
| `session` | ✅（一次，最先）| ❌ |
| `message` | ✅（user + assistant 都发，含 finished）| ❌（messages 由 `/messages` hydrate）|
| `part` | ✅ | ❌（同上）|
| `delta` | ✅ | ❌（同上）|
| `interaction` | ✅（live 触发时即时）| ✅（cursor replay + 后续 live）|
| `interaction.resolved` | ❌（POST 流不订阅 InteractionResolved；交给 GET events）| ✅ |
| `status` | ✅（含 Status + Idle）| ✅ |
| `error` | ✅ | ✅ |
| `done` | ✅（一次，最后）| ❌（GET 长连接无终止；client 按 status terminal 判定）|

**注意**：本 endpoint **不**输出 `message`/`part`/`delta`——这些不进 protocol_event（不变式 1），由 `/messages` hydrate 给出。

**client reconnect 流程**：

1. 调 `GET /coding/session/:id/messages` → 重置 store 后写入完整 messages + `pendingInteractions[]`（§6.4）。
2. 取响应里 `watermark.lastEventSequence` 和 `watermark.lastLiveSequence`（route 计算：取 `latestSequence("session", sessionID)` + 当前 live buffer 末尾 seq）。
3. 调 `GET /coding/session/:id/events?after=<watermark.lastEventSequence>&after_live=<watermark.lastLiveSequence>&after_live_epoch=<currentEpoch>` 启动 live cursor SSE。
4. 之后任何 lifecycle / error / interaction 增量从这条流来；message 增量从原 POST 流（如果 client 还在等响应）。
5. 若 POST 已完成但 client 没接到 `done`：等 events 流追到 terminal `status` event，等价于 `done`。
6. **interaction 去重**：POST stream 与 GET events 都会发同一条 interaction（POST 在 live 触发时即时、GET 在 cursor replay 时）。**Spec 2 reducer 必须按 `interactionID` upsert**——本 spec 保证后端永远发同一个 `interactionID`，前端按 ID 自然 dedupe。

### 6.4 `GET /coding/session/:sessionID/messages` 响应扩展（v3 加 pendingInteractions 锁单源）

```ts
{
  messages: Message[],                                          // 现有
  watermark: {
    lastEventSequence: number,                                  // protocol_event seq
    lastLiveSequence: number,                                   // live replay buffer 末尾 liveSeq
    liveEpoch: number                                           // 当前 epoch（after_live_epoch 校验用）
  },
  pendingInteractions: InteractionRecord[],                     // ← v3 新增：interaction hydrate 单源
                                                                //   消除 UI spec 两选项（rule 8）
  metadata?: {
    limit?: { kind: "compaction_unsupported", reached: boolean, message?: string }
  },
}
```

**interaction hydrate 单源**（v3 锁定）：

- v2 在 UI spec §4.9 留了"messages 附带 vs 独立 endpoint"两选项，违反 rule 8。
- v3 锁定 **messages endpoint 附带 `pendingInteractions: InteractionRecord[]`**——这与 task 端 `board.ts:88-105` 已有的"board projection 直接 select interactions"模式同形。
- **禁** 新增 `/coding/session/:id/interactions` 平行 endpoint。
- 客户端 reducer 收到 hydrate + 收到 live `interaction` event 必须按 `interactionID` upsert（自然去重）。Spec 2 §4.5 reducer 必须遵守。

---

## 7. 文件改动清单（实施时按此 grep 复核 rule 35）

### 后端改

| 文件 | 改动 | 复核 grep |
|---|---|---|
| `packages/opencorvus/src/orchestrator/protocol/message-bridge.ts` | §5.1 三函数双 scope + `scopeForSession()` helper | `taskIDForSession`、`bridgeEvent`、`bridgeSessionLifecycle`、`bridgeSessionError`、`aggregate: "task"` |
| `packages/opencorvus/src/protocol/store.ts:70-71, 341-374, 380-404, 447-491` | **v3 改动**：三个 Map (`taskLiveReplayEvents/taskLiveRetentionFloors/taskLiveSequences`) 改 by-(aggregate,aggregateID)；`dispatchEphemeral` 入参从 `{taskID?}` 改 `{aggregate, aggregateID}`；`listTaskEventsAfter/latestTaskSequence/listTaskLiveEventsAfter` 泛化为 `listEventsAfter/latestSequence/listLiveEventsAfter(aggregate, aggregateID, ...)`。一次切换 task 路由消费方（含 `orchestrator.ts:445-520` 同步改）| grep `ProtocolStore.appendEvent`、`dispatchEphemeral`、`taskLiveReplayEvents`、`listTaskEventsAfter`、`latestTaskSequence`、`listTaskLiveEventsAfter` |
| `packages/opencorvus/src/session/index.ts` | **v3 新增** `Session.peekSync(id): Session.Info | null` 同步 API；仅 bridge / scopeForSession 等同步消费方使用 | grep `Session.get(` 全调用（async path 不变；新 sync path 显式 peekSync） |
| `packages/opencorvus/src/engine/model.ts:1219-1239` | `InteractionRequested/Resolved` schema taskID 可选 + sessionID 可选 + refine | grep `InteractionRequested`、`InteractionResolved` 全调用 |
| `packages/opencorvus/src/engine/interaction.ts` | `resolveOwner` 返回 Owner union；upsertPermission/Question 按 scope 分支 | grep `resolveOwner`、`upsertPermission`、`upsertQuestion` |
| `packages/opencorvus/src/engine/engine.sql.ts:503-` + `packages/opencorvus/src/storage/ddl.ts:576-593` | **v3 事实校准**：`engine_interaction_request.task_id` 改 nullable（现 NOT NULL），`session_id` 改 NOT NULL（现 nullable），FK 改 `ON DELETE CASCADE`，加 CHECK `task_id IS NOT NULL OR session_id IS NOT NULL`。rule 18 reset DB | grep `EngineInteractionRequestTable`、`engine_interaction_request`（ddl + drizzle 定义同改）|
| `packages/opencorvus/src/engine/store.ts:1368 listInteractions` | 签名改 `(scope: {taskID}|{sessionID})`；session-scope 实现必须显式 `WHERE task_id IS NULL AND session_id = :sessionID`（v3 强调隔离）| grep `listInteractions(` 全调用：`task-api/index.ts:589, 965, 1202` 等 |
| `packages/opencorvus/src/engine/runtime.ts` | 新增 `syncSession(sessionID, hooks)` | grep `EngineRuntime.syncTask`、`syncRun` |
| `packages/opencorvus/src/task-api/index.ts:1330/1358` | `replyInteraction/rejectInteraction` 按 scope 分支 sync | grep `replyInteraction`、`rejectInteraction` |
| `packages/opencorvus/src/server/routes/coding.ts` | §5.3 订阅扩展 + §5.6 schema 复用 + §5.9 校验 + §6.2 事件契约 | grep `/coding/`、`CodingInput` |
| `packages/opencorvus/src/server/routes/coding.ts` 新增 `GET /coding/session/:id/events` | §5.4 + §6.3 cursor stream | — |
| `packages/opencorvus/src/server/routes/session.ts:109-134` | `/session` route 加 `kind` query param | grep `\.get\("/", ` in this file |
| `packages/opencorvus/src/session/index.ts:567-604` | `list({ kind })` + `listGlobal({ kind })` 支持 | grep `Session.list(`、`Session.listGlobal(` |
| 新文件 `packages/opencorvus/src/orchestrator/protocol/event-stream.ts` | §5.4 抽出共享 cursor stream（task 与 session 共用） | — |
| `packages/opencorvus/src/server/routes/orchestrator.ts:445-520` | 切换到共享 event-stream 模块（一次合并完成，避免双轨） | — |
| `packages/opencorvus/src/session/status.ts:19-38` | 若 §5.10 需要：terminal reason enum 扩展 `"compaction_unsupported"` | grep `SessionStatus.Info` 消费方 |
| `packages/opencorvus/src/session/compaction.ts` / `compaction-handoff.ts` | §5.8 验证发现的根因修复 | 取决于验证 |
| `packages/opencorvus/src/server/routes/orchestrator.ts:1366/1391` | **不改 URL**；只确认 EngineService.replyInteraction 内部已按新 scope 分支 | — |

### 测试新增（rule 36 — 每条改动配测试）

```
packages/opencorvus/test/orchestrator/bridge-session-scope.test.ts
  - assistant 顶层 session 触发 Message.Event.Updated → dispatchEphemeral 收到 aggregate="session"
  - assistant 顶层 session 触发 SessionStatus.Event.Status → protocol_event 写入 aggregate="session", aggregate_id=sessionID
  - kind="orchestrator" 等子 session 仍被 silent-drop（保持隔离）
  - 反向断言：bridge 不再无差别 if (!taskID) return
packages/opencorvus/test/engine/interaction-session-scope.test.ts
  - upsertPermission 对 assistant session 入库（task_id NULL, session_id 非空）
  - listInteractions({sessionID}) 返回该 session 下所有 row
  - replyInteraction 对 session-scope row 调用 syncSession 而非 syncTask
  - InteractionRequested/Resolved schema 对 taskID-only / sessionID-only / 两者都缺 三种 case 的验证
packages/opencorvus/test/server/coding-stream-contract.test.ts
  - SSE 事件顺序：message(user) 在第一个 user part 之前
  - assistant message info 在第一个 assistant delta 之前
  - permission interaction 出现在 part 流中
  - 附件 part 不被 schema 拒绝
  - status / error 都正确转发（Idle 与 Status 都来 → 都发）
packages/opencorvus/test/server/coding-events-resume.test.ts
  - GET /coding/session/:id/events?after=N 只返回 sequence > N 的 row
  - reconnect: GET /messages 全量 + GET /events?after=<wm> 增量 = 全部状态
  - GET 输出形状 ({type, ...payload}) 与 POST stream 一致（共用 reducer 不应出现 raw protocol_event）
packages/opencorvus/test/server/coding-session-validation.test.ts
  - POST /coding/message/stream 拒绝 kind="root" / kind="build" sessionID
  - 拒绝 parent_id 非空的 session
  - 拒绝 directory mismatch
  - 三个 endpoint 都生效
packages/opencorvus/test/server/session-list-kind.test.ts
  - /session?kind=assistant 只返回 assistant
  - /session?kind=root,assistant 返回两类混合
packages/opencorvus/test/session/compaction-assistant.test.ts
  - 50 轮 assistant 会话触发 compaction，第一条 user 消息保留
  - compaction 不查询不存在的 task artifact
  - 若 §5.8 决定接受限制：terminal reason="compaction_unsupported" 正确发出，metadata.limit 出现在 messages endpoint
packages/opencorvus/test/orchestrator/event-stream-shared.test.ts
  - task 端 /task/:id/events 行为不回归
  - session 端 /coding/session/:id/events 行为同形
  - 共用模块对两边 cursor/dedupe 一致
```

---

## 8. 工作量（v3，含 codex 三审校准）

| 阶段 | 工时 |
|---|---|
| §5.1 bridge 三函数 + scopeForSession + **Session.peekSync 同步 API**（v3 新增）| 2-3 天 |
| §5.2 interaction 全链路：schema + table + resolveOwner + listInteractions + replyInteraction + rejectInteraction + syncSession + 真实路由确认 | 3-5 天 |
| §5.3 `/coding/message/stream` 订阅 + 事件契约 + interaction/error/Idle 转发 | 1-2 天 |
| §5.4 + §6.3 messages hydrate + lifecycle cursor + 共享 event-stream 抽取 + POST/GET 形状对齐 + **ProtocolStore 三 Map 泛化**（v3 新增） | **4-5 天**（v3 加 store 泛化）|
| §5.5 + §5.6 + §5.7 list/schema 单源 + 文档 | 1 天 |
| §5.8 compaction 验证（含修复 buffer）| 1-3 天 |
| §5.9 三联校验 + §5.10 terminal reason 契约 | 0.5-1 天 |
| §6.1.B `engine_interaction_request` schema 改造（v3 事实修正）+ DB reset 验证 | 0.5-1 天 |
| 测试（rule 36，全表 + store 泛化回归 + peekSync）| 4-5 天 |
| **总计** | **17-26 工作日**（v2 是 16-24，v3 加 ProtocolStore 泛化 + peekSync 增加 1-2 天）|

---

## 9. 验收（rule 24 / 28b）

硬标准——任一不满足即 Spec 1 未交付：

1. assistant 顶层 session 发 `Message.Event.Updated` → `ProtocolStore.dispatchEphemeral` 收到 aggregate="session" 并通过 live SSE 路由；**不**写 protocol_event（不变式 1）。
2. assistant 顶层 session 发 `SessionStatus.Event.Status/Idle/Error` → `protocol_event` 表里有 `aggregate='session', aggregate_id=<sessionID>, task_id IS NULL` 的 row。
3. assistant session 内 tool 调 `ctx.ask()` 产生 permission → 通过 `/session?kind=assistant` 找 session、通过 `listInteractions({sessionID})` 列出、通过 `/interaction/:id/reply` 应答；engine 内 `upsertPermission` 不再 `if (!owner) return`，`replyInteraction` 走 `syncSession` 而非 `syncTask`。
4. `GET /coding/session/:id/events?after=0` 重放所有 session-scope lifecycle/error/interaction events；`after=N` 跳过 ≤N 的；和 task 端 `/task/:id/events` 用同一份 `event-stream.ts` 模块。
5. `/coding/session/:id/messages` 返回 messages + `watermark.lastEventSequence`；client 用 watermark 接 events stream 不漏不重。
6. `/coding/message/stream` SSE 严格按 §6.2 输出；前端"零合成"测试通过（mock 客户端只 append、不创建 placeholder）。
7. 三联校验生效：拒绝 kind!=assistant / parent_id 非空 / directory 不匹配的 sessionID（HTTP 400/404）。
8. `Session.list({ kind:"assistant", directory })` + `/session?kind=assistant&directory=...` 正常工作；全仓不存在 `/coding/sessions` 路由。
9. abort / delete / interaction reply / reject 全部走 `/session/:id/*` 与 `/interaction/:id/*`；route grep 确认 `coding.ts` 无新增这些 handler。
10. compaction：50 轮 assistant 会话不 throw，第一条 user 消息保留；若决定接受限制，`/coding/session/:id/messages` 响应 metadata.limit 与 terminal reason 一致。
11. 任务端 task 路径 0 回归（既有 task 路由 + 既有 `task-api/index.ts` 测试全过）。
12. **不变式自动断言**：测试 `protocol_event` 表里不存在 `type` LIKE `message.%` 的 row（永不持久化 message events）。

---

## 10. 风险与 CLAUDE.md 对照

| 风险 | Rule | 缓解 |
|---|---|---|
| 把 bridge 改成双源（task vs session 两套 ProtocolStore） | rule 8 | 同一 store、同一 emit、`aggregate` 列区分；scopeForSession 单一 helper |
| `if (kind === "assistant") { ... } else { ... }` 散落各处 | rule 13 | scope 对象化（Owner union）；用数据驱动而非条件分支 |
| 临时 hack：bridge 内对无 task session 走广播 | rule 7 | 必须真正路由到 session scope；测试反向断言"没有广播" |
| 把 message events 持久化（v1 错误） | rule 8 | §4 不变式 + §9 验收第 12 条自动断言 |
| `engine_interaction_request` 数据迁移 | rule 18 | 直接 reset DB，不写 migration |
| `event-stream.ts` 抽取后留下 task 老路径双轨 | rule 8 | 一次合并切换；§7 表强制 task 端也切到共享模块 |
| `replyInteraction` 兜底 if-else 无 scope 时 silent-return | rule 7 | 强制 throw 而非吞错 |
| compaction 出问题就 try/catch 跳过 | rule 20 | 修根因；不修则显式 terminal reason 报告 UI |
| 二次审查遗漏 | rule 24 | 已过 codex 一审 + 二审；本 spec 落盘后再过第三轮 |
| 调用点遗漏 | rule 35 | §7 表格每行都需在实施 PR 中贴 grep 结果 |
| 测试覆盖不全 | rule 36 | §7 测试新增清单是硬标准 |
| `protocol_event` 表 CHECK 改造影响下游 SQL 模板 | rule 35 | 全仓 grep `protocol_event WHERE` / `from protocol_event`，包括 `overlay/src/main.tsx::buildTaskDebugBlob` |

---

## 11. 待用户 / 二审确认（v2）

1. `scopeForSession` 命中"既不是 task 子 session 也不是 assistant 顶层 session"时的孤儿会话怎么处理？（v2 选择继续 silent-drop 以维持隔离；若有其他 kind 也要外露，单独提）。
2. `SessionStatus.Info` terminal reason enum 是否真要加 `"compaction_unsupported"` —— 若 compaction 验证通过不需要这个 reason，§5.10 可移除。
3. `interaction` 事件 payload 暴露字段集合：暴露 `payload` 字段（可能含敏感工具参数）vs 只暴露 `requestType + summary` 并让 UI 用 reply route 取详情？v2 倾向前者（与 task 端 InteractionCard 行为一致）。
4. `event-stream.ts` 共享模块的最终命名 / 路径。

---

## 12. 与 UI Spec 的握手

`assistant-right-panel-ui-2026-05-25.md` 的前置依赖：

- 本 spec §5 全部完成并合并到 candidate。
- §6.2 SSE 类型集合 = UI handler 输入集合（含 `error`）。
- §6.3 GET events 输出形状 = POST stream 同形（UI 共用一份 reducer）。
- §5.10 metadata.limit / terminal reason 字段已就位 → UI 据此 disabled composer + 文案。
- 共享 `event-stream.ts`（后端）/ `event-stream-client.ts`（前端）：后端先做，前端 spec 切换 task 与 session 两端到共享 client。
