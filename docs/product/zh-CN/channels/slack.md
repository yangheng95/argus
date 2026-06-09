# Slack

Slack 是 OpenCorvus 的**首选远程 channel**，也是 channel-runtime 对接最成熟的平台。它直接通过 `opencorvus slack` 子命令启动。

## 状态

**生产可用**。`README.md:133` 已列为 Available。

## Quick setup

### 1. 创建 Slack App

在 [api.slack.com/apps](https://api.slack.com/apps) 创建一个 App，**必须开启 Socket Mode**（代码在 `src/adapters/slack.ts:22` 强制 `socketMode: true`）。

### 2. Scopes

Bot Token Scopes（最小集）：

| Scope                             | 用途                       |
| --------------------------------- | -------------------------- |
| `chat:write`                      | 回复消息                   |
| `chat:write.public`               | 在未加入的频道回复（可选） |
| `files:write`                     | 上传截图 / 附件            |
| `im:history` / `channels:history` | 读取 DM / 频道消息         |
| `reactions:write`                 | Ack emoji（可选）          |

App-Level Token Scope：

| Scope               | 用途             |
| ------------------- | ---------------- |
| `connections:write` | Socket Mode 连接 |

### 3. 订阅事件

Event Subscriptions 中订阅：

- `message.channels`
- `message.im`

（`.env.example:38-39` 说明）

### 4. 环境变量

```bash
export SLACK_BOT_TOKEN=xoxb-...       # Bot User OAuth Token
export SLACK_APP_TOKEN=xapp-...       # App-Level Token
export SLACK_SIGNING_SECRET=...       # Signing Secret（Socket Mode 下可选）
# 可选：allowlist，逗号分隔的 Slack User ID
export SLACK_ALLOWED_USER_IDS=U01234567,U09876543
```

### 5. 启动

两种方式二选一：

**A. 通过 opencorvus 主进程**

```bash
opencorvus slack
```

直接启动一个内嵌 Slack 适配器，与 headless orchestrator 共进程。

**B. 通过 channel-runtime（推荐多 channel 场景）**

```bash
cd packages/channel-runtime
bun run dev
```

会同时启动所有配置了 env 的 channel。

## Token 模型

三种 token 职责分明：

| Token          | 前缀    | 职责                                         |
| -------------- | ------- | -------------------------------------------- |
| Bot Token      | `xoxb-` | 代表 bot 的身份调 API（发消息、上传文件）    |
| App Token      | `xapp-` | 建立 Socket Mode WebSocket                   |
| Signing Secret | 无前缀  | 验证 HTTP webhook 签名（Socket Mode 下不用） |

## 消息流

```
用户在 Slack 频道/DM 发消息
  ↓ Socket Mode WebSocket
SlackAdapter.app.message()                [src/adapters/slack.ts:41]
  ↓
过滤：忽略 bot_id、非支持 subtype、去重
  ↓ IncomingMessage { platform: "slack", channel: C..., thread_ts: 123.456 }
ChannelRuntime.handleMessage()            [src/core.ts:235]
  ↓
SessionCoordinator.get("slack:C...:123")
  ↓  新 thread → 新 session；同 thread → 复用
client.session.promptAsync(sessionId, message)
```

Thread 语义：Slack 的 `thread_ts` 唯一标识一条对话；同 thread 内的后续消息会作为 **follow-up** 注入同一任务循环。

## 回复流

```
OpenCorvus 后端 SSE 推事件
  ↓
handleEvent(event)                        [src/core.ts:1132]
  ↓
task.report        → safeSend() 发送进度 / 结果 / 需要输入
message.updated    → 文本缓冲 → safeSend()
part.updated(image) → uploadImage() 调 files.uploadV2
permission.asked   → 若开启自动回复则直接 reply；否则 @ 用户等人工
```

回帖时：所有回复都会带上原 `thread_ts`，保持在同一 thread 内。

## Permission 交互

在 Slack 里审批权限：

```
允许一次：  allow  / 同意 / yes
始终允许：  always / allow always
拒绝：      reject / no / 拒绝
```

关键字识别由 channel-runtime 在通用层处理（不是 Slack 特有）。

## Ack 反应

Slack 适配器会在接收到消息后立刻给原消息加一个 emoji 反应作为"已收到"的回执（避免用户以为消息没送达）。可通过 config 关闭。

## 语音消息

Slack 的 `file_share` 子类型（语音消息）会被下载并走 STT pipeline（`STT_PROVIDERS` 指定的提供者），转写文本后当作普通消息处理。

## Troubleshooting

**问题**：`not_in_channel` 或 `channel_not_found`
**检查**：bot 是否被邀请进入该频道；DM 场景是否开启 `Messages Tab`。

**问题**：消息送达延迟高
**检查**：是否用了 Socket Mode；HTTP Request URL 模式在国内网络下延迟高。

**问题**：同一消息被处理两次
**检查**：去重逻辑在 `src/adapters/slack.ts`，基于 `event_id`；若看到重复，很可能是同时启动了 `opencorvus slack` 与 `channel-runtime`，二者都在订阅。

**问题**：权限审批消息无人回复
**检查**：内置权限默认 `allow`；检查项目配置是否显式写了 `ask`，然后从操作员界面审批，或把对应规则改为 `allow`。
