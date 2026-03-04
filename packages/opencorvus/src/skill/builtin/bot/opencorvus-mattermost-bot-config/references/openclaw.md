# OpenClaw and Mattermost Reference

## Snapshot

Research date: 2026-03-03.

## Verified OpenClaw facts

- OpenClaw marks Mattermost as experimental.
- Mattermost channel is plugin-based in OpenClaw.
- Docs require bot token and server URL.
- Docs include webhook path guidance for inbound events.
- Docs use env naming with `MATTERMOST_URL` and `MATTERMOST_BOT_TOKEN`.

## OpenCorvus mapping

OpenCorvus source of truth:

- `packages/bot/src/registry.ts`
- `packages/bot/src/adapters/mattermost.ts`
- `packages/bot/.env.example`

OpenCorvus env keys:

- Required: `MATTERMOST_SERVER_URL`, `MATTERMOST_BOT_TOKEN`
- Optional: `MATTERMOST_WEBHOOK_HOST`, `MATTERMOST_WEBHOOK_PORT`, `MATTERMOST_WEBHOOK_PATH`
- Compatibility fallback: `OPENCLAW_MATTERMOST_SERVER_URL`, `OPENCLAW_MATTERMOST_BOT_TOKEN`

Runtime notes:

- Adapter exposes webhook endpoint and accepts JSON or form payload.
- Outbound send uses Mattermost `/api/v4/posts`.
- Outbound image is supported through `/api/v4/files` upload.

## Differences to keep explicit

- OpenClaw docs use `MATTERMOST_URL` naming.
- OpenCorvus uses `MATTERMOST_SERVER_URL` naming.

## Verification checklist

1. Start bot and confirm Mattermost webhook endpoint is listening.
2. Send one inbound message from Mattermost and confirm one reply.
3. Verify bot token can create posts in target channel.
4. Optional: verify image upload path.

## Sources

- OpenClaw channels overview: https://docs.openclaw.ai/channels
- OpenClaw Mattermost docs: https://docs.openclaw.ai/channels/mattermost
- Mattermost REST API docs: https://developers.mattermost.com/integrate/reference/rest-api/
