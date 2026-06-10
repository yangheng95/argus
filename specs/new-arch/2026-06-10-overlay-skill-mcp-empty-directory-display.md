# Overlay Skill/MCP Empty Directory Display

## Problem

The overlay Skill and MCP panels render from `appStore.skills` and `appStore.mcp`. Those stores start empty. The backing API routes `/skill/installed` and `/mcp` are project-scoped and require `directory` or `x-opencorvus-directory`; when `activeDirectory()` is empty the client cannot inject a directory and the server returns `DirectoryRequiredError`.

The visible result is a misleading empty panel: `skill.none_custom` / `mcp.none` looks like no skills or MCP servers exist, when the real issue is that the project-scoped source is unavailable until a workspace is selected.

Follow-up investigation found a second path: the left tool panels are separate Solid roots. Letting those roots implicitly read and sync active directory made the request source fragile during settings hydration, task restore, and panel switching. Memory could also clear itself while hidden when `taskID` or directory was not ready, then never show the task-scoped files the user expected.

## Call Points

| Surface | File | Decision |
| --- | --- | --- |
| Installed Skill loader | `packages/overlay/src/components/settings/SkillMarketPanel.tsx` | Keep scoped loader, add explicit active-directory guard and visible warning. |
| MCP loader | `packages/overlay/src/components/settings/SkillMarketPanel.tsx` | Keep scoped refresh, add explicit active-directory guard and visible warning. |
| Memory loader | `packages/overlay/src/components/MemoryPanel.tsx` | Make active state, task ID, and active directory explicit reactive dependencies; do not request task memory without a directory. |
| Left panel mounts | `packages/overlay/src/main.tsx` | Pass `activeDirectory` and panel active state into Skill, MCP, and Memory roots. |
| Project-scope reload | `packages/overlay/src/services/config.ts` | Use `activeDirectory()` instead of `settingsStore.directory`, then sync API directory context before project-scoped requests. |
| Workspace directory API context | `packages/overlay/src/services/workspace.ts` | Add a single `syncActiveDirectoryApiContext()` helper for panel requests. |
| Skill market loader | `packages/overlay/src/components/settings/SkillMarketPanel.tsx` | Already checks `activeDirectory()`; leave as source pattern. |
| API directory injection | `packages/overlay/src/services/api.ts` | No change; `/skill/installed` and `/mcp` remain project-scoped. |
| Server middleware | `packages/opencorvus/src/server/server.ts` | No change; strict directory requirement is correct. |
| Server routes | `packages/opencorvus/src/server/routes/app.ts`, `packages/opencorvus/src/server/routes/mcp.ts`, `packages/opencorvus/src/server/routes/skill.ts` | No change; the data depends on `Instance.directory`. |
| Browser coverage | `packages/overlay/test/browser/side-activity-toolbar-browser.test.ts` | Restore a task and assert Skill, MCP, and Memory rows render through real panel clicks. |
| Source contract coverage | `packages/overlay/test/project-directory-request-loop.test.ts` | Extend string checks for the new explicit directory guard. |

## Implementation

Do not add a fallback directory. The server intentionally rejects project-scoped routes without a directory. The UI should instead surface the missing workspace as the single root cause.

1. Add an optional `directory` prop to `SkillsPanel`, `McpPanel`, and `SkillMarketPanel`; when present, configure the API client from that value before project-scoped requests.
2. Pass `activeDirectory` from `main.tsx` into the left Skill and MCP roots, and only refresh MCP while its left panel is active.
3. Add optional `active` and `directory` props to `MemoryPanel`; load only when active and when both task ID and directory are available.
4. Keep the settings-dialog fallback path intact by using `syncActiveDirectoryApiContext()` when a caller does not provide a directory prop.
5. Keep stores unchanged on missing directory; do not rewrite skills/MCP/memory to empty as a substitute for a real project context.

## Verification

- `bun test --timeout 60000 packages/overlay/test/left-activity-toolbar.test.ts packages/overlay/test/project-directory-request-loop.test.ts packages/overlay/test/memory-panel-detail-dialog.test.ts`
- `$env:OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER='1'; node --test --test-concurrency=1 packages/overlay/test/browser/side-activity-toolbar-browser.test.ts`
- `bun run --cwd packages/overlay typecheck`
- A no-directory request to `/skill/installed` and `/mcp` has been observed returning `DirectoryRequiredError`; this is expected server behavior, not the UI fix target.
