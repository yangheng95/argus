# Task Closure Residual Escape Removal

Status: Implementation complete; live cardinality benchmark externally blocked
Date: 2026-08-03
Owner: Codex

## Recall

| Field | Evidence |
| --- | --- |
| User request | “Task 应该是闭包，不准工作量逃逸，一个 Mission 典型 Task 少于 3 个”；用户确认已经做过相关改动，要求基于当前代码继续调查、优化，并由独立 Agent 审查残留问题。 |
| Acceptance target | A Mission defaults to one outcome-complete Task. A second Task requires a different fixed Expert Squad, an already accepted external Task Artifact/real operator-authority boundary, or an explicit operator request for a separate lifecycle. Repair, retry, replan, retest, review, provider/process recovery, evidence publication, and final assembly retain the original Task ID. |
| Hard constraints | Preserve every parallel change; no stash/reset/restore/new worktree. Do not mutate or restart the live OpenCorvus process or database. Do not add, modify, or run User-Interface automation tests. Use prompt/root-cause repair rather than a Task-count Host gate. Commit subject starts with `dsw-33987`; push to `myhexin/v0.0.28beta`. |
| Current repository state | Work resumed after coordinated parallel merges at clean HEAD `46445954b9de047a9cbba02241f63c1cd91a2b2a`, equal to `myhexin/v0.0.28beta`. |
| Prior records read | `2026-08-02-mission-task-delivery-closure-granularity.md`, `2026-08-02-phase-local-build-closure-orchestration.md`, `specs/current/architecture/03-control.md`, `04-extensions.md`, `13-agent-communication-matrix.md`, and `15-agent-facts-and-turns.md`. |
| Whole-repository search | Enumerated every `propose_task`, `auto_confirm_proposed_tasks`, scheduler child-Task writer/reader, `parent_task_id`, Mission `create_task` description, `Phase NN` title formatter, Retry/Replan occurrence assertion, Goal-mutation occurrence assertion, `send_task_message`, dispatch continuation, process-recovery, relevant current docs, generated contracts, and focused non-UI tests. |
| Live read-only evidence | The latest five large single-`base` Missions created 41 Tasks: 5/8/8/9/11 (mean 8.2, median 8). Sixteen of 41 (39%) were repair/resume/retest/review/closure/snapshot Tasks. Every row was Mission-created with `prompt_profile.active=base`, so cross-Squad ownership does not explain the split. The running sidecar predates the latest closure commits, so this data proves the old failure pattern but is not acceptance evidence for current source. |
| Independent Agent feedback | Three one-level, read-only Agents independently audited Mission boundaries, lifecycle/recovery, and live data. They agreed that the remaining roots are the auto-confirmed Orchestrator child-Task path, `Phase NN` Host naming, stale Panel creation guidance, Retry/Replan occurrence rejection, missing Mission follow-up model override, and the absence of a general physical continuation path for an existing workflow occurrence. No Agent modified files or delegated further. |

## Causal chain

1. Mission prompt wording now prefers large closures, but model-visible and Host surfaces still encode the retired opposite behavior.
2. `propose_task` lets a Task Orchestrator turn a module, document, Artifact, benchmark, toolchain, or review finding into a new engine Task; configuration auto-confirms that creation by default.
3. Mission `panel.create_task` guidance still describes capability-production and later-domain “phase Tasks”, while the Host forces every Mission title to `Phase NN: ...`.
4. A terminal Task that owns any dispatch lineage cannot use Retry/Replan. Provider, process, or tool failure therefore cannot use the ordinary recovery control and is routinely recreated under a new Task ID.
5. Mission follow-up can reopen the same Task, but its `send_task_message` schema omits the already-supported explicit model override. A failed provider/model is therefore selected again.
6. The only existing physical redispatch path that reuses a logical `workflow_occurrence_id` depends on a worker-authored coordination request. Provider/process interruption and downstream reviewer findings do not necessarily produce that request, so the prompt promises same-Task repair without a general executable lineage operation.

## Single-source design

- Mission is the only autonomous owner of cross-Task stage boundaries. A Task Orchestrator cannot create engine child Tasks.
- Mission-created Task titles remain semantic titles; ordinal phase formatting is removed.
- `panel.create_task` describes one complete closure and fixed profile. It does not advertise automatic Squad production or “phase Task” fan-out.
- Retry reopens a terminal Task regardless of existing immutable workflow evidence. It preserves Task, profile, package revision, workflow binding, prior occurrences, Artifacts, and messages.
- Replan also reopens the same Task and records a durable intent. Goal revisions remain append-only facts in the same Task; prior dispatch evidence remains immutable.
- Mission `send_task_message` may carry an explicit validated `provider/model` reference to recover the same Task from provider/model failure. There is no implicit fallback.
- Physical continuation names one exact prior dispatch lineage. The Host derives the fixed worker identity, work scope, workflow binding/node, logical occurrence, and Slice subjects from that lineage; the new Session/Turn is another physical attempt, not another workflow occurrence.
- New engine Tasks represent only a genuine different-Squad/authority/lifecycle boundary selected by Mission or an explicit control-plane request.

## Call-point disposition

| Surface | Disposition |
| --- | --- |
| `src/orchestrator/task-proposal-tool.ts`, `tools.ts`, tool pool, Host registry, Architect repair metadata | Delete the Orchestrator child-Task action and every model-visible reference. |
| `src/config/config.ts` | Delete `experimental.auto_confirm_proposed_tasks`; it has no remaining behavior owner. |
| `src/task-api/index.ts`, engine model/store | Delete scheduler child-Task creation and retired parent projection; preserve Mission ownership metadata. Remove ordinal Mission title formatting. |
| `src/panel/capability.ts`, `src/tool/panel.ts` | Replace stale phase/capability-production language; add and forward explicit optional `model` on `send_task_message`. |
| `src/task-api/index.ts`, routes | Allow terminal Retry/Replan to reopen the same Task with durable intent even after workflow evidence. Keep active/queued lifecycle conflicts and fixed profile/package identity. |
| `src/orchestrator/dispatch-agent-tool.ts`, `tools.ts`, dispatch lineage | Add exact prior-lineage physical continuation as part of the single `dispatch_agent` surface. Reuse the prior logical occurrence without requiring an Agent-to-Agent request. |
| process recovery | Preserve incompatible descriptor evidence, close only the obsolete physical Session, and wake the original Task for lineage continuation instead of terminalizing the business Task. |
| Mission/Base/general prompts | Make one Task the normal cardinality, a second Task boundary explicit, and a third exceptional; narrow “outside-Task evidence” to already accepted Task evidence or real operator authority. |
| Current architecture and product docs | Remove scheduler child Tasks, `Phase NN`, no-occurrence Retry, and new-repair-Task language; document same-Task physical continuation. |
| Non-UI tests | Delete retired child-Task suites/cases; add positive same-ID Retry/Replan, model-aware Mission follow-up, semantic title, post-occurrence append-only Goal revision, and prior-lineage continuation coverage. |
| Generated SDK/OpenAPI | Regenerate from the canonical source after schema/route changes. |

## Validation plan

1. Run focused Orchestrator dispatch/continuation, Task Retry/Replan, Mission Panel, title, Goal revision, and process-recovery non-UI suites.
2. Run `bun run --cwd packages/opencorvus typecheck`, route/API generation checks, docs single-source checks, historical links, document health, and `git diff --check`.
3. Perform a second source and test review against every independent-agent finding and the full call-point search.
4. Do not claim live acceptance from the stale packaged sidecar. A fresh build/relaunch and new Mission benchmark require separate authorization because they mutate the active runtime.
5. Commit only task-owned paths, push `v0.0.28beta` to `myhexin`, and verify remote containment.

## Atomic batch 1

The first merge-coordinated batch removes the model-visible Orchestrator
`propose_task` action and its direct tool implementation. It also removes the
Host prompt, Architect metadata, and tool-pool guidance that advertised
autonomous child-Task creation. The legacy configuration shape and historical
task-lineage readers remain temporarily present because concurrent branch
integration required this batch to stop expanding its file set; they no longer
have a model-callable writer. Retry/Replan, Mission model-aware follow-up,
semantic Mission titles, and general lineage continuation remain explicitly
pending in the next atomic batch.

## Atomic batch 2

The second batch removes the remaining executable and model-visible child-Task
surface:

- delete the scheduler child-Task writer, auto-confirm configuration, child
  projection from the public Task contract, and `query_task.includeChildren`;
- preserve Mission-authored semantic titles instead of manufacturing
  `Phase NN` titles;
- allow terminal Retry/Replan after immutable workflow evidence and reopen the
  same Task while preserving every prior occurrence;
- forward an explicit `provider/model` reference through Mission
  `send_task_message`;
- add `dispatch_agent.dispatch.continuation_dispatch_id`, which derives the
  fixed worker identity, work scope, workflow binding/node, logical occurrence,
  and Delivery Slice subjects from one exact prior dispatch lineage and records
  a new physical Session/Turn in the same Task.

Focused verification passed for the full positive contract: post-occurrence
same-ID Retry, semantic Mission titles, model-aware Mission follow-up, bounded
Task query, dispatcher schema, exact prior-lineage continuation, and Host-level
continuation lineage persistence. Package typecheck, API route consistency,
historical document links, schema snapshot, and `git diff --check` also passed.
The live packaged sidecar was not restarted or used as current-source
acceptance evidence.

The independent post-commit review found and closed three further residuals:
frontend-replica, frontend-innovate, and review-debug package prompts still
instructed repair/review findings to create new Tasks; one selector still named
the deleted `propose_task` action; and a stale Orchestrator tool test still
called that action. Those prompt paths now require exact prior-lineage physical
continuation in the same Task, and the obsolete test branch is deleted.
Retry/Replan coverage now persists a valid dispatch lineage for both intents.
The Host continuation integration uses a non-null virtual-workflow node and
asserts that the engine Task identity set is unchanged before and after the
fresh physical Turn.

A final independent read-only review found one role-ownership ambiguity in the
new package wording: repair and re-verification could both target either an
implementation or reviewer lineage. The final contract now assigns product
repair only to the exact prior implementer/repair-implementer dispatch and
assigns post-repair verification only to the exact affected reviewer dispatch.
Each physical continuation preserves its own logical occurrence and Delivery
Slice subjects inside the same Task. The canonical embedded expert-squad
payload was regenerated from those repository package sources and its source
parity tests passed.

## Current-source isolated runtime attempt

The final current-source Mission cardinality benchmark was attempted after the
implementation and generated contracts were merged at
`6d76cbbef644928472ea56861b1de7d5268409a8`. The server used a disposable
`OPENCORVUS_HOME`, database, Git fixture, and dynamic port `49620`; the packaged
server on port `7878` and its production database were not restarted or
mutated.

The live benchmark did not reach Task dispatch because every configured
Provider path failed before `panel.create_task`:

- `hexin/claude-sonnet-4-6` returned HTTP 502 with an upstream LiteLLM
  `unknown provider` error.
- `deepseek/deepseek-chat` returned HTTP 402 `Insufficient Balance`.
- `hexin/gpt-5.4` completed the Mission contract/catalog and repository
  inspection Turns, then returned the same upstream HTTP 502 routing error.
- The exact same `closure-fix-gpt54` Mission and Session were resumed with
  `hexin/gpt-5.5`; the upstream gateway again returned HTTP 502. After an
  explicit abort, that same Mission and Session were resumed with
  `hexin/gpt-5.4-mini`; it completed the repository reads but its next streaming
  call emitted no event for more than two minutes and was explicitly aborted.

The isolated database contained three Mission Sessions and zero `engine_task`
rows. `closure-fix-gpt54` retained one Mission ID and one Session ID across both
model recoveries, so the interruption itself did not create a replacement Task
or Mission. Zero Tasks is not cardinality success: no run reached dispatch,
workflow execution, repair continuation, or terminal acceptance. Therefore the
source and non-UI contract implementation is complete, but the live acceptance
claim “three completed current-source Missions each use fewer than three
Tasks” remains unachieved until a configured streaming Provider completes the
Mission and worker calls.
