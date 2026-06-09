# Instance Bootstrap — darwin 级联失效根治方案

> 起因：在 darwin 下打开 overlay，全部项目作用域端点（`/global/tasks`、`/path`、`/vcs`、`/config`、`/provider`、`/auth`、`/channel`、`/prompt`、`/executor`、`/skill`、`/installed`、`/log`、`/mcp`、`/agent` 等）持续 500，仅 `/global/health` 和 `/global/config` 存活；同时控制台抛 `Notification prompting can only be done from a user gesture` 并永久 `denied`。
> Windows 不炸纯属碰巧（sidecar 启动时 cwd 是可写目录），属于"埋雷而非健康"。这份方案以第一性原理拔除根因，禁止 fallback / 隐式副作用 / 双源 / 状态机式补丁（CLAUDE.md rule 1, 5, 7, 8, 13, 20）。

## 1. 现象与定位

- 顶栏 `Online :7878 pid <N>`：sidecar 进程活着。
- 大量 `Could not connect to the server` 是 startup 窗口（端口尚未 listen）的 TCP refused，随后稳定为 500。
- `/global/health` 200、`/global/tasks` 500：路由挂点不同，前者在 Instance 中间件之前 (`server.ts:121`)，后者在之后 (`server.ts:139` 的 AppRoutes)。
- 服务端 onError 把任何泛型异常一律 500（`server.ts:49-73`），上层无法区分"目录无效 / 权限不足 / 不是 git 仓库"。

## 2. 根因链（按因果顺序）

### 2.1 Tauri sidecar 不设 `current_dir`

`packages/overlay/src-tauri/src/main.rs:724-754` 的 `start_server` 在 `Command::new(path)` 之后只设了若干 env，**没有 `cmd.current_dir(...)`**。

- macOS .app 从 Finder/Dock 启动 → 子进程 `cwd = "/"`。
- Windows 从快捷方式 → cwd 通常是用户目录或安装目录（写得动）。

### 2.2 Server 中间件用 `process.cwd()` 兜底 directory

`packages/opencorvus/src/server/server.ts:129`

```ts
const raw = c.req.query("directory") || c.req.header("x-opencorvus-directory") || process.cwd()
```

overlay 的 `services/api.ts:88-91` 把 `/global/*` 与 `/auth/*` 排除在 `?directory=` 注入之外。所以挂在 AppRoutes 下的 `/global/tasks`（`routes/orchestrator.ts:157`）请求在中间件里取到 `directory = "/"`。

### 2.3 Instance bootstrap 自动 `git init` —— **darwin 一键全炸的 root cause**

`packages/opencorvus/src/project/instance.ts:50-55`

```ts
if (!Project.isGitRepo(directory)) {
  await Project.initGit(directory)   // ← 任何非 git 目录被静默改写
  ...
}
```

`packages/opencorvus/src/project/project.ts:323-340` 的 `Project.initGit` 在 exitCode≠0 时直接抛 `Error`。darwin 上 `git init /` 权限拒绝 → 抛错 → `Instance.provide` reject → 500。

### 2.4 Instance cache reject 后清空，触发"500 风暴"

`packages/opencorvus/src/project/instance.ts:71-74`

```ts
existing.catch(() => {
  if (cache.get(directory) === existing) cache.delete(directory)
})
```

overlay 在前端各 store / connection-monitor 不断重试，每次都完整复跑 init → 每秒数次 `git init /` 失败 → 持续 500 风暴 + 系统 IO 噪音。

### 2.5 `Filesystem.resolve` 接受跨平台脏路径

`packages/opencorvus/src/util/filesystem.ts:144-170` 的 `resolve` 在非 Win 平台对 `windowsPath` 早返回，把 `C:\Users\...` 直接交给 `path.resolve`——POSIX 上当作相对路径，得到 `<cwd>/C:\Users\...`（含字面反斜杠）。这条假路径再喂回 git，又一轮失败。

### 2.6 Notification 权限在启动时申请（无 user gesture）

`packages/overlay/src/services/init.ts:131` 调用 `primeNotificationPermission()`（`services/notify.ts:179-183`），最终走 `Notification.requestPermission()`。WebKit（darwin）严格要求用户手势，否则**直接返回 `denied` 且不弹框**。一旦 `Notification.permission === "denied"`，session 内永远走不通。`notify.ts` 文件头注释明文说"懒申请"，实现违背了它。

### 2.7 onError 把所有异常折叠成 500

`packages/opencorvus/src/server/server.ts:49-73` 仅识别 `NamedError` / `HTTPException`。泛型 `Error` → 一律 500 + 错误 message。前端无法做差异化处理（"目录不存在"、"权限不足"、"不是 git 仓库"……都长一个样）。

## 3. 解决方案（必须一次落齐，禁止半实施）

### Fix-1 ｜ 删除三处隐式自动 git init，统一为用户显式触发

> **codex 审查反馈 (2026-04-30)**：原方案只覆盖了一处隐式 init，遗漏另外两处——违反 rule 8（禁止双源）。

仓库当前有**三处**会"为了避免后续报错而自动 git init"：

| #   | 位置                                                                                                                                  | 触发时机                           | 处置                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | `packages/opencorvus/src/project/instance.ts:50-55` 的 `if (!Project.isGitRepo(directory)) { await Project.initGit(directory); ... }` | 任何项目作用域 HTTP 请求 bootstrap | **删除**                                                                                                                                                                                                                                                                                                                            |
| B   | `packages/opencorvus/src/project/project.ts:181` 的 `initRepo(directory)`（嵌在 `hasLocalGit` 三元里）                                | `Project.fromDirectory` 任意调用   | **删除**——这是 A 的姐妹路径，把"父目录是 git 仓库"自动外推为"也给当前目录 init 一份"，同样违反 rule 7                                                                                                                                                                                                                               |
| C   | `packages/opencorvus/src/task-api/index.ts:275-289` 的 `prepareProject()`                                                             | 任务创建（`createTask` 链路）      | **保留但重定向**——任务创建是用户显式动作，自带 git 仓库需求；不再调用 `Project.initGit`，改为：若 `!Project.isGitRepo` 则抛 `WorktreeNotGitError`，由前端 catch 后弹"该目录非 git 仓库，是否初始化"提示，用户点击后调现有 `POST /project/current/init-git`（实际路径见 `packages/opencorvus/src/server/routes/project.ts:57-78`）。 |

**Worktree 错误类已存在**：`packages/opencorvus/src/worktree/index.ts:292-297` 已定义 `WorktreeNotGitError = NamedError.create("WorktreeNotGitError", ...)`；`server.ts:57` 现有 `else if (err.name.startsWith("Worktree")) status = 400`。**直接复用**这个错误类，不要新增 `WorktreeRequiresGit`（rule 8 禁止双源），但需要把 onError 对它的状态码从 400 收紧到 412 Precondition Failed——见 Fix-5。

前端调用的初始化接口路径是 **`POST /project/current/init-git`**（不是原方案错写的 `/project/init-git`）。

**理由**：rule 7（不允许 fallback/兼容）、rule 5（过度工程）、rule 8（禁止双源）。三处自动 init 必须同步处置，留任何一处都等于补丁式修复。

### Fix-2 ｜ 删除 `process.cwd()` directory 兜底

**文件**：`packages/opencorvus/src/server/server.ts:124-138`

**改动**：

```ts
.use(async (c, next) => {
  if (c.req.path === "/log" || c.req.path === "/shutdown" || c.req.path === "/restart") {
    return next()
  }
  const raw = c.req.query("directory") || c.req.header("x-opencorvus-directory")
  if (!raw) throw new DirectoryRequiredError()
  const directory = decodeDirectory(raw)
  return Instance.provide({ directory, init: InstanceBootstrap, async fn() { return next() } })
})
```

新增 `DirectoryRequiredError extends NamedError`，onError 映射 400。

**前端配合**：`packages/overlay/src/services/api.ts:81-93` 当前用前缀匹配豁免 `/global/*` 与 `/auth/*`——但 `/global/health`、`/global/event`、`/global/config` 挂在 `app.route("/global", GlobalRoutes())`（`server.ts:121`），位于 Instance 中间件之前，**不需要 directory**；而 `/global/tasks`、`/global/dispose`、`/global/db/reset` 实际定义在 AppRoutes（`routes/orchestrator.ts:157`、`routes/global.ts` 中 dispose/db_reset 等），**经过 Instance 中间件，必须注入 directory**。前缀匹配是错误抽象。

**改动**：把豁免改成精确白名单，并在测试里枚举验证：

```ts
// 真正不依赖 Instance 的控制平面端点
const NO_DIRECTORY_PATHS = new Set([
  "global/health",
  "global/event",
  "global/config", // GET / PATCH global config
])
const NO_DIRECTORY_PREFIXES = ["auth/"] // /auth/* 整段豁免
const isNoDirectory =
  NO_DIRECTORY_PATHS.has(next) || next === "auth" || NO_DIRECTORY_PREFIXES.some((p) => next.startsWith(p))
if (!isNoDirectory && directoryContext && !url.searchParams.has("directory")) {
  url.searchParams.set("directory", directoryContext)
}
```

> **codex 审查反馈 (2026-04-30)**：白名单必须显式枚举，并在 `packages/overlay/test/services/api-directory-injection.test.ts` 用例里固化清单——任何新增 `/global/*` 路由都要先决定是否在 GlobalRoutes 还是 AppRoutes 下挂载，再决定是否进入白名单。这是规则 8 的双源防御。

**理由**：rule 7、rule 13（禁止状态机/隐性默认）、rule 8（白名单必须单源）。directory 是项目作用域的**必须**输入。

### Fix-3 ｜ Tauri sidecar spawn 显式设置 `current_dir`

**文件**：`packages/overlay/src-tauri/src/main.rs:708-754`

**改动**：在 `Command::new(path)` 之后立即追加

```rust
cmd.current_dir(opencorvus_log_dir().parent().unwrap_or_else(|| Path::new("/")));
```

或更直接：复用 overlay 自身存放 settings 的目录（已经做过 `create_dir_all`）。

**与 Fix-2 的关系**：单独 Fix-2 已经能堵住"用 cwd 当默认"的洞；Fix-3 是补强，避免子进程在 darwin 起步就立在 `/`，万一未来有别的代码读 `process.cwd()` 也不会触雷。

### Fix-4 ｜ `Filesystem.resolve` 在系统边界拒绝跨平台脏路径

**文件**：`packages/opencorvus/src/util/filesystem.ts:144-170`

> **codex 审查反馈 (2026-04-30)**：原方案的正则会误杀 Git Bash 在 Windows 上常用的 `/c/...`、`/mnt/c/...`、`/cygdrive/c/...` 这类合法 mount 路径——`windowsPath()` 当前明确支持这些，并通过 `OPENCORVUS_WINDOWS_DRIVE_MOUNTS` env 允许扩展。**必须复用同一套 mount 规则**，不能硬拒。

**改动**（与 `windowsPath()` 单源对齐）：

```ts
// 把 windowsPath 内部的 mount 规则提取成可复用的判定
function looksLikeBashMount(p: string): boolean {
  if (!/^\//.test(p)) return false
  const mounts = collectWindowsDriveMounts() // 抽出来的、与 windowsPath 共享的来源
  return /^\/[a-zA-Z]\//.test(p) || mounts.some((m) => new RegExp(`^\\/${m}\\/[a-zA-Z]\\/`).test(p))
}

export function resolve(p: string): string {
  if (process.platform !== "win32" && /^[A-Za-z]:[\\/]/.test(p)) {
    throw new InvalidDirectoryError({ value: p, reason: "windows-path-on-posix" })
  }
  if (process.platform === "win32" && /^\//.test(p) && !looksLikeBashMount(p)) {
    throw new InvalidDirectoryError({ value: p, reason: "posix-path-on-windows" })
  }
  return normalizePath(pathResolve(windowsPath(p)))
}
```

**关键**：`collectWindowsDriveMounts` 是 `windowsPath` 当前内联那段 `mounts` 集合的提取版本，两个函数共享同一来源——避免又造一套规则（rule 8）。

新增 `InvalidDirectoryError extends NamedError`，onError 映射 400。

**理由**：rule 1（不要掩盖问题）、rule 20（禁止关键字匹配/最简单的修复）、rule 8（mount 规则单源）。

### Fix-5 ｜ `onError` 收紧结构化错误映射，对齐**已存在**的命名错误

**文件**：`packages/opencorvus/src/server/server.ts:49-73`

> **codex 审查反馈 (2026-04-30)**：当前 `server.ts:57` 已用 `err.name.startsWith("Worktree")` 把所有 Worktree 错误一律映射 400。前缀匹配是模糊抽象——`WorktreeNotGitError` 应该是 412 Precondition Failed（"非 git 仓库"是前置条件未满足），但 `WorktreeCreateFailedError` / `WorktreeStartCommandFailedError` 仍应 400/500。改 412 必须**精确匹配类名**，禁止靠前缀。

**改动**：

```ts
.onError((err, c) => {
  log.error("failed", { error: err })
  if (err instanceof NamedError) {
    let status: ContentfulStatusCode
    if (err instanceof NotFoundError) status = 404
    else if (err instanceof Provider.ModelNotFoundError) status = 400
    else if (err instanceof DirectoryRequiredError) status = 400
    else if (err instanceof InvalidDirectoryError) status = 400
    else if (err.name === "WorktreeNotGitError") status = 412   // 前置条件，非泛 4xx
    else if (err.name.startsWith("Worktree")) status = 400      // 其它 Worktree*Error
    else status = 500
    return c.json(err.toObject(), { status })
  }
  ...
})
```

新增的 `DirectoryRequiredError` 和 `InvalidDirectoryError` 通过 `NamedError.create("DirectoryRequiredError", ...)` 和 `NamedError.create("InvalidDirectoryError", ...)` 定义，放在 `packages/opencorvus/src/util/error.ts`（与现有 `NamedError.Unknown` 同源）。

前端 `services/connection.ts` / `services/workspace.ts` 按 name 分流：

- `WorktreeNotGitError` (412) → 渲染"目录非 git 仓库，是否初始化？" + 调 `POST /project/current/init-git`
- `InvalidDirectoryError` (400) → 渲染"目录路径无效（跨平台脏数据）"
- `DirectoryRequiredError` (400) → 渲染"未指定工作目录"

**理由**：rule 9（主动抽象但不能模糊）、rule 8（错误类单源——不再造 `WorktreeRequiresGit`，复用 `WorktreeNotGitError`）。

### Fix-6 ｜ 删除 `primeNotificationPermission()`

**文件**：

- `packages/overlay/src/services/init.ts:127-131` 删除 `primeNotificationPermission()` 调用与注释。
- `packages/overlay/src/services/notify.ts:177-183` 删除 `primeNotificationPermission` 函数本体。
- 保留 `services/notify.ts:121` 真正发通知时的 `ensurePermission`，**只在权限是 `default` 且当前在用户手势栈里时才 `requestPermission`**——目前的实现已经满足后半句（lifecycle event 是异步触发，不算手势栈，所以会被 WebKit 拒绝；这反而是正确行为，应改为只读 `Notification.permission`，不再主动 prompt）。

权限申请只走一条路径：`GeneralPanel.tsx:209` 的 toggle 按钮（用户手势）。

**理由**：rule 1、rule 7。原实现"提前 prime"是典型的"为了避免延迟而引入隐式行为"，被 WebKit 严格策略反向放大成永久 denied。

## 4. 必配的回归测试（rule 28）

每条 fix 都必须有用例，禁止只改代码不写测试：

| Fix   | 测试文件                                                                  | 用例                                                                                                       |
| ----- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Fix-1 | `packages/opencorvus/test/engine/instance-no-auto-git-init.test.ts`       | 在非 git 临时目录下 `Instance.provide(...)` 不应创建 `.git`；只读路由（`/config`、`/installed`）能正常返回 |
| Fix-1 | `packages/opencorvus/test/worktree/requires-git-error.test.ts`            | 非 git 目录调用 `Worktree.create` 抛 `WorktreeRequiresGit`，onError 返回 412                               |
| Fix-2 | `packages/opencorvus/test/server/directory-required.test.ts`              | 不带 `?directory=` 命中 AppRoutes → 400 + `DirectoryRequiredError`                                         |
| Fix-2 | `packages/overlay/test/services/api-directory-injection.test.ts`          | `/global/tasks` 注入 directory，`/global/health` 不注入                                                    |
| Fix-3 | `packages/overlay/src-tauri/tests/sidecar-cwd.rs`                         | spawn 出来的 sidecar 报告 `process.cwd()` 与 `current_dir` 一致                                            |
| Fix-4 | `packages/opencorvus/test/util/filesystem-resolve-cross-platform.test.ts` | darwin 下传 `C:\...` 抛 `InvalidDirectoryError`，Win 下传裸 `/foo/bar` 抛同名错误                          |
| Fix-5 | `packages/opencorvus/test/server/onerror-mapping.test.ts`                 | 各命名错误都有正确状态码与 body name                                                                       |
| Fix-6 | `packages/overlay/test/services/notify-no-boot-prompt.test.ts`            | initApp 完整跑完后 `Notification.requestPermission` 调用次数为 0；toggle 点击触发 1 次                     |

## 5. 落地顺序与提交粒度

每条 fix 一个 commit，**先服务端、后前端、最后基建**：

1. `fix(server): drop process.cwd() directory fallback (W2-V31)` — Fix-2 + Fix-5 中相关错误类
2. `fix(instance): remove auto git-init from bootstrap (W2-V32)` — Fix-1 + Fix-5 中 WorktreeRequiresGit
3. `fix(filesystem): reject cross-platform paths at boundary (W2-V33)` — Fix-4 + Fix-5 收尾
4. `fix(overlay): drop boot-time notification permission prompt (W2-V34)` — Fix-6
5. `fix(overlay-tauri): set sidecar current_dir explicitly (W2-V35)` — Fix-3

每个 commit 同步加测试。pre-push hook 跑 typecheck / api:routes-check / docs:check，失败时修根因再 push（rule 33）。

## 6. 不做的事

- 不在 `Instance.provide` 里 catch 异常然后吞掉。
- 不写"如果目录不存在就用 cwd"之类的 fallback。
- 不为 darwin 写专门的 `cfg(target_os = "macos")` 分支——根因是逻辑层面，不是平台差异。
- 不在 onError 里把 `Error` 强行猜 status code——只识别命名错误。
- 不留任何 "TODO: 后续优化"、"暂时这样" 的注释。

## 7. 验收

- darwin 全新启动：所有项目作用域路由正常 200，无 500；切到任意目录都不会触发 `git init`。
- Windows 同一份代码：Tauri sidecar 启动 cwd 显式可见、不再依赖偶然的快捷方式工作目录。
- 切到非 git 目录：overlay 显式询问"是否初始化为 git 仓库？"，用户点是才生效。
- Notification：首次启动不再弹 `Notification prompting can only be done from a user gesture`；用户在 Settings 里 toggle 时正常请求权限。
- 切到一个不存在或跨平台脏路径：返回 400 + 结构化错误，overlay 提示具体原因，不再 500 风暴。

## 8. 二次审查记录（rule 24）

- **2026-04-30 codex 独立审查**：verdict = approve-with-changes。指出 5 处必须修：
  1. Fix-1 遗漏 `Project.fromDirectory` (`project.ts:181`) 的 `initRepo` 与 `prepareProject` (`task-api/index.ts:281-285`) 的自动 init —— 已纳入 Fix-1 表格。
  2. 初始化路由实际是 `/project/current/init-git`，不是 `/project/init-git` —— 已修正。
  3. Fix-4 正则会破坏 Git Bash mount —— 已改为复用 `windowsPath()` 的 mount 规则。
  4. Fix-2 / api.ts 白名单需显式枚举并对齐路由挂载位置 —— 已改为精确白名单。
  5. Fix-5 不要新增 `WorktreeRequiresGit`，复用 `WorktreeNotGitError`，且 onError 必须按类名而非前缀分流 —— 已修正。
- 二次审查通过条件：以上 5 条全部反映在方案中，对应测试用例补齐。本次修订已完成。
