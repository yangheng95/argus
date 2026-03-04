# OpenClaw and Feishu or Lark Reference

## Snapshot

Research date: 2026-03-03.

## Verified OpenClaw facts

- OpenClaw marks Feishu as beta.
- Feishu support is plugin-based in OpenClaw (`@openclaw/plugin-feishu`).
- Docs describe long connection (websocket) and webhook modes.
- Core app credentials are `FEISHU_APP_ID` and `FEISHU_APP_SECRET`.
- Webhook mode includes verification token and encrypt key handling.
- Event subscription guidance includes `im.message.receive_v1`.

## OpenCorvus mapping

OpenCorvus source of truth:
- `packages/bot/src/registry.ts`
- `packages/bot/src/adapters/feishu.ts`
- `packages/bot/.env.example`

OpenCorvus env keys:
- Required: `FEISHU_APP_ID`, `FEISHU_APP_SECRET`
- Optional: `FEISHU_WEBHOOK_HOST`, `FEISHU_WEBHOOK_PORT`, `FEISHU_WEBHOOK_PATH`, `FEISHU_VERIFICATION_TOKEN`
- Compatibility fallback: `OPENCLAW_FEISHU_APP_ID`, `OPENCLAW_FEISHU_APP_SECRET`

Runtime notes:
- OpenCorvus adapter is webhook-first (HTTP server), not websocket long connection.
- Adapter validates verification token only when configured.
- Outbound API uses tenant access token and Feishu message APIs.

## Differences to keep explicit

- OpenClaw includes websocket long-connection mode.
- Current OpenCorvus implementation supports webhook mode only.

## Verification checklist

1. Start bot and confirm Feishu webhook listening path.
2. Verify challenge callback succeeds.
3. Send one text message and confirm one reply.
4. If enabled, verify invalid token is rejected.

## Sources

- OpenClaw channels overview: https://docs.openclaw.ai/channels
- OpenClaw Feishu docs: https://docs.openclaw.ai/channels/feishu
- Feishu Open Platform docs: https://open.feishu.cn/document
- Lark Open Platform docs: https://open.larksuite.com/document
