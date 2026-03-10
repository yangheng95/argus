---
name: opencorvus-googlechat-channel-config
description: Guide official Google Chat app setup for OpenCorvus, collect Google Chat credentials from the user, and write them into OpenCorvus after the user provides them. Use when tasks involve service-account setup, GOOGLECHAT_* env wiring, or Google Chat runtime verification.
---

# OpenCorvus Google Chat Channel Config

## Overview

Guide the user through the official Google Cloud and Google Chat flow, stop for every provider-side action, and apply values to OpenCorvus only after the user pastes them.

## Workflow

1. Confirm mode.

- Default to overlay-guided setup in `Channel Config`.
- Offer text-guided fallback that writes to `packages/channel-runtime/.env`.
- Process one credential or webhook setting at a time and wait for explicit confirmation after each manual step.

2. Load references.

- Read `packages/opencorvus/src/skill/builtin/channel/opencorvus-channel-config-wizard/references/channel-matrix.md`.
- Use only the `Google Chat` section and the official Google URLs listed there.

3. Guide provider-side setup.

- Ask the user to open the Google Cloud project and Google Chat app configuration.
- Ask the user to authenticate the Chat app as the app with a service account.
- Prefer asking for the downloaded service-account JSON file path.
- If the user pastes raw JSON instead, accept it and write it safely to `GOOGLECHAT_SERVICE_ACCOUNT_JSON`.
- Ask for `GOOGLECHAT_WEBHOOK_*` only if listener overrides are needed.

4. Apply OpenCorvus config.

- When the user pastes a value, write it immediately instead of asking them to edit files themselves.
- Overlay mode: set `GOOGLECHAT_SERVICE_ACCOUNT_JSON` and optional `GOOGLECHAT_WEBHOOK_*`, then click `Save Config`.
- Text fallback: update `packages/channel-runtime/.env` and keep unrelated keys unchanged.
- Redact secrets in summaries and confirmations.

5. Verify runtime.

- Confirm `packages/channel-runtime/src/main.ts` registers `GoogleChatAdapter`.
- Confirm `packages/channel-runtime/src/adapters/googlechat.ts` accepts the provided JSON or file path.
- Run `bun run --cwd packages/channel-runtime --no-env-file --env-file .env src/main.ts`.
- Send one inbound Google Chat message and confirm one reply.

6. Troubleshoot.

- If startup fails, re-check that the service-account JSON is valid and not truncated.
- If messages never arrive, re-check Chat app publication, event configuration, and space membership.
- If replies fail, re-check IAM permissions and transport logs.

## Guardrails

- Do not claim full automation for Google Cloud login, service-account creation, or domain admin approval.
- Do not output real secrets.
- Keep edits focused on overlay env values or `packages/channel-runtime/.env` unless the user asks for code changes.
- Do not claim parity features that the adapter does not implement.

## Output Format

1. Mode and current provider step.
2. Required official page and exact manual action.
3. Values received and env keys updated.
4. Verification result.
5. Next blocker or completion status.
