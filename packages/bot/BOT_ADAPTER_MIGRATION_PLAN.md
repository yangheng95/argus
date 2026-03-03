# Bot Adapter Migration Plan

Last updated: 2026-03-03
Scope: `packages/bot`

## Goal

Enable OpenCorvus bot to support mainstream channels with stable architecture, consistent behavior, and safe incremental rollout.

## Current Baseline

- Existing adapters: Slack, Telegram, Discord, Feishu, WhatsApp, Google Chat, Microsoft Teams, LINE, Matrix, Mattermost, Signal, WeCom, DingTalk.
- Registry-driven adapter wiring is in place.
- OpenClaw-style env fallbacks are supported across all registered adapters.

## Guiding Rules

1. Keep backward compatibility for Slack, Telegram, and Discord.
2. Ship in small batches with passing tests and typecheck.
3. Start each new channel with text-only MVP, then add media and advanced features.
4. Do not couple core logic to any single platform.
5. Keep secrets in env only.

## Phase Plan

## Phase 1: Core Interface Upgrade

Status: in progress
Estimate: 1-2 days

Tasks:

1. Extend adapter contract to capability-based shape while preserving compatibility.
2. Standardize inbound message fields:
- `conversation_id`
- `message_id`
- `reply_to`
- `mentions`
- `raw_event`
3. Add optional adapter capabilities:
- typing indicator
- ack/defer
- reaction
- webhook metadata

Exit criteria:

1. Existing adapters compile without behavior regressions.
2. Core tests pass.

## Phase 2: Runtime Isolation

Estimate: 1 day

Tasks:

1. Add adapter supervisor (start/retry/backoff/health).
2. Isolate adapter startup failures so one broken platform does not block others.
3. Surface adapter health in logs and status output.

Exit criteria:

1. One adapter failure does not stop other adapters.
2. Retry/backoff behavior is covered by tests.

## Phase 3: Platform Waves

Wave A (priority):

1. Feishu
2. WhatsApp
3. Google Chat

Wave B:

1. Microsoft Teams
2. LINE
3. Matrix

Wave C:

1. Mattermost
2. Signal
3. WeCom
4. DingTalk

Per-platform implementation checklist:

1. Add adapter file in `src/adapters/`.
2. Add env mapping in `src/registry.ts`.
3. Add `.env.example` placeholders and notes.
4. Add unit tests for:
- inbound event mapping
- outbound text send
5. Add integration smoke test path (manual or scripted).

## Definition of Done (Per Platform)

1. Inbound text events are received and normalized.
2. Outbound text replies work in correct thread or conversation context.
3. Error states (401/403/429/5xx) are logged with clear action hints.
4. `bun test` passes in `packages/bot`.
5. `bun run typecheck` passes in `packages/bot`.
6. Existing Slack/Telegram/Discord tests still pass.

## Test Strategy

Required on each PR:

1. `bun test` (from `packages/bot`)
2. `bun run typecheck` (from `packages/bot`)

Required test additions:

1. Registry tests for env detection and fallback.
2. Adapter tests for inbound and outbound behavior.
3. Core queue/session regression tests for multi-adapter scenarios.

## Operational Notes

1. Keep text-length and rate-limit guards in adapter layer.
2. Keep per-channel retry policy in adapter or supervisor, not in `BotCore`.
3. Keep `BotCore` channel-agnostic.
4. Log registered adapters and skipped adapters with reasons at startup.

## Risks and Mitigations

1. Risk: platform API differences break common abstraction.
Mitigation: capability flags, optional methods, per-adapter feature gates.

2. Risk: rollout slows due to large cross-platform refactor.
Mitigation: wave-based delivery, text-first MVP, strict DoD.

3. Risk: regression in existing channels.
Mitigation: preserve compatibility path and keep baseline tests green on each step.

## Suggested Milestones

1. M1-M4 delivered as text MVP adapters.
2. M5 next: media support parity, webhook security hardening, and reliability hardening.
