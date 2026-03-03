# OpenClaw and Telegram Reference

## Snapshot

Research date: 2026-03-03.

OpenClaw Telegram docs provide a complete setup flow including bot token setup, group privacy mode, and common failures.
Use those platform steps, then map runtime commands to OpenCorvus.

## OpenClaw Telegram Checklist (Portable)

1. Create bot with BotFather (`/newbot`) and get token.
2. Set token in config or env.
3. For group chat support, disable privacy mode in BotFather (`/setprivacy` -> `Disable`) when full message visibility is needed.
4. Ensure bot is added to the target chat.

OpenClaw docs note env fallback:
- `OPENCLAW_TELEGRAM_BOT_TOKEN` or `TELEGRAM_BOT_TOKEN`

## OpenCorvus Mapping

OpenCorvus source of truth:
- `packages/bot/src/main.ts`
- `packages/bot/src/adapters/telegram.ts`
- `packages/bot/.env.example`

Set in `packages/bot/.env`:
- `TELEGRAM_BOT_TOKEN`

Runtime checks:
- `main.ts` registers `TelegramAdapter` when `TELEGRAM_BOT_TOKEN` exists.
- `telegram.ts` uses long polling (`bot.start()`), not webhook mode.
- `telegram.ts` supports text, voice, and audio and replies by message id threading.

## Verification Checklist

1. Start bot and confirm Telegram startup log appears.
2. Send one text message and confirm reply.
3. If needed, send one voice note and one audio file.

## Sources

- OpenClaw Telegram channels docs: https://docs.openclaw.ai/getting-started/channels/telegram
- Telegram bots docs (BotFather and setup): https://core.telegram.org/bots
- Telegram Bot API docs: https://core.telegram.org/bots/api
