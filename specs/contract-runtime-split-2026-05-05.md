# engine_goal contract / runtime 双源拆分（2026-05-05）

## 起因

任务 `tsk_df4520bd0001u2N6AagBJiSp8g`（17 goal AI Chat App，bench gemini）只完成
goal #1，剩 16 个 pending；DB 实查发现 #2/#7/#8/#15 的
`engine_goal.workspace_dir` 已被填上，但没有对应的
`engine_artifact[goal_run_attempt]` / build session / protocol_event。

子 agent 独立核实根因（命中 4/4）：

1. **架构缺陷**：`engine_goal` 表既存契约字段（title / objective / owned_paths /
   acceptance_specs / depends_on / exports / imports / kind / requirement_ids）
   又存运行时字段（workspace_dir / workspace_branch / workspace_base_ref）。
   注释写明 "stores contracts only"，但 schema 自打嘴巴。违反 CLAUDE.md rule 8
   （禁止双源）。
2. **副作用顺序错**：`packages/opencorvus/src/orchestrator/tools.ts:4267-4290`
   的 build tool 派发路径是 `Worktree.create() → updateGoalWorkspace() →
   fidelityCheck() → 失败 return`。失败路径**没有 cleanup worktree、没有回滚
   workspace_dir**。每次拒绝都留下脏 contract。
3. **路径语义错位**：`packages/opencorvus/src/architect/fidelity.ts:113`
   用 `row.paths.includes(ownedPath)`（数组字面值等价），但 architect 写的
   `sourceCoverage.paths` 是容器级路径（`["src","tests","public"]`），ownedPath
   是逐文件（`src/main.tsx`），永远不命中。
4. **缺少 owned_paths 重叠检测**：`packages/opencorvus/src/architect/output-tools.ts`
   的 `architectValidationIssues()` 没有跨 goal 的 `owned_paths` 重叠检查。
   bench 实例中 goal #1 (bootstrap) 与 goal #16 (页面路由) 都把 `src/App.tsx` /
   `src/main.tsx` 写进 owned_paths，违反 schema 的 "EXCLUSIVE write access" 契约
   但通过了校验。

## 方案（按 CLAUDE.md rule 7 / 8 / 35）

### Phase A：Hot-path 修复（修复阻塞性 bug，不动 schema）

| 修复 | 文件 | 改动 |
|---|---|---|
| A1 | `packages/opencorvus/src/architect/fidelity.ts` | sourceCoverage 路径覆盖语义改为 prefix-aware（POSIX 化后 `ownedPath === row || ownedPath.startsWith(row + "/")`），单一 source。 |
| A2 | `packages/opencorvus/src/orchestrator/tools.ts:4267-4290` | 把 `validatePersistedArchitectFidelity` 移到 `Worktree.create()` 之前。**不再修改 worktree-recovery 分支的副作用顺序**：那条分支没有"创建副作用"，只是从已记录的 worktree 路径恢复。 |
| A3 | `packages/opencorvus/src/architect/output-tools.ts` | 在 `architectValidationIssues()` 中增加跨 goal 的 owned_paths 重叠检测（normalized POSIX path 全等比较）。 |

每个修复配单元测试（rule 28 / 36）：
- `architect/fidelity.test.ts`：`sourceCoverage.paths=["src"]` 必须覆盖
  `src/main.tsx` 和 `src/components/Foo.tsx`；不覆盖 `pages/Foo.tsx`。
- `architect/output-tools.test.ts`：两个 goal owned_paths 共享 `src/App.tsx`
  必须报 `owned_paths overlap`。
- `orchestrator/tools.build-dispatch-order.test.ts`：fidelity 不通过时**不调用
  `Worktree.create`**、**不写 `engine_goal.workspace_dir`**。

### Phase B：架构清理（消除双源）

把 `engine_goal` 退回纯契约表：

- 删除 `engine_goal.workspace_dir`、`workspace_branch`、`workspace_base_ref` 三列。
- 所有读者改读最新 `engine_artifact[goal_run_attempt].payload.workspace_dir`：
  - `orchestrator/tools.ts` 的 build dispatch（recover 分支判断）
  - `workbench/board.ts:887` 的 board 视图
  - `engine/writer.ts:153` 的 cleanup 路径
- `engine/persist.ts:updateGoalWorkspace` 不再写 engine_goal，改写最新的
  goal_run_attempt artifact payload（已存在 workspaceDir 字段，复用）。
- 已存在 DB 直接 `bun run db:reset`（rule 18：禁止迁移，直接重建）。

### Phase E（CRON challenge，2026-05-05）：retry_count 一并搬走

原方案（上一版本）保留 `engine_goal.retry_count`，理由是单写者无观察到 desync。
CRON 5 分钟检查复读 rule 8 后判定：技术上仍是双源，必须移走。

- 删除 `engine_goal.retry_count` 列。
- 新 helper `engine/store.ts:getGoalRetryCount(goalID)` 读最新 attempt artifact。
- `openGoalImplementationVersion` 从 `tip.retry_count + 1` 派生 bump，不写 engine_goal。
- `startNewAttempt` resetWorkspace 路径同步去掉 retry_count 列写入。
- 所有读者（viewGoal / board.ts / V 标签 / architect existing-goals）走 helper。

### Phase F + G（Subagent 二次复核驱动，2026-05-05）：3 个隐藏 bug + fixture 修复

`code-reviewer` subagent 跨文件复核发现：

- `findGoalLatestWorkspace` / `getGoalRetryCount` 读最新 artifact 时被 supersede
  patch 干扰（`Math.max(existing.time_updated + 1, now)` 让 supersede 比新 attempt
  晚 1ms），导致 V 标签和 workspace 指针读到 retired attempt 的值。改成读 live
  tip（`findLatestTipGoalRun` 过滤掉被 supersede_of 引用的 row）。
- `getGoalRetryCount` 在 startNewAttempt-之后/beginBuildAttempt-之前的窗口期返
  回旧值。修复：tip 携带 `superseded_reason` 时返回 `tip.retry_count + 1`。
- `openGoalImplementationVersion` 已被 supersede 路径仍 early-return 旧 count。
  修复：拆分 early-return，已 superseded 返 `currentCount + 1`。
- `updateGoalWorkspace` 的 `coordinatorRunID: "synthetic"` 后门：build dispatch 在
  beginBuildAttempt 之前调 updateGoalWorkspace，撞上 no-tip 路径就建一个假 run
  指向的 queued artifact。这两条 pre-beginBuildAttempt 调用本身就是冗余（
  beginBuildAttempt 接管 workspace 指针），删除并把 `updateGoalWorkspace` 的 no-
  tip 路径改成 throw（rule 7：禁止 fallback）。
- 12 个测试 fixture 仍向 EngineGoalTable insert `retry_count: 0` 等已删除列。
  Drizzle 静默丢弃未知字段，导致 8 个 start-new-attempt 测试原本"通过"是基于
  对 undefined 的断言。subagent 批量修复，新增 `seedAttemptWithWorkspace` 帮助
  函数让 fixture 直接写 attempt artifact，绕开 updateGoalWorkspace 后门。
- 新测试 `test/engine/update-goal-workspace-no-tip.test.ts` 把 Phase G 契约钉住。

### Phase C：DB 重建 + 测试

- 直接 reset DB（CLAUDE.md rule 18）。
- typecheck 一次（不每笔），跑指定测试，提交。

### Phase D：Overlay benchmark 验证（rule 26 / 29）

- 启动 overlay-web-benchmark，无人值守，bench 期间发现的任何 bug 立刻深入修
  复 + 测试 + commit。
- bench 完成 → 起项目对比图 + verify（rule 24 二次复核）。

## 不在本次范围

- orchestrator 在 goal #1 完成后直接派 deliver 而非接着派 #2-#16 的 LLM 决策
  问题（属另一类 bug，单独追）。

## Commit 串

| Phase | Commit | 说明 |
|---|---|---|
| A | `c4c9e06da` | fidelity prefix + dispatch 顺序 + owned_paths 重叠 |
| B | `c13aa7671` | 删 workspace_dir/branch/base_ref 三列 |
| E | `e53c05aaf` | 删 retry_count 列（CRON challenge 推动） |
| F+G | `a5d476cad` | subagent 二次复核：4 个 prod bug + 12 fixture 修复 |

每个 commit 通过 pre-push hook（typecheck / api:routes-check / docs:check / i18n /
secret-scan）。146/146 测试绿。
