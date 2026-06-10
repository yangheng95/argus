# Task Config Overrides Immediate Effect (2026-06-10)

## Problem

Active task `tsk_eb0b5db4a001llno0GgFW2n14w` showed that most agents used `kimik26/kimik26`, while every integrity session still used `hexin/cy-claude-sonnet-4-6` and failed with `UnknownError: Error: unknown certificate verification error`.

Read-only DB evidence:

| Session kind | User-message model |
| --- | --- |
| orchestrator / requirements / architect / frontend-design / frontend-research / build / explore | `kimik26/kimik26` |
| integrity | `hexin/cy-claude-sonnet-4-6` |

The task root session metadata contained `taskConfigSnapshot.agent.integrity.model = "hexin/cy-claude-sonnet-4-6"`. `EffectiveConfig.base({ taskID })` used that snapshot before the live project config, so changing `.opencorvus/opencorvus.jsonc` after task creation did not affect task-scoped agent model resolution.

## Callsite Census

Full-repo grep before implementation:

| Surface | Callsites | Decision |
| --- | --- | --- |
| `EffectiveConfig.TASK_SNAPSHOT_KEY` | `config/effective.ts`, task creation, task-config tests | Keep the snapshot as task creation/audit metadata; stop using it as runtime effective config. |
| `EffectiveConfig.base` | agent model/prompt resolution, session config route, task API, session LLM, memory, tools | Preserve one entrypoint; change its base source to live root-session project config. |
| `resolveAgentModelRef` | native agents, session wake, command/shell exec, prompt parts | No new resolver; it continues to read `EffectiveConfig.base/effective`. |
| session `configOverlay` | session route + `resolveSessionOverlay` | Keep as the immediate task/root override layer over live project config. |

## Design

- Runtime effective config for a session/task is always live project config from the root session directory plus the root session `configOverlay`.
- `taskConfigSnapshot` remains persisted for historical/debug metadata and task-creation-time permission initialization, but it is not an agent runtime config source.
- This directly replaces the frozen snapshot behavior; no fallback, no gate, no parallel resolver.

## Tests

- Update task config tests to assert live project config changes override stale task snapshots for both top-level model and per-agent model.
- Keep explicit-provider tests that pass config objects directly to Provider unchanged.
