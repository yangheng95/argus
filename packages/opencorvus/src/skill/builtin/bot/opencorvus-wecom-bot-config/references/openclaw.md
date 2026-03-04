# OpenClaw and WeCom Reference

## Snapshot

Research date: 2026-03-03.

## Verified OpenClaw facts

- OpenClaw chat channels index does not list WeCom as an official channel page.

Inference from the official channel index snapshot:

- Treat WeCom as OpenCorvus-native integration for now, not a documented OpenClaw channel workflow.

## OpenCorvus mapping

OpenCorvus source of truth:

- `packages/bot/src/registry.ts`
- `packages/bot/src/adapters/wecom.ts`
- `packages/bot/.env.example`

OpenCorvus env keys:

- Required: `WECOM_CORP_ID`, `WECOM_SECRET`, `WECOM_AGENT_ID`
- Optional: `WECOM_WEBHOOK_HOST`, `WECOM_WEBHOOK_PORT`, `WECOM_WEBHOOK_PATH`
- Compatibility fallback: `OPENCLAW_WECOM_CORP_ID`, `OPENCLAW_WECOM_SECRET`, `OPENCLAW_WECOM_AGENT_ID`

Runtime notes:

- Adapter hosts XML callback endpoint for inbound events.
- Outbound uses WeCom access token + message send API.
- Media output uses WeCom media upload API before image send.

## Verification checklist

1. Configure WeCom callback URL to OpenCorvus webhook path.
2. Start bot and confirm webhook endpoint is reachable.
3. Send one text event and confirm one reply.
4. Validate corp/agent permissions if send API errors occur.

## Sources

- OpenClaw channels overview: https://docs.openclaw.ai/channels
- WeCom official developer docs: https://developer.work.weixin.qq.com/document/path/90253
