# Retire Auto Iteration

Date: 2026-06-24

## Problem

`assistant.auto_iteration` was introduced on 2026-05-17 by commit
`b0115e434d feat(opencorvus): gate auto iteration behind config`. It was meant
to toggle a host-side repair iteration loop after failed goal waves or rejected
acceptance reviews.

The setting now creates a false behavioral branch in prompts. Build and
Orchestrator prompts mention `assistant.auto_iteration=false` as a bounded mode,
and frontend-design uses the same setting to vary review-pass requirements. In
the 2026-06-24 build evidence, that branch helped frame repo-local dependency
and toolchain failures as acceptable failed endpoints even though retry proved
the dependency graph was repairable in the goal worktree.

## Call-Site Inventory

`rg -n "auto_iteration|autoIteration" packages/opencorvus/src packages/opencorvus/test packages/sdk specs AGENTS.md -S`

| Surface                                                             | Current behavior                                                                                                       | Change                                                                                                       |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `packages/opencorvus/src/config/config.ts`                          | Exposes `assistant.auto_iteration` in the project config schema.                                                       | Delete the field from schema; unknown config keys remain rejected by the existing strict config contract.    |
| `packages/opencorvus/src/engine/config.ts`                          | Materializes `auto_iteration` into `EngineConfigType`.                                                                 | Delete the field and default.                                                                                |
| `packages/opencorvus/src/build/agent.ts`                            | Reads `EngineConfig.auto_iteration`, accepts `RunInput.autoIteration`, and renders dynamic Build auto-iteration prose. | Remove the input and config branch; compose a single Build core.                                             |
| `packages/opencorvus/src/orchestrator/agent.ts`                     | Renders dynamic auto-iteration guidance and passes the flag into task description.                                     | Render one same-task recovery contract derived from task facts only.                                         |
| `packages/opencorvus/src/engine/describe.ts`                        | Renders different failed-goal closure guidance based on `autoIteration`.                                               | Render one failed-goal recovery instruction.                                                                 |
| `packages/opencorvus/src/frontend-design/agent.ts`                  | Reads the setting and changes frontend-design review prompt text.                                                      | Render fixed frontend-design review discipline.                                                              |
| `packages/opencorvus/src/frontend-design/output-tools.ts`           | Requires a second review note only when auto-iteration is true.                                                        | Require two review notes consistently.                                                                       |
| `packages/opencorvus/src/frontend-design/schema.ts`                 | Documents review notes in terms of `assistant.auto_iteration`.                                                         | Describe the fixed two-pass review contract.                                                                 |
| `packages/opencorvus/src/prompt/core/frontend-design-core.txt`      | Documents auto-iteration-specific review pass counts.                                                                  | Replace with fixed review-and-revise guidance.                                                               |
| `packages/opencorvus/src/prompt/core/build-core.txt`                | Mentions `assistant.auto_iteration=false` in toolchain blocker rules.                                                  | State the invariant directly without the deleted setting.                                                    |
| `packages/opencorvus/src/orchestrator/tools.ts`                     | Tells frontend-design to follow `assistant.auto_iteration`.                                                            | Tell frontend-design to perform the fixed review passes.                                                     |
| `packages/opencorvus/src/agent/prompt-profile.ts`                   | Frontend expert squads do not explicitly teach dependency repair discipline.                                           | Add frontend dependency/toolchain handling to frontend-replica and frontend-automation-debug Build overlays. |
| `packages/sdk/openapi.json`, `packages/sdk/js/src/gen/types.gen.ts` | Expose generated `auto_iteration` field.                                                                               | Remove the generated field.                                                                                  |
| Tests                                                               | Assert auto-iteration branches.                                                                                        | Replace with tests that assert the setting is gone and fixed prompt behavior remains.                        |

## Decision

Delete `assistant.auto_iteration` completely instead of keeping it as a dormant
or compatibility field.

Runtime behavior becomes:

1. Build must repair repo-local dependency, script, port, runner, browser,
   preview, and worktree blockers while concrete local repair actions remain.
2. Orchestrator must route failed goals through same-task recovery from the
   available facts instead of asking the operator unless the blocker is external,
   destructive, or outside the task.
3. Frontend-design must always complete two review passes before handoff: one
   for evidence/template completeness and one for downstream implementation
   feasibility.
4. Expert-squad prompt overlays teach frontend Build agents to inspect the
   target project's package manager and manifest, repair `node_modules`/local
   binary/package-link projection in the goal worktree, then rerun the original
   verification commands before `merge_back`.

No host-side retry gate, workflow branch, fallback config, or compatibility
adapter is added.

## Acceptance

- `rg -n "auto_iteration|autoIteration" packages/opencorvus/src packages/opencorvus/test packages/sdk AGENTS.md -S` has no matches.
- `Config.Info.safeParse({ assistant: { auto_iteration: true } })` fails.
- Build prompt composition has one static contract and no auto-iteration mode.
- Orchestrator failed-goal description has one same-task recovery instruction.
- Frontend template output tools require two review notes without options.
- Frontend expert-squad Build overlays mention dependency/toolchain repair in
  the goal worktree and original checker reruns.
- Focused tests for config, prompt composition, frontend-design output tools,
  prompt profiles, and task description pass.
