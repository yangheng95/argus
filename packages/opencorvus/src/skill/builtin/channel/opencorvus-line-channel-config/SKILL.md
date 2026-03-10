---
name: opencorvus-line-channel-config
description: Guide official LINE Messaging API setup for OpenCorvus, collect LINE credentials from the user, and write them into OpenCorvus after the user provides them. Use when tasks involve LINE token retrieval, webhook setup, env wiring, or LINE runtime verification.
---

# OpenCorvus LINE Channel Config

## Overview

Guide the user through the official LINE Developers Console, stop for every provider-side action, and apply values to OpenCorvus only after the user pastes them.

## Workflow

1. Confirm mode.

- Default to overlay-guided setup in `Channel Config`.
- Offer text-guided fallback that writes to `packages/channel-runtime/.env`.
- Process one credential or webhook setting at a time and wait for explicit confirmation after each manual step.

2. Load references.

- Read `packages/opencorvus/src/skill/builtin/channel/opencorvus-channel-config-wizard/references/channel-matrix.md`.
- Use only the `LINE` section and the official LINE URLs listed there.

3. Guide provider-side setup.

- Ask the user to open the LINE Developers Console and the target Messaging API channel.
- Ask the user to issue or copy the channel access token.
- Ask for `LINE_CHANNEL_SECRET` only if webhook signature verification is enabled.
- If inbound delivery is required, guide the user through webhook URL registration before runtime validation.

4. Apply OpenCorvus config.

- When the user pastes a value, write it immediately instead of asking them to edit files themselves.
- Overlay mode: set `LINE_CHANNEL_ACCESS_TOKEN`, optional `LINE_CHANNEL_SECRET`, and optional `LINE_WEBHOOK_*`, then click `Save Config`.
- Text fallback: update `packages/channel-runtime/.env` and keep unrelated keys unchanged.
- Redact secrets in summaries and confirmations.

5. Verify runtime.

- Confirm `packages/channel-runtime/src/main.ts` registers `LineAdapter`.
- Confirm `packages/channel-runtime/src/adapters/line.ts` matches the chosen webhook flow.
- Run `bun run --cwd packages/channel-runtime --no-env-file --env-file .env src/main.ts`.
- Send one inbound LINE message and confirm one reply.

6. Troubleshoot.

- If callback verification fails, re-check the channel secret and registered webhook URL.
- If replies fail, re-check the channel access token and bot channel configuration.
- If events never arrive, re-check webhook delivery and transport logs.

## Guardrails

- Do not claim full automation for LINE login, channel creation, or approval steps.
- Do not output real secrets.
- Keep edits focused on overlay env values or `packages/channel-runtime/.env` unless the user asks for code changes.
- Do not claim parity features that the adapter does not implement.

## Output Format

1. Mode and current provider step.
2. Required official page and exact manual action.
3. Values received and env keys updated.
4. Verification result.
5. Next blocker or completion status.
