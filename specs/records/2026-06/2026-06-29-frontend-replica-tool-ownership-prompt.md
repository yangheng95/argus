# Frontend Replica Tool Ownership Prompt

Date: 2026-06-29

## Recall

- User request: the frontend replica expert squad must tell owned agents to call
  the browser preview reference-region tools according to responsibility.
- Acceptance:
  - The frontend replica expert-squad prompt must name the ownership split.
  - Build owns producing changed-region proof with
    `browser_preview_reference_regions` when source/reference and local regions
    exist.
  - Visual QA owns independent final region proof with
    `browser_preview_reference_regions` and may use
    `browser_preview_compare_scroll_slices` only as supporting page-slice
    `visual_diff` evidence.
  - Orchestrator skill frontmatter remains mounted only to orchestrator and
    keeps `select_expert_squad` as its only `required_tools`; the preview tools
    are build/visual-qa tools, not orchestrator skill tools.
- Hard constraints recalled:
  - No fallback, no host-side gate, no new workflow branch.
  - Expert squads are prompt profiles compiled from the single
    `PromptProfile.builtIns` registry plus mounted expert-squad skills.
  - Specs live under root `specs/`; this record contains the implementation
    Recall before edits.
  - `SSIM` means Structural Similarity Index Measure.
- Read from disk before edits:
  - `specs/records/2026-06/2026-06-24-orchestrator-expert-squad-skill.md`
  - `specs/records/2026-06/2026-06-26-frontend-replica-desktop-only-decision-surface.md`
  - `specs/records/2026-06/2026-06-29-browser-preview-reference-regions-tool.md`
  - `packages/opencorvus/src/skill/builtin/frontend-replica-expert-squad.md`
  - `packages/opencorvus/src/agent/prompt-profile.ts`
  - `packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts`
  - `packages/opencorvus/test/agent/prompt-profile.test.ts`
- Missing open IDE file:
  - the deleted root-level tv2ainvest spec file does not exist in this checkout.
- Full-repo grep/inventory:
  - `rg -n "frontend-replica|replica|expert-squad|expert squad|visual-extraction|visual-acceptance|browser_preview_reference_regions|browser_preview_compare_scroll_slices" packages/opencorvus/src packages/opencorvus/test specs -S --glob '!**/target*'`
  - `rg -n -e 'frontend-replica-expert-squad' -e 'PromptProfile\.builtIns' -e 'browser_preview_reference_regions' -e 'browser_preview_compare_scroll_slices' -e 'select_expert_squad' -e 'required_tools' -e 'mounted_agents' -e 'profile_id: "frontend-replica"' packages/opencorvus/src packages/opencorvus/test specs/current/architecture specs/records/2026-06 -S --glob '!**/target*'`

## Decision

Write tool ownership in both model-visible expert-squad surfaces:

- `frontend-replica-expert-squad.md` tells orchestrator how to keep ownership
  when it selects the frontend replica profile.
- `PromptProfile.builtIns["frontend-replica"].agents.build` tells build to call
  `browser_preview_reference_regions` for region proof and
  `browser_preview_compare_scroll_slices` for page-slice `visual_diff`.
- `PromptProfile.builtIns["frontend-replica"].agents["visual-qa"]` tells visual
  QA to own the final region proof and treat scroll slices as supporting
  `visual_diff`.
- `PromptProfile.builtIns["frontend-replica"].agents.orchestrator` keeps
  ownership assignment visible without turning it into a new route or tool list.

## Acceptance

- The expert-squad skill body names both browser preview tool IDs and the
  build/visual-qa ownership split.
- The skill frontmatter still requires only `select_expert_squad`.
- Frontend replica build and visual-qa overlays name both browser preview tool
  IDs.
- Prompt-profile pressure tests still pass.
