# Frontend Replica Goal-Bound Reference Crops

Date: 2026-07-05

## Recall

User request:

- Refactor the frontend replica workflow so the agent directly slices the full-page reference image into smaller images, and bind those small images to goals.
- Start by using several agents to investigate the impact surface and reach consensus.
- Clarification: the key requirement is that the model must look and slice while inspecting the reference image itself; host-side pre-slicing or fixed rules are not reliable.

Acceptance criteria:

- Frontend replica source slicing is an agent-visible workflow: the model first inspects a coordinate atlas, then submits bounding boxes, then reviews generated crop overlay and contact sheet.
- The physical crop source remains the single full-page source image produced under `web-clone-source/reference.png`; small images are crop evidence, not a second source of truth.
- Goal binding is structured and machine-readable. It must not rely on filenames, prompt prose, screenshot titles, overlay card ids, or visual similarity of names.
- Frontend Design must not fabricate future goal ids. It produces stable region keys and crop artifacts; Architect binds those regions to goals through `reference_coverage`.
- Build must receive only the current goal's bound crop evidence as target visual references, with goal scope in the Build evidence packet and input evidence manifest.
- Goal-scoped Build context must not expand `web-clone-source/reference.png` or render a required full-page reference image instruction; whole-page reference inspection belongs to Frontend Design slicing and final Visual Quality Assurance, not per-goal Build.
- No fallback path may silently replace missing goal-bound crop evidence with the full-page image, task attachments, design resource manifest, or scroll-slice evidence.
- When a current goal has no Architect `reference_coverage` rows, or has rows but those rows contain no crop regions, Build must receive no task-level visual substitute; the missing crop binding is a contract gap to expose.
- Distinct `reference_region_key` rows remain distinct even if their crop PNG bytes have the same checksum; region key identity, not image content identity, owns the goal binding.
- Visual acceptance remains the rendered reference-comparison feedback chain; crop evidence defines per-goal targets but is not a final pass verdict.

Hard constraints:

- No fallback, compatibility, dual-source, gate, or state-machine style host routing.
- Do not restore `VisualEvidenceBundle` as final visual authority.
- Do not move scroll-slice ownership back into Build.
- Do not create a new worktree; do not reset or revert user changes.
- If overlay or visual UI is changed, run real page screenshots and review them. This record's first implementation stage is backend/prompt contract work, so overlay visual display is tracked as a separate follow-up unless code changes touch overlay UI.
- Frontend replica remains desktop-only by default unless the current user explicitly requests multi-end migration.

Read before implementation:

- `AGENTS.md`
- `specs/README.md`
- `specs/current/architecture/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/09-verification-evidence.md`
- `specs/current/architecture/18-webpage-replica-agent-workflow.md`
- `specs/records/2026-07/2026-07-02-frontend-replica-workflow-goal-discipline.md`
- `specs/records/2026-07/2026-07-03-rendered-reference-acceptance-redesign.md`
- `specs/records/2026-07/2026-07-05-build-scroll-slice-tool-retirement.md`
- `specs/records/2026-07/2026-07-05-build-web-clone-reference-context-repair.md`
- `specs/records/2026-07/2026-07-05-frontend-replica-worker-terminal-tool-projection.md`
- `.opencorvus/expert-squads/frontend-replica/selector.md`
- `.opencorvus/expert-squads/frontend-replica/agents/frontend-design/system.md`
- `.opencorvus/expert-squads/frontend-replica/agents/architect/system.md`

Whole-repository grep performed:

- `rg` for `frontend-replica`, `web-clone-source`, `reference.png`, `visual reference`, `scroll slice`, `region`, `VisualEvidenceBundle`, `rendered-reference`, `reference-region`, `screenshot`, and `viewport`.
- `rg` for expert-squad package loading, prompt profile projection, and stage-owned tool ids.
- `rg` for `create_visual_region_binding_package`, `source_reference_artifact`, `region_id`, `target_reference`, `input_evidence`, and `BuildEvidencePack`.
- `rg` for `goalID`, `goalRunID`, `attemptID`, `goal_id`, `goal_run_id`, `bbox`, `crop`, and `region`.
- `rg` for `register_reference_coverage`, `reference_coverage`, `source_reference`, `requiredReferenceRegions`, and `reference_region`.
- `rg` for `composeBuildEvidencePack`, `buildEvidenceContextPacket`, `BuildInputEvidenceManifest`, and AttachmentStore canonical URLs.

Independent agent feedback:

- Reference image chain investigation: keep `web-clone-source/reference.png` as the only full-page pixel source; do not restore `VisualEvidenceBundle`; final pass remains `reference-comparison`.
- Expert-squad and prompt investigation: Frontend Design is the right owner for direct crop generation because it already has `create_visual_region_coordinate_atlas` and `create_visual_region_binding_package`; Architect should bind crop regions to goals.
- Goal/session binding investigation: goal ownership should flow through Architect `reference_coverage`, Build goal filtering, worker descriptor/runtime contract, and Build evidence manifest; Frontend Design runs before goals and must not write goal ids.
- Overlay investigation: backend evidence can already carry `goalRunID` and `regionID`, but board and overlay do not yet project goal-bound images; UI projection is a separate contract surface and must not infer ownership from filenames or card ids.

## Consensus

The reliable workflow is:

1. Host evidence preparation keeps producing the full-page source reference image.
2. Frontend Design must inspect the full-page image through a coordinate atlas, decide visible region cuts, call the crop tool with explicit bounding boxes, inspect the returned overlay/contact sheet, and submit the manifest as the crop handoff.
3. The crop manifest carries stable `reference_region_key` values in `region_id@viewport` form and real crop artifact paths.
4. Architect registers goal ownership using structured `reference_coverage.reference_regions`, not free-form prose.
5. Orchestrator filters `reference_coverage` by goal, resolves the referenced crop artifacts from the Frontend Design task runtime, stores them as canonical AttachmentStore references, and injects them into the Build evidence packet as goal-scoped `target_reference` entries.
6. For every goal-scoped Build dispatch, Orchestrator stays in goal-bound reference mode. If the current goal has no reference coverage rows, or rows with no crop entries, it must not inject task-level full-page references as a substitute.
7. Goal-scoped Build context keeps source/component pointers but does not expand the source manifest or render a required full-page reference image instruction. Build sees goal-scoped crop target references in the visual reference contract and does not treat the full-page reference image as a replacement for missing crop evidence.
8. Multiple crop rows are preserved by `reference_region_key` even when their PNG content hash is identical.
9. Visual Quality Assurance and final acceptance continue to require current rendered reference-comparison evidence.

## Implementation Scope

First implementation stage:

- Extend Frontend Design visual region binding manifest rows with `reference_region_key`.
- Make Frontend Design complete the sub-image slicing itself for full-page replica references: the binding tool input must declare the page cut strategy as `horizontal_component_bands`, every crop row must carry a top-to-bottom `source_order`, and the generated manifest must preserve that ordered component cut list as the downstream source.
- Validate the submitted horizontal component cuts as a data contract: source orders are contiguous, regions are emitted in source order, and horizontal component bands do not vertically overlap. This is not a host fallback or auto-slicer; it is verification that the model-authored cuts are coherent before the manifest can feed Architect.
- Extend Architect `ReferenceCoverageEntrySchema` with structured `reference_regions` rows.
- Render reference region metadata in Build's Reference Coverage Contract.
- Add Orchestrator Build evidence composition for current goal reference regions, storing crop files through AttachmentStore and scoping them to the goal. Goal-bound crop rows are not de-duplicated by PNG checksum because identical pixels can still represent distinct semantic regions.
- Update frontend-replica prompts so crop generation is the default source handoff for full-page reference replica work.
- Add focused tests for manifest crop keys, Architect coverage schema, goal-scoped Build evidence, and prompt visibility.

Clarification after live task inspection:

- User correction: "frontend design要完成子图的切分".
- The failed live task proved that merely exposing `create_visual_region_binding_package` is insufficient: Frontend Design recorded one broad DOM/sourceMap region and downstream Build still cited the full-page `web-clone-source/reference.png`.
- Therefore Frontend Design's accepted handoff must include the completed horizontal component crop package and must cite its manifest, overlay, contact sheet, and per-region `reference_region_key` rows in `reference_artifacts` / `visual_consistency_contract`.
- Sub-agent review found the Build-side goal-bound crop consumer already exists. The remaining break is upstream: Frontend Design crop manifest rows must be projected as structured handoff data, not only as `reference_artifacts` strings, so Architect can bind goals to exact `reference_coverage.reference_regions` keys and bad/missing bindings are visible.
- Architect must generate goals from those Frontend Design crop rows. Architect may assign one or more rows to a goal, but it must not create visible replica goals without structured `reference_coverage.reference_regions` unless the goal is explicitly non-visual shared support work.

Deferred follow-up unless touched by this patch:

- Board and overlay projection of goal-bound visual evidence thumbnails.
- Visual Quality Assurance dispatch population of required reference regions and strict `goalRunID` matching for reference-comparison evidence.

## Verification Plan

- `bun test packages/opencorvus/test/frontend-design/visual-region-binding-tool.test.ts`
- `bun test packages/opencorvus/test/architect/output-tools.test.ts`
- `bun test packages/opencorvus/test/orchestrator/build-goal-reference.test.ts`
- `bun test packages/opencorvus/test/build-agent/visual-reference-prompt.test.ts`
- `bun test packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts`
- `bun test packages/opencorvus/test/expert-squad/package-manager.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`

If a targeted command exposes unrelated pre-existing failures, record the evidence and continue only where this task can directly repair the root cause without reverting user changes.

## Git Tracking Closure, 2026-07-06

User request:

- Add `.opencorvus/expert-squads` to Git tracking history and push.

Current tracking facts:

- `git ls-files .opencorvus/expert-squads | Measure-Object` reports 88 tracked files.
- `rg --files .opencorvus/expert-squads | Measure-Object` also reports 88 files, so the repository working tree has no extra ignored or untracked expert-squad package files.
- `.gitignore` already keeps `.opencorvus/*` local by default while unignoring `.opencorvus/expert-squads/**` and `.opencorvus/expert-squads/**/agents/build/**`.
- The active diff under `.opencorvus/expert-squads` is the `frontend-replica` prompt/package update from this record.

Commit boundary:

- Do not push only the prompt files when they name new structured crop handoff behavior. Include the direct implementation and tests for `reference_region_key`, `horizontal_component_bands`, `update_frontend_visual_region_binding`, Architect `reference_coverage.reference_regions`, and goal-scoped Build reference evidence.
- Do not stage unrelated dirty-worktree changes outside this repair chain.
