---
name: opencorvus-wecom-channel-config
description: Guide official WeCom app setup for OpenCorvus, collect WeCom credentials from the user, and write them into OpenCorvus after the user provides them. Use when tasks involve WeCom credential retrieval, WECOM_* env wiring, or WeCom runtime verification.
---

# OpenCorvus WeCom Channel Config

## Overview

Guide the user through the official WeCom admin and developer flow, stop for every provider-side action, and apply values to OpenCorvus only after the user pastes them.

## Workflow

1. Confirm mode.

- Default to overlay-guided setup in `Channel Config`.
- Offer text-guided fallback that writes to `packages/channel-runtime/.env`.
- Process one credential or webhook setting at a time and wait for explicit confirmation after each manual step.

2. Load references.

- Read `packages/opencorvus/src/skill/builtin/channel/opencorvus-channel-config-wizard/references/channel-matrix.md`.
- Use only the `WeCom` section and the official WeCom URLs listed there.

3. Guide provider-side setup.

- Ask the user to open the WeCom admin console and developer center.
- Ask the user to copy `CorpID`, the self-built app `Secret`, and `AgentId`.
- Ask whether inbound callbacks require `WECOM_WEBHOOK_*` overrides.
- Ask the user to add the app to the target scope or contacts before validation.

4. Apply OpenCorvus config.

- When the user pastes a value, write it immediately instead of asking them to edit files themselves.
- Overlay mode: set `WECOM_CORP_ID`, `WECOM_SECRET`, `WECOM_AGENT_ID`, and optional `WECOM_WEBHOOK_*`, then click `Save Config`.
- Text fallback: update `packages/channel-runtime/.env` and keep unrelated keys unchanged.
- Redact secrets in summaries and confirmations.

5. Verify runtime.

- Confirm `packages/channel-runtime/src/main.ts` registers `WeComAdapter`.
- Confirm `packages/channel-runtime/src/adapters/wecom.ts` matches the chosen callback mode.
- Run `bun run --cwd packages/channel-runtime --no-env-file --env-file .env src/main.ts`.
- Send one inbound WeCom message and confirm one reply.

6. Troubleshoot.

- If auth fails, re-check `CorpID`, `Secret`, and `AgentId`.
- If replies fail, re-check app visibility and message permissions.
- If callbacks never arrive, re-check webhook reachability and WeCom callback settings.

## Guardrails

- Do not claim full automation for WeCom login, app approval, or enterprise admin actions.
- Do not output real secrets.
- Keep edits focused on overlay env values or `packages/channel-runtime/.env` unless the user asks for code changes.
- Do not claim parity features that the adapter does not implement.

## Output Format

1. Mode and current provider step.
2. Required official page and exact manual action.
3. Values received and env keys updated.
4. Verification result.
5. Next blocker or completion status.
