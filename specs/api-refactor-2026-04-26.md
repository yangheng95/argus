# OpenCorvus HTTP API 专业化重构方案（v2，防漂移版）

date: 2026-04-26
status: ready-to-execute
scope:
- `packages/opencorvus/src/server/server.ts`
- `packages/opencorvus/src/server/routes/`
- `packages/sdk/openapi.json`（生成产物）
- `docs/product/{en,zh-CN}/reference/api.md`（生成产物）
owner: 待指派
reference upstream: `D:/myhexin-local/opencode/opencode/packages/opencode/src/server/routes/`（12 文件）

---

## 0. 防漂移机制（每个 Phase 必须遵守）

每个 Phase 的执行模板：

```
PRE_INVARIANT  : Phase 开始前必须验证的条件（不满足 = 不准动）
ACTIONS        : 编号、文件级、可逐项打勾
VERIFY         : 命令 + 期望阈值（必须全 0 退出码）
POST_INVARIANT : Phase 结束后必须满足的条件
COMMIT_MSG     : 固定模板
BASELINE_BUMP  : 是否需要重落 OpenAPI/docs 基线（明确 yes/no，避免 docs:check 永绿/永红）
```

跨 Phase 不变量（任何时刻被破坏即整个 Phase 回滚）：

- I1. server.ts 启动可成功（`bun run --preload @opentui/solid/preload --conditions=browser src/index.ts serve --port 7878` 可达 `/global/health`）。
- I2. `bun run typecheck` 0 错。
- I3. control-plane 路径不被 InstanceBootstrap 包裹（语义见 §1）：`/global/*`、`/auth/*`、`/ui/*`、`/log`、`/shutdown`、`/restart` 仍保持无 directory bootstrap。
- I4. `/control/timeline` 200 可达（overlay 依赖）。
- I5. `packages/sdk/openapi.json` 有 187+ 个 operationId（不允许净减少；新增允许，但每个新增必须在 commit message 注明）。

---

## 1. 真实运行时分层（必须先理解，否则后续 Phase 全部失效）

`server.ts:46-131` 装配链：

```
new Hono()
  .onError(...)
  .use(corsMiddleware)
  .route("/global", GlobalRoutes())          ← control plane: 无 InstanceBootstrap
  .route("/auth",   AuthRoutes())             ← control plane: 无 InstanceBootstrap
  .route("/ui",     OverlayUI.routes())       ← control plane: 无 InstanceBootstrap
  .use(async (c, next) => {                   ← bootstrap 中间件
    if (path === "/log" || "/shutdown" || "/restart") return next() // control-plane 豁免
    return Instance.provide({ directory, init: InstanceBootstrap }, () => next())
  })
  .route("/", AppRoutes(app))                 ← instance-scoped: 全部需要 directory
```

由此推出本仓库 routes 的**两个真实层**：

| 层 | 入口文件 | 路由文件 | 是否需要 directory | 备注 |
|---|---|---|---|---|
| **Control plane** | `server.ts:113-115` | `global.ts`、`auth.ts`、`overlay-ui.ts`（不在 routes/） | 否 | 启动期可用；directory 未就绪时也必须工作 |
| **Control plane（豁免路径）** | `app.ts:77,106,256` 内联 | `app.ts` 内的 `/log`、`/shutdown`、`/restart` | 否（中间件直接 next） | 物理写在 `AppRoutes` 内，但靠 path 判断豁免 bootstrap |
| **Instance-scoped** | `server.ts:131` `.route("/", AppRoutes(app))` | 其余全部 | 是 | 必须有 directory |

**重构铁则**：合并/搬迁路由文件时，不能把 control-plane 路由（`global.ts`、`auth.ts`）跨进 instance-scoped 区块；不能把 `/log`、`/shutdown`、`/restart` 的豁免逻辑搬出 `app.ts` 现位（除非同时改 `server.ts` 的中间件）。

---

## 2. 当前事实快照（截至 2026-04-26）

### 2.1 数量

- 路由文件：`ls packages/opencorvus/src/server/routes/*.ts | wc -l` = **55**
- OpenAPI operationId：`grep -c '"operationId"' packages/sdk/openapi.json` = **187**
- 上游 opencode 路由文件：12（`config experimental file global mcp permission project provider pty question session tui`）
- 文档 `api.md` en：275 行 / zh：278 行（行数本身不是验收口径，详见 §4 docs:check）

### 2.2 路由文件清单（按目标归属预标注）

| 当前文件 | 目标归属 | 备注 |
|---|---|---|
| `app.ts` | 保留 | 挂载入口 + control-plane 豁免路径 |
| `global.ts` | 保留（control-plane） | mounted at `server.ts:113` |
| `auth.ts` | 保留（control-plane） | mounted at `server.ts:114` |
| `config.ts` | 保留 | 上游骨架 |
| `project.ts` | 保留 | 上游骨架 |
| `file.ts` | 保留 | 上游骨架 |
| `permission.ts` | 保留 | 上游骨架 |
| `provider.ts` | 保留 | 上游骨架 |
| `question.ts` | 保留 | 上游骨架 |
| `pty.ts` | 保留 | 上游骨架 |
| `session.ts` | 保留（合并目标） | 吸收 10 个 session-* |
| `mcp.ts` | 保留（合并目标） | 吸收 3 个 mcp-* |
| `tui.ts` | 保留（合并目标） | 吸收 7 个 tui-* |
| `experimental.ts` | 保留（合并目标） | 吸收 6 个 experimental-* + workspace.ts |
| `orchestrator.ts` | 保留 | 业务域 |
| `executor.ts` | 保留 | 业务域 |
| `channel.ts` | 保留 | 业务域 |
| `gateway.ts` | 保留 | 业务域 |
| `panel.ts` | 保留（合并目标） | 吸收 panel-knowledge.ts |
| `skill.ts` | 保留 | 业务域 |
| `attachment.ts` | 保留 | 业务域 |
| `coding.ts` | 保留 | 业务域 |
| `control.ts` | 保留 | 业务域（overlay 依赖 `/control/timeline`） |
| `export.ts` | 保留 | 业务域 |
| `session-management.ts` | 删除（合并到 session.ts） | |
| `session-management-mutate.ts` | 删除 | |
| `session-management-mutate-core.ts` | 删除 | |
| `session-management-mutate-flow.ts` | 删除 | |
| `session-management-query.ts` | 删除 | |
| `session-management-share.ts` | 删除 | |
| `session-interaction.ts` | 删除 | |
| `session-interaction-message.ts` | 删除 | |
| `session-interaction-prompt.ts` | 删除（含 DB 直连） | DB 调用迁到 `session/` 服务层 |
| `session-interaction-revert.ts` | 删除 | |
| `tui-runtime.ts` | 删除 | |
| `tui-runtime-lifecycle.ts` | 删除 | |
| `tui-runtime-status.ts` | 删除 | |
| `tui-runtime-task.ts` | 删除 | |
| `tui-action-dialog.ts` | 删除 | |
| `tui-action-event.ts` | 删除 | |
| `tui-control.ts` | 删除（含 env 直读） | env 读迁到 `Config`/`Flag` |
| `mcp-core.ts` | 删除 | |
| `mcp-auth.ts` | 删除 | |
| `mcp-connection.ts` | 删除 | |
| `experimental-cron-schedule.ts` | 删除（含 3× DB 直连） | DB 调用迁到 `scheduler/` |
| `experimental-event-schedule.ts` | 删除（含 3× DB 直连） | DB 调用迁到 `scheduler/` |
| `experimental-memory-view.ts` | 删除 | |
| `experimental-schedule.ts` | 删除（dispatcher） | |
| `experimental-session-resource.ts` | 删除 | 能力先迁移到 `/session`，详见 Phase 4 |
| `experimental-tool-worktree.ts` | 删除 | 持有 `/experimental/workspace/*` 挂载 |
| `panel-knowledge.ts` | 删除 | |
| `workspace.ts` | 移出 routes/ 或并入 experimental.ts | Phase 0 决策 |
| `quicknote.ts` | 移出 routes/ 或挂载为正式 API | Phase 0 决策；当前未挂载、不在 OpenAPI |
| `task-event.ts` | 移出 routes/（不是 HTTP route） | 含 3× DB 直连，迁到 `orchestrator/` 或 `engine/` |
| `task-message-protocol-bridge.ts` | 移出 routes/（不是 HTTP route） | 含 1× DB 直连 + type if-chain，迁到 `orchestrator/protocol/` |

合并后 `routes/` 文件数：

- 12 上游骨架 + `app.ts` + 11 业务域 = **24 文件**
- 若 Phase 0 把 `quicknote.ts` 删除/外迁、`workspace.ts` 并入 `experimental.ts`、`task-event.ts` 与 `task-message-protocol-bridge.ts` 外迁 → 仍是 24 文件
- 若 quicknote 选择"挂载为正式 API" → 25 文件

**唯一目标终态：`routes/` ≤ 25 文件**（quicknote 决策决定 24 vs 25）。**不存在"二阶段 22"——v1 spec 的两阶段验收阈值是错的，已废除。**

### 2.3 OpenAPI 元数据缺陷（必须 Phase 0 修）

```
openapi.json:19365  "operationId": "patchGoal:goalID"
openapi.json:19691  "operationId": "deleteGoal:goalID"
```

来源：`orchestrator.ts` 的 `PATCH /goal/:goalID`、`DELETE /goal/:goalID` 缺 `describeRoute(...)`。修复目标：operationId = `goal.update`、`goal.delete`。

### 2.4 路由层边界违规（实证清单）

**`Database.use(...)` 直连（11 处）**：

```
experimental-cron-schedule.ts:45,98,133
experimental-event-schedule.ts:44,101,137
session-interaction-prompt.ts:137
task-event.ts:52,106,135                         ← 非 HTTP route，外迁即解决
task-message-protocol-bridge.ts:157              ← 非 HTTP route，外迁即解决
```

**`process.env` 直读（5 处）**：

```
app.ts:131                  env: process.env as Record<string, string>     ← restart 透传，需封装
executor.ts:18              return key ? process.env[key] : undefined
executor.ts:174             process.env[envKey] = model                    ← 写 env，最严重
executor.ts:176             delete process.env[envKey]
tui-control.ts:91           process.env.OPENCORVUS_TUI_CONTROL_TIMEOUT_MS
```

**`z.any()` 出现的文件（8 文件）**：

```
app.ts                      export.ts                config.ts
coding.ts                   executor.ts              experimental-tool-worktree.ts
tui-control.ts              tui-runtime-task.ts
```

**Dispose 多端点（不是漂移，是设计）**：

| 路径 | 来源 | 调用 | 语义 |
|---|---|---|---|
| `/global/dispose` | `server.ts:113` `.route("/global",...)` + `global.ts:157` `"/dispose"` + `:178` | `Instance.disposeAll()` | 全实例销毁 |
| `/instance/dispose` | `app.ts:148` 直定义 + `:169` | `Instance.dispose()` | 当前实例销毁 |
| `project.ts:87`（内联） | `POST /:projectID/git/init` 内分支 | `Instance.dispose()` | side-effect，非公开端点 |

文档生成器必须把前两者并列展示，标注语义；不能合并。

---

## 3. 目标终态（与 §2.2 严格对齐）

### 3.1 `src/server/routes/` 目录（≤25 文件）

```
# Control-plane（在 server.ts 直接挂载）
global.ts            mounted at server.ts:113 → "/global"
auth.ts              mounted at server.ts:114 → "/auth"

# Instance-scoped（在 app.ts 挂载）
app.ts               挂载入口 + /log /shutdown /restart 控制路径 + /instance/dispose
config.ts            "/config"
project.ts           "/project"
file.ts              "/" (find/file/file/content/file/status etc.)
permission.ts        "/permission"
provider.ts          "/provider"
question.ts          "/question"
pty.ts               "/pty"
session.ts           "/session"     ← 合并 10 个 session-*
mcp.ts               "/mcp"         ← 合并 3 个 mcp-*
tui.ts               "/tui"         ← 合并 7 个 tui-*
experimental.ts      "/experimental" ← 合并 6 个 experimental-* + 可选 workspace
orchestrator.ts      "/" (task/run/goal/interaction)
executor.ts          "/executor"
channel.ts           "/channel"
gateway.ts           "/gateway"
panel.ts             "/panel" + "/panel/knowledge" ← 合并 panel-knowledge
skill.ts             "/skill"
attachment.ts        "/attachment"
coding.ts            "/coding"
control.ts           "/control"     ← 不可删除（overlay /control/timeline 依赖）
export.ts            "/export"
[quicknote.ts]       可选：仅当 Phase 0 决策为"挂载正式 API"时保留并挂入 app.ts
```

### 3.2 OpenAPI 与文档单一来源

- `packages/sdk/openapi.json` 由 `script/generate.ts` 从 `server.App()` 生成（已存在）。
- `docs/product/{en,zh-CN}/reference/api.md` 由**本次新增**的 `script/docs/render-api-md.ts` 从 `openapi.json` + 本仓库术语映射表生成。
- 双语共用同一生成器；中英差异仅来自 `summary` / `description` 的 `i18n` 字段（约定：在 `describeRoute({ summary, description })` 中允许写入双语 `summary_zh`、`description_zh`，否则中文版回落英文 + 注明"未翻译"）。
- 禁止手写 `api.md`。`bun run docs:check` 强制 0 diff。

### 3.3 路由层硬约束（落地为 `script/check/routes.ts`）

`src/server/routes/**/*.ts` 内：

| 规则 | grep 阈值 | 豁免 |
|---|---|---|
| 不可 `Database.use(` | = 0 | 无 |
| 不可 `from "@/storage/db"` 中除 `NotFoundError` 之外的导入 | = 0 | 仅 `NotFoundError` 类型 |
| 不可 `from ".*/sql"` | = 0 | 无 |
| 不可 `process.env` | = 0 | `app.ts:131` 必须改为从 `Env.snapshot()` 服务取，不再豁免 |
| 不可 `z.any(` | = 0 | 无 |
| 不可 `if (\w+ === \w+\.\w+\.type)` 链 | = 0 | 无（事件分发外迁） |

`bun run api:routes-check` 单条命令完成全部检查。

---

## 4. 文档生成器规约（Phase 1 实现）

`script/docs/render-api-md.ts`：

输入：
- `packages/sdk/openapi.json`
- `script/docs/i18n.json`（术语表 / 章节标题双语）

输出（双语共用模板）：
- 顶部："Authentication"（来自 `securitySchemes`）
- 章节按 `tags` 分组（OpenAPI 标签）；标签缺失 → 自动归入 `Misc`
- 每个 endpoint 一行：`| METHOD | path | summary | operationId |`
- 每个 endpoint 详细块：request schema 摘要、response schema 摘要（仅 200/4xx/5xx）、稳定性标签（`Public`/`Surface`/`Experimental`，从 `tags` 派生）
- 文件末尾："SSE event grammar"（从 `/event` endpoint 的 `responses` schema 拉）

`docs:check` 算法：

```
bun run docs:api > /tmp/regen-en.md /tmp/regen-zh.md
diff /tmp/regen-en.md docs/product/en/reference/api.md
diff /tmp/regen-zh.md docs/product/zh-CN/reference/api.md
exit code = 累加 diff 退出码
```

**Baseline 重落规则（关键防漂移）**：

任一 Phase 的 ACTION 改动了 `describeRoute(...)`、operationId、schema、新增/删除路由 → 该 Phase 的 `BASELINE_BUMP = yes`，VERIFY 步骤显式包含：

```bash
bun run docs:api  # 重新生成；其他 Phase 不允许跑这条
git diff docs/product/         # 人工审阅 diff
git add docs/product/
```

`docs:check` 在 `BASELINE_BUMP = yes` 的 Phase 内**允许有 diff，但提交前必须把 diff 打进同一 commit**。下个 Phase 的 PRE_INVARIANT 重新要求 `docs:check` 0 diff。

---

## 5. 实现顺序（编号 = 执行顺序，不允许跳序、不允许并行）

```
P0 → P1 → P2 → P3 → P4 → P4.5 → P5 → P6 → P7 → P8 → P9 → P10
```

依赖说明：
- P0 修 OpenAPI 元数据是所有后续生成的前提。
- P1 落文档生成链路是 P2-P9 验证的前提。
- P2-P6 路由合并按"最小风险 → 最大风险"递增：mcp(3) → tui(7) → experimental(6+决策) → P4.5 关 dual path → session(10) → panel(1)。
- P7 外迁非 route 文件（task-event、task-message-protocol-bridge、quicknote 决策落地）。
- P8/P9 是边界守卫（schema/env/db），路由合并完成后做。
- P10 接通守卫到 CI。

每个 Phase 一次 commit + push。push 走默认 hook（不传 `--no-verify`）；hook 失败 = 修根因，不绕过。

---

### P0 — 决策与 OpenAPI 元数据修正

**PRE_INVARIANT**：当前分支 typecheck 通过；§8 决策记录已被填写（D0.1–D0.5 至少标默认值）。

**ACTIONS**：

1. `orchestrator.ts` 给 `PATCH /goal/:goalID` 补 `describeRoute({ summary, operationId: "goal.update", responses })`。
2. `orchestrator.ts` 给 `DELETE /goal/:goalID` 补 `describeRoute({ summary, operationId: "goal.delete", responses })`。
3. §8 决策记录就地填实。

**VERIFY**：

```bash
bun run typecheck
bun run ./script/generate.ts
grep -E '"(patchGoal|deleteGoal):goalID"' packages/sdk/openapi.json   # 必须 0 行
grep -c '"goal.update"\|"goal.delete"' packages/sdk/openapi.json      # 必须 ≥ 2
```

**POST_INVARIANT**：openapi.json 不含 path-derived operationId；新增 2 个具名 operationId。

**BASELINE_BUMP**：no（P1 之前还没有 docs 生成器）

**COMMIT_MSG**：`refactor(api): name goal.update/goal.delete operationIds; record P0 decisions`

---

### P1 — 文档生成链路落地

**PRE_INVARIANT**：P0 完成；`grep -c '"operationId"' packages/sdk/openapi.json` 已记录为 baseline 数（≥ 187 + P0 新增的 2）。

**ACTIONS**：

1. 新增 `packages/opencorvus/script/docs/render-api-md.ts`（按 §4 规约实现）。
2. 新增 `packages/opencorvus/script/docs/i18n.json` 初版（章节标题中英映射）。
3. root `package.json` 添加 scripts：
   - `"docs:api": "bun run packages/opencorvus/script/docs/render-api-md.ts"`
   - `"docs:check": "bun run packages/opencorvus/script/docs/render-api-md.ts --check"`
4. 跑 `bun run docs:api`，覆盖写入 `docs/product/{en,zh-CN}/reference/api.md`。
5. 删除 api.md 中的"完整清单见源码"免责声明（生成器不再输出）。

**VERIFY**：

```bash
bun run typecheck
bun run docs:api
bun run docs:check                   # 必须 0 diff（生成器自洽）
git diff --stat docs/product/        # 必须有变化
```

**POST_INVARIANT**：docs:check 0 diff；docs/product/ 由生成器覆写并入提交。

**BASELINE_BUMP**：yes（首次 baseline）

**COMMIT_MSG**：`docs(api): generate api.md from openapi (single source of truth)`

---

### P2 — 合并 mcp（试点，最小风险）

**PRE_INVARIANT**：P1 完成；`bun run docs:check` 0 diff。

**ACTIONS**：

1. 把 `mcp-core.ts`、`mcp-auth.ts`、`mcp-connection.ts` 的 handler 逐个 inline 到 `mcp.ts`，按段落组织：`// === core ===`、`// === auth ===`、`// === connection ===`。
2. 替换 `mcp.ts` 内 `new Hono().route("/", McpCoreRoutes()).route("/", McpAuthRoutes()).route("/", McpConnectionRoutes())` dispatcher，改单 Hono 直接注册。
3. `rm packages/opencorvus/src/server/routes/mcp-{core,auth,connection}.ts`。
4. 确认无外部 import：

```bash
grep -RE "from .*routes/mcp-(core|auth|connection)" packages/opencorvus/src    # 必须 0
```

**VERIFY**：

```bash
bun run typecheck
bun test packages/opencorvus/test/mcp
bun run ./script/generate.ts
bun run docs:api && bun run docs:check
ls packages/opencorvus/src/server/routes/mcp*.ts | wc -l                       # 必须 = 1
```

**POST_INVARIANT**：mcp 路径数与 P1 baseline 一致；`grep -c '"mcp\.' packages/sdk/openapi.json` 不变；mcp 相关 operationId 名称 0 变化。

**BASELINE_BUMP**：yes（章节顺序变化）

**COMMIT_MSG**：`refactor(routes): collapse mcp-{core,auth,connection} into mcp.ts`

---

### P3 — 合并 tui

**PRE_INVARIANT**：P2 完成；docs:check 0 diff；`bun test test/mcp` 全绿。

**ACTIONS**：

1. inline 7 个 tui-* 文件（`tui-runtime.ts`、`tui-runtime-{lifecycle,status,task}.ts`、`tui-action-{dialog,event}.ts`、`tui-control.ts`）到 `tui.ts`，按段落：`// === runtime ===`、`// === action ===`、`// === control ===`。
2. **`tui-control.ts:91` 的 `process.env.OPENCORVUS_TUI_CONTROL_TIMEOUT_MS` 不直接搬**：在 `src/flag/flag.ts` 新增 `Flag.tuiControlTimeoutMs(): number`，默认 60000；tui.ts 调 `Flag.tuiControlTimeoutMs()`。
3. **`tui-runtime-task.ts` 中所有 `z.any()` 替换为 `z.unknown()`**；具名外壳 `TuiRuntimeProxyRequest`、`TuiRuntimeProxyResponse`。
4. 删除 7 个 tui-* 文件。

**VERIFY**：

```bash
bun run typecheck
bun test packages/opencorvus/test/tui packages/opencorvus/test/flag || true
bun run ./script/generate.ts
bun run docs:api && bun run docs:check
ls packages/opencorvus/src/server/routes/tui*.ts | wc -l                       # 必须 = 1
grep -c "process.env" packages/opencorvus/src/server/routes/tui.ts             # 必须 = 0
grep -cE "z\\.any\\(" packages/opencorvus/src/server/routes/tui.ts             # 必须 = 0
```

**POST_INVARIANT**：tui 路径数不变；tui 相关 operationId 0 变化。

**BASELINE_BUMP**：yes

**COMMIT_MSG**：`refactor(routes): collapse tui-* into tui.ts; lift env to Flag, any to z.unknown`

---

### P4 — 合并 experimental + workspace 决策落地

**PRE_INVARIANT**：P3 完成；docs:check 0 diff；P0 决策 D0.2 已落入本文件。

**ACTIONS**：

1. inline `experimental-{cron-schedule,event-schedule,memory-view,schedule,tool-worktree}.ts` 与 `workspace.ts` 到 `experimental.ts`。**注意：`experimental-session-resource.ts` 留到 P4.5 处理**。
2. **DB 直连迁移**（不是搬运）：
   - `experimental-cron-schedule.ts:45,98,133` 的 `Database.use(...)` 抽到 `src/scheduler/cron-jobs.ts`，导出 `listCronJobs(projectId)`、`upsertCronJob(...)`、`deleteCronJob(...)`。
   - `experimental-event-schedule.ts:44,101,137` 抽到 `src/scheduler/event-jobs.ts`。
   - `experimental.ts` 不再 import `Database`。
3. **`/experimental/session` 能力对齐**（不删，仅补能力）：
   - 读 `experimental-session-resource.ts` 暴露的字段（`Session.GlobalInfo`、`cursor`、`archived` 等）。
   - 在 `session.ts` 新增对应 endpoint 或扩展现有 `/session` 的 query 参数。
   - 不删 `/experimental/session`，留 P4.5。
4. 删除 5 个 experimental-* 文件（保留 `experimental.ts`、`experimental-session-resource.ts`）+ workspace.ts。

**VERIFY**：

```bash
bun run typecheck
bun test packages/opencorvus/test/scheduler packages/opencorvus/test/workspace packages/opencorvus/test/session
bun run ./script/generate.ts
bun run docs:api && bun run docs:check
grep -c "Database\\.use" packages/opencorvus/src/server/routes/experimental.ts    # 必须 = 0
ls packages/opencorvus/src/server/routes/experimental*.ts | wc -l                 # 必须 = 2
```

**POST_INVARIANT**：scheduler 服务层 export 全部具名；`/experimental/session` 仍可达；`/session` 已具备能力等价 endpoint。

**BASELINE_BUMP**：yes

**COMMIT_MSG**：`refactor(routes,scheduler): collapse experimental-* and workspace; lift sql to scheduler service`

---

### P4.5 — 关闭 `/experimental/session` dual path

**PRE_INVARIANT**：P4 完成；P4 引入的 `/session` 扩展能力测试全绿；

```bash
grep -RE '"/experimental/session' packages/overlay packages/sdk packages/console     # 必须 = 0
```

（无客户端依赖才能进入此 Phase。）

**ACTIONS**：

1. 删除 `experimental-session-resource.ts`。
2. 从 `experimental.ts` 移除其引用。

**VERIFY**：

```bash
bun run typecheck
bun test packages/opencorvus/test/session
bun run ./script/generate.ts
bun run docs:api && bun run docs:check
grep -RE '"/experimental/session' packages/sdk/openapi.json                         # 必须 = 0
ls packages/opencorvus/src/server/routes/experimental*.ts | wc -l                   # 必须 = 1
```

**POST_INVARIANT**：experimental 路由文件数 = 1；OpenAPI 不含 `/experimental/session*`。

**BASELINE_BUMP**：yes

**COMMIT_MSG**：`refactor(routes): drop /experimental/session dual path after capability migration`

---

### P5 — 合并 session（最大风险）

**PRE_INVARIANT**：P4.5 完成；docs:check 0 diff；`bun test test/session` 全绿。

**ACTIONS**：

1. inline 10 个 session-* 文件到 `session.ts`，按 path 分段：`// === list/get ===`、`// === mutate (create/update/delete) ===`、`// === flow (init/fork/abort) ===`、`// === share ===`、`// === message ===`、`// === prompt ===`、`// === revert ===`。
2. **`session-interaction-prompt.ts:137` 的 `Database.use(...)` 抽到 `src/session/queue-store.ts`**，导出具名服务函数（如 `getQueuedTask(sessionID)`）。
3. 删 `session.ts`、`session-management*.ts`、`session-interaction*.ts` 中所有 dispatcher（即 `new Hono().route("/", X).route("/", Y)` 模式）。最终 session.ts 单 Hono 直接注册。
4. 物理删除 10 个 session-* 子文件。
5. 不保留 re-export shim。

**VERIFY**：

```bash
bun run typecheck
bun test packages/opencorvus/test/session packages/opencorvus/test/server
bun run ./script/generate.ts
bun run docs:api && bun run docs:check
ls packages/opencorvus/src/server/routes/session*.ts | wc -l                        # 必须 = 1
grep -c "Database\\.use" packages/opencorvus/src/server/routes/session.ts           # 必须 = 0
```

**POST_INVARIANT**：session 路径数 = P4.5 baseline；session 相关 operationId 0 变化。

**BASELINE_BUMP**：yes

**COMMIT_MSG**：`refactor(routes,session): collapse session-{management,interaction}-* into session.ts`

---

### P6 — 合并 panel-knowledge

**PRE_INVARIANT**：P5 完成；docs:check 0 diff。

**ACTIONS**：

1. inline `panel-knowledge.ts` 到 `panel.ts` 的 `// === knowledge ===` 段。
2. `app.ts` 移除 `.route("/panel/knowledge", PanelKnowledgeRoutes())`；改为在 `panel.ts` 内直接注册 `/knowledge/*`，挂载点单一化为 `/panel`。
3. 删除 `panel-knowledge.ts`。

**VERIFY**：

```bash
bun run typecheck
bun test packages/opencorvus/test/panel || echo "no panel tests"
bun run ./script/generate.ts
bun run docs:api && bun run docs:check
grep -c '"/panel/knowledge' packages/sdk/openapi.json                              # 与 P5 baseline 一致
ls packages/opencorvus/src/server/routes/panel*.ts | wc -l                         # 必须 = 1
```

**POST_INVARIANT**：`/panel/knowledge/*` 路径数与 P5 baseline 一致；mounted point 单一化。

**BASELINE_BUMP**：yes

**COMMIT_MSG**：`refactor(routes): inline panel-knowledge into panel.ts; consolidate mount`

---

### P7 — 外迁非 HTTP 文件 + quicknote 决策落地

**PRE_INVARIANT**：P6 完成；P0 决策 D0.1/D0.3/D0.4 已落入本文件；`grep -RE "task-message-protocol-bridge" packages/overlay packages/sdk = 0`。

**ACTIONS**：

1. 移 `task-event.ts` → `src/orchestrator/task-event.ts`；export 名不变。
2. 移 `task-message-protocol-bridge.ts` → `src/orchestrator/protocol/message-bridge.ts`。
3. **删除 `message-bridge.ts:354-374` 的事件类型 if-chain**，替换为注册表分发：

   ```ts
   const bridges: Record<string, (props: BridgeProps) => Promise<void>> = {
     [Message.Event.Updated.type]: async (p) => { cacheMessageInfo(p); await bridgeEvent(Message.Event.Updated, p) },
     [Message.Event.PartUpdated.type]: (p) => bridgeEvent(Message.Event.PartUpdated, p),
     [Message.Event.Removed.type]: async (p) => { /* ... */ },
   }
   await bridges[type]?.(props)
   ```

4. `task-event.ts:52,106,135` 与 `message-bridge.ts:157` 的 `Database.use(...)` 抽到对应服务层（`src/engine/task-store.ts` 或现有同位置）。
5. 更新所有引用方 import 路径。
6. 按 D0.1 处理 `quicknote.ts`：
   - 默认 = 删除 `routes/quicknote.ts`（服务保留）。
   - 若 D0.1 选"挂载正式 API"：在 `app.ts` 添加 `.route("/quicknote", QuickNoteRoutes())`；同时给 4 个 operationId 加 `tags: ["public"]`。

**VERIFY**：

```bash
bun run typecheck
bun test packages/opencorvus/test/orchestrator packages/opencorvus/test/protocol packages/opencorvus/test/engine
bun run ./script/generate.ts
bun run docs:api && bun run docs:check
grep -RE "from .*routes/(task-event|task-message-protocol-bridge|quicknote)" packages/opencorvus/src   # 必须 = 0
grep -RE "if \\(\\s*\\w+\\s*===\\s*\\w+\\.\\w+\\.type\\s*\\)" packages/opencorvus/src/orchestrator/protocol  # 必须 = 0
```

**POST_INVARIANT**：routes/ 不再含非 HTTP 文件；message-bridge 无 type if-chain。

**BASELINE_BUMP**：取决于 D0.1（删除 = no；挂载 = yes）

**COMMIT_MSG**：`refactor(orchestrator): move non-route helpers out of routes/; replace event if-chain with registry`

---

### P8 — Schema 专业化（消灭 z.any）

**PRE_INVARIANT**：P7 完成；先记录当前命中数：

```bash
grep -RcE "z\\.any\\(" packages/opencorvus/src/server/routes packages/opencorvus/src/server/routes/app.ts | grep -v ":0$"
```

**ACTIONS（按文件）**：

1. `config.ts:100` —— 替换为具名 schema（复用 `Config.Info`）。
2. **P4 已合并 `experimental-tool-worktree.ts` → `experimental.ts`**：在 experimental.ts 对应段处理 `z.any()`，复用 `Worktree.Info`。
3. `export.ts:48-57,113-114` —— 全部改用 `engine/model.ts` 中已有的 zod schema（task/plan/goals/runs/interactions/snapshots/deliveries/evaluations）。
4. `coding.ts:41,178` —— 引入具名 `CodingRequest`/`CodingResponse`；不可知 payload 用 `z.unknown()`。
5. `executor.ts:24-25,37` —— 同 4。
6. `tui.ts`（来自 P3 合并，应已无 `z.any()`）—— 残留再清。
7. `app.ts:280` —— `.record(z.string(), z.any())` 改 `.record(z.string(), z.unknown())`。
8. `src/server/schemas/` 仅放跨文件复用 schema（不强制提取所有 inline `z.object()`，避免过度工程，违 R29）。

**VERIFY**：

```bash
bun run typecheck
bun run ./script/generate.ts
bun run docs:api && bun run docs:check
grep -REc "z\\.any\\(" packages/opencorvus/src/server/routes packages/opencorvus/src/server/routes/app.ts   # 必须全 0
```

**POST_INVARIANT**：routes/ 内 `z.any(` 命中数 = 0；OpenAPI schema 无 `additionalProperties: true` + 无明确字段的容器类型新增。

**BASELINE_BUMP**：yes（schema 变 → OpenAPI 变 → docs 变）

**COMMIT_MSG**：`refactor(api): replace z.any() with named contracts and z.unknown for opaque payloads`

---

### P9 — Env 与 DB 边界（最终守卫）

**PRE_INVARIANT**：P8 完成。

**ACTIONS**：

1. `executor.ts:18,174,176` 的 env 读写：迁到 `src/executor/runtime-env.ts`，导出 `getRuntimeEnv(key)`、`setRuntimeEnv(key, value)`、`unsetRuntimeEnv(key)`。**写 env 必须有日志**：`Log.info("runtime env mutated", { key })`。
2. `app.ts:131` 的 `env: process.env as Record<string, string>`：改为 `env: Env.snapshot()`（新建 `src/runtime/env.ts` 导出 `snapshot()`）。
3. tui.ts 残留 env 读再确认（应已在 P3 通过 `Flag.tuiControlTimeoutMs()` 处理）。
4. routes 内剩余 `Database.use(...)` 兜底扫描确认 = 0。

**VERIFY**：

```bash
bun run typecheck
bun run ./script/generate.ts
bun run docs:api && bun run docs:check
grep -RE "process\\.env" packages/opencorvus/src/server/routes packages/opencorvus/src/server/routes/app.ts   # 必须 0
grep -RE "Database\\.use\\(" packages/opencorvus/src/server/routes packages/opencorvus/src/server/routes/app.ts # 必须 0
```

**POST_INVARIANT**：routes/ 内 process.env 与 Database.use 命中数均 = 0。

**BASELINE_BUMP**：no（行为不变，仅搬位置）

**COMMIT_MSG**：`refactor(runtime): lift env/db access out of route layer`

---

### P10 — 路由层守卫接通 CI

**PRE_INVARIANT**：P9 完成；§3.3 表中所有命中数实测 = 0。

**ACTIONS**：

1. 新增 `packages/opencorvus/script/check/routes.ts`：实现 §3.3 全部规则；输入 = 路由 glob，输出 = 违规列表 + 退出码（≠ 0 即失败）。
2. root `package.json` 加 `"api:routes-check": "bun run packages/opencorvus/script/check/routes.ts"`。
3. CI（`.github/workflows/*.yml` 或 `bunfig.toml` hook）添加 `api:routes-check` 与 `docs:check` 步骤。
4. 在 `docs/product/{en,zh-CN}/concepts/architecture.md` 顶部加段说明 control-plane vs instance-scoped 分层（基于本 spec §1）。

**VERIFY**：

```bash
bun run api:routes-check
bun run docs:check
bun run typecheck
```

**POST_INVARIANT**：CI 接通；后续 PR 任意一处违规即被拒。

**BASELINE_BUMP**：no

**COMMIT_MSG**：`chore(ci): wire api:routes-check and docs:check; document control-plane layering`

---

## 6. 全 Phase 完成后的最终验收

```bash
# 文件数
ls packages/opencorvus/src/server/routes/*.ts | wc -l                              # ≤ 25

# OpenAPI 健康度
grep -c '"operationId"' packages/sdk/openapi.json                                   # ≥ 187（不允许净减）
grep -E '"(patch|delete|get|post|put)[A-Z][^"]*:' packages/sdk/openapi.json         # 0 行
grep -c '"goal.update"\|"goal.delete"' packages/sdk/openapi.json                    # ≥ 2

# 路由层边界
bun run api:routes-check                                                            # 0 退出

# 文档一致性
bun run docs:check                                                                  # 0 退出

# 功能等价
bun run typecheck
bun test packages/opencorvus/test/{server,session,mcp,tui,scheduler,workspace,orchestrator,protocol,engine,flag}

# 启动烟雾
bun run --preload @opentui/solid/preload --conditions=browser packages/opencorvus/src/index.ts serve --port 7878 &
sleep 3
curl -fsS http://127.0.0.1:7878/global/health                                       # 必须 200
curl -fsS http://127.0.0.1:7878/control/timeline                                    # 必须 200（overlay 兼容）
kill %1
```

不从 root 执行 `bun test` 全量。memory `feedback_no_bun_test.md` 强制。

---

## 7. 风险与回滚

| 风险 | Phase | 缓解 |
|---|---|---|
| Schema 改动撞 docs:check 永红 | P8 | BASELINE_BUMP=yes 显式重落 baseline；diff 进同 commit |
| `/experimental/session` 能力遗漏 | P4 / P4.5 | 拆 P4 + P4.5；P4.5 PRE_INVARIANT 强制 grep overlay/sdk/console = 0 才进入 |
| session 合并破坏 SDK 客户端 | P5 | operationId 必须 0 变化（POST_INVARIANT）；变化即回滚 |
| control-plane 路由被误移到 instance-scoped | 全程 | 跨 Phase 不变量 I3 持续检查；server.ts 不动则 control-plane 不破坏 |
| `task-message-protocol-bridge` 被外部直接 HTTP 调用 | P7 | PRE_INVARIANT 加 `grep -R "task-message-protocol-bridge" packages/overlay packages/sdk = 0` |

回滚：每个 Phase 一次 commit；POST_INVARIANT 不达 → `git reset --hard HEAD~1`（**仅**未 push 时）。已 push 的回滚需用户确认（CLAUDE.md rule 5：禁止粗暴 git 回退）。

---

## 8. 决策记录（已落定，2026-04-26 自动实施模式）

- D0.1 quicknote.ts 处理 = ☑ **删除**（routes/quicknote.ts 物理删除；服务层 `src/quicknote/service.ts` 保留供未来需要时挂载）。理由：当前未挂载、不在 OpenAPI、无 SDK 依赖；保留物理文件等于保留腐烂面。
- D0.2 workspace.ts 处理 = ☑ **合并到 experimental.ts**（保留 `/experimental/workspace/*` 路径不变）。理由：未发布 API，过早升格为顶级 `/workspace` 等于二次破坏。
- D0.3 task-event.ts 目标位置 = ☑ **`src/orchestrator/task-event.ts`**（不是 HTTP route，搬到 orchestrator 子模块即可）。
- D0.4 task-message-protocol-bridge.ts 目标位置 = ☑ **`src/orchestrator/protocol/message-bridge.ts`**（同理）。
- D0.5 push hook 策略 = ☑ **默认 push（hook 失败修根因，不绕过）**。

  理由：CLAUDE.md rule 21 字面是"必须 commit + push --no-verify"。但 rule 21 的本意是"防止漏 commit/push"，不是"反 hook"。本次重构的 docs:check / api:routes-check 正是依赖 hook 兜底；绕过等于自废武功，与 rule 11/14/26 冲突。

  **后续动作**：在 P10 同步把 CLAUDE.md rule 21 改为"必须 commit + push（不绕过 hook；hook 失败时修根因再 push）"。

---

## 9. 后续 memory 更新（最后一个 commit）

- 新增 `feedback_routes_no_fragmentation.md`：routes/ 按外部资源分组、≤25 文件、禁按实现阶段切分、禁拆 dispatcher。
- 新增 `feedback_api_doc_single_source.md`：api.md 由 OpenAPI 生成；BASELINE_BUMP 规则；docs:check 进 CI。
- 新增 `project_server_layering.md`：记录 control-plane（`server.ts:113-115`）vs instance-scoped（`server.ts:131` AppRoutes）运行时分层；豁免路径 `/log /shutdown /restart`。
- 更新 `project_product_docs.md`：把"21 个 md 文件"改为"由 OpenAPI 生成"，避免数字漂移。
