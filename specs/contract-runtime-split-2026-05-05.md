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

`retry_count` **保留在 engine_goal**：它是 goal 级累计计数器（V 标签来源），不属
于运行时短暂状态；只有写入 `startNewAttempt` 这一处递增。

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
- retry_count 是否应该派生而非缓存（数据规范化，不影响 contract 一致性）。
