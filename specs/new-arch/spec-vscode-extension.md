# spec: opencorvus VSCode 扩展

> 状态：DRAFT v3 (2026-04-27)
> 作者：Heng Yang
> 关联代码（已逐项核实，行号写在表格内）：
>
> - `packages/opencorvus/src/cli/cmd/serve.ts`
> - `packages/opencorvus/src/cli/cmd/acp.ts`
> - `packages/opencorvus/src/server/server.ts`
> - `packages/opencorvus/src/server/defaults.ts`、`server-defaults.json`
> - `packages/opencorvus/src/server/routes/{orchestrator,session,app,global,permission}.ts`
> - `packages/opencorvus/src/global/index.ts`
> - `packages/opencorvus/src/ide/index.ts`、`src/flag/flag.ts`
> - `packages/opencorvus/src/session/prompt/{index,schema}.ts`
> - `packages/opencorvus/src/lsp/`
> - `packages/sdk/js/`（`@opencorvus-ai/sdk`，已含 hey-api 生成的 SSE helper）
>
> 反漂移基线：本文件是唯一权威。任何与本文件冲突的实现必须先改本文件再改代码（CLAUDE.md §22 单源）。

---

## 0. TL;DR

opencorvus 已具备 VSCode 集成所需的绝大多数后端基础设施（HTTP+SSE server、`@opencorvus-ai/sdk`、ACP stdio server、`Ide.install()` 命令、多 root 支持的 `directory` header、SQLite 持久化）。VSCode 扩展的工作 **不是** 实现新 agent，而是给已经存在的 daemon 装一张 IDE 脸。

最终架构一句话：

> **Thin VSCode extension** ⇄ **本地 opencorvus daemon (HTTP+SSE on 127.0.0.1)** ⇄ **同一 daemon 同时被 overlay / TUI / ACP client 共享**。

新增/补齐的 daemon 侧最小工作只有两件：

1. **启动期写 lock 文件** 让所有本地客户端（扩展、overlay、其它 IDE）发现同一个 daemon，并共享一份 token；
2. **SSE 路由接受 query-string token** 作为 Basic Auth 的等价（仅来源 IP 为 127.0.0.1/::1 时有效），绕开 `EventSource` 不能加自定义 header 的限制。

其它一切复用现有路由。

---

## 1. 现状盘点（已逐项核实代码）

| 能力                    | 位置                                                                                     | 关键事实（核实后）                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP server 默认        | `server-defaults.json`、`src/server/defaults.ts:5`                                       | `127.0.0.1:7878`。Hono 框架。SDK 也导出同样的 `DEFAULT_SERVER_HOST/PORT/URL`（`packages/sdk/js/src/defaults.ts`）                                                                                                                                                                                                                                                                                                                                                           |
| Auth                    | `src/server/server.ts:67`                                                                | `OPENCORVUS_SERVER_PASSWORD` 启用 Basic Auth；**未设则完全无鉴权**。本地默认就是无鉴权，不要假设强制                                                                                                                                                                                                                                                                                                                                                                        |
| CORS                    | `src/server/server.ts:91`                                                                | 白名单：`http://localhost:*` / `http://127.0.0.1:*` / `tauri://localhost` / `tauri.localhost` / `*.opencorvus.ai`；`vscode-webview://` **不在**白名单中 — 但 webview 不应直连 daemon（§3.3）                                                                                                                                                                                                                                                                                |
| Project 隔离            | `src/server/server.ts:121`、`src/project/instance.ts`                                    | 通过 query `?directory=` 或 header `x-opencorvus-directory` 选择 `Instance.directory`，**单 daemon 多 project 共存**。SDK `createOpenCorvusClient({ directory })` 自动注入 header（`packages/sdk/js/src/client.ts:36`）                                                                                                                                                                                                                                                     |
| 控制平面绕过 Instance   | `src/server/server.ts:118`                                                               | `/log`、`/shutdown`、`/restart` **不**进入 `Instance.provide`，但仍受 Basic Auth                                                                                                                                                                                                                                                                                                                                                                                            |
| OpenAPI / SDK           | `packages/sdk/openapi.json`、`packages/sdk/js/`                                          | 由路由生成的 `hey-api` fetch 客户端。**已含 SSE helper**（`gen/core/serverSentEvents.gen.ts`）— `text/event-stream` 端点会生成带 `onSseEvent`/`onSseError` 回调的 stream method。扩展 host 直接用 SDK，**不用** `EventSource`、**不用**自己拼 `text/event-stream` parser                                                                                                                                                                                                    |
| ACP server              | `src/cli/cmd/acp.ts`                                                                     | 子命令 `opencorvus acp`，内部 `Server.listen(opts)` + `@agentclientprotocol/sdk` 走 stdio + ndjson `AgentSideConnection`，反向调本地 HTTP server。**ACP 是反向集成场景（把 opencorvus 嵌进 Zed/JetBrains）；VSCode 扩展自己不走这条路**（§3.1）。**重要：`acp` 子进程也启动 server，但不写 lock**（§3.2）                                                                                                                                                                   |
| Session/Message/Task    | `src/session/`、`src/engine/`、`src/task-api/`                                           | SQLite (Drizzle ORM)，`Instance.directory` 决定项目隔离                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 全局事件 SSE            | `routes/app.ts:415` `GET /event`                                                         | 订阅 Bus 全部事件（含 `server.connected`/`server.heartbeat`）。**扩展通常不需要这条**（噪声大），用更聚焦的 `/task/events` 与 `/task/:id/events`                                                                                                                                                                                                                                                                                                                            |
| 任务列表通知 SSE        | `routes/orchestrator.ts:223` `GET /task/events`                                          | **纯通知流**：仅推 `{type, taskID, sequence}`。**无 replay，无任务对象**。客户端收到通知后调 `GET /tasks` 拿列表                                                                                                                                                                                                                                                                                                                                                            |
| 单任务事件 SSE          | `routes/orchestrator.ts:333` `GET /task/:taskID/events?after=N`                          | 游标参数 **`after`**。支持断线 replay：连接时把 `> after` 的历史事件一次性回放，再切实时。`sequence === 0` 是 ephemeral（不计游标）                                                                                                                                                                                                                                                                                                                                         |
| 任务 hydrate            | `routes/orchestrator.ts:436` `GET /task/:taskID/conversation`                            | **复合冷启端点**：一次返回 `{lastSequence, board, transcript, timeline, events, eventReplay, view}`。扩展 Inspector 冷启用这条，再用 `lastSequence` 作 SSE `after` 续接                                                                                                                                                                                                                                                                                                     |
| 会话历史分页            | `routes/orchestrator.ts:501` `GET /task/:taskID/conversation/events?after&until&limit`   | 用于 hydrate 之后再向前/向后翻页（默认 limit 500，max 2000）                                                                                                                                                                                                                                                                                                                                                                                                                |
| 任务结构数据            | `routes/orchestrator.ts` `/task/:id/{board,transcript,brief,runs,interactions,progress}` | board/transcript 是 plan/messages 视图原料                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Task 列表               | `routes/orchestrator.ts:134` `GET /tasks` 与 `:157 /global/tasks`                        | 项目级 vs 跨项目两套，分别配 `task.list` / `task.global.list` operationId                                                                                                                                                                                                                                                                                                                                                                                                   |
| Prompt 投递（4 条入口） | `routes/orchestrator.ts:97`、`:657`、`:680`；`routes/session.ts:653`                     | ① **`POST /task`** 创建新任务（`task.create`，202 `{ task_id }`）<br>② **`POST /task/:id/message`**（`task.message`，给已结束/失败 task 做 follow-up）<br>③ **`POST /task/:id/inject`**（`task.inject`，向 running task 注入）<br>④ **`POST /session/:id/message`**（**operationId `session.prompt`**，同步阻塞返回 final assistant message — **扩展禁止使用**，违反 §2.6）<br>⑤ `POST /session/:id/prompt_async`（`session.prompt_async`，给已知 sessionID 的 ACP/CLI 用） |
| Prompt 输入 schema      | `src/session/prompt/schema.ts:5` `PromptInput`                                           | `parts: TextPart \| FilePart \| AgentPart \| SubtaskPart`。`@selection`/`@file` 等占位符**由扩展侧解析**为对应 part                                                                                                                                                                                                                                                                                                                                                         |
| Permission/Approval     | `routes/permission.ts`                                                                   | 已有 list + ack；扩展只代理 UI，不维护状态                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 服务端版本              | `routes/global.ts:21` `GET /global/health`                                               | 返回 `{ healthy: true, version }`。**扩展握手用这条**（注意：旧 spec 误写 `/global/info`）                                                                                                                                                                                                                                                                                                                                                                                  |
| 服务端关停/重启         | `routes/app.ts:75` `POST /shutdown`、`:104` `/restart`                                   | `/restart` 由 daemon 自己 spawn 同参数新进程后退出，**扩展用这条而不是自己 kill+respawn**（前提是 lock.ownerCaller==="vscode"，避免重启共享 daemon）                                                                                                                                                                                                                                                                                                                        |
| IDE 检测                | `src/ide/index.ts:47`                                                                    | `OPENCORVUS_CALLER=vscode\|vscode-insiders` 是 **daemon 自检"我被 vscode 终端包裹"**，作用是 `Ide.alreadyInstalled()` 返回 true → 跳过自动 install。**不是** "daemon 识别客户端类型"信号                                                                                                                                                                                                                                                                                    |
| 客户端身份              | `src/flag/flag.ts:27,98` `Flag.OPENCORVUS_CLIENT`                                        | **另一个**变量（默认 `"cli"`）。影响：`session/llm.ts:157` 注入 `x-opencorvus-client` header、`snapshot/index.ts:37` 在 `acp` 时跳过 snapshot、`tool/registry.ts:126` 决定是否注册 question tool、`installation/index.ts:194` 写入 user-agent。**扩展 spawn daemon 时应当设 `OPENCORVUS_CLIENT=vscode`**                                                                                                                                                                    |
| 自安装                  | `Ide.install()`、`ide/index.ts:14`                                                       | `code --install-extension <EXTENSION>`；默认 ID `yangheng95.opencorvus`，可被 `OPENCORVUS_IDE_EXTENSION_ID` 覆盖（marketplace 改名时不要靠改源码）                                                                                                                                                                                                                                                                                                                          |
| LSP fleet               | `src/lsp/{client,server,language,shared}.ts`                                             | LSP 子进程在 daemon 内管理。**扩展不重做 LSP**                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Overlay UI 静态资源     | `src/server/overlay-ui.ts`、路由 `/ui`                                                   | daemon 自带 `/ui/` 静态托管。扩展不复制这一套                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Daemon shutdown         | `src/server/shutdown.ts`、`serve.ts:149`                                                 | 已有 graceful shutdown；扩展不应 SIGKILL 共享 daemon（§7.2）                                                                                                                                                                                                                                                                                                                                                                                                                |

**结论**：扩展端只承担 (a) UI、(b) workspace 上下文供给（selection/file 注入）、(c) daemon 进程发现与可选 spawn、(d) file-edit 事件投影到编辑器。**不复制任何 agent 逻辑、不缓存任何能从 daemon 重建的状态**。

新增的 daemon 侧最小工作（写在第 7 节 Phase 1）：lock 文件 + SSE token-in-query。

---

## 2. 设计哲学（绝对原则，违反即拒收 — 与 CLAUDE.md 对齐）

1. **Thin client，单数据源（CLAUDE.md §22 单源）。** Agent 推理、工具调用、session 状态、消息持久化、file edit 全部在 daemon 侧。扩展不维护任何能从 daemon 重建的状态，也不持久化 chat。
2. **单协议（HTTP+SSE+SDK），不引入第二种**（CLAUDE.md §22）。**ACP 不在扩展内使用** —— ACP 服务的是把 opencorvus 嵌进 Zed/JetBrains，VSCode 这边主语颠倒，绕一层壳无意义。
3. **复用 VSCode 原生 UI**：diff 走 `vscode.diff`，编辑走 `workspace.applyEdit`，输入走 `InputBox`/`Webview`，不自造 diff/merge/补全 UI。
4. **Overlay 与扩展并存，不互斥**：两者是同一 daemon 的客户端。扩展不杀 overlay，overlay 不感知扩展。
5. **没有 fallback**（CLAUDE.md §1）：daemon 不在就明确报错并引导启动；**禁止**扩展进程内嵌降级 agent；**禁止**扩展自己下载二进制（让用户走 release）。
6. **流式即默认**（CLAUDE.md §27）：消费 LLM 输出必须 SSE。禁止"等完整响应再渲染"。禁止调 `POST /session/:id/message`（同步阻塞）。
7. **没有状态机**（CLAUDE.md §23）：扩展不写 `if state===WAITING` 控制流；状态由 daemon 事件流单向投影到 UI。
8. **不打补丁兼容旧**（CLAUDE.md §2）：daemon 接口变更直接同步本 spec + 扩展，不留 shim。
9. **窄范围理解**（feedback `narrow_interpretation`）：扩展只做 IDE 集成，不顺手"重构 overlay"或"重写 SDK"。

---

## 3. 协议选型与传输细节

### 3.1 选型矩阵

| 候选                              | 选  | 理由                                                                                 |
| --------------------------------- | :-: | ------------------------------------------------------------------------------------ |
| HTTP + SSE + `@opencorvus-ai/sdk` | ✅  | 已有，OpenAPI 自动同步，session/prompt/task/permission 全套现成；SDK 已含 SSE helper |
| ACP (stdio JSON-RPC)              | ❌  | 反向场景的协议，VSCode 自己绕一层                                                    |
| WebSocket                         | ❌  | REST 写 + SSE 读已经覆盖双向需求                                                     |
| MCP（Claude Code 反向模式）       | ❌  | LSP 已在 daemon 内；不需要让 CLI 调 IDE 工具                                         |
| `vscode.lm.*`（蹭 Copilot 模型）  | ❌  | 模型由 daemon provider 选；蹭 vscode.lm 等于把 model 选择权拆双源（§2.1）            |

### 3.2 跨进程发现：lock 文件

不用 Unix socket / named pipe（Windows 兼容差），统一走 **127.0.0.1 + lock 文件 + token**。

**路径**：`${Global.Path.data}/ide/<port>.json`

- `Global.Path.data` 由 `src/global/index.ts:31` 解析：`OPENCORVUS_HOME` 优先，否则 XDG/平台默认（Win: `%LOCALAPPDATA%\opencorvus`；Linux: `~/.local/share/opencorvus`；macOS: `~/Library/Application Support/opencorvus` 经 `xdg-basedir` 兜底）
- 扩展通过 SDK 暴露的常量读取，**不硬编码**（CLAUDE.md §25）；如果 `@opencorvus-ai/sdk/defaults` 不导出该路径，Phase 1 顺便补 `dataDir()` 导出
- **不**重新解析 `OPENCORVUS_DATA_DIR` 这种不存在的 env

**文件内容（JSON）**：

```json
{
  "version": 1,
  "port": 7878,
  "host": "127.0.0.1",
  "token": "<random 32 bytes hex>",
  "pid": 12345,
  "ownerCaller": "cli|vscode|tauri|...",
  "startedAt": 1714200000000
}
```

**写入边界**：

- **只 `serve` 子命令写**。`acp` 子命令也调 `Server.listen()`（`cli/cmd/acp.ts:26`），但它是 ndjson stdio 的 sidecar 角色 — **明确不写 lock**，避免短命子进程被扩展误连。Phase 1 PR 在 `acp.ts` 里加注释明示这点。
- 未来再加任何"内嵌 server"子命令时，必须遵循同样规则：lock 写入归 `serve` 独占。

**写入语义**：

- 时机：`Server.listen()` 成功后 `serve.ts` 在 `listening on …` 之后写一次。
- 原子：先写 `<port>.json.tmp` 再 `rename`。
- 权限：Unix `0600`；Windows 用 ACL 仅当前 user（在 daemon 一侧封装跨平台 helper，不要让扩展端处理）。
- 清理：`serve` 进程退出时（`registerServerShutdownHandler`）删除自己的 lock；启动时若发现 lock 存在但 pid 已死（`process.kill(pid, 0)` 抛 ESRCH）则覆盖。

**ownerCaller 取值**：与 `Flag.OPENCORVUS_CLIENT` 同源（`process.env.OPENCORVUS_CLIENT ?? "cli"`），扩展 spawn 时设 `vscode`/`vscode-insiders`。

### 3.3 Webview ⇄ Extension Host 通信

**Webview 永远不直连 daemon**（CORS 白名单不含 `vscode-webview://`，且 token 不应透过 webview 落地到 HTML attribute）。

- Webview ↔ Extension Host：`webview.postMessage` / `acquireVsCodeApi`
- Extension Host ↔ Daemon：调 SDK，全部 SSE 在 host 解析后再 postMessage 给 webview
- 单向 reducer：daemon SSE → host store → webview 渲染。Webview 触发动作 → host 调 SDK → 不直接更新 webview，等 SSE 回来再投影（**避免双源**，CLAUDE.md §22）

### 3.4 Auth 与 SSE 限制（旧 spec 漏掉）

**Daemon 当前 auth 是 Basic Auth**（`server.ts:67`），且 **`OPENCORVUS_SERVER_PASSWORD` 未设则完全无鉴权**（`server.ts:69` 直接 `next()`）。本地启动默认就是无鉴权，扩展**不要**强制设密码 — 那会让其它客户端连不上共享 daemon。

**统一鉴权方案（基于 lock 文件 token）**：

1. lock 文件中的 `token` 是**所有本地客户端共享的凭证**。Daemon 在启动期生成（`crypto.randomBytes(32).toString("hex")`），写进 lock；同时设到内存里（`Server.acceptToken(token)`）让 auth middleware 识别。
2. 同一个 token 同时支持两种传递方式（来源 IP 必须为 127.0.0.1/::1，否则忽略）：
   - **HTTP Basic Auth**：username 留空，password = token；与现有 `OPENCORVUS_SERVER_PASSWORD` 兼容（如果同时设了密码则两者都接受）。
   - **SSE query token**：`?auth_token=<token>`。仅本地 origin 接受。query token 必须从 request log middleware（`server.ts:75`）的日志 path 中 strip 掉。
3. 共享 daemon 的远端访问（`hostname=0.0.0.0`）**仍然只接受 `OPENCORVUS_SERVER_PASSWORD`**，不接受 lock token；token 路径只用于本地 IPC。
4. 扩展 host 用 SDK 的 SSE helper（hey-api 生成）拉 SSE，passing `headers: { Authorization: "Basic " + base64(":" + token) }` — Node fetch 支持自定义 header，**不用 EventSource**。webview 内若有轻量监控页可走 `?auth_token=` 形式。

> 旧 spec "扩展强制 `OPENCORVUS_SERVER_PASSWORD=<random>`" 的设计错误：那会让 overlay/TUI 等其它复用同一 daemon 的客户端因不知道密码而被拦在外面。token 必须放在 lock 文件给所有客户端读。

### 3.5 哪条 prompt 入口

| 场景                                                   | 入口                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 新对话（侧边栏输入框第一句话）                         | **`POST /task`**（`task.create`） → 202 `{ task_id }` → `GET /task/:id/conversation` 冷启 → `GET /task/:id/events?after=lastSequence` 续接 |
| 已有 task 的 follow-up（用户在该 task 详情面板继续聊） | **`POST /task/:id/message`**（`task.message`）                                                                                             |
| 中途插话不打断（罕见）                                 | **`POST /task/:id/inject`**（`task.inject`）                                                                                               |
| **禁用** ── 同步阻塞拿 final message                   | `POST /session/:id/message`（**operationId `session.prompt`**），违反 §2.6，扩展端 ESLint 禁字符串                                         |
| **禁用** ── ACP/CLI 的"已知 sessionID 灌话"            | `POST /session/:id/prompt_async`，留给 ACP，扩展用 `task.create` 即可                                                                      |

---

## 4. 架构图（文字版）

```
┌─────────────────────── VSCode Process ────────────────────────┐
│                                                               │
│   [Activity Bar Icon]                                         │
│        │                                                      │
│        ├── Sidebar View (WebviewViewProvider)                 │
│        │     └─ Webview ←postMessage→ Extension Host          │
│        │                                                      │
│        ├── Inspector Panel (vscode.window.createWebviewPanel) │
│        │     "Plan / Transcript / File-Edits"                 │
│        │                                                      │
│        ├── Status Bar Item            "● 7878 · proj=foo"     │
│        │                                                      │
│        └── Commands ──────────────────────────────────┐       │
│              opencorvus.attachSession                 │       │
│              opencorvus.newTask                       │       │
│              opencorvus.sendSelectionAsContext        │       │
│              opencorvus.openOverlay                   │       │
│              opencorvus.restartDaemon (only owned)    │       │
│              opencorvus.showDaemonLogs                │       │
│                                                       │       │
│   [Extension Host]   uses @opencorvus-ai/sdk          │       │
│        │   + sdk SSE helper (gen/core/serverSentEvents)│      │
│        ├── DaemonClient ── fetch (Basic Auth: token) ─┤       │
│        └── SSE subs   ──── sdk stream methods ────────┤       │
│                                                       │       │
└───────────────────────────────────────────────────────┼───────┘
                                                        │
                            127.0.0.1:<port> + Basic Auth(token from lock)
                                                        │
┌──────────── opencorvus daemon (Bun binary) ──────────┐│
│                                                      ││
│  Hono server  ──  EngineService.createTask           ││
│        │           ├─ Orchestrator (LLM-Autonomous)  ││
│        │           ├─ LSP fleet                      ││
│        │           ├─ Goal worktrees → merge-back    ││
│        │           └─ Provider/Model                 ││
│        ▼                                             ││
│  SQLite (Drizzle) at Instance.directory              ││
│  + ${Global.Path.data}/ide/<port>.json (lock)        ││
└──────────────────────────────────────────────────────┘│
        ▲                       ▲                       │
        │                       │                       │
   Tauri Overlay         TUI / CLI / ACP client (Zed)   │
```

---

## 5. 模块拆分（扩展侧）

仓库位置：**`packages/vscode-extension/`**（与 `packages/opencorvus`、`packages/sdk` 平级）。

```
packages/vscode-extension/
├── package.json        # name: opencorvus, publisher: yangheng95
├── tsconfig.json
├── src/
│   ├── extension.ts    # activate/deactivate
│   ├── daemon/
│   │   ├── lock-file.ts  # 扫 ${data}/ide/*.json，验 pid 活性，挑同 cwd 的最新条目；token 取出注入 client
│   │   ├── spawn.ts      # 找不到时 spawn `opencorvus serve --port 0`，env: OPENCORVUS_CALLER=vscode + OPENCORVUS_CLIENT=vscode
│   │   ├── client.ts     # 包一层 SDK + Basic Auth 头注入 + 错误归一；directory header 由 SDK 自己加
│   │   └── sse.ts        # 调 SDK 的 stream helper（onSseEvent/onSseError），不 import EventSource、不写 text/event-stream parser
│   ├── session/
│   │   ├── store.ts      # 反应 daemon 状态（订阅 SSE → reducer）；不持久化
│   │   └── prompt.ts     # 调 task.create / task.message / task.inject
│   ├── views/
│   │   ├── sidebar.ts    # WebviewViewProvider
│   │   ├── inspector.ts  # 包 vscode.window.createWebviewPanel（避免与 daemon "/panel" route 概念混淆）
│   │   └── statusbar.ts
│   ├── editor/
│   │   ├── selection.ts  # 当前 selection/file → PromptInput.parts (FilePart)
│   │   ├── apply-edit.ts # daemon file-edit 事件 → workspace.applyEdit
│   │   └── diff.ts       # vscode.diff 展示 patch
│   ├── commands/         # 一文件一命令，避免 switch（CLAUDE.md §23）
│   └── webview/          # 资源（esbuild 打包到 dist/webview/）
└── dist/                 # vsix 打包根
```

**禁止抽象**（CLAUDE.md §26 反过度工程）：

- 不写 `IDaemonProtocol`/`AbstractTransport` 之类的多协议适配层（只有一个协议）
- 不写 `BaseView`/`AbstractWebview`（两个 view，直接写）
- 不写 `MessageRouter`（直接调 SDK）
- 不写自己的 zod schema 镜像 daemon types（必须 `import type from "@opencorvus-ai/sdk"`）

---

## 6. UX 与视图分布

### 6.1 Sidebar（始终可见）

- **顶部**：daemon 连接状态 + 当前 project（`x-opencorvus-directory`）+ task 计数
- **中部**：当前 project 的 task 列表
  - 冷启：`GET /tasks`（`task.list`）
  - 增量：订阅 `GET /task/events`（`task.list.events`）拿到通知（含 `taskID, sequence`）后，按需重拉 `/tasks` 或 `/task/:id`
- **底部**：输入框（多行），支持 `@selection` `@file` 占位符（扩展端解析 → 拼成 `parts: [TextPart, FilePart...]`）
- 点击 task → 打开 Inspector

### 6.2 Inspector（按需打开）

- 顶部 tab：**Plan** / **Messages** / **File Edits**
- **冷启 hydrate**：`GET /task/:id/conversation`（`task.conversation`）一次性拿 `{lastSequence, board, transcript, timeline, events, view}`，**不要**分别拉 `/board` + `/transcript` + `/conversation/events`（旧 spec 错）。
- **增量**：用 hydrate 返回的 `lastSequence` 作 `GET /task/:id/events?after=<lastSequence>` 的 cursor 续接 SSE。
- **向前翻页**：`GET /task/:id/conversation/events?after=N&until=M&limit=L`（默认 limit 500，max 2000）。
- 游标统一字段名 **`after`**（非 `cursor`）。
- Permission Approve/Reject 按钮代理到 `/permission/*`，**扩展不在本地维护决策状态**

### 6.3 编辑器集成

- 选中代码后右键 "Send to opencorvus" → 拼 `FilePart`（含 path, range, contents）注入下一个 prompt
- daemon 触发 file edit 事件时（**只订阅 merge-back 后的事件**，不订阅 goal worktree 内部事件 — 见 §6.5）：构造 `WorkspaceEdit` → `workspace.applyEdit()` → 留作 dirty 让用户决定保存
- **默认不开 file watcher**（避免与 daemon 写盘自激）

### 6.4 命令面板

- `Opencorvus: Attach to running session`（多 session 切换）
- `Opencorvus: Start new task in current workspace`
- `Opencorvus: Send selection as context`
- `Opencorvus: Open Overlay window`（先打开 `http://127.0.0.1:<port>/ui/?auth_token=…`；daemon 是否有"启动 Tauri overlay 进程"的 API 列为开放问题 §10）
- `Opencorvus: Restart daemon`（**仅当 lock.ownerCaller==="vscode" 且 pid===扩展自己 spawn 的 pid 时启用**；否则禁用，避免重启共享 daemon）
- `Opencorvus: Show daemon logs`（`Global.Path.log/<port>.log`，扩展只读）

### 6.5 Goal worktree 与 file edit 接管

参考记忆 `project_goal_worktree_merge_back.md`：goal 的修改在独立 worktree 内进行，由 `BuildAgent.run` 调 `Worktree.mergeIntoPrimary` ff-only 合回主目录。意味着：

- daemon 在 goal 执行期间会写 worktree 副本（不在 VSCode 当前 workspace 路径下）
- merge-back 之后才反映到主 workspace

扩展只订阅 **merge-back 之后的 file 变更事件**（具体事件名待 daemon 端确认 — Phase 5 PR 必须列出 Bus 上是否已有 `file.merged`/`worktree.merged` 类事件；没有就在 daemon 侧加，不要在扩展端凑）。**扩展绝不订阅 worktree 内部 patch**（那是 daemon 内政）。

### 6.6 不做什么

- ❌ Inline ghost text 补全（Copilot 领域）
- ❌ ChatGPT 式占据整块 panel 的 chat UI（sidebar webview 即可）
- ❌ 自己实现 diff/three-way-merge UI
- ❌ 自己持久化 chat 历史（daemon 已存 SQLite）
- ❌ 自己维护 permission 决策状态
- ❌ 自己实现 LSP / formatter（daemon 已封装）
- ❌ i18n 框架。本项目中文优先；UI 文案直接中文，少量必要英文术语保留。

---

## 7. 跨平台、生命周期与分发

### 7.1 Daemon 二进制定位与 spawn

扩展不打包 daemon 二进制（Bun compile 产物 ~80MB，违反 marketplace 大小习惯）。启动顺序：

1. 扫 `${Global.Path.data}/ide/*.json`，对每个 lock：
   - 验 `process.kill(pid, 0)` 不抛 → daemon 活
   - HTTP probe `GET /global/health`（Basic Auth 用 lock.token）返回 200 + `{healthy:true}` → 已就绪
   - 选 `ownerCaller === "vscode"` 优先；否则任意活的都连
2. 找不到 lock 或全部死锁 → `which opencorvus` / `where opencorvus`
3. 仍找不到 → 弹通知 "请安装 opencorvus" + 跳浏览器到 Release Page；**禁止扩展自己下载二进制**（CLAUDE.md §1）
4. 找到 binary 则 spawn `opencorvus serve --port 0`，env：
   - `OPENCORVUS_CALLER=vscode`（让 daemon `Ide.alreadyInstalled()` 返回 true，跳过自己的 install）
   - `OPENCORVUS_CLIENT=vscode`（让 daemon 知道客户端身份；同时用作 lock.ownerCaller）
   - **不**传 `OPENCORVUS_SERVER_PASSWORD`（让 lock token 接管，避免破坏其它共享客户端）
   - **不**传 `OPENCORVUS_HOME`（让 daemon 用全局默认，便于其它客户端共享同一 lock 目录）
   - stdio：stdout/stderr 全部 inherit 到 OutputChannel；stdin 不接
5. 等 lock 文件出现作为成功信号（轮询 100ms × 50 = 5s）。**不依赖** stdout banner 解析端口 — banner 行可能因 hideConsoleWindow / detached 模式产生编码差异，lock 是结构化、原子写、唯一可信。

### 7.2 Daemon 所有权与关停

- 扩展只 kill **自己 spawn 的** daemon（PID 由 `ChildProcess` 拿到，不依赖 lock）
- 检测到 `lock.ownerCaller !== "vscode"` 或 `pid != 自己 spawn 的 pid` → 视为共享 daemon，**deactivate 时只关闭 SSE 连接、不 kill 进程**
- "Restart daemon" 命令首选 `POST /restart`（`server.restart`）— daemon 自己 spawn 同参数新进程后退出，**前提仍是 ownership 为 vscode**；否则禁用按钮
- 多 VSCode 窗口：第二个窗口启动时发现已有可用 lock 直接复用（多 root 已通过 `directory` header 区分，§3.2）
- 扩展 deactivate 时主动 unsubscribe 所有 SSE，避免 daemon 端累积连接

### 7.3 Windows 特殊性

- spawn 用 `detached: false`、`shell: false`；进程树清理依赖 daemon 自身的 SIGINT/SIGBREAK 处理（已在 `serve.ts:175`，含 SIGBREAK）
- `serve.ts` 双击启动时会 `hideConsoleWindow()`（FFI 调 user32.ShowWindow，`serve.ts:12`）；扩展 spawn 走 stdio inherit，**不**触发 hide（因为有 `serve` 子命令参数）
- lock 文件 ACL 由 daemon 端处理；扩展端只读
- 不用 named pipe / Unix socket

### 7.4 Remote / SSH / WSL（M7+，先不做）

- Remote-SSH 时 daemon 跑远端（agent 必须能改远端文件），扩展 host 在远端
- WSL 同理（扩展跑 WSL 内）
- M1-M6 只覆盖 local；远端单列 M7

### 7.5 发布

- VSCode Marketplace + Open VSX
- 扩展 ID 默认 `yangheng95.opencorvus`，**与 daemon `Ide.install()` 默认值同步**；改名时同改 `OPENCORVUS_IDE_EXTENSION_ID` 默认值
- CI 加 `.github/workflows/vscode-extension.yml`，产物 `.vsix` 上传到 GitHub Release
- 与 daemon 版本不强绑；扩展启动后调 `GET /global/health` 拿 `{ healthy, version }`，**不兼容直接报错引导升级**（CLAUDE.md §1，无 fallback）
- vsce 在 monorepo 内打包：`vsce package --no-dependencies` 配合预先 `bun build` 把 SDK bundle 进来，避免 marketplace 拉不到 workspace 协议依赖

---

## 8. 阶段化路线图（每阶段必须有验收标准）

> 共同前置：`packages/vscode-extension/` 包脚手架（package.json、tsconfig、esbuild 配置、vsce 配置）链入 monorepo workspaces。
> **必须严守**：每个 Phase 只做本节列出的范围；尤其禁止把 Phase 5 的"file edit 接管"提前到 Phase 4。

### Phase 1 — daemon 基建（M1，daemon 侧 PR，先于扩展）

- 实现 lock 文件 `${Global.Path.data}/ide/<port>.json`（§3.2）
  - 在 `serve.ts` 中实现，**只 `serve` 写**；`acp.ts` 加注释明示不写 lock
  - token = `crypto.randomBytes(32).toString("hex")`；写入时机在 `Server.listen()` 成功之后
- SSE / 普通路由接受 `?auth_token=<token>` 等价于 Basic Auth（§3.4）
  - 仅来源 IP 为 127.0.0.1/::1 时接受（已知 Bun + Hono 怎么取 raw socket addr：`c.env.requestIP(c.req.raw)`）
  - request log middleware（`server.ts:75`）strip 掉 `auth_token` query
- `@opencorvus-ai/sdk/defaults` 增导出 `dataDir()` 与 `lockDir()`（实现复用 daemon 内 `Global.Path` 解析逻辑，**不重复粘贴**，提到共享模块）
- **验收**：
  - `opencorvus serve` 起来后 `${Global.Path.data}/ide/` 出现 `<port>.json`，文件内容 schema 校验通过；杀进程后文件被清
  - `opencorvus acp < /dev/null` 起的内嵌 server **不**写 lock
  - `curl -N "http://127.0.0.1:7878/event?auth_token=$(jq -r .token ${data}/ide/7878.json)"` 能收到 `server.connected` 事件
  - 同一 token 也能用作 Basic Auth password 走 `curl -u :$token http://127.0.0.1:7878/global/health`

### Phase 2 — 扩展最小连接（M2）

- activate → 扫 lock → 命中则连，没命中则 spawn → 在 status bar 显示 ✅ + port + ownerCaller 标记
- 实现 SSE 订阅层（用 SDK 生成的 stream method，`onSseEvent` callback）
- 订阅 `/task/events` 仅打日志到 OutputChannel
- 探活：每 30s 调 `GET /global/health`；3 次失败 → 状态变 ❌ + 提示
- **验收**：F5 调试，状态栏显示 "● 7878"，断 daemon 后 90s 内变 ❌；扩展 spawn 的 daemon 在 deactivate 时被关停，附着的共享 daemon 在 deactivate 时不受影响（`ps` 仍存在）

### Phase 3 — 会话只读视图（M3）

- Sidebar：当前 project task 列表（`GET /tasks` + `/task/events` 通知后增量重拉）
- 点击 task 打开 Inspector：
  - 冷启：`GET /task/:id/conversation`（一次拿 `board + transcript + timeline + events + view + lastSequence`）
  - 增量：`GET /task/:id/events?after=<lastSequence>`
  - Tab 顺序固定：Plan / Messages / File Edits（File Edits 此阶段空板，Phase 5 接通）
- **验收**：开 TUI 跑一个 task，扩展同步看到任务出现/状态变化/消息流，端到端延迟 < 200ms；Inspector 能展开 plan board；断网重连不丢事件、不重复（用 `after=lastSequence` 验证）

### Phase 4 — 投递与流式消费（M4）

- 输入框 → `POST /task`（`task.create`）→ 拿 taskID → 自动打开 Inspector 订阅
- 选中代码右键 "Send to opencorvus" → 拼 `FilePart` 注入
- 已有 task follow-up → `POST /task/:id/message`（`task.message`）
- "中途插话" → `POST /task/:id/inject`（`task.inject`），命令面板项，慎用
- ESLint 守护：grep 字符串 `"/session/"` + `"prompt"` 在 `src/` 下出现就 fail（§9）
- **验收**：发一句话能跑出和 TUI 同款 task 流，消息边到边显示；@selection 注入后 Inspector 能看到 FilePart attach；并发起两个 task 互不串行

### Phase 5 — 文件编辑接管（M5）

- 在 daemon 侧确认/补 merge-back 后的 file 事件（§6.5）。如 Bus 没有，PR 必须先加 daemon `worktree.merged` event，**spec 同步更新**
- 扩展订阅之 → 拦截 → `WorkspaceEdit` 投影到 dirty buffer（不强制保存）
- "View as diff" 命令 → `vscode.diff`
- 默认 `files.autoSave === "off"` 时保留 dirty；`afterDelay` 时尊重用户设置
- **验收**：agent 改文件后 VSCode 编辑器显示 dirty + diff，撤销键能 undo；用户保存才落盘；多文件批量 edit 在一个 atomic `WorkspaceEdit` 内

### Phase 6 — 打磨与发布（M6）

- 命令面板补完
- Permission Approve/Reject 按钮代理（订阅 `/permission/*`，扩展只投影 + 转发用户操作）
- "Open Overlay" 命令：先打开 `http://127.0.0.1:<port>/ui/?auth_token=<token>`；如 daemon 后续提供"启动 Tauri overlay 窗口"API（开放问题 §10），改调该 API
- "Show daemon logs" 命令（读 `Global.Path.log/<port>.log`）
- 错误**文案**兜底（CLAUDE.md §1：是文案不是逻辑！）
- Marketplace + Open VSX 发布
- **验收**：从空环境 install 扩展 → 引导装 daemon → 完成一个完整 task 不查文档；vsix 包大小 < 10MB（不含 daemon 二进制）

### Phase 7 — Remote/SSH/WSL（M7，未来）

单独 spec 时再写，本文件不展开。

---

## 9. 反漂移护栏（开发期必须守住，可执行化）

| 红线                                 | 检测方式                                                                                 | 落地                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 扩展 host 内不出现 LLM provider 调用 | grep 禁用 `@anthropic-ai`、`openai`、`@ai-sdk/`、`langchain`                             | `packages/vscode-extension/.eslintrc.cjs` `no-restricted-imports` |
| 不引入第二种协议                     | 禁止 `import @agentclientprotocol/sdk`、`ws`、`mcp` 在 `src/` 出现                       | 同上                                                              |
| 不复制 daemon schema                 | 禁止本地新建 `interface Session\|Task\|Message\|Permission`                              | ESLint custom rule grep `interface (Session\|Task\|Message)`      |
| 不 fallback                          | 任何 catch 不得返回降级数据，只能：上报状态 + 引导操作                                   | code review checklist                                             |
| 不实现 chat 持久化                   | `extensionContext.globalState`/`workspaceState` 仅存 UI 偏好（折叠状态、最近 sessionID） | grep `globalState.update` 看 key                                  |
| 不写 file-system fallback 路径       | 所有路径来自 daemon 返回；扩展不拼路径（除 lock 文件目录由 SDK 暴露）                    | grep `path.join` 在 daemon/ 模块外应为 0                          |
| 不直连 daemon from webview           | webview 代码内禁止 `fetch`/`EventSource`                                                 | ESLint scope: `src/webview/**`                                    |
| 不用 EventSource                     | 全局禁止 `new EventSource`                                                               | `no-restricted-globals`                                           |
| 不手写 SSE parser                    | 全局禁止字符串 `"text/event-stream"`、`"data: "` 出现在 src/ 之外的 SDK gen 目录         | grep 守护，强制走 SDK helper                                      |
| 不引入 i18n 库                       | 禁 `i18next`/`vscode-nls`/`@formatjs/*`                                                  | ESLint                                                            |
| 不用同步 prompt 入口                 | 全局禁字符串 `"/session/"` 与 `"prompt_async"` 拼接                                      | grep 端点字符串                                                   |
| 不动状态机                           | 禁止 `enum.*State`/`switch.*case` 用于流程控制                                           | code review                                                       |
| 不强制 daemon 密码                   | grep `OPENCORVUS_SERVER_PASSWORD` 在 spawn env 中应为 0 命中                             | 同上                                                              |

CI step：`bun run lint` + `bun run typecheck` + 一个 `verify-no-banned.ts` 脚本扫上述 grep 规则，失败 fail。

---

## 10. 开放问题（落地前需对应 Phase PR 回答并更新本文）

1. **多 root 复用 daemon 的 directory header 切换粒度**：当前 `x-opencorvus-directory` 是请求级的，扩展每次 fetch 注入即可。Inspector 切 task 时如果 task 来自不同 root，SSE 重连时如何换 directory？
   - 倾向 SSE URL 自带 `?directory=...` query（`server.ts:121` 已支持 query 取 directory）；Phase 3 PR 验证。
2. **daemon merge-back 后的 file 事件**（§6.5）：Bus 上是否已有该事件？没有的话 Phase 5 要在 daemon 加 `worktree.merged` event。Phase 5 PR 必须给出确认结论。
3. **Open Overlay 命令**：daemon 是否有"启动 Tauri overlay 窗口"的 API？还是只能引导浏览器打开 `/ui/?auth_token=…`？Phase 6 PR 确认。
4. **Lock token rotation**：M1-M6 token 与 daemon lifetime 同寿命；rotate 留到 daemon 加局域网模式时一起做。
5. **Inspector 窗口数**：同时多个 task 各开一个 inspector 还是单 panel 切换？倾向**单 panel 切 tab**（避免 webview 资源膨胀）；Phase 3 PR 决定。
6. **`OPENCORVUS_SERVER_URL` env**（`serve.ts:144`）当前是 daemon 自己设给子 supervisor（如 ChannelSupervisor）使用的，**不是**给父进程读的；扩展不依赖这条，统一靠 lock 文件作为 source of truth。

每个问题在对应 Phase 的 PR 描述里必须明确取舍并更新本文。

---

## 11. 此文档生命周期

- 任何与本文档冲突的代码 PR **必须先改本文档**，否则不合并（CLAUDE.md §22 单源）
- 每完成一个 Phase，PR 中勾选验收项；本文末尾追加 "Phase X 完成于 commit ...."
- 设计决策反转：新增 ADR 区块（在文末），不要改历史决策的措辞
- 项目关闭时本文不删，迁到 `docs/archive/`

---

## ADR

（暂无）

## Phase 完成记录

（暂无）
