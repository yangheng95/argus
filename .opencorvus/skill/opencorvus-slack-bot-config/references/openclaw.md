# OpenClaw and Slack Reference

## Snapshot

Research date: 2026-03-03.

## Verified OpenClaw facts

- OpenClaw marks Slack as a stable channel on the chat channels page.
- The Slack guide uses Socket Mode as the default path.
- Socket Mode requires app-level token (`xapp-...`) and bot token (`xoxb-...`).
- HTTP Events API is optional and needs signing secret plus public webhook URL.
- OpenClaw docs provide both `openclaw channels add` and `openclaw channels update` flows.

## OpenCorvus mapping

OpenCorvus source of truth:
- `packages/bot/src/registry.ts`
- `packages/bot/src/adapters/slack.ts`
- `packages/bot/.env.example`

OpenCorvus env keys:
- Required: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`
- Optional: `SLACK_SIGNING_SECRET`
- Compatibility fallback: `OPENCLAW_SLACK_BOT_TOKEN`, `OPENCLAW_SLACK_APP_TOKEN`, `OPENCLAW_SLACK_SIGNING_SECRET`

Runtime notes:
- `SlackAdapter` runs Socket Mode (`socketMode: true`).
- Replies are sent as thread replies (`thread_ts`).
- Adapter deduplicates repeated message events by `message.ts`.

## Differences to keep explicit

- OpenClaw documents both Socket Mode and HTTP Events mode.
- OpenCorvus implementation is Socket Mode centric; HTTP webhook mode is not the primary path in current adapter code.

## Verification checklist

1. Start bot and confirm Slack adapter is registered.
2. Send one DM and one channel message; confirm one reply each.
3. Confirm no duplicated replies for a single message event.
4. If startup fails, re-check `xapp` and `xoxb` token placement.

## Sources

- OpenClaw channels overview: https://docs.openclaw.ai/channels
- OpenClaw Slack channel docs: https://docs.openclaw.ai/channels/slack
- Slack Socket Mode docs: https://api.slack.com/apis/connections/socket
- Slack Events API docs: https://api.slack.com/apis/events-api
