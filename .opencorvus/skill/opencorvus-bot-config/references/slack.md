# Slack Setup

## Required Environment Variables

- `SLACK_BOT_TOKEN` (`xoxb-...`)
- `SLACK_SIGNING_SECRET`
- `SLACK_APP_TOKEN` (`xapp-...`)

Set these in `packages/bot/.env`.

## Slack App Checklist

1. Create a Slack app and install it to the target workspace.
2. Enable Socket Mode.
3. Create an App-Level Token with `connections:write` and set it as `SLACK_APP_TOKEN`.
4. Add event subscriptions for bot messages, including:
- `message.channels`
- `message.im`
5. Reinstall app after scope/event changes.

## OpenCorvus Runtime Check

`packages/bot/src/main.ts` registers `SlackAdapter` only when `SLACK_BOT_TOKEN` exists.

`packages/bot/src/adapters/slack.ts` behavior to remember:
- Uses Socket Mode via `@slack/bolt`.
- Filters out bot self-messages.
- Uses `thread_ts` to reply in the same thread.
- Deduplicates duplicate Socket Mode message deliveries by `message.ts`.

## Common Failures

- `invalid_auth` or no replies:
  check `SLACK_BOT_TOKEN` and app installation.
- No incoming events:
  check Socket Mode, app-level token, and subscribed events.
- Replies fail for images:
  verify bot has file upload permission in Slack app scopes.
