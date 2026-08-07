# Frontend Design Mobile Reference Image

Date: 2026-06-14

## Problem

`frontend_design` already asks agents to inspect the `mobile-review 390x844` viewport, but source URL evidence only materializes the desktop `reference.png`. The viewport matrix therefore tells agents to record an evidence gap for mobile even when the same URL capture pipeline can produce a mobile reference screenshot before the agent turn.

## Call-Site Inventory

| Surface                                                                                         | Current behavior                                                                                                              | Required change                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/opencorvus/src/frontend-design/tools/webpage-extract.ts`                              | Captures one primary reference screenshot as `reference.png`.                                                                 | Capture an additional mobile viewport screenshot as `reference-mobile.png` during URL extraction.                                                                                    |
| `packages/opencorvus/src/orchestrator/webpage-evidence.ts`                                      | Primary evidence and source-package completeness require only `reference.png`.                                                | Require and advertise `reference-mobile.png` in the task-scoped evidence and visible source package artifacts.                                                                       |
| `packages/opencorvus/src/web-clone/context.ts`                                                  | Copies only `reference.png` into `web-clone-source` and manifests only desktop reference provenance.                          | Copy `reference-mobile.png`, include it in manifest entries, and expose mobile reference provenance.                                                                                 |
| `packages/opencorvus/src/web-clone/evidence-integrity.ts`                                       | Required webpage evidence list and manifest integrity know only `reference.png`.                                              | Treat `reference-mobile.png` as a required webpage evidence artifact and validate source manifest entries for it.                                                                    |
| `packages/opencorvus/src/web-clone/source-project-generator.ts`                                 | `mobile-review` says measured comparison is available only when matching reference evidence exists.                           | Point `mobile-review` at `web-clone-source/reference-mobile.png` as the matching evidence.                                                                                           |
| `packages/opencorvus/src/frontend-design/host-prepared-source-project.ts`                       | Compact evidence index names only `web-clone-source/reference.png`.                                                           | Index `web-clone-source/reference-mobile.png` for mobile visual parity checks.                                                                                                       |
| `packages/opencorvus/src/agent/role-contract.ts`                                                | Frontend design/research role descriptions do not explicitly say the agents are single-shot handoff producers.                | State that `frontend-design` and `frontend-research` are one-time evidence/handoff agents for a task scope, not repeated execution or repair tools.                                  |
| `packages/opencorvus/src/prompt/core/orchestrator-core.txt` and orchestrator tool descriptions  | Chain guidance says the agents are evidence producers but does not clearly block repeated execution as an iteration strategy. | Clarify that orchestrator should dispatch them at most once per relevant task scope, then route later fixes through requirements/architect/build/visual_qa/integrity as appropriate. |
| `packages/opencorvus/src/prompt/core/frontend-design-core.txt` and `frontend-research-core.txt` | Agent-local prompts describe bounded evidence workflow but not one-shot role semantics.                                       | Add role-boundary language that their session emits one durable handoff/brief and is not used as a loop for repeated repair or reacquisition.                                        |
| Tests                                                                                           | Existing fixtures write only desktop reference screenshots.                                                                   | Add focused assertions that extraction/pipeline/source package outputs include the mobile reference.                                                                                 |

## Design

- Keep `reference.png` as the desktop primary visual truth for structure extraction and source IR.
- Add `reference-mobile.png` as the mobile visual reference produced by the same `webpage_extract` acquisition call.
- Do not add alternate lookup paths, copying into acceptance roots, or prompt-only instructions.
- `web-clone-source/reference-mobile.png` is the downstream implementation reference for `mobile-review 390x844`.
- Frontend design/research dispatch remains prompt-governed, not host-gated: their descriptions must make them single-shot task-scope evidence producers. Repeated fidelity repair belongs to downstream build/visual QA/integrity loops that consume the persisted handoff, not to rerunning frontend_design/frontend_research.

## Verification

- `bun test packages/opencorvus/test/orchestrator/webpage-evidence.test.ts`
- `bun test packages/opencorvus/test/tool/web-clone-prepare-context.test.ts`
- `bun test packages/opencorvus/test/frontend-design/prompt.test.ts`
- Focused typecheck if the targeted tests pass.
