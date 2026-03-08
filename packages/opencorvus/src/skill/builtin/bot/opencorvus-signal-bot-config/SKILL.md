---
name: opencorvus-signal-bot-config
description: Configure and troubleshoot Signal bot integration for OpenCorvus. Use when tasks involve SIGNAL_SERVICE_URL, SIGNAL_ACCOUNT setup, adapter wiring checks in packages/bot/src/main.ts, updates to packages/bot/.env, or Signal message delivery debugging.
---

# OpenCorvus Signal Bot Config

## Overview

Configure Signal for OpenCorvus using a repeatable checklist and map platform setup to the adapter implementation in packages/bot.

## Workflow

## Interaction Mode

- Default to screen-guided flow.
- Ask the user to open the platform admin page, then advance one step at a time.
- After each manual portal action, pause and wait for explicit user confirmation before continuing.
- Offer a text-guided fallback at any time (copy-paste checklist with URLs and exact fields).
- If desktop confirmation is unavailable, switch to text-guided fallback and continue.

1. Confirm scope.


2. Load checklist.


3. Configure platform and environment.

- Set required env keys: SIGNAL_SERVICE_URL, SIGNAL_ACCOUNT.
- Set optional env keys when needed: No webhook env; long polling from Signal service endpoint.
- Ensure the platform-side app or webhook configuration matches the adapter mode.

4. Verify OpenCorvus wiring.

- Confirm packages/bot/src/main.ts registers this adapter when required env keys exist.
- Confirm adapter implementation exists at packages/bot/src/adapters/signal.ts.
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

- Do not output real secrets.
- Keep edits focused on adapter wiring, env keys, and transport configuration.
- Do not claim parity features that the adapter does not implement.

## Output Format

1. Setup summary.
2. Required platform settings and env vars.
3. Exact file edits.
4. Run commands.
5. Verification and troubleshooting checklist.
