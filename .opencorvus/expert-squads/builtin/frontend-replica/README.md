---
expert_squad_display_prefix: Builtin
---

# Frontend Replica

Source URL/reference-screenshot replica, desktop surface ledger, bounded evidence-backed acceptance, source evidence, and rendered proof expert squad.

Vocabulary: DOM means Document Object Model; QA means Quality Assurance; URL means Uniform Resource Locator.

## Expert Contract

This squad treats "expert" as a falsifiable source-to-render contract. A frontend replica result is expert-grade only when every accepted surface is bound from source evidence to changed implementation and rendered proof:

1. Source evidence boundary: name the source URL, reference screenshot, Document Object Model evidence, computed styles, interaction observations, assets, data, or design artifact that defines the target.
2. Surface model: map each requested user-visible region, component, state, interaction, chart/table/map/media slot, or asset to source refs, target files, owner goal, and acceptance evidence.
3. Implementation ownership: show the local code path that owns the surface; shared support code is valid only when visible surfaces import it and prove it in render.
4. Parity dimensions: compare source order, layout, density, spacing, typography, color, assets, content, state visuals, layering, and interaction behavior against current rendered output.
5. Feedback accounting: keep Visual quality assurance rendered-feedback attempts separate from preview/toolchain blockers and Integrity implementation blockers.
6. Bounded repair: after repeated evidence-backed non-pass rounds for the same surface, mark the surface not accepted with blockers instead of scheduling blind repair loops.
7. Acceptance proof: final evidence must connect source refs, implementation diff, rendered screenshots/browser evidence, and remaining blockers for each accepted surface.

Do not call a replica task expert-grade when it ships source-row prose, screenshot-only commentary, no project diff, scaffold-only code, blank filler geometry, uninspected screenshots, or a page that satisfies a different information architecture than the source.

## Agent Communication

The Orchestrator keeps visible selection and scheduling in the root session. Role agents consume only their own system prompt overlay from this package plus the shared OpenCorvus base prompt.

Mission owns page-family task topology for this package. A single source page can be one engine task with Architect-owned component goals. A multi-page, page-family, or subpage clone must first dispatch a serial template/source-baseline task, then dispatch independent page/subpage tasks after the template task is terminal. Those page/subpage tasks may run in parallel only when they cite the template artifact paths and own disjoint source surfaces, files, and acceptance evidence.

Package prompt overlays:

- coding: agents/coding/system.md
- coding-assistant: agents/coding-assistant/system.md
- general: agents/general/system.md
- explore: agents/explore/system.md
- mission: agents/mission/system.md
- intent-analysis: agents/intent-analysis/system.md
- requirements: agents/requirements/system.md
- architect: agents/architect/system.md
- frontend-design: agents/frontend-design/system.md
- frontend-research: agents/frontend-research/system.md
- build: agents/build/system.md
- visual-qa: agents/visual-qa/system.md
- integrity: agents/integrity/system.md
- orchestrator: agents/orchestrator/system.md

`frontend-design` remains packaged for explicit non-default workflow use and
historical handoff consumption, but the normal frontend-replica workflow does
not dispatch it.
