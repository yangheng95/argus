# Visual Evidence Bundle Authority Repair

Date: 2026-07-02

## Recall

User request:

- Set one explicit goal to fix the recurring VisualEvidenceBundle /
  `{authoritative-rendered-reference-visual}` disorder.
- Use several independent agents for adversarial investigation, repair, and
  review rather than relying on one linear explanation.

Acceptance criteria:

- Restore one current-architecture producer for scoped `VisualEvidenceBundle`
  evidence after the old `webpage_*` producer was retired.
- Keep formal rendered-vs-reference acceptance on task-scoped
  `browser_preview_evidence` with `operationKind="reference-comparison"`.
- Do not let screenshots, scroll slices, module source-binding PNGs, or Visual
  QA prose self-report satisfy formal reference parity.
- Do not reintroduce retired `webpage_render`, `webpage_evaluate`,
  `webpage_text_diff`, or `webpage_vision_judge`.
- Remove the remaining double-source risk where Visual QA's process report can
  keep failing the same visual contract after a passing Bundle has been
  materialized.
- Preserve expert-squad isolation: Build / Visual QA may collect supporting
  evidence, host code materializes formal evidence, Integrity consumes it
  read-only, and `select_expert_squad` only changes prompt profile selection.

Hard constraints:

- No fallback, no compatibility path, no gate mechanism, no broad git reset, no
  worktree creation, and no destructive process/UI intervention.
- Current dirty worktree changes outside this repair must be preserved.
- Specs stay under `specs/records/2026-07/` and remain indexed.
- Any code change must have focused regression tests.

Sources read:

- `C:/Users/chuan/.codex/skills/benchmark-debug-template/SKILL.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-01-visual-evidence-bundle-producer.md`
- `specs/current/architecture/09-verification-evidence.md`
- `packages/opencorvus/src/acceptance/visual-evidence.ts`
- `packages/opencorvus/src/acceptance/visual-evidence-materializer.ts`
- `packages/opencorvus/src/visual-qa/output-tools.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/integrity/team-agent.ts`
- `packages/opencorvus/src/prompt/core/integrity-team-core.txt`
- `packages/opencorvus/test/orchestrator/tools.test.ts`
- `packages/opencorvus/test/acceptance/visual-evidence-materializer.test.ts`

Whole-repository search evidence:

- `rg -n "tryMaterializeVisualEvidenceBundle|materializeVisualEvidenceBundle|visual-evidence-bundle\\.json|VisualEvidenceBundle" packages/opencorvus/src packages/opencorvus/test specs -S`
- `git log --all --oneline --decorate -S"tryMaterializeVisualEvidenceBundle" -- packages/opencorvus/src packages/opencorvus/test specs`
- `git log --all --oneline --decorate -G"tryMaterializeVisualEvidenceBundle|visual-evidence-bundle\\.json|VisualEvidenceBundle" -- packages/opencorvus/src packages/opencorvus/test specs`
- `git log --all --oneline --decorate --name-status -- packages/opencorvus/src/frontend-design/tools/visual-evidence-bundle.ts packages/opencorvus/test/frontend-design/tools/visual-evidence-bundle.test.ts`
- `rg -n "materializeVisualEvidenceBundle|visualEvidenceMaterialization|effective_accepted|visual_evidence_bundle_materialization|readLatestTaskVisualEvidenceBundleSync|validateVisualEvidenceBundleReferenceComparisons|browser_preview_compare_regions|select_expert_squad|inspect_visual_evidence" packages/opencorvus/src packages/opencorvus/test -S`

Independent agent feedback:

- Agent A `019f20db-e3f5-75f3-803b-32f674eaee57`: historical migration audit
  confirmed current-branch commit `e56b3f964724747bf42d4c2e2177e2e299015a5a`
  added the retired `tryMaterializeVisualEvidenceBundle` producer on
  2026-06-08, and commit `e59b4f3df6714f6032b4345ac86231823548d0e4`
  deleted it on 2026-06-20 with the retired `webpage_*` visual tools. The
  remaining gap is consumer migration, not producer deletion itself.
- Agent B `019f20db-ef63-7880-bd5f-ad1c34405b5d`: producer/consumer
  confirmed there is one current writer
  (`visual-evidence-materializer.ts`) and one production caller
  (`orchestrator/tools.ts`), but the write happens after Visual QA has already
  computed old reference-comparison blocking semantics. It also identified the
  need to validate materialized bundles before treating the stage as accepted.
- Agent C `019f20dc-0167-7293-b97f-910b3dfcd766`: expert-squad isolation
  confirmed Build and Visual QA cannot directly write the formal Bundle, and
  Integrity consumes it through `inspect_visual_evidence`. It flagged adjacent
  risks around evidence scoping and broad orchestrator shell capability, but
  those are separate follow-up surfaces rather than the direct
  `{authoritative-rendered-reference-visual}` cause.

## Current Finding

Historical evidence confirms the old producer existed and was intentionally
retired:

- `e56b3f964724747bf42d4c2e2177e2e299015a5a feat(acceptance): thread visual evidence bundles through review`
  added `frontend-design/tools/visual-evidence-bundle.ts` and its test.
- `e59b4f3df6714f6032b4345ac86231823548d0e4 fix: repair runtime evidence orchestration` deleted that
  producer together with the retired `webpage_render`, `webpage_evaluate`,
  `webpage_text_diff`, and `webpage_vision_judge` tools.

The correct repair is not restoring the old tools. The current architecture
uses Browser Preview evidence:

- Build / Visual QA can create supporting `source-binding` and `visual_diff`
  evidence.
- Host code must turn task-scoped source-binding evidence into formal
  `reference-comparison` evidence.
- `VisualEvidenceBundle` must then point only to readable passed
  `browser_preview_evidence` references.

The remaining risk after the first producer repair is double-source authority:
Visual QA still computes `effective_accepted` before post-Visual-QA Bundle
materialization. A report can therefore record the old "missing
reference-comparison refs" blocking issue even when the host materializer can
now create the formal Bundle immediately afterward. Integrity then sees both a
formal Bundle and a stale Visual QA false summary.

## Repair Plan

1. Keep `VisualEvidenceBundle` as the formal rendered-vs-reference authority.
2. Keep Visual QA responsible for structured GUI/process evidence: check graph,
   production blockers, findings, repairs, DOM problem regions, commands, and
   source-binding evidence refs.
3. Move formal reference-comparison sufficiency out of Visual QA output-tool
   acceptance and into the Orchestrator materialization + Bundle validator
   path.
4. Make the Visual QA stage result combine:
   - Visual QA process acceptance, and
   - `VisualEvidenceBundle` materialization status when reference parity is
     required.
5. Update Integrity prompt wording so a failing Visual QA process report is
   still evidence, but a passing scoped Bundle is the rendered-vs-reference
   authority for the visual contract.
6. Add regression coverage for:
   - Materialized Bundle changes the visual QA stage summary/result from stale
     reference-ref failure to accepted.
   - `not_ready` materialization remains a concrete failure, not a pass.
   - Build / Visual QA still cannot access `browser_preview_compare_regions`.
   - Integrity remains read-only and consumes `inspect_visual_evidence`.

## Validation Plan

- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --timeout 120000 --test-name-pattern "visual_qa"`
- `bun test packages/opencorvus/test/visual-qa/output-tools.test.ts packages/opencorvus/test/integrity/acceptance-tools.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/tool/browser-preview.test.ts packages/opencorvus/test/agent/agent.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/acceptance/visual-evidence-materializer.test.ts packages/opencorvus/test/browser-preview/region-comparison.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 120000`
- `git diff --check`

## Validation Results

2026-07-02:

- `bun test packages/opencorvus/test/visual-qa/output-tools.test.ts --timeout 120000`
  passed: 19 tests.
- `bun test packages/opencorvus/test/engine/workflow-integrity-step.test.ts --timeout 120000`
  passed: 23 tests.
- `bun test packages/opencorvus/test/visual-qa/strict-reference-fidelity.test.ts --timeout 120000`
  passed: 9 tests.
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --timeout 120000 --test-name-pattern "visual_qa"`
  passed: 2 selected tests, including source-binding to
  `VisualEvidenceBundle` materialization.
- `bun test packages/opencorvus/test/acceptance/visual-evidence-materializer.test.ts packages/opencorvus/test/integrity/acceptance-tools.test.ts --timeout 120000`
  passed: 15 tests.
- `bun test packages/opencorvus/test/tool/browser-preview.test.ts packages/opencorvus/test/agent/agent.test.ts --timeout 120000`
  passed: 85 tests.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 120000`
  passed: 65 tests.
- `bun test packages/opencorvus/test/orchestrator/build-feedback-context.test.ts --timeout 120000`
  passed: 3 tests.
- `git diff --check` passed.
