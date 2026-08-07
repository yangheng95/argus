# No-Diff Source-Row Goal Repair

## Recall

- User request: investigate why many goals failed in task `tsk_f23716d3a001lK6hSsORXQhtFg`, explain why the recent repair was incomplete, fix the root cause, then run the WSL build and upload the baseline bundle.
- Attached task debug evidence: many failed or empty goals are titled as `source row` / `visual source row`; several preceding goals show `status=passed`, `changedFiles=0`, and `build_attempt_outcome=no_project_diff`.
- Acceptance criteria: a Build attempt that completes with `no_project_diff` must not satisfy downstream dependency dispatch; frontend-replica Architect guidance must not register raw evidence rows as Build goals; regression tests must cover both paths; WSL build and baseline upload must run after the fix.
- Hard constraints read: `AGENTS.md` no fallback/compat, no blind patches, host is source-of-truth, WSL only runs synchronized source; `specs/current/architecture/18-webpage-replica-agent-workflow.md`; `specs/records/2026-07/2026-07-02-frontend-replica-workflow-goal-discipline.md`; `specs/records/2026-07/2026-07-02-goal-scaffold-false-green-cascade.md`; `specs/records/2026-07/2026-07-02-direct-build-current-worktree.md`; `specs/records/2026-07/2026-07-02-optional-build-worktree-schema.md`.
- Full-repo grep results: `deriveGoalStatus` only projected from the goal-run chain tip; `finalizeBuildAttempt` writes `build_attempt_outcome` after the terminal goal-run append; `goalDependencyDispatchState` only read `goalStatusByID`; frontend-replica prompts used ambiguous `source component or meaningful source region per goal` wording; tests already asserted that text.

## Corrected Causal Analysis

The task debug dump proves two observable facts:

1. many terminal goals have titles ending in `source row` / `visual source row` and no changed files;
2. several prerequisite-looking goals reached lifecycle `passed` while their Build artifact outcome was `completed/no_project_diff` with `actual_changed_files_empty`.

The dump alone does **not** prove that "Architect turned raw evidence rows into Build goals" was the direct cause of the failures. That wording was an overclaim: goal titles and row-like labels are classification evidence, not causal proof. To prove the direct cause for each failed goal, the runtime database would need the goal-run terminal error payloads, Build prompt/context, dependency graph, and decision-log entries from `/root/.local/share/opencorvus/data/opencorvus.db`.

The code-level defect that is proven locally is narrower and still real: Build dependency dispatch consumed only the goal lifecycle projection (`goalStatusByID(...) === passed`) and ignored the Build deliverable outcome. Therefore a prerequisite goal with `completed/no_project_diff` could satisfy downstream dependency dispatch even though it delivered no project diff and wrote no acceptance artifact. This can turn a non-delivery into downstream work and makes later failures harder to localize.

The prompt/skill change is a preventive modeling constraint, not proof of the historical direct trigger: frontend-replica Build goals should represent user-visible components or source-backed regions with target files and acceptance proof. Source rows, visual-source rows, style-profile rows, DOM records, and evidence-table rows are evidence inputs unless separately proven to map to such an implementation surface.

## Repair Plan

1. Keep goal-run lifecycle projection unchanged: `completed` remains the lifecycle status and manual `complete_goal` semantics stay intact.
2. Refine dependency dispatch: if the supersede tip has a Build outcome and that outcome is not `delivered`, downstream Build is blocked with the concrete outcome and no-diff reason.
3. Strengthen frontend-replica skill and prompt overlays as a preventive constraint: Build goals must be user-visible components/regions with target implementation files and acceptance proof; source rows, visual-source rows, style-profile rows, DOM records, and evidence-table rows are evidence inputs only unless explicitly mapped to such an implementation surface.
4. Add regression coverage for Build no-diff dependency blocking and prompt wording.

## Verification Plan

- `bun test packages/opencorvus/test/engine/start-new-attempt.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 120000`
- `bun run --cwd packages/opencorvus typecheck`
- Sync once to WSL, run `bun run package:linux-binary`, copy Linux artifacts back to Windows, verify hashes, upload `opencorvus-bundle.tar.gz`.
