---
name: frontend-replica-expert-squad
description: Orchestrator skill for frontend replica tasks. Use when a task is a webpage clone, visual parity port, reference-page recreation, or frontend implementation where source information architecture, module order, layout density, desktop visual behavior, and interaction semantics must stay aligned with reference evidence.
agents:
  - orchestrator
mounted_agents:
  - orchestrator
required_tools:
  - select_expert_squad
priority: 90
---

# Frontend Replica Expert Squad

Use this skill when the task is a frontend replica or parity task: webpage clone, visual port, reference-page recreation, design-system rewrite that must preserve source structure, or a UI task whose acceptance depends on visible reference evidence.

## First action

Call `select_expert_squad` with `profile_id: "frontend-replica"` unless the current task root session is already using that profile.

The reason must cite task evidence, such as source URL, reference screenshot, design artifact, visual parity requirement, or source information architecture that must be preserved.

## Dispatch discipline

- Treat `frontend_research` as source-page investigation and page-skeleton evidence ownership.
- Treat `frontend_design` as a single-shot task-scope handoff producer for the replica contract, material inventory, source handoff, and visual/data constraints.
- Treat `architect` and `build` as consumers of that evidence, not as replacements for source investigation.
- Treat `visual_qa` as rendered evidence review after implementation reaches a visible surface.
- Do not use generic implementation work to invent a new page structure when source evidence exists.

## Browser preview evidence ownership

- Build owns changed-region parity proof for implemented desktop replica regions: when source/reference evidence and local implementation regions exist, it must call `browser_preview_reference_regions` and cite fresh `reference-comparison` evidence.
- Visual QA owns independent final rendered parity proof: it must call `browser_preview_reference_regions` for formal bound-region proof and may call `browser_preview_compare_scroll_slices` only for supporting page-slice `visual_diff` evidence.
- Orchestrator must preserve that ownership when selecting this expert squad; do not shift these browser preview proof calls to Requirements, Architect, Integrity, or generic review text.

## Desktop-only replica scope

- Frontend replica, clone, visual parity, and source-page recreation tasks are desktop-only generation tasks by default.
- Do not ask Requirements, Architect, Build, Visual QA, or Integrity to create tablet/mobile/non-desktop requirements, goals, acceptance specs, build objectives, browser preview viewport requests, screenshots, source-debt rows, or final blockers unless the current operator explicitly asks for tablet/mobile/responsive/multi-end migration as a separate current task scope.
- Generic tablet/mobile/responsive wording inside batch templates, old specs, upstream research/design summaries, handoff debt, historical goals, or general QA checklists is not authorization.
- If the current operator explicitly asks for non-desktop migration, keep it as an independent multi-end migration scope instead of mixing it into the desktop replica generation task.
- Browser preview may still support tablet/mobile viewports as a generic tool capability; this skill forbids converting that capability into default replica work.

## Completed goal rule

After goals are completed, do not replan the goal graph merely because visual parity needs adjustment. Use scoped micro-adjustments only: dispatch the responsible build or visual review path with concrete defect evidence from the existing completed work.

Micro-adjustments include spacing, state, asset, selector, or interaction corrections that preserve the existing desktop information architecture and implementation ownership.

## Major incident rule

If evidence shows a major incident, do not pretend a micro-adjustment can fix it. Major incidents include wrong page information architecture, wrong source page, missing reference evidence, an invalid goal graph, or completed goals built on a false premise.

For a major incident, call `propose_task` with the lesson learned, the exact evidence that invalidated this task, and the corrected task scope. The proposed task must carry forward what was learned instead of restarting blindly.

## Completion evidence

Before final acceptance, require rendered proof tied to the requested desktop surface: source-backed structure, interaction behavior, and screenshots or browser evidence that demonstrate the replica contract.
