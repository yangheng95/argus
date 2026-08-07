# Fresh Temporary Project per Global Launch

## Recall

- User request: every click on `New Mission` or `New Chat` must create a new temporary project so independently launched work cannot contaminate another launch.
- Acceptance criteria: each invocation of the shared global launcher allocates and activates a distinct dated UUID project before showing the empty composer; both Work Ledger buttons use that launcher; project-row `New Chat` remains bound to its explicitly selected project; repeated invocation from either an explicit or anonymous project never reuses the previous directory.
- Hard constraints: keep `ImplicitProject.create()` and `POST /global/projects/anonymous` as the single allocator; do not add a client-generated directory, fallback, second active-project field, route gate, or compatibility path; preserve concurrent work; do not restart or refresh the running OpenCorvus / Overlay process.
- Sources read: `specs/current/architecture/07-panel.md`; the July 16 global-Chat repair; the July 25 anonymous-project architecture record; `workspace.openGlobalChatLauncher()` / `closeProject()` / `createAnonymousProject()`; `main.openGlobalComposer()` and Composer submit ownership; Work Ledger, titlebar, and command-palette launchers; Mission and Coding Assistant services; focused Overlay workspace and launcher tests.
- Whole-repository search: every `openGlobalChatLauncher`, `openGlobalComposer`, `onCreateGlobalChat`, `onCreateGlobalMission`, and `createAnonymousProject` reference was enumerated. Work Ledger `New Chat` and `New Mission` both call `openGlobalComposer()`, which calls the shared launcher. Titlebar and command-palette `New Chat` call the same launcher. Project-row `New Chat` calls `createWorkLedgerProjectChat(directory)` and must remain project-scoped. `closeProject()` and startup default ownership also allocate anonymous projects but are separate lifecycle operations.
- Independent agent feedback: none; the user did not request sub-agent work.

## Evidence and causal chain

`openGlobalChatLauncher()` currently allocates only when there is no active directory or when closing an explicit project. If the active directory already matches the canonical anonymous-project path, the launcher reuses it. Therefore a second global `New Chat` or `New Mission` click retains the first launch's project owner, and the subsequent session is persisted beside the earlier work.

Observable cross-launch contamination → shared launcher sees an existing anonymous directory → allocator is skipped → new Mission or Chat submit uses the retained directory → both launches share one project.

## Call-site decisions

| Owner / call site | Decision |
| --- | --- |
| `workspace.openGlobalChatLauncher()` | Always allocate one fresh anonymous project, activate it without persisting it as the saved explicit directory, then clear the selected conversation and focus the composer. |
| `workspace.closeProject()` | Keep its explicit close lifecycle unchanged; it still creates one anonymous owner for the resulting empty workspace. |
| `workspace.ensureDefaultDirectory()` | Keep startup-only allocation unchanged. |
| Work Ledger `New Chat` / `New Mission` | Keep both on `openGlobalComposer()` so the shared launcher guarantees identical isolation. |
| Titlebar / command-palette `New Chat` | Keep on the shared launcher and inherit the same fresh-project guarantee. |
| Project-row `New Chat` | Keep `createCodingAssistantSession({ directory })`; this action is intentionally project-scoped. |
| Mission / Chat submit | Keep the active directory as the concrete owner; the launcher now guarantees that directory is unique per global click. |

## Implementation plan

1. Replace anonymous-directory reuse in `openGlobalChatLauncher()` with unconditional server allocation and activation.
2. Add focused regression coverage that invokes the launcher twice from an already anonymous project and proves two allocation requests, two distinct active directories, and no saved explicit-directory mutation.
3. Update the current panel architecture to state the fresh-per-click invariant, then run focused unit, type, document-health, and historical-link verification and perform a second diff review.

## Verification record

- `workspace-active-directory.test.ts` passes 23/23, including a repeated-launch regression that observes two `POST /global/projects/anonymous` requests and two distinct active directories while `savedDirectory` remains empty.
- `titlebar-menubar-primitive.test.ts` passes 14/14, and Overlay TypeScript compilation passes.
- Historical-link and document-health suites pass after the new record is staged as a tracked delivery file.
- A production Vite build was served by an isolated OpenCorvus backend on port `47891` with its own temporary `HOME` and `OPENCORVUS_HOME`. The real Work Ledger controls were clicked in this order: `New chat`, `New mission`, `New chat`. The isolated data root contained one startup anonymous project before those actions and four distinct dated UUID project directories afterward.
- Browser inspection confirmed the final Mission launcher exposes Mission intent and the final Chat launcher exposes Chat intent without layout regressions. Screenshots are retained at `packages/overlay/.scratch/fresh-project-new-mission.png` and `packages/overlay/.scratch/fresh-project-new-chat.png`.
- The isolated Vite and backend processes were shut down cleanly; backend settlement reported zero process-owned prompt sessions and zero tool parts. No running user OpenCorvus / Overlay process was restarted, refreshed, or modified.
- A broader four-suite Overlay run exposed six unrelated existing static-assertion failures, including the retired no-prop `<ComposerModelSelector />` source shape and an old explicit `Attachment[]` declaration. Directly affected runtime, launcher, type, and documentation checks pass; those unrelated assertions were not rewritten as part of this repair.
