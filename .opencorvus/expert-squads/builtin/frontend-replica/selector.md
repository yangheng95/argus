# Frontend Replica Expert Squad

Use this skill when the task is a frontend replica task: webpage clone, reference-screenshot port, reference-page recreation, design-system rewrite that must preserve source structure, or a UI task whose acceptance depends on source URL/screenshot/DOM evidence.

Vocabulary: CSS means Cascading Style Sheets; DOM means Document Object Model; QA means Quality Assurance; UI means User Interface; URL means Uniform Resource Locator.

## First action

Call `select_expert_squad` with `profile_id: "frontend-replica"` unless the current task root session is already using that profile.

The reason must cite task evidence, such as source URL, reference screenshot, design artifact, visual parity requirement, or source information architecture that must be preserved.

## Expert Contract

An expert frontend replica result must include a source-to-render model, not just a page that looks plausible:

1. Source evidence boundary: name the source URL, reference screenshot, Document Object Model evidence, computed styles, interaction observations, assets, data, or design artifact that defines the target.
2. Surface model: map each requested user-visible region, component, state, interaction, chart/table/map/media slot, or asset to source refs, target files, owner goal, and acceptance evidence.
3. Implementation ownership: show the local code path that owns the surface; shared support code is valid only when visible surfaces import it and prove it in render.
4. Parity dimensions: compare source order, layout, density, spacing, typography, color, assets, content, state visuals, layering, and interaction behavior against current rendered output.
5. Feedback accounting: keep Visual quality assurance rendered-feedback attempts separate from preview/toolchain blockers and Integrity implementation blockers.
6. Bounded repair: after repeated evidence-backed non-pass rounds for the same surface, mark the surface not accepted with blockers instead of scheduling blind repair loops.
7. Acceptance proof: final evidence must connect source refs, implementation diff, rendered screenshots/browser evidence, and remaining blockers for each accepted surface.

Do not accept source-row prose, screenshot-only commentary, no project diff, scaffold-only code, blank filler geometry, uninspected screenshots, or a page that satisfies a different information architecture than the source.

## Dispatch discipline

- Treat frontend replica as a multi-agent source-evidence implementation task, not as a single blind Build pass. The normal scheduler-declared path is source evidence, Requirements, Architect goals, per-goal Build, Visual QA, Integrity, then Orchestrator lifecycle decision.
- Treat `frontend_research` as source-page investigation and page-skeleton evidence ownership.
- Treat `frontend_design` as a single-shot task-scope handoff producer for the replica contract, material inventory, source handoff, and layout/style/data/interaction constraints.
- Treat `architect` and `build` as consumers of that evidence, not as replacements for source investigation.
- Treat `visual_qa` as rendered screenshot and interaction evidence review after implementation reaches a visible surface.
- Do not use implementation work without source URL, screenshot, DOM, or computed-style evidence to invent a new page structure when source evidence exists.
- After an agent has already produced its task-scope artifact, consume the persisted artifact instead of calling that same agent again for another angle. Exceptions are explicit retry of a failed/incomplete call, Build implementation or repair, Visual QA review or re-review, and Integrity review or re-review after repair.
- Do not re-run Requirements, Architect, `frontend_research`, `frontend_design`, or the whole workflow as a convenience loop after their valid artifacts exist. If evidence proves a prior artifact invalid, name the invalid artifact and exact evidence, then perform a scoped retry/correction rather than restarting the workflow.

## Source authority

- Source URL/screenshot/DOM/computed-style/interaction evidence defines the replica contract. Target project primitives, component libraries, data mocks, and business code are subordinate implementation choices.
- For full-page reference screenshots, Frontend Design must inspect the coordinate atlas, choose horizontal component-band cuts, call `create_visual_region_binding_package` with `slicing_strategy: "horizontal_component_bands"` and contiguous `source_order`, review the returned overlay/contact sheet, call `update_frontend_visual_region_binding` with the returned manifestPath, and publish `reference_region_key` crop rows for downstream goal binding before Architect writes visible goals.
- Source evidence rows are not user-visible deliverables by themselves. They become implementation work only after Requirements or Architect maps them to a visible component, state, region, interaction, asset, table, chart, map, or media slot with target files and rendered acceptance.
- Do not accept screenshot-only prose, source-row labels, or unchecked design summaries as proof that the rendered implementation matches the source. The proof must tie source evidence to local rendered output and the owning implementation surface.

## Replica surface model

- Track each requested surface as a visible source-backed component or region with source evidence refs, target implementation files, Component Interaction Matrix rows, rendered proof, current Visual QA / Integrity blockers, and acceptance-attempt count.
- Treat target project reuse as a constraint inside that surface. Reuse may reduce code volume, but it must not rewrite source module order, density, typography, colors, interaction semantics, or content ownership.
- A Build result with no target project diff, no owning module binding, or no fresh rendered proof is non-delivery for that surface. It must not satisfy downstream acceptance or dependency decisions.
- For support goals, require an explicit consumer list. A shared registry, mock contract, asset extractor, or token module is valid only when downstream visible surface goals import it and prove it in rendered output.

## Acceptance attempt budget

- Orchestrator must maintain a visible rendered-feedback ledger per requested surface. Count only evidence-backed non-pass rounds where Visual QA / visual-feedback verification inspected the current rendered implementation against the current source surface and reported concrete visual blockers. Integrity non-pass rows are implementation completeness evidence, not rendered-feedback attempts.
- Toolchain failures, unavailable preview targets, missing source evidence, browser crashes, or unmaterialized screenshots are blockers that must be repaired or reported, but they are not rendered-feedback attempts.
- After the first evidence-backed rendered-feedback non-pass round, dispatch scoped Build repair with exact blocker IDs, source/reference refs, local screenshot refs, affected files, and the expected proof to produce next.
- After the second consecutive evidence-backed rendered-feedback non-pass round for the same requested surface, do not schedule another blind repair loop. Use the Orchestrator lifecycle to mark the surface/task not accepted, list unresolved blockers, failed requirements, cited evidence, and why the current turn cannot truthfully deliver it.
- Never reword a second failed rendered-feedback acceptance round as "basically complete" or "minor issues" unless the recorded blockers themselves prove they are out of scope.

## Goal decomposition discipline

- If the operator does not specify goal granularity, default to one user-visible implementation component or meaningful source-backed page region per Build goal.
- Source rows, visual-source rows, style-profile rows, DOM records, evidence-table rows, and data-extraction rows are evidence inputs only. Do not register them as Build goal titles, objectives, or acceptance surfaces unless they map to a user-visible component or region with target files and acceptance proof.
- Do not mix several user-visible source components, unrelated regions, or a whole page into one Build goal.
- Normal webpage replica decomposition generally needs 10 or more goals. Fewer goals require source evidence that the page has fewer than 10 meaningful user-visible components or regions, plus an explicit Architect note explaining why each remaining goal is still one component or region.
- Keep each goal tied to its source evidence, target implementation files, Component Interaction Matrix entries, and rendered verification evidence. A support goal such as source registry or shared mock contracts may exist only when it writes shared source/data modules consumed by user-visible region goals.
- Architect must bind each visible replica goal to completed Frontend Design crop rows through structured `reference_coverage.reference_regions`; crop ownership must not depend on filenames, prose labels, screenshot titles, overlay card ids, or reinterpreting the whole-page reference image.
- Do not accept `no_project_diff`, documentation-only output, screenshot-only commentary, blank spacer changes, or source-evidence restatement as completion for a Build goal that was supposed to implement a visible surface.

## Failure taxonomy

- Evidence blocker: source URL, screenshot, DOM, computed style, interaction trace, asset, or data evidence is missing, stale, unreadable, or contradicted by newer task evidence.
- Modeling failure: Requirements or Architect turned evidence rows into Build goals, bundled unrelated components into one goal, omitted Component Interaction Matrix coverage, or omitted target files and proof for a visible surface.
- Implementation non-delivery: Build produced no project diff, only docs/prose, scaffold-only code, fake placeholder UI, or code that is not bound to the requested rendered surface.
- Rendered parity failure: current output disagrees with source order, layout, density, spacing, typography, color, icon/assets, table/chart/map geometry, state visuals, layering, content, or interaction behavior.
- Structural drift: the implementation recreates a different information architecture, skips source modules, changes the page job, or fills source intervals with blank CSS instead of real source-backed content.
- Verification blocker: preview startup, browser automation, screenshot capture, comparison artifact, or evidence attachment failed before a rendered acceptance decision could be made.

## Visual QA and Integrity feedback consumption

- Implementation repair after Visual QA or Integrity must consume the latest blocker evidence before claiming pass. The repair report from the current workflow implementation owner must cite consumed diagnostic refs, affected source regions, target files changed, and fresh rendered proof.
- Visual QA must carry unresolved prior blockers forward unless fresh rendered evidence proves they are fixed. A clean new screenshot that does not inspect the blocked region is not proof of repair.
- Integrity must review the implementation evidence ledger, not just the latest optimistic report. Repeated implementation blockers across attempts are delivery facts, and the second evidence-backed implementation non-pass round should recommend not accepted instead of another generic repair. Do not let Integrity re-judge the rendered visual verdict.
- Annotated Visual QA screenshots and DOM diagnostics are repair inputs. They do not replace source/reference proof, and they must stay separate from target reference evidence.

## Browser preview evidence ownership

- The current workflow implementation owner owns changed-region module binding proof for implemented desktop replica regions: when source/reference evidence and local implementation regions exist, it must call `browser_preview_reference_regions` and inspect the single returned source/local module comparison attachment.
- Visual QA owns independent final rendered parity review as source-to-target review: it must use Browser MCP screenshot/observe tools for ordinary screenshots and browser operations, call `browser_preview_reference_regions` only for one module source-binding comparison, and call `browser_preview_compare_scroll_slices` only for supporting page-slice `visual_diff` evidence.
- `browser_preview_reference_regions` is for concrete component or module regions, not first-viewport slices, whole-page screenshots, body/main/app roots, or page-shell locators. It does not run a second `reference-comparison` pass and does not auto-call slice or screenshot tools on bind failure. First-viewport and screen-by-screen checks use `browser_preview_compare_scroll_slices` with aligned `scrollY` and `sliceHeight`.
- Every returned comparison artifact must be inspected with `comparison_guidance`: LEFT is the source/reference image, RIGHT is the rendered/local implementation, and the checklist covers layout alignment, region order, icons/assets, colors, spacing/density, typography, content hallucinations or omissions, component family drift, chart/table/map geometry, state visuals, layering, scoped desktop viewport drift, and placeholder/fake UI.
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
