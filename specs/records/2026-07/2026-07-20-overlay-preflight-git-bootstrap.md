# Overlay Preflight Git Bootstrap

Date: 2026-07-20
Status: Implemented

## Recall

| Item | Details |
| --- | --- |
| User request | A newly created task under the `crypto` directory no longer shows its message conversation. Determine whether Git is responsible and ensure task startup automatically initializes Git before every prerequisite action. |
| Acceptance criteria | A restored or newly selected Overlay directory with `initGit=true` must call the canonical `POST /project/current/init-git` endpoint before config, task, metadata, extension, or prompt-catalog project loads can create or retain a non-Git `Instance`; the call remains idempotent; no task/session writer gains a second Git implementation; direct `POST /task` retains its existing default `init-git=true` contract; focused ordering, endpoint, document-health, and typecheck validation passes. |
| Hard constraints | Preserve one canonical `project_id` per worktree; do not move `git init` into `EngineService.createTask` after project identity exists; do not add a route gate, fallback, state machine, or keyword matcher; do not restart or refresh the user's running OpenCorvus/Overlay; keep the existing explicit `initGit=false` configuration/API behavior; use `Project.initGit` through the existing endpoint as the only Git initializer. |
| Runtime evidence | `/Users/yangheng/Documents/OpenCorvus-Demos/crypto` has one project row (`b6b8af...`) and two persisted root sessions (right-sidebar Chat and Mission), each with four messages. Chat/Mission rows were created before `.git` (20:07:05) and the seed commit (20:07:07). The global health route returns HTTP 200, while project-scoped `/project/current` and `/work-ledger` time out. The live config contains `"initGit": true`, but production search finds no startup consumer. The late init/refresh writer is therefore able to queue behind an already-live project lease and block later project reads. |
| Sources read | `AGENTS.md`; `specs/current/architecture/02-data.md`; `specs/current/architecture/07-panel.md`; `specs/records/2026-06/2026-06-12-overlay-init-git-412-retry.md`; `specs/records/2026-06/2026-06-22-task-create-init-git-query.md`; `specs/records/2026-07/2026-07-05-project-non-git-identity-drift-repair.md`; `packages/overlay/src/services/init.ts`; `packages/overlay/src/utils/git.ts`; `packages/overlay/src/services/workspace.ts`; `packages/opencorvus/src/server/server.ts`; `packages/opencorvus/src/server/routes/project.ts`; `packages/opencorvus/src/project/instance.ts`; `packages/opencorvus/src/task-api/index.ts`; relevant focused tests. |
| Whole-repository search | `rg` enumerated every `initGit`, `init-git`, `initGitCurrent`, `initApp`, `loadInitialData`, `ensureDefaultDirectory`, `ensureWorkspaceDirectory`, `Project.initGit`, `EngineService.createTask`, `WorktreeNotGitError`, and project/session/task creation call. `Project.initGit` has three production owners: the explicit project endpoint, implicit global-project provisioning, and `POST /task` pre-Instance middleware. Overlay `settings.initGit` has no production consumer. `initGitCurrent` is used only by the manual TaskDirBar action and the old 412 retry. |
| Independent agent feedback | None. The user did not request sub-agents; runtime, database, filesystem, route, and call-site evidence is sufficient for this focused repair. |

## Causal Chain

1. Overlay restores a directory and immediately starts project-scoped loads.
2. The persisted `initGit=true` setting is never read by startup, so a non-Git project `Instance` can bootstrap first.
3. Chat or Mission creation can retain that project lifecycle while Git remains uninitialized.
4. A later manual/secondary init creates `.git` and requests an identity refresh only after the non-Git context already exists.
5. The refresh writer waits behind the live execution lease; writer preference then blocks subsequent Work Ledger/conversation hydration reads.
6. The persisted conversations remain in SQLite, but the Overlay cannot load them, producing the visible disappearance.

The missing startup consumption—not the `crypto` name and not a missing database row—is the root cause. The existing `POST /task` preparation is correct but too late to protect earlier Chat/Mission/project startup actions.

## Call-Site Decisions

| Surface | Decision |
| --- | --- |
| `services/init.ts::loadInitialData` | After directory restoration and API directory binding, synchronously initialize Git when `settingsStore.initGit` is true; only then begin config/task/meta/extensions/catalog loads. |
| `utils/git.ts` | Extract the endpoint call into one idempotent helper used by both startup and `initGitCurrent`; keep reload/dialog effects only in the manual/retry wrapper. |
| `server/project-route-context.ts` | Treat `POST /project/current/init-git` as an identity-only repair operation so Git initialization happens before plugin, LSP, watcher, VCS, expert-squad, attachment, scheduler, or channel bootstrap. |
| `services/task.ts` | Preserve the exact 412 recovery wrapper for callers that explicitly disable/skipped startup or race outside normal Overlay startup. It reuses the same helper through `initGitCurrent`. |
| `server/server.ts POST /task` | Preserve default `init-git=true` before `Instance.provide`; this remains the self-contained HTTP task ingress and is not a duplicate Git implementation. |
| `task-api/index.ts::prepareProject` | Preserve strict `WorktreeNotGitError` as the final identity/data-integrity assertion; do not initialize after an `Instance` already owns a namespace. |
| `Project.initGit` | Preserve as the only subprocess owner. |
| `initGit=false` | Preserve the explicit operator/API opt-out; startup must not initialize when disabled. |

## Verification Plan

1. Add a focused startup-order contract proving Git initialization is awaited after directory/API binding and before every project-scoped startup load, with a negative assertion for `initGit=false`.
2. Extend the Git utility test so startup initialization posts only the canonical endpoint and does not clear/reload project scope or show a dialog.
3. Run focused Overlay tests, Overlay typecheck, `git diff --check`, historical-doc links, and document-health tests.
4. Perform a second exact-diff review, update this record with implementation/evidence, commit with the `dsw-33987` prefix, fetch/merge if needed, and push `v0.0.12beta` to `myhexin`.

## Implementation

- `initializeActiveDirectoryGit()` is now the single Overlay primitive for the canonical init endpoint. It performs no reload, notification, retry, or local Git command.
- `loadInitialData()` restores/binds the selected directory, awaits that primitive when the persisted `initGit` setting is enabled, and only then starts config, task, metadata, extension, and prompt-catalog loads.
- `initGitCurrent()` reuses the primitive and remains the sole owner of manual/retry reload and dialog effects.
- `POST /project/current/init-git` now uses the existing identity-only project context. Its route handler reaches `Project.initGit` before full plugin, LSP (Language Server Protocol), watcher, VCS (Version Control System), expert-squad, attachment, scheduler, and channel initialization.
- Direct HTTP `POST /task` remains self-contained with default `init-git=true`, while `EngineService.prepareProject` remains strict and never changes Git identity after task/session persistence starts.

## Second Review

The exact changed-tree review found and corrected one initial omission: advancing only the Overlay call order still left `POST /project/current/init-git` behind full `InstanceBootstrap`. Adding that endpoint to the already-existing identity-only repair surface makes the server-side order match the claimed contract. A later real-browser merge review found that settings normalization still hardcoded `initGit=true`, so the documented opt-out was not reachable; `applySettings()` and `bootstrapOverlaySettings()` now preserve an explicit boolean while retaining `true` as the missing-value default. The final call-site scan finds one Git subprocess owner (`Project.initGit`), one Overlay endpoint primitive, and no new task-engine initializer, route fallback, or workflow gate. The unrelated pre-existing untracked `C:/` tree was not read, edited, staged, or deleted.

## Validation Evidence

- Focused Overlay Git primitive/startup-order tests: 3 passed, 22 assertions.
- Focused server identity-context/init route tests: 5 passed, 26 assertions, including a real malformed expert-squad package proving init succeeds before strict bootstrap and strict bootstrap still fails afterward.
- Existing direct task-create Git contract: 5 passed, covering missing/existing non-Git directories, `init-git=false`, and invalid values.
- OpenCorvus and Overlay TypeScript typechecks passed.
- Historical links, product-doc single source, document health, and enterprise architecture explorer passed together: 96 tests, 1,461 assertions.
- Route inventory passed with 6 rules across 31 route files; generated API docs passed with 281 operations across 23 groups.
- The first pre-stage document-health run correctly rejected the new record because the tracked-file assertion reads Git's index. After explicitly staging only this task's files, the exact same suite passed. The unrelated `C:/` tree remains untracked.
- Cached diff whitespace validation passed; final commit/push hooks will rerun repository typecheck, route, docs, i18n (Internationalization), and secret-scan checks.
- Post-merge persistence regression proves `initGit=false` survives browser-host load and save. Real Node browser scenarios prove generic visual fixtures no longer perform an unrelated Git mutation while the explicitly enabled Multica scenario performs two idempotent startup calls and completes its repair-or-cancel interaction.
