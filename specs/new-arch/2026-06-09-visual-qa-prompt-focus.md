# Visual QA Prompt Focus Plan (2026-06-09)

## Problem

The main failure is not the static system prompt by itself. The `visual_qa` dispatch path was composing a noisy first user prompt by inlining broad upstream material: full frontend-design decision-log entries, a full frontend-research brief JSON, every build delivery summary, and raw prior Visual QA entries. That dilutes the stage's real job: visual GUI fidelity and functional testing of the rendered product from task-scoped evidence.

The static prompt and adjacent descriptions should still use the same focused terminology so the dispatch prompt and role contract do not drift apart.

GUI means Graphical User Interface: the visible application screen, controls, layout, typography, color, spacing, responsive framing, and observable interaction states.

## Call Point Inventory

| Surface                              | Grep evidence                                                                                                                                                                                                                                          | Change                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Core prompt                          | `packages/opencorvus/src/prompt/core/visual-qa-core.txt`                                                                                                                                                                                               | Replace broad full-function UI/UX role with focused visual GUI fidelity and functional smoke/regression testing. |
| Runtime delegation prompt            | `packages/opencorvus/src/visual-qa/agent.ts`                                                                                                                                                                                                           | Narrow delegation wording to GUI fidelity and functional testing.                                                |
| Visual QA context renderer           | `packages/opencorvus/src/visual-qa/context.ts`                                                                                                                                                                                                         | New single source for bounded Visual QA startup context.                                                         |
| Output terminal tool                 | `packages/opencorvus/src/visual-qa/output-tools.ts`                                                                                                                                                                                                    | Match report description to focused acceptance evidence.                                                         |
| Orchestrator tool schema/description | `packages/opencorvus/src/orchestrator/tools.ts`                                                                                                                                                                                                        | Advertise visual GUI fidelity and functional testing, not generic UI/UX.                                         |
| Workflow hint                        | `packages/opencorvus/src/engine/workflow.ts`                                                                                                                                                                                                           | Keep workflow label but narrow the hint.                                                                         |
| Agent role contract                  | `packages/opencorvus/src/agent/role-contract.ts`                                                                                                                                                                                                       | Describe focused QA role and repair boundary.                                                                    |
| Integrity summary                    | `packages/opencorvus/src/integrity/team-agent.ts`                                                                                                                                                                                                      | Tell reviewers to consume visual GUI and functional evidence.                                                    |
| Session kind comment                 | `packages/opencorvus/src/session/session.sql.ts`                                                                                                                                                                                                       | Keep acronym expansion and focused worker role.                                                                  |
| Tests                                | `packages/opencorvus/test/visual-qa/context.test.ts`, `packages/opencorvus/test/agent/core-prompt-hygiene.test.ts`, `packages/opencorvus/test/visual-qa/agent.test.ts`, `packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts` | Assert bounded context rendering, focused wording, and no broad UI/UX/build-equivalent prompt drift.             |

## Acceptance

- The initial prompt prioritizes screenshot-backed GUI fidelity, responsive layout, and real functional checks.
- Visual QA startup context does not inline full frontend-research JSON, frontend template bodies, delivery diffs, or unrelated research facts/open questions.
- The prompt still allows in-scope repairs, but does not present Visual QA as a general Build-equivalent worker.
- Tests fail if broad UX expansion or the old "same capability level as Build" language returns.

## Codex Review Addendum: Strict Reference Image Fidelity

User correction on 2026-06-09: when Visual QA receives a reference image, the agent must require one-to-one (1:1) layout and style reproduction. "1:1" means the rendered product must match the reference image's visible geometry and styling region by region; it is not a loose inspiration target. The previous focused prompt still allowed the model to treat reference images as ordinary evidence, which left room for "close enough" visual acceptance.

## Additional Call Point Inventory

| Surface                    | Grep evidence                                                                                                                                                          | Change                                                                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core prompt                | `packages/opencorvus/src/prompt/core/visual-qa-core.txt`                                                                                                               | Add strict reference-image fidelity mode: reference images are authoritative visual truth; layout, spacing, typography, color, and state styling must be copied one-to-one. |
| Runtime delegation prompt  | `packages/opencorvus/src/visual-qa/agent.ts`                                                                                                                           | Tell every Visual QA session that any reference image triggers the same strict one-to-one standard.                                                                         |
| Visual QA context renderer | `packages/opencorvus/src/visual-qa/context.ts`                                                                                                                         | Emit a bounded strict-reference section when frontend-design or frontend-research context names reference image evidence.                                                   |
| Tests                      | `packages/opencorvus/test/visual-qa/context.test.ts`, `packages/opencorvus/test/visual-qa/agent.test.ts`, `packages/opencorvus/test/agent/core-prompt-hygiene.test.ts` | Assert the prompt/context require strict one-to-one reference-image layout and style fidelity and reject relaxed wording.                                                   |

## Additional Acceptance

- A Visual QA agent that sees `reference_artifacts` or `reference_image_evidence_ids` must be told the reference image is the authoritative visual truth.
- Passing Visual QA with a reference image requires fresh rendered screenshots compared against that reference image for layout geometry, spacing, typography, colors, component styling, and visible interaction states.
- The prompt and context must not contain "close enough" or other relaxed reference-image acceptance language.
