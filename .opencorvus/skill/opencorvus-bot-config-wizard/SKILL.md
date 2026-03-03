---
name: opencorvus-bot-config-wizard
description: Unified setup workflow for OpenCorvus remote chat channels. Use when users ask to configure one or more bot channels (Slack, Telegram, Feishu or Lark, WhatsApp first, then other mainstream adapters), want screen-guided step-by-step setup, need text fallback checklists, or want automatic env wiring and startup verification in packages/bot.
---

# OpenCorvus Bot Config Wizard

## Overview

Drive one consistent channel setup workflow and avoid ad-hoc per-platform instructions.
Default to screen-guided setup, and switch to text-guided checklist mode when requested or when desktop confirmation is unavailable.

## Workflow

1. Scope channels and mode.
- Ask which channels to configure and process them one by one.
- Default to screen-guided mode.
- Offer text-guided mode immediately as an option.

2. Load only needed references.
- Read `references/channel-matrix.md` for required env keys and checkpoint structure.
- For platform details, read only target channel docs:
  - `.opencorvus/skill/opencorvus-slack-bot-config/references/openclaw.md`
  - `.opencorvus/skill/opencorvus-telegram-bot-config/references/openclaw.md`
  - `.opencorvus/skill/opencorvus-feishu-bot-config/references/openclaw.md`
  - `.opencorvus/skill/opencorvus-whatsapp-bot-config/references/openclaw.md`
  - and other channel references only if explicitly in scope.

3. Run screen-guided loop by default.
- For each manual portal step:
  - instruct one concrete action only;
  - wait for explicit user confirmation before continuing;
  - never skip confirmation checkpoints.
- If desktop confirmation fails or times out, switch to text-guided mode and continue from the same step.

4. Collect and apply config.
- Write channel env keys to `packages/bot/.env` (or system env if user requests).
- Keep existing unrelated env keys unchanged.
- Prefer canonical key names from `packages/bot/src/registry.ts`; keep `OPENCLAW_*` fallbacks as optional compatibility only.

5. Validate and report.
- Run startup validation:
  - `bun run --cwd packages/bot --no-env-file --env-file .env src/main.ts`
- Confirm registered channels from startup logs.
- Return per-channel status: configured, blocked by manual step, or failed with exact reason.

## Guardrails

- Separate verified OpenClaw facts from OpenCorvus mapping and label inference explicitly.
- Redact secrets in all outputs; never print full tokens or secrets.
- Keep guidance stepwise; one action per checkpoint in screen-guided mode.
- Do not claim full automation for provider-side actions requiring human login, OAuth consent, QR scan, or security challenge.

## Output Format

1. Mode and channel scope.
2. Current step and required user action.
3. Confirmation checkpoint result.
4. Env changes applied.
5. Startup validation and final status by channel.
