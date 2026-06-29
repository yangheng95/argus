# Frontend Replica Desktop-Only Decision Surface

Date: 2026-06-26

## Problem

Frontend replica workflows still contain model-visible `tablet`, `mobile`, and
`responsive` language in expert-squad instructions, prompt profiles, and
requirements/architect/build/visual-review prompts. A TradingView Government
Bonds task demonstrated the failure mode: Architect turned generic responsive
template text into a `Responsive visual verification by region` goal, Build then
captured tablet/mobile full-page screenshots, and the mobile screenshot exceeded
the model image dimension limit.

## Recall

| Source                                                   | Constraint carried forward                                                                                                                                                  |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-22-web-clone-desktop-only-evidence.md`          | Webpage clone evidence is desktop-only by default; generic browser preview viewport capability stays available.                                                             |
| `2026-06-22-browser-preview-viewport-source.md`          | Browser preview viewport IDs are semantic tool capability and must come from task-scoped metadata; removing support for tablet/mobile would break explicit multi-end tasks. |
| `2026-06-25-visual-evidence-no-hard-gate-root-repair.md` | Visual evidence remains required agent work evidence, but host-side hard gates are not the repair mechanism.                                                                |
| Current DB evidence                                      | The bad Government Bonds `objective` first appeared in an Architect `register_goal` call, fed by generic responsive/mobile task-template and handoff text.                  |

## Decision

For frontend replica / clone / visual parity / source-page recreation tasks, the
default requested generation surface is desktop only.

Do not generate, register, dispatch, or execute tablet/mobile/non-desktop
requirements, goals, acceptance specs, Build objectives, Visual QA scopes,
browser preview viewport requests, screenshot obligations, source-debt rows, or
final acceptance blockers unless the current operator explicitly asks for
tablet/mobile/responsive/multi-end migration as a separate current task scope.

Generic wording inside batch templates, old specs, upstream research/design
summaries, handoff debt, historical goals, or general QA checklists is not
authorization. It must not be converted into REQ rows, Architect goals, Build
work, or Visual QA obligations.

## Call Point Inventory

| Surface                                           | Decision                                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend-replica-expert-squad.md`                | Add an explicit desktop-only scope section and remove default responsive completion language.                                               |
| `PromptProfile.frontend-replica`                  | Make requirements, architect, build, visual-qa, integrity, and orchestrator overlays carry the desktop-only default.                        |
| `requirements-core.txt`                           | Prevent template/handoff mobile language from becoming REQ rows or scope decisions.                                                         |
| `architect-core.txt`                              | Prevent non-desktop REQs from becoming goals/build work; classify them as over-scoped unless explicitly authorized.                         |
| `frontend-research-core.txt`                      | Publish desktop source-page packets by default; do not create responsive work packets for replica tasks.                                    |
| `frontend-design-core.txt`                        | Produce desktop visual contracts by default; non-desktop rules are out of scope unless explicitly requested.                                |
| `build-core.txt`                                  | Build must fail an unauthorized tablet/mobile goal as a scope defect instead of executing it.                                               |
| `visual-qa-core.txt` / `visual-qa/agent.ts`       | Visual QA requests desktop evidence for replica tasks by default and skips constrained/narrow viewport checks unless explicitly authorized. |
| `orchestrator-core.txt` / `orchestrator/tools.ts` | Tool descriptions must not invite desktop/mobile visual QA or responsive research as default replica scope.                                 |
| Browser preview viewport enum/tests               | Keep unchanged as generic tool capability for explicit multi-end migration tasks.                                                           |

## Acceptance

- The frontend replica expert squad explicitly forbids tablet/mobile REQ, goal,
  and Build generation by default.
- Model-visible prompt surfaces no longer describe frontend replica work as
  default responsive/mobile scope.
- Build and Visual QA prompts instruct agents to reject unauthorized
  tablet/mobile goals/scopes rather than executing them.
- Focused prompt and skill tests assert the desktop-only rule.
