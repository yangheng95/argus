# Global New Chat Lazy Project Persistence

## Recall

### User requirement

- “点击新建的时候，如果没有实际输入内容，则不索引到数据库”.
- Clicking the top-level New Chat entry without submitting content must not
  create or index a Project, Chat, Work, Mission, or Session in the database.

### Acceptance criteria

- Work Ledger New Chat, titlebar New Chat, and command-palette New Chat all
  enter the same empty global Composer without calling
  `POST /global/projects/anonymous`, `/global/chat`, or `/global/work`.
- Repeated New Chat clicks without a submission remain database-read-only and
  leave the active runtime directory empty.
- The first actual Code submission creates exactly one Project and Chat Session
  through `POST /global/chat`; the first Work submission uses
  `POST /global/work`.
- A first explicit Mission submission allocates exactly one anonymous Project
  at submission time, then wakes the Mission in that Project.
- Project-row New Chat remains bound to its existing Project and keeps its
  already-correct lazy Session persistence.
- Non-UI service tests prove the request boundary. Real isolated-page
  interaction and an inspected screenshot prove that the empty Composer remains
  usable; no UI automated test is added, changed, or run.

### Hard constraints

- Do not filter empty rows from Work Ledger, delete empty Projects after the
  fact, add draft-session state, add a route gate, or introduce another Project
  identity source.
- Reuse `GlobalConversationService`, `/global/chat`, `/global/work`,
  `ImplicitProject.create()`, and the existing Conversation selection path.
- Preserve the fresh Project ownership invariant at submission time, where
  durable work actually begins.
- Preserve all unrelated worktree changes; do not restart, refresh, terminate,
  or inspect the user's running Overlay process.
- Playwright, if used for manual page interaction, must run through Node.js.

### Sources read

- `AGENTS.md`.
- `specs/current/architecture/07-panel.md`.
- `specs/records/2026-07/2026-07-20-empty-workspace-provider-chat-control-plane.md`.
- `specs/records/2026-07/2026-07-27-project-new-chat-lazy-persistence.md`.
- `specs/records/2026-07/2026-07-27-fresh-temporary-project-per-global-launch.md`.
- `specs/records/2026-07/2026-07-29-single-new-chat-dock-entry.md`.
- `packages/overlay/src/main.tsx`.
- `packages/overlay/src/services/{workspace,conversation-session,chat}.ts`.
- `packages/overlay/src/components/{WorkLedger,CommandPalette}.tsx`.
- `packages/overlay/src/components/titlebar/TitlebarMenubar.tsx`.
- `packages/opencorvus/src/chat/global-chat-service.ts`.
- `packages/opencorvus/src/server/routes/{global,right-sidebar-conversation}.ts`.
- `packages/opencorvus/src/server/routes/mailbox.ts`.
- `packages/opencorvus/src/engine/mailbox.ts`.
- `packages/transport-protocol/src/index.ts`.
- `packages/overlay/src/services/{mailbox,desktop-notifications}.ts`.
- `packages/overlay/src/components/MailboxPanel.tsx`.
- Focused non-UI workspace and Conversation service tests.

### Whole-repository search

Repository-wide searches enumerated every `openGlobalChatLauncher`,
`openGlobalComposer`, `onCreateGlobalChat`, `createAnonymousProject`,
`createConversationSession`, `/global/chat`, `/global/work`, and
`/global/projects/anonymous` reference. After isolated visual acceptance exposed
the directory-free launcher's Mailbox stream error, the search was extended to
every `mailbox/events`, `loadMailbox`, acknowledgement, deletion, notification,
and `routeRequiresProjectDirectory` caller.

| Owner / call site | Current evidence | Decision |
| --- | --- | --- |
| Work Ledger top-level New Chat | Calls `main.openGlobalComposer("chat")`. | Keep the one shared entry and make its launcher non-persisting. |
| Titlebar New Chat | Calls `workspace.openGlobalChatLauncher()` directly. | Inherit the same non-persisting launcher. |
| Command palette `task:new` | Calls `workspace.openGlobalChatLauncher()` directly. | Inherit the same non-persisting launcher. |
| `main.openGlobalComposer()` | Calls the shared launcher, then selects the requested Composer mode. | Keep as the single mode-aware UI owner. |
| `workspace.openGlobalChatLauncher()` | Immediately calls `createAnonymousProject()`, applies the directory, and therefore indexes an unused Project before content exists. | Clear the selected runtime into a directory-free global draft without a write request. |
| `workspace.closeProject()` | Creates an anonymous Project as part of the separate explicit close lifecycle. | Keep unchanged; it is not the New Chat action in scope. |
| `workspace.ensureDefaultDirectory()` | Creates the startup Project when no saved directory exists. | Keep unchanged; startup ownership is outside this request. |
| `main` Conversation submit branch | Requires an active directory and calls the project-scoped Conversation create route. | Use project-scoped creation when a Project is explicit; otherwise use the existing global Chat/Work route at first submission. |
| `conversation-session.createConversationSession()` | Creates project-scoped Chat/Work Sessions and reuses the canonical selection path. | Keep and add a global sibling that shares the same response-to-selection implementation. |
| `/global/chat` and `/global/work` | Atomically create one implicit Project plus one typed Conversation Session and discard the Project if Session creation fails. | Reuse as the only global Code/Work persistence boundary. |
| `main` explicit Mission submit branch | Requires an active directory before calling `wakeMission`. | Allocate and activate the canonical anonymous Project only after a real Mission submission reaches this branch. |
| Project-row New Chat | Calls `selectWorkLedgerProject(directory)` and persists its Session only at first Chat submission. | Keep unchanged. |
| Shared route directory policy | Classified `/mailbox` as project-scoped even though its routes and store are global. | Add `/mailbox` and `/mailbox/**` to the canonical bypass policy. |
| Overlay Mailbox service | Explicitly appended `directory` to every global list, action, and stream request. | Remove the parameter and query; the returned item owns its `taskDirectory`. |
| Mailbox panel and desktop notifications | Passed the selected directory through to the global service while retaining directory only for UI request ownership and task navigation. | Keep local request ownership/navigation, remove transport coupling. |
| Mailbox server routes | Describe and implement a global registered-project projection, but tests supplied a project header. | Prove list, actions, and events work without a directory header. |

### Independent agent feedback

- None. The user did not request sub-agents, and the affected lifecycle has one
  tightly coupled workspace/Conversation owner.

## Causal chain

Observable unused Project in the database after clicking New Chat →
`openGlobalChatLauncher()` calls `createAnonymousProject()` immediately →
`POST /global/projects/anonymous` creates the filesystem Project and its durable
Project row → the user never submits content → no Session is created, but the
already indexed empty Project remains.

The defect is therefore the Project persistence boundary, not Work Ledger
projection. Filtering empty Projects, deleting them later, or weakening database
indexing would preserve the incorrect write and obscure its cause.

The first real isolated-page run then exposed a related hidden dependency:
the directory-free launcher opened `/mailbox/events` without a directory, but
the shared server policy still treated Mailbox as project-scoped. The immediate
anonymous Project had previously masked this classification error. Mailbox is a
global registered-project projection by route, store, and item schema, so
inventing a directory for the empty launcher would recreate the original
problem. The root repair is to keep Mailbox global through the shared route
policy and remove its client-side directory query entirely.

## Implementation plan

1. Make `openGlobalChatLauncher()` enter a directory-free empty workspace
   without any network write.
2. Restore the existing global Conversation creation protocol for both Chat and
   Work, sharing the canonical response selection path with project-scoped
   creation.
3. Allocate an anonymous Project at first explicit Mission submission only.
4. Restore `/mailbox` as a directory-free global route in the shared transport
   policy and remove the Overlay service's project-directory query.
5. Add focused non-UI service regressions for zero click-time writes, exact
   first-submit routes, and directory-free Mailbox requests; update current
   architecture and documentation indexes.
6. Run focused non-UI tests, typecheck/build/document health, perform real
   isolated-page interaction with an inspected screenshot, then complete a
   second diff review before commit and legacy remote push.

## Verification record

- `packages/overlay`: focused workspace, Conversation, API directory policy,
  and Mailbox stream tests passed: 145 tests, 0 failures.
- `packages/transport-protocol`: contract test passed: 20 tests, 0 failures.
- `packages/opencorvus`: Mailbox route test passed without a project header:
  5 tests, 0 failures.
- Overlay and transport-protocol typechecks passed.
- Overlay production Vite build passed; only existing dependency directive and
  chunk-size warnings were reported.
- Historical-doc link test passed: 22 tests, 0 failures. Document-health
  reached 84 passing tests and one repository-index failure because this record
  and two parallel July records were still untracked during the check.
- OpenCorvus package typecheck reached unrelated parallel changes in
  `src/task-artifact/store.ts` and failed on its `expert_squad_id`, `agent_id`,
  and `projection_hash` union narrowing. No task-owned file appeared in the
  diagnostics.
- A headed Node/Chromium run loaded the real isolated Overlay at 1440 × 1000.
  The built-in browser declined the local address, so the same isolated server
  was exercised through installed Chrome without creating a test artifact.
  Two consecutive New Chat clicks produced zero `POST`, `PUT`, `PATCH`, or
  `DELETE` requests; the Composer stayed empty, Send stayed disabled, the
  heading became `What should we build?`, and the console remained error-free,
  including the global Mailbox stream.
- The inspected screenshot showed the expected restrained empty Composer and
  unchanged two-row pre-existing Project list. Immutable SQLite counts before
  and after both clicks were identical: `project=2`, `session=0`.
- The isolated server was terminated cleanly after acceptance. Final diff
  review confirmed that the New Chat persistence boundary, first-submit
  creation, and directory-free Mailbox contract remain single-sourced; no UI
  test or unrelated parallel change is part of this delivery.
- Commit `3b551dc072` records the implementation. The legacy remote pre-push hook
  passed the full workspace typecheck, route inventory, API documentation,
  Overlay internationalization, and secret scan before pushing
  `v0.0.24beta` to `legacy-remote`.
