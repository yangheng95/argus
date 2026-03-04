# OpenClaw and LINE Reference

## Snapshot

Research date: 2026-03-03.

## Verified OpenClaw facts

- OpenClaw marks LINE as experimental.
- LINE channel is plugin-based in OpenClaw.
- Docs require channel access token, with channel secret optional for signature validation.
- Docs include webhook callback guidance and channel add commands.

## OpenCorvus mapping

OpenCorvus source of truth:

- `packages/bot/src/registry.ts`
- `packages/bot/src/adapters/line.ts`
- `packages/bot/.env.example`

OpenCorvus env keys:

- Required: `LINE_CHANNEL_ACCESS_TOKEN`
- Optional: `LINE_CHANNEL_SECRET`, `LINE_WEBHOOK_HOST`, `LINE_WEBHOOK_PORT`, `LINE_WEBHOOK_PATH`
- Compatibility fallback: `OPENCLAW_LINE_CHANNEL_ACCESS_TOKEN`

Runtime notes:

- Adapter exposes webhook endpoint and can validate `x-line-signature` when secret is set.
- Outbound uses LINE push API.
- Current adapter is text MVP for media output (image upload fallback to text notice).

## Differences to keep explicit

- OpenClaw plugin docs and OpenCorvus adapter are mostly aligned on core token/secret concepts.
- Naming difference is mainly OpenCorvus compatibility fallback prefix (`OPENCLAW_*`).

## Verification checklist

1. Start bot and confirm LINE webhook endpoint is reachable.
2. Send one text message and confirm one reply.
3. If secret is enabled, verify invalid signature is rejected.
4. Confirm channel access token has Messaging API send permissions.

## Sources

- OpenClaw channels overview: https://docs.openclaw.ai/channels
- OpenClaw LINE docs: https://docs.openclaw.ai/channels/line
- LINE Messaging API docs: https://developers.line.biz/en/docs/messaging-api/overview/
