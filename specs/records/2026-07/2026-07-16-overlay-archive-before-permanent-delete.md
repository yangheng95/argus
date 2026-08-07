# Overlay archive before permanent delete

## Recall

| Item | Notes |
| --- | --- |
| User request | 把 Chat、Mission 和 Task 的 Overlay 删除按钮换成归档按钮；只有进入 Settings 的 Archive 页面后才允许真正删除。 |
| Acceptance criteria | (1) Work Ledger 中 Chat / Mission / Task 的原删除操作变为归档图标和归档语义，不再调用永久 DELETE；(2) 归档前必须完成各实体既有 stop / abort / cancel settlement，失败时保留活跃记录；(3) 默认 Work Ledger 和 Task 列表不显示归档记录；(4) Settings > Archive 只显示归档记录，提供 Restore 和二次确认的永久 Delete；(5) 永久 Delete 仍复用既有后端原子 close-before-delete 路径；(6) 后端、Overlay service、设置页交互和真实浏览器截图全部通过验收。 |
| Hard constraints | No fallback or compatibility path; one persisted archive source per entity; no gate/header that pretends a request came from Settings; no database migration (the unreleased schema is rebuilt under the new paradigm); no git reset/worktree; preserve unrelated dirty files; do not restart or refresh the user's running OpenCorvus/Overlay; Playwright runs through Node; frontend completion requires screenshot review. |
| Sources read | `AGENTS.md`; `specs/artifacts/长程编排测试.md`; `specs/current/architecture/07-panel.md`; `specs/records/2026-07/2026-07-08-atomic-close-before-delete.md`; `specs/records/2026-06/2026-06-29-stop-before-delete-governance.md`; `specs/records/2026-07/2026-07-08-mission-task-chat-toolbar-consolidation-impact.md`; current Session, Mission, Task API, Work Ledger, Settings, and Overlay service/component sources. |
| Whole-repository search evidence | `rg -n "deleteWorkLedgerMission|deleteWorkLedgerTask|deleteWorkLedgerChat|onDeleteMission|onDeleteTask|onDeleteChat|deleteMission\\(|deleteTask\\(|deleteCodingAssistantSession\\(" packages/overlay/src packages/overlay/test`; `rg -n "operationId: \"(mission|task|coding\\.session)\\.(delete|archive)|EngineService\\.delete(Task|Session)|Session\\.setArchived|time_archived|listWorkLedger|WorkLedgerListQuery" packages/opencorvus/src packages/opencorvus/test`; `rg -n "listProjectTasks|searchProjectTasks|listGlobalTasks|listMissionTasks|EngineTaskTable" packages/opencorvus/src`; `rg -n "CONFIG_SECTIONS|CONFIG_NAV_GROUPS|settings.nav.archived|ArmedConfirmButton|task.delete_button_title|mission.ledger.delete_title|coding_assistant.ledger.delete_title" packages/overlay/src packages/overlay/test`. |
| Independent agent feedback | Not collected. The active collaboration policy allows sub-agents only when explicitly requested; local source inspection and focused executable tests are the evidence source. |

## Root cause

The Overlay currently wires every Work Ledger destructive action directly to the permanent backend DELETE route. Session-backed Chat and Mission records already have one durable `session.time_archived` source and their normal projections exclude it, but Task has no corresponding persisted archive fact. Therefore a UI-only icon or text replacement would leave Task in canonical task APIs and would not create a Settings-owned deletion workflow.

The Settings sidebar already renders an `Archived` group label, but the only row beneath it is About; there is no archive panel, no exact archived-only projection, and no restore/delete lifecycle. Permanent backend deletion is already correctly atomic and must remain the single physical-delete implementation.

## Call-point disposition

| Surface / call point | Current behavior | Disposition |
| --- | --- | --- |
| `Session.setArchived`, `SessionTable.time_archived` | Durable archive source for Chat and Mission; normal session projections exclude archived rows. | Keep as the only Chat/Mission archive fact; extend explicit restore input. |
| `EngineTaskTable`, `viewTask`, Task list store queries | No task archive fact; every task remains visible until physical delete. | Add `time_archived`, project it through Task/Work Ledger models, and exclude archived tasks from ordinary list queries. |
| `EngineService.deleteTask` / `deleteSession` | Stop/settle before physical delete. | Keep unchanged as the only permanent-delete implementation; Settings calls these existing DELETE routes. |
| Mission and Coding routes | Abort and delete are separate; no archive route. | Add explicit archive/restore routes. Archive first reuses the real stop/abort settlement and only then writes the archive timestamp. |
| Task route | DELETE only. | Add archive/restore route backed by one EngineService task archive operation that cancels and settles before writing `time_archived`. |
| `listWorkLedger` / `/work-ledger` | Normal active projection only. | Preserve the normal projection and add one exact archived-only route for Settings; archived Mission-child Tasks are returned as independently manageable archived rows. |
| `WorkLedger.tsx` + `main.tsx` delete callbacks | Double-confirm Trash action invokes permanent DELETE. | Replace the three callbacks with archive callbacks and an Archive glyph; remove permanent deletion from the Work Ledger UI. Project deletion remains unchanged. |
| `CONFIG_SECTIONS` / `ConfigDialogHost` | Single settings navigation source; Archived label currently precedes About only. | Add an `archive` section through `CONFIG_SECTIONS`, render `ArchivePanel`, and keep About as a separate terminal settings item. |
| Existing Overlay delete services | Permanent DELETE plus local projection cleanup. | Keep for ArchivePanel only; add archive/restore service functions for Work Ledger and settings restore. |
| SDK/OpenAPI/docs | Generated DELETE contracts only. | Regenerate checked API/SDK sources for archive routes and update API docs through the existing generators. |

## Benchmark contract

- Task definition: move normal Chat/Mission/Task removal to durable archive; make Settings > Archive the only Overlay surface with permanent deletion.
- Input: active and archived Chat, Mission, standalone Task, and Mission-child Task records, including active work that must settle and failure cases that cannot settle.
- Output: active rows disappear only after durable archive succeeds; archived rows appear in Settings with exact kind/title/directory/time, Restore, and armed permanent Delete; failures remain visible with the original error.
- Environment: Windows host workspace is the source; focused Bun tests use isolated temporary databases; Overlay visual verification uses the existing Vite/browser fixture and Node Playwright runner, never the user's live Overlay.
- Timeout: backend suites use the repository inactivity runner or test-local settlement evidence; browser runner uses its existing activity-driven timeout. No benchmark uses a process-start wall-clock timeout as success evidence.
- Acceptance metrics: all focused assertions pass; OpenAPI/SDK, i18n, typecheck, docs, and schema checks pass; browser interactions prove Work Ledger archive sends no DELETE, Settings restore removes the archived row, Settings permanent delete sends DELETE only after armed confirmation; reviewed desktop screenshot has no clipping, misleading delete affordance, or empty About/Archive grouping defect.

## Plan

1. Add one persisted Task archive timestamp and archive/restore service methods; make active Task/Mission/Chat list projections exclude archived rows and add an exact archived-only Work Ledger projection.
2. Add explicit archive/restore routes for Task, Mission, and Coding Assistant Chat. Archive performs stop/cancel settlement before persistence; restore only clears the archive timestamp and does not restart work.
3. Replace Work Ledger Chat/Mission/Task delete callbacks and Trash affordances with archive callbacks and mature Lucide archive glyphs. Keep project deletion unchanged.
4. Add Settings > Archive through the existing config-section registry. Implement exact archived-row loading, Restore, and `ArmedConfirmButton` permanent deletion using the existing delete services.
5. Add backend and Overlay regression tests, regenerate OpenAPI/SDK/docs, run focused inactivity-aware tests, build/typecheck, then run a Node Playwright interaction and screenshot benchmark.
6. Review the screenshots and diff manually, correct visual or semantic defects, run document-health checks, commit only this task's files with the required `dsw-33987` prefix, and push the current primary branch to `legacy-remote`.

## Validation log

- `packages/opencorvus`: `bun run typecheck` passed.
- `packages/overlay`: `bun run typecheck` and `bun run check:i18n` passed.
- Focused backend archive routes passed: Task archive/restore and incomplete settlement, Mission archive/restore, Chat archive/restore and incomplete settlement, archived-only Work Ledger projection, and Mission-delete child Task re-exposure.
- Focused Overlay services passed for Task, Mission, and Chat archive requests with explicit row directories.
- Work Ledger archive affordance and Mission i18n contract tests passed.
- SDK generation and typecheck passed; `bun run api:routes-check` passed with 261 operations; `bun run docs:check` passed.
- Node Playwright benchmark `node test/browser-runner.mjs test/browser/archive-lifecycle-browser.test.ts` passed. It proved Work Ledger archive sends PATCH and no DELETE, Restore sends `{ archived: false }`, and permanent Task DELETE occurs only after the Settings armed-confirm interaction.
- Visual review passed for `.scratch/work-ledger-archive-action.png` and `.scratch/archive-settings-lifecycle.png` at 1440×960: no clipping or overlap; archive stays neutral in Work Ledger; Settings keeps Restore neutral and permanent delete destructive.
- Repository-wide unrelated checks remain non-green in the pre-existing dirty worktree: the Overlay unit runner stops on stale `App.tsx` assertions and three unrelated removed activity tooltip keys; document-health also reports the separately untracked `2026-07-16-webfetch-inline-attachment-e2e.md` referenced by the monthly README. These are not archive lifecycle failures and were not rewritten or staged by this task.
