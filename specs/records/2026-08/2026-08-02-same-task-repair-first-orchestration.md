# Same-Task Build Repair Before Failure

Status: Completed
Date: 2026-08-02
Owner: Codex

## Recall

### User request

The operator asked why Task `tsk_fc16b5902001vD0ymLHJ0Jbu2W` did not call
Builder or Implementer after Visual Review and Integrity Review found the
`MAP_POINT_COLUMNS` defect. The required behavior is intentionally narrow:

> 优先就地修复，如果不行再考虑失败

The operator then clarified:

> 只调用build尝试修复

### Acceptance criteria

- A downstream non-pass test or review that identifies a concrete product
  defect does not immediately fail the current Task.
- The Orchestrator calls the current Task's exact Build or implementation owner
  once with the exact finding.
- It does not create a new Task or rerun Researcher, Planner, Tester, Visual
  Reviewer, or Integrity Reviewer for that repair attempt.
- It decides from the Build result plus Host-observed changes and checks.
- It fails only when Build cannot complete the repair, there is no eligible
  Build or implementation owner, or a hard external blocker remains.
- Review agents remain read-only.
- No Host gate, workflow engine, correction state, retry counter, optional
  manifest node, or compatibility path is introduced.
- Focused non-User-Interface prompt-contract tests, typecheck, documentation
  checks, commit, and `legacy-remote/v0.0.28beta` push succeed.

### Hard constraints

- Preserve parallel work; no reset, restore, stash, broad formatting, or broad
  staging.
- Do not restart or mutate the running OpenCorvus, Overlay, sidecar, Mission,
  or Task state.
- Do not add, modify, or run User-Interface automation tests.
- Keep the fixed Squad, selected workflow, and Delivery Slice contracts
  unchanged.

### Sources read

- Root `AGENTS.md` supplied in the task context.
- `specs/current/architecture/14-agent-runtime-mode.md`
- `specs/current/architecture/15-agent-facts-and-turns.md`
- `specs/records/2026-08/2026-08-01-goal-control-plane-delivery-slice-rearchitecture.md`
- `specs/records/2026-08/2026-08-02-mission-squad-authority-and-orchestrator-prompt.md`
- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`
- `packages/opencorvus/src/orchestrator/agent.ts`
- Base and Advanced Orchestrator overlays.
- Focused Orchestrator prompt tests.
- Read-only SQLite evidence for the Phase 02 failure and Phase 03 Build dispatch.

### Whole-repository grep

```text
rg -n "Rejected reviews|failed terminal waves|one logical occurrence|terminal non-pass|new fixed-profile Mission Task|never redispatch|same-Task repair|fail_task" packages/opencorvus/src packages/opencorvus/test specs
rg -n "once per Task|review.*fail.*Task|completed.*node|non-pass" specs/current/architecture packages/opencorvus/src/expert-squad packages/opencorvus/src/orchestrator packages/opencorvus/src/engine
```

The behavior is prompt-owned. No Host dispatch gate prevents one additional
same-Task call to the exact Build or implementation identity. The narrow
change belongs in shared Orchestrator recovery guidance, Base and Advanced
overlays, the lifecycle and Visual Review tool descriptions, current
architecture, and focused positive prompt-contract tests.

### Independent agent feedback

None. The operator did not request sub-agents.

## Introduction timeline

1. `f2b3d8e1d2e39a2ef38178a10ef7ac8472330d9d`,
   2026-08-01 21:45:41 +08:00, changed dynamic Recovery Discipline to fail
   rejected reviews and move repair to a new Mission Task.
2. `3fb6976d23e9484e07ccf496bddb5f200c26335d`,
   2026-08-02 02:21:13 +08:00, made repeat-after-review terminal failure a
   shared core rule.
3. `ec16f7ae386d5e9829b57990a1cc3ed39edd6c09`,
   2026-08-02 02:38:57 +08:00, copied that rule into Base.

## Implementation plan

1. Add exactly one exception to fail-first recovery: call the current exact
   Build or implementation owner once with the concrete review finding.
2. Align Base and Advanced Orchestrator overlays and the model-visible
   lifecycle/review descriptions with that narrow rule.
3. Update current architecture and focused positive prompt tests.
4. Regenerate only the built-in Expert Squad payload affected by Base and
   Advanced prompt changes.
5. Run focused tests, typecheck and documentation checks; inspect, commit, and
   push task-owned changes.

## Verification

- Shared Orchestrator prompt, capability-projection, and tool-description
  contracts: 49 passed.
- Base, Advanced, and PromptProfile package contracts passed.
- `bun run --cwd packages/opencorvus typecheck` passed.
- `bun run api:routes-check` passed.
- `bun run docs:check` passed.
- Historical documentation links passed.
- Document Health passed 62/62 after the new record and indexes entered the
  Git index.
