# Task Follow-up Orchestrator Model Convergence

Status: Verified
Date: 2026-08-04
Owner: Codex

## Recall

### User requirement

- Investigate and repair why sending `继续` to Task
  `tsk_fcab91da5001Z3edQ8jmOZU13J` did not resume productive execution.
- Exclude the operator's later explicit cancellation from the causal diagnosis.

### Acceptance criteria

- A Task follow-up carrying a newly selected Composer model persists that model
  on the Task root Session before wake admission.
- The next Orchestrator model Turn uses that exact current root-Session model,
  including when the durable Orchestrator child Session already contains an
  older user Turn with a different model.
- Projected worker continuation keeps its existing immutable runtime-model
  contract; ordinary Chat, Work, Mission, and coding Session model selection is
  unchanged.
- Focused positive non-User-Interface tests reproduce the historical-model
  override and prove the repaired current-model result.
- OpenCorvus typecheck and documentation health checks pass, followed by an
  independent exact-diff review.

### Hard constraints

- Do not modify the production database or restart/stop the running OpenCorvus
  or Overlay process.
- Do not add model fallback, automatic provider substitution, retry gates,
  keyword routing, compatibility readers, or a second model source.
- Keep root Session `metadata.configOverlay.model` plus `EffectiveConfig` and
  the canonical agent-model resolver as the only Task model authority.
- Do not add, modify, update, or run User Interface automation tests.
- Preserve the unrelated local modification in
  `packages/opencorvus/src/skill/builtin-payload.ts`.
- Commit subjects begin with `dsw-33987`; push only to `myhexin/v0.0.30beta`.

### Sources read

- Root `AGENTS.md`.
- OpenCorvus debug-evidence Skill and `references/evidence-surfaces.md`.
- Read-only public Task/status/board/trace responses and SQLite rows for the
  supplied Task, Task root Session, Mission Session, Orchestrator Session,
  message Parts, Protocol Events, and queued-wake Artifacts.
- `specs/current/architecture/06-provider.md`.
- `specs/current/architecture/15-agent-facts-and-turns.md`.
- `specs/records/2026-06/2026-06-09-task-agent-model-context.md`.
- `specs/records/2026-06/2026-06-10-task-config-overrides-immediate-effect.md`.
- `specs/records/2026-08/2026-08-02-session-scoped-composer-model-repair.md`.
- `specs/records/2026-08/2026-08-04-terminal-task-stale-operator-wake-reopen-incident.md`.
- `specs/records/2026-08/2026-08-04-task-lifecycle-session-closure-system-repair-plan.md`.
- `packages/opencorvus/src/task-api/index.ts`.
- `packages/opencorvus/src/orchestrator/agent.ts`.
- `packages/opencorvus/src/session/loop.ts`.
- `packages/opencorvus/src/session/runtime-contract.ts`.
- `packages/opencorvus/src/agent/model.ts`.
- Existing model-overlay, Orchestrator Session-reuse, Task-message route, and
  Session runtime-contract tests.

### Whole-repository search

Repository searches covered every `resolveAgentModel`,
`resolveAgentModelRef`, `EffectiveConfig.effective`, `mergeConfigOverlay`,
`handleTaskMessage`, `SessionPrompt.loop`, `lastUser.model`, and
`projected-scheduler` call site.

| Surface                       | Evidence                                                                                                                                             | Disposition                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Task follow-up ingress        | `handleTaskMessage()` validates and persists the selected model before recording and waking the root message.                                        | Preserve as the sole write boundary.                         |
| Orchestrator first Turn       | `Orchestrator.processInvocation()` resolves the current root Session model and supplies it to `SessionPrompt.prompt()`.                              | Preserve.                                                    |
| Orchestrator continued Turn   | `SessionPrompt.loop()` currently passes the child Session's historical `lastUser.model` as `explicitModel`, which outranks the current root overlay. | Replace only for the `projected-scheduler` runtime identity. |
| Projected worker continuation | The same loop branch resolves the exact projected-worker runtime and intentionally supplies the worker Turn's persisted model.                       | Preserve unchanged.                                          |
| Ordinary Sessions             | Non-projected Session continuation uses the visible latest user message's explicit model.                                                            | Preserve unchanged.                                          |
| Runtime identity              | `SessionRuntimeContract.identity.identityKind` already distinguishes `projected-scheduler` from `projected-worker`.                                  | Reuse; add no state or schema.                               |

### Independent agent feedback

- None. The user did not request sub-agents or parallel review. The required
  final exact-diff review was completed by Codex; the user explicitly directed
  that Claude Code not be called.

## Durable incident evidence

- The `继续` root message persisted model `openai/gpt-5.6-luna` at
  `2026-08-04T05:45:17.571Z`.
- The Task root Session's effective config and durable overlay both resolve to
  `openai/gpt-5.6-luna`.
- The accepted operator wake was recorded as `started` and the queued ingress
  was later marked `drained`.
- The reused Orchestrator Session nevertheless emitted its next `llm_request`
  with `hexin/gpt-5.6-sol` and received HTTP 429.
- The later operator cancellation is a subsequent terminal transition and is
  excluded from this repair's causal boundary.

## Causal chain

1. The Composer selected Luna and Task ingress durably committed Luna.
2. The wake reused the Task's durable Orchestrator child Session.
3. Because that child already had a user Turn, Orchestrator called
   `SessionPrompt.loop()` instead of `SessionPrompt.prompt()`.
4. Session Loop resolved the next model with
   `explicitModel: lastUser.model`; that historical child user Turn still
   named Hexin.
5. `resolveAgentModelRef()` correctly gives an explicit per-call model higher
   precedence than the current Task root overlay, so it returned Hexin.
6. The continued Turn hit the exhausted Hexin quota even though the current
   Task model authority was Luna.

The resolver is behaving according to its input contract. The defect is that
Session Loop supplies a historical explicit model for a projected scheduler
whose current model authority belongs to the Task root Session.

## Implementation plan

1. Add a focused Session-loop/Orchestrator continuation regression that starts
   an Orchestrator child on model A, changes the Task root overlay to model B,
   and positively asserts the next continued model Turn uses model B.
2. In the single Session Loop model-resolution block, resolve
   `projected-scheduler` from the current root Session config without supplying
   historical `lastUser.model` as an explicit override.
3. Preserve the existing projected-worker and ordinary-Session branches.
4. Update current Provider architecture wording to record the scheduler
   continuation authority.
5. Run the focused regression, adjacent Session/runtime and Orchestrator reuse
   suites, OpenCorvus typecheck, required documentation checks, and
   `git diff --check`.
6. Review the full diff, obtain a read-only Claude Code review, resolve every
   finding, commit only task-owned files, fetch/converge, and push to git-cc.

## Implementation progress

- Added a production-shaped positive regression with a Task root model of
  `mock-control/current` and a reused Orchestrator history model of
  `mock-control/historical`.
- Before the product change, the regression reached the model Turn and failed
  because the actual model was `historical`.
- Session Loop now resolves `projected-scheduler` from the current root Session
  without passing the historical child message as an explicit override.
- The same regression now passes with the actual model `current`.
- Updated the runtime-contract test helper to supply the now-required resolved
  package revision, matching the current scheduler runtime contract.

## Verification

- The new regression failed before the repair with actual model `historical`
  and passes after the repair with actual model `current`.
- All seven `runtime-contract-wake` cases pass when isolated. Running the whole
  file in one Windows process exposed an existing inter-case process-supervisor
  cleanup race around temporary Git children; two runs failed at different
  cases before their product assertions, while every case passed in its own
  process.
- `session-reuse.test.ts`: 4 passed.
- `task-message-routes.test.ts`: 24 passed.
- OpenCorvus TypeScript typecheck passed.
- Historical-links, document-health, and product-docs single-source checks
  passed (2, 60, and 8 tests respectively).
- `git diff --check` passed, and Codex completed a second exact-diff review.
