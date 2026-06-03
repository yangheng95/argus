# 07-panel-reactivity — Overlay 反应式架构重构

> **状态（2026-05-12）**：P0 / P1 / P2 已落地；P3 清理**未完成**。
> - `agentEvents` / `computeAgentCards` / `toCardTree` / `resolveCardTree` /
>   `combineConversation` / `AGENT_FLUSH_INTERVAL` 全部 grep 0 hits ✓
> - `utils/conversation.ts` 与 `components/SessionTokenBadge.tsx` 已删除 ✓
> - `Conversation.tsx` 已切到 `cardTreeStore` 读 ✓
> - 但 `store/messages.ts` 仍 923 行，`FLUSH_INTERVAL` / `enqueueEvent` /
>   `coalesceDeltas` / `flushEvents` / `messagesBySession` 仍存在；
>   `services/events.ts:7,452,509,524,615` + `services/sse.ts` 仍引用这些符号
> - `partitionInteractions` 还活在 `utils/interaction.ts:90`，被
>   `services/tree-writer.ts:37/1701` 引用
> - 2026-04-19 已在 `store/card-tree.ts:25-30` flatten 掉 `goal-group:<gid>` 容器层；
>   下文 §身份规则 与 §顶层 order 仍把 `goal-group:<gid>` 当顶层 id 是过时的
>
> 对应代码（真源）：`packages/overlay/src/store/card-tree.ts` ·
> `packages/overlay/src/store/messages.ts` ·
> `packages/overlay/src/components/Conversation.tsx` ·
> `packages/overlay/src/components/Board.tsx` ·
> `packages/overlay/src/utils/card-tree.ts`（不再有 `utils/conversation.ts`） ·
> `packages/overlay/src/services/events.ts` · `services/sse.ts` · `services/chat.ts` ·
> `services/tree-writer.ts`
>
> 起因：task `tsk_d9f5d9e9f001sl07PPCdRLIhGL` goal 阶段 overlay 频繁卡死。
> 本文档是系统性重构方案（不是打补丁），执行前必须先读完。

## 问题定义

Overlay 面板在 goal 执行阶段频繁卡死。验收指标：**任何 SSE 事件速率下，overlay
UI 不可被阻塞（每帧渲染 < 16 ms）；goal 阶段无卡顿**。

## 根因（从第一性原理）

Solid 细粒度反应式要求"响应式读取直达叶子节点，中间不能出现数组/对象重建"。
当前架构在三层都违反：

1. **`setStore("agentEvents", pruned)` 整体替换数组** (`store/messages.ts:1590`)
   —— 引用变更 → 所有读此数组的 memo 全部 invalidate。

2. **`computeAgentCards()` 是普通函数而非 memo** (`store/messages.ts:724`)
   —— 里面 `Object.keys(store.messagesBySession)` 追踪对象键集合、`for (const
   event of store.agentEvents)` 全数组遍历、`boardStore.board?.*` 全字段依赖，
   任一改动全量重算。

3. **`resolveCardTree` / `toCardTree` 全树重建 + shallow-copy 丢 proxy 身份**
   (`utils/conversation.ts:168`、`utils/card-tree.ts:486`) —— 消费端拿到的
   全是 POJO，Solid proxy 在中间层就断了。

4. **最近引入的 `reconcile(toCardTree(items()), {key:"id"})`** 只救 DOM remount
   flicker，**救不回 toCardTree 的 CPU 成本**。reconcile 本身还是 O(nodes)
   递归 diff。

5. **`AGENT_FLUSH_INTERVAL=16` + 打字机 32ms/key** —— 60Hz 写入 × 全量重建 =
   主线程饱和。

## 目标架构

### 单一真源：`cardTreeStore`

```ts
// store/card-tree.ts
const [cardTreeStore, setCardTreeStore] = createStore<{
  order: string[];              // 顶层卡片 id 有序列表
  cards: Record<string, CardNode>;  // 所有卡片（含嵌套 children / parts）
}>({
  order: [],
  cards: {},
});
```

`CardNode` 结构与旧 `utils/card-tree.ts` 定义一致（字段：`id, kind, stage,
status, parts[], children[], ...`），类型定义挪到 `store/card-tree.ts`。

### SSE 事件 → 精细写入

不经过任何"先重算再 diff"的中间层，事件直接 mutate 具体路径：

| 事件 | 写入路径 |
|---|---|
| `message.updated` | 若新消息 → `produce` 追加到 session 卡片 parts；若存在 → 按 partID 原地更新 |
| `message.part.updated` | `setStore("cards", sessionID, "parts", partIdx, ...)` |
| `message.part.delta` (text/reasoning) | `setStore("cards", sid, "parts", idx, "text", t => t + delta)` |
| `agent.updated` (原 agentEvents) | 与 message.* 合并：作为同一 session 卡片上的 live part；删除独立 agentEvents 概念 |
| `goal.status` 变化 | `setStore("cards", "goal:"+gid, "status", ...)` |
| `goal.step.*` | `setStore("cards", "goal:"+gid, "steps", stepIdx, ...)` |
| `session.status` | 单一通道。按 `e.sessionID` 定位卡片，`setStore("cards", cardID, { status: e.status, terminalReason: e.terminalReason })`。`status ∈ {streaming, idle, terminal}`；session 未 materialize 时缓冲到 `pendingSessionStatus`，`ensureSessionCard` 在收到首个 `message.updated` 时 drain。所有 session（orchestrator 根 / 4 个 spec 阶段 / build / deliver / refine / prosecute / analyze_intent / modify_goal / publish_acceptance / 未来新 phase）走同一条路径，不再有 phase 专属事件。 |
| `interaction.*` | 写入对应 session 卡片的 parts（不再走 partitionInteractions 后处理） |
| `task.selected` / `transcript` 全量重载 | `setCardTreeStore("order",[])+("cards",{})` 后按序列写入 |

**session 终态信号源（单一真源）**

唯一信号：`session.status` 总线事件。由 `packages/opencorvus/src/session/prompt.ts` 在
SessionPrompt 真实生命周期切换处单点发射，不在 tool 层、不在 phase 各自的 agent 层
重发：

- 进入 `process` loop（首次 LLM round-trip 之前） → `streaming`
- LLM round-trip 结束、等下一次输入 → `idle`
- `entering standby` / abort / 异常退出 → `terminal`（带 `terminalReason ∈ {completed, error, aborted}`）

**任何 session 都走这条路径**：orchestrator 根 session、subagent（requirements /
architect / frontend-design / integrity / build / deliver / refine / prosecute /
analyze_intent / modify_goal / publish_acceptance / ...）、未来新加的 phase。**不再有
`<phase>.completed`、不再有 `applyOrchestratorRootTerminal` 把 task 终态映射到根
session 卡的旁路**——根 session 自己会在 LLM 流退出时发 `terminal`。

**Goal 执行期 subagent**（session 有 `goalID`）的视觉聚合仍然由 `goal-step → phase
→ session` 容器级联表达；但子 session 自身的 streaming/idle/terminal 状态依然来自
`session.status`，用于 spinner 渲染（`streaming` 才转圈，`idle` 静态，`terminal`
显示终态）。

**phase 业务摘要**（`contractCount` / `requirementCount` / verdict / categories
等）属于 tool result 而非终态信号，由 tool execute 的返回 output / metadata 表达，
overlay 端从 session 的 tool result part 自然读取，**不上总线**。

### 身份规则（决定 id，保证唯一 & 稳定）

实现 ID 前缀（`packages/overlay/src/services/tree-writer.ts` 为唯一写入方）：

- `<stage>:session:<sid>` —— 一个 session 一张卡，stage 取自 message.info.channel / agent / resolvedRole；stage 未知时临时用 `pending:session:<sid>`，收到真正的 message.updated 后 rename。**每个 session 默认都是顶级卡**——assistant orchestrator 和 frontend-design / requirements / architect / planner / build / evaluator / acceptance 等 sub-agent session 在 `cardTreeStore.order` 里按 time 并列，没有 session ↔ session 的嵌套。
- `goal-group:<gid>` —— 一个 goal 一个容器卡
- `goal-group:<gid>:step:<stepID>` —— goal 容器内的 step 行
- `goal-group:<gid>:step:<stepID>:phase:<phaseID>` —— step 内部的 phase 行（仅当 workflow 层在 step 上声明了 `phases` 时存在；当前 `pipeline.build` 仅声明一个 phase `build`，见 `engine/workflow.ts:232-234`。历史上规划过 plan / build / evaluate 三 phase，2026-04-20 起 per-goal evaluator 下线、planner 不再作为独立 phase 渲染，最终落点是单 phase。`goalStagePhaseID` 兼容 `planner → {build, plan}` 是为历史 session.kind 留的兜底映射，没有 phase 卡片真正消费）
- `ctx:user-request` —— task 请求气泡
- `ctx:user-request:text` / `ctx:user-request:file:<url|idx>` —— 请求内容 / 附件（作为 `parts` 项，不是独立卡）
- `interaction-card:<messageID>` —— synthetic interaction 卡（认得 session 就挂 session；否则作为 orphan 出现在顶层）
- `synthetic:<messageID>` —— chat.ts 的 pending / optimistic 气泡
- `fidelity:<taskID>` —— requirements fidelity 评审卡（稳定 per-task，upsert；挂在 requirements session 的 `childIDs` 下作为其评审产物，绝不直接出现在顶层）

tool 卡（`kind: "tool"`）不进 cardTreeStore，由 renderer 在 CardParts 内通过 `toolToCardNode` 瞬态构造，始终嵌在 parent card body 内——因此没有 escape 风险，也不在本规则表内。

**嵌套规则（唯一允许的 session 容器化）：**

- session 有 `goalID` 且对应的 phase 卡已存在 → 该 session 作为 phase 卡的 child；phase 是 step 的 child；step 是 goal-group 的 child；goal-group 顶层。完整 4 级：`goal-group → step → phase → session`。
- session.kind="executor" 是 **容器角色**（goal-scope，无 LLM），`goalStagePhaseID("executor")` 返回 null → session **不作为独立卡渲染**，也不嵌入任何 phase；step 卡在视觉上代表它。`rebuildTopLevelOrder` 里用 `stage === "executor"` 显式过滤。
- session 有 `parentSessionID` 但无 `goalID` —— **不嵌套**。即使 parent session 在 `sessions` Map 里也只是元信息，不影响渲染结构。（历史上 93f8cf8de 曾在此分支把 sub-agent 盲目嵌到 parent session 下，73ece775f 又用 throw 把它硬化，都是错误；已删。）

**phase 规则：**

- phase 定义在 backend `packages/opencorvus/src/engine/workflow.ts` 的 `MiniWorkflowStep.phases`。当前 `pipeline.build` 仅声明 `[{ id: "build", label: "Build", sessionKind: "build" }]`（`engine/workflow.ts:232-234`）。
- phase 状态从 `goal_run.status` 投影（`projectPhases` in workflow.ts）。多 phase 时按 queued / running / completed / failed 顺序推进；单 phase 时只跟随 step 自身状态。
- overlay 的 `goalStagePhaseID(stage)`（`packages/overlay/src/utils/workflow-step.ts:25-35`）按 session.kind 映射：`planner → { build, plan }`（历史兜底，对应没有真正消费方的 phase ID）、`build → { build, build }`、其余（含 `evaluator` / `executor`）返回 `null`。`evaluator` 返回 null 是 2026-04-20 per-goal evaluator 下线后的现状；`executor` 容器没有视觉卡片。
- phase 卡永远不独立出现在顶层，永远作为 step 的 children；step 卡的 children 永远是 phases（而非 session）；session 只挂在 phase 下。

**顶层 order**（`rebuildTopLevelOrder` 按此顺序推入 `cardTreeStore.order`）：

1. `ctx:user-request`
2. 所有未被 goal-step claim 的 session 卡（assistant + 所有 sub-agent），按 `time` 升序
3. `goal-group:<gid>`（按 board.goalWorkflows 顺序）
4. 无 session 容器的 orphan `interaction-card:*`
5. `synthetic:*`（真实 session 到达前临时存在）

`rebuildTopLevelOrder` **不 throw**；session 带 `parentSessionID` 但 parent 尚未 materialize 属正常 SSE 乱序，等下次 rebuild 自然归位。

不再用"依据当前 shape 计算"的 id，全部在事件到达瞬间确定。

### 去掉的东西（全部，不留兼容层）

**`store/messages.ts`**
- `store.agentEvents` 字段 + 全部读写
- `appendAgentEvent` / `setAgentEvents` / `agentEventQueue` / `agentFlushTimer` /
  `AGENT_FLUSH_INTERVAL` / `flushAgentEvents`
- 打字机动画：`advanceAgentLiveText` / `scheduleAgentLiveText` /
  `stopAgentLiveTimer` / `agentLiveTimers` / `AGENT_LIVE_INTERVAL` /
  `syncAgentText` / `nextLiveLength`
- `agentEventEntry` / `mergeAgentEvent` / `pruneAgentEvents` / `agentEventKey` /
  `agentEventTime` / `streamingAgentKind`
- `computeAgentCards` / `buildSessionBucketCard` / `bucketStatus` /
  `getSessionBucketCardMemo` / `sessionBucketMemos` / `sessionBucketMemoDisposers` /
  `clearSessionBucketMemos`
- `enqueueEvent` / `flushEvents` / `eventQueue` / `flushTimer` / `FLUSH_INTERVAL` /
  `coalesceDeltas` / `clearEventQueue`
- `AgentCardData` 类型 —— CardNode 取代
- `store.messages` / `store.messagesBySession` —— 数据直接落在 cardTreeStore 的
  CardNode.parts 里，不再保留独立"消息数组"

**`utils/card-tree.ts`**
- `toCardTree` / `agentCardToNode` / `goalToNode` / `messageToNode`
- （`shouldPromoteTool` / `defaultExpandedForNode` / `collectCardText` /
  `CardNode` 类型移动到 `store/card-tree.ts`，本文件删除）

**`utils/conversation.ts`**
- 整个文件删。逻辑（user 请求气泡、interaction 合并、main channel 过滤）搬到
  `services/tree-writer.ts`

**`components/Conversation.tsx`**
- `createMemo(() => mainMessages())` / `ctx()` / `cards()` / `items()` 四个中间 memo
- `toCardTree(items())` + `reconcile` + `treeStore` effect
- `collectAllIDs` + dup banner effect（节点 id 由构造规则保证唯一）

**`components/SessionTokenBadge.tsx`**
- `combineConversation + toCardTree` 全树重建改为 flat walk
  `Object.values(cardTreeStore.cards)` 找 peak

**`components/Board.tsx`**
- 两处 `computeAgentCards()` 直接读 `cardTreeStore.cards`（按 stage 过滤）

**测试**
- `test/card-tree.test.ts`、`test/reconcile-keys.test.ts`、
  `test/duplication-repro*.test.ts`、`test/delta-doubling.test.ts`、
  `test/message-store.test.ts`、`test/ctx-attachment-id.test.ts` —— 全部重写或删除。
  新测试覆盖 `tree-writer`：事件序列 → cardTreeStore 快照

## 为什么这样"零技术债"

| 旧架构问题 | 新架构如何消解 |
|---|---|
| agentEvents 整体替换 → 所有 memo invalidate | agentEvents 概念删除 |
| computeAgentCards 全量重建 | 不存在该函数；所有写入都是精细路径 |
| toCardTree 每 flush 全树重建 | 不存在该函数；cardTreeStore 本身即树 |
| reconcile 深度 diff 救补 | proxy 身份由 store 保证，不再丢 |
| FLUSH_INTERVAL 50ms coalesce | 删除；Solid 自己的 batch() 处理单事件 |
| AGENT_FLUSH_INTERVAL 16ms | 删除；每事件直接写 |
| 打字机 per-key 32ms 定时器 | 删除；delta 事件直接 append 到 text 字段，Solid 流式渲染 |
| collectAllIDs dup banner | 删除；id 规则构造即保证唯一 |

## 分阶段执行（每阶段独立 commit + 可验证）

### P0 — 事件流基线
- 启动 overlay + opencorvus server
- 通过 mock 或真实运行一个 goal-阶段任务，tee 一份 SSE 事件流 JSONL
- 手工快照 UI（DOM serialized + cardTree dump）
- 产出：`test/fixtures/goal-phase-sse.jsonl` + `test/fixtures/goal-phase-expected.json`

**验收**：事件流可重放，UI 快照可逐字段比对

### P1 — 新 store 与 writer 并行落地（双写，无开关）
- 新增 `src/store/card-tree.ts`：`cardTreeStore` + `setCardTreeStore` + CardNode 类型
- 新增 `src/services/tree-writer.ts`：SSE 事件 → cardTreeStore 精细写入（每类事件一个纯函数 handler）
- `src/services/events.ts` 里 **同时**调用旧路径（enqueueEvent 等）和 `tree-writer.apply(event)`
- Conversation.tsx 新增一条只读 `cardTreeStore.order` 的 devtool assertion effect：
  两路最终 tree 必须等价（fail fast，不兜底）

**验收**：双写下 UI 仍正常，assertion effect 连续运行 5 分钟无报错

### P2 — 切主路径（删除中间层消费者）
- Conversation.tsx 改读 `cardTreeStore.order` + `cardTreeStore.cards[id]`
- 删除 `toCardTree` / `reconcile` / `treeStore` / dup banner / 4 个中间 memo
- Board.tsx 两处 `computeAgentCards()` 改读 `cardTreeStore.cards`
- SessionTokenBadge.tsx 改为 flat walk
- main.tsx `window.state.cardTree` 暴露新 store（保留 `messages`/`agentEvents`
  proxy 只读以便 P3 前兼容）
- `chat.ts` 的 pending 气泡改写入 cardTreeStore
- `section.ts` live phase 改从 cardTreeStore 推导

**验收**：
1. P0 基线事件流回放，UI DOM 快照逐字节一致
2. typecheck 通过
3. 所有旧 test 迁移或明确删除（不留 skip）

### P3 — 死代码清零
- 删除 `utils/card-tree.ts`（类型已迁出）
- 删除 `utils/conversation.ts`（整个文件）
- `store/messages.ts` 砍到只剩 messageIndex / chat request state（若还用到）
  —— 目标是文件 < 300 行，或整个删除
- main.tsx 的 `messages` / `agentEvents` proxy 分支删除
- 测试文件对应删除或重写
- `services/events.ts` 的 P1 双写分支删除，只留 `tree-writer.apply`

**验收**：
1. `grep` 确认以下符号在 `src/` 下零引用：`agentEvents`、`computeAgentCards`、
   `toCardTree`、`resolveCardTree`、`combineConversation`、`agentCardItems`、
   `mainMessages`、`userContextMessages`、`AgentCardData`、`enqueueEvent`、
   `appendAgentEvent`、`setAgentEvents`、`clearEventQueue`、`coalesceDeltas`、
   `FLUSH_INTERVAL`、`AGENT_FLUSH_INTERVAL`、`AGENT_LIVE_INTERVAL`
2. `bun run typecheck` 通过
3. `bun test packages/overlay` 通过（新写的 tree-writer 测试 + 保留的有意义测试）

### P4 — 性能回归
- P0 事件流回放 + `PerformanceObserver` 打点：每帧渲染耗时、SSE 处理耗时
- 真实 benchmark 跑一次 `overlay-web-benchmark.ts`，观测 goal 阶段 overlay CPU
  占用 / 帧率（Performance tab）
- 若仍有 >16ms 帧，**回到 tree-writer 定位单事件写入开销**（不得加 batch 掩盖）

**验收**：
1. 回放期间无 >16ms 帧
2. 真实 benchmark goal 阶段肉眼流畅
3. 产出 `memory/feedback_overlay_reactivity_fix.md` 记录最终方案 + 性能数据

## 非协商约束

1. **不准加 fallback**：tree-writer 对未知事件类型 let it crash（控制台 error + 抛出），不得静默跳过
2. **不准加 throttle / debounce 做性能遮羞布**：若 P4 出现卡顿，必须定位单写入
   瓶颈（而不是"合并写入"）
3. **不准保留两套系统并存**：P3 结束后旧符号必须零引用
4. **不准跳过 benchmark 通过后"看起来还行就算了"**：P4 验收要有量化打点
5. **不准加"兼容只读 proxy"给旧 api**：main.tsx 里的 `window.state.messages`
   也要删，测试脚本一并更新

## 风险清单

| 风险 | 缓解 |
|---|---|
| CardNode shape 里有些字段（contextTokens）依赖跨消息聚合 | 新 store 节点上用 getter 或 derived field，读取时从 parts 聚合 |
| Interaction 归属逻辑复杂（orphan vs 已知 session） | tree-writer 里依据 sessionID 直接路由；未知 session → 作为 `interaction-card:<messageID>` 留在顶层 order 的 orphan 通道 |
| chat.ts 的 pending 气泡同步写（optimistic update） | 写入专属 `pending:<requestID>` 卡；真实 session 到达时按 requestID 关联替换 |
| 测试套件大幅重写 | 测试是为架构服务，不是相反 —— 按新架构重写基线测试 |
| board.ts 里 interactionMapping 被多个面板消费 | Board.tsx 改成直接读 board.interactions + cardTreeStore（无中间层） |

## 相关文档

- [07-panel.md](07-panel.md) — 面板布局与 TaskBoard 模型
- [99-principles.md](99-principles.md) — 核心原则与 anti-patterns
- `CLAUDE.md`（项目根）— 执行准则
