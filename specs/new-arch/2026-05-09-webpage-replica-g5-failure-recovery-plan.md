# Webpage Replica G5 Failure Recovery Plan

Date: 2026-05-09
Status: Draft for implementation
Task: `tsk_e082d4816001Cw27dv210NQvFA`
Run: `run_e08398b7f001sfsdlzI4IveoCg`

## 0. Terms

- G5: Goal 5, the verification goal named `集成测试与视觉验收`.
- SSIM: Structural Similarity Index Measure, an image similarity metric used here for visual fidelity.
- API: Application Programming Interface, the backend route contract consumed by the frontend.
- E2E: End-to-End, tests that verify the app through its full runtime path.
- DB: Database, the local SQLite runtime store under the Opencorvus data directory.
- JSON: JavaScript Object Notation, the structured payload format used by artifacts and tool results.
- LLM: Large Language Model, the model driving the agent.
- UI: User Interface, the Overlay and rendered webpage surfaces.
- PID: Process Identifier, the operating system process id that can keep files locked on Windows.
- Zod: TypeScript schema validation library used by runtime result schemas.

## 1. Evidence

The failed task is not a simple frontend or backend test failure.

- G1-G4 passed and produced commits through `b5fd18c66a08`.
- G5 ran integration and E2E tests successfully: 66 tests, 308 assertions, 0 failures.
- G5 visual evidence failed the high-fidelity requirement:
  - `mirror/eval-result.json` reports `overallScore=85`.
  - `ssimScore=0.8139054716236321`.
  - `pixelDiffPercent=12.252237654320988`.
  - The agent recorded an invented 95+ target; the product threshold is now 85/100.
- The build agent result for G5 included a top-level `error` field while also reporting `status="passed"`.
- The executor rejected that result because `BuildResultSchema` did not allow the top-level `error` key.
- The final task/run failure message then overwrote the quality failure with a recovery story:
  - the failed attempt artifact exposed `workspace_dir`.
  - the same failed attempt artifact exposed `workspace_branch=null`.
  - earlier running artifacts and git refs still had `workspace_branch=opencorvus/goal-h6zaz8sj`.
  - therefore the `workspace_dir exists but workspace_branch=null` text is a downstream inference from incomplete failed-attempt metadata, not evidence that the live worktree was structurally broken during G5 execution.

## 2. Root Cause Split

### 2.1 Delivery Quality Root Cause

The rendered clone was not visually close enough to the reference. The artifacts prove the app rendered, dimensions matched, and functional tests passed, but the visual score was too low for acceptance.

The product decision on 2026-05-09 lowers the webpage replica numeric visual threshold to 85/100. Under that contract, this evidence is not a numeric visual-threshold failure. The remaining engine failure is the invalid mixed build result shape: `status="passed"` with a top-level `error`.

### 2.2 Result Protocol Root Cause

The G5 build agent tried to express a mixed result: functional tests passed, visual gate failed. It encoded that as `status="passed"` plus `error="..."`.

That is invalid because the build result contract must have one terminal truth:

- passed means all blocking acceptance gates passed.
- failed means at least one blocking acceptance gate failed, with failure evidence.

The current result boundary allowed the agent to create a semantically contradictory payload and then failed at schema validation.

### 2.3 Failure Reporting Root Cause

After the structured output rejection, recovery attempted to continue the same verification goal. The failed attempt artifact lacked `workspace_branch`, even though the running attempt artifact and local git branch still proved the branch existed.

The orchestrator then treated the missing branch field as a workspace metadata inconsistency and wrote that inferred explanation into `task.error`. That made the final debug output misleading: it hid the primary failure chain of an invented visual target followed by invalid build result shape.

## 3. Immediate Recovery Plan For This Task

Goal: finish this task honestly, without hiding the visual mismatch.

1. Preserve evidence before cleanup.
   - Keep `mirror/reference.png`.
   - Keep `mirror/rendered.png`.
   - Keep `mirror/eval-result.json`.
   - Keep the G5 trace line that records visual failure and schema rejection.

2. Repair the task state path.
   - Do not mark the task passed from the existing G5 result.
   - Recreate or restart the G5 verification attempt from the merged primary commit.
   - Do not use the final `workspace_branch=null` artifact as proof of worktree damage; cross-check running artifacts and git refs first.
   - If a fresh attempt is needed, stop any background Bun/Vite process still running from the old G5 worktree before deleting or reusing that directory.

3. Improve the clone against visual evidence.
   - Compare `reference.png` and `rendered.png`.
   - Prioritize high-impact differences listed by the agent: navigation bar, chart type, sidebar, technical indicators.
   - Re-render after each visual change.
   - Continue until `webpage_evaluate.overallScore >= 85` or record a concrete blocker.

4. Re-run verification.
   - Run integration and E2E tests.
   - Render a fresh screenshot.
   - Recompute visual score.
   - Only pass G5 when functional tests and visual threshold both pass.

## 4. Engine Fix Plan

### Phase A: Make Build Result Semantics Unambiguous

Files to inspect first:

- `packages/opencorvus/src/agent/runner.ts`
- `packages/opencorvus/src/goal/runner.ts`
- result schema definitions for build terminal reports.

Required behavior:

- A blocking acceptance failure must produce `status="failed"`.
- A passed build result must reject any failure-only fields such as `error`.
- A failed build result must require a structured failure reason and evidence references.
- A below-threshold visual case should produce a valid failed build result whose reason is visual threshold failure, not schema rejection.

Tests:

- Build result with `status="passed"` and `error` is rejected at the local terminal tool boundary with a targeted message.
- Build result with `status="failed"` and visual evidence is accepted.
- Mixed functional-pass visual-fail result becomes failed, not passed.

### Phase B: Persist Visual Gate As Verification Evidence

Files to inspect first:

- `packages/opencorvus/src/verification/`
- `packages/opencorvus/src/acceptance/`
- `packages/opencorvus/src/delivery/checks/`
- `packages/opencorvus/src/engine/persist.ts`

Required behavior:

- Visual score must be persisted as structured verification evidence.
- Evidence must include score, threshold, reference path, rendered path, pixel diff, dimensions, and tool verdict if available.
- A failed visual gate must be queryable by retry prompts and task debug info.
- The board should show the visual score failure as the primary G5 reason.

Tests:

- Given `overallScore=84` and threshold `85`, evidence status is failed.
- Given `overallScore=85` and matching dimensions, evidence status is passed.
- Missing judge verdict does not erase numeric visual evidence.

### Phase C: Preserve Workspace Metadata In Failed Attempt Artifacts

Files to inspect first:

- `packages/opencorvus/src/engine/goal-pool.ts`
- `packages/opencorvus/src/goal/runner.ts`
- `packages/opencorvus/src/engine/recovery.ts`
- `specs/new-arch/10-worktree-lifecycle.md`

Required behavior:

- Failed attempt artifacts must preserve the last known `workspace_dir`, `workspace_branch`, and `workspace_base_ref`.
- A final failed artifact must not erase a branch field that was present in the running artifact unless cleanup explicitly cleared both directory and branch together.
- Debug/recovery code must distinguish "artifact omitted field" from "live worktree has no branch".
- Cleanup must stop known child processes before deleting Windows worktrees.

Tests:

- Running artifact with branch followed by failed artifact patch that omits branch still collapses to the prior branch.
- Explicit cleanup can clear both directory and branch together.
- Debug info does not report metadata inconsistency when git branch still exists and prior artifacts had the branch.
- Cleanup failure preserves evidence and reports the locking PID/path.

### Phase D: Stop Masking Root Causes During Final Task Failure

Files to inspect first:

- task/run state update code under `packages/opencorvus/src/engine/`
- protocol event emission around `task.updated` and `run.updated`

Required behavior:

- The task final error should keep a causal chain:
  1. build result schema rejected mixed pass/error payload.
  2. build result schema rejected mixed pass/error payload.
  3. recovery/debug inference saw a failed artifact missing `workspace_branch`.
- The latest recovery failure may be the terminal reason, but it must not overwrite the original product failure.

Tests:

- When a goal fails, then recovery fails, debug info includes both causes.
- Task board summary shows the user-actionable root cause first.
- Run artifact stores structured `causes[]`, not one overwritten error string.

## 5. Visual Remediation Plan

This should be done only after Phase A or with strict manual discipline, otherwise the same invalid result shape can recur.

Implementation loop:

1. Open `mirror/reference.png` and `mirror/rendered.png`.
2. Create a concrete diff checklist:
   - header/nav spacing and colors.
   - stock symbol and price block layout.
   - chart geometry and line/area rendering.
   - axes, gridlines, labels, and legend.
   - right sidebar cards and technical indicator table.
   - cookie banner and bottom controls if present.
3. Fix one visual region at a time.
4. Re-render at 1440x900 after each region.
5. Recompute SSIM and pixel diff.
6. Stop only at 85+ or after recording an explicit impossible-condition finding.

Rules:

- Do not lower the visual threshold silently.
- Do not mark visual judge tool failure as visual pass.
- Do not use functional tests as a substitute for screenshot comparison.

## 6. Acceptance Criteria

This plan is complete only when all of the following are true:

- G5 can fail with a valid failed result, without schema rejection.
- G5 can pass only when integration tests and visual score both pass.
- Task debug info shows the causal chain instead of replacing visual failure with a workspace cleanup error.
- Failed attempt artifact persistence does not erase known workspace branch metadata.
- Windows cleanup reports locking process evidence when it cannot remove a worktree.
- The webpage replica task reaches score 85+ or remains honestly failed with visual evidence.

## 7. Non-Goals

- Do not add a fallback visual threshold.
- Do not treat `webpage_vision_judge` schema failure as a pass.
- Do not migrate historical DB rows; reset/recreate local DB if schema changes are needed.
- Do not introduce a CLI import/export path for this workflow. Overlay remains the product entrypoint.
