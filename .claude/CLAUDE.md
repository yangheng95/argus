# Agent to Read

## 开发测试须知

1. 项目中存在slack user token，你需要用user token（禁止用bot token发布任务）来模拟开发者行为，向openlens发送消息，触发流程。阅读openlens bot回复和查看log，确保openlens行为正确，修复bug，管控迭代框架设计，总结测试结果，评估表现，提出改进建议，执行改进，验证改进。自主迭代OpenLens框架设计，确保系统在实际使用场景下的可靠性和有效性。
2. 禁止跳过slack进行测试，必须通过slack进行交互，确保全链路集成测试的真实性和有效性。
3. 不允许直接调用Claude Code终端或其他组件进行测试，必须通过slack指令触发整个流程，模拟真实用户交互。
4. 每次测试需kill掉之前的openlens进程，确保测试环境干净，避免状态污染。
5. 从开发模式启动和调试openlens，确保可以实时查看日志和调试信息，快速定位和修复问题。不要使用二进制包进行测试，除非你需要验证发布版本的行为。
6. 如果你发现openlens没有使用GUI工具进行交互，或者没有使用Claude Code终端进行命令执行，或者没有使用视觉分析进行屏幕监控，或者没有使用Slack进行进度汇报，那么你需要修复这些问题，确保系统按照设计方案正确运行。
7. 不要给slack发乱码，用json

## Tips

- 如果要进行调查，则优先使用sonnet agent，除非你需要使用Opus的特定功能或优势。
- 如果使用Sonnet Agents，则最少使用5个agent，协同完成整个调查和分析过程，确保尽可能全面和深入的调查结果。
  
PRD：

- OpenLens是一个可以coding和操作GUI的助手，可以用户自行编码，或者通过bot指令让OpenLens完成任务。用户通过Slack与OpenLens交互，OpenLens通过Claude Code终端执行命令，通过视觉分析监控屏幕，通过Slack汇报进度和结果。
- bot和TUI不一定同时启动，bot永远最先启动，然后根据需求启动TUI，确保系统资源的合理利用和用户体验的优化。但启动的TUI必须能够内部正确绑定到bot上，确保两者之间的通信和协作正常进行。对于其他的GUI工具也是同样的原则，先搜索再确定目标窗口，必须确保它们能够正确绑定到bot上，确保系统的整体协作和功能的正常实现。最后fallback到桌面环境。在必要场景可以随时重新搜索绑定新窗口。这也体现在system prompt的设计上，必须包含搜索和绑定窗口的指令，确保用户可以随时管理和调整系统的GUI工具，确保系统的灵活性和适应性。
- 截图分析机制设计一个字agent，输入截图，输出分析。着用截图就不用进入主消息流了，避免干扰主流程的交互和处理。这个agent可以独立处理视觉分析的任务，专注于图像处理和分析，提供更专业和高效的视觉分析能力。同时，这个agent也可以与主消息流进行通信，提供分析结果和反馈，确保系统的整体协作和功能的正常实现。
- 如果你发现openlens没有使用GUI工具进行交互，或者没有使用Claude Code终端进行命令执行，或者没有使用视觉分析进行屏幕监控，或者没有使用Slack进行进度汇报，那么你需要修复这些问题，确保系统按照设计方案正确运行。

## 全平台打包 (Self-Contained Binary)

### 打包命令

```bash
cd packages/openlens

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

- **入口链**: `launcher.ts` → `index.ts`。launcher 将 CWD 切到二进制所在目录（解决原生 .node 模块从 CWD 解析的问题），原始 CWD 存入 `OPENLENS_ORIGINAL_CWD`，index.ts 恢复。
- **env 嵌入**: `--embed-env` 在编译时将 `.env` 解析为 `OPENLENS_EMBEDDED_ENV` 常量注入二进制。运行时外部 env 优先级更高，可覆盖。
- **原生依赖**: sharp、@parcel/watcher、node-screenshots、libnut 的平台 .node 文件从 `node_modules/.bun/` 拷贝到 `dist/<target>/bin/node_modules/`，随二进制一起分发。
- **产出结构**: `dist/<target>/bin/openlens[.exe]` + `bin/node_modules/`，整个 `bin/` 目录拷贝到目标机即可运行。

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
bun run --conditions=browser ./src/index.ts serve --hostname=127.0.0.1 --port=4096
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
curl -s http://127.0.0.1:4096/provider | jq '.[] | select(.id == "alibaba-cn") | {id, modelCount: (.models | length)}'

# 创建 session
curl -s -X POST http://127.0.0.1:4096/session -H 'Content-Type: application/json' \
  -d '{"model":"alibaba-cn/qwen3.5-plus"}' | jq .id

# 发送 prompt（同步）
curl -s -X POST http://127.0.0.1:4096/session/SESSION_ID/message \
  -H 'Content-Type: application/json' -d '{"content":"hello"}'

# 发送 prompt（异步 - bot 模式）
curl -s -X POST http://127.0.0.1:4096/session/SESSION_ID/prompt_async \
  -H 'Content-Type: application/json' -d '{"content":"hello"}'

# 查看 session 消息
curl -s http://127.0.0.1:4096/session/SESSION_ID/message | jq '.[].role'

# 查看可用工具
curl -s "http://127.0.0.1:4096/experimental/tool?provider=alibaba-cn&model=qwen3.5-plus" | jq '.[].id'
```

### SSE 事件监控

```bash
# 监听所有 SSE 事件
curl -N -s http://127.0.0.1:4096/event
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
