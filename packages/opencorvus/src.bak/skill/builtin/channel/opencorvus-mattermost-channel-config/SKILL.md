---
name: opencorvus-mattermost-channel-config
description: Guide official Mattermost setup for OpenCorvus, collect Mattermost credentials from the user, and write them into OpenCorvus after the user provides them. Use when tasks involve Mattermost token retrieval, server setup, env wiring, or Mattermost runtime verification.
---

# OpenCorvus Mattermost Channel Config

## Overview

Guide the user through the official Mattermost admin and integration flow, stop for every provider-side action, and apply values to OpenCorvus only after the user pastes them.

## Workflow

1. Confirm mode.

- Default to overlay-guided setup in `Channel Config`.
- Offer text-guided fallback that writes to `packages/channel-runtime/.env`.
- Process one credential or webhook setting at a time and wait for explicit confirmation after each manual step.

2. Load references.

- Read `packages/opencorvus/src/skill/builtin/channel/opencorvus-channel-config-wizard/references/channel-matrix.md`.
- Use only the `Mattermost` section and the official Mattermost URLs listed there.

3. Guide provider-side setup.

- Ask the user for the Mattermost server URL first.
- Ask the user to create a bot account or a suitable personal access token according to their deployment policy.
- Ask the user to ensure the bot account can access the target channel or team.
- Ask for `MATTERMOST_WEBHOOK_*` only if listener overrides are needed.

4. Apply OpenCorvus config.

- When the user pastes a value, write it immediately instead of asking them to edit files themselves.
- Overlay mode: set `MATTERMOST_SERVER_URL`, `MATTERMOST_BOT_TOKEN`, and optional `MATTERMOST_WEBHOOK_*`, then click `Save Config`.
- Text fallback: update `packages/channel-runtime/.env` and keep unrelated keys unchanged.
- Redact secrets in summaries and confirmations.

5. Verify runtime.

- Confirm `packages/channel-runtime/src/main.ts` registers `MattermostAdapter`.
- Confirm `packages/channel-runtime/src/adapters/mattermost.ts` matches the chosen transport.
- Run `bun run --cwd packages/channel-runtime --no-env-file --env-file .env src/main.ts`.
- Send one inbound Mattermost message and confirm one reply.

6. Troubleshoot.

- If auth fails, re-check the server URL and token type.
- If replies fail, re-check bot membership and posting permissions.
- If events never arrive, re-check webhook delivery and transport logs.

## Guardrails

- Do not claim full automation for Mattermost admin login or bot-account creation.
- Do not output real secrets.
- Keep edits focused on overlay env values or `packages/channel-runtime/.env` unless the user asks for code changes.
- Do not claim parity features that the adapter does not implement.

## Output Format

1. Mode and current provider step.
2. Required official page and exact manual action.
3. Values received and env keys updated.
4. Verification result.
5. Next blocker or completion status.
