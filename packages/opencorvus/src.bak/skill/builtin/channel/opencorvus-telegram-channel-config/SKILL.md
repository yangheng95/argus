---
name: opencorvus-telegram-channel-config
description: Guide official Telegram bot setup for OpenCorvus, collect the bot token from the user, and write it into OpenCorvus after the user provides it. Use when tasks involve BotFather token retrieval, privacy mode decisions, env wiring, or Telegram runtime verification.
---

# OpenCorvus Telegram Channel Config

## Overview

Guide the user through the official Telegram flow, stop for every BotFather or chat-admin action, and apply values to OpenCorvus only after the user pastes them.

## Workflow

1. Confirm mode.

- Default to overlay-guided setup in `Channel Config`.
- Offer text-guided fallback that writes to `packages/channel-runtime/.env`.
- Process one credential or chat setting at a time and wait for explicit confirmation after each manual step.

2. Load references.

- Read `packages/opencorvus/src/skill/builtin/channel/opencorvus-channel-config-wizard/references/channel-matrix.md`.
- Use only the `Telegram` section and the official Telegram URLs listed there.

3. Guide provider-side setup.

- Ask the user to open `@BotFather`, create or open the bot, and copy the HTTP API token.
- Ask the user whether the bot must work in groups.
- If group support is required, guide the user through Telegram privacy-mode choice before testing.
- Ask the user to add the bot to the target private chat or group before validation.

4. Apply OpenCorvus config.

- When the user pastes `TELEGRAM_BOT_TOKEN`, write it immediately instead of asking them to edit files themselves.
- Overlay mode: set `TELEGRAM_BOT_TOKEN`, then click `Save Config`.
- Text fallback: update `packages/channel-runtime/.env` and keep unrelated keys unchanged.
- Redact the token in summaries and confirmations.

5. Verify runtime.

- Confirm `packages/channel-runtime/src/main.ts` registers `TelegramAdapter`.
- Confirm `packages/channel-runtime/src/adapters/telegram.ts` still uses long polling.
- Run `bun run --cwd packages/channel-runtime --no-env-file --env-file .env src/main.ts`.
- Send one text message and confirm one reply.
- If audio support is required, test one voice note and one audio file.

6. Troubleshoot.

- If no events arrive in groups, re-check privacy mode and bot membership.
- If replies fail, re-check the token and target chat permissions.
- If media handling fails, inspect Telegram file download errors.

## Guardrails

- Do not claim full automation for Telegram login or BotFather actions.
- Do not output real tokens.
- Do not suggest webhook-only setup for OpenCorvus unless the user explicitly asks for webhook mode.
- Keep edits minimal and localized to overlay env values or `packages/channel-runtime/.env` unless the user asks for code changes.

## Output Format

1. Mode and current provider step.
2. Required official page and exact manual action.
3. Values received and env keys updated.
4. Verification result.
5. Next blocker or completion status.
