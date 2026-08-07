# Mission Directory-Switch Git and Prompt Liveness Repair

Date: 2026-07-24
Status: Implemented

## Recall

| Item | Recorded requirement or evidence |
| --- | --- |
| User request | The user supplied Chat Debug Info for Session `ses_06bca4392ffe5F15SmIlXjEQ9G`, asked why the Task was stuck, then explicitly requested: `修复问题`. |
| Acceptance | A newly selected non-Git directory with Overlay `initGit=true` is initialized through the canonical project endpoint before project-scope reload, Mission creation, or conversation execution can acquire a non-Git `Instance`; repeated provider delivery of one tool call ID cannot leave the LLM activity idle/total timers permanently paused after the single matching result; focused tests prove directory-switch ordering, exact-directory endpoint routing, duplicate-call liveness, and existing strict `EngineService.createTask` behavior; the running OpenCorvus process is not restarted or refreshed by this repair. |
| Hard constraints | Preserve `Project.initGit` as the only Git subprocess owner and `POST /project/current/init-git` as the Overlay primitive; do not move Git initialization into `EngineService.createTask`; preserve `initGit=false`; do not add a gate, fallback, state machine, keyword matcher, or shell-based Git path; keep nested independent activity pauses valid while making the same pause owner idempotent; preserve all parallel worktree edits and stage only task-owned files. |
| Runtime evidence | The persisted Session is a Mission in `/Users/yangheng/Documents/OpenCorvus-Demos/prism`. Its queue row remained `running`; its last assistant message persisted a completed Bash tool result and `finish: tool-calls` but no message completion. The Bash command ran `git init -b main`, committed `.gitignore` and `.opencorvus`, and completed in under one second. The old sidecar log records `session.processor process` at `2026-07-24T13:31:55.885Z`, the Bash launch at `13:32:06.504Z`, and no later prompt terminal/standby before project-scoped conversation requests accumulated. Global health remained responsive. A later process start recovered the durable Session and continued it, proving persisted conversation data was not missing. |
| Causal inference boundary | The runtime log does not retain raw provider stream frames, so it cannot directly prove which duplicate frame was delivered. The code and persisted facts do prove that the only intentional indefinite suspension of both activity deadlines is the tool pause window, the tool result completed, and the current processor calls `pause()` for every repeated `tool-call` frame but calls `resume()` only once for the result. Existing regression fixtures already establish that same-call-ID provider re-delivery is legal and occurs. The unmatched same-owner pause is therefore the evidenced liveness defect; the exact provider frame duplication in this historical turn remains inferred rather than directly observed. |
| Existing records read | `specs/records/2026-07/2026-07-05-project-non-git-identity-drift-repair.md`; `2026-07-09-open-project-freeze-systemic-repair.md`; `2026-07-15-session-background-execution-ownership.md`; `2026-07-20-overlay-preflight-git-bootstrap.md`; `2026-07-23-mission-full-execution-surface.md`; `2026-07-23-orchestrator-descendant-tool-activity-ownership.md`; current project identity, activity, processor, queue, Overlay directory, Git, Mission, and task-ingress sources and focused tests. |
| Whole-repository search | `rg` enumerated every `needsProjectRefresh`, `prepareContextExclusive`, `upgradeLease`, `provideProjectIdentity`, `runWithIndependentProjectIdentity`, `Project.initGit`, `prepareTaskCreateDirectory`, `EngineService.createTask`, `panel.create_task`, `wakeMission`, `setDirectory`, `applyDirectory`, `initializeActiveDirectoryGit`, `run.pause`, `run.resume`, `pauseDepth`, and duplicate-tool-call test call site. The decisions are listed below. |
| Independent agent feedback | None. The user did not request sub-agents, so no sub-agent was started. |
| Workspace preservation | The shared worktree contains unrelated Overlay Settings work, including edits to both spec indexes. This repair appends narrow index entries and does not rewrite, restore, stage, or delete those changes. The unrelated `expert-squads/.DS_Store` remains untouched. |

## Causal chain

1. Startup restoration initializes Git before project loads, but a later `applyDirectory()` switch updates the API directory and immediately reloads project scope without applying the same configured preflight.
2. The selected `prism` directory therefore acquires a cached non-Git `Instance`; Mission creation and its durable prompt queue own long-lived project read leases against that identity.
3. `panel.create_task` correctly preserves the strict Engine boundary and returns `WorktreeNotGitError`.
4. Mission has full Bash authority but no canonical project-initialization panel action, so the model used Bash to run `git init` and also made an unnecessary broad initial commit. This changed the directory's Git identity behind the live cached `Instance`.
5. The next full project request detects Git identity drift and waits for an exclusive refresh. Writer preference then queues later conversation reads behind that refresh while the active Mission prompt still owns the read lease.
6. The processor treats every repeated `tool-call` stream event as a new nested pause even when the call ID is identical. One matching `tool-result` removes only one depth, leaving idle and total activity deadlines disabled.
7. The prompt never terminalizes, its read lease never closes, the queued identity refresh never runs, and the Overlay cannot hydrate persisted messages. The debug card consequently shows one shell card but zero projected messages even though SQLite contains the conversation.

The directory-switch preflight omission is the identity-drift root trigger. Non-idempotent activity pause ownership turns the normally bounded refresh wait into an indefinite deadlock.

## Complete call-site decisions

| Source or consumer | Decision |
| --- | --- |
| `packages/overlay/src/services/init.ts::loadInitialData` | Preserve startup ordering, but call one extracted exact-directory Git endpoint primitive shared with directory switching and manual initialization. |
| `packages/overlay/src/services/workspace.ts::applyDirectory` | After connection succeeds and the API context is bound to `next`, await canonical Git initialization when `settingsStore.initGit` is true, before persistence, project-scope clearing/reload, Mission/Chat launch, or any other new-directory project request. Re-check selection ownership after the await so an older switch cannot continue. |
| `packages/overlay/src/utils/git.ts` | Preserve manual notification/reload behavior; delegate only the endpoint call to the same exact-directory primitive. |
| Overlay Mission and Chat launchers | Preserve. They inherit a Git-ready active directory from `applyDirectory`; no second launch-specific initializer is added. Work Ledger paths that launch directly against stored project rows remain project identities already discovered by server data. |
| `packages/opencorvus/src/project/project.ts::Project.initGit` | Preserve as the sole Git subprocess owner. |
| `packages/opencorvus/src/server/routes/project.ts` | Preserve the canonical endpoint and identity-only route context. No shell or task-engine initializer is added. |
| `packages/opencorvus/src/server/server.ts POST /task` | Preserve the existing self-contained direct-HTTP ingress with default `init-git=true`. |
| `packages/opencorvus/src/task-api/index.ts::prepareProject` | Preserve strict `WorktreeNotGitError`; this remains the final data-integrity assertion and never changes identity after Task execution begins. |
| `packages/opencorvus/src/llm/activity.ts` | Replace anonymous pause depth with owner-keyed pause ownership. Repeating one owner is idempotent; different owners remain nested; unknown resumes are no-ops. Total and idle timers resume only when the final distinct owner releases. This is resource ownership, not persisted workflow state. |
| `packages/opencorvus/src/session/processor.ts` | Use `tool-call:<toolCallId>` as the exact pause owner for tool call, result, and error frames so provider replay of one call ID cannot over-acquire. |
| Existing duplicate tool-call regression | Extend it with a stalled post-finish stream and a small idle policy; prove duplicate call frames plus one result terminalize by idle timeout instead of hanging forever. |
| Overlay directory tests | Add a real service-level request-order regression proving `POST project/current/init-git` for the new exact directory precedes `GET config/path/vcs`, and a negative `initGit=false` case. |

## Verification plan

1. Add the duplicate-pause and directory-switch ordering regressions first and observe the pre-fix failures.
2. Extract the canonical exact-directory Overlay Git primitive, apply it to startup, directory switching, and manual init, then implement owner-keyed LLM activity pauses and exact tool-call owners.
3. Run focused activity, processor, Overlay Git, workspace, server task-create, and strict Engine tests; run OpenCorvus and Overlay typechecks.
4. Run `git diff --check`, historical-doc links, document health, route/docs checks required by the changed spec/API-adjacent surfaces, and a second exact-diff/call-site review.
5. Commit only task-owned files with the `dsw-33987` prefix and push `v0.0.18beta` to `myhexin` through normal hooks.

## Implementation

- Added `initializeProjectDirectoryGit(directory)` as the one Overlay endpoint primitive with an explicit directory query. Startup and manual Git actions still reach it through `initializeActiveDirectoryGit()`, while directory switching calls it directly after binding the selected directory.
- `applyDirectory()` now awaits configured Git initialization before persistence, project-scope clearing, reload, or later Mission/Chat launch and rechecks selection ownership after that mutation. `initGit=false` remains a tested opt-out.
- `LLMActivityRun.pause/resume` now owns pauses by exact string identity. Repeated acquisition by one owner does nothing, distinct owners still nest through the existing stream monitor, and an unknown release does nothing.
- `SessionProcessor` derives `tool-call:<toolCallId>` for call, result, and error events. A provider replay of one call frame therefore cannot create more pause ownership than its one result can release.
- `EngineService.createTask`, the direct HTTP Task preflight, `Project.initGit`, project refresh/disposal, queue recovery, and Mission/Chat launch APIs were not duplicated or weakened.

## Second review

The exact changed-tree review corrected two details before final validation:

1. The Git primitive carries the explicit target directory in the request rather than relying on ambient API state, so overlapping workspace selections cannot silently redirect the mutation.
2. The activity runner emits `paused`/`resumed` events only for a real owner acquisition/release. This keeps its external liveness projection aligned with the stream monitor rather than reporting duplicate provider frames as nested execution.

The final whole-repository scan finds no remaining processor call using the anonymous `"tool-call"` owner, keeps independent nested pause tests intact, and finds one Overlay Git primitive feeding startup, switching, and manual actions. No visual component, layout, or interaction primitive changed, so visual screenshot acceptance is not applicable to this service/lifecycle repair.

## Validation evidence

- Pre-fix regressions failed exactly as intended: duplicate owner activity resolved instead of timing out, the processor remained pending past the 250 ms test boundary, and directory switching emitted no Git request.
- OpenCorvus activity and duplicate processor suites: 45 passed, 165 assertions.
- Overlay workspace, startup Git, and manual Git suites: 24 passed, 120 assertions.
- Focused project refresh/lease tests: 2 passed, 15 assertions.
- Direct Task Git ingress tests: 5 passed, 16 assertions; strict Engine non-Git test: 1 passed, 7 assertions.
- OpenCorvus and Overlay TypeScript typechecks passed.
- Historical links and document health passed together after task-owned staging: 82 passed, 1,381 assertions. The first run reached the real tracked-record check and rejected the new untracked record as designed.
- A broader unrelated `instance-cache` run exposed the concurrently committed Settings fixture's invalid expert-squad version and then retained a Bun test process. The exact refresh/lease tests passed independently; only that isolated test process was interrupted, with no OpenCorvus or Overlay process touched.
