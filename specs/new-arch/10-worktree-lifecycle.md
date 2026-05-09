# 10 · Worktree Lifecycle — "Preserve on Progress" 设计方案

**Status**: Draft (2026-04-19)
**For**: Codex cross-validation before implementation
**Author**: Claude + manual review

## 0 · TL;DR

将 per-goal worktree 的生命周期**从 `goal_run` 绑到 `goal`**，对齐 Claude Code 的 "preserve-when-changes-exist" 策略。取消每次失败都 `cleanupGoalWorkspace` 的行为；worktree 只在明确终态（goal passed / 永久 failed / task cancel / restart_from_stage）才清。retry 时**复用前次 worktree**，executor 以"上次停留的现场 + 反馈"为起点修，而不是每次空 worktree 从零写。

## 1 · 问题陈述

### 症状
`bench14` 跑 AMD chart 复刻：goal 2 被 owned_paths conformance gate 正确拦截 4 次，每次 supersede + 重跑，但**每次违规位置完全不同**：
1. `src/src/` 双层嵌套
2. `server/index.ts outside owned_paths`
3. `src/App.tsx outside declared`
4. yet another new wrong location

executor 根本没收敛——每次以"空 worktree"起步，没看到前次自己写的错位置。

### 根因
1. `goal-pool.ts` 三个失败路径（pipeline-error / conformance gate / per-goal evaluator）都调用 `cleanupGoalWorkspace(worktreeDir)` → `Worktree.remove` → **删 dir + 删 branch**
2. `goal_run` supersede 创建新 goal_run → `dispatchGoal` 调 `Worktree.create` → **全新 worktree 从 baseRef branch out**
3. `goal/runner.ts:491` retry prompt 声称 "previous delivery files have already been restored into this worktree" —— **这一直是谎话**，文件没有被 restore
4. executor 看到：空 worktree + retry feedback 描述前次违规的文件（这些文件不存在）→ 无法 "modify them"，只能从零重写 → 每次新 LLM 盲猜新路径 → 不收敛

### 行业对照
| 系统 | 失败/重试后默认是否立即丢弃工作空间 |
|---|---|
| Claude Code | **否**（无改动自动删；有改动或 commits 时提示 keep/remove；孤儿 subagent worktree 仅在 age + no uncommitted + no untracked + no unpushed commits 时清） |
| Codex Cloud | **否**（每个 task 独立 container；environment cache 最多 12h，用于加速新任务和 follow-up，但官方未承诺跨 task 保留上次工作区脏状态） |
| Codex CLI | **否**（默认直接在当前 cwd 运行；sandbox 是安全边界，不是 retry 生命周期） |
| **opencorvus 当前** | **是**，每次失败都删 |

→ 我们是**孤立反模式**。

### 约束
- CLAUDE.md rule 1：no fallback
- CLAUDE.md rule 2：no 打补丁兼容旧（不留双路径 `if (retryable) skip_cleanup`）
- CLAUDE.md rule 4：改本质，不绕过
- CLAUDE.md rule 12：禁 "最简单的修复"（如 git tag save/restore 补丁）
- 不破坏 per-goal 并行：每 goal 一个 worktree 的隔离语义保留

## 2 · 设计原则

### 2.1 对齐 Claude Code
以下只采信公开一手文档，不把推断写成产品事实。

Claude Code 本地 worktree 会话的清理策略（公开文档）：
- 无改动 → 自动删
- 有改动或 commits → 提示用户 keep/remove；keep 会保留目录和 branch，remove 会删除目录和 branch
- 对 crash / interrupted parallel run 遗留的 orphaned **subagent** worktree：仅在 `older > cleanupPeriodDays` + `无 uncommitted` + `无 untracked` + `无 unpushed commits` 时自动清
- 官方能确认的是上面这些退出/清理条件；不能外推成"所有有改动的 worktree 在任何模式下都永不自动删"

本方案借鉴其保守原则：**默认不删除仍可能承载在途修改的 worktree；只有 clean 或明确终态时才清**。

### 2.2 生命周期绑定改 goal
| 状态 | worktree 生命周期 |
|---|---|
| 当前 | goal_run ↔ worktree 1:1，每 run 建、每 run 清 |
| 新设计 | **goal ↔ worktree 1:1**，goal 首次 dispatch 建，goal 终态才清 |

依据：同 goal 的多个 goal_run（supersede chain）本质上是"同一任务的多次 attempt"，共享工作空间更合理。并发安全由 `LIVE_GOAL_RUN_STATUSES` 保证——同 goal 同时只有一个 live goal_run。

### 2.3 什么是终态
触发 worktree 清理的时机（**只有这些**）：
1. **goal.status = passed**：delivery cherry-pick 合并成功后
2. **goal.cascade_state = failed**（永久失败）：orchestrator 基于证据显式判定无法继续提升，或 dispatch 前抛
3. **task cancel**（`abortLiveExecutionForTask`）
4. **restart_from_stage**
5. **orchestrator 判断任务无法继续提升并显式终止**
6. **engine-recovery 启动孤儿清理**（配合 Claude Code 式 3-gate：age + clean + no untracked + no unpushed commits）

### 2.4 可重试失败不清
原三处 `cleanupGoalWorkspace` 调用（pipeline-error / conformance gate / eval-reject）**全部删除**。这些都是"可重试失败"，worktree 保留供下次 retry 复用。

## 3 · 数据模型

### 3.1 engine_goal 新增字段
```
engine_goal:
  + workspace_dir   text    -- 当前 live worktree 绝对路径（goal 级单例）
  + workspace_branch text   -- 对应 git branch
```

新增字段的语义：
- goal 首次 dispatch 时写入
- goal 终态清理时 SET NULL + 删物理 worktree
- goal_run.workspace_dir 仍保留（历史记录），但**不再权威**——goal.workspace_dir 才是活的

### 3.2 engine_goal_run 字段语义调整
- `workspace_dir`：记录这个 goal_run **使用的**（复用或创建）worktree。不负责生命周期。
- `base_ref` / `merge_ref`：保留，每 attempt 独立。
- `retry_count`：保留，用于判断终态。

## 4 · 行为规范（状态迁移）

### 4.1 首次 dispatch
```
pool.dispatchGoal(goal) where goal.workspace_dir IS NULL
  → Worktree.create({ name: `goal-${goalId.slice(-8)}`, checkout: "sync" })
  → UPDATE engine_goal SET workspace_dir=<dir>, workspace_branch=<branch>
  → createGoalRun({ workspace_dir: <dir> })
  → 继续走现有 pipeline
```

### 4.2 Retry dispatch（supersede 触发的新 goal_run）
```
pool.dispatchGoal(goal) where goal.workspace_dir IS NOT NULL AND exists-on-disk
  → 跳过 Worktree.create
  → 复用 goal.workspace_dir / goal.workspace_branch
  → 新 goal_run.workspace_dir = goal.workspace_dir （同一目录）
  → Executor 看到的 cwd 就是前次 attempt 的现场
  → retry prompt 真实描述："前次 attempt 文件就在这个 worktree 里，修它们即可"
```

### 4.3 Worktree 缺失（恢复兜底）
```
pool.dispatchGoal(goal) where goal.workspace_dir IS NOT NULL BUT not-exists-on-disk
  → 这是异常状态（process crash 后磁盘被清）
  → 不是 fallback，而是明确的 recovery：从 goal.workspace_dir 抛 WorktreeMissingError
  → orchestrator 把 goal 标 cascade_failed，要求重新走 dispatch 路径
  → OR：log.error + UPDATE goal SET workspace_dir=NULL + 重新 Worktree.create
  → 选哪条由 Codex 拍板
```

### 4.4 Goal 终态 passed
```
deliver 阶段成功 cherry-pick merge → goal.status = passed
  → trigger cleanup
  → await cleanupGoalWorkspace(goal.workspace_dir)
  → UPDATE engine_goal SET workspace_dir=NULL, workspace_branch=NULL
```

### 4.5 Goal 终态 cascade_failed（orchestrator 显式终止）
```
orchestrator calls fail_task / records a terminal failure decision from evidence
  → updateGoalCascadeFailed(goalID)
  → trigger cleanup
  → UPDATE engine_goal SET workspace_dir=NULL, workspace_branch=NULL
```

### 4.6 Task cancel / restart_from_stage
```
abortLiveExecutionForTask 已有入口（writer.ts）
  → listGoalsForTask + 对每个有 workspace_dir 的 goal 做 cleanup
  → UPDATE engine_goal SET workspace_dir=NULL, workspace_branch=NULL
```

### 4.7 启动孤儿清理（engine-recovery）
对齐 Claude Code 的 3-gate：
```
listLiveGoalRunsForProject → 每个关联的 goal.workspace_dir：
  if (不存在 live goal_run) AND (age > cleanupPeriodDays) AND (git-clean 检查: no uncommitted + no untracked + no unpushed commits):
    清理物理目录 + UPDATE goal SET workspace_dir=NULL
  else:
    留着，日志告警（"goal X workspace preserved: has in-progress state"）
```

## 5 · 代码变更面

### 5.1 engine.sql.ts / storage/ddl.ts
- engine_goal 加 `workspace_dir text`, `workspace_branch text`
- Rule 14：禁迁移数据库 → reset DB 重建

### 5.2 engine/goal-pool.ts::dispatchGoal
- 入口查 `engine_goal.workspace_dir`
  - NULL → 走首次 dispatch 路径
  - NOT NULL + exists → 复用
  - NOT NULL + not-exists → 抛 WorktreeMissingError
- 成功首次 create worktree 后 UPDATE engine_goal 的 workspace_dir/workspace_branch
- **删除所有失败路径的 `cleanupGoalWorkspace` 调用**（3 处）

### 5.3 engine/goal-pool.ts / engine/runtime.ts · 终态 cleanup
- 新增 `cleanupGoalOnTerminal(goalID)`：
  ```
  const row = findGoal(goalID)
  if (row.workspace_dir) {
    await cleanupGoalWorkspace(row.workspace_dir)
    updateGoal(goalID, { workspace_dir: null, workspace_branch: null })
  }
  ```
- 调用点：
  - deliver 成功 cherry-pick 之后（对所有 task goals 循环调用）
  - updateGoalCascadeFailed 之后
  - abortLiveExecutionForTask 内（替代原 cleanupWorkspace 选项）

### 5.4 goal/runner.ts::cleanupGoalWorkspace
- 函数**保留原样**（物理清目录 + remove worktree + branch）
- 不再被 per-attempt 失败路径调用
- 只被 per-goal-terminal 路径调用

### 5.5 goal/runner.ts::buildRetryFeedbackSection
- prompt 改 "previous delivery files have already been restored into this worktree" 为实话：
  ```
  "This worktree contains your prior attempt(s). The files you wrote before are 
   present — read them, compare to the failures below, and edit in place. Do NOT 
   delete them and start over unless the failure specifically requires it."
  ```

### 5.6 engine/writer.ts::abortLiveExecutionForTask
- 加参数 `cleanupGoalWorkspaces?: boolean`（默认 true）
- true 时遍历 task 的 goals，对有 workspace_dir 的调 cleanup
- 保持现有 abortGoalRuns 逻辑不变

### 5.7 engine/recovery.ts · 启动孤儿清理
- 读所有 project 的 engine_goal
- 对 workspace_dir 非空的：
  - 检查目录存在
  - 检查 git 状态（uncommitted / untracked / unpushed）
  - 检查 goal 状态（如果 goal.status 是 terminal 但 workspace_dir 未清，可能是上次 crash —— 清）
  - 非 terminal + 有在途 = 保留（等下次 dispatch 复用）

## 6 · Claude Code 对齐检查

| 项 | Claude Code | 本方案 |
|---|---|---|
| "有改动时不直接自动删" | ✅ 退出时提示 keep/remove，孤儿 sweep 只清 clean worktree | ✅ 可重试失败不清 |
| 退出/终态清理 | ✅ 无改动自动删；有改动需显式 remove 或满足孤儿清理 gate | ✅ goal terminal 才删 |
| 启动孤儿清理 gate | age + uncommitted + untracked + unpushed | 同样 gate |
| 复用 branch | ✅ | ✅ |
| 用户 keep/remove prompt | ✅（交互）| ❌ 不做（我们是 headless benchmark 主导） |

## 7 · 与既有系统的交互

### 7.1 与 Option B（supersedeGoalRun）
完全兼容。supersede 的语义"同一 goal 的新 attempt"与"同一 worktree 的新 attempt"一致。

### 7.2 与 manifest conformance gate
gate 本身不变，但它失败后不再触发 cleanup，只写 evidence + updateGoalRun(failed)。下次 supersede + dispatch 时 executor 看到**前次违规的文件**还在，能针对性改。

### 7.3 与 visual_diff vision-only
rendered.png 存在 `Instance.directory/.opencorvus/visual-diff/`（主 worktree 级），与 goal worktree 独立，不受本方案影响。

### 7.4 与 Phase C retry prompt
buildRetryFeedbackSection 的 evidence 读取路径不变。它读的 goal_run evidence 和本方案无冲突。

## 8 · 风险 / 未决

### 8.1 Windows 文件锁
current problem：失败时清 worktree 清不掉是**已知痛点**（bench12/13 遇到过 EACCES）。本方案**减少清理频次**（只在终态清），实际上**降低**这个问题暴露概率。但终态清仍有锁风险，保留 maxRetries=50 的 fs.rm 策略。

### 8.2 Worktree 累积
极端场景：长任务、多 goal、多 retry。总 worktree 数 = 活跃 goal 数（不是 goal_run 数）。典型 task 5-10 goals → 5-10 worktrees，可接受。对比旧设计高峰 goal_runs × concurrency worktrees，显著降低。

### 8.3 并发安全
supersedeGoalRun → dispatchGoal 之间有 gap，期间同 goal 不会有第二个 dispatch（LIVE_GOAL_RUN_STATUSES gate）。复用 worktree 是安全的。

### 8.4 Executor 看到"脏"worktree
首次失败后 worktree 里留着失败 attempt 的文件。retry 看到脏状态可能被"沉没成本"影响（LLM 不肯推翻自己上次写的）。Mitigation：retry prompt 明确 "you MAY delete files + rewrite if the failure requires structural change (e.g. wrong layout); do NOT get anchored by prior attempt".

### 8.5 Branch 复用 vs 新 branch
复用现有 branch：attempts 累积 commits 在同一 branch 上。好处：history 完整。坏处：branch 变"脏"。
另一选择：每 attempt 新 commit 到同一 branch 的 tip 之上。这是 git 默认行为，无需额外处理。

## 9 · 实施顺序

1. **Phase A**：schema（engine_goal 加字段 + reset DB）
2. **Phase B**：dispatchGoal 查 goal.workspace_dir 复用逻辑
3. **Phase C**：删除 3 处失败路径的 cleanupGoalWorkspace
4. **Phase D**：新增 cleanupGoalOnTerminal + 调用点接入
5. **Phase E**：buildRetryFeedbackSection prompt 实话化
6. **Phase F**：engine-recovery 孤儿清理对齐 Claude Code 3-gate
7. **Phase G**：bench 验证（AMD chart case，看 retry 是否收敛）

## 10 · 待定问题（请 Codex 拍板）

1. §4.3 worktree 磁盘缺失（process crash 后）：抛错 vs 自动重建？我倾向抛错（rule 1 no fallback）。
2. §5.6 abortLiveExecutionForTask 默认 cleanup 所有 goals 还是 opt-in？
3. §8.5 branch 复用是否需要在 retry 间 reset base（`git reset --hard baseRef` 再让 executor 重写）？还是完全累积？
4. orchestrator 显式终止后的清理和 delivery 成功清理是否需要不同延迟（例如保留最后一次失败的 worktree 几分钟供 debug）？
5. 是否要暴露 Config 选项给用户（`experimental.preserve_worktree_on_retry` 默认 true）以便紧急关闭？我倾向不加（rule 2）。

## 11 · 验收标准

bench15（AMD chart case）期望观察：
- [ ] goal 2 第一次失败 → worktree 保留（log "worktree preserved for retry"）
- [ ] goal 2 第二次 dispatch → "reusing workspace dir" log
- [ ] Executor 第二次能看到 `src/src/app/layout.tsx` 实际存在，能 move/rename 修复
- [ ] 3-4 次 retry 内收敛 passed，不是每次创新错位置
- [ ] goal 2 passed 后 → worktree 清理 log + goal.workspace_dir = NULL
- [ ] 其他 goals 正常推进
- [ ] task 完成后所有 goal workspace 都清理，`.opencorvus/worktrees/` 空
