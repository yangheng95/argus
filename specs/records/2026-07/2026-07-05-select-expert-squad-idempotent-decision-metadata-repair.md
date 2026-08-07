## Recall

- User request:
  - `先修复上述的明确问题`
- Acceptance criteria:
  - `select_expert_squad` must be idempotent when the requested `profile_id` is already active.
  - Same-profile reselection must not write decision log entries, mutate overlay state, or dispatch a continuation wake.
  - Orchestrator decision-effect classification must stop relying on a separate central whitelist for `select_expert_squad` and similar scheduler tools.
  - Tests must prove both the no-op reselection behavior and the corrected decision-effect metadata behavior.
- Hard constraints:
  - No fallback or compatibility path.
  - No hidden gate or second active expert-squad source.
  - Do not revert unrelated dirty workspace changes.
  - Any code change must ship with focused tests.
- Sources read before implementation:
  - `AGENTS.md`
  - `specs/records/2026-07/README.md`
  - `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md`
  - `specs/records/2026-07/2026-07-05-build-prompt-worktree-gitignore-single-source-repair.md`
  - `packages/opencorvus/src/orchestrator/tools.ts`
  - `packages/opencorvus/src/orchestrator/agent.ts`
  - `packages/opencorvus/src/orchestrator/stateful-tool-names.ts`
  - `packages/opencorvus/test/orchestrator/tools.test.ts`
  - `packages/opencorvus/test/orchestrator/no-decision-stop.test.ts`
  - `packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts`
- Whole-repository search evidence:
  - `rg -n "decisionEffectForTool|ORCHESTRATOR_DECISION_EFFECT_METADATA_KEY|withDecisionEffectMetadata|decisionControlTools|select_expert_squad|no-op|same profile|already using that profile" packages/opencorvus/src packages/opencorvus/test -g "*.ts" -g "*.txt"`
  - `rg -n "question: tool\\(|propose_task: tool\\(|complete_task: tool\\(|inject_operator_message: tool\\(|respond_agent_coordination: tool\\(|cancel_subagent: tool\\(" packages/opencorvus/src/orchestrator/tools.ts`
  - `rg -n "tools\\(|prompts\\(|resources\\(|serverTools\\(|serverPrompts\\(|serverResources\\(" packages/opencorvus/src/mcp packages/opencorvus/src/expert-squad -g "*.ts"`
- Independent-agent feedback:
  - No new subagent was used for this slice.
  - Prior review already isolated two concrete issues:
    - `select_expert_squad` same-profile reselection still behaved like a real decision;
    - decision-effect ownership was split between tool behavior and the central `decisionControlTools` whitelist.

## Root Findings

1. `select_expert_squad` violates its own prompt contract.
   - The core prompt already says not to call it when the root session is already using that profile.
   - The implementation still merges the same overlay, appends a decision log row, and dispatches a continuation wake.

2. `decisionControlTools` is a second source for scheduler decision semantics.
   - `withDecisionEffectMetadata()` already owns tool-result metadata projection.
   - A separate central whitelist can silently disagree with the real tool behavior and reintroduce false-positive decision classification.

3. Not every scheduler tool needs explicit decision metadata.
   - Tools that mutate task rows, interaction rows, cron rows, or artifacts already surface a task-signature change.
   - The repair should add explicit metadata only where task-signature diff is insufficient or branch-dependent.

## Repair Plan

1. Make `select_expert_squad` return an explicit `none` decision effect when the requested profile is already active and skip all side effects in that branch.
2. Make successful `select_expert_squad` writes return explicit `decision` metadata from the tool itself.
3. Remove the `decisionControlTools` fallback list and make the wrapper respect an explicitly returned `orchestratorDecisionEffect` before falling back to task-signature inference.
4. Add focused tests for:
   - same-profile `select_expert_squad` no-op;
   - `inject_operator_message` staying `none`;
   - successful `propose_task` still surfacing `decision`;
   - no-decision classification rejecting same-profile reselection wakes.

## Validation Plan

- `bun test --timeout 30000 packages/opencorvus/test/orchestrator/tools.test.ts`
- `bun test --timeout 30000 packages/opencorvus/test/orchestrator/no-decision-stop.test.ts`
- `bun test --timeout 30000 packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`
