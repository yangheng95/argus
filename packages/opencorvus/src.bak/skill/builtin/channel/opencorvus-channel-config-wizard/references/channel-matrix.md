# OpenCorvus Channel Runtime Matrix

## Purpose

Use this matrix to keep unified setup logic while supporting channel-specific required env keys.
This file is for execution planning and official-source routing, not for replacing platform official docs.

## Source Of Truth

- `packages/channel-runtime/src/registry.ts`
- `packages/channel-runtime/src/main.ts`
- `packages/channel-runtime/.env.example`
- `packages/overlay/src/manager.js` (`Environment Variables` groups in overlay UI)

## Default Mode

- Overlay-guided first.
- Text-guided fallback on request or when desktop confirmation is unavailable.

## Overlay Path (New UI)

1. Open `Channel Config` in overlay.
2. Click `Environment Variables`.
3. Fill channel keys:
   - use built-in rows in `Channel Integrations` when present;
   - use `+ Add Custom Env` for all other keys.
4. Click `Save Config`.
5. Start or restart channel runtime from `Runtime`.
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

- Official setup:
  - `https://api.slack.com/apps`
  - `https://api.slack.com/apis/connections/socket`
  - `https://api.slack.com/authentication/token-types`
- Required:
  - `SLACK_BOT_TOKEN`
  - `SLACK_APP_TOKEN`
- Optional:
  - `SLACK_SIGNING_SECRET`
  - `SLACK_CHANNEL_ID`
- Ask user to paste:
  - `SLACK_BOT_TOKEN`
  - `SLACK_APP_TOKEN`
  - `SLACK_SIGNING_SECRET` only for HTTP verification flow

### Telegram

- Official setup:
  - `https://core.telegram.org/bots#6-botfather`
  - `https://core.telegram.org/bots/features#privacy-mode`
  - `https://core.telegram.org/bots/api`
- Required:
  - `TELEGRAM_BOT_TOKEN`
- Ask user to paste:
  - `TELEGRAM_BOT_TOKEN`

### Discord

- Official setup:
  - `https://discord.com/developers/applications`
  - `https://discord.com/developers/docs/quick-start/getting-started`
  - `https://discord.com/developers/docs/events/gateway#gateway-intents`
- Required:
  - `DISCORD_BOT_TOKEN`
- Ask user to paste:
  - `DISCORD_BOT_TOKEN`

### Feishu or Lark

- Official setup:
  - `https://open.feishu.cn/app`
  - `https://open.feishu.cn/document/`
- Required:
  - `FEISHU_APP_ID`
  - `FEISHU_APP_SECRET`
- Optional:
  - `FEISHU_WEBHOOK_HOST`
  - `FEISHU_WEBHOOK_PORT`
  - `FEISHU_WEBHOOK_PATH`
  - `FEISHU_VERIFICATION_TOKEN`
- Ask user to paste:
  - `FEISHU_APP_ID`
  - `FEISHU_APP_SECRET`
  - `FEISHU_VERIFICATION_TOKEN` only if token verification is enabled
  - `FEISHU_WEBHOOK_*` only if webhook listener settings must be overridden

### WhatsApp

- Official setup:
  - `https://developers.facebook.com/apps/`
  - `https://developers.facebook.com/docs/whatsapp/cloud-api/get-started`
  - `https://developers.facebook.com/docs/whatsapp/embedded-signup/`
- Required:
  - `WHATSAPP_ACCESS_TOKEN`
  - `WHATSAPP_PHONE_NUMBER_ID`
- Optional:
  - `WHATSAPP_VERIFY_TOKEN`
  - `WHATSAPP_WEBHOOK_HOST`
  - `WHATSAPP_WEBHOOK_PORT`
  - `WHATSAPP_WEBHOOK_PATH`
- Ask user to paste:
  - `WHATSAPP_ACCESS_TOKEN`
  - `WHATSAPP_PHONE_NUMBER_ID`
  - `WHATSAPP_VERIFY_TOKEN` only if webhook verification is enabled
  - `WHATSAPP_WEBHOOK_*` only if webhook listener settings must be overridden

### Google Chat

- Official setup:
  - `https://console.cloud.google.com/`
  - `https://developers.google.com/workspace/chat/authenticate-authorize-chat-app`
  - `https://developers.google.com/workspace/chat/create-chat-app`
- Required:
  - `GOOGLECHAT_SERVICE_ACCOUNT_JSON`
- Optional:
  - `GOOGLECHAT_WEBHOOK_HOST`
  - `GOOGLECHAT_WEBHOOK_PORT`
  - `GOOGLECHAT_WEBHOOK_PATH`
- Ask user to paste:
  - `GOOGLECHAT_SERVICE_ACCOUNT_JSON` as a file path when possible, raw JSON only as fallback
  - `GOOGLECHAT_WEBHOOK_*` only if webhook listener settings must be overridden

### Microsoft Teams

- Official setup:
  - `https://portal.azure.com/`
  - `https://learn.microsoft.com/microsoftteams/platform/bots/how-to/create-a-bot-in-teams`
  - `https://learn.microsoft.com/azure/bot-service/bot-service-quickstart-registration`
- Required:
  - `MSTEAMS_APP_ID`
  - `MSTEAMS_APP_SECRET`
- Optional:
  - `MSTEAMS_WEBHOOK_HOST`
  - `MSTEAMS_WEBHOOK_PORT`
  - `MSTEAMS_WEBHOOK_PATH`
- Ask user to paste:
  - `MSTEAMS_APP_ID`
  - `MSTEAMS_APP_SECRET`
  - `MSTEAMS_WEBHOOK_*` only if webhook listener settings must be overridden

### LINE

- Official setup:
  - `https://developers.line.biz/console/`
  - `https://developers.line.biz/en/docs/messaging-api/getting-started/`
  - `https://developers.line.biz/en/docs/messaging-api/channel-access-tokens/`
- Required:
  - `LINE_CHANNEL_ACCESS_TOKEN`
- Optional:
  - `LINE_CHANNEL_SECRET`
  - `LINE_WEBHOOK_HOST`
  - `LINE_WEBHOOK_PORT`
  - `LINE_WEBHOOK_PATH`
- Ask user to paste:
  - `LINE_CHANNEL_ACCESS_TOKEN`
  - `LINE_CHANNEL_SECRET` only if webhook signature verification is enabled
  - `LINE_WEBHOOK_*` only if webhook listener settings must be overridden

### Matrix

- Official setup:
  - `https://spec.matrix.org/latest/client-server-api/#post_matrixclientv3login`
  - `https://spec.matrix.org/latest/client-server-api/#client-authentication`
- Required:
  - `MATRIX_HOMESERVER_URL`
  - `MATRIX_ACCESS_TOKEN`
- Optional:
  - `MATRIX_SINCE_TOKEN`
- Ask user to paste:
  - `MATRIX_HOMESERVER_URL`
  - `MATRIX_ACCESS_TOKEN`
  - `MATRIX_SINCE_TOKEN` only if they want to resume from an existing sync checkpoint

### Mattermost

- Official setup:
  - `https://docs.mattermost.com/integrations-guide/overview-of-integrations.html`
  - `https://docs.mattermost.com/administration-guide/configure/integrations-configuration-settings.html`
  - `https://docs.mattermost.com/administration-guide/manage/mmctl-command-line-tool.html`
- Required:
  - `MATTERMOST_SERVER_URL`
  - `MATTERMOST_BOT_TOKEN`
- Optional:
  - `MATTERMOST_WEBHOOK_HOST`
  - `MATTERMOST_WEBHOOK_PORT`
  - `MATTERMOST_WEBHOOK_PATH`
- Ask user to paste:
  - `MATTERMOST_SERVER_URL`
  - `MATTERMOST_BOT_TOKEN`
  - `MATTERMOST_WEBHOOK_*` only if webhook listener settings must be overridden

### Signal

- Official setup:
  - `https://github.com/bbernhard/signal-cli-rest-api`
  - `https://github.com/AsamK/signal-cli`
- Required:
  - `SIGNAL_SERVICE_URL`
  - `SIGNAL_ACCOUNT`
- Ask user to paste:
  - `SIGNAL_SERVICE_URL`
  - `SIGNAL_ACCOUNT`
  - No provider-issued bot token exists for this channel in the current OpenCorvus integration

### WeCom

- Official setup:
  - `https://work.weixin.qq.com/`
  - `https://developer.work.weixin.qq.com/`
- Required:
  - `WECOM_CORP_ID`
  - `WECOM_SECRET`
  - `WECOM_AGENT_ID`
- Optional:
  - `WECOM_WEBHOOK_HOST`
  - `WECOM_WEBHOOK_PORT`
  - `WECOM_WEBHOOK_PATH`
- Ask user to paste:
  - `WECOM_CORP_ID`
  - `WECOM_SECRET`
  - `WECOM_AGENT_ID`
  - `WECOM_WEBHOOK_*` only if webhook listener settings must be overridden

### DingTalk

- Official setup:
  - `https://open.dingtalk.com/`
  - `https://open.dingtalk.com/tutorial/`
- Required:
  - `DINGTALK_APP_KEY`
  - `DINGTALK_APP_SECRET`
- Optional:
  - `DINGTALK_DEFAULT_WEBHOOK`
  - `DINGTALK_WEBHOOK_HOST`
  - `DINGTALK_WEBHOOK_PORT`
  - `DINGTALK_WEBHOOK_PATH`
- Ask user to paste:
  - `DINGTALK_APP_KEY`
  - `DINGTALK_APP_SECRET`
  - `DINGTALK_DEFAULT_WEBHOOK` only if they want a fixed group webhook fallback
  - `DINGTALK_WEBHOOK_*` only if webhook listener settings must be overridden

### QQ Bot

- Official setup:
  - `https://q.qq.com/`
  - `https://github.com/tencent-connect/botgo`
- Required:
  - `QQ_BOT_APP_ID`
  - `QQ_BOT_APP_SECRET`
- Optional:
  - `QQ_SANDBOX`
  - `QQ_WEBHOOK_HOST`
  - `QQ_WEBHOOK_PORT`
  - `QQ_WEBHOOK_PATH`
- Ask user to paste:
  - `QQ_BOT_APP_ID`
  - `QQ_BOT_APP_SECRET`
  - `QQ_SANDBOX` only if they are still in sandbox mode
  - `QQ_WEBHOOK_*` only if webhook listener settings must be overridden

For exact channel semantics, load only the corresponding channel reference file.
