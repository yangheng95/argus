# Visual QA Unrepairable Blockers Trigger Follow-up Task (2026-06-15)

## Problem

Visual QA can identify a production blocker that it cannot safely repair in the
current worktree, but the existing report contract only says to submit
`accepted=false`. That leaves the orchestrator with a failed review artifact but
no first-class request for the next inheriting task. The result can be a passive
end state even though the correct product path is another task round.

Visual QA must remain a peer review agent with integrity, not a host-side gate
or replacement for integrity. The fix belongs in prompt/report semantics and in
the orchestrator's evidence consumption guidance. The host should not create a
new task automatically behind the model.

## Requirement

- Visual QA must be strict and product-grade: it must not pass visible draft
  quality, fake component families, missing regions, clipped or unreadable UI,
  broken interaction states, low-fidelity charts/maps/tables, or reference
  structure drift when those issues affect the scoped product surface.
- If Visual QA cannot safely fix a production blocker inside the current
  task/worktree, it must submit `accepted=false` and include a concrete
  follow-up task request.
- A follow-up task request must include a title, complete request, reason,
  priority, and the blocker IDs it addresses.
- A follow-up task request is evidence for the orchestrator to call
  `propose_task`; it must not be represented as generic prose or hidden host
  automation.
- `accepted=true` must remain incompatible with production blockers, open
  critical/major findings, or any follow-up task request.
- A failed report may omit a follow-up task request only when the remaining
  blockers are repairable by the current task owner in the same task.

## Call Point Inventory

| Surface                                                                    | Current behavior                                                                                                | Change                                                                                                                         |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `packages/opencorvus/src/visual-qa/schema.ts`                              | Report has `production_blockers[]` but no structured new-round request.                                         | Add a nullable follow-up task request object with blocker ID references.                                                       |
| `packages/opencorvus/src/visual-qa/output-tools.ts`                        | Rejects passing blocker-bearing reports and renders blockers.                                                   | Reject accepted reports that include follow-up requests; validate follow-up blocker IDs; render follow-up request prominently. |
| `packages/opencorvus/src/visual-qa/agent.ts`                               | Delegation says failed reports list blockers, but not that unrepairable blockers need a follow-up task request. | Require follow-up task request when blockers cannot be safely repaired by Visual QA in the current worktree.                   |
| `packages/opencorvus/src/prompt/core/visual-qa-core.txt`                   | Terminal reporting allows failed terminal result without next-task structure.                                   | Require strict product-grade judgment and structured follow-up request for unrepairable production blockers.                   |
| `packages/opencorvus/src/orchestrator/tools.ts` visual_qa result           | Returns accepted/blocker counts only.                                                                           | Surface follow-up task request in decision-log summary and tool result fields.                                                 |
| `packages/opencorvus/src/orchestrator/tools.ts` `propose_task` description | Mentions inheriting follow-up work generally.                                                                   | Name failed Visual QA follow-up requests as a direct evidence source for `propose_task`.                                       |
| `packages/opencorvus/src/prompt/core/orchestrator-core.txt`                | Routes failed Visual QA to repair before completion.                                                            | Say an unrepairable Visual QA follow-up request should be turned into `propose_task` instead of ending passively.              |
| Tests                                                                      | Cover blocker acceptance but not follow-up task requests.                                                       | Add schema/output rendering and prompt guidance regressions.                                                                   |

## Acceptance

- Visual QA prompts require picky product-grade review without embedding
  screenshot-specific examples.
- `VisualQaReportSchema` accepts a structured follow-up task request tied to
  production blocker IDs.
- `accepted=true` plus a follow-up task request is rejected.
- A follow-up task request referencing unknown blocker IDs is rejected.
- Failed Visual QA reports render follow-up request details in terminal output.
- Orchestrator tool guidance names failed Visual QA follow-up requests as
  evidence for `propose_task`.
- Targeted tests and typecheck pass before commit.
