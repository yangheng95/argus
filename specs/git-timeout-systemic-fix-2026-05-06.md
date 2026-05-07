# 系统性 git/abort timeout 修复 — 2026-05-06（v2，已 codex 评审修订）

## v1 → v2 主要修订

v1 错点（codex 指出）：
- 提出新建 `util/git-cmd.ts` —— **错**。已有 `util/git.ts:25` 的 `git()` helper 走 `Process.run`，自带 90s timeout + AbortSignal + SIGTERM→5s→SIGKILL（`util/process.ts:69-73`）。要做的是**强化与扩面，不造第二套**（rule 8）。
- 将 `engine/git.ts` 整体列入待迁移 —— **错**。`engine/git.ts:5` 已 `import { git } from "@/util/git"`，head/branch/commit/ensureGitignore/LKG reset 全部已走 helper。
- `orchestrator/tools.ts:2951+2958` 漏列 —— **错**。这是 direct build deliver 路径，属任务 loop 风险路径，必须 Phase 1。
- 30s 统一 timeout —— **错**。命令性质差异巨大，应按 profile 分级。

## 背景：两个症状，同一类病

**任务 A**（gemini）创建后 protocol_event 只有 `task.created`，loop 启动到 `EngineGit.prepare → state → Vcs.currentCommit/Vcs.state` 死等。这条链路上 `project/vcs.ts:99 / 111 / 180` 全是裸 Bun `$`，没走 `util/git.ts`，**绕过了既有的 timeout 兜底**。

**任务 B**（aimecode）`time_completed=null`、无 `task.cancelled` 事件，goal_run 已 aborted 但 cancelTask 走到一半卡住。`task-api/index.ts` 的 3 处 `await executor.abort(...)`（`:1290 / :1307 / :1598`）无 timeout race，executor 不响应就死等。`deleteTask:1128` 第一行 `await cancelTask` 跟着卡，UI 永远转。

## 共同根因

1. **裸 Bun `$\`git`** 散落多处，绕过 `util/git.ts` 的 timeout 兜底。grep 全仓 `$\`git` 共约 80 处，按风险路径分类（见下表）。
2. **3 处 `executor.abort` 无 timeout race**，cancelTask 链条任一断点都让 UI 卡死。
3. `util/git.ts` 默认 90s 偏粗，对 `rev-parse` 这种应该 5s 内的命令缺乏意图表达，对 clone 又过紧。

## 修复方案

### Phase 1（本 PR）— 关键路径全覆盖 + cancel 链路 timeout race

#### Step 1.1 — 强化 `util/git.ts`，引入 timeout profile

不新建文件。在 `util/git.ts` 内补：

```ts
export const GitTimeout = {
  /** rev-parse / show-ref / log -1 / status --short：纯读、本地、应秒级 */
  fast: 15_000,
  /** status / diff / add / commit / worktree remove：本地重操作 */
  default: 90_000,
  /** submodule / fetch / clone / push：网络相关 */
  network: 300_000,
} as const
```

`git(args, opts)` 签名扩展：`opts.timeoutProfile?: keyof typeof GitTimeout`，与 `opts.timeoutMs` 二选一，如同时指定以 `timeoutMs` 优先。**不改默认 90s 行为**（避免回归），新调用点必须显式指定 profile，由 lint 在 Phase 2 强制（见下文）。

错误信息增强：超时分支已包含 `args` 与 `timeoutMs`，再补 `cwd`。**`.git/index.lock` 不自动删**（codex 提醒），让上层 fail loud。

#### Step 1.2 — Phase 1 风险路径（5 个文件）迁到 `git()`

按 codex 修订，只迁移**任务 loop 实际经过**的裸 `$\`git`：

| 文件 | 行 | 命令 | profile | 说明 |
|------|----|------|---------|------|
| `project/vcs.ts` | 99 | rev-parse --short HEAD | fast | 任务 A 卡点最内层 |
| `project/vcs.ts` | 111 | rev-parse --abbrev-ref HEAD | fast | `state()` 内 |
| `project/vcs.ts` | 180 | status --porcelain=v1 --branch | default | `state()` 内 |
| `snapshot/index.ts` | 30/36/44-47/57/83/159/190/205/290/312/383/447 | init/config/write-tree/diff/add/checkout/ls-tree/rev-parse | 按命令分级 | `EngineGit.prepare → Snapshot.track` 必经 |
| `worktree/index.ts` | 202/213/247/250/257/277/288/555/561/576/586/599/640/647/668/747/772/777/818/925/936/950/1034/1057/1085/1148/1153/1170/1172/1189/1214/1250/1260/1265/1270/1275 | worktree add/remove/list、merge、status、commit、reset、submodule、clean | 按命令分级 | `abortLiveExecutionForTask({cleanupGoalWorkspaces:true})` 必经 |
| `orchestrator/tools.ts` | 2951/2958 | status --porcelain -uall / diff HEAD | default | direct build deliver 路径，任务 loop 直接 |

迁移规则：
- `await $\`git ...\`.cwd(X).quiet().nothrow().text()` → `(await git([...], { cwd: X, timeoutProfile: "..." })).text()`
- `result.exitCode` / `.stdout` / `.stderr` / `.text()` 行为保留（`util/git.ts` 已封装）
- 非 0 退出 + 不需要兜底的场景：`if (result.exitCode !== 0) throw new GitCommandError(...)`，但尽量不改语义；调用方原本怎么处理 exitCode 就保留怎么处理

`build/agent.ts` 的 8 处 `$\`git` 不在 cancelTask / loop 启动直接路径上，但属任务执行链——划入 **Phase 1.5**（同一个 PR 末尾，时间允许就一并做）。

#### Step 1.3 — `cancelTask` 加 timeout race

新增 `util/await-with-timeout.ts`：

```ts
export class AwaitTimeoutError extends Error {
  constructor(public readonly label: string, public readonly ms: number) {
    super(`${label} timed out after ${ms}ms`)
    this.name = "AwaitTimeoutError"
  }
}

export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AwaitTimeoutError(label, ms)), ms)
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}
```

`task-api/index.ts:1270-1340` 修改：

| 行 | 原 await | 修订 |
|----|---------|------|
| `:1290` | `await executor.abort(...).catch(() => false)` | `await withTimeout(executor.abort(...), 5_000, "executor.abort liveGoalRun").catch((err) => { log.warn("liveGoalRun abort timeout", { taskID, err }); return false })` |
| `:1298` | `await abortLiveExecutionForTask({...})` | `await withTimeout(abortLiveExecutionForTask({...}), 60_000, "abortLiveExecutionForTask").catch((err) => log.error("cleanup timeout", { taskID, err }))` —— 60s 因 cleanupGoalWorkspaces 含多个 worktree 删除 |
| `:1307` | `await executor.abort(...)` | `await withTimeout(executor.abort(...), 5_000, "executor.abort run").catch((err) => log.warn("run abort timeout", { taskID, err }))` |
| `:1598` | 同上（abortRun 内） | 同上修订 |

**关键语义（rule 22 / codex）**：所有超时分支不 throw，只 log，cancelTask **必须**走完到 `:1324 updateTask({status:"cancelled"})`。HTTP 端永远在 60s 内返回。

**zombie 观测**（codex 提示，rule 28）：超时分支额外写一条 `decision_log` 记录 `{kind: "abort_timeout", taskID, runID, label, timeoutMs}`，便于事后排查后台是否真有进程残留。

#### Step 1.4 — 测试覆盖（rule 36）

| 测试 | 模式 | 验收 |
|------|-----|------|
| `test/util/git-timeout.test.ts` | spawn `node -e "setInterval(()=>{},1000)"` 假装 git，传 `timeoutProfile: "fast"`，期望 15s 内返回 exitCode≠0 + stderr 含 "timed out" | 验证 `git()` 现有 timeout/kill 在 Windows 也工作 |
| `test/util/await-with-timeout.test.ts` | `withTimeout(new Promise<never>(() => {}), 50, "test")` 应抛 `AwaitTimeoutError` | 基础工具 |
| `test/task-api/cancel-task-abort-timeout.test.ts` | `mock.module("@/executor/registry")` 让 `executor.abort` 返回 `new Promise<never>(() => {})`，调 `cancelTask`，断言 60s 内返回 + DB row `time_completed!=null` + `decision_log` 写了 `abort_timeout` | rule 36：cancel 不阻塞 |
| `test/engine/prepare-git-timeout.test.ts` | spy `Vcs.state` 返回永久 pending，调 `EngineGit.prepare`，断言 90s 内得 timeout error | 任务 A 类场景 |
| `test/orchestrator/tools-direct-diff-timeout.test.ts` | mock spawn 让 `git status` 永挂，断言 direct build deliver 路径 90s 内失败而非死等 | orchestrator/tools.ts:2951 |

测试模式：fake permanent pending 用 `new Promise<never>(() => {})`（codex 推荐），配很小的注入 timeout（5s 内），不要真等 60s——通过 spy 注入 timeoutMs 缩小。

### Phase 1.5（同 PR 时间允许）— `build/agent.ts`

`build/agent.ts:317/337/773/1713/1735/1740/1755/1771/1774` 8 处迁到 `git()`，profile 按命令分级。属任务执行链但不在卡死直接路径上，时间紧可挪到下个 PR。

### Phase 2（下个 PR）— 全仓推广 + lint 防回归

剩余约 25 处分布：
- `file/index.ts:460/481/506/578/580/582`
- `file/watcher.ts:98`
- `engine/workspace-export.ts:20/29`
- `server/routes/export.ts:125`
- `cli/cmd/github.ts:253/543/577/594/612/1037/1040/1045`

**`cli/cmd/github.ts` 不在任务 loop 链路**（codex 验证：`src/index.ts:25` 只是 CLI command 注册），是用户主动跑 `opencorvus github *` 才触达，可放心 Phase 2。

最后加 lint：`packages/opencorvus/eslint.*` 禁止 `\$\`git\b` / `Bun.spawn(["git"` / `child_process.spawn(["git"` —— 必须走 `util/git.ts:git()`。CI / pre-push 拦截。

## 边界 / 不做

- **不改用户主 repo `core.fsmonitor` config**（codex 提醒）。在 opencorvus 自己的 git 调用里显式 `-c core.fsmonitor=false`，这已是 `snapshot/index.ts:47` 的模式（snapshot 自己的 repo）和 `worktree/index.ts:1148` 的模式（cleanup 时 stop daemon）。
- **不自动删 `.git/index.lock`**（codex）。timeout 后 fail loud，让用户决定。
- **不动 `Process.run` 内部 SIGTERM→SIGKILL 语义**。Windows 子进程树 kill 行为靠现有 `child_process.spawn` 的 `proc.kill()`（依赖 Node 实现），Phase 1 不重写；如发现实际未杀子进程树，Phase 2 单独处理（用 `taskkill /T /F` Windows-specific 兜底）。
- **不重写 mirrorcode executor**。timeout 是 task-api 端的兜底，不修 mirrorcode 内部。

## 验收

| 场景 | 期望行为 | 期望证据 |
|------|---------|---------|
| 任务 A 类（git status hang） | loop 启动 90s 内得错误（GitCommandTimeout）；task 行被 mark `failed`；UI 显示失败 | protocol_event 出现 `task.updated status=failed` |
| 任务 B 类（cancel hang） | cancelTask 60s 内返回；task 行 `time_completed!=null`；deleteTask 跟着完成 | DB 行 `time_completed` 写值；`decision_log` 有 `abort_timeout` 记录 |
| typecheck / api:routes-check / docs:check | 全绿 | pre-push hook 通过 |
| 新增 5 个测试 | 全部通过 | bun test |

## 时序

1. ✅ 写方案落盘（v2）
2. **等用户对齐 v2 范围**（特别是 Phase 1.5 是否纳入本 PR）
3. Phase 1 实施 — 估 3-4 小时（5 个文件迁移 + util/await-with-timeout + cancelTask 修订 + 5 个测试）
4. commit + push（pre-push hook 自动跑 typecheck + 路由 + docs）
5. 重启 sidecar，复现任务 A、B 场景验收
6. Phase 2 排期
