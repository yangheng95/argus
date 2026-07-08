# Atomic close-before-delete for Mission, task, and chat records

## Recall

| Item | Notes |
| --- | --- |
| User request | 把 mission、task 和 chat 的删除改成原子化先关闭再删除，否则可能会导致后端崩溃。 |
| Acceptance criteria | Backend DELETE routes must perform close/cancel, prove settlement, then physically delete. If close cannot be proven, return the existing typed cancellation conflict and preserve rows. The UI must not be the only owner of stop-before-delete. Task, Mission, and Coding Assistant chat deletion paths need regression coverage. |
| Hard constraints | No fallback / compatibility path; no gate that hides failed cancellation; no git reset; do not touch unrelated dirty files; no process restart. Timeouts remain inactivity/settlement based where prompt work is involved. |
| Read persisted records | `specs/artifacts/长程编排测试.md`, `specs/current/architecture/99-principles.md`, `specs/records/2026-07/README.md`, existing deletion-settlement tests under `packages/opencorvus/test/task-api`. |
| Whole-repository grep | `rg 'EngineService\.deleteSession\(|DELETE /session|coding\.session\.delete|mission\.delete|deleteTasks|Session\.removeInProject|removeInProject' packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs/records/2026-07 specs/current -S`; `rg 'ensureMissionSession|missionID|metadata.*mission|listMissionTasks|SessionWake\.wake|kind: "mission"|MissionRoutes' ...`; `rg 'deleteProject|deletedTaskCount|deleteTask|removeTask|deleteMission|removeMission|deleteChat|removeChat|DELETE|\.delete\(' ...`. |
| Relevant call points | `DELETE /task/:taskID` already calls `EngineService.deleteTask`, which cancels active tasks and waits for task loop / session prompt settlement. `DELETE /session/:sessionID` and `DELETE /coding/session/:sessionID` call `EngineService.deleteSession`, which cancels the session subtree and queue prompts before `Session.removeInProject`. `DELETE /mission/:missionID` previously called `EngineService.deleteSession` only, so Mission-owned child tasks could remain active while their Mission session was removed. `deleteCurrentProject` deletes tasks first, then remaining project sessions. |
| Independent agent feedback | Not spawned. The task did not request subagents; local grep, code inspection, and existing focused tests are the evidence source. |

## Root Cause

Task deletion already encodes the required lifecycle order, but the Mission delete route did not reuse the Mission abort semantics before physical deletion. A Mission is a session-backed product record whose child tasks notify and wake the Mission session. Deleting the Mission session while Mission-owned active or queued child tasks still exist can leave live backend work pointing at a removed session tree.

Coding Assistant chat deletion is routed through `EngineService.deleteSession`, so the implementation path is structurally correct, but server tests must keep proving the delete route preserves the chat row while a prompt is still settling. That prevents regressions in the close-before-delete contract.

## Plan

1. Extract the Mission close sequence into a route-local helper and call it from both `POST /mission/:missionID/abort` and `DELETE /mission/:missionID`.
2. Keep delete atomic at the backend route: `DELETE /mission/:missionID` closes Mission child tasks and the Mission prompt, waits for settlement, then calls `EngineService.deleteSession`.
3. Add server regression coverage:
   - Mission delete cancels active Mission child tasks before deleting the Mission session.
   - Mission delete preserves Mission and task rows and returns conflict when child task cancellation cannot settle.
   - Coding Assistant chat delete remains covered by the existing route tests and the shared `EngineService.deleteSession` settlement tests.
4. Re-run focused backend tests plus document-health link validation for the new spec index entry.

