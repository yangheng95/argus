# Overlay window.unhandledrejection Root Repair - 2026-06-23

## Goal

Eliminate overlay-owned Promise paths that can surface as
`window.unhandledrejection` while keeping the global runtime diagnostic
listener in place. Each asynchronous boundary must have its real owner:
background refreshes update their store error state and log, stream hooks
reject their parent request, and user-triggered UI actions report through the
existing notification/log surfaces.

## Non-Negotiable Requirements

- Do not remove or weaken the global `window.unhandledrejection` listener.
- Do not add fallback, compatibility, gate, timeout extension, or silent
  swallowing.
- Do not restart, refresh, kill, or reload a running OpenCorvus/overlay
  process for verification.
- Do not hide operator-actionable failures in console-only paths when an
  existing notification/log surface is available.
- Tests must cover the fixed ownership boundaries.

## Recall

| Source                                                               | Relevant Contract                                                                                                                                                |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `specs/new-arch/2026-06-23-task-list-refresh-unhandled-rejection.md` | `loadTasks()` records `boardStore.tasksError` and rethrows; fire-and-forget task refresh owners must catch and log so runtime toast is not the owner.            |
| `specs/overlay-runtime-notification-message-2026-06-05.md`           | Runtime notifications keep `window.unhandledrejection` as source detail but visible message must be the real error summary.                                      |
| `specs/notification-log-schema-stress-2026-06-17.md`                 | Operator-actionable overlay runtime/native failures must create semantic diagnostics, not silent drops.                                                          |
| `specs/new-arch/2026-06-22-mission-ledger-connection-boundary.md`    | A previous `window.unhandledrejection Failed to fetch` was fixed by assigning the Mission loader to the connection boundary, not by masking the global listener. |
| `specs/new-arch/2026-06-23-uncaught-exception-root-repair.md`        | Server-side `process.unhandledRejection` repairs are separate; this task is browser overlay `window.unhandledrejection`.                                         |

## Call-Point Inventory

Commands run before implementation:

```powershell
rg -n "unhandledrejection|unhandled rejection|UnhandledRejection|Promise|fire-and-forget|void .*\.catch|void [A-Za-z0-9_]+\(|catch\(\)" AGENTS.md specs packages/overlay/src packages/overlay/test
rg -n "\bvoid\s+[^\n]+" packages/overlay/src -g "*.ts" -g "*.tsx"
rg -n "addEventListener|setTimeout|queueMicrotask|createEffect|onMount|onSelect|onClick|onChange|onSubmit" packages/overlay/src -g "*.ts" -g "*.tsx"
rg -n "\bsaveSettings\(|\bvoid\s+[^\n]*(\.finally|\.then)\(|\bvoid\s+(retryTask|replanTask|cancelTask|selectTask|setDirectory|browseDirectory|openDirectory|patchConfig|syncAgentPromptLocale|toggleDevtools|saveSettings|cancelPaneResize|openPathInSelectedEditor|stopChatRequest|loadWorkspaceOnboardingDiscovery|refetchTarget|loadBoard|loadTasks)" packages/overlay/src -g "*.ts" -g "*.tsx"
rg -n "runtime-diagnostics|unhandledrejection|submitMessage|performSseReconnect|TitlebarMenubar|WorkspaceOnboarding|CommandPalette|saveSettings|void loadBoard|void selectTask|void props\.onClick|finally\(closeMenu\)" packages/overlay/test packages/overlay/src -g "*.test.ts" -g "*.test.tsx" -g "*.ts" -g "*.tsx"
```

| Surface                                                                                                                        | Evidence                                                                                                                                                                                             | Decision                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/store/board.ts` scheduled `loadBoard()` calls                                                            | `retryBoard`, queued microtask, and `scheduleBoard()` call `void loadBoard(...)`; `loadBoard` logs and schedules retry but still rejects.                                                            | Add a board refresh owner that catches and logs scheduled failures. Keep `loadBoard()` rejecting for direct callers.                                                        |
| `packages/overlay/src/services/events.ts` task list refresh                                                                    | Already fixed by catching `loadTasks()` in `scheduleTasksCompat()`.                                                                                                                                  | Preserve as reference pattern and keep existing regression test.                                                                                                            |
| `packages/overlay/src/services/sse.ts` periodic task refresh                                                                   | Already catches periodic `loadTasks()`. Reconnect retry calls `performSseReconnect()` from a timer.                                                                                                  | Ensure retry timer observes `performSseReconnect()` rejection without changing reconnect semantics.                                                                         |
| `packages/overlay/src/services/task.ts` stream hooks                                                                           | `submitMessage()` calls `void options.onOpen?.()` and `void options.onEvent?.(ev)`. Async hook rejection has no parent owner.                                                                        | Convert hook rejection into the parent `submitMessage()` promise rejection and close the stream.                                                                            |
| `packages/overlay/src/services/task.ts` orphan selection handler                                                               | `setOrphanedSelectionHandler(() => { void selectTask("") })`.                                                                                                                                        | Catch and log/report deselect failure from the handler owner.                                                                                                               |
| `packages/overlay/src/store/settings.ts` callers                                                                               | Multiple UI/service paths call `saveSettings()` without await/catch.                                                                                                                                 | Callers that intentionally fire-and-forget settings persistence must report failures through their UI/service owner; direct settings tests keep `saveSettings()` rejecting. |
| `packages/overlay/src/main.tsx` task/deselect actions                                                                          | Several `void selectTask`, `retryTask`, `replanTask`, `cancelTask`, `stopChatRequest`, `toggleDevtools`, `cancelPaneResize`, `openPathInSelectedEditor`, and `setLocale` calls lack catch ownership. | Add focused owner helpers in `main.tsx` that route user-action failures to `reportOverlayRuntimeError()` or visible notifications.                                          |
| `packages/overlay/src/components/BrowserPreviewPanel.tsx`                                                                      | `refetchTarget()` is called from 404 recovery paths without catch.                                                                                                                                   | Add a browser-preview-owned refetch helper that writes the panel error state.                                                                                               |
| `packages/overlay/src/components/WorkspaceOnboardingDialog.tsx`                                                                | `loadWorkspaceOnboardingDiscovery().then(...)` and `runAction()` are fired from mount/click/submit without catch.                                                                                    | Discovery and directory actions update the dialog error state and do not rethrow from event handlers.                                                                       |
| `packages/overlay/src/components/titlebar/TitlebarMenubar.tsx`                                                                 | Generic menu primitives call async `onClick` / `onChange` with `void`; `.finally(closeMenu)` chains can reject; settings writes are unobserved.                                                      | Add titlebar menu action ownership at the primitive layer and make settings mutations persist through observed promises.                                                    |
| `packages/overlay/src/components/CommandPalette.tsx`                                                                           | Command runners call `selectTask`, `setLocale`, `syncAgentPromptLocale`, and `saveSettings()` without observing returned promises.                                                                   | Let `Command.run` return a promise and have `runCommand()` catch async failures through the existing command-palette notification path.                                     |
| `packages/overlay/src/components/settings/PermissionsPanel.tsx`                                                                | Permission change calls `void patchConfig(...)`.                                                                                                                                                     | Attach settings-panel owner notification/log handling.                                                                                                                      |
| `packages/overlay/src/components/WorkspaceEditorLaunchers.tsx` and `WorkspaceSplitLauncher.tsx`                                | Split launcher primary/menu callbacks can return promises but the primitive drops them.                                                                                                              | Make split launcher observe callback rejections and let editor launcher own save/open failures.                                                                             |
| `packages/overlay/src/components/TaskDirBar.tsx`                                                                               | Many async handlers are internally try/catch; `syncDiscoveredProjects()` and `openDirectory()` calls can still escape from void paths.                                                               | Add local catches only where the called function can reject without existing internal ownership.                                                                            |
| `packages/overlay/src/components/settings/SkillMarketPanel.tsx`, `ProvidersPanel.tsx`, `NetworkPanel.tsx`, `PromptCatalog.tsx` | Most async handlers already have local try/catch or `.catch`; no immediate unowned edge selected for this pass.                                                                                      | Leave behavior unchanged unless tests reveal unhandled rejection.                                                                                                           |
| `packages/overlay/src/services/dialog.ts`                                                                                      | `openConfigDialog()` calls `void loadSettingsInfo().then(...)`.                                                                                                                                      | Catch and show config-load error via dialog/log owner.                                                                                                                      |
| `packages/overlay/src/services/connection.ts`, `workspace.ts`, `init.ts`                                                       | URL/directory persistence calls `saveSettings()` without awaiting; some paths are async, some synchronous UI actions.                                                                                | Observe persistence failure at the service owner while preserving the current synchronous API where callers rely on it.                                                     |

## Implementation Plan

1. Add narrowly scoped owner helpers in existing modules rather than a global
   "swallow promise" helper.
2. Preserve direct Promise contracts for functions such as `loadBoard()`,
   `loadTasks()`, `saveSettings()`, and `submitMessage()` when called by tests
   or explicit async workflows.
3. Convert fire-and-forget paths to:
   - catch and log/store when the owner is a background scheduler,
   - catch and notify/log when the owner is a user-visible UI action,
   - reject the parent Promise when the owner is an async request pipeline.
4. Add regression tests for scheduled board refresh, stream hook rejection,
   titlebar/menu action ownership, command-palette async command ownership,
   onboarding action ownership, and static guards for the known `void` shapes.

## Verification

Focused checks:

```powershell
bun test packages/overlay/test/events-refresh.test.ts packages/overlay/test/runtime-diagnostics-source.test.ts packages/overlay/test/sse-reconnect.test.ts --timeout 30000
bun test packages/overlay/test/overlay-unhandled-rejection-owners.test.ts --timeout 30000
bun test packages/overlay/test/titlebar-menubar-primitive.test.ts packages/overlay/test/command-palette-primitive.test.ts packages/overlay/test/workspace-onboarding-surface.test.ts packages/overlay/test/browser-preview-panel.test.ts --timeout 30000
bun run --cwd packages/overlay typecheck
```

Final self-review must re-run the grep inventory for unowned Promise shapes
and explicitly classify any remaining `void` calls.
