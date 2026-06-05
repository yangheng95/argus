# Mission Task Projection

Date: 2026-06-05

## Problem

The Mission page is still missing durable task projection:

- The ledger action says `Panel` with a panel icon, but the target surface is the Task panel.
- Mission records do not include the tasks created by that mission.
- The conversation header still renders a close button where the Mission runtime should be shown.
- The right Channels rail only shows channel runtime, not Mission-created task stats.

## Call-Site Audit

| Surface | Files | Decision |
| --- | --- | --- |
| Mission task creation provenance | `packages/opencorvus/src/tool/panel.ts`, `packages/opencorvus/src/prompt/core/mission-core.txt` | Keep `panel.create_task` as the single host write path. It already stamps Mission-created tasks with `source: "mission"` and `metadata.mission.{id, session_id}`. Do not add a parallel table or client-supplied provenance. |
| Task storage/read model | `packages/opencorvus/src/engine/engine.sql.ts`, `packages/opencorvus/src/engine/store.ts`, `packages/opencorvus/src/engine/task-status.ts` | Use existing `engine_task.metadata` as the durable source and add a store read model that filters `metadata.mission.id`. No DB migration or duplicate FK column. |
| Mission API schema | `packages/opencorvus/src/server/routes/mission.ts` | Extend `MissionRecord` with `tasks` and `taskStats`. Rename/delete responses return the same schema. |
| Overlay Mission types and consumers | `packages/overlay/src/services/mission.ts`, `packages/overlay/src/components/Mission.tsx`, `packages/overlay/src/components/MissionList.tsx` | Mirror server fields in the client type. Ledger renders child task projections under each mission. Right rail receives selected Mission stats or ledger aggregate when no Mission is selected. |
| Mission copy/i18n | `packages/overlay/src/i18n/en-US.json`, `packages/overlay/src/i18n/zh-CN.json`, `packages/overlay/test/mission-i18n.test.ts` | Change `mission.back` to `Task`; add task projection and stats labels. |
| Mission styling | `packages/overlay/src/styles/surfaces/mission.css` | Add compact child-task rows, runtime label, and stats block styles using existing design tokens. |
| Tests | `packages/opencorvus/test/server/mission-routes.test.ts`, overlay Mission tests | Add route coverage for mission task projection and structural overlay assertions for the user-visible contract. |

## Contract

`GET /mission` returns:

```ts
type MissionTaskProjection = {
  id: string
  title: string
  status: "queued" | "active" | "completed" | "failed" | "cancelled"
  priority: "critical" | "high" | "normal" | "low"
  source: string
  directory: string
  created: number
  updated: number
  started?: number
  completed?: number
}

type MissionTaskStats = {
  total: number
  queued: number
  active: number
  completed: number
  failed: number
  cancelled: number
}
```

This is a read-model projection of `engine_task.metadata.mission.id`. The UI must not infer ownership from messages, task titles, or selected conversation state.
