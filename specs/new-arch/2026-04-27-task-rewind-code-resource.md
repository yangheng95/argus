# Task Rewind — Code & Resource 维度补全设计 v2

**作者**: Claude · **日期**: 2026-04-27 · **状态**: 待评审
**面向**: opencorvus engine（packages/opencorvus）

> **修订记录**
>
> - **v1 → v2 (同日)**：经三路 subagent 自检发现 v1 存在 4 处致命缺陷与 8 处过度工程。本文档为 v2，**v1 已废止**，不再分两份保留以避免双源漂移。v2 关键变更见 §0.2。

---

## 0.1 一句话目标

把 task rewind 从「**只投影 DB 时间游标**」升级为「**DB 投影 + goal worktree 文件回滚 + in-flight executor 中断**」，**全部基于既有原语**（不新增 Snapshot 字段、不新增 audit 表、不新增 preview API），单一入口替换 `engine/rewind.ts`。

## 0.2 v1 → v2 关键变更（防漂移核心）

| #   | v1 错误                                                                                                   | v2 修正                                                                                                                                                                                                                                                                                         | 证据                               |
| --- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1   | 在主 `Instance.worktree` 拍 `Snapshot.track()` 作为 `pre_run_snapshot`，期望它能恢复 goal worktree 内文件 | **完全放弃这条路径**。Goal worktree 是独立 git worktree（`worktree/index.ts:627-628` 在 `<primary>/.opencorvus/worktrees/` 下、各自分支），主 worktree 的 git tree 看不到 goal 分支的未 merge 修改。改为**直接利用 Worktree.reset() 到 `workspace_base_ref`**（字段已存在 `engine.sql.ts:392`） | subagent 2 发现 4                  |
| 2   | "earliest pre_run_snapshot" 整树 restore                                                                  | **不再做整树 restore**。每个受影响 goal worktree 单独走 reset/remove，互不耦合                                                                                                                                                                                                                  | subagent 1 发现 7                  |
| 3   | `engine_task_rewind_audit` 表 + `snapshot_before` 字段                                                    | **删除**。审计走现有 `protocol_event` 的 `Event.TaskRewound`；redo 不实现（YAGNI）                                                                                                                                                                                                              | subagent 1 发现 3、subagent 3 §3.1 |
| 4   | `GET /rewind/preview` API                                                                                 | **删除**。client 用既有 `describe` 数据自算受影响范围                                                                                                                                                                                                                                           | subagent 1 发现 8、subagent 3 §3.2 |
| 5   | abort grace period 5s 硬编码                                                                              | 入 `config.rewind.abortGracePeriodMs`（默认 5000）                                                                                                                                                                                                                                              | subagent 1 发现 5                  |
| 6   | "整体事务回滚 abort"                                                                                      | **重新分层**：abort 视为不可逆 side effect，rewind 不试图回滚已发的 abort；只保证 DB 写入是原子的                                                                                                                                                                                               | subagent 1 发现 4                  |
| 7   | session.revert 与 task.rewind "并存" 一笔带过                                                             | **写明硬边界**（§12）：session.revert 只删 message 行，**禁止动文件**；task.rewind 独占文件回滚                                                                                                                                                                                                 | subagent 1 发现 2                  |
| 8   | 工作量 3 人日                                                                                             | **5–6 人日**，UI 单独从零建 timeline component                                                                                                                                                                                                                                                  | subagent 3 §6                      |
| 9   | 步骤 1/2/3 各自独立合入（中间态 `pre_run_snapshot=null` 留 fallback 缺口）                                | v2 不依赖该字段，无中间态问题                                                                                                                                                                                                                                                                   | subagent 3 §5                      |
| 10  | 未提 LLM session context 失效                                                                             | §11 加 "session context 重置" 显式动作                                                                                                                                                                                                                                                          | subagent 3 §2.1                    |

---

## 1. 现状（核实过的事实）

| 维度                             | 现状                                                                          | 文件:行                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------- |
| Task rewind                      | 只 UPDATE `engine_task.rewind_cursor_time`，describe 层过滤                   | `engine/rewind.ts:52-108`、`engine/rewind.ts:13-19`（OUT-OF-SCOPE 注释） |
| Goal worktree                    | 独立 `git worktree add` 到 `<primary>/.opencorvus/worktrees/<name>`，各自分支 | `worktree/index.ts:627-628`                                              |
| `engine_goal.workspace_base_ref` | **每个 goal 首次执行前的 git tree hash 已记录**                               | `engine.sql.ts:380-392`                                                  |
| `Worktree.reset()`               | 已存在，按 base_ref 还原 worktree 文件                                        | `worktree/index.ts`                                                      |
| `Worktree.remove()`              | 已存在，删除 worktree 目录与 git worktree 注册                                | `worktree/index.ts`                                                      |
| `applyRewindCursor`              | describe 层过滤函数，独立于副作用                                             | `engine/rewind.ts:150-162`                                               |
| Task abort                       | `taskAborts: Map<taskID, AbortController>`                                    | `orchestrator/loop.ts:41`（`interruptTaskLoop`）                         |
| Run abort                        | `eventBridgeAborts: Map<runID                                                 | goalRunID, AbortController>`                                             | `engine/runtime.ts` |
| 跨进程 abort                     | **不自动传播**到 executor child process                                       | bun child process 边界                                                   |
| Session.revert 文件回滚          | 走 `Snapshot.revert(patches)`                                                 | `session/revert.ts:60`                                                   |

## 2. 设计原则

- **规则 1（无 fallback）**：rewind 任一步失败，整体 throw；不留半完成状态。
- **规则 2/22（无双源）**：file 层回滚**只走** `Worktree.reset/remove` + 已 merge 部分由 git 本身保证；**禁用** `Snapshot.track/restore` 在 task rewind 路径上（Snapshot 仅服务 session.revert，单一职责）。
- **规则 13（reset DB）**：v2 不新增字段、不新增表，无 schema 变更。
- **规则 23（无状态机）**：rewindTask 是顺序原子操作，无 phase enum，无 if-else 分支驱动逻辑。
- **规则 25（无硬编码）**：grace period 入 config。
- **规则 26（第一性原理）**：不实现 redo，不实现 partial rewind，不实现 preview API。

## 3. 数据模型

**v2 不新增任何字段、不新增任何表。**

复用：

- `engine_task.rewind_cursor_time / rewind_cursor_event_id / rewind_count`（已存在）
- `engine_goal.workspace_dir / workspace_branch / workspace_base_ref`（已存在）
- `engine_goal_run.time_started / time_completed / status`（已存在）
- `Event.TaskRewound`（schema 扩可选 nested 字段，向后兼容，见 §6）

新增**配置**（`config/config.ts`）：

```ts
rewind: {
  abortGracePeriodMs: number // default 5000
}
```

## 4. 算法（rewindTask 重写，单一原子）

```
rewindTask({ taskID, cursorTime, anchorEventID?, reason? })

PHASE 0  validate
  - findTask(taskID) 存在
  - cursorTime 有限正整数
  - assertNotBusy(taskID)：拒绝并发 rewind

PHASE 1  read-only：枚举受影响范围（无副作用）
  affectedRuns       = goal_runs WHERE task_id=$ AND time_started > cursorTime
  affectedGoalIDs    = distinct(affectedRuns.goal_id)
  goalsAfterCursor   = goals WHERE task_id=$ AND time_created > cursorTime  // cursor 之后才创建
  goalsBeforeCursor  = affectedGoalIDs - goalsAfterCursor                   // cursor 前已存在但有后续 run
  abortTargets       = affectedRuns WHERE status ∈ {accepted, planning, running, evaluating}
  if cursorTime > task.time_started 之外的非法值 → throw

PHASE 2  abort（不可逆 side effect，单独承诺）
  for run in abortTargets:
    ctrl = lookupRunAbort(run.id)        // 见 §5 abort 入口
    ctrl?.abort(new RewindAbort(reason))
  await waitUntilAborted(abortTargets, config.rewind.abortGracePeriodMs)
  // 超时则在 PHASE 4 用 DB 写 status='aborted' 兜底；不 SIGKILL（process recovery 接管）

PHASE 3  worktree 回滚（git 操作，可幂等重试）
  for goal in goalsBeforeCursor:
    if goal.workspace_dir 存在 且 isValid:
       Worktree.reset({ branch: goal.workspace_branch,
                        baseRef: goal.workspace_base_ref })
       // base_ref 是该 goal 首次执行前的 anchor，reset 后该 worktree 回到"goal 还没跑过任何东西"的状态
       // 该 goal 的所有 run 的中间产物（在该 worktree 自己的分支上）被清除
    else:
       skip（worktree 已不存在，等同 PHASE 4 删行）
  for goal in goalsAfterCursor:
    if goal.workspace_dir 存在:
       Worktree.remove({ dir: goal.workspace_dir, branch: goal.workspace_branch })
    // 不存在则 noop

  ★ 主 Instance.worktree（task root）：v2 不动它
    理由：未 merge 到主分支的修改全在 goal worktree 内（已被 PHASE 3 处理）；
         已 merge 的修改是"意向交付"，rewind 不撤销已 merge 提交（git history 是 append-only，
         撤回 git commit 是用户手动决策，rewind 不越权）。

PHASE 4  DB 单事务原子写
  BEGIN
    UPDATE engine_task SET
      rewind_cursor_time     = $cursorTime,
      rewind_cursor_event_id = $anchorEventID,
      rewind_count           = rewind_count + 1,
      time_updated           = now
      WHERE id = $taskID
    UPDATE engine_artifact SET status='aborted' WHERE id IN abortTargets AND status NOT IN terminal
    // 仅 grace 超时未自然 abort 的 run 才需要兜底 UPDATE
  COMMIT
  -- 单事务：DB 状态原子一致

PHASE 5  事件总线
  emit Event.TaskRewound { taskID, cursorTime, anchorEventID, reason, rewindCount,
                           impacts?: { affectedRunCount, affectedGoalCount, abortedExecutorCount } }

RETURN { taskID, cursorTime, rewindCount,
         affectedRunIDs, affectedGoalIDs, abortedExecutorIDs,
         externalSideEffectsWarning: ["channels", "github"] }  // §6.2
```

**不变量**：

- 完成后，**任何 cursor 之前已完成 run 的代码状态保持不变**（它们的 worktree 已 reset 到 base_ref，意味着"该 goal 在 cursor 时刻还未开始任何 run"——这是与"完整 rewind 到 cursor 时刻"的差异，见 §10）。
- **不试图保证**：cursor 在某 goal 的某 run 中途时，回滚到该 run 中途状态（无此粒度的存档点；要做需新增 per-step git commit，YAGNI）。
- **取舍**：v2 把"cursor 落在 goal A 第二个 run 中途"近似为"goal A 整体回到 base_ref"。审视：这与用户对 rewind 的心理模型（"撤回到那条事件之前的世界"）一致——goal 还在，但代码退回 goal 起点。

## 5. abort 入口（最小侵入）

**不**新建全局 abort 注册表。复用既有：

- 已有 `interruptTaskLoop(taskID)`（`orchestrator/loop.ts`）能中断 task 级 loop。
- 已有 `eventBridgeAborts: Map<id, AbortController>`（`engine/runtime.ts`）按 runID/goalRunID 索引。

新增**单一查询函数**（`engine/runtime.ts` 内导出）：

```ts
export function lookupRunAbort(runID: string): AbortController | undefined {
  return eventBridgeAborts.get(runID)
}
```

`rewindTask` 在 PHASE 2 同时调 `interruptTaskLoop(taskID)` + `lookupRunAbort(runID)?.abort(...)`，覆盖 task loop 与 run-level event bridge 两层。

**跨进程 executor**：abort signal 不自动传播到 child process。**v2 不解决跨进程 abort**——依赖 executor 协议本身的 cancel message（已存在的 `protocol/cancel`，若不存在则 grace 超时后 process recovery 接管）。这是 abort 的固有限制，不是 rewind 引入的新债。

## 6. API 与事件

### 6.1 路由（`server/routes/orchestrator.ts`）

```
POST /task/:taskID/rewind
  body  : { cursorTime, anchorEventID?, reason? }
  reply : {
    taskID, cursorTime, rewindCount,
    affectedRunIDs: string[],
    affectedGoalIDs: string[],
    abortedExecutorIDs: string[],
    externalSideEffectsWarning: string[]   // 见 §6.2
  }
  errors: 4xx invalid input;  5xx worktree git op fail（throw 透传）

POST /task/:taskID/rewind/clear
  reply : { taskID, rewindCount }
  // 仅清 cursor，不试图重建被 reset/remove 的 worktree（YAGNI）
```

**v2 删除** `GET /rewind/preview`：client 端用 `GET /task/:id/progress` 已返回的 describe 数据自算"哪些 run 被影响"，无需 server 新接口。

### 6.2 事件 schema 扩展（向后兼容）

`engine/model.ts` 的 `Event.TaskRewound` 加一个 **optional nested**：

```ts
TaskRewound: {
  taskID, cursorTime, anchorEventID?, reason?, rewindCount,
  impacts?: {                          // ← 新增，optional 保证旧 client 不破
    affectedRunCount: number,
    affectedGoalCount: number,
    abortedExecutorCount: number,
  }
}
```

外部副作用警示通过 reply.externalSideEffectsWarning 返回，**不**进事件 payload（事件是 server 内部投影，外部副作用是 UI 提示用）。

## 7. UI 集成（实事求是）

**前置事实（subagent 3 §1.2 核实）**：Web 与 Overlay **当前没有 task event timeline 组件**。"加一个 rewind 按钮"不是 6h，是先建 timeline 再加按钮。

| 端               | 改动                                                                                                                                       | 工作量   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Web              | 新建 timeline component（事件卡片列表、时间排序、anchor 高亮）+ 右键 "rewind to here" + client 端计算受影响范围 + 二次确认 dialog 显示影响 | ~6h      |
| Overlay          | 同上（独立组件）                                                                                                                           | ~7h      |
| TUI              | 新增 `/rewind <eventID>` 命令；现有 `/undo` 不动                                                                                           | ~1h      |
| 二次确认必显字段 | 受影响 run 数、goal 数、被 abort 的 executor 数、**externalSideEffectsWarning 列表**（§6.2，subagent 3 §2.2）                              | 含在上面 |
| **小计**         |                                                                                                                                            | **~14h** |

## 8. 测试清单

文件：`packages/opencorvus/test/engine/rewind.test.ts`

1. `applyRewindCursor` 单元（保留现有，独立于副作用）
2. `rewindTask Phase 1 枚举正确性`：mock 5 个 run/3 个 goal、cursor 落点不同 → 验证 affectedRunIDs/affectedGoalIDs 划分
3. `rewindTask Phase 3 reset 已存在 goal`：seed goal worktree（真实 git）、写文件、跑 rewindTask → worktree 文件 == base_ref 时刻
4. `rewindTask Phase 3 remove cursor 之后的 goal`：seed goal worktree 时间戳 > cursor → rewindTask 后该目录被删
5. `rewindTask abort signal 发到 run`：注册 mock AbortController → rewindTask → controller.signal.aborted == true
6. `rewindTask grace 超时兜底`：mock 不响应 abort 的 run → 超时后 DB status='aborted'
7. `rewindTask 并发 rewind 拒绝`：两个 rewind 同时跑 → 第二个 throw（assertNotBusy）
8. `rewindTask Worktree.reset 失败 throw`：mock reset 失败 → 整体 throw、cursor **未写入**（PHASE 4 是事务边界）
9. `clearRewindCursor 仅清 cursor`：rewind → clear → describe 看到全部事件、worktree **不**被重建
10. **集成测试**：seed task + 2 goals + 4 runs（真实 sqlite + 真实 git worktree） → rewindTask → 文件状态 + DB 状态 + 事件全验

测试基础设施缺口（subagent 3 §1.3）：

- 需新建 `test/fixture/task-builder.ts`（seed task / goal / run / artifact）— ~150 LoC，**先于** rewindTask 测试合入

## 9. 实施步骤（线性依赖，每步 commit + push）

| #   | 步骤                                                               | 文件                                             | 估时  | 依赖 |
| --- | ------------------------------------------------------------------ | ------------------------------------------------ | ----- | ---- |
| 1   | 加 config `rewind.abortGracePeriodMs`                              | `config/config.ts`                               | 30min | —    |
| 2   | `lookupRunAbort` 导出                                              | `engine/runtime.ts`                              | 30min | —    |
| 3   | test fixture: task-builder                                         | `test/fixture/task-builder.ts`                   | 4h    | —    |
| 4   | `engine/rewind.ts` 重写（PHASE 0-5）                               | `engine/rewind.ts`                               | 6h    | 1, 2 |
| 5   | API 路由更新                                                       | `server/routes/orchestrator.ts`                  | 1h    | 4    |
| 6   | Event.TaskRewound schema 扩 impacts                                | `engine/model.ts`                                | 30min | 4    |
| 7   | 测试 1-9（单元）                                                   | `test/engine/rewind.test.ts`                     | 5h    | 3, 4 |
| 8   | 测试 10（集成）                                                    | `test/engine/rewind-integration.test.ts`         | 4h    | 3, 4 |
| 9   | Web timeline + rewind UI                                           | `packages/web/src/...`                           | 6h    | 5, 6 |
| 10  | Overlay timeline + rewind UI                                       | `packages/opencorvus/overlay/...`                | 7h    | 5, 6 |
| 11  | TUI `/rewind` 命令                                                 | TUI 入口                                         | 1h    | 5    |
| 12  | 文档：zh-CN + en                                                   | `packages/web/src/content/docs/{concepts/agent-loop,zh-cn/concepts/agent-loop}.mdx` | 1h    | —    |
| 13  | 修改 `engine/rewind.ts:13-19` 注释（OUT-OF-SCOPE 改写为 IN-SCOPE） | `engine/rewind.ts`                               | —     | 4    |

**总工时**：~36h ≈ **5 工作日**（单人，含调试）。

## 10. 已知近似与限制（写明，防漂移）

1. **goal-中途 cursor 近似为 base_ref**：cursor 落在某 goal 已开始的 run 中途时，该 goal worktree 退到 base_ref（即"goal 起点"），不退到"run 中途状态"。理由：无 per-step 存档点；要做需 per-iteration git commit，是另一个独立 feature。
2. **主 worktree 不动**：已 merge 提交不撤销。用户要撤销已 merge 提交是 `git revert` 的事，rewind 不越权。
3. **abort 不可逆**：clear cursor 不能复活已 abort 的 executor。
4. **跨进程 executor abort 受协议限制**：grace 超时只能写 DB 状态，process recovery 兜底进程清理。
5. **外部副作用**（channel 消息、gh PR）不撤销，UI 必须显式警示。
6. **goal worktree 内未跟踪文件**：`Worktree.reset` 用 `git reset --hard + clean` 或类似，需核实其是否清理 untracked。**实施步骤 4 必须先核 Worktree.reset 的实际行为**；若只 reset tracked，需在 PHASE 3 内补一次 `git clean -fdx`（合并到 reset 实现，不在 rewind 里 hack）。
7. **Windows core.autocrlf**：Worktree.reset 走 git，受 worktree 的 .gitattributes / autocrlf 影响。这是 git 通用行为，文档提示即可，不是 rewind 特有。

## 11. 与 LLM session 的衔接（subagent 3 §2.1）

rewind 后，下一次用户消息进来时，orchestrator 会重读 task → describe 层（已应用 cursor 过滤）返回 cursor 之前的事件 → 进入 LLM。

**问题**：LLM session 的内部缓存（messages 数组、tool result cache）是否携带 cursor 之后的旧内容？

**v2 决策**：rewindTask 的 PHASE 5 之后，发布 `Event.TaskRewound`；session.ts 已订阅该事件（**实施步骤 4 必须新增订阅**）→ 调 `SessionPrompt.invalidateContext(taskID)`，强制下次 prompt 重建 message context。**这是 step 4 的子项，不能漏**。

## 12. 与 SessionRevert 的硬边界（规则 22 不豁免，需立规矩）

| 操作                   | 允许动                                                                                     | 禁止动                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `SessionRevert.revert` | session 表 / message 表 / part 表；**Snapshot.revert(patches)** 仅恢复**主 worktree** 文件 | goal worktree、engine_task / engine_goal\* 表、跨 task 状态 |
| `Task.rewindTask`      | engine_task / engine_artifact 表；**Worktree.reset/remove** 仅作用于 goal worktree         | message 表、part 表、Snapshot 子系统、主 worktree 文件      |

两者作用面**正交不重叠**：session 维度关心对话与主 worktree（session 是用户对话场，对话产物落到主树）；task 维度关心 goal worktree（goal 是 orchestrator 的并发执行单元，每个 goal 自己的 worktree）。

**实施步骤 4 必须**：在 `engine/rewind.ts` 顶部加注释明确"task rewind 不调用 Snapshot.\*"，并在 PR review 把它作为静态规则。

## 13. 显式不做（防 scope creep）

- ❌ redo（rewind 的 rewind）
- ❌ partial rewind（按文件选择）
- ❌ rewind preview API
- ❌ rewind audit 表
- ❌ rewind 历史 graph
- ❌ 跨进程 executor abort 协议改造
- ❌ per-iteration 文件存档点
- ❌ channel / PR 回滚
- ❌ Snapshot 子系统接入 task rewind 路径

每条都是"未来要时再加"，YAGNI。

## 14. 验收（自验 + 用户复核）

- [ ] §8 测试 1-10 全绿
- [ ] grep 确认 `engine/rewind.ts` 不 import `Snapshot`（边界硬约束）
- [ ] grep 确认 `session/revert.ts` 不 import `Worktree`（边界硬约束）
- [ ] `engine/rewind.ts:13-19` 的 OUT-OF-SCOPE 注释改写为 IN-SCOPE，并加 §12 边界说明
- [ ] rewindTask 在 1k 事件 task 上 < 500ms（不含 abort grace）
- [ ] rewindTask 不写 sqlite 任何新字段（v2 无 schema 变更）
- [ ] PHASE 4 事务原子性测试：注入 PHASE 3 失败 → cursor **未**写入
- [ ] Web/Overlay UI 的二次确认 dialog 显示 externalSideEffectsWarning
- [ ] LLM session context 在 rewind 后被 invalidate（step 4 子项）

## 15. 防漂移检查清单

实施时每完成一步对照：

1. ✋ 没有 `Snapshot.track / restore / revert` 出现在 task rewind 调用链
2. ✋ 没有新增 SQL 表、没有新增列
3. ✋ 没有新增 `if (legacy)` / `if (config.rewindV2)` 分支
4. ✋ grace period 走 config，不写魔数
5. ✋ 每步 commit + push（不绕 hook，规则 21）
6. ✋ PR description 链回本文档
7. ✋ 任何"为未来预留"的代码注释立即删除（YAGNI）
8. ✋ `engine/rewind.ts:13-19` 与 §12 同步更新；任何一份漂移即视为质量缺陷
9. ✋ session.revert 与 task.rewind 的代码不互相 import

## 16. 工作量与风险

- **总工时**：~36h（5 工作日）
- **代码**：~700 LoC（rewind 重写 250 + abort 入口 30 + Worktree.reset 增强 80 + API/event 100 + UI 250）
- **测试**：~600 LoC（fixture 150 + 单元 250 + 集成 200）
- **文档**：~150 LoC（zh-CN + en + agent-loop.md 一节）
- **风险等级**：**中-低**（v2 全部基于既有原语，无新存档机制；最大不确定性是 Worktree.reset 对 untracked 文件的行为，实施步骤 4 第一件事就是核它）

## 17. 实施前开放问题（已决议，2026-04-27）

**1. `Worktree.reset` 改造**

- **核实事实**（`worktree/index.ts:857-984`）：reset 已清 untracked（line 953 `sweep` + 968 `submodule foreach git clean -fdx` + 973-981 `git status --porcelain` 必须空）。**但** target 硬编码到默认分支 remote HEAD（line 935），**不接受任意 ref/hash**。
- **决议**：**扩展** `Worktree.reset` 接受可选 `baseRef`，**不**新建第二个函数。
- 落地：`ResetInput` 加 `baseRef: z.string().optional()`；line 935 改 `const target = input.baseRef ?? (remoteBranch ? ${remote}/${remoteBranch} : localBranch)`。`reset.ts` 测试补 baseRef case。
- 理由：rule 22（无双源）+ rule 24（单一原语）。

**2. `lookupRunAbort` 防滥用**

- **决议**：命名 + JSDoc 约束，**不上 lint**。函数命名 `lookupRunAbort`（lookup 暗示只读），JSDoc 注 "intended caller: engine/rewind.ts only"。PR review 盯。
- 理由：rule 26（不为假想滥用过度工程）+ rule 29（review 比 lint 智能）。

**3. `Event.TaskRewound.impacts` 兼容性**

- **决议**：step 6 先 grep `TaskRewound` zod schema 与所有消费者，**再决定**加法。
- 如果 schema `.strict()`：消费者必须同步升级到新版（rule 22 不准 v1/v2 schema 并存）。
- 如果默认或 `.passthrough()`：optional `impacts` 直接加，旧 client 自然忽略。

**4. `abortGracePeriodMs` 粒度**

- **决议**：**instance 级**。`config.rewind.abortGracePeriodMs` 单一来源，default 5000。
- 理由：rule 26（当前需求无 per-task 差异化）+ rule 29（一刀切就够，复杂场景 LLM 决策）。task 级是未来 feature，YAGNI。

## 18. v2 文档内修正记录（基于 §17 决议）

- §4 PHASE 3 描述的 `Worktree.reset({ branch, baseRef })` 与现有 API 不符 → 实施步骤 4 之前先做 step 0：扩展 `Worktree.reset` API（约 1h，含测试）。**新增到 §9 步骤表头部**。
- §16 工时调整：原 ~36h → **~37h**（+1h for Worktree.reset 扩展）。

## 19. 实施步骤更新表（替代 §9）

| #     | 步骤                                                          | 文件                                             | 估时     | 依赖    |
| ----- | ------------------------------------------------------------- | ------------------------------------------------ | -------- | ------- |
| **0** | **`Worktree.reset` 加 `baseRef` 参数 + 测试**                 | `worktree/index.ts`                              | **1h**   | —       |
| 1     | 加 config `rewind.abortGracePeriodMs`                         | `config/config.ts`                               | 30min    | —       |
| 2     | `lookupRunAbort` 导出 + JSDoc                                 | `engine/runtime.ts`                              | 30min    | —       |
| 3     | test fixture: task-builder                                    | `test/fixture/task-builder.ts`                   | 4h       | —       |
| 4     | `engine/rewind.ts` 重写（PHASE 0-5）+ 注释更新                | `engine/rewind.ts`                               | 6h       | 0, 1, 2 |
| 5     | API 路由更新                                                  | `server/routes/orchestrator.ts`                  | 1h       | 4       |
| 6     | grep `TaskRewound` schema → 按 §17.3 决议扩 impacts           | `engine/model.ts` + 消费者                       | 30min~2h | 4       |
| 7     | 测试 1-9（单元）                                              | `test/engine/rewind.test.ts`                     | 5h       | 3, 4    |
| 8     | 测试 10（集成）                                               | `test/engine/rewind-integration.test.ts`         | 4h       | 3, 4    |
| 9     | Web timeline + rewind UI                                      | `packages/web/src/...`                           | 6h       | 5, 6    |
| 10    | Overlay timeline + rewind UI                                  | `packages/opencorvus/overlay/...`                | 7h       | 5, 6    |
| 11    | TUI `/rewind` 命令                                            | TUI 入口                                         | 1h       | 5       |
| 12    | 文档：zh-CN + en                                              | `packages/web/src/content/docs/{concepts/agent-loop,zh-cn/concepts/agent-loop}.mdx` | 1h       | —       |
| 13    | 修改 `engine/rewind.ts:13-19` 注释（OUT-OF-SCOPE → IN-SCOPE） | `engine/rewind.ts`                               | —        | 4       |

**总工时**：~37h ≈ **5 工作日**（单人）。

**§17 全部决议完成，可立即启动 step 0。**
