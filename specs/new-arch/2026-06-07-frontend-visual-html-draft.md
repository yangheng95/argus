# Frontend Visual HTML Skeleton Handoff

## Problem

Webpage replica tasks currently ask frontend_design to move directly from captured source evidence into a maintainable target project. For dense pages this couples two hard problems: visual parity and semantic project extraction. The result can preserve PRD function while drifting from the reference visual system.

## Decision

Do not add a new agent or a second visual source. Change the two frontend agents' mission for webpage replica work so the frontend stage first produces a source-derived, fully visual-restored HTML skeleton. This HTML skeleton is the visual baseline artifact for later workflow stages; it replaces the previous expectation that frontend_design should directly deliver a project source skeleton or a maintainable React/Vue target project.

The skeleton is allowed only as `frontend_project.role=visual_baseline_input`. It is not an implementation target, not a maintainable project, and not an independent design system. Downstream full-project workflow must transcribe from the visual skeleton plus the original source IR and PRD/content evidence, then prove parity with the skeleton and `reference.png`.

## Call Points

| File | Decision |
| --- | --- |
| `packages/opencorvus/src/prompt/core/frontend-design-core.txt` | Make the visual HTML skeleton the default webpage replica frontend-design output and move maintainable project source completion downstream. |
| `packages/opencorvus/src/frontend-design/agent.ts` | Make dynamic task guidance prefer a source-derived static HTML/CSS skeleton over target app population during frontend_design. |
| `packages/opencorvus/src/frontend-design/output-tools.ts` | Reuse existing `frontend_project.role=visual_baseline_input`; render explicit report guidance for static HTML skeletons. |
| `packages/opencorvus/src/prompt/core/frontend-research-core.txt` | Keep research read-only/advisory; add work-packet coverage for visual HTML skeletons. |
| `packages/opencorvus/src/research/output-tools.ts` / `schema.ts` | No change. Existing webpage contract and bundle sections already express coverage/risk packets. |

## Source Authority

- Functional and content facts: PRD, `source-ir/content-model.json`, frontend_research work packets.
- Visual skeleton facts: derived from source skeleton, style profile/tokens, layout map, assets, interaction hints, and `reference.png`.
- Final project facts: semantic project source plus measured visual comparison against both visual skeleton and original reference.

The HTML skeleton must not become a parallel design truth. If the skeleton conflicts with source IR or visible pixels, the source IR and `reference.png` win.

## Report Contract

For webpage replica work, frontend_design must report:

- `frontend_project.role=visual_baseline_input`.
- `frontend_project.project_root` pointing at the visual skeleton directory, such as `visual-html-skeleton`.
- `frontend_project.entrypoints` naming `index.html`, CSS, assets, screenshots, and diff artifacts when available.
- `quality_project_contract` explaining how the future maintainable project must transcribe the skeleton.
- `visual_consistency_contract` naming viewport matrix, region coverage, screenshot diff, and reference artifacts.
- `reference_artifacts` including `web-clone-source/reference.png`, source IR, style profile/tokens, source skeleton CSS, and visual skeleton paths.

## Acceptance

- Frontend-design report renders a distinct visual-baseline note for `role=visual_baseline_input`.
- Frontend-design prompt names the visual HTML skeleton as the default webpage replica handoff and does not claim maintainable project completion.
- Frontend-research prompt asks for visual HTML skeleton coverage packets while keeping research read-only and non-implementation.
- No changes to Requirements, Architect, Build, Integrity, or orchestrator routing.

## Independent Review Feedback

Two independent agent reviews agreed on the minimum path:

- Do not add a new schema field. Reuse `frontend_project.role=visual_baseline_input`, because the role already exists and adding `visual_html_draft` would create a parallel meaning source.
- The report must explicitly say the skeleton is not an implementation target and not the acceptance app root; otherwise downstream Build can misread `project_root=visual-html-skeleton` plus `index.html` as a runnable app handoff.
- The skeleton must remain lower authority than `web-clone-source/source-ir/*`, `web-clone-source/source-skeleton/*`, assets, and `reference.png`.
- Frontend-research may only publish visual skeleton coverage packets and fidelity risks. It must not create HTML, source skeletons, implementation templates, acceptance specs, or token catalogs.
- Maintainable/rawproject/full-project/component-reuse/full-stack requests still require later workflow completion; frontend_design records the transcription contract instead of claiming project source completion.
