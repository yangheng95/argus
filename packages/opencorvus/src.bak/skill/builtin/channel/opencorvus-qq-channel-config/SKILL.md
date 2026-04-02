---
name: opencorvus-qq-channel-config
description: Guide official QQ Bot setup for OpenCorvus, collect QQ bot credentials from the user, and write them into OpenCorvus after the user provides them. Use when tasks involve QQ bot credential retrieval, webhook setup, env wiring, or QQ runtime verification.
---

# OpenCorvus QQ Bot Channel Config

## Overview

Guide the user through the official QQ bot flow, stop for every provider-side action, and apply values to OpenCorvus only after the user pastes them.

## Workflow

1. Confirm mode.

- Default to overlay-guided setup in `Channel Config`.
- Offer text-guided fallback that writes to `packages/channel-runtime/.env`.
- Process one credential or webhook setting at a time and wait for explicit confirmation after each manual step.

2. Load references.

- Read `packages/opencorvus/src/skill/builtin/channel/opencorvus-channel-config-wizard/references/channel-matrix.md`.
- Use only the `QQ Bot` section and the official QQ URLs listed there.

3. Guide provider-side setup.

- Ask the user to open `q.qq.com`, create or open the bot application, and copy `AppID` and `AppSecret`.
- Ask whether they are still on sandbox traffic and capture `QQ_SANDBOX` only if needed.
- Ask whether OpenCorvus should host the inbound webhook listener.
- If webhook delivery is required, guide the user through callback URL configuration before runtime validation.

4. Apply OpenCorvus config.

- When the user pastes a value, write it immediately instead of asking them to edit files themselves.
- Overlay mode: set `QQ_BOT_APP_ID`, `QQ_BOT_APP_SECRET`, optional `QQ_SANDBOX`, and optional `QQ_WEBHOOK_*`, then click `Save Config`.
- Text fallback: update `packages/channel-runtime/.env` and keep unrelated keys unchanged.
- Redact secrets in summaries and confirmations.

5. Verify runtime.

- Confirm `packages/channel-runtime/src/main.ts` registers `QQAdapter`.
- Confirm `packages/channel-runtime/src/adapters/qq.ts` still uses webhook validation and the official OpenAPI host selection.
- Run `bun run --cwd packages/channel-runtime --no-env-file --env-file .env src/main.ts`.
- Send one QQ test message and confirm one reply.

6. Troubleshoot.

- If webhook validation fails, re-check the callback URL, signature flow, and `AppSecret`.
- If replies fail, re-check `AppID`, token issuance, and sandbox-vs-production selection.
- If events never arrive, re-check portal callback settings and webhook reachability.

## Guardrails

- Do not claim full automation for QQ login, app review, or console actions.
- Do not output real secrets.
- Keep edits minimal and localized to overlay env values or `packages/channel-runtime/.env` unless the user asks for code changes.

## Output Format

1. Mode and current provider step.
2. Required official page and exact manual action.
3. Values received and env keys updated.
4. Verification result.
5. Next blocker or completion status.
