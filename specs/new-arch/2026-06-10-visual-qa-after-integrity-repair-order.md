# Visual QA After Integrity Repair Order (2026-06-10)

## Problem

Visual QA was advertised and wired as a required post-build stage before integrity for every frontend delivery. That made the visual-qa agent act before the system-level integrity reviewer had identified whether the real defect was structural, functional, or visual polish. In frontend clone tasks this over-focuses the agent on style micro-adjustments while broader component failures remain unresolved, such as replacing a fake chart with a real chart implementation.

GUI means Graphical User Interface: visible screens, controls, layout, typography, color, spacing, responsive framing, and observable interaction states.

## Call Point Inventory

| Surface | Grep evidence | Change |
| --- | --- | --- |
| Workflow template | `packages/opencorvus/src/engine/workflow.ts` contains `visual_qa` before `integrity`, and integrity depends on `visual_qa`. | Move `visual_qa` after integrity as an optional post-integrity frontend repair stage; integrity remains the final gate after any visual-qa repair. |
| Workflow projection | `taskStepStatusByTool` handles `integrity` but has no `visual_qa` case. | Project `visual_qa` completed from the real decision log report/summary, not a new state source. |
| Orchestrator prompt | `packages/opencorvus/src/prompt/core/orchestrator-core.txt` says frontend work must call `visual_qa` before `integrity`. | Replace with integrity-first discipline: run integrity after build, use visual_qa for integrity-identified frontend/GUI repair, then rerun integrity. |
| Orchestrator tool description | `packages/opencorvus/src/orchestrator/tools.ts` says visual_qa is used before integrity. | Describe it as a post-integrity repair/evidence agent and include coarse-to-fine repair priority. |
| Visual QA startup context | `packages/opencorvus/src/orchestrator/tools.ts` passes frontend design, frontend research, build evidence, and prior visual QA only. | Pass latest post-build integrity attempt into visual QA context so it repairs the reviewer-backed problem, not isolated style guesses. |
| Visual QA prompt | `packages/opencorvus/src/prompt/core/visual-qa-core.txt` and `packages/opencorvus/src/visual-qa/agent.ts` emphasize visual fidelity and prior visual report reproduction. | Add repair ordering: component truth/functionality first, then layout/composition, then micro-style polish. |
| Tests | Existing prompt/tool/workflow tests cover visual_qa wording and workflow steps. | Update tests to assert integrity-before-visual_qa ordering, post-integrity wording, context inclusion, and coarse-to-fine repair priority. |

## Acceptance

- Orchestrator instructions no longer require visual_qa before integrity for every frontend task.
- Visual QA is invoked after a non-pass integrity review when the review points to frontend/GUI/component/visual or functional defects.
- Visual QA receives bounded integrity findings/repair context and prioritizes structural component correctness before style micro-tuning.
- After visual_qa repairs files, orchestrator instructions require another integrity review for final acceptance.
