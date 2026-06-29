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

| Surface                       | File                                                            | Decision                                                                                                                                     |
| ----------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Skill/MCP panel render source | `packages/overlay/src/components/settings/SkillMarketPanel.tsx` | Render only from `appStore.skills`, `appStore.skillMarket`, and `appStore.mcp`; loaders update the store and do not keep panel-local copies. |
| Installed Skill loader        | `packages/overlay/src/services/extensions.ts`                   | Keep as the single store writer through `setSkills`.                                                                                         |
| MCP loader                    | `packages/overlay/src/services/extensions.ts`                   | Keep as the single store writer through `setMcp`.                                                                                            |
| Extension store contract      | `packages/overlay/src/store/app.ts`                             | Keep array/object defaults and setters as the authoritative data shape.                                                                      |
| Left panel source guards      | `packages/overlay/test/project-directory-request-loop.test.ts`  | Assert no panel-local Skill/MCP source remains and MCP destructive failures are not swallowed.                                               |
| Drag/drop Skill confirm guard | `packages/overlay/test/left-activity-toolbar.test.ts`           | Assert dropped Skill imports use the shared native confirmation primitive.                                                                   |
| Skill convenience actions     | `packages/overlay/src/components/settings/SkillMarketPanel.tsx` | Open/browse/directory actions must surface host/API failures as panel notices; user cancel may return an empty picker result.                |
| Skill directory contract      | `packages/opencorvus/src/skill/manager.ts`                      | `skill/directories` returns `{ global_config, managed_skills, remote_cache }`; the Skill panel opens `managed_skills` only.                  |
| Skill market load cache       | `packages/overlay/src/components/settings/SkillMarketPanel.tsx` | Cache the loaded directory only after `loadSkillMarket()` succeeds so a failed first request can retry on the same directory.                |
| MCP panel transaction guard   | `packages/overlay/test/browser/skill-mcp-panel-browser.test.ts` | Confirm MCP delete-all, fail auth removal, assert the panel shows the error and does not send `PATCH /config`.                               |

## Implementation

1. Remove `panelSkills` and `panelMcp`.
2. Read Skill, market, and MCP panel data directly from the app store.
3. Let `refreshInstalledSkills` and `refreshMcpStatus` return the loader results
   without creating a second panel-local source.
4. Replace browser `confirm` calls in the panel with `nativeConfirm`.
5. Make MCP delete-all fail fast on any disconnect/auth API error before editing
   config.
6. Surface `nativeOpen`, directory picker, and `skill/directories` failures in
   the panel notice instead of swallowing them.
7. Move `setLoadedMarketDirectory(directory)` after a successful market load.
8. Add panel-level browser coverage for failed MCP delete-all so config removal
   cannot run after disconnect/auth failure.

## Codex Review Feedback

Independent review on 2026-06-17 found that the first single-source repair still
left three risk classes:

- `handleOpenSkill`, `handleBrowseFolder`, and `handleOpenSkillDir` swallowed
  host/API failures.
- `loadedMarketDirectory` was written before `loadSkillMarket()` succeeded,
  making a failed market request look loaded for that directory.
- MCP delete-all was fail-fast in the service, but lacked panel-level proof that
  `updateConfig(delete current.mcp)` does not run after a backend failure.

Second independent review on 2026-06-17 found the follow-up still had four
impact areas:

- `reloadProjectScope()` awaited loaders directly, but `loadMeta()`,
  `loadExecutors()`, and core `loadConfigInfo()` routes still converted request
  failures into empty/stale store writes. Project-scope reload must reject when
  any critical project projection fails.
- `workspace.pickFiles` has one contract across the transport protocol, VS Code
  bridge, and front-end service: a string path array. Tauri still returned
  `{ filename, mime, url }` objects, which made the stricter front-end reject
  valid Tauri selections.
- Tauri directory picking treated selecting the provided start directory as
  cancellation. The user selection and cancel are distinct outcomes; same-path
  selection should be returned and the front-end no-op for unchanged directory.
- Adjacent browser tests still use DOM `node.click()` helpers; Skill/MCP coverage
  must keep using real `page.click()`/hit-tested input, and remaining panel
  browser tests should be migrated in the next GUI hardening slice.

## Verification

- `bun test packages/overlay/test/project-directory-request-loop.test.ts packages/overlay/test/left-activity-toolbar.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- Browser visual capture of the compact MCP panel confirmation dialog and failed
  delete-all notice.
