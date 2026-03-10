---
name: opencorvus-dingtalk-channel-config
description: Guide official DingTalk app setup for OpenCorvus, collect DingTalk credentials from the user, and write them into OpenCorvus after the user provides them. Use when tasks involve DingTalk credential retrieval, DINGTALK_* env wiring, or DingTalk runtime verification.
---

# OpenCorvus DingTalk Channel Config

## Overview

Guide the user through the official DingTalk developer flow, stop for every provider-side action, and apply values to OpenCorvus only after the user pastes them.

## Workflow

1. Confirm mode.

- Default to overlay-guided setup in `Channel Config`.
- Offer text-guided fallback that writes to `packages/channel-runtime/.env`.
- Process one credential or webhook setting at a time and wait for explicit confirmation after each manual step.

2. Load references.

- Read `packages/opencorvus/src/skill/builtin/channel/opencorvus-channel-config-wizard/references/channel-matrix.md`.
- Use only the `DingTalk` section and the official DingTalk URLs listed there.

3. Guide provider-side setup.

- Ask the user to open the DingTalk developer console or tutorial pages from the matrix.
- Ask the user to create or open the internal app or bot and copy `AppKey` and `AppSecret`.
- Ask for `DINGTALK_DEFAULT_WEBHOOK` only if they want a fixed group webhook fallback.
- Ask for `DINGTALK_WEBHOOK_*` only if listener overrides are needed.

4. Apply OpenCorvus config.

- When the user pastes a value, write it immediately instead of asking them to edit files themselves.
- Overlay mode: set `DINGTALK_APP_KEY`, `DINGTALK_APP_SECRET`, optional `DINGTALK_DEFAULT_WEBHOOK`, and optional `DINGTALK_WEBHOOK_*`, then click `Save Config`.
- Text fallback: update `packages/channel-runtime/.env` and keep unrelated keys unchanged.
- Redact secrets in summaries and confirmations.

5. Verify runtime.

- Confirm `packages/channel-runtime/src/main.ts` registers `DingTalkAdapter`.
- Confirm `packages/channel-runtime/src/adapters/dingtalk.ts` matches the chosen callback mode.
- Run `bun run --cwd packages/channel-runtime --no-env-file --env-file .env src/main.ts`.
- Send one inbound DingTalk message and confirm one reply.

6. Troubleshoot.

- If auth fails, re-check `AppKey`, `AppSecret`, and tenant scope.
- If replies fail, re-check bot permissions and target conversation scope.
- If callbacks never arrive, re-check webhook reachability and DingTalk callback settings.

## Guardrails

- Do not claim full automation for DingTalk login, review, or enterprise admin actions.
- Do not output real secrets.
- Keep edits focused on overlay env values or `packages/channel-runtime/.env` unless the user asks for code changes.
- Do not claim parity features that the adapter does not implement.

## Output Format

1. Mode and current provider step.
2. Required official page and exact manual action.
3. Values received and env keys updated.
4. Verification result.
5. Next blocker or completion status.
