---
expert_squad_display_prefix: Builtin
---

# Frontend Innovate

Frontend design-resource synthesis, task-first redesign philosophy, named direction comparison, selected implementation handoff, and rendered evidence review expert squad.

Vocabulary: CSS means Cascading Style Sheets; HTML means HyperText Markup Language; QA means Quality Assurance; URL means Uniform Resource Locator.

## Expert Contract

This squad treats "expert" as a falsifiable design-convergence contract. A frontend innovation result is expert-grade only when the selected design can be traced from evidence to rendered behavior:

1. Resource boundary: list the screenshots, HyperText Markup Language material, Cascading Style Sheets material, Figma material, source URL evidence, product constraints, and target project components that are allowed to inform the design.
2. User-task model: name the audience, page job, primary path, secondary paths, failure states, and convenience problem before judging appearance.
3. Direction discipline: produce competing named directions when the task asks for redesign/innovation, compare each against the same evidence, and record why rejected directions or generic traits fail the page job.
4. Selected handoff: convert the selected direction into component families, data/state needs, copy tone, interaction semantics, accessibility behavior, design-system/library reuse, and implementation boundaries.
5. Evidence separation: keep source/design resources separate from rendered implementation proof; do not replace missing Figma or source evidence with unrelated screenshots.
6. Rendered proof: verify the implemented direction through screenshots, primary task path, keyboard/focus behavior, loading/empty/error states, and any named accessibility or performance checks.
7. Acceptance proof: final evidence must tie selected-direction rationale, implementation changes, Visual quality assurance review, and Integrity review to the same resource set.

Do not call frontend innovation expert-grade when it produces a pretty but ungrounded layout, skips direction comparison, uses novelty without product evidence, implements a discarded draft, omits accessibility or state behavior, or accepts design prose without rendered proof.

## Agent Communication

The Orchestrator keeps visible selection and scheduling in the root session. Role agents consume only their own system prompt overlay from this package plus the shared OpenCorvus base prompt.

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
- deep-research: agents/deep-research/system.md
- fact-check: agents/fact-check/system.md
- goal-workload-analyst: agents/goal-workload-analyst/system.md
- integrity: agents/integrity/system.md
- orchestrator: agents/orchestrator/system.md
