---
name: opencorvus-feishu-channel-config
description: Guide official Feishu or Lark app setup for OpenCorvus, collect app credentials from the user, and write them into OpenCorvus after the user provides them. Use when tasks involve FEISHU_* credential retrieval, event subscription setup, env wiring, or Feishu runtime verification.
---

# OpenCorvus Feishu Channel Config

## Overview

Guide the user through the official Feishu or Lark console, stop for every provider-side action, and apply values to OpenCorvus only after the user pastes them.

## Workflow

1. Confirm mode.

- Default to overlay-guided setup in `Channel Config`.
- Offer text-guided fallback that writes to `packages/channel-runtime/.env`.
- Process one credential or webhook setting at a time and wait for explicit confirmation after each manual step.

2. Load references.

- Read `packages/opencorvus/src/skill/builtin/channel/opencorvus-channel-config-wizard/references/channel-matrix.md`.
- Use only the `Feishu or Lark` section and the official Feishu URLs listed there.

3. Guide provider-side setup.

- Ask the user to create or open a self-built app in the Feishu or Lark console.
- Ask the user to copy `App ID` and `App Secret`.
- Ask whether inbound events will be delivered through the OpenCorvus webhook listener.
- If webhook delivery is needed, guide the user through event subscription and callback URL setup.
- Ask for `FEISHU_VERIFICATION_TOKEN` only if token verification is enabled in the portal.

4. Apply OpenCorvus config.

- When the user pastes a value, write it immediately instead of asking them to edit files themselves.
- Overlay mode: set `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, optional `FEISHU_VERIFICATION_TOKEN`, and optional `FEISHU_WEBHOOK_*`, then click `Save Config`.
- Text fallback: update `packages/channel-runtime/.env` and keep unrelated keys unchanged.
- Redact secrets in summaries and confirmations.

5. Verify runtime.

- Confirm `packages/channel-runtime/src/main.ts` registers `FeishuAdapter`.
- Confirm `packages/channel-runtime/src/adapters/feishu.ts` matches the chosen event-delivery mode.
- Run `bun run --cwd packages/channel-runtime --no-env-file --env-file .env src/main.ts`.
- Send one inbound text message and confirm one reply.

6. Troubleshoot.

- If no events arrive, re-check event subscriptions, bot scopes, and callback reachability.
- If verification fails, re-check the verification token and portal callback settings.
- If replies fail, re-check app credentials and tenant permissions.

## Guardrails

- Do not claim full automation for Feishu login, app review, or admin approval.
- Do not expose app secrets in plain text outputs.
- Keep edits minimal and localized to overlay env values or `packages/channel-runtime/.env` unless the user asks for code changes.
- Do not claim unsupported features that the current Feishu adapter does not implement.

## Output Format

1. Mode and current provider step.
2. Required official page and exact manual action.
3. Values received and env keys updated.
4. Verification result.
5. Next blocker or completion status.
