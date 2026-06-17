# Skill and MCP Panel Single Source

## Problem

The Skill and MCP (Model Context Protocol) left panels kept local `panelSkills` and
`panelMcp` copies beside `appStore.skills` and `appStore.mcp`. That made the panel
render from two possible sources: the shared extension loaders could update the
store while the panel continued to render a stale local response.

The MCP destructive path also swallowed disconnect/auth API failures before
removing `config.mcp`. A failed server mutation could therefore look successful in
the UI and delete the client-side configuration source.

## Call Points

| Surface | File | Decision |
| --- | --- | --- |
| Skill/MCP panel render source | `packages/overlay/src/components/settings/SkillMarketPanel.tsx` | Render only from `appStore.skills`, `appStore.skillMarket`, and `appStore.mcp`; loaders update the store and do not keep panel-local copies. |
| Installed Skill loader | `packages/overlay/src/services/extensions.ts` | Keep as the single store writer through `setSkills`. |
| MCP loader | `packages/overlay/src/services/extensions.ts` | Keep as the single store writer through `setMcp`. |
| Extension store contract | `packages/overlay/src/store/app.ts` | Keep array/object defaults and setters as the authoritative data shape. |
| Left panel source guards | `packages/overlay/test/project-directory-request-loop.test.ts` | Assert no panel-local Skill/MCP source remains and MCP destructive failures are not swallowed. |
| Drag/drop Skill confirm guard | `packages/overlay/test/left-activity-toolbar.test.ts` | Assert dropped Skill imports use the shared native confirmation primitive. |

## Implementation

1. Remove `panelSkills` and `panelMcp`.
2. Read Skill, market, and MCP panel data directly from the app store.
3. Let `refreshInstalledSkills` and `refreshMcpStatus` return the loader results
   without creating a second panel-local source.
4. Replace browser `confirm` calls in the panel with `nativeConfirm`.
5. Make MCP delete-all fail fast on any disconnect/auth API error before editing
   config.

## Verification

- `bun test packages/overlay/test/project-directory-request-loop.test.ts packages/overlay/test/left-activity-toolbar.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- Browser visual capture of the compact MCP panel confirmation dialog and failed
  delete-all notice.
