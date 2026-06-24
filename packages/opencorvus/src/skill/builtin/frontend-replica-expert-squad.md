---
name: frontend-replica-expert-squad
description: Orchestrator skill for frontend replica tasks. Use when a task is a webpage clone, visual parity port, reference-page recreation, or frontend implementation where source information architecture, module order, layout density, responsive behavior, and interaction semantics must stay aligned with reference evidence.
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

## Completed goal rule

After goals are completed, do not replan the goal graph merely because visual parity needs adjustment. Use scoped micro-adjustments only: dispatch the responsible build or visual review path with concrete defect evidence from the existing completed work.

Micro-adjustments include spacing, state, asset, responsive, selector, or interaction corrections that preserve the existing information architecture and implementation ownership.

## Major incident rule

If evidence shows a major incident, do not pretend a micro-adjustment can fix it. Major incidents include wrong page information architecture, wrong source page, missing reference evidence, an invalid goal graph, or completed goals built on a false premise.

For a major incident, call `propose_task` with the lesson learned, the exact evidence that invalidated this task, and the corrected task scope. The proposed task must carry forward what was learned instead of restarting blindly.

## Completion evidence

Before final acceptance, require rendered proof tied to the requested surface: source-backed structure, interaction behavior, responsive state, and screenshots or browser evidence that demonstrate the replica contract.
