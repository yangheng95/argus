# Expert Squad Dispatch-Scope Contract and Guardrail Repair

Date: 2026-07-25

Status: Source repairs implemented and validated; two pre-existing suite
failures remain unresolved and are reported below.

## Recall

| Item | Details |
| --- | --- |
| User requirement | Audit the current Mirror Prism expert-squad design and the OpenCorvus expert-squad infrastructure, extrapolate the next likely failures from the incident records, find every Expert Squad and Squad Software Development Kit (SDK) design defect, and repair them. |
| Acceptance criteria | Each reported defect is backed by exact code or a reproduced test failure, not by naming similarity. Every repair carries a regression test. No host gate, admission control, fallback, compatibility path, state machine, or keyword rule is introduced. Documentation stays a single source with the runtime projection. |
| Hard constraints | Follow `AGENTS.md`. Rule 6.1: concurrency and dependency semantics are repaired through the model-visible contract, never through host preflight or admission control. Rule 8/10: no duplicated or hardcoded second source. Rule 28/36: every change carries a test. Preserve all unrelated working-tree changes; stage only task-owned files. Commit subjects start with `dsw-33987`; push to `myhexin`. |
| Sources read | `AGENTS.md`; `specs/records/2026-07/2026-07-24-expert-squad-fact-turn-sdk-calibration.md`; `specs/records/2026-07/2026-07-25-architect-goal-identity-and-prism-design-contract-repair.md`; `specs/records/2026-07/2026-07-25-mirror-prism-goal-granularity-repair.md`; `specs/records/2026-07/2026-07-25-goal-scoped-delegated-worker-contract-projection.md`; `specs/records/2026-07/2026-07-25-goal-worker-evidence-continuation-repair.md`; the Prism manifest, scheduler prompt, and Page Designer package prompts; `packages/opencorvus/src/expert-squad/**`; `packages/sdk/js/src/expert-squad-authoring.ts`; `packages/opencorvus/src/orchestrator/dispatch-agent-tool.ts`; `packages/opencorvus/src/agent/runner.ts`; `packages/opencorvus/src/architect/agent.ts`; `packages/opencorvus/script/generate-expert-squad-payload.ts`. |
| Whole-repository grep | `rg -n "virtual_workflow\|virtualWorkflow"` across `packages/opencorvus/src`, `packages/sdk/js/src`, `packages/overlay/src`; `rg -n "depends_on\|dependsOn"` across the expert-squad sources and the SDK; `rg -n "goal_concurrency\|goalConcurrency\|disjoint_goals"` across `packages/opencorvus/src`, `packages/web/src/content/docs`, `specs/current`, and every package manifest; `rg -n "validateExpertSquadManifestDispatchTopology"`; `rg -n "\.mirror/design"`; `rg -n "acceptance_specs\|truncat\|600" packages/opencorvus/src/architect`. |
| Independent agent feedback | No independent Agent was requested or used. Every finding below is anchored to an exact source line or a reproduced test run. |

## Refuted hypotheses

Two plausible defects were investigated and disproved. They are recorded so a
later pass does not re-open them:

- **Registry skips workflow graph integrity.** `protocol-schema.ts` alone does
  not check dangling `depends_on`, self-reference, cycles, or unknown
  `agent_id`. `registry.ts:372` nevertheless calls the SDK's
  `validateExpertSquadManifestDispatchTopology`, which owns all of those
  invariants. Graph integrity is single-source and already enforced on the
  disk-load path.
- **Prior repairs regressed.** The Page Designer's canonical
  `visual-html-skeleton` output root, the explicit-package tool-switch
  precedence in `promptToolSwitchesForAgentRun`, and the removal of the
  600-character Architect `acceptance_specs` truncation are all still present.

## Defect 1 — the binding workflow contract is not dispatch-scope aware

### Observable risk

`prompt-profile-resolver.ts` projected exactly one enforcement sentence for the
binding graph:

> A node may dispatch only after every depends_on predecessor has
> terminal-success evidence; only nodes without a dependency path between them
> may run concurrently.

Every node in the graph declares `dispatch_scope: "task" | "goal"`, but the
contract never said what that changes.

### Why it becomes the next incident

The 2026-07-25 goal-granularity repair replaced Prism's per-route Goal
multiplication with a small set of delivery-surface Goals. That repair is what
makes this ambiguity load-bearing: the `mirror-prism-generic` graph now has 30
goal-scoped nodes that legitimately execute once per delivery surface. Read
literally, the projected sentence admits two wrong readings:

1. a goal-scoped predecessor is satisfied by **any** Goal's evidence, so
   `mirror-prd-author` for surface B may dispatch on surface A's research —
   producing exactly the partial-evidence rejection and re-dispatch loop already
   observed with the Page Designer;
2. "only nodes without a dependency path between them may run concurrently"
   forbids running one declared node for two disjoint Goals, serializing every
   phase behind unrelated Goals.

Neither reading is expressible as a host rule without building the workflow
engine that rule 15.1 forbids, so the contract itself is the repair surface.

### Repair

`composeResolvedAgentPrompt` now projects the scope semantics alongside the
existing binding clauses: a `task` node executes once and satisfies every
dependent Task-wide; a `goal` node executes once per planned Goal and its
evidence belongs to that Goal alone; a goal-to-goal dependency requires the same
Goal's evidence; concurrency is unrestricted-within-a-Goal by dependency path
and governed across Goals by the declared `goal_concurrency`. A per-Goal
repetition of a declared node is explicitly not an omission, duplication, or
reorder.

## Defect 2 — `goal_concurrency` had no reader

`goal_concurrency` is required by `ExpertSquadAgentProjectionSchema`, declared by
every repository manifest, carried through `PromptProfileResolver` onto
`ResolvedProjectedAgent.goalConcurrency`, exposed in the Expert Squad catalog and
the Settings skill matrix, and enforced at authoring time by
`virtual-workflow-protocol.test.ts` ("limits every repository-authored reviewer
identity to one active goal"). It reached no decision surface: the scheduler
prompt never mentioned it, and `dispatch_agent` built its target union from
`projectedAgents` without surfacing it. The only prose about it in any package
README is the negation "does not convert `goal_concurrency` into Host
admission".

A declared, tested contract with no reader is a second source that changes
nothing. The repair keeps the host out of admission control and instead reports
each target's declared value on the `dispatch_agent` `target` describe, which is
the exact surface where the scheduler selects an identity, and binds the
cross-Goal rule to it in the workflow contract. `ResolvedProjectedAgent` remains
the single value source; no value is copied into the workflow JSON.

## Defect 3 — the MirrorTest typed-dispatch regression was silently dead

`opentest-typed-dispatch.test.ts` is the only regression proving that public
dynamic dispatch reaches the projected implementer through the typed Build
adapter. It declared its own structural `BuildRunInput` with `task: { id }` and
`target`, returned a long-dead `RunOutput` shape (`result`, `mergeBackStatus`,
`actualChangedFiles`), and erased the mismatch with
`mockImplementation(runBuildModelBoundary as any)`. Production
`BuildAgent.RunInput` uses `taskID` and has no `target`. The test therefore threw
`undefined is not an object (evaluating 'input.task.id')` and its 60 assertions
never ran.

The repair binds the stub to the exact production `BuildAgent.RunInput` /
`RunOutput` types, drops the `as any`, persists a real visible final assistant
message so the returned fact reference names durable evidence, and asserts
`taskID`. A future rename now fails typecheck instead of silently disabling the
regression.

## Defect 4 — the SDK calibration roster was hardcoded and stale

`packages/sdk/js/test/repository-squad-fact-turn-calibration.test.ts` held a
hand-maintained map of every Squad root and its exact version. It was failing:
Prism is `2026.07.25.3` and the map still expected `2026.07.24.5`, so the
goal-granularity and source-capability repairs left this guard red. The version
literal duplicates manifest data and adds no invariant, and the hand-maintained
roster silently exempts any newly authored package from the fact/Turn
calibration.

The repair discovers every authored package from the Git index — the same
authority `generate-expert-squad-payload.ts` uses — and asserts the canonical
`YYYY.MM.DD.N` version shape instead of a duplicated literal. The manifest-id
assertion mirrors the existing `registry.ts` payload invariant that
`<namespace>/<id>` directory segments must match manifest identity.

## Call-point disposition

| Surface | Disposition |
| --- | --- |
| `prompt-profile-resolver.ts` `composeResolvedAgentPrompt` | Adds dispatch-scope evidence scoping and `goal_concurrency`-bound cross-Goal concurrency to the binding contract. Existing clauses unchanged. |
| `orchestrator/dispatch-agent-tool.ts` | Reports each target's declared `goal_concurrency` on its `target` describe. No schema, execution, or admission change. |
| `test/expert-squad/opentest-typed-dispatch.test.ts` | Bound to the production Build adapter ABI; stub returns a real `RunOutput`. |
| `sdk/js/test/repository-squad-fact-turn-calibration.test.ts` | Git-index discovery; canonical version shape instead of duplicated literals. |
| `test/expert-squad/virtual-workflow-dispatch-scope.test.ts` | New regression over the real installed Prism package. |
| `packages/web/src/content/docs/agents.mdx` and its zh-CN peer | Documentation restated to match the projected contract exactly. |
| `protocol-schema.ts`, `registry.ts`, `expert-squad-authoring.ts` | Unchanged. Graph integrity was already single-source; see refuted hypotheses. |

## Validation ledger

| Check | Result |
| --- | --- |
| `bun test packages/opencorvus/test/expert-squad/opentest-typed-dispatch.test.ts` | Passed: 1 test, 60 expectations, previously failing. |
| `bun test packages/sdk/js/test/repository-squad-fact-turn-calibration.test.ts` | Passed: 9 tests, 119 expectations, previously failing. |
| `bun test packages/opencorvus/test/expert-squad/virtual-workflow-dispatch-scope.test.ts` | Passed: 1 test, 48 expectations. Proves both prompt clauses and both `goal_concurrency` values from the real Prism package, and that every projected target reports its declared value. |
| `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/orchestrator/tools.test.ts packages/opencorvus/test/expert-squad/portable-template.test.ts` | Passed: 137 tests, 0 failures. |
| `bun test packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts` | Passed: 83 tests, 0 failures. |
| `bun run --cwd packages/opencorvus typecheck` | Passed. |
| `bun run docs:check` | Passed: 291 operations across 24 groups. |
| `bun test packages/opencorvus/test/expert-squad packages/sdk/js/test` | 499 passed, 1 skipped, 2 failed. Both failures are pre-existing and unrelated; see below. |

## Unresolved pre-existing failures

Reported under rule 28b rather than absorbed into the summary. Neither is caused
by the changes above: the edited surfaces are two test files, one prompt string,
one tool describe string, one new test, and two documentation paragraphs.

1. `ExpertSquadPackageManager > surfaces directory staging, replacement restore,
   payload target, and ZIP source cleanup failures`. The spawned fixture for the
   `archive-success-source` scenario terminates with exit 143 (SIGTERM) and an
   empty stderr and stdout. It reproduces on every whole-file run and passes on
   every isolated run (`-t` selection, 3/3). The scenario is the only one that
   performs a *successful* archive import, so a plausible direction is that the
   child does not settle its event loop after a successful install and is reaped;
   that is a hypothesis, not a proven cause, and it is not asserted here as one.
   No repair is claimed.
2. `frontend-replica package source project generator > inerts document
   execution surfaces …`. The Browser Model Context Protocol `evaluate` call
   returns no `structuredContent`, so the namespace-lifecycle assertion
   dereferences `undefined`. This is an environment-dependent browser
   dependency; it did not fail on the first suite run of this session and failed
   on the second with identical sources. No repair is claimed.

Both need their own investigation with real instrumentation. Calling either one
repaired, flaky-by-design, or acceptable noise would violate rules 1 and 27.
