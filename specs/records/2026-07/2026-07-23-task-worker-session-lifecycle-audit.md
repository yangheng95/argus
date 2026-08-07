# Task-worker session lifecycle audit

Date: 2026-07-23

Status: Implemented and verified

## Recall

### User requirement

Generalize the Goal-scoped research session repair and inspect the other projected agents for the same class of session ownership, scope binding, continuation, and blocking defects.

### Acceptance criteria

- Enumerate every production `runAgentSession` and `runAgentSessionWithRetry` caller, every adjacent `Session.createNext`, `Session.get`, and `existingSessionID` use, and every stage continuation callback.
- Distinguish a real duplicate fresh-session owner from legitimate retry/continuation ownership using code and runtime evidence rather than agent names or titles.
- Query persisted runtime failures for kind, Goal identifier (ID), directory, and projected-worker identity mismatch evidence across all agents.
- Preserve the shared runner as the single fresh-session owner for ordinary task workers and retain only evidence-backed exceptions.
- Add a repository regression that fails if another ordinary worker wrapper begins pre-creating fresh sessions or drops explicit `workScope` forwarding.
- Run focused agent infrastructure tests, the earlier Goal-scoped research regression, TypeScript checks, documentation health checks, and a final diff review.

### Hard constraints

- Do not weaken the shared runner's existing-session validation or add a fallback, compatibility path, host gate, state machine, or keyword-based runtime routing rule.
- Do not restart or otherwise disturb the running OpenCorvus or Overlay process.
- Preserve and exclude the unrelated user modification in `2026-07-22-mirror-prism-full-workflow-distillation.md`.
- Dead-code removal requires prior user notice. The audit may identify an unused surface, but it must not silently delete it.
- Commit subjects use `dsw-33987`; delivery is pushed from the current main worktree to `legacy-remote/v0.0.16beta`.

### Evidence read

- The production caller inventory contains ordinary thin wrappers for Architect, Delegated Worker, Explore, Fact Check, Frontend Design, Goal Workload Analyst, Integrity, Intent Analysis, Requirements, Research, and Visual Quality Assurance (QA), plus the Build-specific wrapper.
- Every ordinary wrapper except the repaired shared research wrapper already delegates fresh session creation directly to `runAgentSession` and forwards `workScope` unchanged.
- The shared research wrapper now loads a session only for explicit continuation and otherwise lets the runner create the Goal-bound session.
- Build intentionally resolves its worktree and goal-run identity before runner entry, creates the session with exact kind, project, Goal, and directory fields, repeats those validations locally, and supplies the exact directory and runtime attempt contract to the runner. It is not the defective research shape.
- The runtime database contains six persisted adapter startup failures with an `existing session ... goalID=<unset>` mismatch. All six are `mirror-prd-general-researcher` through `frontend_research`; no other adapter has the same persisted mismatch evidence.
- The runner itself publishes terminal `session.status` on in-run success or failure. Research stage terminalization is an outer convergence path for a persisted session that fails before the runner's protected execution boundary; terminal status has a process-wide first-terminal-wins latch.
- `ExploreAgent.RunInput.existingSessionID` has no production or test caller outside its own interface and forwarding line. It is a dead direct-reopen surface distinct from protocol continuation; deletion requires explicit user notice and is excluded from the current regression-only change.
- The existing infrastructure test still asserted the retired `frontendDesignBuildVisualHandoff` helper name even though the production owner is now `frontendDesignVisualHandoffProjection` with structured visual-handoff projection. The audit exposed and aligned this stale assertion without changing production behavior.

### Full-repository call-site inventory

| Surface                                                                                                                                                                                                                                      | Disposition                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/opencorvus/src/agent/runner.ts`                                                                                                                                                                                                    | Retain as the ordinary fresh worker-session owner and exact kind, Goal, directory, projected identity, descriptor, and continuation validator.                                                               |
| `architect/agent.ts`, `delegated-worker/agent.ts`, `fact-check/index.ts`, `frontend-design/agent.ts`, `goal-workload-analyst/agent.ts`, `integrity/team-agent.ts`, `intent-analysis/agent.ts`, `requirements/agent.ts`, `visual-qa/agent.ts` | Retain direct runner ownership; verify each forwards `workScope` and contains no private fresh `Session.createNext`.                                                                                         |
| `research/agent.ts` serving deep-research and frontend-research                                                                                                                                                                              | Retain the repaired split: fresh work is runner-owned; explicit continuation alone resolves and forwards an existing session.                                                                                |
| `build/agent.ts`                                                                                                                                                                                                                             | Retain the documented specialized owner because worktree and goal-run attempt identity must exist before the runner installs its runtime contract; verify exact Goal creation and validation remain present. |
| `explore/agent.ts`                                                                                                                                                                                                                           | Retain fresh runner ownership. Record its unused `existingSessionID` interface as dead-code follow-up requiring user-approved deletion; do not broaden it into continuation.                                 |
| Orchestrator adapter modules                                                                                                                                                                                                                 | Retain `runnerSessionID` capture from the runner observer and explicit continuation session initialization; no adapter pre-creates an ordinary worker session.                                               |
| `tool/delegate-agent.ts`                                                                                                                                                                                                                     | Exclude from task-worker runner ownership: it is an explicitly session-local Coding/Chat child using `SessionPrompt` directly and creates no engine Task or Goal.                                            |
| `packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts`                                                                                                                                                                 | Add one exhaustive source inventory regression for ordinary owner files, the research continuation-only exception, and Build's exact specialized contract; align the stale Frontend Design handoff assertion with its current production owner. |
| `packages/opencorvus/test/agent/runner-base-template.test.ts` and `packages/opencorvus/test/research/agent-runtime-root.test.ts`                                                                                                             | Retain the behavioral proof that the runner creates exact Goal-bound sessions and research fresh/continuation ownership stays separated.                                                                     |
| `specs/README.md` and `specs/records/2026-07/README.md`                                                                                                                                                                                      | Index this audit record in both documentation sources.                                                                                                                                                       |

### Independent agent feedback

No independent agent was requested or used. The primary agent performs the second review from the complete call-site inventory, persisted runtime evidence, behavioral tests, type checking, and scoped diff inspection.

## Causal classification

The repaired frontend-research failure was systemic in mechanism but isolated in implementation: only the shared research wrapper duplicated fresh session creation, and both deep-research and frontend-research used that wrapper. The other ordinary worker agents already followed the intended thin-shell design, so copying the research patch into them would create unnecessary code and a second lifecycle source. Build resembles the old shape syntactically but differs causally: it writes the exact Goal and directory, validates them before side effects, and requires a pre-run goal-run identifier in the runtime contract. Persisted failure evidence supports only the research defect.

The durable prevention is an architecture regression over the exhaustive runner-caller inventory, combined with the existing behavioral runner and research tests. This catches a future wrapper-level `Session.createNext` before it can manufacture an "existing" session with incomplete scope while avoiding a host runtime gate.

## Implementation plan

1. Add a complete ordinary-worker ownership inventory to the existing sub-agent infrastructure homogeneity suite.
2. Assert every ordinary runner wrapper forwards exact `workScope` and does not create a fresh session privately.
3. Assert research resolves an existing session only for explicit continuation and Build retains its exact specialized Goal/directory contract.
4. Run the infrastructure, runner, research, and orchestrator adapter regressions; then run type checking and documentation health.

## Validation ledger

- `bun test packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts`: 31 passed, 0 failed, 394 expectations.
- `bun test --timeout 0 packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts packages/opencorvus/test/agent/runner-base-template.test.ts packages/opencorvus/test/research/agent-runtime-root.test.ts packages/opencorvus/test/orchestrator/tools.test.ts`: 177 passed, 0 failed, 1,632 expectations.
- `bun run typecheck`: 9 tasks succeeded; the `opencorvus` package ran uncached.
- `bun run docs:check`: 287 operations across 23 groups passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`: 82 passed, 0 failed, 1,362 expectations after the concurrently authored Orchestrator record was included in an isolated alternate index. The live shared index otherwise reported 81 passed and only that unrelated untracked record link as the single failure; this audit's record and both index links were already tracked in the staged set.
- Final scoped diff review confirms this audit changes only the architecture regression, the stale handoff assertion, this record, and its two documentation index entries. Concurrent Orchestrator and user-owned Mirror Prism changes remain excluded.
