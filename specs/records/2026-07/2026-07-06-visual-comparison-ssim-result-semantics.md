# Visual Comparison SSIM Result Semantics

Date: 2026-07-06

## Recall

User request:

- The frontend replica visual comparison tool is returning too many pass results.
- Running the tool must not mean pass.
- Only Structural Similarity Index Measure (SSIM) comparison score higher than 95% counts as pass; all other tool results count as failed.
- Follow-up clarification: only change tool result semantics; do not add extra gates.

Acceptance criteria:

- Browser Preview reference-comparison tool result status is `passed` only when the true-size crop sizes match and `ssim_score > 0.95`.
- Browser Preview reference-comparison evidence status uses the same tool result status.
- Scroll-slice comparison, while still supporting `visual_diff` evidence only, no longer reports a completed/success-like status for low SSIM slices; it reports `passed` only when `ssim_score > 0.95`, otherwise `failed`.
- `overall_score` remains diagnostic only and is not the pass source for these visual comparison tool results.
- No Visual QA, visual-feedback verification, Orchestrator, Integrity, lifecycle, or host-side gate is added.
- Focused tests prove `SSIM = 0.95` is failed and `SSIM > 0.95` is passed.

Hard constraints:

- No fallback, compatibility path, hidden bypass, or second pass source.
- Do not restore `VisualEvidenceBundle`.
- Do not move scroll-slice ownership back to Build.
- Do not rewrite Visual QA acceptance as an added gate; downstream should consume the corrected tool result.
- Do not reset or revert unrelated dirty worktree changes.
- Specs stay under `specs/records/2026-07/`.

Sources read:

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/benchmark-debug-template/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/09-verification-evidence.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-03-rendered-reference-acceptance-redesign.md`
- `specs/records/2026-07/2026-07-03-screenshot-comparison-guidance.md`
- `specs/records/2026-07/2026-07-04-direct-build-outcome-and-visual-qa-contract.md`
- `specs/records/2026-07/2026-07-05-build-scroll-slice-tool-retirement.md`
- `specs/records/2026-07/2026-07-05-frontend-replica-goal-bound-reference-crops.md`
- `packages/opencorvus/src/browser-preview/region-comparison.ts`
- `packages/opencorvus/src/browser-preview/scroll-slice-comparison.ts`
- `packages/opencorvus/src/verification/visual/evaluate.ts`
- `packages/opencorvus/src/visual-qa/output-tools.ts`
- `packages/opencorvus/src/visual-qa/schema.ts`
- `packages/opencorvus/src/acceptance/visual-feedback-verification.ts`
- `packages/opencorvus/test/browser-preview/region-comparison.test.ts`
- `packages/opencorvus/test/verification/visual/evaluate.test.ts`

Whole-repository grep evidence:

- `rg -n "SSIM|ssim|similarity|score|threshold|95|0\\.95|pass|passed|accepted|effectiveAccepted|effective_accepted|reference_comparison|reference-comparison|visual-feedback-verification|visual_feedback" packages/opencorvus/src packages/opencorvus/test .opencorvus specs/current specs/records/2026-07 -g "*.ts" -g "*.tsx" -g "*.txt" -g "*.md" -g "*.jsonc"`
- `rg -n "submit_visual_qa_report|VisualQa|VisualQA|reference_parity|set_visual_qa_reference_parity|reference_comparison_evidence_refs|effective_accepted|effectiveAccepted|visual_qa_process_accepted|accepted" packages/opencorvus/src/visual-qa packages/opencorvus/test/visual-qa packages/opencorvus/src/orchestrator packages/opencorvus/test/orchestrator packages/opencorvus/src/integrity packages/opencorvus/test/integrity -g "*.ts" -g "*.txt"`
- `rg -n "reference-comparison|browser_preview_evidence|compare.*reference|side-by-side|diff_png|score|similarity|ssim|passed" packages/opencorvus/src/browser-preview packages/opencorvus/test/browser-preview packages/opencorvus/src/tool packages/opencorvus/test/tool -g "*.ts"`
- `rg -n "WEBPAGE_EVALUATE_PASS_SCORE|evaluateVisual\\(|ssimScore|ssim_score|overall_score|visual score|reference comparison completed" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`

Independent agent feedback:

- `019f3327-e0ca-73d2-b18f-4eec6ef8d81f` confirmed the active tool bug: `region-comparison.ts` computes `ssim_score` but marks pass from `overallScore >= 85`; `scroll-slice-comparison.ts` returns a completion-like status and treats low SSIM as a warning.
- The same agent also suggested downstream Visual QA / visual-feedback verification gates. That part is intentionally not adopted after the user's clarification. This repair changes producer tool result semantics only.
- `019f3328-0ef8-7522-a949-a18c2688c384` and `019f3327-f544-7933-a648-bd92c341697e` also identified downstream consumers that could misread visual evidence and suggested Visual QA / Orchestrator / Integrity prompt or gate changes. Those findings are not adopted in this repair after the user's clarification; they remain out-of-scope review input unless a later task explicitly asks to change consumers.

## Root Cause

The Browser Preview reference-comparison tool already computes `ssim_score`, but it does not use SSIM as the pass source. It marks a region as completed when crop dimensions match and the composite `overall_score` is at least `WEBPAGE_EVALUATE_PASS_SCORE`, currently 85.

That composite score is not SSIM. It mixes SSIM and pixel-diff percentage, so a result can be reported as passed even though the user's required SSIM threshold is not met. Scroll-slice comparison has the same semantic problem in a different form: it reports `"completed"` after the tool runs and only emits a low-SSIM warning.

## Decision

Use one tool-result threshold:

```text
pass iff ssim_score > 0.95
```

The comparison artifacts and `overall_score` remain diagnostics. They can explain differences, but they do not decide pass.

This is not a new acceptance gate. It is a correction to the tool-produced `status` field and the persisted Browser Preview evidence status generated by that tool.

## Implementation Plan

1. Replace the old overall-score pass helper with an SSIM pass helper in `verification/visual/evaluate.ts`.
2. Make `browser-preview/region-comparison.ts` use the SSIM helper for region status, result status, diagnostics, and persisted evidence status.
3. Make `browser-preview/scroll-slice-comparison.ts` report `passed` or `failed` from the same SSIM helper while preserving its supporting `visual_diff` wording.
4. Update focused tests for the helper, reference-comparison result status, and scroll-slice status.

## Verification Plan

- `bun test packages/opencorvus/test/verification/visual/evaluate.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/browser-preview/region-comparison.test.ts packages/opencorvus/test/browser-preview/scroll-slice-comparison.test.ts --timeout 180000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 120000`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`

## Verification Results

- `bun test packages/opencorvus/test/verification/visual/evaluate.test.ts --timeout 120000`: 8 pass.
- `bun test packages/opencorvus/test/browser-preview/region-comparison.test.ts --timeout 180000`: 13 pass.
- `bun test packages/opencorvus/test/browser-preview/scroll-slice-comparison.test.ts --timeout 180000`: 6 pass.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 120000`: 19 pass.
- `bun run --cwd packages/opencorvus typecheck`: pass.
- `git diff --check` on touched paths: pass.
- Post-repair grep found no remaining `WEBPAGE_EVALUATE_PASS_SCORE`, `WEBPAGE_HIGH_FIDELITY_PASS_SCORE`, or `overallScore >=` pass source in the Browser Preview visual comparison / evaluation paths.

## Push Note

Before implementation, pushing existing ahead commits to `legacy-remote` ran local pre-push checks successfully but remote pre-receive rejected the push because the two existing unpushed commit messages do not start with the required `dsw-<taskID>` prefix. This is not caused by the SSIM repair, but it affects final push unless those existing commit messages are rewritten or otherwise resolved.
