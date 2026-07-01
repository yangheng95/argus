# Visual QA Feedback Consumption Chain

Date: 2026-07-01

## Recall

User request:

- Continue fixing the system after the Integrity report-only boundary repair.
- Personally investigate whether Integrity and Visual QA feedback is correct,
  transported correctly, and consumed correctly.
- Explain why repairs looked like no repair happened and why visual quality
  remains poor, then continue deep repair from that investigation.

Acceptance criteria:

- Visual QA feedback must be a first-class Build context channel, not hidden
  inside acceptance feedback.
- Build prompt rendering must make failed Visual QA reports explicit repair
  instructions with DOM, blocker, and screenshot-evidence follow-up semantics.
- Same-session Build retries must still receive persisted Visual QA failure
  facts.
- Task-level direct rework after Visual QA / Integrity must receive active
  requirements, not only free-form request text and review snippets.
- Integrity remains report-only lifecycle evidence; workflow projection must
  not present Integrity non-pass as a task completion gate.
- No fallback, no dual-source feedback, no hidden host gate, no broad rewrite.

Hard constraints:

- Preserve the dirty worktree; do not revert unrelated user or prior-agent
  changes.
- Current worktree only; no new worktree.
- Every code change needs focused tests.
- Specs stay in `specs/records/2026-07/` and must be indexed.

Sources read:

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/benchmark-debug-template/SKILL.md`
- `specs/records/2026-07/2026-07-01-integrity-report-only-completion-boundary.md`
- `specs/records/2026-06/2026-06-30-visual-qa-problem-dom-report.md`
- `specs/current/architecture/09-verification-evidence.md`
- `specs/current/architecture/13-agent-communication-matrix.md`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/build/agent.ts`
- `packages/opencorvus/src/build/prompt-context.ts`
- `packages/opencorvus/src/prompt/core/build-core.txt`
- `packages/opencorvus/test/orchestrator/build-feedback-context.test.ts`
- `packages/opencorvus/test/build-agent/prompt-context.test.ts`
- `packages/opencorvus/test/orchestrator/tools.test.ts`

Whole-repository search evidence:

- `rg -n "visual_qa|integrity|acceptance_rejection|needs_correction|required_repairs|production_blockers|unresolved_code_module_problems|build_retry_previous|phasePromptSection|DecisionLog" packages/opencorvus/src packages/opencorvus/test -g "*.ts" -g "*.txt"`
- `rg -n "renderVisualQaProblemDomFeedback|latestFailedVisualQaDecisionRecord|VisualQaDecisionRecordSchema|visualQaFeedback|visual qa.*build|Build repair" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`
- `rg -n "composeLatestAcceptanceFeedbackForBuild|Visual QA feedback|visualQaFeedback|acceptanceFeedback|requirements.*context|capturedContext" packages/opencorvus/test/orchestrator packages/opencorvus/test/build-agent packages/opencorvus/test -g "*.ts"`
- `rg -n "renderIntegrityFeedback|Persistent Integrity|integrityBlocking|buildIntegrityRootHistory|requiredRepairs|repair_report" packages/opencorvus/src/orchestrator/tools.ts packages/opencorvus/src/build packages/opencorvus/test -g "*.ts"`

Independent agent feedback:

- None spawned for this continuation. The user explicitly asked "亲自调查链路";
  this record preserves main-agent evidence instead of inventing delegation.

## Findings

Visual QA production blockers and `problem_dom_regions` are persisted under
`decision_log phase=visual_qa report_*`, and
`renderVisualQaProblemDomFeedback()` can render useful repair facts: blocker
IDs, selectors, HTML excerpts, computed style, code-search terms, bbox, route,
viewport, and evidence refs.

The transmission bug is ownership of the channel. The renderer is currently
called from `composeLatestAcceptanceFeedbackForBuild()`, so failed Visual QA is
smuggled into the Build context as `acceptanceFeedback`. Build then labels it
as an "Acceptance Repair Overlay". That makes the feedback weaker and
conceptually wrong: Visual QA is a peer review report, not an acceptance
verdict.

The consumption bug is worse on task-level direct rework. When Orchestrator
chooses `build({ request, directBuildIntent:"modify_files" })` after Visual QA
or Integrity, the direct Build context currently gets frontend design,
frontend research, visual specs, integrity feedback, and acceptance feedback,
but not the active REQ rows. The Build agent may therefore repair a screenshot
symptom without the original product / replica requirements that should govern
the whole surface.

Integrity still has one projection leak: workflow projection uses
`integrityAttemptVerdict()` to project non-pass Integrity as a failed step.
That is not task terminal authority, but it keeps presenting report evidence
as a failure state rather than an advisory review report state. This must be
cleaned up with tests.

## Decision

Split Visual QA feedback into its own Build context field:

- `visualQaFeedback` in `BuildContext` and `BuildPromptOverlayContext`.
- `composeLatestVisualQaFeedbackForBuild()` reads the latest failed Visual QA
  decision-log report.
- `composeLatestAcceptanceFeedbackForBuild()` returns only acceptance rejection
  feedback.
- Build prompt renders a `Visual QA Repair Overlay` with component-truth,
  DOM-first repair pointers, and fresh screenshot/comparison proof semantics.
- Same-session retry prompt includes `visualQaFeedback` as persisted failure
  facts, not as an acceptance packet.

Direct task-level Build rework must include active requirements from the
current spec snapshot. This is not a fallback path; it is the same requirements
truth already used by goal builds, rendered by the existing Build prompt
section for direct requests.

Workflow Integrity projection should report an Integrity attempt as completed
once any current post-build report exists. Non-pass content remains available
in the report artifact and decision log for Orchestrator to consume; the
workflow progress row must not imply a lifecycle gate.

## Planned Validation

- Focused Build prompt context tests.
- Focused Orchestrator feedback composition tests.
- Targeted Orchestrator build context tests for direct rework requirements and
  Visual QA feedback injection.
- Workflow Integrity projection tests.
- `git diff --check`.

## Implementation Notes

- Added `visualQaFeedback` as a first-class Build context field.
- Added `composeLatestVisualQaFeedbackForBuild()` and removed Visual QA report
  concatenation from `composeLatestAcceptanceFeedbackForBuild()`.
- Rendered failed Visual QA reports under `Visual QA Repair Overlay` instead of
  `Acceptance Repair Overlay`.
- Kept same-session Build retry feedback able to carry persisted Visual QA
  failure facts.
- Injected active requirements into task-level direct Build rework context.
- Changed workflow Integrity projection so the post-build review step is
  completed once a current report artifact exists; pass / non-pass content
  remains report evidence for Orchestrator decisions.
- Removed build-core wording that said `problem_dom_regions` can arrive through
  acceptance feedback.

## Validation Results

- `bun test packages/opencorvus/test/build-agent/prompt-context.test.ts packages/opencorvus/test/orchestrator/build-feedback-context.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/build-agent/prompt-goal-discipline.test.ts packages/opencorvus/test/engine/workflow-integrity-step.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "workflow task-level direct build receives active requirements and Visual QA feedback" --timeout 120000`
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --timeout 180000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 60000`
- `git diff --check`

Static residual checks:

- `renderVisualQaProblemDomFeedback()` is only consumed through
  `composeLatestVisualQaFeedbackForBuild()`.
- No `integrityAttemptVerdict` import remains in workflow or orchestrator tools.
- No current build prompt text says acceptance feedback owns Visual QA
  `problem_dom_regions`.
