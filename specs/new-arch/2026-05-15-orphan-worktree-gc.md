# Orphan Worktree GC — 定期清理孤儿 worktree

**Status**: Implementing (2026-05-15)
**Author**: Claude + manual review
**权威依据**: `specs/new-arch/10-worktree-lifecycle.md` §2.1 / §6 / §9 Phase F

## 0 · TL;DR

落地 `10-worktree-lifecycle.md` §9 一直**未实现的 Phase F**——对齐 Claude Code 的
"orphaned subagent worktree sweep"。新增一个 `scope:"global"` 的 `Scheduler` 周期任务
`WorktreeGC`,周期性扫描每个 project 的 `<primary>/.opencorvus/worktrees/` 子目录,
**仅**清理同时满足以下全部条件的目录:

1. **非活跃**:不在任何 live goal_run 的 `workspace_dir` 集合里;
2. **足够旧**:目录 mtime 早于 `retentionDays`(默认 3 天);
3. **干净**:`git status --porcelain` 为空(无 uncommitted、无 untracked);
4. **无在途提交**:worktree HEAD 没有未并入 project primary 分支的 commit。

或者是 **zombie**(目录在 worktrees root 下、`.git` 链接缺失、足够旧、非活跃)——
这正是 §10-worktree-lifecycle §8.1 描述的 Windows 部分失败残留,直接清。

## 1 · 为什么不是"删除一切 3 天以上的 worktree"

用户原始诉求是"删除 3 天以上的 worktree"。但 `10-worktree-lifecycle.md` §2.3 是
**已实现(Implemented)**的架构决策,明确规定:`failed` / `aborted` / `task cancel` /
`restart_from_stage` / `engine-recovery` 的 worktree **禁止物理清理**——失败现场是下一轮
retry 的输入,删掉会让 executor 回到"空 worktree 盲猜"的不收敛反模式(§1 根因)。

因此"纯按年龄删"会直接违反 §2.3。正确做法由同文档 §2.1 / §6 已经给出,即对齐
Claude Code 的孤儿 sweep gate:`age` **AND** `no uncommitted` **AND** `no untracked`
**AND** `no unpushed commits`。本方案落地的就是这条已被设计采信、但 §9 Phase F 一直
未实现的 gate。年龄(3 天)是其中一个 gate,不是唯一 gate。

"unpushed commits" 在本项目语义下没有 remote 概念,等价物是
"worktree 分支上尚未并入 primary 分支的 commit"(`<primaryBranch>..HEAD` 非空)——
有未并入提交即代表仍有在途交付物,保留。

## 2 · 单一来源:worktrees root 路径

`worktree/index.ts::create()` 内联了 `path.join(primaryDir,".opencorvus","worktrees")`。
WorktreeGC 必须复用**同一来源**(rule 8 / rule 35),否则两处路径定义即双源。
方案:在 `Worktree` namespace 暴露 `worktreesRoot(primaryDir)`,`create()` 改为调用它,
`WorktreeGC` 也调用它。(测试里的重复路径不在本次范围,rule 5 不过度扩张。)

## 3 · 模块结构(镜像 ProjectGC)

`packages/opencorvus/src/worktree/gc.ts`,namespace `WorktreeGC`:

- `inspect(opts?: { retentionDays?; now? }): Promise<Plan>` —— **纯计划**,无副作用,可单测。
  遍历 `ProjectTable`(id, worktree=primaryDir),对每个 project:
  - `liveDirs = listLiveGoalRunsForProject(projectID)` 的 `workspace_dir`(canonical)
  - 枚举 `worktreesRoot(primaryDir)` 子目录,逐一过 §0 四 gate / zombie 判定
  - 产出 `{ projectID, primaryDir, directory }[]`
- `apply(plan): Promise<ApplyResult>` —— 对每条 `Instance.provide({directory: primaryDir})`
  包裹后调 `Worktree.remove({ directory })`(remove 内部走 `withGitLock`、注销 git
  worktree、停 fsmonitor、rm -rf、删 branch)。失败仅 `log.warn`,不抛(单条失败不阻塞其余)。
- `init()` —— `Scheduler.register({ id:"worktree.gc", scope:"global", interval, run })`。
  模块级 `running` 布尔重入守卫(git 操作慢,周期 6h,幂等)。

常量(镜像 ProjectGC 的硬编码 + 导出 DEFAULT\_\*,**不加用户 config 旋钮**,
对齐 `10-worktree-lifecycle.md` §10 Q5 作者倾向 + rule 5/6 不过度工程):
`GC_INTERVAL_MS = 6h`,`DEFAULT_RETENTION_DAYS = 3`。

## 4 · 保守性原则

- 任一 git 探针失败(且 `.git` 链接存在)→ **保留**(不确定即不删,绝不误删在途交付物)。
- live 集合命中 → 无条件保留,不看年龄/干净度。
- 仅在四 gate 全过 或 明确 zombie 时才进入删除计划。

## 5 · 测试(rule 28 / 36)

`test/project/worktree-gc.test.ts`,真实 git + tmpdir,`fs.utimes` 造旧:

| 场景                              | 期望                                           |
| --------------------------------- | ---------------------------------------------- |
| 老 + 干净 + 无引用                | 进计划,apply 后 dir + branch 均删              |
| 最近 + 干净                       | **不在计划**(负例:周期清理不误伤近期 worktree) |
| 老 + untracked 文件               | 保留                                           |
| 老 + 有未并入 primary 的 commit   | 保留                                           |
| 老 + 干净 + 被 live goal_run 引用 | 保留                                           |
| zombie(删 .git)+ 老 + 无引用      | 删                                             |

## 6 · 接入

`project/bootstrap.ts::InstanceBootstrap` 在 `ProjectGC.init()` 后加 `WorktreeGC.init()`。
Scheduler global scope 按 id 去重,每个 Instance bootstrap 重复 register 安全(同 ProjectGC)。
