# OpenClaw and Telegram Reference

## Snapshot

Research date: 2026-03-03.

## Verified OpenClaw facts

- OpenClaw marks Telegram as a stable channel.
- Default transport in docs is long polling; webhook mode is optional.
- Telegram setup is based on BotFather token creation.
- Docs call out group privacy mode and bot permission checks for group usage.
- Docs use `TELEGRAM_BOT_TOKEN` for configuration.

## OpenCorvus mapping

OpenCorvus source of truth:
- `packages/bot/src/registry.ts`
- `packages/bot/src/adapters/telegram.ts`
- `packages/bot/.env.example`

OpenCorvus env keys:
- Required: `TELEGRAM_BOT_TOKEN`
- Compatibility fallback: `OPENCLAW_TELEGRAM_BOT_TOKEN`

Runtime notes:
- `TelegramAdapter` uses long polling (`bot.start()`).
- Adapter supports text, voice note, and audio attachment input.
- Replies use Telegram reply parameters for thread-like behavior.

## Differences to keep explicit

- OpenClaw documents optional webhook mode.
- Current OpenCorvus adapter is long polling only and does not expose webhook configuration.

## Verification checklist

1. Start bot and confirm Telegram adapter registration.
2. Send one text message and confirm reply.
3. Optional: send voice note/audio and confirm STT path works.
4. If group messages are missing, re-check BotFather privacy mode.

## Sources

- OpenClaw channels overview: https://docs.openclaw.ai/channels
- OpenClaw Telegram channel docs: https://docs.openclaw.ai/channels/telegram
- Telegram docs: https://core.telegram.org/bots
- Telegram Bot API: https://core.telegram.org/bots/api
