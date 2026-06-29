# Orchestrator Live Build Park Prompt Repair

Date: 2026-06-22

## Problem

When `build({ goalID })` starts an async child build, the orchestrator can see
no immediately dispatchable sibling work and only a live child goal_run. The
correct behavior is to end the current wake after the build decision and let
terminal goal refill evidence wake the next scheduling decision.

The prompt and tool text currently use "waiting" language around live build
sessions. That makes the model confuse live-child parking with the `wait` tool.
`wait` is a one-shot pause for a named external event; it does not own scheduler
progress and must not be used to poll internal live build completion.

## Recalled Evidence

- `specs/records/2026-06/orchestrator-no-decision-stop-2026-06-18.md`: no-decision stops stay
  rejected for active tasks.
- `specs/records/2026-06/2026-06-19-g1-g2-orchestrator-runtime-single-source-repair.md`:
  `build({ goalID })` is async; terminal goal refill is the next evidence source.
- `specs/records/2026-06/2026-06-19-goal-fifo-refill-scheduling-impact.md`: refill
  wakes are driven by terminal goal_run facts, not by manual polling.
- `specs/records/2026-06/2026-06-21-orchestrator-tool-only-trace-summary.md`: same-wake
  observation after a decision cannot be treated as a new task decision.
- `specs/records/2026-06/2026-06-21-world-economy-stuck-adversarial-goal-review.md`:
  do not mask orchestration stalls with status-only text.

## Callpoints

| File                                                                           | Evidence                                                                                                                       | Action                                                             |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `packages/opencorvus/src/prompt/core/orchestrator-core.txt`                    | `steer_subagent` says decide between waiting and stale recovery; `wait` does not explicitly exclude live builds                | Replace with live-build park wording and explicit `wait` exclusion |
| `packages/opencorvus/src/orchestrator/tools.ts`                                | duplicate live goal error says wait for terminal refill; build snapshot says keep waiting; cancel refusal says wait for settle | Replace with "park this wake / terminal refill" language           |
| `packages/opencorvus/test/orchestrator/no-decision-stop.test.ts`               | covers `build -> read_context -> stop`, not `build -> wait -> stop` by name                                                    | Add explicit regression                                            |
| `packages/opencorvus/test/orchestrator/wait-tool.test.ts`                      | expects raw string while wrapper returns normalized object plus decision metadata                                              | Assert normalized output and observation metadata                  |
| `packages/opencorvus/test/agent/core-prompt-hygiene.test.ts`                   | no hygiene assertion for live-build `wait` exclusion                                                                           | Add prompt hygiene assertions                                      |
| `packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts` | build async description is pinned, wait live-build exclusion is not                                                            | Pin tool descriptions                                              |

## Decision

Do not add a host-side scheduler gate, fallback, or generic no-tool stop. Keep
the existing no-decision classifier strict. Repair the agent-facing contract:

1. A live build is internal engine state, not an external event.
2. If no dispatchable/failed/refill fact exists and only live child builds
   remain, stop this wake after the latest real decision.
3. Terminal goal refill facts wake the next scheduling decision.
4. `wait` remains only for named external events and is never a live build,
   live sibling goal, or terminal refill polling primitive.

## Acceptance

- Prompt contains explicit live-build park wording and does not describe
  healthy live build progress as "waiting".
- Tool descriptions and result text exclude `wait` for live build completion.
- `build -> wait -> stop` is rejected by the no-decision classifier.
- `wait` tool execution returns normalized output with
  `orchestratorDecisionEffect=observation`.
- Targeted tests pass.
