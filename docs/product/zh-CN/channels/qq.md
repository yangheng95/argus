# QQ

QQ 适配器接入 **QQ 官方机器人平台**（`bot.q.qq.com`），走 WebSocket Gateway 协议。

## 前置

1. 在 [QQ 机器人平台](https://bot.q.qq.com/) 注册开发者、创建 Bot。
2. 获取 **AppID** 与 **Token**。
3. Bot 需上线审核（公测/私域）方可对外使用；私域 Bot 只能在已加入的频道/群里响应。

## 环境变量

参考 `packages/channel-config/src/index.ts` 中 `qq` 的字段声明：

```bash
export QQ_APP_ID=...
export QQ_BOT_TOKEN=...
export QQ_BOT_SECRET=...          # 可选，仅 Webhook 模式需要
```

## Thread 语义

QQ 频道以 `channelId` 作为 thread key；群聊以 `groupOpenId` 代替。

## Troubleshooting

- **Bot 未响应**：QQ 官方 Bot 平台的审核状态必须是"已通过"；沙箱环境仅对指定频道生效。
- **WebSocket 断连频繁**：QQ Gateway 心跳间隔短（约 30s），网络不稳定时会重连。
