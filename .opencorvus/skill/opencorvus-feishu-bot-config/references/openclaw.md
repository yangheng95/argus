# OpenClaw and Feishu or Lark Reference

## Snapshot

Research date: 2026-03-03.

OpenClaw Feishu docs provide app creation, credentials, permission scopes, and event subscription guidance.
Use this as the reference baseline for implementing Feishu in OpenCorvus.

## OpenClaw Feishu Checklist (Portable)

1. Install Feishu plugin in OpenClaw runtime.
2. Create Feishu or Lark self-built app.
3. Collect:
- `FEISHU_APP_ID` (`cli_...`)
- `FEISHU_APP_SECRET`
4. Add app permissions:
- messaging and user profile scopes needed by bot flow
5. Configure event subscription:
- choose event mode
- subscribe to message receive event
6. Enable bot capability in app settings.

OpenClaw docs also mention:
- domain mode (`feishu` vs `lark`) for deployment region
- webhook mode requiring verification token and encrypt key
- long-connection mode as preferred for simple setup

## OpenCorvus Gap and Mapping

OpenCorvus currently does not include a built-in Feishu adapter in `packages/bot/src/main.ts`.
Implement native support in OpenCorvus by:

1. Adding `packages/bot/src/adapters/feishu.ts` implementing `BotAdapter`.
2. Registering adapter in `packages/bot/src/main.ts` behind Feishu env keys.
3. Extending `packages/bot/.env.example` with required Feishu keys.

Suggested env keys:
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_VERIFICATION_TOKEN`
- `FEISHU_ENCRYPT_KEY`

## Verification Checklist

1. Adapter starts without credential errors.
2. Inbound text event reaches handler.
3. Outbound reply posts successfully.
4. Signature validation fails closed for invalid webhook requests.

## Sources

- OpenClaw Feishu channels docs: https://docs.openclaw.ai/getting-started/channels/feishu
- Feishu Open Platform docs: https://open.feishu.cn/document
- Lark Open Platform docs: https://open.larksuite.com/document
