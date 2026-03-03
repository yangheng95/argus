# OpenClaw and Slack Reference

## Snapshot

Research date: 2026-03-03.

OpenClaw Slack docs add a complete checklist for Socket Mode setup, event subscriptions, scopes, and troubleshooting.
Use those platform steps, then map runtime commands to OpenCorvus.

## OpenClaw Slack Checklist (Portable)

1. Enable Slack Socket Mode.
2. Create App-Level Token with `connections:write` (`xapp-...`).
3. Install app and copy Bot Token (`xoxb-...`).
4. Subscribe bot events:
- `app_mention`
- `message.channels`
- `message.groups`
- `message.im`
- `message.mpim`
5. Add required bot scopes for read and write behavior.

OpenClaw docs also note env fallback:
- `OPENCLAW_SLACK_APP_TOKEN` or `SLACK_APP_TOKEN`
- `OPENCLAW_SLACK_BOT_TOKEN` or `SLACK_BOT_TOKEN`
- `OPENCLAW_SLACK_SIGNING_SECRET` or `SLACK_SIGNING_SECRET`

## OpenCorvus Mapping

OpenCorvus source of truth:
- `packages/bot/src/main.ts`
- `packages/bot/src/adapters/slack.ts`
- `packages/bot/.env.example`

Set in `packages/bot/.env`:
- `SLACK_BOT_TOKEN`
- `SLACK_APP_TOKEN`
- `SLACK_SIGNING_SECRET` (optional in Socket Mode path)

Runtime checks:
- `main.ts` registers `SlackAdapter` when `SLACK_BOT_TOKEN` exists.
- `slack.ts` uses `socketMode: true`, threaded replies, and message dedupe by `message.ts`.

## Recommended Minimum Scopes

- `chat:write`
- `files:write`
- message read scopes needed for subscribed events in the target conversation types

## Sources

- OpenClaw Slack channels docs: https://docs.openclaw.ai/getting-started/channels/slack
- Slack Socket Mode docs: https://api.slack.com/apis/connections/socket
- Slack Events API docs: https://api.slack.com/apis/events-api
