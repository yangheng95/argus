---
name: opencorvus-bot-config-wizard
description: Unified overlay-first setup workflow for OpenCorvus remote chat channels. Use when users ask to configure one or more bot channels from the new overlay UI, want step-by-step checkpoints, need text fallback checklists, or want automatic env wiring and startup verification in packages/bot.
---

# OpenCorvus Bot Config Wizard

## Overview

Drive one consistent channel setup workflow and avoid ad-hoc per-platform instructions.
Default to overlay-guided setup in the new manager UI:

- `Bot Config` card
- `Environment Variables` button
- `Channel Integrations` group and `+ Add Custom Env`
- `Save Config`

Switch to text-guided checklist mode only when requested or when desktop confirmation is unavailable.

## Workflow

1. Scope channels and mode.

- Ask which channels to configure and process them one by one.
- Default to overlay-guided mode.
- Offer text-guided mode immediately as an option.

2. Load only needed references.

- Read `references/channel-matrix.md` for required env keys and checkpoint structure.
- For platform details, read only target channel docs:
  - `.opencorvus/skill/opencorvus-slack-bot-config/references/openclaw.md`
  - `.opencorvus/skill/opencorvus-telegram-bot-config/references/openclaw.md`
  - `.opencorvus/skill/opencorvus-feishu-bot-config/references/openclaw.md`
  - `.opencorvus/skill/opencorvus-whatsapp-bot-config/references/openclaw.md`
  - and other channel references only if explicitly in scope.

3. Run overlay-guided loop by default.

- Ask user to open OpenCorvus overlay and stay in the `Bot Config` section.
- Instruct the user to click `Environment Variables`.
- For each channel key:
  - use built-in rows in `Channel Integrations` when available;
  - use `+ Add Custom Env` for keys not listed in built-in rows;
  - instruct one concrete action only;
  - wait for explicit user confirmation before continuing;
  - never skip confirmation checkpoints.
- If desktop confirmation fails or times out, switch to text-guided mode and continue from the same step.

4. Collect and apply config.

- In overlay mode, write channel env keys through the `Environment Variables` panel then click `Save Config`.
- In text-guided fallback, write channel env keys to `packages/bot/.env` (or system env if user requests).
- Keep existing unrelated env keys unchanged.
- Prefer canonical key names from `packages/bot/src/registry.ts`; keep `OPENCLAW_*` fallbacks as optional compatibility only.

5. Validate and report.

- In overlay mode:
  - use `Runtime` panel `Start` or restart flow;
  - use `Refresh` if needed;
  - confirm expected channel names from startup logs (look for `Registered chat channels`).
- In text-guided fallback, run startup validation:
  - `bun run --cwd packages/bot --no-env-file --env-file .env src/main.ts`
- Return per-channel status: configured, blocked by manual step, or failed with exact reason.

## Guardrails

- Separate verified OpenClaw facts from OpenCorvus mapping and label inference explicitly.
- Redact secrets in all outputs; never print full tokens or secrets.
- Keep guidance stepwise; one action per checkpoint in overlay-guided mode.
- Do not claim full automation for provider-side actions requiring human login, OAuth consent, QR scan, or security challenge.

## Output Format

1. Mode and channel scope.
2. Current overlay step and required user action.
3. Confirmation checkpoint result.
4. Env changes applied (built-in row or custom env row).
5. Startup validation and final status by channel.
