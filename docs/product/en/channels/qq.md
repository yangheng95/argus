# QQ

QQ adapter integrates with the **official QQ Bot Platform** (`bot.q.qq.com`) via its WebSocket Gateway.

## Prerequisites

1. Register as a developer and create a Bot at [QQ Bot Platform](https://bot.q.qq.com/).
2. Obtain **AppID** and **Token**.
3. The Bot must pass review (public/private domain) before it can serve users; private-domain bots only respond in joined channels/groups.

## Environment

From `packages/channel-config/src/index.ts`:

```bash
export QQ_BOT_APP_ID=...           # required: AppID
export QQ_BOT_APP_SECRET=...       # required: AppSecret
export QQ_SANDBOX=0                # optional: sandbox mode (default 0)
export QQ_WEBHOOK_HOST=0.0.0.0     # optional: webhook mode listen host
export QQ_WEBHOOK_PORT=16674       # optional
export QQ_WEBHOOK_PATH=/qq         # optional
```

## Thread semantics

QQ channels use `channelId` as thread key; groups use `groupOpenId`.

## Troubleshooting

- **Bot unresponsive**: the Bot review status must be "approved"; sandbox only serves designated channels.
- **Frequent WebSocket disconnects**: QQ Gateway has a ~30s heartbeat; expect reconnects on unstable networks.
