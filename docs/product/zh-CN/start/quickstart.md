# Quickstart

目标：在你自己的仓库里跑通第一个端到端任务，≤ 5 分钟。

## 1. 启动 headless 服务器

```bash
cd /path/to/your/repo
opencorvus serve
```

默认监听 `127.0.0.1:7878`。常用 flag：

| flag                   | 说明                                                |
| ---------------------- | --------------------------------------------------- |
| `--hostname 0.0.0.0`   | 对外监听（必须同时设 `OPENCORVUS_SERVER_PASSWORD`） |
| `--port 7878`          | 改端口                                              |
| `--project-dir <path>` | 指定工作仓库                                        |
| `--mdns`               | 启用 mDNS 服务发现                                  |

> 如果暴露到 localhost 以外，**务必**先设置 `OPENCORVUS_SERVER_PASSWORD`。

## 2. 打开 UI（可选）

浏览器访问 `http://127.0.0.1:7878/ui/` 即可看到 Overlay 面板。也可另开一个 Tauri 原生窗：

```bash
bun run dev:overlay   # repo root
```

## 3. 创建一个任务（HTTP）

```bash
curl -X POST http://127.0.0.1:7878/task \
  -H "content-type: application/json" \
  -d '{
    "request": "为 src/foo.ts 新增单元测试，覆盖 happy path 与 2 条错误路径。"
  }'
```

响应：`202` + `{ "task_id": "tsk_..." }`。

## 4. 监听进度（SSE）

```bash
curl -N http://127.0.0.1:7878/task/<task_id>/events
```

依次会看到的典型事件（事件名来自 `engine/model.ts`）：

```
task.created
workflow.selected          ← Orchestrator 选 direct 或 pipeline 模板
workflow.step.updated      ← requirements / architect / build / deliver 各步骤推进
goal.progress              ← 单个 goal 的 build attempt 在跑
goal.workflow.progress     ← 单个 goal 的 step 计数
goal.passed / goal.failed
delivery.ready
delivery.evidence.updated
delivery.gate.rejected     ← 触发回修循环（不一定出现）
task.completed | task.failed | task.cancelled
```

> 历史文档里的旧 `*_agent_running` 名称**已不存在**——相关 agent 已在 2026-05 重构中下线 / 重命名，参见 [架构总览](../concepts/architecture.md)。

## 5. 常用任务端点

| 端点                            | 用途                                                      |
| ------------------------------- | --------------------------------------------------------- |
| `GET /tasks`                    | 所有任务列表                                              |
| `GET /task/<id>`                | 单任务状态                                                |
| `GET /task/<id>/board`          | Kanban 视图                                               |
| `POST /task/<id>/message`       | 追加用户消息（follow-up）                                 |
| `POST /task/<id>/retry`         | 保持 plan，重试执行                                       |
| `POST /task/<id>/replan`        | 丢弃当前 plan，重新规划                                   |
| `POST /task/<id>/cancel`        | 取消任务                                                  |

## 6. 本地 TUI（交互模式）

不想走 HTTP 也可以：

```bash
opencorvus
```

会进入 TUI：直接输入任务 → 实时看到 requirements / architect / build / delivery 滚动。

## 7. Workspace 与 terminal

Overlay 的 Workspace 面板可以在你配置的**系统终端**里打开当前 worktree（替代了旧的嵌入 PTY，commit `6edd471a3`）。在 `opencorvus.jsonc` 配置 `terminal` profile 后，点击 Workspace 卡的"打开终端"按钮即按 profile 启动 Windows Terminal / iTerm / GNOME Terminal 等。详见 [配置](../opencorvus/configuration.md#terminal)。

## 8. 通过 Slack 创建任务

```bash
export SLACK_BOT_TOKEN=xoxb-...
export SLACK_APP_TOKEN=xapp-...
opencorvus slack
```

在任何 Slack 频道里 at 机器人发第一条消息即创建任务；后续同 thread 内的回复会作为 follow-up 注入任务循环。完整配置见 [channels/slack](../channels/slack.md)。

## 常见陷阱

1. **任务卡在 requirements 阶段**：多半是 LLM provider 连不通。`opencorvus doctor` 检查。
2. **delivery 永远 rejected**：仓库里可能没有可执行的 build / test 命令。Delivery checks 会从 `owned_paths` 向上找最近的 `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod`。
3. **permission 无限等待**：内置权限默认 `allow`；检查项目配置是否显式写了 `ask`，然后在 UI 中回复，或把对应规则改为 `allow`。

下一步：[架构总览](../concepts/architecture.md)。
