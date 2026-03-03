---
name: opencorvus-telegram-bot-config
description: Configure and troubleshoot Telegram bot integration for OpenCorvus. Use when tasks involve BotFather token setup, privacy mode decisions, updates to TELEGRAM_BOT_TOKEN in packages/bot/.env, Telegram adapter checks in packages/bot/src/main.ts, or Telegram message delivery debugging.
---

# OpenCorvus Telegram Bot Config

## Overview

Configure Telegram for OpenCorvus using OpenClaw channel guidance and Telegram official bot docs.
Map platform setup to the OpenCorvus long-polling adapter in `packages/bot`.

## Workflow

1. Confirm scope.
- Confirm this task targets OpenCorvus (`packages/bot`) and not OpenClaw CLI runtime.
- If user is on OpenClaw runtime, use the OpenClaw commands from the reference directly.

2. Load checklist.
- Read `references/openclaw.md`.

3. Configure Telegram bot and environment.
- Create bot token via BotFather.
- Set `TELEGRAM_BOT_TOKEN` in `packages/bot/.env`.
- For group usage, decide privacy mode and set it via BotFather if needed.

4. Verify OpenCorvus wiring.
- Confirm `packages/bot/src/main.ts` registers `TelegramAdapter` when `TELEGRAM_BOT_TOKEN` exists.
- Confirm `packages/bot/src/adapters/telegram.ts` uses long polling and reply-thread mapping.

5. Validate runtime.
- Run `bun run --cwd packages/bot src/main.ts` or `bun dev`.
- Send one Telegram message and confirm one reply.
- If voice/audio support is needed, test one voice note and one audio file.

6. Troubleshoot.
- If no events arrive in groups, re-check privacy mode and bot membership.
- If replies fail, re-check token and chat permissions.
- If audio fails, inspect Telegram file download errors.

## Guardrails

- Separate verified OpenClaw facts from OpenCorvus mapping and label inference explicitly.
- Do not output real tokens.
- Do not suggest webhook-only setup for OpenCorvus unless user explicitly asks for webhook mode.
- Keep edits minimal and focused on env and adapter wiring.

## Output Format

1. Setup summary.
2. Required Telegram settings and env vars.
3. Exact file edits.
4. Run commands.
5. Verification and troubleshooting checklist.

