# Mission Task Title Format

Date: 2026-06-13

## Problem

Mission-created engine tasks currently inherit the generic task title behavior:
`EngineService.createTask` uses `input.title` when present and otherwise derives
from the first non-empty request line. `panel.create_task` does not expose a
`title` field, so the Mission agent cannot supply a stable task name and the
task ledger ends up with request-fragment titles.

## Call-Site Audit

| Surface | Evidence | Decision |
| --- | --- | --- |
| Mission dispatch prompt | `packages/opencorvus/src/prompt/core/mission-core.txt` dispatches work through `panel action=create_task` and already owns Mission task brief rules. | Add an explicit Mission title contract: every Mission dispatch supplies a short semantic `title`; the host owns the final `Phase xx:` prefix. |
| Panel capability schema | `packages/opencorvus/src/panel/capability.ts` defines the shared `create_task` schema and currently has no `title`. | Add optional `title` to the shared action schema so Mission can send it through the existing single write path. |
| Panel task write path | `packages/opencorvus/src/tool/panel.ts` is the single host path that stamps `source: "mission"` and `metadata.mission`. | For actor `mission`, require `params.title` and pass it as the semantic title to `EngineService.createTask`. Do not compute the final ordinal here because this runs before the task-creation owner lock. |
| Generic task creation | `packages/opencorvus/src/task-api/index.ts` still accepts optional `title` and otherwise derives from request. | Keep generic fallback for non-Mission tasks. For `source: "mission"` + `metadata.actor: "mission"` + `metadata.mission`, require `title` and compute the final formatted title inside the existing task-creation owner lock. |
| Mission task projection | `packages/opencorvus/src/engine/store.ts::listMissionTasks` is the single query for Mission-created tasks. | Reuse it to allocate the visible `Phase xx:` prefix from persisted Mission tasks. No new table or duplicated lineage source. |
| Tests | `packages/opencorvus/test/task-api/mission-task-title-format.test.ts`, `packages/opencorvus/test/panel/actor-provenance.test.ts`, `packages/opencorvus/test/tool/panel-capability.test.ts`, `packages/opencorvus/test/tool/schema-snapshot.test.ts`, `packages/opencorvus/test/agent/agent.test.ts`. | Cover formatted Mission titles, missing-title rejection, schema exposure, schema snapshot, and prompt contract. |

## Contract

Mission-created task titles are host-formatted exactly as:

```text
Phase xx: semantic title
```

Rules:

- `xx` is a two-digit ordinal based on existing persisted tasks for that Mission
  session, computed inside `EngineService.createTask` after the existing
  `metadata.mission.session_id` owner lock is acquired.
- `<semantic title>` is supplied by the Mission agent as `create_task.title`.
- Missing or blank Mission titles throw before task creation. There is no
  fallback to request-derived titles on the Mission path.
- Non-Mission `create_task` callers may continue to omit `title`; they keep the
  existing generic behavior.

## Acceptance

- `panel.create_task` schema exposes `title`.
- A Mission-created task with `title: "Implement settings route"` is persisted
  as `Phase 01: Implement settings route`.
- A second persisted Mission task for the same Mission session makes the next
  created title use `#02`.
- A Mission-created task without `title` is rejected and does not call
  `EngineService.createTask`.
- Mission prompt tells the agent to pass a semantic title and not include the
  host prefix itself.
