# OpenClaw and Google Chat Reference

## Snapshot

Research date: 2026-03-03.

## Verified OpenClaw facts

- OpenClaw marks Google Chat as experimental.
- Docs describe service account based setup and channel registration through CLI.
- Docs include webhook path convention for inbound events.
- Docs use service-account-file naming (`GOOGLE_CHAT_SERVICE_ACCOUNT_FILE`) in examples.

## OpenCorvus mapping

OpenCorvus source of truth:

- `packages/bot/src/registry.ts`
- `packages/bot/src/adapters/googlechat.ts`
- `packages/bot/.env.example`

OpenCorvus env keys:

- Required: `GOOGLECHAT_SERVICE_ACCOUNT_JSON`
- Optional: `GOOGLECHAT_WEBHOOK_HOST`, `GOOGLECHAT_WEBHOOK_PORT`, `GOOGLECHAT_WEBHOOK_PATH`
- Compatibility fallback: `OPENCLAW_GOOGLECHAT_SERVICE_ACCOUNT_JSON`

Runtime notes:

- `GOOGLECHAT_SERVICE_ACCOUNT_JSON` can be inline JSON or a file path.
- Adapter exposes local webhook endpoint and calls Google Chat API with JWT bearer token.
- Current adapter is text MVP for outbound media (image upload not implemented).

## Differences to keep explicit

- OpenClaw docs use `GOOGLE_CHAT_*` naming.
- OpenCorvus runtime uses `GOOGLECHAT_*` naming.
- OpenCorvus accepts JSON inline value directly; OpenClaw docs emphasize file path flow.

## Verification checklist

1. Start bot and confirm Google Chat webhook path is listening.
2. Send one message card/event into the bot and verify inbound handling.
3. Confirm outbound reply arrives in same space/thread.
4. If auth fails, validate service account JSON content and key formatting.

## Sources

- OpenClaw channels overview: https://docs.openclaw.ai/channels
- OpenClaw Google Chat docs: https://docs.openclaw.ai/channels/googlechat
- Google Chat app authentication docs: https://developers.google.com/workspace/chat/authenticate-authorize-chat-app
