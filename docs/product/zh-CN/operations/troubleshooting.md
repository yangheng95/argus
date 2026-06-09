# Troubleshooting

按症状查。每条都给出**检查路径**而不是"试试重启"。

## 启动类

### `opencorvus serve` 起不来

| 检查                         | 说明                                                                |
| ---------------------------- | ------------------------------------------------------------------- |
| `opencorvus doctor`          | 先跑一次全面诊断                                                    |
| 端口占用                     | 默认 7878，`netstat -ano \| findstr 7878`                           |
| `OPENCORVUS_SERVER_PASSWORD` | 若对外监听，必须设；否则启动报 `refuses to expose without password` |
| 权限：`ENOSPC`               | `~/.opencorvus` 磁盘满                                              |

### Overlay 启动后连不上后端

1. 托盘菜单 → Restart（会重启后端 + 刷新前端）
2. 看 overlay 日志 `~/.opencorvus/overlay.log` 与 server 日志 `~/.opencorvus/server.log`
3. 手工探测 `GET http://127.0.0.1:<port>/global/health`
4. 设 `OPENCORVUS_OVERLAY_SINGLETON_MODE=kill-old-start-new` 防止旧后端残留

### 系统终端打开失败

Overlay 用系统终端打开 worktree 的能力（替代旧嵌入 PTY，commit `6edd471a3`）依赖 `terminal` profile 配置。失败排查：

1. 检查 `opencorvus.jsonc` 的 `terminal.command` 是否指向有效可执行文件
2. Windows 上推荐 `wt.exe`（Windows Terminal）；macOS 推荐 `iTerm.app`；Linux 用对应 desktop terminal 的命令
3. profile shell flag 是否与目标 shell 一致（`bash -c` / `pwsh -NoExit -Command` 等）

## Provider / 模型类

### Executor 返回空响应

根因几乎都是**没设对应 provider 的 API Key**。`Env.state()` 在实例创建时快照 env，因此：

1. `.env` 文件没加载到 → 改为显式注入：`DASHSCOPE_API_KEY=sk-... opencorvus serve`
2. Key 设错 provider → `alibaba-cn` 用 `DASHSCOPE_API_KEY`，`anthropic` 用 `ANTHROPIC_API_KEY`
3. Gateway 用错模型 → Gateway 不读 `OPENCORVUS_BENCHMARK_MODEL`，要写 `cfg.model`

### Alibaba API 连接卡住 20+ 分钟

`alibaba-coding-plan-cn` 已知在高峰期会 hang。**不要**增加 stall timeout 掩盖问题：

- 改用 `--tool-timeout-ms=30000` 让它 fail fast
- 或切换到其他 provider

## Orchestrator 类

### 任务卡在 requirements / architect / build 阶段

| 症状                               | 检查                                                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 没有任何事件                       | LLM provider 连通性；`opencorvus doctor`                                                                                                         |
| 有 reasoning tokens 但无 tool-call | 检查 `toolChoice`，reasoning 模型必须 `"auto"`                                                                                                   |
| Agent 长时间无动静                 | 当前由 engine 内部 stream-activity 看门狗（180s idle abort）管理；benchmark 已不再接受 `--stall-timeout-ms` / `--planning-stall-timeout-ms` flag |

### 任务一直 replan / retry 不停

根因通常是 acceptance 的 `replan_guidance` 没有改善信息。检查：

1. Requirements / SpecSnapshot 是否本身就缺 acceptance criteria（`check_selectors` 为空）
2. `done_definition` 里的命令是否可执行（见 [Acceptance 检查与判决](../opencorvus/evaluator.md)）
3. `assistant.max_executor_groups` 是否过大（默认 3，过大会同时启动更多 goal/build）
4. `assistant.acceptance.max_retries` 是否过大导致回修循环一直消耗预算

### 权限审批无限等待

| 检查                               | 说明                                                               |
| ---------------------------------- | ------------------------------------------------------------------ |
| config 是否显式写了 `ask`          | 内置 agent 权限默认 `allow`；只有显式 `ask` 规则会等待操作员回复。 |
| `OPENCORVUS_PERMISSION_TIMEOUT_MS` | 未回复 ask 的拒绝超时，默认 `300000` ms；最小值 `1000` ms          |

## 评估类

### Benchmark 显示 "accepted" 但产物跑不起来

典型症状是 acceptance worktree 合并失败但 acceptance checks 没捕获。检查：

1. 合并日志里是否有 `EEXIST` / conflict
2. spec 的 `check_selectors` 是否包含 `build` 与 `startup`
3. `selectorsSatisfied()` 是否把 skipped 检查误当通过——已修复，但 config 错误可能复发
4. CLAUDE.md rule 7 提醒：`accepted` 只是自声明，必须**自己起项目** + 跑 verify 做二次复核

### TypeScript 编译错误未被检测

确保 spec 的 `check_selectors` 包含 `lint` 或显式声明 `typecheck` family。check selector 必须来自 spec / architect 的结构化输出，**不从关键字推断**（`check/policy.ts::inferSelectors` 返回空数组）。

## Channel 类

### Slack 消息被处理两次

`opencorvus slack` 与 `channel-runtime` 同时在跑，二者都订阅了 Slack 事件。**只启一个**。

### Webhook 校验失败（飞书/钉钉/企业微信/LINE）

签名算法每家不同；核对 env 与后台值是否字面一致，注意**换行符**（特别是 Google Chat 的 service account JSON）。

### 消息回帖到错误 thread

`SessionCoordinator` 的 thread key = `platform:channel:thread_ts`。若回错，多半是某个 adapter 没把 thread_ts 透传出来。查对应 adapter 的 `onMessage` 里是否把 `thread_id` 写入 `IncomingMessage`。

## 调试工具自身

### git 命令异常

按 CLAUDE.md 第 7 条：**先修工具，再继续任务**。

- `git worktree` 错：`git worktree prune`
- Windows 上 `git` 换 `Git for Windows` 自带的 bash，不要用 MSYS2 的

### `rg` / Grep 工具异常

重装 ripgrep；Windows 上 Bun 可能连不到 PATH 里的 rg，需要绝对路径。
