---
name: opencorvus-wecom-bot-config
description: Configure and troubleshoot WeCom bot integration for OpenCorvus. Use when tasks involve WECOM_CORP_ID, WECOM_SECRET, WECOM_AGENT_ID setup, adapter wiring checks in packages/bot/src/main.ts, updates to packages/bot/.env, or WeCom message delivery debugging.
---

# OpenCorvus WeCom Bot Config

## Overview

Configure WeCom for OpenCorvus using a repeatable checklist and map platform setup to the adapter implementation in packages/bot.

## Workflow

1. Confirm scope.
- Confirm the task targets OpenCorvus bot runtime (packages/bot) rather than OpenClaw runtime.
- OpenClaw does not currently publish an official WeCom channel page; treat this workflow as OpenCorvus-native and use vendor docs for platform-side steps.

2. Load checklist.
- Read references/openclaw.md.
- Follow the "Verified OpenClaw facts" section to keep claims explicit about what is and is not officially documented.

3. Configure platform and environment.
- Set required env keys: WECOM_CORP_ID, WECOM_SECRET, WECOM_AGENT_ID.
- Set optional env keys when needed: WECOM_WEBHOOK_HOST, WECOM_WEBHOOK_PORT, WECOM_WEBHOOK_PATH.
- Ensure the platform-side app or webhook configuration matches the adapter mode.

4. Verify OpenCorvus wiring.
- Confirm packages/bot/src/main.ts registers this adapter when required env keys exist.
- Confirm adapter implementation exists at packages/bot/src/adapters/wecom.ts.
- Confirm packages/bot/.env.example contains the same env keys.

5. Validate runtime.
- Run bun run --cwd packages/bot src/main.ts or bun dev.
- Send one inbound message and confirm one outbound reply.
- If image output is expected, test one image output.

6. Troubleshoot.
- Re-check credentials and webhook endpoints.
- Re-check app or bot permissions.
- Re-check adapter logs for transport-specific errors.

## Guardrails

- Separate verified OpenClaw facts from OpenCorvus mapping and label inference explicitly.
- Do not output real secrets.
- Keep edits focused on adapter wiring, env keys, and transport configuration.
- Do not claim parity features that the adapter does not implement.

## Output Format

1. Setup summary.
2. Required platform settings and env vars.
3. Exact file edits.
4. Run commands.
5. Verification and troubleshooting checklist.

