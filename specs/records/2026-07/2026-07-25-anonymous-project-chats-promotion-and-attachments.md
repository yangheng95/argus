# Anonymous Project, Chats Promotion, and Attachments

## Recall

### User requirements

- Mission, Chat, and Work started without an explicit directory share one concrete anonymous project.
- Entering the UI without an explicit directory creates that project beneath the OpenCorvus writable installation-data root using `projects/YYYY/MM/DD/<uuid-v4>`.
- `Chats` is a left-Dock classification. Each anonymous project remains identifiable there and offers “Convert to named project”.
- Conversion moves the complete project to a user-selected destination, preserves identity/history/attachments, and rewrites every authoritative stored path.
- Screenshot/image attachments must work before and after conversion.
- The anonymous creation, attachment, and conversion flow requires real end-to-end and visual testing.

### Acceptance criteria

- Before the first project-scoped request, cold-start and Close Project create and activate one fresh backend-owned anonymous Git project; a New Chat reuses the currently active anonymous project.
- A saved explicit directory remains authoritative. Anonymous runtime selection is never persisted as though the user explicitly chose it.
- The Overlay has no empty-directory Chat or Task fallback. Mission, Chat, Work, config, attachment upload, and conversation creation all receive the same active anonymous directory.
- Anonymous paths are recognized only by the canonical dated UUID layout beneath `Global.Path.data/projects`.
- `Chats` renders each anonymous project once, preserves project grouping, and exposes conversion without duplicating its Chats under `Projects`.
- Conversion validates a single-segment name and existing destination parent, rejects path overlap/existing targets and active prompt ownership, preserves the project ID and complete directory including `.git` and `.opencorvus`, rewrites `project.worktree`, `project.sandboxes`, every project session directory, and Mission `metadata.mission.cwd`, then disposes the old Instance.
- Cross-filesystem moves use one rollback-capable quarantine/copy/publish transaction; no second identity, alias, fallback path, or partial database source is retained.
- Canonical project-ID attachment URLs and bytes remain readable after conversion.
- Focused tests, generated API/SDK/docs checks, real Node-launched Vite interaction, screenshot inspection, and a second diff review pass succeed.

### Hard constraints

- Preserve every unrelated dirty change in the shared main worktree; do not stash, reset, restore, broadly stage, or create another worktree.
- Do not restart, close, refresh, or otherwise interfere with a running OpenCorvus/overlay process.
- Use `ImplicitProject.create()` and `Project.initGit()` as the only allocator/initializer. Do not add a client-generated path, stable `projects/temporary`, server-CWD fallback, duplicate config store, hidden message, or state machine.
- “Installation directory” means writable `Global.Path.data`, not an application bundle or executable directory.
- Conversion may refuse live prompt ownership as a data-integrity constraint; it must not stop or cancel work implicitly.
- Use Node, not Bun, for Playwright.
- Commit subjects use the `dsw-33987` prefix and push through normal hooks to `legacy-remote/v0.0.18beta`.

### Sources read

- `specs/current/architecture/{02-data,03-control,05-config}.md`
- `specs/records/2026-07/2026-07-10-default-generated-workspace-startup.md`
- `specs/records/2026-07/2026-07-16-global-new-chat-implicit-project-and-visible-provider-errors.md`
- `specs/records/2026-07/2026-07-15-empty-home-layout-state-ownership.md`
- `packages/opencorvus/src/project/{implicit-project,project,instance,bootstrap}.ts`
- `packages/opencorvus/src/{attachment/store,mission/session}.ts`
- `packages/opencorvus/src/{project/project.sql,session/session.sql}.ts`
- `packages/opencorvus/src/{chat/global-chat-service,task-api/global-task-service}.ts`
- `packages/opencorvus/src/server/routes/{global,orchestrator}.ts`
- `packages/overlay/src/services/{init,workspace,project-directory,coding-assistant,task,config,config-load}.ts`
- `packages/overlay/src/store/settings.ts`
- `packages/overlay/src/components/{WorkLedger,ProjectLedgerGroup}.tsx`
- `packages/overlay/src/utils/project-directory.ts`
- Focused backend, Overlay unit, and browser tests returned by the whole-repository searches below.

### Whole-repository search and call-site decisions

| Owner / call site | Current behavior | Decision |
| --- | --- | --- |
| `ImplicitProject.create()` | Creates a dated UUID Git project under `Global.Path.data`. | Keep as the only anonymous allocator; expose it directly for connected UI activation and add canonical anonymous classification plus promotion here. |
| `GlobalChatService.create()` / `POST /global/chat` | Allocates a new dated UUID project and Chat. | Keep for non-Overlay global API callers; the connected Overlay no longer calls it. |
| `GlobalTaskService.create()` / `POST /global/tasks` | Allocates a new dated UUID project and Task. | Keep for non-Overlay global API callers; the connected Overlay no longer uses it as an empty-directory fallback. |
| `GlobalRoutes` project discovery area | Owns control-plane project endpoints. | Add `POST /global/projects/anonymous`; every call creates one fresh anonymous project. |
| `ProjectRoutes` current project area | Renames only the database label. | Add one project-scoped promotion route whose service moves the directory and rewrites identity-bearing paths. |
| `init.loadInitialData()` | Restores a saved directory or continues with no directory, skipping all project loads. | Create and activate one dated anonymous project before the first config/task/meta/extension load when no saved explicit directory exists. |
| `workspace.ensureDefaultDirectory()` | Leaves the connected UI empty without a saved directory. | Restore explicit saved state; otherwise create and activate one fresh anonymous project without writing `savedDirectory`. |
| `workspace.closeProject()` | Leaves global creation branches active. | Create and activate a fresh anonymous project. |
| `workspace.openGlobalChatLauncher()` | Closes active projects and defers allocation. | Reuse an active anonymous project; otherwise create one and activate it before composing. |
| attachment upload/store | Upload uses active directory; storage and URLs use project ID. | Fix missing ownership through startup activation; preserve project ID and move `.opencorvus` so URLs and bytes survive promotion. |
| `createGlobalCodingAssistantSession()` | Empty-directory Chat fallback. | Delete from the Overlay; Chat creation always uses `createCodingAssistantSession({ directory })`. |
| `task.createTask()` | Chooses `/task` or `/global/tasks` from directory presence. | Require the concrete active directory and use `/task`; missing ownership is an error, not another allocation path. |
| `main.tsx` Chat submit | Chooses project Chat or global Chat. | Require the active directory and call the project Chat factory once. |
| settings/config loaders and panels | Choose project or global routes based on directory presence. | Startup ordering guarantees the temporary directory before initial project configuration; keep backend global routes for control-plane access, but verify the connected UI requests the project config path. |
| `isImplicitProjectDirectory()` | Recognizes dated UUID projects. | Keep that single canonical rule; stable/named directories are not anonymous. |
| `WorkLedgerProjectGroupView` implicit fallback | Renders anonymous rows without a project header. | Render one anonymous project group per directory beneath `Chats`, with conversion action; do not duplicate its Chat rows. |
| `ProjectTable`, `SessionTable`, Mission metadata | Persist worktree, sandbox, session directory, and Mission cwd paths. | Rewrite them in one database transaction while preserving project/session/task IDs. |
| `Instance` cache and live prompt ownership | Runtime state is keyed by directory. | Reject active prompt controllers and dispose the source Instance before publishing the moved identity. |
| Work Ledger organization projections | Include every Chat in Projects / one-list output. | Exclude only implicit Chats from those projections because `Chats` becomes their single Dock owner. |
| titlebar, Work Ledger, and project deletion callers of close/new Chat | Call synchronous empty-directory transitions. | Await the temporary-project transition and surface failures through the existing diagnostics path. |
| `workspace-discovery-service`, coding-assistant, task, Work Ledger, API-injection, route, and browser tests | Assert the old empty/global branches or anonymous implicit rows. | Replace those expectations with one active dated anonymous owner, exact project-scoped requests, distinct `Chats` project groups, no duplicate rows, conversion, attachment continuity, and visible screenshot evidence. |

### Independent agent feedback

- None. The user did not request sub-agents; current instructions prohibit unsolicited delegation.

## Causal chain

Connected UI with no saved directory → project bootstrap remains empty → config and attachment requests lack ownership while Chat/Task global branches allocate unrelated projects → Mission/Chat/Work diverge → anonymous screenshots fail because upload has no active directory → Work Ledger discards anonymous project identity → no safe path exists to turn that work into a user-owned named directory.

## Implementation plan

1. Expose fresh `ImplicitProject.create()` through the global control plane and activate it before connected UI bootstrap.
2. Remove Overlay empty-directory Chat/Task paths and use the active anonymous directory for Mission, Chat, Work, config, and attachment upload.
3. Implement rollback-capable anonymous promotion with exact path/identity rewrites and post-move Instance disposal.
4. Render distinct anonymous project groups under `Chats` and wire the destination/name conversion dialog through existing UI and native directory primitives.
5. Test allocation, rejection/rollback, metadata/path rewrite, attachment bytes/URL continuity, and Overlay interaction; regenerate API/SDK/docs.
6. Run isolated Vite with Node Playwright, exercise real file input and conversion requests, inspect desktop screenshots, repair discrepancies, and perform a second diff review.

## Verification record

- Backend route/storage integration: focused anonymous creation and promotion tests passed. The promotion test performs a real `/attachment` PNG upload, moves the project, fetches the same project-ID URL afterward, and verifies Git, project ID, Session directory, and Mission `cwd`.
- Overlay regression matrix: 96 focused tests passed across workspace activation/closure, directory classification, Chat/Task/Mission ownership, attachment upload, Work Ledger grouping/actions, titlebar, and project controls.
- Static validation: OpenCorvus and Overlay TypeScript checks, generated JavaScript SDK/OpenAPI, bilingual API docs, `api:routes-check`, `docs:check`, `git diff --check`, and historical-doc links passed.
- Real UI: Node-launched Vite/Playwright passed `global-new-chat-provider-error-browser.test.ts`. It created one anonymous project, uploaded a real browser `File` containing PNG bytes through the composer, submitted its canonical attachment URL, rendered one anonymous group under `Chats`, opened the existing project-action Dropdown, and sent one conversion request with the exact anonymous source, selected parent, and name.
- Screenshots inspected: `.scratch/anonymous-project-promotion-menu.png` visibly shows `Chats → 匿名项目 → 匿名项目中的已有对话` and the primitive-backed `转换为实名项目` menu action; `.scratch/default-anonymous-project-chats-dock-provider-error.png` shows the settled desktop layout without duplicate titlebar or project row.
- The complete `coding-routes.test.ts` run had 19 passes plus two unrelated failures whose old assertions expect spoofed extra/source payloads to be accepted; current concurrent strict prompt validation correctly returns 400. The task-owned anonymous tests pass independently.
- The monolithic `bun test packages/overlay/test` runner was stopped after it demonstrated cross-file global mock contamination and many unrelated concurrent failures; focused files pass when isolated. Document health has one unrelated tracked-file failure for the concurrent untracked `2026-07-25-api-doc-calibration.md` README entry; this record's own link will become tracked with the task commit.
