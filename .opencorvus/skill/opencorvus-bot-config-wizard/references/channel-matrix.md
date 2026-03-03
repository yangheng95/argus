# OpenCorvus Bot Channel Matrix

## Purpose

Use this matrix to keep unified setup logic while supporting channel-specific required env keys.
This file is for execution planning, not for replacing platform official docs.

## Source Of Truth

- `packages/bot/src/registry.ts`
- `packages/bot/src/main.ts`
- `packages/bot/.env.example`

## Default Mode

- Screen-guided first.
- Text-guided fallback on request or when desktop confirmation is unavailable.

## Unified Checkpoints

1. Open platform admin page.
2. Complete one manual action.
3. Wait for user confirmation.
4. Record required credential value.
5. Repeat until all required keys are available.
6. Apply env changes.
7. Start bot and verify registration.

## Channel Keys (Initial Priority)

### Slack

- Required:
  - `SLACK_BOT_TOKEN`
  - `SLACK_APP_TOKEN`
- Optional:
  - `SLACK_SIGNING_SECRET`

### Telegram

- Required:
  - `TELEGRAM_BOT_TOKEN`

### Feishu or Lark

- Required:
  - `FEISHU_APP_ID`
  - `FEISHU_APP_SECRET`
- Optional:
  - `FEISHU_WEBHOOK_HOST`
  - `FEISHU_WEBHOOK_PORT`
  - `FEISHU_WEBHOOK_PATH`
  - `FEISHU_VERIFICATION_TOKEN`

### WhatsApp

- Required:
  - `WHATSAPP_ACCESS_TOKEN`
  - `WHATSAPP_PHONE_NUMBER_ID`
- Optional:
  - `WHATSAPP_VERIFY_TOKEN`
  - `WHATSAPP_WEBHOOK_HOST`
  - `WHATSAPP_WEBHOOK_PORT`
  - `WHATSAPP_WEBHOOK_PATH`

## Other Supported Channels

The same workflow applies to:
- Google Chat (`GOOGLECHAT_SERVICE_ACCOUNT_JSON`)
- Microsoft Teams (`MSTEAMS_APP_ID`, `MSTEAMS_APP_SECRET`)
- LINE (`LINE_CHANNEL_ACCESS_TOKEN`)
- Matrix (`MATRIX_HOMESERVER_URL`, `MATRIX_ACCESS_TOKEN`)
- Mattermost (`MATTERMOST_SERVER_URL`, `MATTERMOST_BOT_TOKEN`)
- Signal (`SIGNAL_SERVICE_URL`, `SIGNAL_ACCOUNT`)
- WeCom (`WECOM_CORP_ID`, `WECOM_SECRET`, `WECOM_AGENT_ID`)
- DingTalk (`DINGTALK_APP_KEY`, `DINGTALK_APP_SECRET`)

For exact channel semantics, load only the corresponding channel reference file.
