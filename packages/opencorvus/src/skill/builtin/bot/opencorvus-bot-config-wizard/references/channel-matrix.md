# OpenCorvus Bot Channel Matrix

## Purpose

Use this matrix to keep unified setup logic while supporting channel-specific required env keys.
This file is for execution planning, not for replacing platform official docs.

## Source Of Truth

- `packages/bot/src/registry.ts`
- `packages/bot/src/main.ts`
- `packages/bot/.env.example`
- `packages/overlay/src/manager.js` (`Environment Variables` groups in overlay UI)

## Default Mode

- Overlay-guided first.
- Text-guided fallback on request or when desktop confirmation is unavailable.

## Overlay Path (New UI)

1. Open `Bot Config` in overlay.
2. Click `Environment Variables`.
3. Fill channel keys:
   - use built-in rows in `Channel Integrations` when present;
   - use `+ Add Custom Env` for all other keys.
4. Click `Save Config`.
5. Start or restart bot from `Runtime`.
6. Verify logs include expected names in `Registered chat channels`.

## Built-In Rows In `Channel Integrations`

- `SLACK_BOT_TOKEN`
- `SLACK_APP_TOKEN`
- `SLACK_SIGNING_SECRET`
- `SLACK_CHANNEL_ID` (test injection only)
- `TELEGRAM_BOT_TOKEN`
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_VERIFICATION_TOKEN`

## Channel Keys (Canonical)

### Slack

- Required:
  - `SLACK_BOT_TOKEN`
  - `SLACK_APP_TOKEN`
- Optional:
  - `SLACK_SIGNING_SECRET`
  - `SLACK_CHANNEL_ID`

### Telegram

- Required:
  - `TELEGRAM_BOT_TOKEN`

### Discord

- Required:
  - `DISCORD_BOT_TOKEN`

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

### Google Chat

- Required:
  - `GOOGLECHAT_SERVICE_ACCOUNT_JSON`
- Optional:
  - `GOOGLECHAT_WEBHOOK_HOST`
  - `GOOGLECHAT_WEBHOOK_PORT`
  - `GOOGLECHAT_WEBHOOK_PATH`

### Microsoft Teams

- Required:
  - `MSTEAMS_APP_ID`
  - `MSTEAMS_APP_SECRET`
- Optional:
  - `MSTEAMS_WEBHOOK_HOST`
  - `MSTEAMS_WEBHOOK_PORT`
  - `MSTEAMS_WEBHOOK_PATH`

### LINE

- Required:
  - `LINE_CHANNEL_ACCESS_TOKEN`
- Optional:
  - `LINE_CHANNEL_SECRET`
  - `LINE_WEBHOOK_HOST`
  - `LINE_WEBHOOK_PORT`
  - `LINE_WEBHOOK_PATH`

### Matrix

- Required:
  - `MATRIX_HOMESERVER_URL`
  - `MATRIX_ACCESS_TOKEN`
- Optional:
  - `MATRIX_SINCE_TOKEN`

### Mattermost

- Required:
  - `MATTERMOST_SERVER_URL`
  - `MATTERMOST_BOT_TOKEN`
- Optional:
  - `MATTERMOST_WEBHOOK_HOST`
  - `MATTERMOST_WEBHOOK_PORT`
  - `MATTERMOST_WEBHOOK_PATH`

### Signal

- Required:
  - `SIGNAL_SERVICE_URL`
  - `SIGNAL_ACCOUNT`

### WeCom

- Required:
  - `WECOM_CORP_ID`
  - `WECOM_SECRET`
  - `WECOM_AGENT_ID`
- Optional:
  - `WECOM_WEBHOOK_HOST`
  - `WECOM_WEBHOOK_PORT`
  - `WECOM_WEBHOOK_PATH`

### DingTalk

- Required:
  - `DINGTALK_APP_KEY`
  - `DINGTALK_APP_SECRET`
- Optional:
  - `DINGTALK_DEFAULT_WEBHOOK`
  - `DINGTALK_WEBHOOK_HOST`
  - `DINGTALK_WEBHOOK_PORT`
  - `DINGTALK_WEBHOOK_PATH`

For exact channel semantics, load only the corresponding channel reference file.
