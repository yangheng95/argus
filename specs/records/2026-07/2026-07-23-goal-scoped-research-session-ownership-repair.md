# Goal-scoped research session ownership repair

Date: 2026-07-23

Status: Implemented and verified

## Recall

### User requirement

Repair the defect that made a newly dispatched Goal-scoped frontend-research worker fail as an allegedly "existing session" with `goalID=<unset>` and thereby block the fixed Mirror Product Requirements Document (PRD) workflow.

### Acceptance criteria

- A fresh deep-research or frontend-research worker session is created by the shared agent runner with the exact Goal identifier (ID) derived from `workScope`.
- Research continuation reopens the exact persisted session and retains collector hydration and strict session identity validation.
- The stage observer receives the fresh session ID only after the runner has installed the projected worker descriptor and runtime contract.
- The strict existing-session kind, Goal, directory, and projected-identity checks remain unchanged.
- A regression test covers fresh Goal-scoped research dispatch ownership; continuation behavior and the shared runner's Goal binding remain covered.
- Focused tests, TypeScript checks, document-health checks, and a final diff review pass before the repair is committed and pushed to `legacy-remote/v0.0.16beta`.

### Hard constraints

- Fix the single session-creation owner; do not add a fallback, compatibility path, empty-Goal bypass, host gate, or state machine.
- Do not restart or otherwise disturb the running OpenCorvus or Overlay process.
- Preserve and exclude the unrelated user modification in `2026-07-22-mirror-prism-full-workflow-distillation.md`.
- Use commit subject prefix `dsw-33987` and deliver from the current main worktree.

### Evidence read

- Runtime database evidence shows failed session `ses_073892a1bffe7kPUWLWwxzHAwq` was created at the same instant as the failed dispatch, with `kind=frontend-research` and no `goal_id`; it was not an old session.
- The visible tool result reports `existing session ses_073892a1bffe7kPUWLWwxzHAwq has goalID=<unset>, expected gol_f8af3923b0017d7Czk61xLlX15`.
- `research/agent.ts` created a fresh session without `goalID`, then passed it to `runAgentSession` as `existingSessionID`.
- `agent/runner.ts` correctly derives Goal ownership from `workScope`; it creates fresh sessions with that Goal ID and strictly rejects mismatched existing sessions.
- The Mirror PRD workflow makes asset, User Interface (UI), and User Experience (UX) research depend on general research and makes authoring depend on that complete evidence set, so the deterministic adapter failure blocks dependent nodes.
- Current research runtime tests mock `runAgentSession` and exercise task scope, which leaves both created and expected Goal IDs empty and misses the real mismatch.

### Full-repository call-site inventory

| Surface                                                           | Disposition                                                                                                                                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/opencorvus/src/research/agent.ts`                       | Remove fresh session precreation. Resolve a persisted session only for explicit continuation; pass no `existingSessionID` for fresh work; adapt the public ID observer to the runner-owned session observer. |
| `packages/opencorvus/src/agent/runner.ts`                         | Retain unchanged as the sole fresh worker-session creator and strict existing-session validator.                                                                                                             |
| `packages/opencorvus/src/frontend-research/agent.ts`              | Retain unchanged; it delegates to the shared research session implementation.                                                                                                                                |
| `packages/opencorvus/src/orchestrator/frontend-research-stage.ts` | Retain unchanged; its `onSessionCreated` callback records the runner-created session for ownership and failure evidence.                                                                                     |
| `packages/opencorvus/src/orchestrator/deep-research-stage.ts`     | Retain unchanged; it shares the corrected research lifecycle.                                                                                                                                                |
| `packages/opencorvus/src/build/agent.ts`                          | Retain unchanged; Build intentionally owns retry session creation and passes a validated existing session under a separate retry contract.                                                                   |
| `packages/opencorvus/test/research/agent-runtime-root.test.ts`    | Add fresh Goal-scoped forwarding and observer regression assertions; strengthen continuation assertions for exact existing-session reuse.                                                                    |
| `packages/opencorvus/test/agent/runner-base-template.test.ts`     | Add a behavioral regression proving the shared runner creates a fresh Goal-scoped session with the exact Goal ID.                                                                                            |
| `packages/opencorvus/test/orchestrator/tools.test.ts`             | Retain existing adapter failure-message and persisted-session terminalization coverage; its frontend-research agent is mocked and cannot replace the real runner regression.                                 |
| `specs/README.md` and `specs/records/2026-07/README.md`           | Index this repair record as the documentation single source.                                                                                                                                                 |

### Independent agent feedback

No independent agent was requested or used. The primary agent will perform the required second review using runtime evidence, focused behavioral tests, type checking, and final diff inspection.

## Causal chain

The observable failure said an "existing session" had no Goal ID. The session was actually created by the research wrapper moments earlier. The wrapper omitted Goal ownership, then handed the row to the shared runner as an existing session. The runner derived the exact Goal from the dispatch work scope and correctly rejected the mismatch before model contact. Because the selected manifest workflow requires terminal-success evidence from general research before several downstream nodes, the deterministic startup failure became a workflow blocker. The validation is not the defect; duplicate fresh-session ownership is.

## Implementation plan

1. Make `runAgentSession` the only fresh research worker-session creator and preserve explicit continuation loading solely for collector replay.
2. Bridge the research stage's session-ID callback through the runner's post-runtime-install observer boundary.
3. Add fresh Goal-scope ownership and continuation-reuse regressions across the research wrapper and shared runner.
4. Run focused research/runner/orchestrator tests, TypeScript checks, historical-doc and document-health checks, then review the complete scoped diff.

## Validation ledger

- `bun test --timeout 0 packages/opencorvus/test/research/agent-runtime-root.test.ts packages/opencorvus/test/agent/runner-base-template.test.ts packages/opencorvus/test/frontend-research/agent.test.ts`: 20 passed with 118 expectations.
- `bun test --timeout 0 packages/opencorvus/test/frontend-research/agent.test.ts packages/opencorvus/test/orchestrator/tools.test.ts`: 136 passed with 1,172 expectations, including frontend-research startup failure visibility and persisted-session terminalization.
- `bun run typecheck`: 9 package checks passed; the changed OpenCorvus package was checked without cache.
- `bun run docs:check`: passed with 287 operations across 23 groups.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`: 82 passed with 1,362 expectations after the record and both canonical indexes were staged.
- Final diff review confirms fresh research no longer pre-creates a session, explicit continuation remains the only existing-session path, strict runner validation is unchanged, and the unrelated user document edit remains unstaged.
