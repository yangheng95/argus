# Active Task Hang Repair Plan

Date: 2026-05-20
Status: implementation plan
Scope: active task/run convergence, integrity final gate semantics, orchestrator hard-error/closure, snapshot Windows capture hygiene, board revision projection, skill injection stage visibility.

## Evidence

Runtime DB + project-scoped board/progress probes showed 8 active tasks with no live `engine_executor_session`, no live `a2a_task_queue`, no pending tools, and no pending interactions. Their latest goal runs are terminal, while parent runs remain `running` or `blocked`.

The KeyStatistics task has an old latest run artifact:

- `status=blocked`
- `phase=dispatch`
- `blocking_reason=orchestrator_stream_error`
- `error=MessageAbortedError: LLMActivity total deadline 3600000ms exceeded`

Later operator messages created new root/build sessions, but no new parent run artifact cleared the blocked state. Board/progress therefore projected the durable state correctly; the writer path failed to record the new running fact.

## Non-goals

- Do not add UI fallback that reads child sessions when the parent run is stale.
- Do not auto-complete a task merely because all goals are completed; final completion still belongs to post-build integrity.
- Do not reintroduce `reviveZombieTasks` or silent background prompt retries.
- Do not swallow Git stderr or classify CRLF warnings as success when Git exits nonzero.
- Do not add hidden synthetic messages or alternative acceptance truth sources.

## Rule-35 Callpoint Map

| Area | Callpoints found | Decision |
| --- | --- | --- |
| Integrity aggregate verdict | `integrity/agent.ts::aggregateIntegrityVerdict`, `synthesizeResult`, `summarizeIntegrity`; consumers in `orchestrator/tools.ts`, `engine/model.ts`, `integrity/render-markdown.ts`, tests under `test/integrity` and `test/orchestrator/tools.test.ts` | Change the aggregate single source so accepted acceptance plus only advisory concerns is public `pass`; preserve per-dimension `concerns` in evidence. Rejected acceptance or any `needs_correction` remains non-pass. |
| Integrity completion gate | `orchestrator/tools.ts::integrity.execute`, `renderIntegrityOutcome`, `engine/model.ts` artifact tier predicate | Keep completion condition as `outcome.verdict === "pass" && phase === "post_build"`; after aggregate fix this no longer blocks advisory concerns. Update prompt wording to match the new semantics. |
| Operator wake/retry | `task-api/index.ts::appendAndWakeTaskOperatorMessage`, `retryTask`, `recordOperatorNote`; `engine/task-message-open.ts`; `engine/runtime.ts::createOperatorRun`; overlay callers in `chat.ts`, `task.ts`, `Gateway.tsx`, `panel.ts` | Add one service-side reopen primitive. Terminal task reopening stays in `openTaskForOperatorMessage`. Active blocked run reopening writes a durable run artifact clearing non-interaction blockers before dispatch. Do not change overlay behavior. |
| Parent run convergence | `engine/runtime.ts::monitorRuns`, `syncRun`, empty `syncGoalRuns`, `listGoalRunsForRun`, `PerRunState`, `queue.ts::advanceQueue`, tests `zombie-task-revive.test.ts`, `run-blocking.test.ts`, `protocol-interaction.test.ts` | Implement `syncGoalRuns` only as a convergence observer. If any goal run is live, leave it alone. If all goal runs are terminal and parent run is live with no pending interaction, clear stale blocking and dispatch the task loop once so orchestrator makes final integrity/repair decision. |
| Orchestrator hard errors | `orchestrator/agent.ts` direct `SessionPrompt.prompt`; `agent/runner.ts::buildHardErrorFromFinalMessage`; `session/compaction.ts` structured output error stamping; `session/loop.ts` terminal tool contract | Reuse the existing hard-error conversion after the orchestrator prompt returns. Compaction/structured output failures must enter the same stream-error/block/fuse path instead of plain assistant stop. |
| Non-pass closure | `prompt/core/orchestrator-core.txt`; integrity result text in `orchestrator/tools.ts::renderIntegrityOutcome`; `SessionPrompt.prompt` without terminal contract | Prompt fix first: non-pass post-build integrity cannot plain-text hand back while an in-task repair/fail action exists. Host hard-error covers malformed prompt/session failures, not tool-choice policy. |
| Snapshot Windows capture | `snapshot/index.ts::gitText`, `track`, `diffFull`; callers in `session/processor.ts`, `executor/managed.ts`, `engine/git.ts`; tests `test/snapshot/snapshot.test.ts` | Preserve fail-loud on nonzero. Align snapshot Git config with project capture by preventing global `safecrlf` from turning CRLF conversion warnings into snapshot failure, and add a focused Windows-style CRLF regression test. |
| Board revision | `workbench/board.ts::compileBoard`, `boardTag`; overlay `store/board.ts::snapshotVersion`, `frontend-preview.ts::previewRequestKey`, `ChangesPanel.tsx`, `sync.ts`, `conversation.ts` | Add a canonical backend `snapshotVersion` derived from board tag/latest sequence. Remove the permanently empty `no-snapshot` key path. This is UI correctness, not active-task convergence. |
| Skill injection | `engine/skill-inject.ts::resolveStageSkills`; docs under `docs/product/*/skills.md` and `packages/web/src/content/docs/*/skills.mdx`; tests under `test/engine/skill-inject.test.ts` | Auto-detected skill instructions must be visible across stages so agent teams do not lose task-relevant guidance due to stage labels. `stage` remains the owner for `required_tools`; cross-stage instructions are context only and cannot force another stage's tools. |

## Batch Plan

### Batch A — Integrity Gate Semantics

Owner write set:

- `packages/opencorvus/src/integrity/agent.ts`
- `packages/opencorvus/src/prompt/core/integrity-core.txt`
- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`
- `packages/opencorvus/test/integrity/agent.test.ts`
- `packages/opencorvus/test/orchestrator/tools.test.ts` only if gate behavior assertions need updating

Behavior:

- `acceptance.verdict === "rejected"` => aggregate `needs_correction`.
- Any dimension `needs_correction` => aggregate `needs_correction`.
- `acceptance.verdict === "accepted"` and no dimension `needs_correction` => aggregate `pass`, even when dimensions include `concerns`.
- Keep concerns visible in `dimensions`, markdown, and artifact payload.

Tests:

- accepted acceptance + one concerns dimension + no corrections/missing goals returns top-level `pass`.
- rejected acceptance still forces `needs_correction`.
- post-build integrity pass with per-dimension concerns completes task.

### Batch B — Durable Reopen + Goal-Run Convergence

Owner write set:

- `packages/opencorvus/src/engine/task-message-open.ts`
- `packages/opencorvus/src/task-api/index.ts`
- `packages/opencorvus/src/engine/runtime.ts`
- `packages/opencorvus/test/engine/task-message-revive.test.ts`
- `packages/opencorvus/test/engine/run-blocking.test.ts`
- new or existing `packages/opencorvus/test/engine/runtime-goal-run-convergence.test.ts`

Behavior:

- Active run blocked by interaction reasons remains blocked until interaction resolution.
- Active run blocked by `orchestrator_stream_error` or `integrity verdict ...` is reopened by an operator message/retry through a durable run artifact that clears `blocking_reason` and `error`.
- `syncGoalRuns` never completes a task. It only dispatches the orchestrator when all goal runs under a live parent run are terminal and no child/executor/pending interaction remains.
- Existing zombie-revive negative test remains true: no global active-task auto-revive loop.

Tests:

- `/message` path on active `run-blocked/orchestrator_stream_error` writes a latest `run-running` or `run-accepted` artifact with null blocker before dispatch.
- `retryTask` uses the same reopen primitive.
- `syncRun` with all terminal goal runs and parent `running` triggers one dispatch hook without marking task completed.
- `syncRun` with a live goal run does nothing.
- `syncRun` with pending interaction preserves blocked state.

### Batch C — Orchestrator Error Funnel + Closure Prompt

Owner write set:

- `packages/opencorvus/src/orchestrator/agent.ts`
- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`
- `packages/opencorvus/test/orchestrator/*`
- `packages/opencorvus/test/agent/runner-hard-error-propagation.test.ts` only for shared helper coverage

Behavior:

- After direct `SessionPrompt.prompt`, orchestrator inspects `finalMessage.info.error` using the shared `buildHardErrorFromFinalMessage` helper.
- Structured output/compaction errors become durable orchestrator stream-error artifacts and block/fuse through the existing path.
- Prompt states that post-build non-pass integrity requires one explicit in-task action (`build`, `modify_goal`, `architect`, `restart_from_stage`, `question`, `fail_task`, `propose_task`) unless no responsible repair exists, in which case `fail_task` or `question` is the explicit action.

Tests:

- orchestrator prompt returning an assistant message stamped with `StructuredOutputPayloadError` records `orchestrator-stream-error` and blocks the run.
- normal final text without message error and without stream error keeps current behavior.
- prompt hygiene test asserts non-pass integrity no longer permits passive "report/wait" wording as a scheduler stop.

### Batch D — Snapshot Windows Capture Hygiene

Owner write set:

- `packages/opencorvus/src/snapshot/index.ts`
- `packages/opencorvus/test/snapshot/snapshot.test.ts`
- optional `.gitignore` only if the trace-generated `specs/_codex-*.log` files are confirmed generated artifacts and not source evidence

Behavior:

- Keep `SnapshotIntegrityError` on nonzero Git exit.
- Ensure snapshot Git commands ignore global `core.safecrlf=true` when normalizing CRLF to LF under repo `.gitattributes`; this makes snapshot capture deterministic and aligned with its own `core.autocrlf=input`.
- Do not hide real invalid hashes, embedded repo failures, or empty-tree impossible states.

Tests:

- CRLF text in a repo with `* text eol=lf` can be tracked by snapshot without failing due to global safecrlf.
- A forced bad hash still raises `SnapshotIntegrityError`.
- Non-empty worktree still cannot return empty tree.

### Batch E — Board Revision Projection

Owner write set:

- `packages/opencorvus/src/workbench/board.ts`
- `packages/opencorvus/src/engine/model.ts`
- `packages/opencorvus/test/workbench/board.test.ts`
- `packages/overlay/src/store/board.ts`
- `packages/overlay/src/services/frontend-preview.ts`
- overlay tests if present for store/sync

Behavior:

- Backend board response includes `snapshotVersion`.
- `snapshotVersion` is derived from the same canonical board revision/etag source as `boardTag`, not from child sessions.
- Overlay no longer produces `taskID:no-snapshot` for a valid loaded board.

Tests:

- board `snapshotVersion` changes when relevant board sequence changes.
- overlay preview key uses returned version and never falls back to `no-snapshot` for a loaded board with a version.

### Batch F — Skill Injection Stage Visibility

Owner write set:

- `packages/opencorvus/src/engine/skill-inject.ts`
- `packages/opencorvus/test/engine/skill-inject.test.ts`
- `docs/product/en/opencorvus/skills.md`
- `docs/product/zh-CN/opencorvus/skills.md`
- `packages/web/src/content/docs/skills.mdx`
- `packages/web/src/content/docs/zh-cn/skills.mdx`

Behavior:

- Auto-detected skill instructions load whenever task/project signals match, independent of the active stage.
- `stage` no longer gates instruction visibility; it only scopes ownership of `required_tools`.
- Cross-stage prompt sections explicitly identify their source stage and context-only status.
- Figma URLs still do not route to mirror-generation skills.

Tests:

- webpage and image reference skills are visible to build as context while design-analysis keeps mirror required-tool ownership.
- plain code tasks do not force mirror skills.
- figma URLs do not load webpage/image mirror skills.

## Parallel Execution Order

Round 1 can run in parallel:

- Batch A: integrity aggregate/prompt/tests.
- Batch B1: operator/retry reopen tests and implementation.
- Batch D: snapshot CRLF tests and implementation.
- Batch E: board revision projection.
- Batch F: skill injection visibility and docs.

Round 2 depends on Round 1:

- Batch B2: `syncGoalRuns` convergence, because it must respect the new reopen semantics.
- Batch C: orchestrator hard-error funnel and prompt closure, because tests should assert the final non-pass semantics from Batch A.

Round 3:

- Integrate conflicts.
- Run focused tests per batch.
- Run `bun run --cwd packages/opencorvus typecheck`.
- Run root `bun run api:routes-check` only if `engine/model.ts` or route response schema changed.
- Run root `bun run docs:check` only if API docs generated output changes.

## Acceptance

- The 8-task active-hang shape has a defined convergence path:
  - user wake/retry clears stale active blocked run durably;
  - all-terminal goal runs trigger orchestrator final decision rather than empty runtime sync;
  - non-pass integrity cannot silently plain-stop without an explicit repair/fail action.
- Advisory concerns no longer prevent accepted post-build integrity from completing the task.
- Snapshot CRLF failures are deterministic and tested without swallowing real Git errors.
- Board/overlay use one canonical revision key.
- Auto-detected skills are not silently dropped at the build stage, while stage-owned tools remain scoped.
- Every code change is covered by targeted tests; no untested fix is accepted.

## Independent Review Feedback — 2026-05-20

Each batch was reviewed by an independent agent before the next repair round.

| Batch | Reviewer result | Repair decision |
| --- | --- | --- |
| A — Integrity | Blocking. `concerns` dimensions carrying concrete repair payloads could still aggregate to `pass`; integrity prompt/dimension docs still described old worst-of aggregate semantics; consumer completion lacked a post-build concerns regression; `engine/workflow.ts` was a missed verdict consumer. | Treat any `corrections`, `graphCorrections`, or `missingGoals` payload on a dimension as non-advisory and aggregate `needs_correction`. Update prompt/docs to distinguish advisory concerns from repair-bearing concerns. Add consumer tests for post-build pass-with-advisory-concerns completion and workflow projection. |
| B — Reopen/convergence | Blocking. The per-run `PerRunState.claimAgentNotification` latch suppresses later goal-batch wakeups under the same run; `recordOperatorNote` still uses the old `createOperatorRun` path; `syncGoalRuns` lacks live executor-session guard; `/message` test covers only the primitive. | Replace the latch with a batch fingerprint scoped to the current goal-run terminal set, route operator notes through the durable reopen primitive, check live executor sessions before convergence dispatch, and add route/service-level message coverage. |
| C — Orchestrator hard errors | Blocking. Prompt still allowed passive reporting after non-pass integrity; hard-error artifact recorded wrapper `AgentRunError` instead of the stamped underlying error; tests lacked normal/no-duplicate paths. | Remove passive-report wording, record underlying hard-error identity when available, and add normal final-text plus duplicate-error coverage. |
| D — Snapshot | No blocking findings. | Keep the CRLF/safecrlf fix as implemented; retain full snapshot test and focused CRLF/empty-tree/bad-hash coverage. |
| E — Board revision | Blocking. Overlay still accepts revisionless board hydrates and collapses preview keys to a task-only key; tests bless the fallback. | Reject full board payloads without `snapshotVersion`, keep board/store versions synchronized, and make preview key require a non-empty version for any task-scoped preview. |
| F — Skill injection | Blocking. Current diff had drifted to discovery-only metadata instead of injecting cross-stage skill bodies; multi-Figma text strips only one Figma URL; docs list stale built-ins. | Restore matched skill body injection across stages, keep stage-owned `required_tools`, strip all Figma URLs before generic URL detection, and sync built-in-skill docs/tests. |

## Final Independent Review Resolution — 2026-05-20

After the second repair round, each modified batch had independent review closure.

| Batch | Final review status |
| --- | --- |
| A — Integrity | No blocking findings after repairing repair-bearing concerns aggregation and removing stale worst-of documentation from prompt/tool/model comments. Focused integrity and workflow tests passed. |
| B — Reopen/convergence | No blocking findings. Residual note: a process restart can allow the same terminal goal-run batch notification to re-run once because the convergence dedupe is intentionally in-memory; this is a recovery-safe duplicate wake, not task completion. Focused revive/convergence tests passed. |
| C — Orchestrator hard errors | No blocking findings. Residual note: generic batch-complete guidance still contains a report-and-wait path outside the post-build non-pass integrity case; it is not part of the blocked closure path. Focused hard-error and prompt hygiene tests passed. |
| D — Snapshot | No blocking findings in the first review. A later full-file Windows run exposed snapshot test fixture timeouts from unnecessary commits and primary-worktree prewarming; an independent reviewer blocked the first attempted speedup because it removed git project semantics. Final repair keeps real git repos, uses committed fixtures only for `git worktree add` tests, removes unused primary snapshot prewarming, and preserves non-global/distinct project-id assertions. Full `snapshot.test.ts` passed in both local and independent-review runs. |
| E — Board revision | No blocking findings after rejecting revisionless board hydrates, synchronizing overlay board versions, and requiring task preview keys to include `snapshotVersion`. Overlay board/preview tests passed. |
| F — Skill injection | No blocking findings after correcting the web zh-CN docs line that still described old `spec`/`delivery` stage semantics. The reviewer confirmed all four skills docs align on `required_tools` ownership semantics and reran `bun test packages/opencorvus/test/engine/skill-inject.test.ts`. |

## Validation Toolchain Addendum — 2026-05-20

During the final Batch F test group, `packages/opencorvus/test/agent/agent.test.ts` had one transient 5s timeout in `explore agent limits exposed tools without permission denials`. The same test passed alone and the full F group passed on immediate rerun, but independent review found a real isolation issue: `agent.test.ts` created many `Instance.provide` contexts without the per-test `Config.global.reset()` / `Instance.disposeAll()` cleanup already used by neighboring agent tests. The post-review repair is limited to that test isolation pattern; the other `agent.test.ts` diff lines are the earlier Batch F assertions that stage agents expose the `skill` tool. The default plugin dependency-install noise is recorded as a broader test-environment issue and was not folded into this active-task hang repair batch.
