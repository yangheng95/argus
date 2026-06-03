# Overlay 桌面端

Overlay 是 OpenCorvus 的 **Tauri 2 桌面面板**：半透明浮层驻留在屏幕右下角，接管本机 `opencorvus serve`，把 agent 工作流以图形化方式呈现给你。

## 技术栈

| 层 | 选型 |
|---|---|
| 桌面容器 | Tauri 2（Rust 宿主 + WebView2 / WKWebView / WebKitGTK） |
| 前端 | Solid.js 1.9 + Vite 7 |
| 状态管理 | Solid signals（`src/store/*`） |
| 构建 | Bun + `tauri build` |
| 后端通信 | SSE（EventSource）+ HTTP REST |

来源：`packages/overlay/package.json`、`src-tauri/Cargo.toml`。

## 启动模式

### 开发

```bash
cd packages/overlay
bun run dev        # tauri dev：Vite HMR + Rust 热重载
bun run dev:vite   # 仅前端 Vite（调试 UI 用）
```

或从根目录：

```bash
bun run dev:overlay   # 等价于 cd packages/overlay/src-tauri && cargo run --release
```

### 打包

```bash
bun run build:overlay   # 生成平台安装包（.msi / .dmg / .deb）
```

## 核心面板

| 面板 | 作用 | 文件 |
|---|---|---|
| **Board** | 任务总览：requirements / architect / build / acceptance 各阶段卡片 | `src/components/Board.tsx` |
| **TaskList** | 左侧任务列表，实时状态 | `src/components/TaskList.tsx` |
| **Conversation** | Agent 对话 / 工具调用 / 推理过程 | `src/components/Conversation.tsx` |
| **ChatComposer** | 输入框，支持发消息 / 附件 | `src/components/ChatComposer.tsx` |
| **InteractionCard** | 权限审批与人机确认弹层（旧名 `InteractionPanel` 已重命名） | `src/components/InteractionCard.tsx` |
| **ChangesPanel** / **DiffPreviewPanel** / **DiffView** | 文件变更 diff 预览 | `src/components/ChangesPanel.tsx` 等 |
| **MemoryPanel** | Agent 记忆 / 上下文 | `src/components/MemoryPanel.tsx` |
| **TracePanel** | 执行轨迹 | `src/components/TracePanel.tsx` |
| **LogViewer** | 原始日志 | `src/components/LogViewer.tsx` |
| **TaskProgressBar** / **GoalWorkflowGroup** | Goal 级并行进度（每个 goal 自带 worktree 行） | `src/components/TaskProgressBar.tsx` · `GoalWorkflowGroup.tsx` |
| **WorkspacePanel** + **Workspace\*Launcher** | 工作区控制、外部 IDE / 终端 / coding CLI 启动 | `src/components/Workspace*.tsx` |
| **RequirementsPanel** / **ArchitectPanel** | requirements / architect agent 输出展示 | `src/components/*.tsx` |
| **IntegrityCard** | Integrity reviewer 输出 | `src/components/IntegrityCard.tsx` |
| **EvaluationCriteriaPanel** | Acceptance 验收准则与证据 | `src/components/EvaluationCriteriaPanel.tsx` |
| **NotificationCenter** | 通知 / 系统提示 | `src/components/NotificationCenter.tsx` |

设置面板（侧边栏，`src/components/settings/`）：

- **General** / **Providers** / **Channels** / **Orchestration** / **Permissions** / **SkillMarket** / **AgentModels** / **ExtensionSettings**

## 通信机制

### SSE 事件流（两条长连接）

1. **任务详情流**（选中任务时建立）
   ```
   GET http://127.0.0.1:7878/task/{taskID}/events?after={sequence}
   ```
   代码：`src/services/sse.ts` `startSSE()`
   用原生 `EventSource` 绕过 WebView2 对 `fetch().body` 的缓冲延迟。

2. **全局任务列表流**（应用级）
   ```
   GET http://127.0.0.1:7878/task/events
   ```
   代码：`src/services/sse.ts` `startTaskListSSE()`

### 事件路由

`src/services/events.ts` `routeSSEEvent()` 把事件分流。当前 `engine/model.ts` 公开的核心事件名：

| 事件 | 目的地 |
|---|---|
| `task.created` / `task.updated` / `task.completed` / `task.failed` / `task.cancelled` | TaskList 状态刷新 |
| `task.rewound` / `task.message` | message 流处理 |
| `goal.progress` / `goal.passed` / `goal.failed` | GoalWorkflowGroup 行 |
| `workflow.selected` / `workflow.step.updated` / `goal.workflow.progress` | Board 阶段卡片 |
| `acceptance.ready` / `acceptance.gate.rejected` / `acceptance.evidence.updated` | 交付阶段 |
| `message.updated` / `part.updated` / `part.delta` | messageStore 批处理 |
| `agent.updated` | agentEvents |
| `config.changed` | 触发 `loadConfigInfo()`（partial diff 模式） |

## Rust 侧原生能力

`src-tauri/src/main.rs` 注册所有 Tauri 命令：

| 命令 | 用途 |
|---|---|
| `overlay_server_info` / `overlay_server_restart` | 嵌入的 opencorvus 后端进程管理 |
| `overlay_settings_load` / `overlay_settings_save` | 设置持久化到 `.opencorvus/overlay.json` |
| `overlay_pick_dir` / `overlay_pick_files` | 目录 / 文件选择对话框 |
| `overlay_open_url` / `overlay_open_path` | 外部打开 |
| `overlay_attention_set` | 托盘闪烁提示 |
| `overlay_toggle_devtools` | 开发者工具切换 |
| terminal profile commands | 在用户配置的系统终端中打开 worktree（替代了旧的嵌入 PTY，commit `6edd471a3`） |

进程清理：Windows 用 Job Object + `KILL_ON_JOB_CLOSE`；Unix 用 SIGKILL 进程组——确保 overlay 退出时后端进程及子进程全部回收。

## 后端集成

1. **启动时**（`main.rs` `setup`）：定位嵌入二进制 `opencorvus[.exe]`，找空闲端口 → `opencorvus serve --hostname 127.0.0.1 --port <port>`
2. **握手**：前端 `initApp()` → `overlay_server_info` → 获取实际端口 → 更新 API 客户端基地址
3. **健康探测**：`GET /global/health`，最多重试 8 次
4. **重连**：每 10 秒轮询，离线后自动重启 SSE

## 配置

`~/.opencorvus/overlay.json` 存 UI 偏好（主题、位置、缩放、server URL override、terminal profile、editor 默认值）；托盘菜单的 **Restart** 会重启后端并 `location.reload()` 前端。
