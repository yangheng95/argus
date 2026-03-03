---
name: opencorvus-bot-config
description: Configure and troubleshoot OpenCorvus bot integrations for Slack, Telegram, and Feishu/Lark. Use when asked to set up bot tokens, environment variables, adapter wiring in packages/bot, bot startup commands, or message delivery debugging.
---

# OpenCorvus Bot Config

## Overview

Configure OpenCorvus bot adapters from source-of-truth files in `packages/bot`.
Deliver concrete setup steps, file edits, run commands, and a verification checklist.

## Workflow

1. Confirm scope.
- Confirm requested platform(s): Slack, Telegram, Feishu/Lark.
- Confirm whether the user wants configuration only or code changes.

2. Load references.
- Always read `references/quickstart.md`.
- Read `references/slack.md` when Slack is in scope.
- Read `references/telegram.md` when Telegram is in scope.
- Read `references/feishu.md` when Feishu/Lark is in scope.

3. Apply configuration.
- Update `packages/bot/.env` with required variables.
- Verify adapter registration in `packages/bot/src/main.ts`.
- For Feishu/Lark requests, use the path selected in `references/feishu.md`.

4. Validate runtime.
- Run `bun run --cwd packages/bot src/main.ts` from repo root, or run `bun dev`.
- Confirm startup logs for each configured adapter.
- Send one inbound test message and confirm one outbound reply.

5. Troubleshoot quickly.
- If startup exits with `No adapter configured`, check missing tokens.
- If inbound messages do not arrive, check platform subscriptions/webhook setup.
- If replies post in wrong thread, re-check channel and thread mapping for that adapter.

## Guardrails

- Do not claim built-in Feishu support unless `packages/bot/src/adapters/feishu.ts` exists and is imported in `packages/bot/src/main.ts`.
- Keep secrets masked in all output examples.
- Prefer minimal edits in `packages/bot/.env` and adapter wiring over broad refactors.

## Output Format

1. Summary of selected platform(s) and chosen setup path.
2. Required environment variables.
3. Exact file edits.
4. Run commands.
5. Verification and troubleshooting checklist.
