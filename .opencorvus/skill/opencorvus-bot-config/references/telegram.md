# Telegram Setup

## Required Environment Variables

- `TELEGRAM_BOT_TOKEN`

Set this in `packages/bot/.env`.

## Telegram Checklist

1. Create bot token via `@BotFather` (`/newbot`).
2. Add bot to the target chat/group.
3. If group messages are needed, disable privacy mode in `@BotFather` (`/setprivacy` -> `Disable`).
4. Start bot with `bun run --cwd packages/bot src/main.ts`.

## OpenCorvus Runtime Check

`packages/bot/src/main.ts` registers `TelegramAdapter` only when `TELEGRAM_BOT_TOKEN` exists.

`packages/bot/src/adapters/telegram.ts` behavior to remember:
- Uses long polling (`bot.start()`), no webhook config required.
- Handles text, voice, and audio messages.
- Replies by `reply_parameters.message_id` to keep threading.
- Downloads uploaded voice/audio files from Telegram file API.

## Common Failures

- Bot receives nothing in group:
  privacy mode is still enabled or bot lacks chat access.
- Startup ok but no replies:
  wrong `TELEGRAM_BOT_TOKEN` or bot removed from chat.
- Audio handling fails:
  Telegram file download call failed or timed out.
