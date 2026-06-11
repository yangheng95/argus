# CWD project discovery and editable directory

## Requirement

The workspace cwd control must support:

- scanning the server launch directory for local projects that contain `.opencorvus`;
- editing the directory address directly in the UI, then switching through the existing project switch lifecycle.

## Call points checked

| Surface | Existing owner | Decision |
| --- | --- | --- |
| `packages/opencorvus/src/server/server.ts` | project-scoped directory middleware | Keep explicit `directory` required for project routes. Do not reintroduce `process.cwd()` fallback. |
| `packages/opencorvus/src/server/routes/global.ts` | control-plane routes | Add a control-plane discovery route because discovery does not require active `Instance` context. |
| `packages/opencorvus/src/project/project.ts` | project identity/list/update | Add the single backend discovery helper and schema here so route code stays thin. |
| `packages/overlay/src/services/workspace.ts` | workspace switch lifecycle and recent dirs | Add discovery service wrapper; keep `setDirectory`/`applyDirectory` as the only directory switch path. |
| `packages/overlay/src/components/TaskDirBar.tsx` | cwd dropdown | Add editable path form and detected project rows to the existing Kobalte dropdown. |
| `packages/overlay/src/components/WorkspaceOnboardingDialog.tsx` | no-directory onboarding | Reuse the same discovery service and existing `setDirectory` switch path. |
| `packages/overlay/src/components/titlebar/TitlebarMenubar.tsx` | workspace menu | No direct change required; it already has browse/recent actions and should not become a second editor implementation. |
| `packages/overlay/src/styles/surfaces/conversation.css` | cwd dropdown styling | Add styles for the cwd edit and detected rows. |
| `packages/overlay/src/styles/surfaces/workspace-onboarding.css` | onboarding styling | Reuse existing recent item styles for detected project rows. |

## Discovery semantics

Scan only the launch directory itself and its direct children. A candidate is a directory whose direct child `.opencorvus` exists and is a directory. This covers the common "projects folder" and "opened inside the project" cases without recursively scanning an entire disk.

`OPENCORVUS_PROJECT_DIR` remains the explicit launch root when provided; otherwise the scan root is `process.cwd()` for discovery only. Project-scoped API requests still require the explicit `directory` header/query parameter.

## Tests

- Server route test: `/global/projects/discover` returns the launch root and immediate child candidates containing `.opencorvus`, and skips siblings without the marker.
- Overlay service test: discovery reads `global/projects/discover`.
- Source-level UI tests: cwd dropdown and onboarding render detected-project sections and keep direct path submission routed through `setDirectory`.
