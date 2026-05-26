# CLI 参考

`opencorvus` 是统一的 CLI 入口（`packages/opencorvus/bin/opencorvus`），所有子命令在 `packages/opencorvus/src/index.ts` 注册。

## 全局 flag

| flag | 说明 |
|---|---|
| `--help`, `-h` | 帮助 |
| `--version` | 版本号 |
| `--verbose` | 详细日志 |
| `--config PATH` | 指定配置文件 |

## 子命令

### `opencorvus`（默认）

进入本地 TUI。交互式输入任务，实时看到 spec / plan / run / eval。

```bash
opencorvus
```

### `opencorvus serve`

启动 headless HTTP API 服务器。

```bash
opencorvus serve [flags]
```

| flag | 默认 | 说明 |
|---|---|---|
| `--hostname` | `127.0.0.1` | 监听地址（启用 `--mdns` 时改为 `0.0.0.0`） |
| `--port` | `7878` | 监听端口 |
| `--project-dir` | `cwd()` | 工作仓库路径 |
| `--mdns` | off | 启用 mDNS 服务发现 |
| `--mdns-domain` | `opencorvus.local` | mDNS 域名 |
| `--cors` | off | 启用 CORS |

`OPENCORVUS_SERVER_PASSWORD` 通过**环境变量**设置（非 CLI flag）。

核对于 `packages/opencorvus/src/cli/network.ts:4-31`。

暴露端点：
- `POST /task` — 创建任务
- `GET /tasks` — 任务列表
- `GET /task/<id>` — 任务详情
- `GET /task/<id>/events` — SSE 事件流
- `POST /task/<id>/message` — 追加消息
- `POST /task/<id>/retry` — 重试
- `POST /task/<id>/replan` — 重规划
- `POST /task/<id>/cancel` — 取消
- `GET /ui/` — Overlay UI 静态资源

### `opencorvus run`

一次性运行任务（非交互）。

```bash
opencorvus run "实现 src/foo.ts 的单元测试" [flags]
```

| flag | 说明 |
|---|---|
| `--command CMD` | 直接把命令作为任务 |
| `--continue`, `-c` | 续接最后一次 session |
| `--session ID`, `-s ID` | 续接指定 session |
| `--share` | 产出 share 链接 |

### `opencorvus slack`

启动内嵌 Slack 适配器。需要 `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN`。

```bash
opencorvus slack
```

详见 [channels/slack](../channels/slack.md)。

### `opencorvus acp`

启动 [ACP（Agent Client Protocol）](https://github.com/agentclientprotocol) 服务器，用于接入 Zed 等 ACP 客户端。

```bash
opencorvus acp
```

### `opencorvus auth`

LLM provider 认证。

```bash
opencorvus auth              # 登录
opencorvus auth --logout     # 登出
```

### `opencorvus models`

列出可用模型。

```bash
opencorvus models --list
```

### `opencorvus doctor`

诊断安装：依赖、网络、provider 连通性、配置合法性。

```bash
opencorvus doctor
```

### `opencorvus generate`

按配置 generate 代码（具体行为依赖 config 中的 `generate` 字段）。

### `opencorvus agent`

管理 / 查询本地 agent。

### `opencorvus debug`

调试单个任务。

```bash
opencorvus debug --task-id <id>
```

### `opencorvus export`

导出 session 到文件。

```bash
opencorvus export --format html
```

### `opencorvus db`

直接操作底层 SQLite。

```bash
opencorvus db --query "SELECT id, status FROM task ORDER BY id DESC LIMIT 20"
```

### 其他子命令

`packages/opencorvus/src/index.ts` 注册的全部顶级子命令（权威源），参数以 `--help` 为准：

| 命令 | 用途 |
|---|---|
| `opencorvus stats` | 统计信息 |
| `opencorvus upgrade` | 升级自身 |
| `opencorvus uninstall` | 卸载 |
| `opencorvus sidecar` | 嵌入式 sidecar 进程入口（一般由 overlay / 上游 host 内部调用） |
| `opencorvus import` | 导入 session |
| `opencorvus github` | GitHub Action runtime 入口（通常由 Action 内部调用） |
| `opencorvus pr` | PR 相关辅助 |
| `opencorvus mcp` | MCP 子命令族（`mcp serve` / `mcp auth` / `mcp status` / `mcp remove-auth`） |
| `opencorvus session` | session 管理 |

> ~~`opencorvus attach`~~ / ~~`opencorvus tui-thread`~~ 不是顶级 CLI 命令——`attach` 仅作为 TUI 内部功能存在于 `packages/opencorvus/src/cli/cmd/tui/attach.ts`。

## 退出码

代码仅在错误路径显式调用 `process.exit(1)`：

| code | 语义 |
|---|---|
| 0 | 成功（默认） |
| 1 | 任何运行时错误 |
| 130 | 被 Ctrl+C 中断（Bun 默认信号行为） |

> 历史版本曾规划 `2`（配置错误）与 `3`（任务失败），**当前未实装**。

## Shell 补全

```bash
opencorvus completion bash > /etc/bash_completion.d/opencorvus
opencorvus completion zsh  > ~/.zsh/completions/_opencorvus
```

> 命令名是 **`completion`**（单数，cac 框架内置）。历史文档曾写 `completions`，已修正。
