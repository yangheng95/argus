# Visual QA Production Blockers Semantics (2026-06-15)

## Problem

Visual QA can identify visual/reference failure, but the workflow can still
project the stage as complete when a report exists. That made failed visual QA
look like finished QA. Numeric similarity scores are useful evidence, but a
fixed score threshold is not the acceptance rule the product needs.

The desired behavior is a professional design review: Visual QA states whether
the rendered product is fit for production delivery and lists the concrete
items that block delivery.

Integrity and Visual QA are virtual acceptance gates, not host hard gates.
Integrity owns system completeness acceptance; Visual QA owns focused visual and
design acceptance. Their reports and projected statuses express acceptance
semantics for the orchestrator to act on. They must not become host-side route
bypasses or workflow state-machine guards.

## Refined Requirement

- Visual QA must review from the perspective of a professional product designer
  and design QA reviewer.
- Product design review principles must be durable code assets, not prompt-only
  prose. Visual QA blockers cite these principle IDs so reports, tests, and
  future prompts share one vocabulary.
- Visual QA must name production blockers: visible defects, missing regions,
  wrong component family, fake or low-fidelity charts/maps/tables, broken
  interaction states, reference-structure drift, unreadable text, severe layout
  density problems, or misleading affordances that make the product unfit to
  generate or ship.
- Visual QA may cite numeric visual scores as evidence, but it must not use a
  fixed similarity score as the only pass/fail rule.
- A report with production blockers is not accepted.
- Workflow projection must distinguish accepted Visual QA from failed Visual QA
  as virtual-gate status. The existence of a report means the stage ran, not
  that the visual acceptance passed.

## Call Point Inventory

| Surface | Current behavior | Change |
| --- | --- | --- |
| `src/visual-qa/product-design-principles.ts` | No reusable product-design principle inventory for Visual QA reports. | Add stable principle IDs for component truth, reference structure, visual hierarchy/readability, interaction states, and production completeness. |
| `visual-qa-core.txt` | Focuses on GUI fidelity and strict reference mode, but does not require product-design blocker inventory. | Add professional design review language and production-blocker reporting rules; remove reliance on fixed score thresholds as verdict. |
| `src/visual-qa/schema.ts` | Report has findings but no first-class blocker list. | Add `production_blockers[]` with concrete region/reason/evidence fields and required design principle IDs. |
| `src/visual-qa/output-tools.ts` | `accepted=true` rejects open critical/major findings only. | Reject `accepted=true` when production blockers exist; require failed reports to include blockers or open critical/major findings; render blockers in report detail. |
| `src/visual-qa/agent.ts` | Delegation prompt requires 1:1 visual evidence. | Ask for product-design blocker inventory and make `accepted=true` depend on absence of blockers, not a numeric threshold alone. |
| `src/engine/workflow.ts` | Any `visual_qa` report projects as `completed`. | Parse report/latest summary and project virtual-gate `failed` when accepted is false or production blockers are present. |
| Tests | Existing tests only cover accepted=true evidence and report presence. | Add regression coverage for production blockers and failed workflow projection. |

## Acceptance

- Visual QA prompts require a professional design-review lens and a
  production-blocker list.
- Product design principles exist as a reusable code asset and Visual QA
  production blockers cite their IDs.
- A report with `production_blockers[]` cannot set `accepted=true`.
- A failed report must provide actionable blockers or open critical/major
  findings.
- Workflow projection shows visual-qa virtual-gate status as `failed` for
  `accepted=false` or blocker-bearing reports, and `completed` only for accepted
  blocker-free reports.
- Legacy summaries or reports that lack the structured acceptance/blocker
  semantics must not project as completed.
