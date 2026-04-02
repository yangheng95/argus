---
name: opencorvus-whatsapp-channel-config
description: Guide official WhatsApp Cloud API setup for OpenCorvus, collect WhatsApp credentials from the user, and write them into OpenCorvus after the user provides them. Use when tasks involve WHATSAPP_* credential retrieval, webhook setup, env wiring, or WhatsApp runtime verification.
---

# OpenCorvus WhatsApp Channel Config

## Overview

Guide the user through the official Meta and WhatsApp setup flow, stop for every provider-side action, and apply values to OpenCorvus only after the user pastes them.

## Workflow

1. Confirm mode.

- Default to overlay-guided setup in `Channel Config`.
- Offer text-guided fallback that writes to `packages/channel-runtime/.env`.
- Process one credential or webhook setting at a time and wait for explicit confirmation after each manual step.

2. Load references.

- Read `packages/opencorvus/src/skill/builtin/channel/opencorvus-channel-config-wizard/references/channel-matrix.md`.
- Use only the `WhatsApp` section and the official Meta URLs listed there.

3. Guide provider-side setup.

- Ask the user to create or open the Meta app with the WhatsApp product enabled.
- Ask the user to copy the access token and `Phone Number ID`.
- Ask whether they are using a temporary token, embedded signup, or a permanent token path.
- Ask for `WHATSAPP_VERIFY_TOKEN` only if webhook verification is enabled.
- If inbound delivery is required, guide the user through webhook callback registration before runtime validation.

4. Apply OpenCorvus config.

- When the user pastes a value, write it immediately instead of asking them to edit files themselves.
- Overlay mode: set `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, optional `WHATSAPP_VERIFY_TOKEN`, and optional `WHATSAPP_WEBHOOK_*`, then click `Save Config`.
- Text fallback: update `packages/channel-runtime/.env` and keep unrelated keys unchanged.
- Redact secrets in summaries and confirmations.

5. Verify runtime.

- Confirm `packages/channel-runtime/src/main.ts` registers `WhatsappAdapter`.
- Confirm `packages/channel-runtime/src/adapters/whatsapp.ts` matches the chosen webhook flow.
- Run `bun run --cwd packages/channel-runtime --no-env-file --env-file .env src/main.ts`.
- Send one inbound WhatsApp message and confirm one reply.

6. Troubleshoot.

- If callback verification fails, re-check the verify token and registered webhook URL.
- If replies fail, re-check the access token, phone number status, and app permissions.
- If events never arrive, re-check Meta webhook subscriptions and transport logs.

## Guardrails

- Do not claim full automation for Meta login, business verification, or app review.
- Do not output real secrets.
- Keep edits focused on overlay env values or `packages/channel-runtime/.env` unless the user asks for code changes.
- Do not claim parity features that the adapter does not implement.

## Output Format

1. Mode and current provider step.
2. Required official page and exact manual action.
3. Values received and env keys updated.
4. Verification result.
5. Next blocker or completion status.
