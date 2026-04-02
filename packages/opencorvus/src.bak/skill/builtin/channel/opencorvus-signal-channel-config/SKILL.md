---
name: opencorvus-signal-channel-config
description: Guide Signal channel setup for OpenCorvus, collect the service endpoint details from the user, and write them into OpenCorvus after the user provides them. Use when tasks involve signal-cli-rest-api setup, SIGNAL_* env wiring, or Signal runtime verification.
---

# OpenCorvus Signal Channel Config

## Overview

Guide the user through the current Signal integration path, stop for every provider-side action, and apply values to OpenCorvus only after the user pastes them.

## Workflow

1. Confirm mode.

- Default to overlay-guided setup in `Channel Config`.
- Offer text-guided fallback that writes to `packages/channel-runtime/.env`.
- Process one service value at a time and wait for explicit confirmation after each manual step.

2. Load references.

- Read `packages/opencorvus/src/skill/builtin/channel/opencorvus-channel-config-wizard/references/channel-matrix.md`.
- Use only the `Signal` section and the linked `signal-cli-rest-api` and `signal-cli` sources listed there.

3. Guide provider-side setup.

- Tell the user this integration does not use an official Signal bot token flow.
- Ask the user to deploy or reach an existing `signal-cli-rest-api` service.
- Ask the user to register or link the Signal account that OpenCorvus will send from.
- Ask the user to paste `SIGNAL_SERVICE_URL` and `SIGNAL_ACCOUNT`.

4. Apply OpenCorvus config.

- When the user pastes a value, write it immediately instead of asking them to edit files themselves.
- Overlay mode: set `SIGNAL_SERVICE_URL` and `SIGNAL_ACCOUNT`, then click `Save Config`.
- Text fallback: update `packages/channel-runtime/.env` and keep unrelated keys unchanged.
- Redact sensitive values in summaries and confirmations.

5. Verify runtime.

- Confirm `packages/channel-runtime/src/main.ts` registers `SignalAdapter`.
- Confirm `packages/channel-runtime/src/adapters/signal.ts` targets the provided service endpoint.
- Run `bun run --cwd packages/channel-runtime --no-env-file --env-file .env src/main.ts`.
- Send one inbound Signal message and confirm one reply.

6. Troubleshoot.

- If startup fails, re-check that the REST API is reachable from OpenCorvus.
- If replies fail, re-check Signal account registration and service auth settings.
- If inbound events never arrive, re-check the signal-cli-rest-api listener configuration.

## Guardrails

- Do not claim full automation for Signal account registration or QR pairing.
- Do not imply that OpenCorvus can fetch an official Signal bot token because this integration does not use one.
- Do not output real secrets.
- Keep edits focused on overlay env values or `packages/channel-runtime/.env` unless the user asks for code changes.
- Do not claim parity features that the adapter does not implement.

## Output Format

1. Mode and current provider step.
2. Required official or project page and exact manual action.
3. Values received and env keys updated.
4. Verification result.
5. Next blocker or completion status.
