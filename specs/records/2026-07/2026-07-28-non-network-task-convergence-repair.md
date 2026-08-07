# Non-network Task convergence repair

Status: Complete
Date: 2026-07-28
Owner: Codex

## Recall

### User request

修复 Task Debug Info 暴露出的、除网络与 Provider 冷却以外的问题。

### Acceptance criteria

- A Mission-originated `panel.cancel_task` or `session.delete` cancellation
  records the exact canonical Mission ID together with its Session and ToolPart
  identity.
- A Goal-scoped Build that can overlap another write-capable Goal Build is
  scheduled in a managed worktree; `current_project` remains a serial,
  caller-owned execution mode.
- Orchestrator reports distinguish a real persisted tool call/result from a
  contract-derived prediction that was never executed.
- Retry/replan cannot let an older passive wake reopen a Task after the fresh
  scheduler decision makes it terminal.
- Repeated same-source context growth remains eligible for another automatic
  compaction epoch; Provider fallback/cooldown behavior is outside this repair.
- Focused tests, documentation health, typecheck, second review, commit, and
  `legacy-remote` push pass without touching the running OpenCorvus/Overlay process or
  historical Task database.

### Hard constraints

- Preserve all concurrent commits and worktree changes; do not reset, restore,
  stash, clean, or create another worktree.
- Do not restart, refresh, stop, or otherwise manipulate OpenCorvus, Overlay,
  or sidecar processes.
- Do not rewrite the historical Task or database. SQLite investigation is
  immutable/read-only.
- Repair LLM scheduling behavior through the canonical prompt/tool contract,
  not a Host gate, state machine, keyword matcher, fallback, or second source.
- Every changed behavior needs focused regression coverage.
- Commit subjects use `dsw-33987`; delivery follows the current branch to the
  `legacy-remote` remote without bypassing hooks.

### Sources read

- `AGENTS.md`
- supplied Task Debug Info
- immutable live SQLite Task, Session, Message, Session-control, Protocol-event,
  Goal-attempt, Host-observation, queued-wake, and decision evidence
- `packages/opencorvus/src/engine/cancellation-origin.ts`
- `packages/opencorvus/src/engine/cancellation-projection.ts`
- `packages/opencorvus/src/engine/queue.ts`
- `packages/opencorvus/src/task-api/index.ts`
- `packages/opencorvus/src/tool/panel.ts`
- `packages/opencorvus/src/mission/session.ts`
- `packages/opencorvus/src/orchestrator/agent.ts`
- `packages/opencorvus/src/orchestrator/build-tool.ts`
- `packages/opencorvus/src/orchestrator/dispatch-agent-tool.ts`
- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`
- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/src/session/processor.ts`
- focused cancellation, queue, Orchestrator prompt/tool-description, and
  compaction tests
- `specs/current/architecture/03-control.md`
- `specs/current/architecture/10-worktree-lifecycle.md`
- `specs/current/architecture/15-agent-facts-and-turns.md`

### Whole-repository search evidence

Repository-wide searches covered every `TaskCancellationOrigin` parse and
projection, all cancellation sources and callers, `panelMutationIdentity`,
Mission Session resolution, every `queued_operator_wake` drain/discard path,
retry/replan ingress, all `use_worktree`/`current_project`/`managed_worktree`
prompt and adapter call sites, Orchestrator failure-report evidence wording,
`ContextOverflowError`, predictive/reactive compaction, repeated compaction
epochs, and their focused tests. The search found one canonical cancellation
origin schema and projection, one panel mutation identity constructor, one
dispatch schema mapping `use_worktree` to Build execution mode, and one
Session-loop compaction owner.

### Independent Agent feedback

No independent Agent was requested for this task, and the current execution
policy forbids unsolicited delegation. Codex performs the required second
review locally after focused validation.

## Evidence-led causal chain

| Observable symptom | Direct trigger | Deeper cause | Repair |
| --- | --- | --- | --- |
| Debug Info printed `task.cancellation.mission: -` although actor was Mission | `panelMutationIdentity` returned Session/Tool identity only | `TaskCancellationOrigin` grouped Mission with other panel agents and explicitly forbade `missionID` | Split the Mission variant, resolve canonical Mission metadata at the panel boundary, and require its ID |
| Two write-capable Goal Builds saw each other's files in one project directory | Both dispatches selected `use_worktree=false` | Prompt/tool wording allowed concurrent “proven-disjoint” writes to share `current_project`, but transitive imports/generated files made that proof unsound | Make managed worktrees the stated contract for overlapping-in-time Goal Builds; keep current-project Goal Build serial |
| Final narrative said Goal #4 rejection was rejected although no such ToolPart existed | Contract behavior was reported as if it had executed | Prompt required fact-backed claims generally but did not state the execution/counterfactual boundary precisely | Require exact tool input/output evidence for “called/rejected”; label unexecuted contract predictions as inference |
| Failed Task reopened active after retry | An older queued wake remained pending when the retry wake later terminalized | The previous runtime did not discard stale queued wakes before creating the fresh retry epoch | Current `wakeTaskForIntent` already discards pending wakes first; add the exact passive-wake → retry → terminal regression |
| Context overflow appeared after a successful compaction | A long Orchestrator Session grew again | The historical process surfaced a Provider overflow; network fallback then also failed | Current source already permits a second same-source compaction when post-summary material exists and has focused tests; verify rather than add a second recovery path |

## Call-point disposition

| Surface | Disposition |
| --- | --- |
| `engine/cancellation-origin.ts` | Replace the grouped panel-agent branch with a required-Mission-ID Mission branch plus a non-Mission panel-agent branch |
| `tool/panel.ts::panelMutationIdentity` | For Mission actor, resolve `requireMissionSession(ctx.sessionID)` and return its canonical `missionID`; preserve user/control/right-sidebar identities |
| `task-api/index.ts::cancelTask` | Preserve; it already validates and projects `missionID` into the durable request event |
| cancellation projection/Debug Info | Preserve; both already render `missionID` when present |
| `dispatch-agent-tool.ts` and Orchestrator core prompt | Tighten the natural scheduling contract; do not add Host admission logic |
| `build-tool.ts` | Preserve single execution source; it already defaults Goal Build to managed worktree and maps explicit `current_project` only when requested |
| `task-api/index.ts::wakeTaskForIntent` | Preserve stale-wake discard; add production-shaped regression |
| `session/loop.ts` and compaction owner | Preserve; current repeated-epoch logic is the single recovery source |

## Validation plan

1. Cancellation schema and real Mission panel cancellation tests.
2. Orchestrator prompt/tool-description contract tests.
3. Queue regression covering a passive wake that invokes retry and whose fresh
   wake records a terminal decision.
4. Existing repeated-compaction decision and durable Orchestrator compaction
   tests.
5. Focused typecheck, historical links, document health, product-doc
   single-source checks, and local second review.

## Validation findings

The first focused run passed the new cancellation, stale-wake, and repeated
compaction checks but exposed two older test-contract drifts. The Orchestrator
core test still asserted phrases removed when Artifact discovery became
consumer-owned, and the durable-descriptor compaction test still expected the
retired `systemMode` field to survive `Message.User` parsing. Their assertions
are updated to the current single sources; production prompt projection and
Session persistence are not reverted to satisfy stale tests.

## Completion evidence

- Focused cancellation, panel, queue, Orchestrator prompt/tool, dispatch,
  predictive compaction, durable compaction, Gateway, and Mission-route suites:
  198 passing tests, zero failures across the two focused batches.
- Workspace typecheck: 8 packages passed.
- Historical links, document health, and product-doc single-source suites:
  93 passing tests, zero failures.
- The historical SQLite database was queried only through `immutable=1`; no
  Task, Session, Goal, wake, protocol event, or process was mutated.
- No frontend surface changed, so browser screenshot acceptance is not
  applicable.

## Codex second review

The final staged diff was reviewed against every searched call point and the
single-source rules:

- Mission provenance is produced once at `panelMutationIdentity`, required once
  by `TaskCancellationOrigin`, and consumed by the existing protocol
  projection; there is no metadata mirror or compatibility branch.
- Build isolation remains a natural scheduler/tool contract. No Host gate,
  state machine, or second Build execution mode was added.
- Retry wake behavior remains owned by the existing queue discard path; the new
  test proves the historical passive wake cannot survive to reopen the fresh
  terminal result.
- Context overflow continues through the existing predictive/reactive
  compaction owner. No network retry or fallback behavior was added.
- Control, right-sidebar, direct user, Gateway, Mission-route, and Orchestrator
  cancellation identities remain unchanged and covered.
