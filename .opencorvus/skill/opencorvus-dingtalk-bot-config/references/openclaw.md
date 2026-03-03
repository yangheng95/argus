# OpenClaw and DingTalk Reference

## Snapshot

Research date: 2026-03-03.

## Verified OpenClaw facts

- OpenClaw chat channels index does not list DingTalk as an official channel page.

Inference from the official channel index snapshot:
- Treat DingTalk as OpenCorvus-native integration for now, not a documented OpenClaw channel workflow.

## OpenCorvus mapping

OpenCorvus source of truth:
- `packages/bot/src/registry.ts`
- `packages/bot/src/adapters/dingtalk.ts`
- `packages/bot/.env.example`

OpenCorvus env keys:
- Required: `DINGTALK_APP_KEY`, `DINGTALK_APP_SECRET`
- Optional: `DINGTALK_DEFAULT_WEBHOOK`, `DINGTALK_WEBHOOK_HOST`, `DINGTALK_WEBHOOK_PORT`, `DINGTALK_WEBHOOK_PATH`
- Compatibility fallback: `OPENCLAW_DINGTALK_APP_KEY`, `OPENCLAW_DINGTALK_APP_SECRET`

Runtime notes:
- Adapter hosts webhook endpoint and handles DingTalk challenge callback.
- Outbound replies use `sessionWebhook` from inbound events, or `DINGTALK_DEFAULT_WEBHOOK` fallback.
- Current text MVP stores app key/secret but message send path is webhook based.

## Verification checklist

1. Configure DingTalk callback URL to OpenCorvus webhook path.
2. Start bot and confirm challenge callback passes.
3. Send one text event and confirm one reply.
4. If outbound fails, verify session webhook availability or default webhook config.

## Sources

- OpenClaw channels overview: https://docs.openclaw.ai/channels
- DingTalk Open Platform docs: https://open.dingtalk.com/document/orgapp/enterprise-internal-application-overview
