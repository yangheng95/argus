# Git / VCS 机制说明

## 真相源（Source of Truth）

Git 状态的**唯一真相源是后端服务器的文件系统**。

具体判断路径：
```
Project.fromDirectory(directory)
  └─ Filesystem.exists(path.join(directory, ".git"))
       → local = true  →  hasLocalGit = true  →  vcs = "git"
       → local = false → 尝试 rev-parse --show-toplevel (inherited)
                         → 若在父级 repo 内 → initRepo() → vcs = "git"
                         → 若不在任何 repo  → vcs = null
```

Overlay 前端是**纯只读 UI 客户端**，不直接执行任何 git 命令，不存储 git 状态，所有 VCS 信息均从后端 REST API 读取。

---

## 内存缓存机制与失效策略

### Instance 缓存

`Instance.provide(directory)` 按 `directory` 键缓存 `{ project, worktree, directory }`：

```
首次请求 directory → Project.fromDirectory() → 检测 .git → ctx.project.vcs = "git" | null
                   → cache.set(directory, Promise<ctx>)

后续请求 directory → cache.get(directory) → 直接返回缓存 ctx（不再检测文件系统）
```

**缓存失效方式**：
- `Instance.dispose()` — 删除缓存项并清空所有 State（无活跃 session 时使用）
- `Instance.refresh()` — 重新执行 `fromDirectory()` 并原地更新 `ctx.project`（有活跃 session 时使用，不打断正在运行的任务）

### VCS State 缓存

`Vcs.state` 通过 `Instance.state()` 按 `Instance.directory` 缓存分支追踪器：

```
首次调用 state() → 若 Instance.project.vcs !== "git" → { branch: () => undefined }
                 → 若 Instance.project.vcs === "git"  → 读取当前分支，监听 .git/HEAD
```

**缓存失效方式**：
- `Instance.dispose()` 隐式清空（同上）
- `Vcs.resetState()` — 仅清空 VCS State，不影响 Instance 缓存和活跃 session

---

## 数据流

```
GET /vcs
  └─ 中间件: Instance.provide({ directory })   ← directory 来自 query param / header / process.cwd()
       └─ Vcs.info()
            ├─ initialized = Instance.project.vcs === "git"  ← 读 Instance 内存缓存
            ├─ branch = await state().then(s => s.branch())   ← 读 VCS State 缓存
            ├─ if !initialized → return { initialized: false, branch: undefined, ... }
            └─ git status --porcelain=v1 --branch  (cwd: Instance.directory)
                 └─ parse(text, branch, true) → VcsInfo
```

前端调用路径：

```
loadMeta()
  ├─ apiJson("path") → GET /path → Instance.directory / worktree
  └─ apiJson("vcs")  → GET /vcs  → VcsInfo
       └─ setVcs(vcs)  → boardStore.vcs
            └─ renderMeta() → 更新 DOM #taskGit 按钮
```

**directory 参数传递规则**：
- 前端通过 `configureApi({ directory })` 设置 `directoryContext`
- `apiUrl(path)` 自动将其附加为 `?directory=<value>`
- 服务端: `c.req.query("directory") || c.req.header("x-opencorvus-directory") || process.cwd()`

---

## VcsInfo 字段说明

| 字段 | 类型 | 含义 |
|------|------|------|
| `initialized` | `boolean` | `.git` 目录存在且 `Instance.project.vcs === "git"` |
| `branch` | `string \| undefined` | 当前分支名；无提交时为 `undefined` 或空字符串 |
| `clean` | `boolean` | 工作区是否干净 |
| `dirty` | `boolean` | 是否有未提交改动 |
| `staged` | `number` | 已暂存文件数 |
| `modified` | `number` | 已修改未暂存文件数 |
| `untracked` | `number` | 未跟踪文件数 |
| `conflicts` | `number` | 合并冲突数 |
| `ahead` | `number` | 领先远端的提交数 |
| `behind` | `number` | 落后远端的提交数 |

---

## CWD 栏 Git 按钮的四种状态

| 场景 | `initialized` | `branch` | `data-state` | 显示文本 | 可点击 |
|------|:---:|:---:|:---:|------|:---:|
| 无 git 仓库 | `false` | - | `action` | "Init Git"（蓝色） | ✓ |
| git 初始化但无提交 | `true` | `undefined`/`""` | `unborn` | "No commits"（灰色） | ✗ |
| git 已提交，工作区干净 | `true` | `"main"` | `clean` | `"main · Clean"`（绿色） | ✗ |
| git 已提交，有变更 | `true` | `"main"` | `dirty` | `"main · 2 staged..."`（黄色） | ✗ |

**关键区分**：
- `!initialized` → "Init Git"，按钮可点击，点击执行 `git init`
- `initialized && !branch` → "No commits"，按钮不可点击（git 已存在，只是尚无提交）

---

## Init Git 操作流程

1. 用户点击 "Init Git" 按钮 → `initGitCurrent()`（`utils/git.ts`）
2. `canInitGit()` 守卫：需要 `settingsStore.directory` 非空 + 已连接 + `!vcs.initialized`
3. `POST /project/current/init-git` → `Project.initGit(directory)`（`project/project.ts`）
   - 若 `.git` 已存在 → 返回 `{ created: false }`（幂等）
   - 执行 `git init`，验证 `.git` 目录创建成功
   - 调用 `fromDirectory(directory)` 刷新并写入数据库（`vcs: "git"`）
   - 返回 `{ created: true, project }`
4. 路由处理器刷新内存缓存（**关键**，见下）
5. 前端：`clearProjectScopeData()` + `reloadProjectScope()` → `loadMeta()` → 刷新 VCS 状态

### 路由处理器缓存刷新策略

```typescript
if (result.created) {
  if (hasActiveSessions()) {
    // 有活跃 session 时不能 dispose（会中断正在运行的任务）
    // refresh() 原地更新 ctx.project.vcs = "git"
    // resetState() 清除旧的 VCS State，使下次 info() 重新初始化分支追踪器
    await Instance.refresh()
    Vcs.resetState()
  } else {
    // 无活跃 session 时 dispose 清除一切，下次请求从头初始化
    await Instance.dispose()
  }
}
```

**为什么两种情况都需要处理**：
- `Instance.dispose()` 只在无活跃 session 时安全——活跃 session 持有 Instance 上下文引用
- 若跳过缓存刷新（旧逻辑），`Instance.project.vcs` 保持为 `null`，下一次 `GET /vcs` 仍返回 `initialized: false`，overlay 继续显示 "Init Git"

---

## VCS 状态何时刷新

- 工作目录变更（`applyDirectory()`）
- Init Git 成功后（`reloadProjectScope()`）
- 项目重新加载（`reloadProjectScope()`）
- `.git/HEAD` 文件变化（FileWatcher 触发，仅更新分支名）
- **不自动轮询**：VCS 状态不会后台定时刷新，仅在上述事件触发时更新

外部（在 OpenCorvus 之外）执行 `git init` 后，overlay 不会自动感知，需用户手动切换目录或刷新才能更新状态。

---

## VCS State 生命周期

```
InstanceBootstrap → Vcs.init() → state() 首次调用
  → Instance.project.vcs === "git"?
      YES → currentBranch() 读取当前分支
           → FileWatcher 监听 .git/HEAD（分支切换时自动更新 current）
           → Bus.publish(Event.BranchUpdated) 通知
      NO  → { branch: () => undefined }（无分支追踪，不挂 FileWatcher）

Instance.dispose() / Vcs.resetState()
  → 清除缓存的 state
  → 下次调用 state() 重新执行上述初始化流程
```

---

## 重要约束

1. `currentBranch()` 运行在 `Instance.worktree`（可能是 worktree 根目录），`git status` 运行在 `Instance.directory`（实际工作目录）
2. 新初始化的 git 仓库（无提交）：`git rev-parse --abbrev-ref HEAD` 因无 HEAD 而报错，`currentBranch()` 通过 `.nothrow()` + `.catch()` 返回空字符串，`branch` 为 `""`（falsy）
3. `canInitGit()` 检查 `!vcs.initialized`，而非 `!vcs.branch`；否则"无提交"状态下按钮会错误地可点击
4. `Vcs.info()` 的 `initialized` 字段直接读 `Instance.project.vcs`（不经 VCS State 缓存），保证在 `Instance.refresh()` 后立即反映最新值
