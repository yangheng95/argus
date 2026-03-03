---
name: opencorvus-feishu-bot-config
description: Configure and troubleshoot Feishu or Lark bot integration for OpenCorvus. Use when tasks involve Feishu app credentials, event subscription settings, FEISHU_* environment variables, adapter wiring checks in packages/bot/src/main.ts, or troubleshooting Feishu message delivery.
---

# OpenCorvus Feishu Bot Config

## Overview

Guide Feishu or Lark integration for OpenCorvus using OpenClaw Feishu plugin documentation as a complete reference baseline.
Use this as implementation and configuration guidance for the built-in Feishu adapter in `packages/bot`.

## Workflow

## Interaction Mode

- Default to screen-guided flow.
- Ask the user to open the platform admin page, then advance one step at a time.
- After each manual portal action, pause and wait for explicit user confirmation before continuing.
- Offer a text-guided fallback at any time (copy-paste checklist with URLs and exact fields).
- If desktop confirmation is unavailable, switch to text-guided fallback and continue.
1. Confirm runtime and current state.
- Confirm this task targets OpenCorvus (`packages/bot`).
- Check whether `packages/bot/src/adapters/feishu.ts` already exists.

2. Load reference baseline.
- Read `references/openclaw.md`.

3. Verify native adapter wiring.
- Confirm `packages/bot/src/adapters/feishu.ts` implements `BotAdapter`.
- Confirm adapter is exported in `packages/bot/src/index.ts`.
- Confirm adapter is registered in `packages/bot/src/main.ts` behind `FEISHU_APP_ID` and `FEISHU_APP_SECRET`.
- Confirm required env keys exist in `packages/bot/.env.example`.

4. Validate runtime.
- Run `bun run --cwd packages/bot src/main.ts` or `bun dev`.
- Confirm startup log indicates Feishu adapter readiness.
- Test inbound text and outbound reply.
- If images are supported, test image upload.

5. Troubleshoot.
- If no events arrive, re-check event subscription mode and permissions.
- If signature checks fail, re-check verification and encrypt configuration.
- If replies fail, re-check app credentials and tenant permissions.

## Guardrails

- Separate verified OpenClaw facts from OpenCorvus mapping and label inference explicitly.
- Do not claim unsupported features that the current Feishu adapter does not implement.
- Do not expose app secrets in plain text outputs.
- Keep implementation scope focused on adapter, env, and message flow.

## Output Format

1. Integration path summary.
2. Required Feishu or Lark settings and env vars.
3. Exact file edits.
4. Run commands.
5. Verification and troubleshooting checklist.

