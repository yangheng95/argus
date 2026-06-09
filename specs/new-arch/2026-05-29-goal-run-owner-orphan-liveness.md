# Goal-run owner-stamp orphan liveness（断流自动退出）— 2026-05-29

状态：已交付（commit 1 feature ad43774ad / commit 2 cleanup 4dff9a45b 已 push；commit 3 review-fix 见下，本地已提交，push 待用户在途的 GoalWorkloadResult 工作编译通过）

## 6. 独立复核修订（2026-05-29，commit 3）

独立 adversarial review 找到 1 个 MAJOR；自审又发现一处更深的多源 liveness 缺口。两者都修：

1. **MAJOR — 孤儿在 describe 里可派，但 `beginBuildAttempt` 守卫拒派**：`persist.ts` 的"已有 live goal_run 就拒绝"守卫只看 `status`，孤儿（live+外来owner）会触发 throw，重派被堵。修复：守卫改为 owner-孤儿感知——孤儿则先 `updateGoalRun(aborted)` 退役（调度层 liveness 恢复，rule 13.1/6.1a），再走正常 supersede 开新 attempt（与 failed→retry 同路径）。

2. **自审 — overlay 症状未真正修好（rule-8 多源 liveness）**：commit 1 只让 `describeGoal.is_running`（编排器视角）owner-aware；但 overlay 板走 `goalStatusByID`(`deriveGoalStatus`) + `projectGoalSteps`(`mapGoalRunToStepStatus`)，两者仍 owner-unaware → 孤儿仍显示 running、卡片仍转圈。修复：`deriveGoalStatus` 孤儿 head → "failed"；`projectGoalSteps` 孤儿 tip → step/phases "failed"。共用 `isGoalRunOrphaned` 单一同源。

3. **清理残留（review minor）**：overlay `main.tsx` 的 `engine_executor_session` SQL 探针 + 过时 note、`script/inspect-task.ts` 查询、`packages/web` 两份 api.mdx 的已删路由行、`id.ts` 死 id-kind `executor_session`、`model.ts` 过时注释——一并清掉。

测试：`begin-build-attempt-supersede.test.ts` 加"孤儿经 beginBuildAttempt 退役+重派、非孤儿 live tip 仍拒绝"；`goal-run-owner-orphan.test.ts` 加 `goalStatusByID` owner-aware 断言。8 套件 43 pass / 0 fail，typecheck 我的改动零错误（仅余用户在途 GoalWorkloadResult 的预存错误）。
作者：HengYang + assistant
相关前作：

- `2026-05-21-build-orchestrator-interruption-stabilization.md`
- `2026-04-30-llm-activity-first-byte-zombie-loop-fix.md`
- `2026-04-30-llm-activity-redesign.md`
- Phase-7 orphan 观察化（删除 startup abort-brake）：见 `engine/orphan.ts` 顶部注释

---

## 0. 问题陈述

用户诉求：goal 断流要能自动报错退出；至少 goal 死亡能自动退出。典型场景——
**中断 opencorvus 进程后重新进入，那个曾在 `running` 的 goal 永远转圈，无法恢复。**

### goal 的三种"断流"死法与现状（证据）

| 死法                                    | 进程 | 现状                                                                                                                                                                                                                                          | 自动退出？  |
| --------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| ① 流卡死（socket 静默、长时间不吐字节） | 活   | `build/agent.ts:1677` `withStreamActivity({ idleMs: orchCfg.activity.executor_events_idle_ms })` + `abortableIterable` 包住外部 executor 流；空闲超时→`AbortError`→build `failed`→`runtime.ts syncGoalRuns`→`batchComplete` 唤醒 orchestrator | ✅ 已有     |
| ② 流硬错（429/500/ECONNRESET）          | 活   | `agent/runner.ts:794` 订阅 `Session.Event.Error` 收 `streamErrors`，`buildHardErrorFromFinalMessage` 抛 `AgentRunError`；describe 呈现 `recent_stream_failures`/`recent_agent_failures`                                                       | ✅ 已有     |
| ③ **进程中断+重启**                     | 死过 | goal_run 行停在 live 状态（running/planning/blocked），内存 stream + SessionPrompt loop 全没；重启**不 auto-wake**（`describe.ts:427`），orphan 仅作为 `run_orphan` 事实给 LLM（`orphan.ts` "no code gates"），无任何自动退出                 | ❌ **缺口** |

本 spec 只解决 ③。

### 为什么"注入消息让 goal resume"物理上不成立

规则 14：所有 LLM 交互流式。build 的 `provider.run(...)` 流被内存 `for await` 消费（`build/agent.ts:1720`）。进程死时**半截 assistant turn 没有可续传 checkpoint**——只有已完成 message part 落盘。chat completion 无"从 byte offset 续流"。
`resumeExistingProviderSession`/`existingSessionID`（`runner.ts:758`）**不是续半截流**，是在已落盘会话上追加**全新 turn**（retry 语义）。
∴ "注入消息 resume" = 在同 session 重派新 build turn，**前提是先把死掉的 goal_run 退役**。死亡退出与恢复不是二选一，后者依赖前者。

---

## 1. 关键事实（已全仓核实）

1. **`engine_executor_session` 表是死表**：全仓唯一写入点 `ensureExecutorSession`（`persist.ts:1473`）**零调用者**（`grep insert\(EngineExecutorSessionTable\)|ensureExecutorSession\(` 仅命中其自身定义）。执行上下文实际写在 `session.metadata.executor`（`executor/session-ref.ts persistExecutorSessionRef`，每事件更新 `updated_at`，**无 owner、无 lease**）。
   - 连带死代码：`listLiveExecutorSessionsForTask`/`...ForProject` 永远返回空 → `runtime.ts:118`、`writer.ts:386/412`、`execution-abort.ts:99-128` 全部空转；executor_session 的 `lease_owner/lease_until` 两列死；`engine/lease.ts` 的 `executorLeaseUntil/Available/HeldByOther` 仅被 `persist.ts` 的 claim 路径用，而 claim 路径只服务死表。

2. **goal_run 是 artifact-backed、append-only**：`kind="goal_run_attempt"`；每次 `updateGoalRun`（`persist.ts:1031`）经 `appendGoalRunArtifact` 追加新 artifact 行，`latestPerGoalRun` 取每个逻辑 goal_run_id 的最新行（`store.ts:1843`）。`GoalRunRow` 形态在 `store.ts:131`，从 payload 重建于 `artifactRowToGoalRunRow`（`store.ts:1860`）。

---

## 2. 设计决策

### 2.1 lease 载体：goal_run 行（用户拍板）

executor_session 死表不复活；把活性信号挂到 goal_run——它是唯一同时覆盖内部(`opencorvus`)/外部(`codex`/`claude-code`)两条 build 路径的活性单元。

### 2.2 owner-only，不要 lease_until + 心跳续约（对已批方案的修正，见 §2.4）

**load-bearing 不变量：一个 project 同一时刻只有一个 opencorvus 进程（单 owner）。** 该模型下：

- 进程级 `OWNER = pid:boot-ts:rand`（`lease.ts:14`，重启必变，抗 PID 复用）。
- goal_run 派发时把 `OWNER` 戳进 payload 一次（随 `beginBuildAttempt` 的 artifact 写入，**零额外写**）。
- **派生孤儿判据：`status ∈ live` 且 `payload.owner` 已设 且 `owner ≠ 当前进程 OWNER` ⇒ 物理孤儿（not-live）。**

正确性矩阵（单 owner）：

| 场景                     | owner vs OWNER | status   | 判定                       | 正确性                                  |
| ------------------------ | -------------- | -------- | -------------------------- | --------------------------------------- |
| 本进程正跑               | ==             | live     | live                       | ✓                                       |
| 进程崩溃+重启            | != (旧)        | live     | **orphan**                 | ✓ 死且不可恢复                          |
| 崩前已终态               | \*             | terminal | 不命中（只看 live status） | ✓                                       |
| 流死+在进程内已写 failed | ==             | terminal | 不命中                     | ✓（①②负责）                             |
| queued 从未派发          | owner 未设     | queued   | 不命中（owner 空）         | ✓ 与 orphan.ts 对 queued 的特殊处理一致 |

### 2.3 为什么不需要 lease_until/心跳（拒绝过度工程，规则 5/6/26）

- append-only 模型下高频心跳续约 = attempt 历史行爆炸（多分钟 build 每 10s 一行）。
- `lease_until` 仅为"多进程并发持有同 project"防御；单 owner 模型下，外来 owner 出现在 live goal_run 上即代表该进程已死，**与 lease 是否过期无关**。owner 比对已足够。
- 同进程长跑 goal 的 owner 恒等于自身，永不误判，无需续约保活。

### 2.4 对 §AskUserQuestion 已批"lease 过期+外来 owner"措辞的修正声明（规则 35：不静默重写）

用户最初批准的措辞是"lease 过期 + 外来 owner ⇒ not-live"。落地时发现 goal_run append-only 使"lease 过期"那半（需心跳续约）成为写放大反模式。**目标（重启后 goal 自动判死）由 owner 比对单独即可达成**，"lease 过期"是手段而非目标。本 spec 显式简化为 owner-only，并把"单 owner per project"写成不变量。若未来转多进程拓扑，再以心跳+expiry 的侧表方案重启该决定。

### 2.5 唤醒边界（不在本轮范围）

用户在 §AskUserQuestion 选了"A：派生死活"，**未选** "A + boot 真实 wake"。∴ 本轮**不**加 boot 自动唤醒；重启后 orphan 由现有"用户消息驱动 wake + describe 呈现"路径消费——只是现在派生层会把它呈现为死/孤儿（overlay 停转、orchestrator 读到的是 orphan 而非 running），下一步重派/丢弃仍归 LLM（守住 Phase-7：host 观察死亡事实，LLM 决定 recovery；规则 6.1a/13）。

---

## 3. 实施（commit 1：feature）

### 3.1 owner 戳入 goal_run

- `lease.ts`：保留并重命名意图——`executorLeaseOwner()` → 暴露 `processOwner()`（保留旧名导出以最小化改动或一并改调用点，见 §4）。
- `store.ts:131 GoalRunRow`：加 `owner: string | null`。
- `store.ts:1860 artifactRowToGoalRunRow`：从 `payload.owner ?? null` 读出。
- `persist.ts beginBuildAttempt`（`persist.ts:1734`）与 `appendGoalRunArtifact`（`persist.ts:~844/890`）：payload 写入/透传 `owner`；`updateGoalRun` 的 patch 必须**保留**既有 owner（不因后续 status append 丢失）。新 goal_run 首次落盘时 `owner = processOwner()`。

### 3.2 派生孤儿判据（单一同源 helper）

- 新增 `engine/orphan.ts` 或 `engine/goal-liveness.ts`：`isGoalRunOrphaned(row: GoalRunRow, now?, owner = processOwner()): boolean = isLiveGoalRunStatus(row.status) && !!row.owner && row.owner !== owner`。
- `describe.ts describeGoal`（`describe.ts:264`）：`tipIsLive = LIVE_STATES.has(tip.status) && !isGoalRunOrphaned(tip)`；并在 `GoalDesc` 增 `is_orphaned`（供 overlay/LLM 区分"死掉的 attempt"与正常终态），`renderGoal` 标注 `ORPHANED(owner mismatch — owner process gone; mid-stream goal cannot resume, re-dispatch)`。
- `observeOrphanRuns`：保持 run 级语义不变，但 `listLiveGoalRunsForProject` 喂入的 live 集合应排除 owner-孤儿（否则一个孤儿 goal_run 会让其 run 看起来仍有 live goal）。即把 §3.2 的判据并入 run 级孤儿推导。

### 3.3 测试（规则 36，commit 1 内）

- `test/engine/goal-run-owner-orphan.test.ts`（新）：
  - 外来 owner + live status ⇒ `isGoalRunOrphaned`=true；`describeGoal.is_running`=false、`is_orphaned`=true。
  - 同 owner + live ⇒ 不孤儿、`is_running`=true（断言长跑 goal 不被误判）。
  - 外来 owner + terminal status ⇒ 不孤儿（只看 live）。
  - queued/owner 未设 ⇒ 不孤儿。
  - `observeOrphanRuns`：run 的唯一 live goal_run 为外来 owner 时，run 被判孤儿。

---

## 4. 死代码清理（commit 2：cleanup，规则 17，用户拍板"一并清理"）

全仓调用点（`grep` 已枚举）：

| 符号                                                                                                                                                           | 定义                                  | 调用点                                       | 处理                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------- | --------------------------------------------------------- |
| `ensureExecutorSession`                                                                                                                                        | persist.ts:1412                       | 无                                           | 删                                                        |
| `EngineExecutorSessionTable`                                                                                                                                   | engine.sql.ts:597                     | store/persist/board/schema/ddl               | 删表+DDL+schema 导出                                      |
| `ExecutorSessionRow`                                                                                                                                           | store.ts:123                          | execution-abort:15, writer:48, task-api 间接 | 删                                                        |
| `listLiveExecutorSessionsForTask`                                                                                                                              | store.ts:1219                         | runtime:118, writer:386, execution-abort:128 | 删函数+调用点                                             |
| `listLiveExecutorSessionsForProject`                                                                                                                           | store.ts:1201                         | writer:412                                   | 删函数+调用点                                             |
| `updateExecutorSessionStatus` / `...ByID`                                                                                                                      | persist.ts:1502/1518                  | writer:32/33/232/254, runtime:298/327        | 删函数+调用点                                             |
| `updateGoalRunExecutorSessionStatus`                                                                                                                           | persist.ts:1537                       | execution-abort:101, runtime:323             | 删函数+调用点                                             |
| `viewExecutorSession`                                                                                                                                          | store.ts:1723                         | task-api:128/1239                            | 删函数+端点字段（核查端点契约，必要时同步 OpenAPI/SDK）   |
| `abortExecutorSessions`                                                                                                                                        | writer.ts:230                         | 核查调用者                                   | 随之删/简化                                               |
| `EngineExecutorSessionStatus` / `EXECUTOR_SESSION_STATUS_CATALOG` / `LIVE_EXECUTOR_SESSION_STATUSES`                                                           | engine.sql.ts:123 / catalog.ts:68/103 | store:52                                     | 删                                                        |
| `lease.ts` 的 `executorLeaseUntil/Available/HeldByOther`、`EXECUTOR_LEASE_MS`、`claimExecutorSessionLeaseWhere`/`executorLeaseConflict`/`leaseWindow`(persist) | lease.ts / persist.ts:1377-1410       | 仅死表 claim                                 | 删；`processOwner()`(原 `executorLeaseOwner`) 保留供 §3.1 |

清理时逐函数核查 `execution-abort.ts` / `writer.ts` / `runtime.ts failRun` 的剩余职责：去掉 executor_session 空转后，其 prompt-cancel / `updateGoalRun(aborted/failed)` / event-bridge 停止职责**必须保留**（这些才是真正生效的部分）。

DB：按规则 18 直接 reset，不迁移。

### 4.1 cleanup 测试

- 断言 `runtime.failRun` / `execution-abort.abortGoalRunExecution` 去掉 executor_session 调用后仍把 goal_run 写 failed/aborted、仍 cancel prompt（行为保持）。
- 若改 task-api 端点契约：正反例 + OpenAPI/SDK 同步（规则 36）。

---

## 5. 验收

- 重启后曾 running 的 goal_run：describe/overlay 呈现为 orphaned 而非 running；orchestrator 下一次 wake 读到 orphan 可重派。
- 长跑 goal（同进程）不被误判孤儿。
- typecheck + 定向单测全绿；两个 commit 各自可独立 review/bisect。
- pre-push hook（typecheck / api:routes-check / docs:check）通过，不绕 hook（规则 33）。
