# Settings Status Label Single Source

Date: 2026-06-20

## Problem

The settings surfaces still keep two local status-label maps that return the raw
backend enum for unknown statuses:

- `packages/overlay/src/components/settings/ChannelsPanel.tsx`
- `packages/overlay/src/components/settings/SkillMarketPanel.tsx`

This is the same visible-UI failure mode as the task status cleanup, but these
are separate settings domains. A new backend status would appear as raw
lowercase text in a `SettingsPill`, and the tone helper would silently render it
as neutral.

## Sources Of Truth

| Domain | Authoritative source | Allowed display statuses |
| --- | --- | --- |
| Channel configuration status | `packages/opencorvus/src/channel/registry.ts` `ChannelRegistry.Info.status` | `disabled`, `configured`, `partial`, `missing` |
| MCP connection status | `packages/opencorvus/src/mcp/index.ts` `MCP.Status` and `packages/opencorvus/src/server/routes/mcp.ts` response schema | `connected`, `disabled`, `disconnected`, `connecting`, `failed`, `needs_auth`, `needs_client_registration` |

`ChannelRegistry.Info.runtime_status` is a different domain and must not be
merged into the channel configuration pill. The current channel panel only
renders `status`, not `runtime_status`.

## Call-Site Inventory

`rg -n "channelStatusLabel\\(|channelStatusTone\\(|mcpStatusLabel\\(|mcpStatusTone\\(|return map\\[status\\] \\|\\| status|translated === key \\?" packages/overlay/src packages/overlay/test`

| Call site | Decision |
| --- | --- |
| `ChannelsPanel.tsx` local `channelStatusLabel` | Replace with strict shared helper. Unknown non-empty status must throw. |
| `ChannelsPanel.tsx` local `channelStatusTone` | Replace with strict shared tone helper so label and tone use the same status domain. |
| `SkillMarketPanel.tsx` local `mcpStatusLabel` | Replace with strict shared helper. Unknown non-empty status must throw. |
| `SkillMarketPanel.tsx` local `mcpStatusTone` | Replace with strict shared tone helper. |
| `SkillMarketPanel.tsx` `item?.status || "disabled"` | Keep an explicit optional-status projection helper because `McpItem.status` is optional in the overlay shape. Empty/missing status maps to the configured disabled display state; unknown non-empty status throws. |
| `project-directory-request-loop.test.ts` string guard for local MCP map | Update the guard to require helper imports and reject local maps. |
| Existing i18n keys | Reuse the existing `channel.status.*` and `mcp.status.*` keys. Do not edit translation files in this round. |

## Design

Add `packages/overlay/src/utils/settings-status-labels.ts`:

- `channelConfigurationStatusLabelFromString(status)` accepts only
  `disabled|configured|partial|missing`.
- `channelConfigurationStatusToneFromString(status)` uses the same parsed
  channel status domain.
- `mcpConnectionStatusLabelFromString(status)` accepts only
  `connected|disabled|disconnected|connecting|failed|needs_auth|needs_client_registration`.
- `mcpConnectionStatusToneFromString(status)` uses the same parsed MCP domain.
- `mcpConnectionStatusOrDisabledLabel(status)` and
  `mcpConnectionStatusOrDisabledTone(status)` are the only entry point for the
  optional overlay `McpItem.status` shape. They map empty/missing status to the
  explicit `disabled` state and reject unknown non-empty values.

No visible status-label path may return the input enum as display text.

## Tests

- Unit/static test covers all allowed statuses, unknown-status rejection, and
  adoption guards for both settings panels.
- Browser test extends the existing compact MCP panel coverage to screenshot
  the status pills and assert localized labels/tone values before destructive
  actions run.

## Non-Goals

- Do not change backend `MCP.Status` or `ChannelRegistry.Info` schemas.
- Do not expose channel `runtime_status` in the channel panel in this round.
- Do not touch unrelated Mission project archive or world-economy work already
  dirty in the main worktree.
