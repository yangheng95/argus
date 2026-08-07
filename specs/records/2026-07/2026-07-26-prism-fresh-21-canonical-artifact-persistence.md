# Prism fresh-21 canonical Artifact persistence incident

## Recall

### User requirements

- Run the TradingView Spaces Prism delivery as a real Mission against port
  `7777` and the canonical SQLite database.
- Monitor the natural Agent and Expert Squad execution, repair every
  infrastructure or package defect exposed by the run, and continue until the
  Task completes with qualified product and visual evidence.
- Do not use a benchmark wrapper and do not steer the tested Task by injecting
  operator/user messages or by editing its product artifacts.
- Allow non-material omissions. Treat false or missing evidence, incorrect
  paths, persistence/tool failures, duplicate execution, and deadlock as
  defects.

### Acceptance

- Exact Artifact locators and digests cross the Researcher → Requirements →
  Architect boundary without copied bodies or hidden context.
- Architect output with ordinary optional object fields persists as canonical
  JSON, creates the intended Goal/ContractGraph projection, and remains strict
  against lossy JSON values.
- A replacement Mission is completely free of monitor-authored messages and
  naturally completes PRD, Design, Code, MirrorTest, and task-scoped visual
  evidence.

### Hard constraints

- Preserve every unrelated change in the shared worktree.
- No fallback, compatibility path, host gate, state-machine workaround, Agent
  special case, synthetic evidence, or automatic restart loop.
- Expert Squad domain policy stays in its package; platform JSON preservation
  remains a shared Artifact protocol concern.
- Do not stop or restart the running backend without explicit user authority.

### Read material

- `/Users/yangheng/Desktop/opencorvus/AGENTS.md`
- `specs/records/2026-07/2026-07-26-unified-task-artifact-catalog-protocol.md`
- `specs/records/2026-07/2026-07-26-prism-requirement-set-handoff-lifecycle.md`
- `specs/records/2026-07/2026-07-26-prism-bootstrap-evidence-boundary-repair.md`
- `packages/opencorvus/src/orchestrator/architect-stage.ts`
- `packages/opencorvus/src/engine/persist.ts`
- `packages/plugin/src/artifact-catalog.ts`
- `packages/opencorvus/src/engine/queue.ts`
- `packages/opencorvus/src/orchestrator/task-lifecycle-tools.ts`
- `packages/opencorvus/src/engine/state.ts`

### Repository-wide search

The investigation enumerated:

- all `ArtifactJSONValueSchema` consumers in the Plugin Artifact protocol,
  Engine metadata serialization, cross-Task Artifact import, and Research
  output tests;
- all `persistArchitectGoalProjection` and
  `persistArchitectUnprojectableGoalGraphCandidate` callers and tests;
- all `queued_operator_wake` persistence, drain, recovery, Task conversation,
  and terminal-reopen paths;
- all `fail_task` lifecycle helpers, Engine state writers, and terminal
  convergence tests.

No Expert Squad-specific serializer exists or should be added. The shared
Artifact JSON contract is the single repair boundary.

## Natural run evidence

The monitored execution was:

- Mission `91fb41827ee5b2e6`
- Task `tsk_f9ef8e084001OdQ5Uk4SX7lqEY`
- Task root Session `ses_061071dc8ffeJ1QuPvuHL7382i`
- Orchestrator Session `ses_061071818ffe2ynk8BgxT5nnWG`
- source Researcher Session `ses_06106a49effd2vwgJT5F2QXjHL`
- Requirements Session `ses_060f7df7cffdIqE1LHjzJYcy5L`
- Architect Session `ses_060f3cb31ffdV8PBEVrMwpH937`
- run directory
  `/Users/yangheng/Documents/OpenCorvus-Demos/prism/runs/tradingview-spaces-20260726-fresh-21`

The handoff itself succeeded:

- source-system mapping Artifact
  `art_f9f072273001zaR28wJisfnhV5`, SHA-256
  `eb9717a9f3680c3f9a64d8d59e5d0c5def4f850c98369711efaf63b0c88c21d2`;
- RequirementSet Artifact `art_f9f0b48de001LBs0aqx3YQPWZA`,
  SHA-256
  `d5daa03a956831958e4784310d54a052182876cb73cfa26b72de2e4c72dc71b6`;
- the Architect dispatch carried both exact locators and digests;
- the Architect read the selected Artifact and its `manage_goal`,
  `register_contract`, and coverage tool calls completed.

The failure occurred after the specialist Turn, inside
`persist-goals-and-contract-graph`. Artifact
`art_f9f18aaca001NFa7oWefmqlngJ` records a `ZodError`:

> must be a finite, acyclic canonical JSON value without sparse arrays, extra
> array properties, undefined, functions, symbols, accessors, or custom
> prototypes

The backend process had started before the worktree repair that canonicalizes
ordinary object properties with `undefined` as JSON field omission. Those
properties are produced by strict typed schemas for optional Artifact fields;
they are not false facts and JSON serialization already defines their correct
representation as omission. Root or array-item `undefined`, sparse arrays,
cycles, non-finite numbers, functions, symbols, accessors, extra array
properties, and custom prototypes remain invalid.

## Monitor contamination

The monitor incorrectly inserted operator message
`msg_f9f055d33001zs0HbOHyTmds46`. Its queued wake later reopened the failed
Task, producing the progress snapshot “Queued operator wake reopened terminal
task.” That is expected product behavior for a real operator message arriving
behind an active root prompt, not evidence that `fail_task` failed to persist.

Consequences:

- fresh-21 is permanently excluded from acceptance;
- its natural persistence failure remains useful defect evidence;
- no lifecycle change may be made to conceal the monitor's intervention;
- the replacement run must contain no monitor-authored Task, Mission, Session,
  interaction, or artifact writes.

## Repair boundary

The shared Artifact JSON validator must canonicalize object properties whose
value is `undefined` by omission before the recursive JSON shape parse. It must
preserve every legal string key, including `__proto__`, Unicode, quotes,
slashes, and empty strings, without invoking prototype mutation. The strict
rejection boundary for lossy values remains unchanged.

The affected consumers are repaired through this one protocol implementation:

| Consumer family | Required verification |
| --- | --- |
| Artifact Catalog publish/read | optional object fields are omitted; bytes and digest remain exact |
| Architect Goal/ContractGraph persistence | projection succeeds when optional locators or typed fields are absent |
| Cross-Task Artifact import | source payload remains canonical and exact |
| Research and Expert Squad outputs | the shared protocol accepts legal defaults without package exceptions |

## Verification

The current worktree repair passed:

```text
bun test \
  packages/opencorvus/test/artifact-catalog/catalog.test.ts \
  packages/opencorvus/test/architect/agent.test.ts \
  packages/opencorvus/test/engine/goal-versioning.test.ts

42 pass
0 fail
```

This is source-level regression evidence, not E2E completion. A backend reload
and a never-reused, message-clean Mission are still required. The final
acceptance must include natural Goal persistence, the complete Prism workflow,
real Node/Playwright execution, current-Task screenshot bytes and locators, and
human visual review.
