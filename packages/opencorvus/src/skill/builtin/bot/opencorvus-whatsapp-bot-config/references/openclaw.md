# OpenClaw and WhatsApp Reference

## Snapshot

Research date: 2026-03-03.

## Verified OpenClaw facts

- OpenClaw marks WhatsApp as stable.
- OpenClaw docs describe two families of provider paths:
  - Baileys path (with login command and QR flow).
  - API-provider path (WAHA or Meta Cloud API style settings).
- Docs include channel add command examples and webhook path guidance.
- Docs list provider-specific options such as API URL, API key, and phone number ID.

## OpenCorvus mapping

OpenCorvus source of truth:
- `packages/bot/src/registry.ts`
- `packages/bot/src/adapters/whatsapp.ts`
- `packages/bot/.env.example`

OpenCorvus env keys:
- Required: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`
- Optional: `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_WEBHOOK_HOST`, `WHATSAPP_WEBHOOK_PORT`, `WHATSAPP_WEBHOOK_PATH`
- Compatibility fallback: `OPENCLAW_WHATSAPP_ACCESS_TOKEN`, `OPENCLAW_WHATSAPP_PHONE_NUMBER_ID`

Runtime notes:
- OpenCorvus adapter targets Meta Graph API style send/media endpoints.
- Inbound handling is webhook based.
- Verification uses `hub.verify_token` when `WHATSAPP_VERIFY_TOKEN` is set.

## Differences to keep explicit

- OpenClaw supports QR login style flows (Baileys) and multiple providers.
- OpenCorvus current adapter is cloud-API webhook style and does not implement QR login session lifecycle.

## Verification checklist

1. Start bot and confirm WhatsApp webhook path is listening.
2. Verify webhook challenge response with verify token.
3. Send one text message and confirm one reply.
4. If image output is expected, verify media upload/send flow.

## Sources

- OpenClaw channels overview: https://docs.openclaw.ai/channels
- OpenClaw WhatsApp docs: https://docs.openclaw.ai/channels/whatsapp
- Meta WhatsApp Cloud API docs: https://developers.facebook.com/docs/whatsapp
