# Visual Evidence Bundle Producer Repair

Date: 2026-07-01

## Recall

User request:

- The recurring `{authoritative-rendered-reference-visual}` blocker is a
  persistent, unacceptable bug.
- Explain and repair the system bug instead of treating each affected webpage
  clone task as an isolated failure.

Acceptance criteria:

- Reference-driven final visual acceptance must have one producer for the
  scoped `VisualEvidenceBundle`, not only late consumers in Visual QA,
  Integrity, and metrics.
- The repair must not weaken formal reference parity, must not make ordinary
  screenshots or scroll slices satisfy `reference-comparison`, and must not
  restore retired `webpage_*` visual gate tools.
- `browser_preview_compare_regions` remains hidden from Build and Visual QA
  agent tool lists; formal region comparison is host/materializer work from
  persisted task-scoped evidence.
- Missing or incomplete source-binding coverage must become concrete bundle
  materialization feedback with region/evidence facts, not the opaque recurring
  `{authoritative-rendered-reference-visual}` root.
- Any code change must have focused tests and must not touch unrelated dirty
  worktree edits.

Hard constraints:

- No fallback, no dual-source evidence, no screenshot-only acceptance, no
  compatibility path, no broad git reset, and no new worktree.
- Do not restart, kill, refresh, or otherwise interfere with running
  OpenCorvus / overlay processes.
- Specs stay under `specs/records/2026-07/` and must be indexed.

Sources read:

- `C:/Users/chuan/.codex/skills/benchmark-debug-template/SKILL.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/current/architecture/09-verification-evidence.md`
- `specs/records/2026-07/2026-07-01-integrity-report-only-completion-boundary.md`
- `specs/records/2026-07/2026-07-01-visual-qa-feedback-consumption-chain.md`
- `specs/records/2026-07/2026-07-01-frontend-replica-blank-filler-geometry.md`
- `specs/records/2026-06/2026-06-25-visual-evidence-no-hard-gate-root-repair.md`
- `specs/records/2026-06/2026-06-29-build-outcome-and-visual-evidence-repair.md`
- `packages/opencorvus/src/acceptance/visual-evidence.ts`
- `packages/opencorvus/src/browser-preview/region-comparison.ts`
- `packages/opencorvus/src/browser-preview/local-module-source-binding.ts`
- `packages/opencorvus/src/browser-preview/persist.ts`
- `packages/opencorvus/src/tool/browser-preview-reference-regions.ts`
- `packages/opencorvus/src/tool/browser-preview-tool-ids.ts`
- `packages/opencorvus/src/visual-qa/reference-parity-context.ts`
- `packages/opencorvus/src/visual-qa/output-tools.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/integrity/team-agent.ts`
- `packages/opencorvus/src/integrity/acceptance-tools.ts`
- `packages/opencorvus/test/frontend-design/webpage-evidence-architecture.test.ts`
- `packages/opencorvus/test/tool/browser-preview.test.ts`
- `packages/opencorvus/test/agent/agent.test.ts`
- `packages/opencorvus/test/browser-preview/region-comparison.test.ts`
- `packages/opencorvus/test/integrity/acceptance-tools.test.ts`

Whole-repository search evidence:

- `rg -n "VisualEvidenceBundle|visual-evidence-bundle|reference-comparison|authoritative-rendered-reference-visual|reference parity|visual evidence" specs packages/opencorvus/src packages/opencorvus/test -S`
- `rg -n "tryMaterializeVisualEvidenceBundle|visual-evidence-bundle.json|webpage-evaluate|webpage-vision-judge|VisualEvidenceBundleSchema" packages/opencorvus/src packages/opencorvus/test specs -S`
- `rg -n "inspect_visual_evidence|visualEvidenceRequired|readLatestTaskVisualEvidenceBundleSync|validateVisualEvidenceBundleReferenceComparisons|prebuilt.*visual-evidence-bundle|visual-evidence-bundle" packages/opencorvus/src packages/opencorvus/test -S`
- `rg -n "compareBrowserPreviewRegions\\(|BrowserPreviewRegionComparison|reference-comparison|browser_preview_compare_regions|compare_regions|bind_and_compare" packages/opencorvus/src packages/opencorvus/test -S`
- `rg -n "reference_region_key|requiredReferenceRegions|VisualEvidenceBundle alone|latest_visual_evidence_bundle|referenceParity" packages/opencorvus/test/engine packages/opencorvus/test/orchestrator packages/opencorvus/test/visual-qa packages/opencorvus/test/integrity -S`
- `rg -n "register_visual_evidence_acceptance|visual-evidence-bundle|acceptance_specs" packages/opencorvus/src/architect/output-tools.ts packages/opencorvus/test/architect -S`

Independent agent feedback:

- No sub-agent was spawned in this turn. The available sub-agent tool explicitly
  forbids spawning unless the user asks for delegation or parallel agents, so
  this record preserves main-agent evidence only.

## Root Cause

The final visual-evidence consumers were tightened without a current producer:

- Architect can register final `visual-evidence-bundle` / `visual_evidence`
  acceptance on an integration goal.
- Visual QA and Integrity read
  `fd/webpage-evidence/visual-evidence-bundle.json` through
  `readLatestTaskVisualEvidenceBundleSync`.
- Integrity pass validation rejects missing or invalid scoped bundle when
  final visual evidence is required.
- Metrics has a deterministic `prebuilt:visual-evidence-bundle` evaluator.

But current source no longer contains the old frontend-design
`tryMaterializeVisualEvidenceBundle` producer, and tests intentionally keep the
retired `webpage_render`, `webpage_evaluate`, and `webpage_vision_judge` tools
unregistered.

The only current formal `reference-comparison` producer is
`compareBrowserPreviewRegions()`, exposed through the backend route and unit
tests, not through Build / Visual QA agent tools. Build and Visual QA instead
see `browser_preview_reference_regions`, which produces source-binding
evidence and explicitly does not run a second `reference-comparison` pass.

That creates the dead loop seen in the failed TradingView currencies task:

1. Final goal requires visual evidence.
2. No `VisualEvidenceBundle` exists.
3. `deriveVisualQaReferenceParityContext()` sets `required=true` from the
   scorer but has no authoritative required regions unless a bundle already
   exists.
4. Visual QA can self-report useful screenshots, scroll slices, and
   source-binding evidence but remains `effective_accepted=false`.
5. Integrity requires the bundle, finds none, and repeats the same root
   blocker across rounds.

The bug is not that Integrity notices the absence. The bug is that the workflow
has no single post-build materialization step that turns task-scoped
source-binding evidence into the formal bundle before Integrity consumes it.

## Repair Plan

1. Add one `VisualEvidenceBundle` materializer under the acceptance/browser
   preview evidence boundary.
   - Input: project root, task id, and explicit Browser Preview evidence refs
     from a Visual QA report.
   - Accept only persisted, readable `source-binding` evidence whose capture
     contains a `BrowserPreviewRegionBinding`.
   - Run `compareBrowserPreviewRegions()` from host code using those bindings;
     do not expose `browser_preview_compare_regions` to agents.
   - Write exactly one current
     `fd/webpage-evidence/visual-evidence-bundle.json`.
2. Integrate materialization after Visual QA report persistence when reference
   parity is required.
   - Append a decision-log entry summarizing materialized bundle id, comparison
     refs, required regions, and remaining coverage issues.
   - Preserve Visual QA's structured report; do not mutate it into a fallback
     pass.
3. Keep formal validation unchanged.
   - `visualEvidenceBundlePasses()` and
     `validateVisualEvidenceBundleReferenceComparisons()` remain the consumer
     authority.
   - Scroll-slice `visual_diff`, screenshots, and source-binding proof remain
     supporting evidence only.
4. Add focused regression tests:
   - A source-binding evidence ref materializes a bundle with fresh
     `reference-comparison` refs and writes the canonical bundle file.
   - Missing / non-source-binding refs do not fabricate a bundle and return
     concrete issues.
   - Agent tool visibility still excludes `browser_preview_compare_regions`.
   - Visual QA orchestration records materialization feedback when reference
     parity is required.

## Validation Plan

- `bun test packages/opencorvus/test/acceptance/visual-evidence-materializer.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/browser-preview/region-comparison.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/visual-qa/output-tools.test.ts packages/opencorvus/test/integrity/acceptance-tools.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/tool/browser-preview.test.ts packages/opencorvus/test/agent/agent.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 120000`
- `git diff --check`

## Validation Results

- `bun test packages/opencorvus/test/acceptance/visual-evidence-materializer.test.ts packages/opencorvus/test/browser-preview/region-comparison.test.ts --timeout 120000`: 15 pass, 0 fail.
- `bun test packages/opencorvus/test/visual-qa/output-tools.test.ts packages/opencorvus/test/integrity/acceptance-tools.test.ts packages/opencorvus/test/tool/browser-preview.test.ts packages/opencorvus/test/agent/agent.test.ts --timeout 120000`: 117 pass, 0 fail.
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --timeout 120000 --test-name-pattern "visual_qa records a report through the shared stage dispatcher"`: 1 pass, 0 fail.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 120000`: 65 pass, 0 fail.
- `git diff --check`: pass.
