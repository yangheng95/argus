# Feishu or Lark Setup

## Current Support Boundary

As of 2026-03-03, `packages/bot/src/main.ts` does not include a built-in Feishu/Lark adapter.
Only Slack, Telegram, and Discord are registered by default.

Treat Feishu requests as one of two paths.

## Path A: Bridge Mode (No OpenCorvus Source Change)

Use an external relay service that receives Feishu bot events and forwards text to a channel where OpenCorvus already runs (for example Slack or Telegram).

Use this path when:
- the team needs a quick integration without changing `packages/bot`.
- infrastructure already has a webhook relay layer.

Use this path tradeoff:
- fastest rollout.
- adds one extra relay component to maintain.

## Path B: Native Feishu Adapter (Recommended for Long-Term)

Implement a new adapter in `packages/bot`:

1. Add `packages/bot/src/adapters/feishu.ts` implementing `BotAdapter` from `packages/bot/src/adapter.ts`.
2. Implement:
- `start` and `stop` for event intake.
- `onMessage` to normalize Feishu events into `{ platform, channel, thread, user, text }`.
- `sendMessage` and `uploadImage` using Feishu Open Platform APIs.
3. Export the adapter in `packages/bot/src/index.ts`.
4. Register it in `packages/bot/src/main.ts` based on env vars.
5. Add env entries in `packages/bot/.env.example`.

Suggested env names:
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_VERIFICATION_TOKEN`
- `FEISHU_ENCRYPT_KEY`

## Validation Checklist for Native Adapter

1. Bot startup prints Feishu adapter ready log.
2. A user text message arrives and is processed once.
3. Bot reply appears in expected thread context.
4. Image upload succeeds.
5. Invalid signature requests are rejected.
