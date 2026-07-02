---
name: frontend-replica-expert-squad
description: Orchestrator skill for frontend replica tasks. Use when a task is a webpage clone, reference-screenshot port, reference-page recreation, or frontend implementation where source information architecture, module order, layout density, desktop visual behavior, and interaction semantics must stay aligned with source URL/screenshot/DOM evidence.
agents:
  - orchestrator
mounted_agents:
  - orchestrator
required_tools:
  - select_expert_squad
priority: 90
---

# Frontend Replica Expert Squad

Use this skill when the task is a frontend replica task: webpage clone, reference-screenshot port, reference-page recreation, design-system rewrite that must preserve source structure, or a UI task whose acceptance depends on source URL/screenshot/DOM evidence.

## First action

Call `select_expert_squad` with `profile_id: "frontend-replica"` unless the current task root session is already using that profile.

The reason must cite task evidence, such as source URL, reference screenshot, design artifact, visual parity requirement, or source information architecture that must be preserved.

## Dispatch discipline

- Treat frontend replica as a workflow / pipeline task, not a direct single Build task. The normal path is source evidence, Requirements, Architect goals, per-goal Build, Visual QA, Integrity, then Orchestrator lifecycle decision.
- Treat `frontend_research` as source-page investigation and page-skeleton evidence ownership.
- Treat `frontend_design` as a single-shot task-scope handoff producer for the replica contract, material inventory, source handoff, and layout/style/data/interaction constraints.
- Treat `architect` and `build` as consumers of that evidence, not as replacements for source investigation.
- Treat `visual_qa` as rendered screenshot and interaction evidence review after implementation reaches a visible surface.
- Do not use implementation work without source URL, screenshot, DOM, or computed-style evidence to invent a new page structure when source evidence exists.
- After an agent has already produced its task-scope artifact, consume the persisted artifact instead of calling that same agent again for another angle. Exceptions are explicit retry of a failed/incomplete call, Build implementation or repair, Visual QA review or re-review, and Integrity review or re-review after repair.
- Do not re-run Requirements, Architect, `frontend_research`, `frontend_design`, or the whole workflow as a convenience loop after their valid artifacts exist. If evidence proves a prior artifact invalid, name the invalid artifact and exact evidence, then perform a scoped retry/correction rather than restarting the workflow.

## Goal decomposition discipline

- If the operator does not specify goal granularity, default to one source component or meaningful source region per goal.
- Do not mix several source components, unrelated regions, or a whole page into one Build goal.
- Normal webpage replica decomposition generally needs 10 or more goals. Fewer goals require source evidence that the page has fewer than 10 meaningful components or regions, plus an explicit Architect note explaining why each remaining goal is still one component or region.
- Keep each goal tied to its source evidence, target implementation files, Component Interaction Matrix entries, and rendered verification evidence.

## Browser preview evidence ownership

- Build owns changed-region module binding proof for implemented desktop replica regions: when source/reference evidence and local implementation regions exist, it must call `browser_preview_reference_regions` and inspect the single returned source/local module comparison attachment.
- Visual QA owns independent final rendered parity review as source-to-target review: it must use Browser MCP screenshot/observe tools for ordinary screenshots and browser operations, call `browser_preview_reference_regions` only for one module source-binding comparison, and call `browser_preview_compare_scroll_slices` only for supporting page-slice `visual_diff` evidence.
- `browser_preview_reference_regions` is for concrete component or module regions, not first-viewport slices, whole-page screenshots, body/main/app roots, or page-shell locators. It does not run a second `reference-comparison` pass and does not auto-call slice or screenshot tools on bind failure. First-viewport and screen-by-screen checks use `browser_preview_compare_scroll_slices` with aligned `scrollY` and `sliceHeight`.
- Orchestrator must preserve that ownership when selecting this expert squad; do not shift these browser preview proof calls to Requirements, Architect, Integrity, or unowned review prose.

## Blank filler geometry boundary

- Treat source page height, full-page screenshot dimensions, region y coordinates, and footer transition positions as diagnostic measurements for locating real visible source content and region boundaries. They are not implementation targets by themselves.
- Requirements and Architect must not turn a measured y coordinate, footer boundary, or document height into acceptance that can be satisfied by empty spacer bands, blank margin/padding, `height`/`min-height` filler, phantom cards, or unrendered media slots.
- Frontend Design must describe geometry together with the visible source sections, assets, canvas/image captures, repeated content, and footer material that occupy that region; if the source evidence is missing, mark the region as evidence debt instead of asking downstream agents to pad the page.
- Build must not align a footer, page edge, scroll slice, or full-page height by adding blank CSS space. If the rendered page is short or a source interval is empty, restore the missing source-backed content/assets/interactions or report the concrete blocker.
- Visual QA must reject large blank bands between completed regions, empty thumbnail/canvas/image slots, or CSS filler inserted to match source geometry as production blockers. The report should cite the source/reference slice and the owning DOM/source module that must be repaired.

## Desktop-only replica scope

- Frontend replica, clone, visual parity, and source-page recreation tasks are desktop-only generation tasks by default.
- Do not ask Requirements, Architect, Build, Visual QA, or Integrity to create tablet/mobile/non-desktop requirements, goals, acceptance specs, build objectives, browser preview viewport requests, screenshots, source-debt rows, or final blockers unless the current operator explicitly asks for tablet/mobile/responsive/multi-end migration as a separate current task scope.
- Desktop-only scope can still include multiple desktop-class viewport widths when the current desktop replica contract explicitly names adaptive layout, width scaling, overflow, wrapping, gutters, sticky controls, or layout stability. Keep those checks under desktop scope and do not request tablet/mobile viewports for them.
- Tablet/mobile/responsive wording inside batch templates, old specs, upstream research/design summaries, handoff debt, historical goals, or general QA checklists is not authorization.
- If the current operator explicitly asks for non-desktop migration, keep it as an independent multi-end migration scope instead of mixing it into the desktop replica generation task.
- Browser preview may still support tablet/mobile viewports as a general tool capability; this skill forbids converting that capability into default replica work.

## Completed goal rule

After goals are completed, do not replan the goal graph merely because visual parity needs adjustment. Use scoped micro-adjustments only: dispatch the responsible build or visual review path with concrete defect evidence from the existing completed work.

Micro-adjustments include spacing, state, asset, selector, or interaction corrections that preserve the existing desktop information architecture and implementation ownership.

## Major incident rule

If evidence shows a major incident, do not pretend a micro-adjustment can fix it. Major incidents include wrong page information architecture, wrong source page, missing reference evidence, an invalid goal graph, or completed goals built on a false premise.

For a major incident, call `propose_task` with the lesson learned, the exact evidence that invalidated this task, and the corrected task scope. The proposed task must carry forward what was learned instead of restarting blindly.

## Completion evidence

Before final acceptance, require rendered proof tied to the requested desktop surface: source-backed structure, interaction behavior, and screenshots or browser evidence that demonstrate the replica contract.
