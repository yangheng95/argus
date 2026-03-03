---
name: opencorvus-feishu-bot-config
description: Plan and implement Feishu or Lark bot integration for OpenCorvus. Use when tasks involve Feishu app credentials, event subscription settings, FEISHU_* environment variables, designing a new Feishu adapter in packages/bot, or troubleshooting Feishu message delivery.
---

# OpenCorvus Feishu Bot Config

## Overview

Guide Feishu or Lark integration for OpenCorvus using OpenClaw Feishu plugin documentation as a complete reference baseline.
Treat this as implementation and configuration guidance because OpenCorvus does not include a built-in Feishu adapter by default.

## Workflow

1. Confirm runtime and current state.
- Confirm this task targets OpenCorvus (`packages/bot`).
- Check whether `packages/bot/src/adapters/feishu.ts` already exists.

2. Load reference baseline.
- Read `references/openclaw.md`.

3. Pick integration path.
- Use native adapter path for long-term integration.
- Use bridge path only for temporary rollout when code change is blocked.

4. Apply native adapter changes.
- Add `packages/bot/src/adapters/feishu.ts` implementing `BotAdapter`.
- Export adapter in `packages/bot/src/index.ts`.
- Register adapter in `packages/bot/src/main.ts` behind `FEISHU_APP_ID` and `FEISHU_APP_SECRET`.
- Add required env keys in `packages/bot/.env.example`.

5. Validate runtime.
- Run `bun run --cwd packages/bot src/main.ts` or `bun dev`.
- Confirm startup log indicates Feishu adapter readiness.
- Test inbound text and outbound reply.
- If images are supported, test image upload.

6. Troubleshoot.
- If no events arrive, re-check event subscription mode and permissions.
- If signature checks fail, re-check verification and encrypt configuration.
- If replies fail, re-check app credentials and tenant permissions.

## Guardrails

- Do not claim Feishu is built-in unless adapter files exist in OpenCorvus.
- Do not expose app secrets in plain text outputs.
- Keep implementation scope focused on adapter, env, and message flow.

## Output Format

1. Integration path summary.
2. Required Feishu or Lark settings and env vars.
3. Exact file edits.
4. Run commands.
5. Verification and troubleshooting checklist.
