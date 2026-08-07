# Frontend Replica Blank Filler Geometry Repair

Date: 2026-07-01

## Recall

User request:

- Investigate why a TradingView forex page replica screenshot contains large
  blank bands.
- Identify where the workflow said to fill blank page height.
- Explain how to solve it.
- Use independent agents to adversarially review the plan and changes, then
  repair the real root cause instead of stopping at a prompt-only patch.

Acceptance criteria:

- The frontend-replica expert squad must not turn source page height, region y
  coordinates, footer transition position, or full-page screenshot height into
  permission to add blank spacer, margin, padding, or `min-height` filler.
- Build must restore missing source-backed content/assets or report the exact
  blocker; it must not align footer/page boundaries by empty CSS.
- Visual QA must block blank filler bands between completed regions and return
  DOM/source-module repair facts.
- Frontend Design must phrase geometry as evidence for real visible source
  content, not as a skeleton height target.
- Per the operator correction during implementation, do not edit prompts outside
  the expert-squad prompt surface. This repair keeps core prompts and
  prompt-profile overlays unchanged.
- Source-capture geometry must carry an evidence-only use boundary in generated
  source handoff artifacts and frontend-design layout specs.
- Visual evidence must reject unexplained blank intervals and reference
  comparison evidence that lacks source bbox, size, or content metrics.
- Add focused tests for geometry schema, source handoff, browser comparison
  metrics, visual evidence hard rejection, Integrity pass rejection, prebuilt
  metric execution, and docs.

Hard constraints:

- No fallback, no compatibility path, no keyword-matching host gate, and no
  deterministic CSS blacklist pretending to solve visual quality.
- No broad git reset and no destructive worktree operations.
- Do not touch unrelated dirty worktree content.
- Do not restart, kill, refresh, or otherwise interfere with running
  OpenCorvus / overlay processes.
- Every code or prompt change needs focused tests.

Sources read:

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/current/architecture/18-webpage-replica-agent-workflow.md`
- `specs/records/2026-06/2026-06-29-build-outcome-and-visual-evidence-repair.md`
- `specs/records/2026-06/2026-06-30-browser-preview-viewport-slice-binding.md`
- `specs/records/2026-07/2026-07-01-visual-qa-feedback-consumption-chain.md`
- `packages/opencorvus/src/prompt/core/build-core.txt`
- `packages/opencorvus/src/prompt/core/visual-qa-core.txt`
- `packages/opencorvus/src/prompt/core/frontend-design-core.txt`
- `packages/opencorvus/src/skill/builtin/frontend-replica-expert-squad.md`
- `packages/opencorvus/src/agent/prompt-profile.ts`
- `packages/opencorvus/src/acceptance/visual-evidence.ts`
- `packages/opencorvus/src/browser-preview/region-comparison.ts`
- `packages/opencorvus/src/frontend-design/schema.ts`
- `packages/opencorvus/src/frontend-design/output-tools.ts`
- `packages/opencorvus/src/web-clone/source-project-generator.ts`
- `packages/opencorvus/src/web-clone/source-skeleton.ts`
- `packages/opencorvus/test/browser-preview/region-comparison.test.ts`
- `packages/opencorvus/test/frontend-design/output-incremental-tools.test.ts`
- `packages/opencorvus/test/integrity/acceptance-tools.test.ts`
- `packages/opencorvus/test/tool/web-clone-generate-source-project.test.ts`
- `packages/opencorvus/test/web-clone/source-skeleton.test.ts`
- `packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts`
- `packages/opencorvus/test/agent/prompt-profile.test.ts`
- `packages/opencorvus/test/build-agent/prompt-goal-discipline.test.ts`
- `packages/opencorvus/test/visual-qa/strict-reference-fidelity.test.ts`
- `packages/opencorvus/test/frontend-design/prompt.test.ts`

Whole-repository search evidence:

- `rg -n "fake spacers|min-height filler|footer y|y≈|footer transition|page geometry|visual-evidence-bundle|scroll slices|compare_scroll_slices|full-page|placeholder regions|source order|spacing rhythm" packages/opencorvus/src packages/opencorvus/test`
- `rg -n "空白|留白|填充|补齐|凑|height|min-height|spacer|placeholder|full[- ]?page|scroll|vertical|rhythm|spacing|blank|gap|footer|idea|thumbnail|canvas" packages/opencorvus/src/prompt packages/opencorvus/test/frontend-design`
- `rg -n "填充|空白|留白|spacer|blank|filler|placeholder|footer transition|y≈5222|5158|full-page|page geometry" <task-runtime frontend-design artifacts>`
- `rg -n "Region Style Profiles|Layout width contract|visual_consistency_contract|footer y|y≈|bounds|capture_viewport|full-page" packages/opencorvus/src packages/opencorvus/test specs/records/2026-07/2026-07-01-frontend-replica-blank-filler-geometry.md`
- `rg -n "sourceMap|verticalSliceSteps|parityGuard|implementationUse|coordinateSpace" packages/opencorvus/test/tool/web-clone-generate-source-project.test.ts packages/opencorvus/src/web-clone/source-project-generator.ts`
- `rg -n "visualEvidenceBundlePasses|validateVisualEvidenceBundleReferenceComparisons|VisualEvidenceBundleSchema|VisualRegionEvidence" packages/opencorvus/test packages/opencorvus/src`

Independent agent feedback:

- Aristotle traced the timing: `1440x900` was a legal default capture viewport
  from 2026-06-29, while the bad requirement was introduced on 2026-07-01
  14:45:39 when `frontend_design` wrote `footer y≈5222`, page height, and
  footer height as `MUST` in `frontend_template` and
  `visual_consistency_contract`. Requirements, Build, and Visual QA then
  inherited that mistaken contract.
- Raman found the first prompt-only repair insufficient: structured
  `frontend_design` layout specs could still turn viewport-scoped geometry into
  `must` requirements, web-clone generated handoff mixed bounds with operation
  instructions, and VisualEvidenceBundle accepted named regions without blank
  interval/content coverage.
- Socrates reached the same root cause from the acceptance side: geometry lacked
  a structured use boundary after entering Requirements/Architect/Acceptance,
  and visual evidence needed source bbox, source image size, coverage, and
  nonblank/content metrics rather than only screenshot/hash references.
- Second-round review after the first structural patch found remaining
  acceptance holes:
  - `register_layout_spec` still allowed
    `source_capture_viewport_px/evidence_only` rows to enter VisualSpec as a
    `must` requirement.
  - `submit_integrity_consensus` still recorded pass verdicts and downgraded
    missing/invalid visual evidence to advisory text.
  - `pageCoverage.unexplainedBlankIntervals` was self-reported, so an empty
    array could mean either "checked clean" or "not checked".
  - `prebuilt:visual-evidence-bundle` existed in acceptance schemas but the
    metrics executor had no deterministic evaluator for it.
- Final read-only review after the hard-rejection patch found one runtime bug:
  missing `content` metrics in an older/bad reference-comparison capture pushed
  the correct issue but returned `undefined`, which would throw before
  reporting `not_passing`. That branch now returns `{}` and has a regression
  test.

## Failure Chain

The source request and active requirement rows asked for desktop reference
parity, source-backed assets, component slices, and full-page visual evidence.
They did not ask for blank space.

The direct implementation defect in the forex replica was:

- FAQ/footer transition was adjusted with a large CSS bottom margin.
- Ideas cards reserved a thumbnail-height slot with top padding but did not
  render the source-backed thumbnails/canvas captures.

The upstream ambiguity was not a positive "fill blank space" rule. It was the
combination of geometry wording such as footer transition y coordinates,
full-page height, and page geometry with incomplete content restoration. The
agent treated a reference y coordinate as a target CSS height instead of using
it to locate real source-backed visible content.

The deeper root cause was a missing structured use boundary for geometry:
source `x/y/w/h`, page height, footer y, and scrollY were legal source evidence
for crop, comparison, region identity, and horizontal width-mode decisions, but
they entered downstream contracts as strings and could be promoted into
implementation targets. The validator also lacked a way to reject unexplained
blank vertical intervals or a "passing" region comparison with no source bbox
or content metrics.

## Repair Plan

The operator clarified: do not edit prompts outside the expert squad. This
repair therefore leaves core prompts and prompt-profile overlays unchanged and
repairs the non-prompt data flow that promoted geometry evidence into
implementation/acceptance targets.

1. Update web-clone source project and source skeleton generation:
   - Emit `coordinateSpace: "source_capture_viewport_px"` and
     `implementationUse: "evidence_only"` beside source bounds.
   - Make layout width contracts explicitly horizontal only; they do not impose
     page height, footer y, scrollY, or blank filler.
2. Update frontend-design layout spec tooling:
   - Require each layout spec to declare `coordinate_space` and
     `implementation_use`.
   - Reject every `source_capture_viewport_px` layout spec before it enters
     VisualSpec requirements, including `source_capture_viewport_px/evidence_only`
     rows marked as `must`.
3. Update visual evidence:
   - Browser reference comparisons write source and implementation content
     metrics from real PNG crops.
   - VisualEvidenceBundle includes page coverage with evidence-only geometry,
     covered source-reference intervals, and hard-fails unexplained blank
     intervals.
   - Integrity visual evidence validation rejects missing source bbox/image
     size/coverage/content metrics, blank/monochrome implementation crops,
     declared coverage gaps, and evidence-backed coverage gaps.
4. Update terminal consumers:
   - Integrity rejects pass verdict submission when reference visual evidence
     is required but missing or invalid.
   - Metrics executor supports the deterministic
     `prebuilt:visual-evidence-bundle` evaluator using the same validation
     function.
5. Update tests and the July record index, then run docs health/link
   verification.

## Implementation Notes

- Did not modify `packages/opencorvus/src/prompt/core/*.txt`,
  `packages/opencorvus/src/skill/builtin/frontend-replica-expert-squad.md`, or
  `packages/opencorvus/src/agent/prompt-profile.ts`.
- Updated web-clone generated source handoff and style profiles so source
  bounds are evidence-only source-capture facts.
- Updated frontend-design layout output tools so source-capture geometry cannot
  be registered as a layout spec at all.
- Updated browser preview reference-comparison manifests to include source and
  implementation crop content metrics.
- Updated VisualEvidenceBundle schema and validation to reject unexplained
  blank intervals, missing structured comparison captures, missing source bbox,
  missing source image size, declared coverage gaps, evidence-backed coverage
  gaps, missing content metrics, and blank implementation content metrics.
- Updated Integrity `submit_integrity_consensus` so pass verdicts with required
  visual evidence fail instead of recording advisory text.
- Added a metrics `prebuilt` evaluator for `visual-evidence-bundle` so
  deterministic acceptance consumes the same hard validation path.
- Kept the repair semantic and evidence-driven: source geometry must point to
  visible source regions/content/assets; it must not be converted into blank
  CSS spacing.

Residual boundary:

- Existing free-text `frontend_template` / `visual_consistency_contract`
  markdown can still contain bad natural-language geometry. This repair avoids
  keyword filters over markdown and instead blocks the structured
  implementation/acceptance paths that previously let such wording become a
  passing blank page. A full replacement of those markdown sections with a
  typed visual contract is a larger follow-up, not a hidden fallback in this
  fix.

## Validation Results

- `bun test packages/opencorvus/test/integrity/acceptance-tools.test.ts packages/opencorvus/test/integrity/team-agent.test.ts packages/opencorvus/test/integrity/browser-preview-tool.test.ts packages/opencorvus/test/metrics/executor.test.ts packages/opencorvus/test/frontend-design/output-incremental-tools.test.ts packages/opencorvus/test/visual-qa/strict-reference-fidelity.test.ts packages/opencorvus/test/engine/workflow-integrity-step.test.ts packages/opencorvus/test/browser-preview/region-comparison.test.ts --timeout 120000`
  - Result: 109 pass, 0 fail.
- `bun test packages/opencorvus/test/web-clone/source-skeleton.test.ts packages/opencorvus/test/tool/web-clone-generate-source-project.test.ts packages/opencorvus/test/frontend-design/cache-stability.test.ts packages/opencorvus/test/tool/schema-snapshot.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts packages/opencorvus/test/metrics/store.test.ts --timeout 120000`
  - Result: 118 pass, 1 skip, 0 fail.
- `bun test packages/opencorvus/test/integrity/acceptance-tools.test.ts --timeout 120000`
  - Result after missing-content-metrics fix: 13 pass, 0 fail.
- `bun test packages/opencorvus/test/integrity/team-agent.test.ts packages/opencorvus/test/integrity/browser-preview-tool.test.ts packages/opencorvus/test/metrics/executor.test.ts --timeout 120000`
  - Result: 38 pass, 0 fail.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 120000`
  - Result: 19 pass, 0 fail.
