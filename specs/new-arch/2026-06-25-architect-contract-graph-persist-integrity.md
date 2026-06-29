# Architect Contract Graph Persist Integrity (2026-06-25)

## Problem

The workflow task `tsk_efce88271001b5j3h6YIfmgF2T` exposed an execution-fact split:

- The architect contract graph said `TradingViewTokenSource` was produced by G4 and consumed by G5/G6.
- The executable build prompt for G5/G6 rendered `Depends on` without G4 in the dependency ancestry.
- The scheduler therefore dispatched downstream work before the scaffold/token producer had passed and published.

This is an algorithm/data-integrity defect, not a product-artifact defect. Build workers correctly refused to recreate missing dependency files.

## Existing Constraints Recalled

- `AGENTS.md` forbids fallback, compatibility paths, and host-side routing gates.
- `specs/new-arch/2026-06-19-goal-fifo-refill-scheduling-impact.md` keeps graph diagnosis and build selection with the orchestrator model; host code may observe durable facts but must not repair the graph by hidden scheduling.
- `specs/new-arch/2026-06-21-frontend-design-research-adversarial-repair.md` records that final `submit_architect` validation is the authoritative blocker for unresolved contract ids.

## Callpoint Inventory

| Surface                                      | Current role                                                                                                 | Required change                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `architect/output-tools.ts`                  | Validates collector goal ids before `submit_architect` finalizes.                                            | Keep. This is pre-remap validation only.                                                            |
| `architect/contract-graph.ts`                | Owns graph schemas, graph validation, goal-id remapping, and prompt rendering.                               | Add reusable final consistency assertion for a contract graph against executable goal rows.         |
| `engine/persist.ts#upsertGoalsFromArchitect` | Remaps architect LLM goal ids into DB goal ids and writes `EngineGoalTable.depends_on`.                      | Keep as the writer of executable dependencies.                                                      |
| `orchestrator/tools.ts#architect`            | Calls architect, upserts goals, remaps contract graph, persists graph artifact.                              | Validate the remapped graph against final executable goal ids before persisting the graph artifact. |
| `build/agent.ts`                             | Tells workers dependency goals should already be merged and to fail if graph contract artifacts are missing. | Keep. Worker should expose missing upstream work, not recreate it.                                  |
| Tests                                        | Architect output-tool tests cover pre-remap collector validation. Engine tests cover goal upsert mapping.    | Add a remap/persist integrity regression so invalid final graph cannot be persisted.                |

## Selected Algorithm

`dependency_contracts` are the dependency source of truth. A goal's executable
`depends_on` is the materialized execution index derived from those contracts.

When the Architect calls `register_dependency_contract`:

1. Validate the declared edge references known goals, has the required reason
   payload, references contracts that belong to the edge, and does not create a
   cycle.
2. Persist the dependency contract in the collector.
3. Materialize `edge.from_goal_id` into the `to_goal.depends_on` array exactly
   once.

`register_contract` may describe producer/consumer relationships before the
matching dependency contract is registered. Final `submit_architect` validation
still blocks unresolved producer/consumer contracts, but the accepted
dependency-contract tool call is what writes executable dependency facts.

After `upsertGoalsFromArchitect` returns the LLM-id to DB-id map, the
orchestrator still performs a final remapped consistency assertion before
persisting `architect_contract_graph`. That assertion is defense against code
drift or remap bugs; it is not the primary repair mechanism.

## Acceptance

- `register_dependency_contract({ from_goal_id: "goal_model", to_goal_id: "goal_ui" })` materializes `goal_model` into `goal_ui.depends_on`.
- A remapped contract graph that somehow still says `db_goal_model -> db_goal_ui` while `db_goal_ui.depends_on` omits `db_goal_model` is rejected before persistence as a consistency violation.
- A valid remapped graph with matching executable dependencies still passes.
- Existing architect collector validation remains unchanged.
- Targeted tests and typecheck pass.
