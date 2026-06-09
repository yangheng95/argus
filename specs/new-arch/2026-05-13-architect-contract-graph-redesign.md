# Architect Contract Graph Redesign

## Problem

Architect validation currently conflates three different concerns:

1. **Goal graph data integrity** — goal ids, dependency edges, traceability,
   coverage rows, acceptance spec ownership.
2. **Cross-goal interface contracts** — typed handoffs Build agents should obey.
3. **Prompt-shape advice** — how the Architect model should phrase exports/imports.

The live task `tsk_e1ffd2773001fiy3pRAnxKCW5h` exposed the failure mode. Across the
latest local DB sample of failed `submit_architect` calls:

| Category                          | Count | Root Cause                                                                       |
| --------------------------------- | ----: | -------------------------------------------------------------------------------- |
| `linker_undeclared_export`        |    28 | `exports[]` prose tokenized into fake symbols (`type`, `const`, `GET`, `latest`) |
| `linker_unresolved_symbol`        |    10 | `imports[]` prose tokenized into fake required ContractIR names                  |
| `function_vs_type_name_heuristic` |     6 | suffix-only name heuristic mistook hook functions for data shapes                |
| `contract_audit_required`         |     4 | advisory contract-audit policy hard-blocked graph finalization                   |

The isolated hook-name patch fixes one false positive, but not the mechanism.

## Root Cause

`GoalContract.exports` and `GoalContract.imports` are `string[]` fields. The prompt
asks the Architect to put "actual signatures" there, so the strings naturally contain
TypeScript snippets, route descriptions, and prose:

- `export type KeyStatisticsItem = ...`
- `GET /api/latest prices via Express`
- `KeyStatistics behavior inventory from goal_bootstrap`

`packages/opencorvus/src/architect/linker.ts::parseContractSymbols` then extracts the
first identifier-like token from each comma-separated string and treats it as a
ContractIR name. That means the validator interprets natural strings as structured
contracts and returns hard blocking issues for artifacts that were never intended to
be ContractIR symbols.

ContractIR itself only models `type | function | enum`, while actual architecture
surfaces include components, routes, static config, hooks, visual/rendered surfaces,
and behavioral inventories. The system therefore asks the model to express broad
interfaces in a narrow schema and then punishes it for the necessary prose.

## Decision

Replace the `exports/imports string[] → parseContractSymbols → ContractIR` chain with
a structured **Architect Contract Graph**.

### Single Source

Cross-goal handoffs are represented only by `ArchitectContractGraph.contracts[]`.
Each dependency edge names contract ids, not prose strings.

```ts
type ArchitectContractKind =
  | "type"
  | "function"
  | "enum"
  | "component"
  | "route"
  | "static_data"
  | "render_surface"
  | "behavior_inventory"

interface ArchitectContractRef {
  id: string
  kind: ArchitectContractKind
  name: string
  producer_goal_id: string
  consumer_goal_ids: string[]
  summary: string
  ir?: ContractIR // present only for type/function/enum
  route?: RouteContract // present only for route
  component?: ComponentContract
  artifact_paths?: string[]
}

interface GoalDependencyContract {
  from_goal_id: string
  to_goal_id: string
  reason: "contract" | "bootstrap_scaffold" | "integration_order"
  contract_ids: string[]
}
```

`depends_on` remains the execution-order graph. The contract graph explains why an
edge exists. `contract_ids` may be empty only when `reason` is not `"contract"`;
the reason is persisted, never inferred from goal kind, title, or an empty list.

### Field Fate

| Current Field                                                | New Role                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `goal.exports: string[]`                                     | removed from validation source; eventually removed from DB schema after reset |
| `goal.imports: string[]`                                     | removed from validation source; eventually removed from DB schema after reset |
| Decision-log `type_contract/function_contract/enum_contract` | replaced by `architect_contract_graph` entries                                |
| `ContractIR`                                                 | kept only as typed payload for `type/function/enum` contracts                 |
| `contract_audit`                                             | consumes graph contracts with `ir`, not linker output                         |

No fallback compatibility path. During implementation we replace all consumers in one
branch and reset local DB as required by project rules.

## New Architect Tools

Replace the three independent contract registration tools with one graph-owned API:

```ts
register_contract({
  id,
  kind,
  name,
  producer_goal_id,
  consumer_goal_ids,
  summary,
  ir?, component?, route?, artifact_paths?
})

register_dependency_contract({
  from_goal_id,
  to_goal_id,
  reason,
  contract_ids
})
```

Rules:

- `producer_goal_id` and all `consumer_goal_ids` must exist.
- every `consumer_goal_id` must have the producer in its `depends_on` ancestry.
- every `reason="contract"` dependency edge must have at least one contract id.
- `reason="bootstrap_scaffold"` and `reason="integration_order"` may have empty
  `contract_ids`, but the reason must be explicit and the summary must explain the
  ordering contract. No validator may infer these cases from goal kind/title.
- `ir` is required for `type/function/enum` and forbidden for other kinds.
- route/component/static/render/behavior contracts have their own typed payloads or
  `artifact_paths`, never free-form parseable signatures.
- every `contract_id` on a dependency edge must resolve to a contract whose
  `producer_goal_id === from_goal_id` and whose `consumer_goal_ids` contains
  `to_goal_id`.

### LLM Tool Validation Mode

Architect and orchestrator goal-contract tools follow a strong-input /
weak-output pattern:

- prompts and tool descriptions state the exact contract shapes, legal
  discriminators, and examples;
- model-facing tool input schemas must be permissive enough to let malformed
  but understandable output reach `execute`;
- `execute` validates against the canonical schema and returns actionable
  diagnostics without mutating the collector or database when validation fails;
- no coercion is allowed. For example, `type: "shell"` must not be converted to
  `type: "heuristic"`; the tool must reject it and tell the model to resubmit
  `type: "heuristic"` with `spec.kind: "shell"`;
- `submit_architect` blocks only invalid execution graph structure. Completion,
  fidelity, traceability, and contract quality remain visible findings for
  downstream orchestrator / integrity / acceptance decisions.

## Validator Redesign

Split validator output into structured findings:

```ts
interface ArchitectValidationFinding {
  code: string
  severity: "blocker" | "concern"
  scope: { goal_ids?: string[]; contract_ids?: string[] }
  message: string
  repair_tools: string[]
}
```

`submit_architect` hard-blocks only invalid execution graph structure.
Everything else is a concern. Architect must not be trapped into retrying until
it produces perfect acceptance evidence before Build has run.

### Blockers

- no goals
- unknown goal ids in `depends_on`
- dependency cycles
- acceptance spec `goal_id` mismatch

### Concerns

- missing or incomplete traceability for claimed `requirement_ids`
- source/reference coverage gaps
- reference-driven task missing final acceptance visual acceptance
- multi-goal graph missing assembly owner
- contract graph references unknown goals or contract ids
- contract edge names a producer that is not in dependency ancestry
- dependency edge contract id does not belong to the edge producer/consumer pair
- `reason="contract"` edge has no `contract_ids`
- non-contract edge lacks explicit reason / ordering summary
- contract graph has weak summaries
- dependency edge has no contract but is bootstrap/scaffold-only
- a consumer imports a broad rendered surface that may be too coupled
- a graph contract with closed literal domains is not referenced by any graph-owned
  contract-audit criterion (concern before acceptance, acceptance blocker only if the
  declared criterion fails)

Concerns are persisted into architect result / decision log for downstream integrity,
but they do not trap the Architect in `submit_architect` loops.

## Build Prompt Changes

Build currently renders:

- `goal.exports`
- `goal.imports`
- rendered ContractIR entries from the decision log

New prompt sections:

- `## Contract Graph`
  - contracts produced by this goal
  - contracts consumed from dependencies
  - task-wide contracts that include this goal
- `## Dependency Reasons`
  - one line per `GoalDependencyContract`

Build must no longer infer dependency meaning from `exports/imports` text.

Migration scope includes the typed Build API, not only prompt text:

- `BuildGoalInput` removes `exports/imports`.
- `BuildContext.collaborationGoals` removes `exports/imports` and gains graph slices.
- orchestrator build context composition passes produced/consumed contracts and
  dependency reasons.
- `build-core.txt` stops naming `imports/exports` as goal input.
- tests assert the rendered prompt contains graph sections and does not render old
  `Imports:` / `Exports:` blocks.

## Integrity Changes

`technical_feasibility` currently says to walk `imports[]` and find matching
ancestor `exports[]`. That must become:

- walk `GoalDependencyContract[]`
- verify every contract id resolves
- verify producer/consumer goal ancestry
- verify typed payload matches kind
- flag missing capability only when a required user-visible tier has no contract
  or owning goal

Integrity correction tools must also become graph-aware. Current corrections can
only rewrite goal fields. The new schema needs explicit correction shapes for:

- add / modify / remove `ArchitectContractRef`
- add / modify / remove `GoalDependencyContract`
- reclassify dependency edge reason
- attach a graph-owned audit criterion to a typed contract

Without these correction shapes, integrity would have to fall back to old
`exports/imports` fields, violating the single-source decision.

## Contract Audit

`contract_audit` must stop deriving audit boundaries from goal `imports/exports`.

### Scorer Schema

Replace symbol-based `contract_ir` scorer input:

```ts
{ kind: "contract_ir", symbols?: string[] }
```

with graph contract ids:

```ts
{ kind: "contract_graph", contract_ids: string[] }
```

The scorer resolves ids from the active graph and audits only contracts with `ir`.
Non-typed graph contracts are ignored by this scorer because they have no closed
field domains.

### Criteria Creation

Architect remains the source that declares whether a graph contract needs audit:

- for every `type/function/enum` contract with closed literal domains, the producing
  or consuming goal acceptance specs must include an essential `contract_audit`
  scorer that names the contract id;
- if not present, `submit_architect` records a `concern`, not a blocker, so planning
  does not loop forever;
- acceptance/project-gate treats a declared `contract_audit` failure as a blocker.

Acceptance must include a regression where a goal has no old `exports/imports` fields
but a graph `contract_graph` scorer still audits a closed literal contract.

## Persistence

Add an append-only artifact kind:

- `engine_artifact.kind = "architect_contract_graph"`

Payload:

```json
{
  "version": 1,
  "contracts": [],
  "dependency_contracts": []
}
```

The active graph is latest-per-task by `(time_created desc, id desc)`. This follows
the existing artifact single-source pattern and avoids same-millisecond ambiguity.
Do not introduce a parallel DB table unless query performance proves it is required.

### Identity Boundary

The graph must not be persisted directly inside `ArchitectAgent.coordinate`.
At that point new goals still use Architect/LLM ids. Durable `engine_goal.id` values
are assigned later by orchestrator persistence.

Persistence must happen in the same layer that upserts goals:

1. `ArchitectAgent.coordinate` returns graph refs using the same temporary goal ids
   as its returned goals.
2. `upsertGoalsFromArchitect` returns a complete temp-id → durable-id mapping.
3. The orchestrator/persist layer rewrites every graph goal reference using that map.
4. The rewritten graph artifact is inserted only after all graph references resolve.
5. Goal rows and graph artifact are committed as one logical transaction.

If any graph reference cannot be mapped, the whole architect persistence fails before
the active goal set is published.

### Artifact Lifecycle

Task-scoped graph artifacts need first-class readers:

- add `architect_contract_graph` to `EngineArtifactKind`.
- add a `(task_id, kind, time_created desc, id desc)` index.
- add `findLatestArchitectContractGraph(taskID)` and use it everywhere instead of
  generic run-scoped `findArtifacts(runID)`.
- include the graph artifact in task export/import flows; run-scoped export alone
  will miss a nullable-`run_id` graph.
- update overlay debug SQL templates to show the active graph row.

Because this project is greenfield and DB reset is allowed, remove `exports` and
`imports` from `engine_goal` in the same implementation branch once all call sites
are switched.

## Call Sites From Grep

### Source

| Area                                                                           | Current Use                                        | Redesign                                             |
| ------------------------------------------------------------------------------ | -------------------------------------------------- | ---------------------------------------------------- |
| `pipeline/goal-contract.schema.ts`                                             | defines `exports/imports: string[]`                | remove fields                                        |
| `pipeline/types.ts`                                                            | goal contract fields                               | remove fields                                        |
| `build/types.ts`                                                               | BuildGoalInput carries `exports/imports`           | remove fields; add graph context types               |
| `engine/persist.ts`                                                            | stores goal exports/imports                        | remove persistence                                   |
| `engine/store.ts`                                                              | reads goal exports/imports                         | remove projection                                    |
| `engine/engine.sql.ts` / `storage/ddl.ts`                                      | engine_goal columns and artifact kind/index        | remove columns; add graph artifact kind/index        |
| `engine/describe.ts`                                                           | read-context renders exports/imports               | render contract graph summary                        |
| `engine/model.ts`                                                              | task board goal contract schema                    | remove exports/imports or replace with graph summary |
| `architect/output-tools.ts`                                                    | validates via linker and ContractIR tools          | replace with contract graph tools                    |
| `architect/linker.ts`                                                          | parses string symbols                              | delete or narrow to TS extraction helper only        |
| `architect/agent.ts`                                                           | maps collector goals and logs ContractIR           | persist graph artifact                               |
| `orchestrator/tools.ts`                                                        | linkContracts for contract_audit and build context | load graph artifact                                  |
| `build/agent.ts`                                                               | renders `exports/imports` and `architectContracts` | render graph sections                                |
| `integrity/agent.ts` / `dimensions.ts`                                         | prompt and schema mention exports/imports          | switch to graph                                      |
| `acceptance/types.ts`                                                          | contract audit scorer uses symbols                 | replace with graph contract ids                      |
| `acceptance/contract-audit.ts`                                                 | derives boundary from imports/exports              | resolve graph contract ids                           |
| `acceptance/checks/types.ts`                                                   | GoalInfo carries imports/exports                   | remove fields; add graph refs                        |
| `acceptance/checks/contract-audit-review.ts`                                   | boundary detection uses imports/exports            | use graph audit criteria                             |
| `acceptance/specialists/backend-client.ts`                                     | client contract gate uses imports/exports          | use route/static graph contracts                     |
| retired acceptance tool surface                                                | renders imports/exports in goal detail             | render graph contracts                               |
| `prompt/upstream-context.ts`                                                   | acceptance catalog says exports/imports are gating | render graph catalog                                 |
| `prompt/core/build-core.txt` / `acceptance-core.txt` / `orchestrator-core.txt` | system prompts name imports/exports                | switch to graph vocabulary                           |
| `overlay/src/main.tsx`                                                         | debug SQL template selects exports/imports         | select graph artifact                                |
| `prompt/core/architect-core.txt`                                               | asks for exports/imports and per-kind tools        | rewrite around graph tools                           |

### Tests

Update or replace:

- `test/architect/linker.test.ts`
- `test/architect/output-tools.test.ts`
- `test/architect-owned-paths-overlap.test.ts`
- `test/orchestrator/architect-fidelity-gate.test.ts`
- `test/build-agent/prompt-context.test.ts`
- `test/acceptance/contract-audit.test.ts`
- `test/orchestrator/tools.test.ts`
- `test/engine/describe*.test.ts`
- acceptance project-gate / specialist tests touching `GoalInfo`
- upstream-context tests for acceptance catalog
- overlay debug template coverage
- export/import route tests for task-scoped graph artifacts
- integrity workflow tests that assert imports/exports text

## Implementation Plan

1. Add `architect/contract-graph.ts` with schemas, types, validation helpers, and
   render helpers.
2. Replace Architect contract registration tools with graph tools.
3. Replace `architectValidationIssues` string output with structured findings,
   keeping `submit_architect` text rendering as a view over blockers/concerns.
4. Delete linker validation against `goal.exports/imports`.
5. Change `ArchitectAgent.coordinate` to return a temporary-id graph but not persist
   it.
6. Persist the remapped graph in orchestrator/persist after `upsertGoalsFromArchitect`
   assigns durable goal ids.
7. Add task-scoped graph artifact reader/export/import/overlay debug support.
8. Switch orchestrator build context to load and pass contract graph.
9. Switch Build target types and prompt rendering to graph sections.
10. Switch contract_audit scorer schema/runtime to consume graph `contract_ids`.
11. Switch acceptance, upstream-context, and specialists from imports/exports to graph.
12. Switch integrity prompts, issue schema, and correction schema to graph vocabulary.
13. Remove `exports/imports` from goal schema, DB DDL, persistence, store, prompt, and
    tests. Reset DB.
14. Run targeted architect + orchestrator + build prompt + acceptance + integrity tests.
15. Run typecheck, api route check, docs check, then commit and push.

## Acceptance

- A goal export string such as `GET /api/latest prices` no longer exists as a goal
  field and cannot produce fake ContractIR symbols.
- Architect can model React hooks, components, routes, static data, and behavior
  inventories without forcing them into `type/function/enum`.
- `submit_architect` cannot return linker tokenization errors because tokenization is
  removed from the validation path.
- `submit_architect` still rejects true graph corruption: unknown ids, cycles,
  missing coverage, missing final visual acceptance, and contract ids not connected
  to dependency ancestry.
- Build prompt receives enough contract context to implement a goal without reading
  old `exports/imports`.
- `contract_audit` still audits closed literal domains for typed graph contracts.
- graph artifact ids use durable `engine_goal.id`, not Architect temporary ids.
- task export/import preserves the active contract graph.
- no production prompt, acceptance catalog, read-context output, overlay debug SQL, or
  SDK model still treats `exports/imports` as active goal fields.
- no `contract_audit` path can skip solely because old `imports/exports` are empty.

## Non-Goals

- Do not add fallback parsing of old `exports/imports`.
- Do not keep both old ContractIR decision-log entries and new graph artifacts as
  active sources.
- Do not make integrity the first validator. Architect submit should validate only
  its own graph facts; integrity remains a separate reviewer.
