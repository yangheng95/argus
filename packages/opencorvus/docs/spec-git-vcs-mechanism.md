# Git / VCS 机制说明

## 真相源

Git 状态的真相源是**后端服务器**。Overlay 前端是纯粹的只读 UI 客户端，不直接执行任何 git 命令。

后端通过 `packages/opencorvus/src/project/vcs.ts` 直接调用本地 `git` 二进制，解析命令输出，并通过 REST API 暴露给前端。

---

## 数据流

```
GET /vcs
  └─ Vcs.info()
       ├─ Instance.project.vcs === "git" ?  →  initialized = true/false
       ├─ state() → currentBranch()
       │    └─ git rev-parse --abbrev-ref HEAD  (cwd: Instance.worktree)
       └─ git status --porcelain=v1 --branch    (cwd: Instance.directory)
            └─ parse() → VcsInfo { initialized, branch, clean, dirty, staged, ... }
```

前端调用路径：

```
loadMeta()
  ├─ apiJson("path")  →  GET /path  →  Instance.directory / worktree
  └─ apiJson("vcs")   →  GET /vcs   →  VcsInfo
       └─ setVcs(vcs)  →  boardStore.vcs
            └─ renderMeta()  →  更新 DOM #taskGit 按钮
```

---

## VcsInfo 字段说明

| 字段 | 类型 | 含义 |
|------|------|------|
| `initialized` | `boolean` | `.git` 目录是否存在（`Instance.project.vcs === "git"`） |
| `branch` | `string \| undefined` | 当前分支名；初始化后尚无提交时为 `undefined` |
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
| 无 git 仓库 | `false` | `undefined` | `action` | "Init Git"（蓝色） | ✓ |
| git 初始化但无提交 | `true` | `undefined` | `unborn` | "No commits"（灰色） | ✗ |
| git 已提交，工作区干净 | `true` | `"main"` | `clean` | `"main · Clean"`（绿色） | ✗ |
| git 已提交，有变更 | `true` | `"main"` | `dirty` | `"main · 2 staged..."`（黄色） | ✗ |

**关键区分**：
- `!initialized` → "Init Git"，按钮可点击，点击执行 `git init`
- `initialized && !branch` → "No commits"，按钮不可点击（git 已存在，只是尚无提交）

---

## Init Git 操作流程

1. 用户点击 "Init Git" 按钮 → `initGitCurrent()`（`utils/git.ts`）
2. `canInitGit()` 守卫：需要 `activeDirectory()` 非空 + 已连接 + `!vcs.initialized`
3. `POST /project/current/init-git` → `Project.initGit(directory)`（`project/project.ts`）
   - 检查 `.git` 是否已存在；若存在返回 `{ created: false }`
   - 执行 `git init`，验证 `.git` 目录创建成功
   - 若无活跃 session，调用 `Instance.dispose()` 清除状态缓存
   - 返回 `{ created: true, project }`
4. 前端：`clearProjectScopeData()` + `reloadProjectScope()` → `loadMeta()` → 刷新 VCS 状态

---

## VCS 状态何时刷新

- 工作目录变更（`applyDirectory()`）
- Init Git 成功后（`reloadProjectScope()`）
- 项目重新加载（`reloadProjectScope()`）
- **不自动轮询**：VCS 状态不会后台定时刷新，仅在上述事件触发时更新

---

## 后端 VCS 状态缓存机制

`Vcs.state` 使用 `Instance.state()` 工厂，按 `Instance.directory` 缓存分支追踪器：

- 分支通过监听 `.git/HEAD` 文件变化（`FileWatcher`）实时更新
- `Instance.dispose()` 会清除该 instance 的所有状态缓存，包括 VCS 状态
- 下一次请求时 `Instance.provide()` 会重新创建实例和 VCS 状态

---

## 重要约束

1. `currentBranch()` 运行在 `Instance.worktree`（可能是 worktree 根目录），`git status` 运行在 `Instance.directory`（实际工作目录）
2. 新初始化的 git 仓库（无提交）：`git rev-parse --abbrev-ref HEAD` 返回空字符串（unborn branch），`branch` 为 `undefined`
3. `canInitGit()` 必须检查 `!vcs.initialized`，而非 `!vcs.branch`；否则"无提交"状态下按钮会错误地可点击
