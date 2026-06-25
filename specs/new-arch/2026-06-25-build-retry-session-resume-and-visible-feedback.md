# Build Retry Session Resume And Visible Feedback

Date: 2026-06-25

## Problem

Goal build retry still had two separable failure modes:

1. `build({ goalID, freshContext: true })` let the orchestrator skip the prior
   build session and create a fresh session for a retry.
2. Even when retry reused the build session, `BuildAgent.run` rebuilt the
   first-dispatch attachment envelope, so the retry user turn repeated the
   visual reference contract, staged attachment list, attachment inventory, and
   original multimodal parts.

The first path breaks session continuity. The second path makes a real
same-session retry look like a synthetic full redispatch and increases prompt
and image pressure.

Follow-up correction, 2026-06-25: the attachment replay was removed, but the
same retry turn still carried synthetic prose from three smaller sources:
retry-feedback instructions, acceptance raw-packet JSON, and orchestrator
`request` guidance rendered ahead of persisted failure facts. A retry should
send the recorded failure itself, not a second prompt envelope about how to
retry.

Scheduler prompt correction, 2026-06-25: the orchestrator must treat
per-goal retry and continuation as one `build({ goalID })` decision. It should
resume a resumable prior build session first. If the prior session context is
unavailable, build opens a fresh child session with no copied transcript while
reusing the recorded goal worktree. Missing or invalid recorded worktree state
is the structural error.

Context-recovery correction, 2026-06-25: the new invariant is ordered recovery,
not hard same-session-only retry. Retry must prefer the prior context when it is
provably resumable. If that context is unavailable, the build tool must create a
fresh child session with no copied message history while reusing the recorded
goal worktree. The worktree is the durable implementation state; the session
transcript is not.

## Recall

| Source | Constraint |
| --- | --- |
| `2026-05-21-build-retry-session-reuse-runtime-contract.md` | Build retry must reuse the prior build session, open a new logical `goal_run_id`, install a fresh runtime contract, and append one incremental visible user message. |
| `2026-06-22-build-terminal-finalizer-continuation.md` | Build protocol recovery is same-session and visible; do not synthesize success from prose. |
| `2026-06-24-a2a-agent-lifecycle-coordination.md` | Fresh retry is exceptional only when concrete facts prove the old worker cannot continue; ordinary worker repair resumes the existing session. |
| `2026-06-24-build-toolchain-blocker-persistence.md` | Local worktree/toolchain blockers remain build-owned; retry should repair the preserved worktree state instead of escaping it. |
| `AGENTS.md` | No fallback, no hidden/synthetic messages, no gate-style bypass, no double source. |

## Call-Site Inventory

| Surface | Current behavior | Required change |
| --- | --- | --- |
| `orchestrator/tools.ts::build` schema | Exposes `freshContext` and describes it as a new-session escape hatch. | Remove the field and the branch. Fresh context is not an operator/model flag; it is selected only from verified session facts while keeping the same worktree. |
| `orchestrator/tools.ts::build` retry session selection | Reuses prior terminal `session_id` by default, unless `freshContext` is set. | Prefer the latest terminal `session_id` only when the session exists, is `kind="build"`, belongs to the same goal, and points at the recorded worktree. If not resumable, pass no `existingSessionID` and keep the same `managedWorktree`. |
| `engine/persist.ts::ensureBuildRetryFeedbackForGoal` | Appends terminal status, retry count, session/worktree metadata, build report, and "Required for this retry" instructions. | Persist only failure facts: terminal error and build-report error/summary when present. No retry instructions. |
| `orchestrator/tools.ts::build` retry feedback renderer | Wraps retry entries in "previous attempt" and "required" prose, and appends decision-log `reason`. | Pass only decision-log `value` text to BuildAgent. Keep `reason` audit-only. |
| `prompt/core/orchestrator-core.txt` per-goal retry guidance | Says goal retry resumes prior session, but does not define the non-resumable context branch. | State that resumable sessions are resumed first, non-resumable sessions open a fresh child session with no copied transcript, and the recorded goal worktree is reused. |
| `composeAcceptanceRetryFeedback` | Copies a raw persisted feedback packet JSON into the build prompt. | Render scoped rejection facts and manifest failure lines only. Do not inline raw artifact packets. |
| `BuildAgent.run` attachment prompt assembly | Uses `renderVisualContractPreamble(...)` and inlines all task attachments on retry. | On `existingSessionID`, append only incremental retry feedback text. Do not repeat original visual contract, staged list, inventory, or original task file parts. |
| `buildRetryFeedbackPrompt` | Rebuilds a mini prompt with target labels, overlays, default instructions, and terminal-report reminders. | Emit only failure facts. Use current `request` text only when no persisted failure facts exist. |
| External build executor resume | Calls provider `resume` when `existingSessionID` is supplied. | Preserve this. The prompt passed to `resume` must be the same incremental retry feedback only. |
| Tests | Positive tests pin `freshContext`. | Replace with negative schema/description coverage and prompt-capture coverage for incremental retry. |

## Decision

Remove `freshContext` completely from the build tool. A goal retry has one
ordered behavior: reuse the latest terminal build session id when it is
resumable; otherwise start a fresh build session with no copied transcript while
reusing the goal's recorded worktree. In both cases the runtime contract is
fresh and the visible retry feedback is one user message built from durable
facts.

If the prior terminal attempt lacks a session id but the recorded worktree is
valid, the new session path is used. If both the session context and recorded
worktree are unavailable, the build tool fails structurally before model contact.
That is not a fallback condition; it is lost implementation state that needs
explicit repair.

Retry prompt assembly must be incremental:

- keep `buildRetryFeedbackPrompt(...)`;
- keep visible text in a normal user message;
- render only recorded failure facts: prior goal-run terminal error, latest
  build report error/summary, integrity findings, or acceptance rejection facts;
- do not re-emit the first-dispatch visual contract or original task
  attachment inventory;
- do not inline the original task visual attachments again;
- do not re-emit task-specific overlays, raw acceptance artifact JSON, generic
  retry instructions, or decision-log audit `reason`;
- include `request` on a same-session retry only when no persisted failure fact
  exists, so it acts as one direct operator/orchestrator feedback line rather
  than another synthetic wrapper;
- external executors must receive the same incremental text through
  `provider.resume`.
- the scheduler prompt must define ordered recovery: resumable session first,
  then fresh session with no copied transcript on the recorded worktree.

New acceptance-rendered retry attachments can be designed separately if needed;
this fix closes the repeated original-context splice.

## Acceptance

- `build` tool schema has no `freshContext`.
- `build` tool description does not expose a model/operator
  `freshContext` flag, but documents host-selected fresh-context recovery from
  durable non-resumable prior-session evidence while reusing the recorded
  worktree.
- Goal retry tests prove prior build session id is reused by default.
- Goal retry tests prove a non-resumable prior session opens a fresh child
  session without copying old messages while reusing the same worktree.
- Tests prove the misspelled-field strict schema still rejects unknown goal
  scope fields and now also rejects `freshContext`.
- External executor retry with `existingSessionID` calls `provider.resume`, not
  `provider.run`, and the prompt does not contain `Visual Reference Contract`
  or task attachment inventory.
- Build retry still preserves runtime contract rebinding through
  `runAgentSession({ existingSessionID, runtimeContract })`.
- Same-session retry prompt does not contain `Task-Specific Build Overlays`,
  `Required Fix`, `Instructions`, terminal-report reminders, or decision-log
  `reason` text.
- Acceptance retry feedback does not contain raw persisted artifact JSON.
- Persisted goal retry feedback contains the recorded terminal/build error
  facts without "Required for this retry" instructions.
