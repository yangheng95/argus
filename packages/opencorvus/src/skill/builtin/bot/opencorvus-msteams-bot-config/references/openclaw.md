# OpenClaw and Microsoft Teams Reference

## Snapshot

Research date: 2026-03-03.

## Verified OpenClaw facts

- OpenClaw marks Microsoft Teams as experimental.
- Channel catalog indicates plugin requirement for Teams.
- OpenClaw Teams provider docs describe plugin installation and Bot Framework app credentials.
- Example env names in docs include app ID, app password, and tenant ID.
- Docs include webhook path setup for inbound activities.

## OpenCorvus mapping

OpenCorvus source of truth:

- `packages/bot/src/registry.ts`
- `packages/bot/src/adapters/msteams.ts`
- `packages/bot/.env.example`

OpenCorvus env keys:

- Required: `MSTEAMS_APP_ID`, `MSTEAMS_APP_SECRET`
- Optional: `MSTEAMS_WEBHOOK_HOST`, `MSTEAMS_WEBHOOK_PORT`, `MSTEAMS_WEBHOOK_PATH`
- Compatibility fallback: `OPENCLAW_MSTEAMS_APP_ID`, `OPENCLAW_MSTEAMS_APP_SECRET`

Runtime notes:

- Adapter hosts webhook endpoint and keeps per-conversation session cache.
- Outbound token acquisition uses Bot Framework OAuth endpoint (`botframework.com` tenant).
- Outbound media is text fallback in current MVP (no native image upload flow).

## Differences to keep explicit

- OpenClaw docs commonly show `MSTEAMS_APP_PASSWORD` and `MSTEAMS_TENANT_ID`.
- OpenCorvus adapter expects `MSTEAMS_APP_SECRET` and does not require tenant ID env today.

## Verification checklist

1. Start bot and confirm Teams webhook path is listening.
2. Send one Teams message and confirm adapter caches conversation session.
3. Confirm one outbound reply in same conversation.
4. If send fails, re-check app credentials and Azure bot registration channel settings.

## Sources

- OpenClaw channels overview: https://docs.openclaw.ai/channels
- OpenClaw Microsoft Teams docs: https://docs.openclaw.ai/channels/msteams
- OpenClaw Teams provider page: https://docs.openclaw.ai/providers/msteams
- Microsoft Teams bot docs: https://learn.microsoft.com/microsoftteams/platform/bots/what-are-bots
