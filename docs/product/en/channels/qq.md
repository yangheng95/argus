# QQ

QQ adapter integrates with the **official QQ Bot Platform** (`bot.q.qq.com`) via its WebSocket Gateway.

## Prerequisites

1. Register as a developer and create a Bot at [QQ Bot Platform](https://bot.q.qq.com/).
2. Obtain **AppID** and **Token**.
3. The Bot must pass review (public/private domain) before it can serve users; private-domain bots only respond in joined channels/groups.

## Environment

See the `qq` entry in `packages/channel-config/src/index.ts`:

```bash
export QQ_APP_ID=...
export QQ_BOT_TOKEN=...
export QQ_BOT_SECRET=...          # optional, for webhook mode
```

## Thread semantics

QQ channels use `channelId` as thread key; groups use `groupOpenId`.

## Troubleshooting

- **Bot unresponsive**: the Bot review status must be "approved"; sandbox only serves designated channels.
- **Frequent WebSocket disconnects**: QQ Gateway has a ~30s heartbeat; expect reconnects on unstable networks.
