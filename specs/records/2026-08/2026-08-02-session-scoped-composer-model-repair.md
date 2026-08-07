# Session-scoped Composer model repair

## Recall

### User requirement

- “我在一个会话设置的模型扩散到所有的任务了，调查解决问题。”
- A model selected for one Chat, Work, Mission, or Task must remain owned by
  that root Session and must not appear in another Task or Session.

### Acceptance criteria

- Selecting Task A projects Task A's persisted root-Session model into the
  Composer.
- Selecting Task B replaces the Composer projection with Task B's own
  persisted model; Task A's selection never remains visible during or after
  the switch.
- The same isolation holds for standalone Chat, Work, and Mission Sessions.
- Entering New Chat creates an empty draft projection. It does not inherit the
  model from the previously selected Task or Session and it creates no durable
  Project or Session until the existing first-valid-submission boundary.
- Choosing a model in a persisted root Session updates that Session through the
  canonical Session Config API. Choosing a model in an unpersisted draft stays
  draft-local until the existing create request persists it.
- Every Task and Session execution request continues to carry the currently
  projected Composer model explicitly.
- The real Overlay is opened. At least two persisted scopes with different
  models and one New Chat draft are switched between and personally inspected
  in screenshots. No User Interface (UI) automated test is added, modified, or
  run.

### Hard constraints

- Root `AGENTS.md` applies.
- Preserve all unrelated concurrent changes. Do not create a worktree, reset,
  restore, stash, or broadly stage.
- Reuse root Session `metadata.configOverlay.model`,
  `GET/PATCH /session/:sessionID/config`, selection epochs, and the existing
  Composer selector. Do not add a second database field, compatibility path,
  fallback model, gate, or frontend per-Task cache.
- Do not restart, refresh, terminate, or mutate the user's running Overlay or
  production database. Real-page acceptance uses an isolated runtime.
- Playwright/browser control must run with Node.js, never Bun.
- Commit subjects begin with `dsw-33987`; delivery pushes to `legacy-remote`.

### Hard-disk sources read

- `AGENTS.md`
- `specs/current/architecture/06-provider.md`
- `specs/records/2026-07/2026-07-27-composer-requires-model.md`
- `specs/records/2026-07/2026-07-29-composer-model-single-source-repair.md`
- `specs/records/2026-07/2026-07-29-composer-model-selection-and-multica-import.md`
- `packages/overlay/src/store/app.ts`
- `packages/overlay/src/store/board.ts`
- `packages/overlay/src/components/ComposerModelSelector.tsx`
- `packages/overlay/src/services/chat.ts`
- `packages/overlay/src/services/config.ts`
- `packages/overlay/src/services/conversation-session.ts`
- `packages/overlay/src/services/task.ts`
- `packages/overlay/src/services/workspace.ts`
- `packages/overlay/src/main.tsx`
- `packages/opencorvus/src/session/index.ts`
- `packages/opencorvus/src/server/routes/session.ts`
- `packages/opencorvus/src/server/routes/right-sidebar-conversation.ts`
- `packages/opencorvus/src/task-api/index.ts`

### Whole-repository grep result

Repository-wide searches covered `composerModel`, `currentOpenCorvusModel`,
`currentOpenCorvusPromptModel`, every production `selectedSource` write,
`activeTaskID`, `activeSessionID`, `rootTaskSessionID`, `configOverlay`,
`taskConfigSnapshot`, `getSessionConfig`, `patchSessionConfig`, every Task and
Session create/prompt boundary, and the global New Chat launcher.

| Owner / call site                                            | Current fact                                                                                                                      | Disposition                                                                                                                              |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `store/app.ts`                                               | `composerModel` is documented as one value across every context.                                                                  | Keep one current-view projection but replace the global-ownership contract with current draft/root-Session ownership.                    |
| `ComposerModelSelector.tsx`                                  | Reads and writes the global projection only.                                                                                      | Keep the existing UI; route persisted-scope choices through the canonical Session Config writer and commit the returned effective model. |
| `services/task.ts:selectTask`                                | Switches Task identity and hydrates its conversation but never hydrates its root-Session model.                                   | Clear the old projection synchronously, then load the selected Task root Session config under the existing selection epoch.              |
| `services/conversation-session.ts:selectConversationSession` | Claims/hydrates Chat or Work Session without projecting its config model.                                                         | Clear the old projection synchronously, then load the claimed root Session config under the same selection epoch.                        |
| `main.tsx:openMissionSession`                                | Directly selects and hydrates a Mission Session without projecting its config model.                                              | Apply the same root-Session model projection after directory ownership is established.                                                   |
| `services/workspace.ts:enterDirectoryFreeWorkspace`          | Clears Task/Session runtime but leaves `composerModel` intact.                                                                    | Clear the model so New Chat is a clean, write-free draft.                                                                                |
| `services/task.ts:currentOpenCorvusModel` and callers        | Task creation/follow-up, Chat/Work creation/prompt, Mission wake, Panel requests, and Multica import read the current projection. | Preserve these explicit execution handoffs; fixing projection ownership fixes all consumers at their common source.                      |
| Session Config backend                                       | Root Sessions already own `metadata.configOverlay`; GET returns effective config and PATCH atomically validates/merges it.        | Reuse unchanged as the sole durable owner.                                                                                               |
| Task follow-up backend                                       | Explicit Task model updates the root overlay and clears agent-specific model overrides before waking.                             | Preserve unchanged; this remains the execution boundary that makes the selected model authoritative for the whole Task turn.             |
| Right-sidebar/global Session create routes                   | Initial model is persisted into the new root Session overlay.                                                                     | Preserve unchanged.                                                                                                                      |
| UI automation files                                          | Existing browser/fixture tests assert UI behavior.                                                                                | Do not modify or run them; acceptance is real-page interaction and manual screenshot review.                                             |

### Independent-agent feedback

- None. The user did not request sub-agents or parallel audit, so delegation is
  prohibited by the active collaboration instruction.

## Root cause

The backend is already session-scoped: every Task, Chat, Work, and Mission root
Session owns its own `metadata.configOverlay.model`. Task creation and Task
follow-up persist the selected model into that root Session.

The leak was introduced by the 2026-07-29 frontend contract. It deliberately
made `appStore.composerModel` a process-wide value that “context changes never
replace or clear.” `selectTask`, `selectConversationSession`,
`openMissionSession`, and New Chat therefore change the visible conversation
identity without changing the model projection. All execution boundaries then
correctly read the same current projection, which makes the stale model from
Session A propagate into Task B's next request. The direct trigger is a missing
selection-time projection; the deeper cause is assigning durable cross-context
ownership to a view state that should represent only the active root Session or
new draft.

## Implementation plan

1. Introduce one Overlay service that projects a root Session's effective model
   through the existing Session Config API and persists a selected model back
   to that same root Session.
2. Clear `composerModel` synchronously whenever the active Task/Session identity
   changes, preventing the previous scope from being rendered or submitted
   while the next scope hydrates.
3. After Task, Chat, Work, or Mission directory ownership is established, load
   that root Session's effective model and apply it only if the existing
   selection epoch still owns the response.
4. Clear the projection when entering the directory-free New Chat launcher.
   Keep draft selection local and let the existing first submission persist it.
5. Preserve every explicit Task/Session request handoff and the backend Task
   follow-up model convergence.
6. Add focused positive non-UI service/contract coverage for effective-model
   projection, persisted-scope update, and draft-local selection. Do not add,
   modify, update, or run UI tests.
7. Run focused non-UI tests, Overlay/OpenCorvus typechecks, Vite build,
   documentation health, route/API integrity as required, and `git diff
--check`.
8. Start an isolated real runtime, create or seed two root Sessions with
   different models, switch Task/Session/New Chat scopes in the real Overlay,
   capture screenshots, and personally review them.
9. Re-read all call sites and the final diff, commit only task-owned paths, push
   to `legacy-remote`, and verify local/remote convergence.

## Progress

- [x] Reproduce the ownership defect from source and historical design evidence.
- [x] Enumerate production selection, persistence, and execution call sites.
- [x] Record the causal chain and implementation plan.
- [x] Implement current-root-Session/draft model ownership.
- [x] Complete non-UI and build verification.
- [x] Complete real-page interaction and manual screenshot review.
- [x] Complete second review and prepare the exact task-owned delivery.

## Verification

### Non-UI contracts and static checks

- Focused Composer/Chat/Task selection service suites: 41 passed, 0 failed,
  with 148 positive contract expectations.
- The final Composer model service suite positively covers sequential projection
  of Task A then Task B, root-Session config persistence, effective-model
  projection, and draft-local selection.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/opencorvus typecheck`: passed.
- `bun run --cwd packages/overlay check:i18n`: passed.
- `bun run --cwd packages/overlay build:vite`: passed across 7,061 modules;
  only the existing large-chunk warnings remained.
- Historical links, product docs single source, and document health: 70 passed,
  0 failed after the new record entered the Git index.
- `bun run api:routes-check`: passed across 33 route files.
- `bun run docs:check`: passed for 310 operations in 24 groups.
- `git diff --check`: passed before the final review and is rerun against the
  staged delivery.

### Real-page visual and interaction review

An isolated current-source server ran at `127.0.0.1:18902` with a disposable
`OPENCORVUS_HOME`, database, projects, and Provider credential. It served the
fresh production Overlay bundle without touching the user's running process or
database.

- New Chat rendered the neutral `Choose model` state and created no additional
  Project or Session during the visual check.
- Session A initially projected `openai/gpt-5`. Selecting
  `openai/gpt-5-mini` through the real model Popover wrote that value to
  Session A's root config.
- Session B continued to project its own `openai/gpt-4.1` after Session A was
  changed.
- Returning to Session A projected `openai/gpt-5-mini` again. Immutable config
  reads confirmed Session A and Session B stored their two distinct
  session-origin models.
- Three task-scoped screenshots were captured and personally inspected:
  New Chat empty model, Session B `openai/gpt-4.1`, and Session A
  `openai/gpt-5-mini`. The Composer remained aligned and readable in every
  state, with no duplicate titlebar or visual regression.
- Browser warning/error logs were empty. The browser tab closed before the
  isolated server, and server shutdown settled with zero owned prompt Sessions
  and zero Tool parts.
