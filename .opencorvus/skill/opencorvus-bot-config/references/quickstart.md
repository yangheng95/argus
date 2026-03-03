# Bot Quickstart

## Source of Truth

- `packages/bot/.env.example`
- `packages/bot/src/main.ts`
- `packages/bot/src/adapters/slack.ts`
- `packages/bot/src/adapters/telegram.ts`

As of 2026-03-03, built-in adapters in `main.ts` are Slack, Telegram, and Discord.
Feishu/Lark is not registered by default.

## Baseline Setup

1. Copy the environment template.

```bash
cp packages/bot/.env.example packages/bot/.env
```

2. Fill required tokens for the requested platform(s).
3. Start the bot from repo root.

```bash
bun run --cwd packages/bot src/main.ts
```

Alternative entrypoint:

```bash
bun dev
```

4. Validate startup logs.
- Slack should print `[Slack] Bot user ID: ...`.
- Telegram should print `[Telegram] Bot started (long polling)`.
- If no adapter tokens are set, process exits with:
  `No adapter configured. Set SLACK_BOT_TOKEN, TELEGRAM_BOT_TOKEN, or DISCORD_BOT_TOKEN.`

## Minimal Verification

1. Send one text message to the bot.
2. Confirm the bot replies in the same thread/reply chain.
3. If image generation is used, confirm image upload works.
