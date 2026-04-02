---
name: opencorvus-discord-channel-config
description: Guide official Discord bot setup for OpenCorvus, collect the bot token from the user, and write it into OpenCorvus after the user provides it. Use when tasks involve Discord token retrieval, privileged intent setup, env wiring, or Discord runtime verification.
---

# OpenCorvus Discord Channel Config

## Overview

Guide the user through the official Discord developer flow, stop for every provider-side action, and apply values to OpenCorvus only after the user pastes them.

## Workflow

1. Confirm mode.

- Default to overlay-guided setup in `Channel Config`.
- Offer text-guided fallback that writes to `packages/channel-runtime/.env`.
- Process one credential or portal setting at a time and wait for explicit confirmation after each manual step.

2. Load references.

- Read `packages/opencorvus/src/skill/builtin/channel/opencorvus-channel-config-wizard/references/channel-matrix.md`.
- Use only the `Discord` section and the official Discord URLs listed there.

3. Guide provider-side setup.

- Ask the user to open the Discord Developer Portal and create or open the application.
- Ask the user to open the `Bot` page, reset the token if needed, and copy it once.
- Ask the user to enable `Message Content Intent` before validation because the current adapter requests it.
- Ask the user to invite the bot to a server or prepare a DM for testing.

4. Apply OpenCorvus config.

- When the user pastes `DISCORD_BOT_TOKEN`, write it immediately instead of asking them to edit files themselves.
- Overlay mode: set `DISCORD_BOT_TOKEN`, then click `Save Config`.
- Text fallback: update `packages/channel-runtime/.env` and keep unrelated keys unchanged.
- Redact the token in summaries and confirmations.

5. Verify runtime.

- Confirm `packages/channel-runtime/src/main.ts` registers `DiscordAdapter`.
- Confirm `packages/channel-runtime/src/adapters/discord.ts` still requests `MessageContent`, `GuildMessages`, and `DirectMessages`.
- Run `bun run --cwd packages/channel-runtime --no-env-file --env-file .env src/main.ts`.
- Send one Discord message and confirm one reply.

6. Troubleshoot.

- If login fails, re-check the bot token and whether it was regenerated.
- If no messages arrive, re-check `Message Content Intent`, bot installation, and target channel permissions.
- If replies fail in threads, re-check server permissions and target channel type.

## Guardrails

- Do not claim full automation for Discord login, bot creation, or guild installation.
- Do not output real tokens.
- Keep edits minimal and localized to overlay env values or `packages/channel-runtime/.env` unless the user asks for code changes.

## Output Format

1. Mode and current provider step.
2. Required official page and exact manual action.
3. Values received and env keys updated.
4. Verification result.
5. Next blocker or completion status.
