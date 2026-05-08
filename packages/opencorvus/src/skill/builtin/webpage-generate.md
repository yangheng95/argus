---
name: webpage-generate
description: Produce a mirror-grounded PRD/SPEC for a live webpage reference. Design-analysis owns `webpage_extract` -> `webpage_compile` -> `webpage_analyze`, then writes visual specs plus frontend/backend implementation contracts for downstream build agents. This skill no longer belongs to build; build implements from the persisted SPEC and delivery performs visual gates.
stage: design_analyst
auto_detect:
  task_signals:
    request_contains_url: true
priority: 60
required_tools:
  - webpage_extract
  - webpage_compile
  - webpage_analyze
---

# Webpage Reference SPEC Skill

You are not implementing the page. You are producing the authoritative PRD/SPEC that later agents will implement. Do not implement application source.

## Required Evidence Path

1. Run `webpage_extract` for the live URL.
2. Run `webpage_compile` after extraction finishes.
3. Run `webpage_analyze` after extraction finishes.
4. Read `mirror/reference.png`, `mirror/extracted-page.json`, `mirror/page-ir.xml`, `mirror/scaffold.json`, and `mirror/shared-context.md`.
5. Register visual specs for tokens, layout, components, interactions, and responsive rules.
6. Finalize with StructuredOutput fields: `product_spec`, `frontend_spec`, `backend_spec`, `reference_artifacts`, and `open_questions`.

The extraction steps are strictly serial because compile/analyze read artifacts written by extract.

## SPEC Requirements

- Visible text must come from extracted DOM / IR facts.
- Visual values must come from pixels, computed styles, or scaffold tokens.
- Component and interaction contracts must name the affected layout/component ids.
- Backend/API requirements must be inferred from observable UI behavior and code artifacts only.
- Unknown backend details must be marked as unknown instead of invented.

## Downstream Contract

Build agents consume the persisted SPEC and `task.design_specs`. They do not call mirror tools. Delivery owns rendered browser evidence and visual hard gates.
