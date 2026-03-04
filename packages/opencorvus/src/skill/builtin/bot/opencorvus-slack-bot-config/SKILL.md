---
name: opencorvus-slack-bot-config
description: Configure and troubleshoot Slack bot integration for OpenCorvus. Use when tasks involve Slack Socket Mode setup, Slack tokens, event subscriptions, updates to packages/bot/.env, adapter wiring in packages/bot/src/main.ts, or Slack message delivery debugging.
---

# OpenCorvus Slack Bot Config

## Overview

Configure Slack for OpenCorvus using a verified checklist from OpenClaw channel docs and Slack official Socket Mode docs.
Map platform setup steps to the OpenCorvus bot runtime in `packages/bot`.

## Workflow

## Interaction Mode

- Default to screen-guided flow.
- Ask the user to open the platform admin page, then advance one step at a time.
- After each manual portal action, pause and wait for explicit user confirmation before continuing.
- Offer a text-guided fallback at any time (copy-paste checklist with URLs and exact fields).
- If desktop confirmation is unavailable, switch to text-guided fallback and continue.
1. Confirm scope.
- Confirm this task targets OpenCorvus (`packages/bot`) and not OpenClaw CLI runtime.
- If user is on OpenClaw runtime, use the OpenClaw commands in the reference as-is.

2. Load checklist.
- Read `references/openclaw.md`.

3. Configure Slack app and environment.
- Ensure Socket Mode is enabled.
- Ensure `xapp` and `xoxb` tokens are created and copied.
- Set `SLACK_APP_TOKEN` and `SLACK_BOT_TOKEN` in `packages/bot/.env`.
- Set `SLACK_SIGNING_SECRET` if HTTP mode is requested.

4. Verify OpenCorvus wiring.
- Confirm `packages/bot/src/main.ts` registers `SlackAdapter` when `SLACK_BOT_TOKEN` is present.
- Confirm `packages/bot/src/adapters/slack.ts` still uses Socket Mode and thread replies.

5. Validate runtime.
- Run `bun run --cwd packages/bot src/main.ts` or `bun dev`.
- Send one inbound Slack message.
- Confirm one threaded reply.
- If image output is expected, confirm upload works.

6. Troubleshoot.
- If startup fails, re-check token values and app installation.
- If events do not arrive, re-check subscribed bot events and app scopes.
- If duplicate replies appear, inspect dedupe behavior by message timestamp.

## Guardrails

- Separate verified OpenClaw facts from OpenCorvus mapping and label inference explicitly.
- Do not output real secrets.
- Do not instruct webhook URL setup for Socket Mode-only requests unless user asks for HTTP mode.
- Keep edits minimal and localized to env files and Slack adapter wiring.

## Output Format

1. Setup summary.
2. Required Slack settings and env vars.
3. Exact file edits.
4. Run commands.
5. Verification and troubleshooting checklist.

