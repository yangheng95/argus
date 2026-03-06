# Agent to Read

## 产品定位 (PRD)

OpenCorvus 是一个可以 **coding 和操作 GUI** 的异步编排助手。

核心能力：
- **编码执行**：通过 opencode kernel（session/prompt/tool）执行代码修改、终端命令、文件操作
- **GUI 自动化**：通过 screen/input/overlay 工具操作桌面应用（截图、点击、键盘、拖拽、窗口绑定）
- **视觉分析**：独立子 agent 处理截图分析，不进入主消息流
- **任务编排**：orchestrator 层管理 task → plan → run → evaluate → retry/replan 生命周期
- **多渠道交互**：用户通过 Slack/Telegram 等渠道提交任务、接收进度、回答问题

**GUI 自动化是一等公民能力，不是附加功能。**

## 系统架构

### 运行时层级

```
Channel (Slack/Telegram)  ←→  Orchestrator (task/plan/run/evaluation)
                                    ↓
                               Executor (opencode adapter)
                                    ↓
                            Kernel (opencode session/prompt/tool)
                                    ↓
                   ┌────────────────┼────────────────┐
                   ↓                ↓                ↓
              GUI Tools        Terminal Tools    File Tools
         (screen/input/       (bash/pty)      (edit/write/read)
          overlay/vision)
```

### 关键模块与职责

| 层 | 目录 | 职责 |
|---|---|---|
| **Channel** | `channel/slack.ts`, `packages/bot/` | 渠道适配、消息收发、线程绑定 |
| **Orchestrator** | `orchestrator/` | Task/Run/Goal 生命周期、重试/重规划、预算控制 |
| **Workbench** | `workbench/` | 用户偏好、任务笔记、上下文摘要（brief/board） |
| **Planner** | `planner/` | 初始计划生成、失败后重规划 |
| **Evaluator** | `evaluator/` | build/test/lint 确定性检查、LLM judge 兜底 |
| **Executor** | `executor/opencode.ts` | 将 orchestrator run 映射到 opencode session |
| **Kernel** | `session/`, `tool/`, `server/` | opencode 上游能力：session 管理、工具执行、API |
| **GUI** | `opencorvus/perception/`, `opencorvus/gui/`, `tool/screen.ts`, `tool/input.ts` | 截图、窗口绑定、坐标转换、overlay 网格、输入操作 |
| **Overlay** | `packages/overlay/` (Tauri) | 坐标网格 UI、点击标记、启动入口 |
| **Bot** | `packages/bot/` | SSE 事件循环、task_report 多轮协议、截图上传、权限自动回复 |

### Bot 与 Orchestrator 的关系

两套系统当前并存：

- **Bot 模式**（`packages/bot/src/core.ts`）：直接通过 SSE 订阅 session 事件，用 `task_report` 工具驱动多轮循环。适合简单的单 session 任务。
- **Orchestrator 模式**（`orchestrator/`）：管理 Task→Run→Evaluation 生命周期，支持重试、重规划、多 Goal 验证。适合需要质量门控的复杂任务。

Bot 可以作为 orchestrator 的 channel 层使用，也可以独立运行。迁移方向：Bot 逐步调用 orchestrator API 而非直接操作 session。

### 启动方式

- **Overlay（Tauri）是推荐启动入口**，会自动拉起 bot 和其他组件
- Bot 也可独立启动（开发调试场景）
- TUI 按需启动，必须能绑定到 bot session

### 窗口绑定原则

- 先截图 → 用 `screen.list_windows` 搜索 → `screen.bind_window` 绑定目标窗口
- 焦点切换键（Win+I, Alt+Tab）后自动解绑旧窗口，下次截图捕获全屏
- 必要时随时重新搜索绑定新窗口
- System prompt 必须包含窗口搜索和绑定指令

### 视觉分析

- 独立子 agent 处理，输入截图输出分析，不进入主消息流
- 仅在启用 `OPENCORVUS_VISION_MODEL` 且图片 < 7MB 且变化超过阈值时触发

## 开发测试须知

1. 项目中存在 Slack user token，用 user token（禁止用 bot token）模拟开发者行为向 OpenCorvus 发送消息触发流程。
2. 验收级测试禁止跳过 Slack，必须通过 Slack 交互确保全链路集成测试真实性。
3. 验收级测试不允许直接调用终端或组件绕过 Slack；必须由 Slack 指令触发主流程。
4. 每次测试前 kill 掉旧的 OpenCorvus 相关进程，确保环境干净。
5. 默认用开发模式启动和调试。除非验证发布行为，否则不用二进制包。
6. 如果发现系统未使用 GUI 工具交互、未使用终端执行命令、未使用视觉分析监控屏幕、或未通过 Slack 汇报进度，需修复后再继续验收。
7. 不要给 Slack 发乱码，用 JSON。

## 测试分层（避免规则冲突）

- **E2E 验收**：必须走 Slack 链路（发起 → 执行 → 汇报 → 完成），确认真实用户路径。
- **本地诊断**：允许使用本地命令、HTTP API、SSE 订阅、日志等手段定位和修复；不替代 E2E 验收。
- **结论判定**：最终以 E2E 验收结果为准。

## Tips

- 调查任务优先使用 sonnet agent，除非需要 Opus 的特定能力。
- 使用 Sonnet Agents 时最少 5 个 agent 协同完成调查分析。

## 全平台打包 (Self-Contained Binary)

### 打包命令

```bash
cd packages/opencorvus

# 1. 安装全平台原生依赖（首次或依赖变更后）
bun install --os="*" --cpu="*" @opentui/core@<version> @parcel/watcher@<version>

# 2. 预缓存所有 Bun 交叉编译运行时（首次或 Bun 升级后）
#    Bun.build() API 在 Windows 下载运行时有 bug，需用 CLI 预缓存
for target in bun-linux-aarch64 bun-linux-x64 bun-linux-x64-baseline \
  bun-linux-aarch64-musl bun-linux-x64-musl \
  bun-darwin-aarch64 bun-darwin-x64 bun-darwin-x64-baseline \
  bun-windows-x64 bun-windows-x64-baseline; do
  echo 'console.log(1)' > /tmp/_d.ts
  SSL_CERT_FILE=/usr/ssl/certs/ca-bundle.crt bun build --compile --target=$target /tmp/_d.ts --outfile /tmp/_d_out
done
rm -f /tmp/_d.ts /tmp/_d_out*

# 3. 打包（全平台 + 嵌入 env）
SSL_CERT_FILE=/usr/ssl/certs/ca-bundle.crt \
  MODELS_DEV_API_JSON=/tmp/models-api-clean.json \
  bun run script/build.ts --embed-env ../../.env

# 单平台快速打包（当前平台）
bun run script/build.ts --single --embed-env ../../.env --skip-install
```

### 架构要点

- **入口链**: `launcher.ts` → `index.ts`。launcher 将 CWD 切到二进制所在目录（解决原生 .node 模块从 CWD 解析的问题），原始 CWD 存入 `OPENCORVUS_ORIGINAL_CWD`，index.ts 恢复。
- **env 嵌入**: `--embed-env` 在编译时将 `.env` 解析为 `OPENCORVUS_EMBEDDED_ENV` 常量注入二进制。运行时外部 env 优先级更高，可覆盖。
- **原生依赖**: sharp、@parcel/watcher、node-screenshots、libnut 的平台 .node 文件从 `node_modules/.bun/` 拷贝到 `dist/<target>/bin/node_modules/`，随二进制一起分发。
- **产出结构**: `dist/<target>/bin/opencorvus[.exe]` + `bin/node_modules/`，整个 `bin/` 目录拷贝到目标机即可运行。

### 已知问题

- **SSL**: Windows/MINGW 下 Bun 内部 TLS 不信任部分 CA，需设 `SSL_CERT_FILE=/usr/ssl/certs/ca-bundle.crt`。
- **linux-x64-baseline-musl**: Bun 目标命名不匹配（生成 `baseline-musl` 但期望 `musl-baseline`），已跳过。
- **部分 Linux 原生依赖缺失**: linux-arm64/x64 的 @parcel/watcher、linux-arm64-musl 的 node-screenshots 无对应包，为非致命警告，相关可选功能不可用。
- **models-snapshot.ts**: 需提前准备 `api.json`（网络下载或本地文件），若用本地文件需去除尾部换行：`tr -d '\n\r' < api.json > clean.json`。

## 调试命令 (Debug Commands)

### Bot 启动与调试

```bash
# 1. Kill 旧进程
pkill -f "bun.*packages/bot" 2>/dev/null; pkill -f "bun.*packages/opencorvus.*serve" 2>/dev/null

# 2. 启动 bot（开发模式，带测试提示注入）
cd packages/bot
TEST_PROMPT='你的测试指令' bun run src/main.ts 2>&1 | tee /tmp/bot.log

# 3. 仅启动 OpenCorvus server（不含 bot）
cd packages/opencorvus
bun run --conditions=browser ./src/index.ts serve --hostname=127.0.0.1 --port=7878
```

### Auth 验证

```bash
# 检查 auth.json 路径（Windows/MINGW 下 xdg-basedir 会把路径设为 ~/.local/share）
cat ~/.local/share/opencorvus/auth.json

# 写入 auth（Coding Plan API）
mkdir -p ~/.local/share/opencorvus
echo '{"alibaba-cn":{"type":"api","key":"sk-sp-YOUR_KEY"}}' > ~/.local/share/opencorvus/auth.json
```

### API 直接测试

```bash
# 测试 provider 加载
curl -s http://127.0.0.1:7878/provider | jq '.[] | select(.id == "alibaba-cn") | {id, modelCount: (.models | length)}'

# 创建 session
curl -s -X POST http://127.0.0.1:7878/session -H 'Content-Type: application/json' \
  -d '{"model":"alibaba-cn/qwen3.5-plus"}' | jq .id

# 发送 prompt（同步）
curl -s -X POST http://127.0.0.1:7878/session/SESSION_ID/message \
  -H 'Content-Type: application/json' -d '{"content":"hello"}'

# 发送 prompt（异步 - bot 模式）
curl -s -X POST http://127.0.0.1:7878/session/SESSION_ID/prompt_async \
  -H 'Content-Type: application/json' -d '{"content":"hello"}'

# 查看 session 消息
curl -s http://127.0.0.1:7878/session/SESSION_ID/message | jq '.[].role'

# 查看可用工具
curl -s "http://127.0.0.1:7878/experimental/tool?provider=alibaba-cn&model=qwen3.5-plus" | jq '.[].id'
```

### SSE 事件监控

```bash
# 监听所有 SSE 事件
curl -N -s http://127.0.0.1:7878/event
```

### Slack 调试

```bash
# 使用 user token 发送测试消息（需要 .env 中的 SLACK_USER_TOKEN）
source .env
curl -s -X POST https://slack.com/api/chat.postMessage \
  -H "Authorization: Bearer $SLACK_USER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"channel\":\"$SLACK_CHANNEL_ID\",\"text\":\"测试消息\"}"
```

### 常见问题排查

- **ProviderModelNotFoundError**: 检查 `~/.local/share/opencorvus/auth.json` 是否存在正确的 key
- **SSE 没有 session 事件**: promptAsync 的 task queue 在 scheduler 中运行缺少 Instance 上下文，Bus.publish 无法到达 GlobalBus
- **Bot 不回复 Slack**: 检查 SSE 事件流是否包含 `message.part.updated` 和 `message.updated`
- **GUI 工具坐标问题**: 高分辨率屏幕 (3840x2088) 下坐标需要参考截图中的坐标网格标签

关于修改 node_modules 这个问题：不是必须的，这是 @opentui/solid 包本身的 bug。

问题根源

@opentui/solid 的 package.json 中：
"./jsx-runtime": "./jsx-runtime.d.ts" // 指向了 .d.ts 类型文件

应该指向实际的 JS 文件，但该包根本没有提供 jsx-runtime.js。这是包作者的发布错误。

对其他人的影响

其他人 bun install 后会遇到同样的问题，因为 npm 上发布的包就是坏的。

正确的解决方案（不改 node_modules）

有两种方案可以让修复随代码一起分发：

方案 A：patch 文件（推荐）
用 patch-package 或 bun 的 --patch 功能生成 patch 文件，提交到代码库，其他人 install 后自动打补丁。

方案 B：在 opencorvus 的 package.json 中加 overrides
"overrides": {
"@opentui/solid": {
...
}
}
