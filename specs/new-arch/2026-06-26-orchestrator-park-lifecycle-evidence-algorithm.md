# Orchestrator Park And Lifecycle Evidence Algorithm

Date: 2026-06-26

## Goal

Repair the scheduler algorithm exposed by live worker runs that keep running
without terminal refill. This is not a Data grid specific repair. The
orchestrator must distinguish a legitimate parked wake from a no-decision
contract failure, and it must not use elapsed time, workload sizing, or missing
terminal refill as proof that a child worker is stale.

## Recall

- `2026-06-25-orchestrator-under-one-hour-cancel-boundary.md`: short elapsed
  time without terminal output is not stale evidence.
- `2026-06-25-terminal-refill-no-decision-contract-repair.md`: terminal refill
  facts are durable `goal_refill_notification` artifacts written before an
  accepted root wake starts.
- `2026-06-24-a2a-agent-lifecycle-coordination.md`: lifecycle intervention
  requires target-scoped evidence or request-bound worker coordination.
- `2026-06-24-scheduler-compact-read-context.md`: normal scheduler decisions
  use the rendered task snapshot; `read_context` stays an audit drilldown.

## Independent Agent Consensus

Four read-only agents reviewed separate slices: scheduler prompt and tools,
worker lifecycle and cancellation, terminal refill and no-decision handling,
and workload analysis. They agreed on these algorithm boundaries:

1. A wake with only live non-orphan child work and no dispatchable, failed, or
   coordination work may park without calling a tool.
2. `cancel_subagent` and stale recovery must be traceable to explicit operator
   intent, pending worker coordination, owner death, invalid runtime contract,
   or another concrete impossible-to-continue fact.
3. `goal_refill_notification` is the single terminal refill fact source.
4. Timeout and inactivity must be based on last real stream/activity heartbeat,
   not process start time or wall-clock age.
5. `workload_analysis` is advisory goal sizing evidence. Oversized or stale
   workload briefs never cancel, redispatch, or fail live workers.

## Callpoint Inventory

| Surface | Current issue | Repair |
| --- | --- | --- |
| `orchestrator/agent.ts::classifyOrchestratorDecisionStop` | Treats every no-tool stop on an active task as `OrchestratorNoDecisionStopError`, including the prompt-directed "park this wake" case. | Accept an explicit `schedulerParkAllowed` fact derived from the same `describeTask` snapshot rendered to the model. |
| `orchestrator/agent.ts::buildSystemParts` | Renders `describeTask` but does not expose that same snapshot to the classifier. | Return the rendered prompt parts plus the task snapshot, keeping one state source. |
| `prompt/core/orchestrator-core.txt` | Already tells the model to park on healthy live builds, but the classifier contradicts it. | Pin wording that legal park is a scheduler decision when only live non-orphan workers remain. |
| `orchestrator/tools.ts::cancel_subagent` | `recover_stale` refuses streaming/retry sessions but otherwise relies on model-provided stale reasoning. | Add tests first; follow-up implementation should bind recovery to concrete lifecycle evidence instead of elapsed time or workload size. |
| `engine/task-agent-lifecycle.ts` | Existing collection is the right cancellation fact source. | Keep cancellation convergence on this report; do not add parallel session/goal scans. |
| `goal-workload-analyst` and workload artifact consumers | Workload concern can be misread as scheduling pressure. | Tests assert workload concern/stale does not mutate goal dispatch or cancel live goal runs. |

## Algorithm

Derive `schedulerParkAllowed` from `TaskDesc`:

- task is active;
- at least one blocking goal has a live, non-orphan tip attempt;
- no goal is `needs_redispatch`;
- no goal is terminal failed or aborted;
- no never-dispatched goal is currently dependency-dispatchable;
- no pending worker coordination request is waiting for a scheduler response;
- active run is not orphaned.

When those facts hold, a no-tool `finish=stop` with visible assistant text is a
legitimate parked scheduler wake. It records the normal orchestrator trace and
waits for a future terminal refill, operator, or worker-coordination wake. It
does not write an `orchestrator-decision-contract-failure` artifact and does
not call `wait`, `read_context`, `cancel_subagent`, or `recover_stale`.

This is not a host gate. It does not decide which goal to run, does not cancel
workers, and does not complete or fail the task. It only reconciles the
classifier with the model-visible scheduling facts already rendered in the
prompt.

## Acceptance

- Classifier allows a visible no-tool stop only when `schedulerParkAllowed`
  is true.
- Empty assistant shells still fail the no-decision contract.
- A process wake with a live non-orphan goal and no next action does not record
  `orchestrator-decision-contract-failure` and does not self-wake.
- Existing no-decision failures still record decision-contract artifacts and
  stay out of the stream-error fuse.
- Workload analysis stale/oversized evidence remains advisory and cannot be
  used as a cancellation or redispatch source.
