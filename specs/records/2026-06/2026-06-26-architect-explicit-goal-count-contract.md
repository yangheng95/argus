# Architect Explicit Goal Count Contract (2026-06-26)

## Problem

The Forex replica task `tsk_eff4127f1001F3MSZbI0NZmN04` proved a repeatable
Architect truncation:

- The user request explicitly required Architect to create at least 20
  verifiable goals.
- The first Architect prompt contained that text and the model reasoned that it
  needed 20+ goals.
- After two structurally valid goals, `isReadyToFinalize()` returned true
  because the validator only blocked fewer than two goals.
- The session loop then exposed only `submit_architect`, so the model could no
  longer call `register_goal`.
- `submit_architect` accepted the self-described partial graph because missing
  traceability, reference coverage, final visual acceptance, and graph contracts
  are concerns.

This is a data-contract bug. The user's explicit graph-size contract remained
natural-language prompt text instead of becoming the same validation input used
by readiness and final submit.

## Existing Constraints Recalled

- `AGENTS.md` forbids fallback, hidden routing gates, and prompt-only patches
  for structural bugs.
- `2026-06-07-remove-startup-route-decision-architect-goal-granularity.md`
  tuned the prompt to prefer 5-30 goals and obey explicit user counts, but did
  not wire the count into tool validation.
- `2026-06-25-visual-evidence-no-hard-gate-root-repair.md` requires visual
  evidence gaps to remain advisory; this repair must not turn visual fidelity
  concerns into submit-time blockers.
- `2026-06-25-architect-contract-graph-persist-integrity.md` is already changing
  Architect contract graph dependency materialization in the same files. This
  repair must preserve those edits.

## Callpoint Inventory

| Surface                                                    | Current role                                                                                                     | Repair                                                                                                                                                                         |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `architect/output-tools.ts`                                | Owns `MIN_ARCHITECT_GOAL_COUNT`, validation findings, `submit_architect`, and `isReadyToFinalize()`.             | Add an explicit minimum-goal validation input. Use it in both readiness and submit. Keep concern-only fidelity behavior unchanged.                                             |
| `architect/agent.ts`                                       | Builds Architect prompt and creates output tools from task request, requirements, decisions, and design handoff. | Derive a structured Architect goal-count contract from task request / requirement decisions and pass it to output tools. Render the contract into the prompt for transparency. |
| `orchestrator/tools.ts#architect`                          | Loads task request, active requirements, decision log, existing goals, then calls `ArchitectAgent.coordinate`.   | No semantic change beyond consuming the updated `ArchitectAgent.coordinate` behavior.                                                                                          |
| `requirements/output-tools.ts` and `requirements/types.ts` | Requirements can write decisions, but does not own goal graph creation.                                          | No code change in this repair. Requirements may later be prompted to register the same decision, but Architect must not depend on that model behavior for correctness.         |
| `session/loop.ts` and `agent/runner.ts`                    | Generic terminal tool exposure when an agent-specific readiness predicate returns true.                          | Keep unchanged. The readiness predicate's data contract is wrong; terminal scoping itself is working as designed.                                                              |
| Tests                                                      | Existing tests assert two-goal structural minimum and concern-only graph contract behavior.                      | Add focused tests for explicit min-count blocking/readiness and prompt propagation. Existing two-goal default behavior remains valid when no explicit count exists.            |

## Selected Algorithm

1. Introduce an `ArchitectGoalCountContract` input with:
   - `minGoalCount`
   - `source`
   - `evidence`
2. Derive the contract in `ArchitectAgent.coordinate` from the structured
   requirements decision list using stable keys such as
   `architect_goal_min_count`. 2026-06-27 correction: the earlier raw
   task-request regex path was removed because it created a second source of
   truth beside requirements decisions.
3. Pass the contract to `createArchitectOutputTools`.
4. Compute `effectiveMinGoalCount` inside output tools as:
   - explicit contract count when present;
   - otherwise the existing structural minimum of 2.
5. `architectValidationFindings()` reports a blocker when the collector goal
   count is below `effectiveMinGoalCount`.
6. `isReadyToFinalize()` and `submit_architect` continue to share the same
   validation closure, so terminal-tool exposure cannot get ahead of the final
   submit result.

This is not a visual or process gate. It is a schema-level preservation of an
explicit user-owned Architect output contract.

## Acceptance

- With no explicit goal-count contract, two valid goals can still finalize with
  zero graph contracts reported as a concern.
- With `minGoalCount=20`, two valid goals keep `isReadyToFinalize()` false and
  `submit_architect` returns `BLOCKERS` with `insufficient_goal_decomposition`.
- `ArchitectAgent.coordinate` renders an Architect execution contract and passes
  the explicit min count to output tools when Requirements records
  `architect_goal_min_count`.
- Raw task text such as `不少于 15/20 个可验收 goals` does not create a goal-count
  contract unless Requirements records the structured decision.
- Visual/reference coverage gaps remain concerns, not blockers.
- Targeted tests pass.
