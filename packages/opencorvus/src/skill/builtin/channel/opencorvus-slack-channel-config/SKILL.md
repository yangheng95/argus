---
name: opencorvus-slack-channel-config
description: Guide official Slack app setup for OpenCorvus, collect Slack bot credentials from the user, and write them into OpenCorvus after the user provides them. Use when tasks involve Slack token retrieval, Socket Mode, env wiring, or Slack runtime verification.
---

# OpenCorvus Slack Channel Config

## Overview

Guide the user through the official Slack flow, stop for every provider-side action, and apply values to OpenCorvus only after the user pastes them.

## Workflow

1. Confirm mode.

- Default to overlay-guided setup in `Channel Config`.
- Offer text-guided fallback that writes to `packages/channel-runtime/.env`.
- Process one provider credential at a time and wait for explicit confirmation after each manual step.

2. Load references.

- Read `packages/opencorvus/src/skill/builtin/channel/opencorvus-channel-config-wizard/references/channel-matrix.md`.
- Use only the `Slack` section and the official Slack URLs listed there.

3. Guide provider-side setup.

- Ask the user to create or open the Slack app from the official portal.
- Ask the user to enable Socket Mode.
- Ask the user to install the app to the workspace and copy the `xoxb-` bot token.
- Ask the user to generate the `xapp-` app token with the `connections:write` scope.
- Ask for `SLACK_SIGNING_SECRET` only if they want HTTP verification flow instead of Socket Mode.

4. Apply OpenCorvus config.

- When the user pastes a value, write it immediately instead of asking them to edit files themselves.
- Overlay mode: set `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, and optional `SLACK_SIGNING_SECRET`, then click `Save Config`.
- Text fallback: update `packages/channel-runtime/.env` and keep unrelated keys unchanged.
- Redact secrets in summaries and confirmations.

5. Verify runtime.

- Confirm `packages/channel-runtime/src/main.ts` registers `SlackAdapter`.
- Confirm `packages/channel-runtime/src/adapters/slack.ts` still uses Socket Mode.
- Run `bun run --cwd packages/channel-runtime --no-env-file --env-file .env src/main.ts`.
- Send one inbound Slack message and confirm one threaded reply.

6. Troubleshoot.

- If events do not arrive, re-check Socket Mode, bot event subscriptions, and app scopes.
- If token generation fails, re-check app installation and workspace permissions.
- If duplicate replies appear, inspect Slack thread dedupe behavior by message timestamp.

## Guardrails

- Do not claim full automation for Slack login, app installation, or admin approval.
- Do not output real secrets.
- Do not instruct webhook URL setup for Socket Mode-only requests unless the user explicitly asks for HTTP mode.
- Keep edits minimal and localized to overlay env values or `packages/channel-runtime/.env` unless the user asks for code changes.

## Output Format

1. Mode and current provider step.
2. Required official page and exact manual action.
3. Values received and env keys updated.
4. Verification result.
5. Next blocker or completion status.
