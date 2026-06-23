# Orchestrator No-Decision Stop Root Cause

## Problem

Two long hangs were not caused by a child build session continuing forever.
The orchestrator was already awake, but the wake ended without an actionable
decision:

- `tsk_ed7027522001zbViExuuApIvfh` stopped at local time
  `2026-06-18 06:16:49` after calling only `read_context`, then emitted prose
  saying more goals were dispatchable. The next progress came from a root user
  message at `2026-06-18 08:04:18`.
- `tsk_ed5ad6f0f001TZdNXlZKkCN4f8` stopped at local time
  `2026-06-18 05:41:55` with malformed provider tool-call residue rendered as
  text (`<|tool_call_argument_begin|>...<|tool_calls_section_end|>`). The next
  progress came from a root user message at `2026-06-18 08:05:09`.
- A separate earlier gap produced an empty assistant shell at local time
  `2026-06-18 01:21:28` (`finish=null`, `parts=0`, no error artifact).

`engine.liveness` is intentionally out of scope for this fix per operator
direction on `2026-06-18`: the primary failure is not lack of a timer but a
successful-looking orchestrator wake that made no decision.

## Call Point Inventory

Command:

```powershell
rg -n "finish|TerminalToolContract|terminalTool|processTask|SessionPrompt|modify_goal|dispatch|wake|liveness|monitorRuns|recordStream|stop" packages/opencorvus/src/orchestrator packages/opencorvus/src/session packages/opencorvus/src/engine packages/opencorvus/src/task-api
```

Relevant surfaces:

| Surface                                                       | Evidence                                                                                                                       | Decision                                                                                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/orchestrator/loop.ts`                | One wake is one orchestrator decision pass; no internal loop.                                                                  | Keep. Do not add a scheduler or hidden retry loop here.                                                                               |
| `packages/opencorvus/src/orchestrator/agent.ts`               | `processTask` only treats hard errors / stream errors / INFORMATION MISSING as failures. Plain `finish=stop` text is accepted. | Add an orchestrator decision-contract check after the prompt returns.                                                                 |
| `packages/opencorvus/src/session/loop.ts`                     | Terminal-tool recovery only runs when a `terminalToolContract` exists. Orchestrator has none.                                  | Do not retrofit worker terminal-tool semantics into orchestrator. Add orchestrator-specific contract validation at the host boundary. |
| `packages/opencorvus/src/orchestrator/stateful-tool-names.ts` | `read_context` and `query_failed_goals` are read-only state snapshots.                                                         | A wake that only used these and then prose-stopped is no decision.                                                                    |
| `packages/opencorvus/src/session/repair-hint.ts`              | Repairs malformed structured tool calls only when the provider emitted an actual tool call.                                    | Text containing provider tool-call sentinel tokens is not repairable there; surface as orchestrator protocol failure.                 |
| `packages/opencorvus/src/engine/persist.ts`                   | `recordOrchestratorStreamError` + fuse already preserve orchestrator failures.                                                 | Reuse the existing error funnel; do not create a second persistence path.                                                             |

## Fix

Add a pure classifier in `orchestrator/agent.ts`:

- if the active task is already terminal after the wake, accept the stop;
- if final text contains provider tool-call sentinel residue, classify as
  malformed tool-call text;
- if the assistant message has no finish and no tool/text parts, classify as an
  empty assistant turn;
- if `finish=stop` and the wake made no tool calls, classify as no decision;
- if `finish=stop` and all tools called in the wake were read-only snapshots
  (`read_context`, `query_failed_goals`), classify as no decision.

On classification, throw an `AgentRunError` whose cause is
`OrchestratorNoDecisionStopError`. The catch path records the orchestrator error
artifact and immediately schedules one more visible orchestrator wake for the
same task, unless the stream-error fuse has already tripped.

This is a contract-validation failure, not a routing state machine: the host
does not choose the next workflow tool and does not synthesize a successful
decision. It only refuses to mark a decision wake as successful when no
decision happened, then re-enters the same task loop so the LLM sees the
visible no-decision artifact and decides the next action itself. Repeated
no-decision failures are bounded by the existing stream-error fuse; only the
fuse path marks the task failed. A single no-decision must not block the active
run or stamp `task.error`, because that just replaces the old silent hang with
a user-waiting hard stop.

General stream errors, aborts, and prompt errors still use the existing hard
error path. The self-wake is only for `OrchestratorNoDecisionStopError`, because
that error means the stream completed and the model had enough context to make
a decision but failed the orchestrator decision contract.

## Adversarial Review Follow-up

Independent review found one remaining way to turn the fix into another hang:
`dispatchTaskLoop` can return `queued` when a live orchestrator tool ownership
exists. That means the wake event was only parked in `queuedTaskEvents`. Before
this follow-up, the event was drained only by the task-loop completion hook; if
tool ownership was still live at that exact moment, ownership completion later
did not drain it. The single source for queued event drain must therefore be in
`engine/queue.ts`, and `completeOrchestratorToolOwnership` must call that drain
after it writes the terminal ownership artifact.

Review also found that the describe text labelled every
`orchestrator-stream-error` artifact as an upstream LLM stream abort. That is
wrong for `OrchestratorNoDecisionStopError`: the stream completed, but the
orchestrator made no workflow decision. The prompt text must distinguish this
case so the next wake continues workflow decision-making instead of treating it
as provider infrastructure failure.

## Adversarial Review Feedback

The first implementation used `Date.now()` as the lower bound for scanning tool
calls made during the wake. That leaves a same-millisecond ambiguity: an action
tool from the previous wake could be counted as part of the current wake and
mask a new no-decision `finish=stop`.

The scan boundary is now the latest persisted message ID in the orchestrator
session before `SessionPrompt.prompt` / `SessionPrompt.loop` starts. After the
prompt returns, the scanner walks `Message.stream(sessionID)` newest-first and
stops exactly at that boundary message. This keeps the decision contract tied to
conversation structure instead of wall-clock timing.

Independent adversarial review found four additional contract holes:

- non-`stop` finishes such as `length` and `content-filter` also enter standby
  in `session/loop.ts`, so they must not be treated as successful decisions;
- a turn with only `step-start` / `reasoning` parts has no provider-visible
  decision content even though raw part count is non-zero;
- `wait`, `browser_preview`, and orchestrator `bash` are observation/pause tools
  in this contract; stopping after only those tools is still no decision;
- stale wakes for tasks that were already terminal before the prompt must no-op
  before tool creation, while post-wake terminal checks still allow this wake's
  own terminal tool to finish the task.

The implementation now uses provider-visible part count (`text` / `tool`) for
empty-turn detection, rejects every non-`tool-calls` finish except a clean
`stop` that follows a real decision effect, and keeps the observation/pause
tool set in `orchestrator/stateful-tool-names.ts` as a single registry.

To avoid treating a precondition failure from a decision-capable tool as real
progress, orchestrator tools stamp `metadata.orchestratorDecisionEffect` on
completed tool parts. The stamp is derived from a before/after engine signature
for task, run/artifact, goal, plan, requirement, spec, milestone, and
interaction rows. Observation/pause tools always stamp `observation`; tools
that do not change those decision surfaces stamp `none`; only `decision` lets a
clean `finish=stop` pass the no-decision contract.

The regression tests are explicitly listed in `packages/opencorvus/package.json`
so the default `opencorvus` test target runs them. A wholesale
`test/orchestrator` inclusion currently exposes an unrelated existing
`architect-fidelity-gate.test.ts` assertion failure; that remains a separate
root-cause investigation rather than being mixed into this no-decision fix.

## Acceptance

- Plain `finish=stop` after only `read_context` is converted into a typed
  orchestrator failure.
- Malformed provider tool-call sentinel text is converted into a typed
  orchestrator failure.
- Empty assistant shell with no finish and no parts is converted into a typed
  orchestrator failure.
- Assistant shell with only non-provider-visible parts is converted into a
  typed orchestrator failure.
- `finish=length`, `finish=content-filter`, `finish=error`, and other non-stop
  standby finishes are converted into typed orchestrator failures unless the
  task is already terminal.
- A previous wake's action tool does not excuse a later wake that stops without
  calling a tool.
- A current wake that only calls `read_context`, `query_failed_goals`, `wait`,
  `browser_preview`, or orchestrator `bash` is converted into a typed
  orchestrator failure.
- A wake whose tool calls stamped a real `orchestratorDecisionEffect=decision`
  is not rejected solely because the final assistant message contains prose.
- A wake that called a decision-capable tool but produced
  `orchestratorDecisionEffect=none` is converted into a typed orchestrator
  failure instead of being accepted by tool name alone.
- A single no-decision failure records a visible `orchestrator-stream-error`
  artifact and schedules another orchestrator wake; it does not block the
  active run and does not stamp `task.error`.
- If that wake is queued behind live orchestrator tool ownership, completion of
  the ownership drains the queued event and starts the next pass; it must not
  wait for unrelated liveness or operator activity.
- The describe prompt distinguishes no-decision contract failures from upstream
  LLM stream failures.
- Consecutive no-decision failures are bounded by the existing stream-error
  fuse; when the fuse trips, the task is marked failed instead of looping
  forever.
- Completed/failed/cancelled tasks are not rejected after a terminal tool
  updates task lifecycle.
- No `engine.liveness` behavior is changed by this fix.
