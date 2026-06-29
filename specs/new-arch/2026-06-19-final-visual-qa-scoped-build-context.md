# Final Visual QA And Scoped Build Context (2026-06-19)

## Problem

The current frontend review workflow still has three wrong incentives:

- `visual_qa` is described as a post-goal-batch review and can run before later
  build waves. That makes it a mid-task repair loop instead of one final product
  review.
- Webpage acceptance helpers such as `webpage_evaluate` and
  `webpage_vision_judge` remain exposed as score/verdict-oriented visual gates.
  Their scores or judge verdicts are not reliable acceptance signals.
- Build sessions receive task-wide requirements and visual context when they
  should receive only the context relevant to the target goal.

This plan intentionally does not change `region comparison tool`.
That runner is treated as a separate repair item. This goal prevents the other
workflow paths from continuing to use the legacy `webpage_*` visual tools as
acceptance evidence.

## Hard Decisions

1. `visual_qa` runs at most once near task completion: after all blocking build
   work is terminal and before final task acceptance. It is not a per-wave or
   per-goal-batch review tool.
2. `visual_qa` acceptance is blocker-based. The report has `accepted`, fresh
   evidence, coverage, findings, and `production_blockers`; it has no score
   target and must not describe numeric thresholds as the stop condition.
3. Reference or clone fidelity is not the global `visual_qa` bar. It is enforced
   only when the current task or current goal acceptance explicitly requires
   reference parity.
4. `webpage_render`, `webpage_evaluate`, `webpage_text_diff`,
   `webpage_vision_judge`, and the old webpage visual-gate chain are retired
   from frontend_design and visual_qa agent tool exposure.
5. New engine child/follow-up tasks are created only from terminal task handoff
   evidence and only once per parent task. Mid-task expansion must stay inside
   the current task through goals, architect, build, question, or fail_task.
6. Build context is scoped to the requested goal. Requirements are selected by
   `goal.requirement_ids`; graph/fidelity context is filtered to the goal; build
   session contract snapshots store the same scoped context. No full requirement
   fallback is allowed.

## Call Point Inventory

| Surface                                                                                    | Current behavior                                                                                                                          | Required change                                                                                                                               |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/prompt/core/orchestrator-core.txt`                                                    | Says run `visual_qa` once after each terminal frontend goal batch before the next build wave.                                             | Replace with final task frontend review wording and terminal-only follow-up task wording.                                                     |
| `src/orchestrator/tools.ts` visual_qa description and next-step hint                       | Describes post-goal-batch review and webpage render/evaluate/text_diff/vision_judge tools.                                                | Describe final task visual review; remove retired webpage gate chain; tell orchestrator not to call mid-task visual QA.                       |
| `src/engine/workflow.ts`                                                                   | Step hint says terminal frontend goal batch after build.                                                                                  | Keep build -> visual_qa projection, but describe visual_qa as final frontend product review before integrity.                                 |
| `src/prompt/core/visual-qa-core.txt`                                                       | Allows webpage evaluate/judge as supporting context and treats strict clone fidelity as universal.                                        | Make blocker-based production review primary; remove score/judge toolchain; scope reference fidelity to explicit requirements.                |
| `src/visual-qa/agent.ts`                                                                   | Registers webpage_render/evaluate/text_diff/vision_judge and repeats strict reference rules.                                              | Register only non-retired visual evidence tools; remove score/judge language; keep accepted report constraints.                               |
| `src/visual-qa/schema.ts`                                                                  | Evidence type includes `vision_judge`.                                                                                                    | Remove `vision_judge` as a first-class Visual QA evidence type.                                                                               |
| `src/frontend-design/static-tools.ts` and `src/frontend-design/tools/ids.ts`               | Exposes `webpage_render`, `webpage_evaluate`, `webpage_text_diff`, and `webpage_vision_judge` as acceptance/implementation tools.         | Retire them from agent-visible tool sets; no `webpage_*` visual acceptance tool remains.                                                      |
| `src/frontend-design/agent.ts`, `frontend-design-core.txt`, source project/handoff helpers | Prompts require evaluate/judge evidence and measured webpage score.                                                                       | Replace with inspected render/screenshot and task-scoped evidence language.                                                                   |
| `src/frontend-design/tools/webpage-render.ts`                                              | Legacy screenshot tool can be used as a parallel visual evidence path.                                                                    | Remove it from runtime tool exposure; task-scoped `browser_preview` evidence owns screenshot capture.                                         |
| `src/acceptance/visual-metric.ts`                                                          | Implements visual hard gates and score summaries.                                                                                         | Stop presenting it as a visual acceptance gate in the affected workflow. Existing low-level metric code is not a Visual QA completion signal. |
| `src/orchestrator/tools.ts` propose_task                                                   | Allows active parent follow-up creation.                                                                                                  | Reject or refuse creation unless the parent task is terminal and has no existing child task.                                                  |
| `src/tool/panel.ts` / `mission-core.txt`                                                   | Mission creates tasks one per wake but does not hard-state terminal-only parent handoff semantics.                                        | Update prompt/tool contract wording for child task creation; direct user-created panel tasks remain out of this restriction.                  |
| `src/orchestrator/tools.ts` build context                                                  | Loads all active requirements into each build context and stores full snapshots.                                                          | Filter requirements by target goal `requirement_ids`; store scoped snapshot.                                                                  |
| `src/build/agent.ts`                                                                       | Renders all supplied requirements; fidelity may remain task-wide if caller passes it.                                                     | Consume scoped context only; tests assert sibling requirements and fidelity are absent.                                                       |
| `src/architect/fidelity.ts`                                                                | Has `filterGoalFidelityState`.                                                                                                            | Reuse this helper instead of adding another source.                                                                                           |
| Tests                                                                                      | Pin post-goal-batch visual QA, webpage evaluate/judge exposure, active parent propose_task creation, and full requirement prompt context. | Reverse these tests and add negative assertions for retired score/judge paths and scoped goal context.                                        |

## Acceptance

- Prompt and tool descriptions no longer instruct agents to use any
  `webpage_*` visual tool as visual acceptance evidence.
- `visual_qa` is described as a final once-per-task frontend product review, not
  a per-terminal-goal-batch review.
- `visual_qa` reports are accepted only by blocker-free structured report
  semantics; no score threshold or judge verdict appears in the completion rule.
- `propose_task` cannot create an inheriting task while the parent task is still
  active, and cannot create a second inheriting task for the same parent.
- Build prompt tests prove a target goal receives only its mapped requirements,
  filtered contract/fidelity context, and no sibling requirement text.
- Existing `region comparison tool` implementation is untouched by this
  goal.
