# Mission Board panel-only Task lifecycle end-to-end verification

Status: Recovery and download defects repaired; the panel-only end-to-end acceptance did not pass because the same Task was cancelled without deliverable, Goal, or completion-decision facts.
Date: 2026-08-07

## Recall

### User request

- Publish a real backend Task that exercises every Mission Board feature end to end.
- A user must be able to manage the complete work lifecycle from the panel, including creating a to-do list, starting work, viewing progress, inspecting deliverables, and accepting the result.
- Artificial Intelligence creation and management remain the primary entry; manual creation remains secondary.

### Acceptance criteria

1. A real model-backed Mission is published through the managed backend and remains visible on the real Task Board.
2. The real panel can create an Artificial Intelligence Mission and a manual backlog draft, then dispatch the draft without leaving the product workflow.
3. Mission cards expose authoritative child-Task progress and status, and opening a Mission exposes its canonical Task conversation rather than a duplicate management model.
4. A queued Task can be started, an active Task can be observed and cancelled, and a terminal Task can be retried or replanned through existing panel controls where the lifecycle permits those actions.
5. Task outputs are discoverable from their real assistant Turn, open in the existing Artifact inspector, and expose the authoritative Goal/completion-decision acceptance facts.
6. Pending questions, search, Project filtering, refresh, card opening, rename/archive/download/delete, and all fact-derived lanes are covered where real lifecycle evidence permits them.
7. Missing panel-only management controls discovered by the real run are repaired at their canonical service/component owner and visually reverified on the running Overlay.
8. No User Interface automated test is added, modified, or run. Focused non-User-Interface contracts, typecheck/build, documentation health, diff review, a `dsw-33987` commit, and legacy remote push complete the delivery.

### Hard constraints

- Mission remains the only top-level Task Board identity; child Tasks remain nested execution detail.
- Reuse the existing Kobalte-backed primitives, Work Ledger/Task header actions, Conversation Artifact inspector, and backend lifecycle routes; do not introduce a second source or fallback.
- User Interface acceptance uses only a real page, real interaction, screenshots tied to this record, and manual visual review.
- Playwright is driven by Node.js, never Bun. The Browser surface must remain the real native page.
- Preserve unrelated worktree changes. Commit subjects start with `dsw-33987` and push to `legacy-remote`.

### Sources read

- `AGENTS.md`
- `specs/records/2026-08/2026-08-07-mission-board-ai-primary-stable-create-dialog.md`
- `specs/records/2026-08/2026-08-06-mission-board-design.md`
- `specs/records/2026-08/2026-08-03-work-ledger-mission-only-task-hierarchy.md`
- `packages/overlay/src/components/MissionBoard.tsx`
- `packages/overlay/src/main.tsx`
- `packages/overlay/src/services/mission.ts`
- `packages/overlay/src/components/ConversationTurnArtifactSummary.tsx`
- `packages/overlay/src/components/ConversationArtifactInspector.tsx`
- `packages/opencorvus/src/mission/board.ts`
- `packages/opencorvus/src/mission/completion.ts`
- `packages/opencorvus/src/server/routes/mission.ts`
- `packages/opencorvus/src/task-api/index.ts`
- The user-provided current Task Board dialog screenshots.

### Whole-repository search result

- `MissionBoard` is the sole five-lane top-level board and already owns Artificial Intelligence creation, manual draft creation, draft dispatch, search, Project filter, refresh, open, child-Task progress, and permanent delete.
- Mission cards deliberately open the canonical Mission conversation. Task start-now, cancel, retry, replan, Mission abort, rename, archive, download, and deletion already exist in the shared Work Ledger/Task header action surface instead of a second board-card mutation source.
- Completion decisions provide authoritative Goal and Task acceptance facts; Task deliverables are projected into their real assistant Turn and reuse the existing Artifact inspector and download path.
- The remaining question is experiential rather than inferable from source: whether one real panel journey makes all of these controls discoverable and operable without external tooling. The backend Mission and real-page run are the acceptance authority.
- No User Interface automated test was run or modified. The added regression is a pure HostTransport/service contract and does not render or assert User Interface output.

### Independent agent feedback

None requested. No sub-agent is used.

## Implementation and verification plan

- [x] Publish one real model-backed Mission whose acceptance contract exercises the full panel-only lifecycle and requires exact evidence identities.
- [x] Observe the Mission and child Tasks through the canonical backend status/list routes while performing the corresponding real Overlay interactions.
- [x] Inspect real screenshots for Artificial Intelligence creation, manual creation, backlog, running progress, and current review surfaces.
- [x] Repair the discovered false timeout at the canonical Mission service owner and repeat the real Artificial Intelligence creation journey.
- [x] Recover the same backend and database without creating a replacement Mission or Task.
- [x] Finish the terminal Artifact/completion-decision panel review and record the actual missing facts instead of treating cancellation as acceptance.
- [x] Repair and reverify the real Task ZIP download response contract.
- [x] Record exact Mission, Task, Artifact, screenshot, validation, commit, and legacy remote evidence here.

## Real backend identities

- Acceptance Mission: `aac29528583f3aa8`.
- Acceptance Mission Session: `ses_025f43e1cffePWXusjReD2cMKF`.
- Acceptance Task: `tsk_fda0d90cf001AbHmX03FJNGKVm`.
- Acceptance Task root Session: `ses_025f26f19ffeVzt3BsWUt8RtGI`.
- Orchestrator Session: `ses_025f1e7b3ffeUu3U9PaeUaFSE9`.
- Developer Session: `ses_025e91fc9ffeC9ij218xeGRyOg`.
- Tester Session: `ses_025d7c750ffdfrkGrCIkYKEuwW`.
- Visual Session: `ses_025d7c6f1ffezMiQz0eJZkj0tC`.
- Integrity Session: `ses_025cf8911ffeePzHR20gJp7yQQ`.
- Successful panel-created Artificial Intelligence Mission: `367daef83776f7f0`, Session `ses_025d5cde8ffeKzDP7zlY8Iqc6E`; deleted after evidence capture.
- Task-owned manual backlog/Dispatch evidence: Mission `37fc59a9053300d3`, Session `ses_02599041dffeUOHkJBFgc2X5dG`. The operator selected `openai/gpt-5.6-terra` in New chat, returned to Task Board, and used the card's sole Dispatch action; the same Session then contained visible user and assistant Turns.
- Other already-dispatched acceptance object: Mission `9065da12d0a9040a`; it reached Review with one failed terminal child Task.
- Wrong-Project diagnostic Mission: `5f64dd9ac9482802`; two exact deletion attempts did not settle. It was not deleted or confused with any correct-Project object in this continuation.

## Root causes and repairs

The current source Overlay correctly opens the creation dialog in Artificial Intelligence mode, places that mode before manual creation, preserves one compact width across both modes, and requires an explicit model. The first real `Send and create` attempt nevertheless failed after 15 seconds with `signal timed out`.

The direct trigger was the generic HostTransport request deadline, not model configuration or Project identity. Both `wakeMission` and manual-draft `dispatchMission` call backend lifecycle routes that await the authoritative Mission wake before returning, but the Overlay treated them as ordinary 15-second requests. A healthy cold Agent launch can exceed that deadline, leaving the backend to complete while the panel falsely reports failure.

`packages/overlay/src/services/mission.ts` now binds both lifecycle mutations to `serverSettledRequest`: the server response is the completion boundary while an explicit caller AbortSignal remains authoritative. The focused positive service contract records both requests with `timeoutMilliseconds: null`.

### Prepared Worker Turn recovery input authority

After port 7878 stopped, restoring the same database with current source originally failed on Tester recovery: the latest terminal lifecycle occurrence referenced input `msg_fda3f689...`, while the newer prepared descriptor `wtd_fda6f8b11001J1OxL67N3qbPaZ` referenced input `msg_fda6f789...` and declared the terminal lifecycle event `pev_fda4307...` as its predecessor.

The direct defect was in `packages/opencorvus/src/engine/queue.ts`: even when `preparedAfterLatestLifecycle` proved that the prepared Worker Turn was the next occurrence, `eventInputMessageID ?? descriptorInputMessageID` still preferred the old non-empty terminal input. `resolveProcessRecoveryInputAuthority` in `process-recovery-fact.ts` now makes the prepared Worker Turn input authoritative for that case and retains lifecycle input authority for an actually interrupted executing occurrence. Starting the same port, database, Mission, Task, and Sessions then logged `attempted=1 initialized=1 failures=0`; no input/descriptor conflict recurred. The recovered Integrity occurrence `msg_fda95d9c60024pbwNBP40luW1B` reached terminal `completed`.

### Cross-origin ZIP filename visibility

The first real panel Task download generated the ZIP and returned HTTP 200 after 56.65 seconds, but the browser-side transport could not read its `Content-Disposition` filename. The route already emitted the header; the server's Cross-Origin Resource Sharing configuration did not expose it to the current-source Overlay at `http://127.0.0.1:5175`. Overlay correctly rejected a binary response whose filename was not observable.

`packages/opencorvus/src/server/server.ts` now exposes `Content-Disposition` to allowed origins. The positive server contract verifies the exact `Access-Control-Expose-Headers` response. After restarting the same port and database, the current-source panel requested `/task/tsk_fda0d90cf001AbHmX03FJNGKVm/project-archive`; it completed with HTTP 200 in 56.286 seconds, and the prior `work-ledger:task:download` missing-filename diagnostic did not recur.

### Preserved identity guard and terminal outcome

The recovered Orchestrator attempted to redispatch the original Developer, whose frozen projected identity has hash `80de6aa110cbaf34e9957b4f0afd51c6e2a429554138c99796a43bdf39d0abb7`. The active build projection no longer matched that frozen identity while unrelated parallel Model Context Protocol/Computer work was modifying the build-agent surface. This is not the prior recovery-input defect. The strict identity check correctly rejected the redispatch; the same restarted process successfully redispatched Integrity with its unchanged frozen hash `61e8080f...`, which distinguishes projection drift from a general recovery failure. The guard was preserved rather than bypassed.

The real panel then exposed another unresolved product failure: selecting the active child Task remained on `Loading task` and did not expose its lifecycle action. To stop the repeated twenty-minute wait loop without fabricating success or weakening the identity guard, the same Task was cancelled through authoritative `task.cancel` with `surface=api`. This made the same Mission terminal in Attention with `1 of 1 Tasks terminal` and the child status `Cancelled`; it does not satisfy the panel-only lifecycle criterion.

## Real-page evidence

- Current-source page: `http://127.0.0.1:5175/`, connected to the real managed backend at port 7878.
- Running packaged page: `http://127.0.0.1:7878/ui/`; response header `X-Opencorvus-Overlay-Ui-Source: embedded` proves this process still serves its older embedded bundle. It was not restarted or relabelled as current-source acceptance evidence.
- Artificial Intelligence dialog: compact fixed-width presentation; `Create with AI` is first and pressed by default; model `openai/gpt-5.6-terra`, Project `opencorvus`, and Expert Squad `Base` are all visible in the submitted state.
- Repaired journey: clicking `Send and create` waited for the backend and opened Mission `367daef83776f7f0` after about 18 seconds. Its real Mission Turn states the read-only action, the Composer retains `openai/gpt-5.6-terra`, and repository changes remain `+0/-0`.
- Board projection: the running acceptance Mission exposes `0 of 1 Tasks terminal`, `1 active`, child title `真实任务看板端到端验收`, and the canonical progress bar. The Work Ledger expands the same Mission into its child Task and exposes running cancel, archive, pin, and download controls without a second Task hierarchy.
- Pending interaction: the manual Dispatch Mission entered Attention and its real question was answered from the panel before exact cleanup.
- Permanent deletion: a card context menu exposed `Delete Mission`, followed by an explicit irreversible confirmation dialog; cleanup was verified against the backend list rather than inferred from visual disappearance.
- Running recovery screenshot: [`2026-08-07-mission-board-running-recovery.png`](../../artifacts/2026-08-07-mission-board-running-recovery.png). It shows the same Mission in Running with a stable five-column board, `0 of 1 Tasks terminal`, and one active child.
- Terminal board screenshot: [`2026-08-07-mission-board-terminal-cancelled.png`](../../artifacts/2026-08-07-mission-board-terminal-cancelled.png). It shows Running at zero, the same Mission in Attention, `1 of 1 Tasks terminal`, and child status `Cancelled`; the card widths remain stable.
- Terminal Task screenshot: [`2026-08-07-task-terminal-no-goals-artifacts.png`](../../artifacts/2026-08-07-task-terminal-no-goals-artifacts.png). It shows the real Task conversation recording frozen-projection rejection and repeated waits. The Goals dock action was keyboard-operable, but the authoritative status contained zero Goals and zero Requirements.
- Artifact-read screenshot: [`2026-08-07-task-terminal-artifact-read.png`](../../artifacts/2026-08-07-task-terminal-artifact-read.png). The only visible artifact-related control in the final Orchestrator Turn was an `artifact_read` tool record for Integrity artifact `art_fdaa156a7001aWSkLoeUtIprm2`; it was not a delivered Turn Artifact.

## Terminal acceptance facts

- Final Task status: `inactive`; lifecycle status: `cancelled`; running activity: zero.
- Final Mission status: `inactive`; Task Board lane: Attention; progress: one of one terminal.
- `GET /task/tsk_fda0d90cf001AbHmX03FJNGKVm/turn-artifacts`: empty array.
- Status projection: zero Goals and zero Requirements. No authoritative completion-decision artifact exists for this cancelled result.
- Consequently there was no real deliverable for the Conversation Artifact inspector to accept, reject, or rework. Opening the `artifact_read` tool record does not substitute for the absent Turn Artifact.
- The Task project/archive download path now completes successfully at the server and no longer fails filename extraction in the Overlay.
- Pending-question coverage came from the earlier real manual Dispatch flow. Retry/replan and acceptance controls were not exercised on this cancelled Task because its actual lifecycle did not present a valid successful completion surface.
- Mission `aac29528583f3aa8` was retained because it is the primary evidence identity. Wrong-Project Mission `5f64dd9ac9482802` was deliberately left untouched.

## Verification

- `bun test packages/overlay/test/mission-lifecycle-request-settlement.test.ts`: 1 pass, 0 fail.
- `bun test packages/opencorvus/test/orchestrator/process-recovery-input-authority.test.ts`: 2 pass, 0 fail.
- `bun test packages/opencorvus/test/server/cors-response-headers.test.ts`: 1 pass, 0 fail.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay build`: passed; existing bundle-size warnings only.
- `bun run --cwd packages/opencorvus typecheck`: did not pass because the current parallel worktree produces about 1,513 widespread Zod/Artificial Intelligence Software Development Kit schema type errors outside these files. No error was attributed to the recovery helper or Cross-Origin Resource Sharing change.
- `bun run api:routes-check` and `bun run docs:check`: did not pass because the unrelated parallel Model Context Protocol route work introduces the unstaged `MCPConfigureInput` API/documentation differences. Those files were not staged here.
- Node-driven Browser interaction: current page loaded Online, the same terminal Mission/Task identities were opened, screenshots were manually inspected, and the Task ZIP response completed without the prior filename diagnostic. Transient connection/EventSource diagnostics during the intentional 7878 restart are retained as restart evidence, not described as a clean-console result.

## Acceptance judgment

This delivery does **not** claim a complete panel-only end-to-end pass. It proves and publishes two additional canonical repairs: prepared Worker Turn recovery now resumes the correct occurrence, and allowed current-source Overlays can read the Task ZIP filename. The same Task reached a real terminal state, but only by authoritative API cancellation after the panel failed to expose its lifecycle control. It produced no Turn Artifact, Goal, Requirement, or completion decision, so Artifact inspection and acceptance could not be completed. These unmet surfaces remain material acceptance failures rather than accepted variances.

## Publication

- Authored implementation commit: `6efc0422a3` (`dsw-33987 fix Task recovery and archive download authority`).
- The first push ran and passed package typecheck, API route inventory, documentation generation, Overlay internationalization, and secret scan, then was rejected only because legacy remote had advanced to concurrent Computer commit `1a4ac332a5`.
- The implementation commit was cherry-picked onto that exact remote tip in an isolated detached worktree, producing `f124f66f677244317445aeb749334a99c6729f90` without touching the current worktree's unrelated changes.
- `git ls-remote legacy remote refs/heads/v0.0.33beta` returned `f124f66f677244317445aeb749334a99c6729f90` after the successful push.
