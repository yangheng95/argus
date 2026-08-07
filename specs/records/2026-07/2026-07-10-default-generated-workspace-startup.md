# Default Generated Workspace Startup

## Recall

### User Request

- Remove the startup prompt that asks the user to open a project.
- When no project is open, create and use a project under the OpenCorvus system-owned installation data root.
- The generated relative path must be `projects/YYYY/MM/DD/<uuid-v4>`.
- 2026-07-10 addendum: global tasks also have concrete project ownership. A
  global task request without an explicit project creates an implicit carrying
  project under the user-scoped OpenCorvus data directory with the same dated
  UUID layout. `global` is a query scope, never an `engine_task.project_id`.

### Acceptance Criteria

- A cold start and Close Project do not pre-create an empty generated project;
  they enter the global, no-active-project surface until a global task is
  submitted or the user explicitly opens a project.
- The generated leaf is a full RFC 4122 UUID version 4; year, month, and day are zero-padded local calendar segments.
- The startup onboarding component, its styles, translations, discovery helper, and tests are removed rather than hidden.
- An existing persisted or explicit launch directory remains authoritative and does not create another generated project.
- The project root comes from one host-owned writable application-data source; it never comes from `process.cwd()`, the executable directory, a discovery GET side effect, or a fallback chain.
- Desktop, VS Code, and browser host behavior is explicit in the transport capability contract.
- Runtime logs prove the pre-change empty-directory/onboarding chain and the post-change generated-directory chain.
- `POST /global/tasks` is the only implicit-project task creation entry. It
  creates one directory under
  `Global.Path.data/projects/YYYY/MM/DD/<uuid-v4>`, initializes Git, registers a
  concrete project through `Project`/`Instance`, creates the task there, and
  returns `task_id`, `project_id`, and `directory`.
- The regular project-scoped `POST /task` remains explicit-project only. No
  task creation path may persist `project_id = "global"` or a missing project.

### Hard Constraints

- Do not write projects beside the installed executable: Program Files, macOS app bundles, and package-manager install roots may be read-only or replaced during upgrades.
- “Installation directory” is interpreted as the host-provided writable OpenCorvus application-data root.
- No process-CWD source, discovery-route mutation, fallback directory, compatibility alias, timer, gate, or parallel project-open lifecycle.
- Do not restart or interfere with the user's running OpenCorvus/overlay process.
- Preserve unrelated dirty worktree changes.
- Keep debug instrumentation until a post-fix reproduction proves success.

### Sources Read

- `AGENTS.md`
- `specs/records/2026-06/2026-06-12-editable-cwd-default-launch-directory.md`
- `specs/records/2026-06/2026-06-28-directory-source-convergence-plan.md`
- `specs/records/2026-07/2026-07-09-open-project-freeze-systemic-repair.md`
- `specs/records/2026-07/2026-07-10-official-cross-platform-project-open-risk-reduction.md`
- `specs/current/architecture/02-data.md`
- `specs/current/architecture/99-principles.md`
- `packages/overlay/src/components/App.tsx`
- `packages/overlay/src/components/WorkspaceOnboardingDialog.tsx`
- `packages/overlay/src/services/init.ts`
- `packages/overlay/src/services/workspace.ts`
- `packages/overlay/src/services/project-directory.ts`
- `packages/overlay/src/store/settings.ts`
- `packages/overlay/src/services/host-transport.ts`
- `packages/overlay/src/services/tauri-transport.ts`
- `packages/overlay/src-tauri/src/main.rs`
- `packages/transport-protocol/src/index.ts`
- `packages/vscode-extension/src/transport/bridge.ts`
- `packages/opencorvus/src/global/index.ts`

### Whole-Repository Search Evidence

- `WorkspaceOnboardingDialog` is mounted only by `App.tsx`; its visible condition is `!settingsStore.directory`.
- `ensureDefaultDirectory()` is called only by `services/init.ts`; it restores `savedDirectory` and deliberately returns `false` when empty.
- `closeProject()` is owned by `services/workspace.ts`; it clears both active and saved directories, then enters the same empty state.
- `workspace.pickDir`, settings persistence, and project-editor commands share `NativeCommand` in `packages/transport-protocol/src/index.ts` and are implemented by Tauri and VS Code transports.
- Tauri's writable runtime root is resolved by official `app_local_data_dir()` in `src-tauri/src/main.rs`; backend `Global.Path.data` is independently resolved and must not become a second host path source.
- The June 28 record removed generated app-data projects because they were created by a read-only discovery GET through sidecar `process.cwd()`. This request supersedes the product behavior, but not that root-cause prohibition.
- Searches used: `rg "WorkspaceOnboardingDialog|workspace-onboarding|workspace_onboarding" packages/overlay`; `rg "ensureDefaultDirectory|ensureWorkspaceDirectory|savedDirectory|closeProject" packages/overlay`; `rg "workspace\\.pickDir|NativeCommand|overlay_settings_load|app_local_data_dir|Global\\.Path\\.data" packages`.
- Addendum searches: `rg -n "global/tasks|CreateTaskInput|TaskAccepted|EngineService.createTask|Instance.provide|Project.fromDirectory|Project.initGit|Global.Path.data|randomUUID" packages/opencorvus packages/overlay packages/transport-protocol`; `rg -n -F 'project_id === "global"' packages/opencorvus`; and all `project_id` task creation writes. Current code already rejects newly persisted pseudo-global tasks, but no global creation route allocates a concrete implicit project, while several writer/read paths still retain legacy pseudo-global special cases.

### Independent Agent Feedback

- Locke's read-only architecture review confirmed `POST /global/tasks` as the
  single entry, `Global.Path.data` as the correct server-owned root, explicit
  `Project.initGit()` as part of the write contract, and
  `task_id/project_id/directory` as the required response identity. It rejected
  both a host command and cold-start directory creation because those would
  create a second allocator and empty-project races.

## Runtime Hypotheses

- **H1:** Persisted settings load with no directory, and `ensureDefaultDirectory()` preserves that empty value.
- **H2:** `loadInitialData()` exits before project-scoped bootstrap whenever the directory is empty.
- **H3:** The startup prompt is rendered solely because `App.tsx` always mounts onboarding and its open predicate sees the empty directory.
- **H4:** `closeProject()` creates the same empty state by clearing both `directory` and `savedDirectory`, so removing only cold-start onboarding would leave a second broken path.
- **H5:** The overlay cannot safely derive a writable installation-data path itself; the host transport must return the newly created path from its single platform path authority.

## Proposed Design Boundary

The addendum supersedes the earlier host-command proposal. A host command plus
a backend task route would create two directory allocators and would not model
remote/browser server ownership correctly.

1. Add one backend implicit-project allocator rooted only at
   `Global.Path.data/projects`.
2. Add `POST /global/tasks` as its sole task-facing consumer. Validate the task
   body before filesystem mutation, create the dated UUID directory, explicitly
   initialize Git, enter it through `Instance.provide`, and invoke the existing
   `EngineService.createTask`.
3. Return concrete task/project/directory identity. Clients consume that
   response and never reconstruct the path.
4. Keep `POST /task`, explicit project open, and project discovery unchanged.
   Startup itself must not create an unused implicit project.
5. Enforce the no-rootless-task invariant at the data boundary and remove
   pseudo-global normal-path handling; reset development databases rather than
   retain compatibility behavior for invalid rows.

## Verification Plan

- Runtime reproduction before and after the change using `debug-052468.log`.
- Focused transport, workspace startup, close-project, settings, Tauri Rust, VS Code bridge, and browser tests.
- Node-run Playwright browser verification for the visible app shell with no onboarding.
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `git diff --check`
