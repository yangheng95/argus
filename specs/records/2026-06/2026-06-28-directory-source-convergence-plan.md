# Directory Source Convergence Plan

Date: 2026-06-28

CWD means Current Working Directory. DB means Database. SDK means Software
Development Kit. API means Application Programming Interface. UI means User
Interface. CTA means Call To Action.

## Goal

Remove the multi-source directory generation and selection behavior that creates
random project directories under the OpenCorvus app-data root, especially:

```text
C:\Users\chuan\AppData\Local\opencorvus\<8-hex>
```

The product must have one authoritative source for each path category:

- Global runtime paths come from `Global.Path`.
- SQLite DB path comes from `Database.Path()`.
- User project directory comes from explicit user selection or explicit launch
  input, never from generated fallback directories.
- Task-owned paths must be resolved from task ownership, not from the current
  process or UI directory as a fallback.

## Recall

| Source | Constraint |
| --- | --- |
| `AGENTS.md` | No fallback, no double source, no blind patching, tests required. |
| `deleted pre-June record 2026-04-30-instance-bootstrap-darwin-cascade` | Remove `process.cwd()` as project-directory fallback; avoid implicit side effects from sidecar CWD. |
| `specs/records/2026-06/2026-06-11-cwd-project-discovery-and-edit.md` | `Project.discoverFromLaunchDirectory` is the single discovery helper; project-scoped routes still require explicit directory. |
| `specs/records/2026-06/2026-06-12-editable-cwd-default-launch-directory.md` | Introduced generated default workspace. This is now rejected by the 2026-06-28 audit because it conflicts with no fallback and explicit directory ownership. |
| `specs/records/2026-06/2026-06-20-workspace-onboarding-path-input-single-source.md` | Onboarding/manual path entry must use the existing `setDirectory` lifecycle, not a parallel directory switch path. |
| `specs/records/2026-06/2026-06-22-overlay-new-task-directory-ownership.md` | Task directory ownership must fail loud when missing or conflicting; no current-directory fallback. |

## Evidence Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n -e 'generatedDefaultDirectory' -e 'discoverFromLaunchDirectory' -e 'defaultDirectory' packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test` | `Project.discoverFromLaunchDirectory` creates and returns generated `defaultDirectory`; overlay startup adopts it. | Remove generated default behavior from backend and frontend. |
| `rg -n -e 'sidecar_cwd_dir' -e 'opencorvus_log_dir' -e 'current_dir\\(&sidecar_cwd\\)' packages/overlay/src-tauri/src/main.rs` | Tauri launches sidecar in app-data root parent of `log/`. | Keep sidecar CWD only as a process safety location; never treat it as project root. |
| `rg -n -e 'COALESCE\\(SessionTable.directory' -e 'SessionTable.directory.*ProjectTable.worktree' -e 'taskCwd' packages/opencorvus/src` | Queue/store still merge task directory from session and project roots. | Plan follow-up convergence for task CWD/runtime root. |
| App-data read-only inspection | `cache/config/data/log/state` are runtime roots; 71 random 8-hex directories are project/default-directory residue. | Runtime roots remain; random directories are cleanable after no active task references them. |

## Observed Problem

The random app-data project directories are produced by this chain:

1. Tauri computes `opencorvus_log_dir()` as `%LOCALAPPDATA%\opencorvus\log`
   on Windows, and `sidecar_cwd_dir()` returns its parent.
2. Tauri starts the backend sidecar with `cmd.current_dir(&sidecar_cwd)`.
3. The backend `/global/projects/discover` calls
   `Project.discoverFromLaunchDirectory()`.
4. Without `OPENCORVUS_PROJECT_DIR`, `launchDirectory()` uses
   `process.cwd()`, which is now `%LOCALAPPDATA%\opencorvus`.
5. `generatedDefaultDirectory(root)` creates `randomUUID().slice(0, 8)`
   under that root and returns it as `defaultDirectory`.
6. Overlay `ensureDefaultDirectory()` automatically writes that returned
   `defaultDirectory` into `settingsStore.directory`.

This means a read-style discovery route has a write side effect, and the UI
then treats the side effect as user intent.

## Root Cause

The root cause is not the app-data directory itself. The app-data root is valid
for global runtime state and logs. The root cause is that the system lets a
process CWD become a generated project directory source:

- Backend discovery has two project roots: explicit `OPENCORVUS_PROJECT_DIR`
  and fallback `process.cwd()`.
- Backend discovery writes a generated child directory during a GET request.
- Frontend startup accepts backend-generated `defaultDirectory` as an active
  workspace.
- Tests assert this behavior, so the bug is protected by current coverage.

## Non-Goals

- Do not delete app-data runtime directories (`cache`, `config`, `data`, `log`,
  `state`) as part of this code fix.
- Do not change `Global.Path` or `Database.Path()`; those are already
  sufficiently single-source for this issue.
- Do not patch `WorkspaceOnboardingDialog` or `TaskDirBar` to hide the symptom;
  they are explicit user-selection surfaces and are not the directory generator.
- Do not mix the full task CWD/runtime-root convergence into the first patch.
  It is related but broader.

## Fix Plan

### Phase 1 - Stop Generated Default Workspaces

Owner surfaces:

| File | Change |
| --- | --- |
| `packages/opencorvus/src/project/project.ts` | Delete `generatedDefaultDirectory` and the process-local cache. `discoverFromLaunchDirectory()` must be read-only. |
| `packages/opencorvus/src/project/project.ts` | Keep `OPENCORVUS_PROJECT_DIR` as the only source of `defaultDirectory`; when absent, return `defaultDirectory: ""`. |
| `packages/opencorvus/src/server/routes/global.ts` | Update route description to say discovery is read-only and never creates a project directory. |
| `packages/opencorvus/test/server/global-project-discovery.test.ts` | Replace the current short UUID creation test with a no-side-effect test. |
| `packages/sdk/openapi.json`, `packages/sdk/js/src/gen/*`, docs | Regenerate after schema/description changes if route docs change. |

Required behavior:

- `GET /global/projects/discover` scans the launch root and direct children for
  `.opencorvus` markers.
- When `OPENCORVUS_PROJECT_DIR` is set, `root` and `defaultDirectory` are that
  resolved explicit directory.
- When `OPENCORVUS_PROJECT_DIR` is absent, `root` may still report the discovery
  scan root, but `defaultDirectory` must be `""`.
- The route must not create any directory or file.

Tests:

- Use a temp CWD with no `OPENCORVUS_PROJECT_DIR`.
- Call `/global/projects/discover` twice.
- Assert `defaultDirectory === ""`.
- Assert no child matching `^[0-9a-f]{8}$` exists.
- Assert existing child projects with `.opencorvus` are still discovered.

### Phase 2 - Stop Frontend Auto-Adoption

Owner surfaces:

| File | Change |
| --- | --- |
| `packages/overlay/src/services/workspace.ts` | `ensureDefaultDirectory()` should restore `savedDirectory` only. If none exists, call discovery only to populate detected projects elsewhere, or return false without setting `directory`. |
| `packages/overlay/src/services/init.ts` | Startup should keep empty workspace state when no saved directory exists, allowing onboarding CTA. |
| `packages/overlay/test/workspace-discovery-service.test.ts` | Replace "uses backend-created default" with "does not adopt discovered/generated default without saved directory". |
| Browser tests using non-empty `defaultDirectory` fixtures | Update fixtures where they model automatic startup. Explicit user-selection tests may keep explicit directories. |

Required behavior:

- No saved directory means `settingsStore.directory` stays empty.
- Onboarding remains the user path for selecting a project.
- Detected projects can be displayed as suggestions, but selecting one must go
  through `setDirectory()` / `applyDirectory()`.

Tests:

- Fake discovery returns `defaultDirectory: "D:/workspace/1a2b3c4d"`.
- With `savedDirectory: ""`, `ensureDefaultDirectory()` returns false and leaves
  `settingsStore.directory === ""`.
- With `savedDirectory` set, it restores that exact saved directory without
  calling generated default logic.

### Phase 3 - Harden Tauri Sidecar CWD Contract

Owner surface:

| File | Change |
| --- | --- |
| `packages/overlay/src-tauri/src/main.rs` | If `fs::create_dir_all(&sidecar_cwd)` fails, return startup failure instead of continuing with inherited CWD. |
| `packages/overlay/src-tauri/src/main.rs` tests | Add coverage that sidecar CWD failure is not ignored. |

Required behavior:

- Sidecar CWD remains a safe process working directory for logs/runtime.
- Sidecar CWD is not a project source.
- CWD creation failure is a visible startup failure, not a fallback to whatever
  the OS inherited.

This is a hardening patch, not the primary fix for random directories.

### Phase 4 - Cleanup Tooling for Existing Residue

Do not silently delete user files during startup. Provide an explicit operator
cleanup path after Phase 1 and Phase 2 are merged.

Safe cleanup classification for the current machine:

| Path category | Action |
| --- | --- |
| `C:\Users\chuan\AppData\Local\opencorvus\cache` | Keep. |
| `C:\Users\chuan\AppData\Local\opencorvus\config` | Keep. |
| `C:\Users\chuan\AppData\Local\opencorvus\data` | Keep. |
| `C:\Users\chuan\AppData\Local\opencorvus\log` | Keep unless user explicitly wants old logs removed. |
| `C:\Users\chuan\AppData\Local\opencorvus\state` | Keep. |
| `C:\Users\chuan\AppData\Local\opencorvus\<8-hex>` | Removable after confirming no active task/session references it. |
| root `.gitignore` under app-data root | Removable after confirming the app-data root is not an active workspace. |

Cleanup must be explicit and evidence-backed. It must not run automatically as a
compatibility migration.

### Phase 5 - Separate Follow-Up: Task Directory and Runtime Root Convergence

This is related but should be a separate implementation pass.

Known bad sources:

| File | Problem |
| --- | --- |
| `packages/opencorvus/src/engine/queue.ts` | Uses `COALESCE(SessionTable.directory, ProjectTable.worktree)` and `taskCwd()` falls back to project worktree. |
| `packages/opencorvus/src/engine/store.ts` | Projects task directory as `session.directory ?? project.worktree ?? ""`, while filtering can use only session directory. |
| `packages/opencorvus/src/project/runtime-paths.ts` callers | Root is supplied by many callers, including `Instance.directory`, `Instance.worktree`, `Project.worktree`, and task-derived helpers. |

Target design:

- Add a single backend resolver for task directory ownership, for example
  `TaskDirectory.require(taskID)`.
- Missing task owner/session is corrupt state and must throw a typed error.
- No `Session.directory ?? Project.worktree` fallback.
- Task-owned runtime paths should go through task-owned helper APIs, not raw
  `ProjectRuntimePaths.*(Instance.directory, ...)` calls.

Tests:

- Task with missing root session must not fall back to `Project.worktree`.
- Queue snapshot, active-task listing, and global task projection must agree on
  directory ownership.
- Switching current UI directory must not change paths for an existing task.

## Implementation Order

1. Land Phase 1 backend discovery read-only change.
2. Land Phase 2 overlay startup/default-directory change.
3. Regenerate SDK/docs only if API descriptions or schema changed.
4. Land Phase 3 Tauri CWD hardening.
5. Run targeted tests and route/docs checks.
6. Only after the code no longer creates residue, perform explicit cleanup if
   requested.
7. Plan and implement Phase 5 as a separate task.

## Required Verification

Targeted commands:

```text
bun test packages/opencorvus/test/server/global-project-discovery.test.ts
bun test packages/overlay/test/workspace-discovery-service.test.ts
bun run api:routes-check
bun run docs:check
bun run typecheck
```

Add a smoke test or scripted assertion equivalent to:

```text
LOCALAPPDATA=<temp>
OPENCORVUS_PROJECT_DIR unset
GET /global/projects/discover
assert <temp>/opencorvus has no /^[0-9a-f]{8}$/ child
```

## Acceptance

- Calling `/global/projects/discover` with no explicit project dir does not
  create any directory.
- Overlay cold start with no saved directory leaves the workspace empty and
  shows the existing directory-selection CTA.
- App-data root is no longer used as a project root or default workspace source.
- Existing explicit launch directory behavior remains intact.
- Existing detected-project suggestions still work.
- Tests no longer assert creation or adoption of backend-generated default
  directories.
- No fallback or compatibility reader is added for old generated directories.

## Risk Notes

- Many overlay browser tests mock `defaultDirectory`; update only tests whose
  scenario is startup auto-selection. Tests modeling explicit selected
  directories should continue to use explicit saved/manual directory state.
- Cleaning existing app-data residue before code is fixed will only hide the
  issue; cleanup belongs after verification.
- The `/task` default auto-init and queue/store task CWD fallback are real
  adjacent violations, but bundling them into the first fix increases blast
  radius and weakens root-cause verification.
