---
name: opencorvus-msteams-channel-config
description: Guide official Microsoft Teams bot setup for OpenCorvus, collect Microsoft credentials from the user, and write them into OpenCorvus after the user provides them. Use when tasks involve Teams bot registration, MSTEAMS_* env wiring, or Microsoft Teams runtime verification.
---

# OpenCorvus Microsoft Teams Channel Config

## Overview

Guide the user through the official Azure and Microsoft Teams flow, stop for every provider-side action, and apply values to OpenCorvus only after the user pastes them.

## Workflow

1. Confirm mode.

- Default to overlay-guided setup in `Channel Config`.
- Offer text-guided fallback that writes to `packages/channel-runtime/.env`.
- Process one credential or webhook setting at a time and wait for explicit confirmation after each manual step.

2. Load references.

- Read `packages/opencorvus/src/skill/builtin/channel/opencorvus-channel-config-wizard/references/channel-matrix.md`.
- Use only the `Microsoft Teams` section and the official Microsoft URLs listed there.

3. Guide provider-side setup.

- Ask the user to open Azure and the Teams bot documentation.
- Ask the user to create or open the app registration or bot registration and copy the Application ID.
- Ask the user to create a client secret and copy it once.
- Ask whether inbound callback settings must be overridden through `MSTEAMS_WEBHOOK_*`.
- Ask the user to install or test the bot in a Teams chat before validation.

4. Apply OpenCorvus config.

- When the user pastes a value, write it immediately instead of asking them to edit files themselves.
- Overlay mode: set `MSTEAMS_APP_ID`, `MSTEAMS_APP_SECRET`, and optional `MSTEAMS_WEBHOOK_*`, then click `Save Config`.
- Text fallback: update `packages/channel-runtime/.env` and keep unrelated keys unchanged.
- Redact secrets in summaries and confirmations.

5. Verify runtime.

- Confirm `packages/channel-runtime/src/main.ts` registers `MSTeamsAdapter`.
- Confirm `packages/channel-runtime/src/adapters/msteams.ts` matches the chosen transport.
- Run `bun run --cwd packages/channel-runtime --no-env-file --env-file .env src/main.ts`.
- Send one inbound Teams message and confirm one reply.

6. Troubleshoot.

- If callback verification fails, re-check the messaging endpoint and Azure registration.
- If replies fail, re-check the Application ID, client secret, and bot installation scope.
- If events never arrive, re-check Teams app permissions and transport logs.

## Guardrails

- Do not claim full automation for Azure login, app registration, or tenant admin approval.
- Do not output real secrets.
- Keep edits focused on overlay env values or `packages/channel-runtime/.env` unless the user asks for code changes.
- Do not claim parity features that the adapter does not implement.

## Output Format

1. Mode and current provider step.
2. Required official page and exact manual action.
3. Values received and env keys updated.
4. Verification result.
5. Next blocker or completion status.
