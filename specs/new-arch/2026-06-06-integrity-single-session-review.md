# Integrity Single Session Review (2026-06-06)

## Problem

The wake ownership fix stopped duplicate orchestrator `integrity` tool calls, but
task `tsk_e9c0a0e9b001idGk6yawac0bTN` still showed multiple integrity cards.
Read-only database evidence showed one orchestrator integrity tool part:

- `prt_e9c943880001bX5NT4dQUxXPc1`

The remaining fanout came from `integrity/team-agent.ts` itself:

- one supervisor integrity session;
- four reviewer integrity sessions;
- one consensus integrity session.

This is not a wake race. It is the integrity implementation spawning a team of
child agents with `Promise.all(plan.reviewers.map(...))`.

## Callsite Census

Full-repo grep before implementation:

| Surface                                      | Callsites                                      | Decision                                                                    |
| -------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------- |
| `reviewIntegrity()`                          | `orchestrator/tools.ts`, integrity tests       | Keep the public API; change its internal execution model.                   |
| `Promise.all(plan.reviewers.map(...))`       | `integrity/team-agent.ts` only                 | Remove reviewer child-session fanout from the live review path.             |
| `submit_integrity_review_plan`               | `integrity/team-agent.ts`, tests               | Stop requiring a separate plan session before review.                       |
| `submit_reviewer_report`                     | reviewer child sessions only                   | Stop using separate reviewer sessions in the live path.                     |
| `IntegrityTeamReportSchema.reviewers.min(2)` | team report schema and tests                   | Preserve multi-perspective report shape without spawning multiple sessions. |
| review stream IDs                            | `integrity/team-agent.ts`, review stream tests | Use one review stream ID for the single integrity session.                  |

## Design

- Run one streaming integrity session per orchestrator `integrity` tool call.
- The single session uses the existing consensus output schema,
  `IntegrityTeamReportSchema`, so the durable artifact still contains
  `reviewers[]`, `findings[]`, `coverageAudit[]`, and repairs.
- Evidence tools remain available in that same session.
- The prompt asks the model to perform multi-perspective review internally and
  include at least two reviewer reports in `reviewers[]`.
- No UI folding, duplicate-card suppression, prompt gate, or wake gate is added.

## Tests

- Update integrity team-agent tests to assert one live run session instead of
  supervisor + N reviewer + consensus sessions.
- Keep schema tests for multi-reviewer report shape.
