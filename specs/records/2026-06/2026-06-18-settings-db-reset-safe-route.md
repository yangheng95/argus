# Settings DB Reset Safe Route - 2026-06-18

## Recall

- `AGENTS.md` forbids fallback, route gates that hide root causes, and blind patches. Destructive operations may keep explicit confirmation and data-integrity validation.
- `specs/records/2026-06/bug-hunt-repair-plan-2026-06-17.md` BH-024 defines the HTTP reset authority boundary: `/global/db/reset` must reject unknown absolute `projectDir` values before `Instance.disposeAll()` or `Database.reset(...)`.
- `specs/records/2026-06/2026-06-17-hexin-budget-refresh-db-sidecar-cleanup.md` keeps explicit `Database.reset()` as the destructive path after schema drift stops auto-recreating SQLite. It does not revoke the BH-024 registered-directory boundary.
- `packages/overlay/src/main.tsx` has an older hidden title double-click reset entry. The new Settings surface must call a shared service method rather than constructing the HTTP request inside the view.

## Call Point Sweep

| Surface         | Evidence                                                                                                                                                                                          | Decision                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server route    | `packages/opencorvus/src/server/routes/global.ts::POST /db/reset` validates request body, resolves registered project/sandbox, blocks active sessions, then calls `Database.reset(...)`.          | Keep registered-directory validation and fix the current route syntax. Do not accept arbitrary absolute paths to make stale SQLite easier to wipe. |
| Low-level reset | `packages/opencorvus/src/storage/db.ts::Database.reset(projectDir)` removes DB files plus project runtime paths and is shared by CLI and HTTP.                                                    | Do not move HTTP authority rules into storage; keep storage only checking absolute paths.                                                          |
| Overlay service | `packages/overlay/src/services/config.ts` owns config-related API calls.                                                                                                                          | Add `resetDatabase(projectDir)` here as the single Settings caller shape.                                                                          |
| Settings view   | `packages/overlay/src/components/settings/GeneralPanel.tsx` owns General settings UI and already uses `Button`, `SurfaceHeader`, `patchConfig`, and `reloadProjectScope`.                         | Add a destructive Database group using the existing Button primitive, explicit `window.confirm`, and service method.                               |
| Tests           | `packages/opencorvus/test/server/global-db-destructive.test.ts`, `packages/overlay/test/general-panel-db-reset.test.ts`, `packages/overlay/test/browser/general-panel-fail-fast-browser.test.ts`. | Server tests must preserve BH-024; overlay tests verify service ownership, i18n, request body, confirmation, and visible notice.                   |

## Acceptance

- Unknown absolute `projectDir` remains HTTP 400 and does not delete runtime sentinel files.
- Registered worktree and sandbox reset still pass the registered path to `Database.reset(...)`.
- Settings button is visible, uses `@ainvest`-style local Button primitive already used by the panel, asks for confirmation, posts through `resetDatabase(...)`, and shows a visible result.
- Browser verification captures the real General settings panel after the reset notice renders.
- OpenAPI is regenerated from route definitions instead of edited by hand.
