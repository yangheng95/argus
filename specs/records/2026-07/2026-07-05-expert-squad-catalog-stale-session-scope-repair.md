# Expert Squad Catalog Stale Session Scope Repair

## Recall

User report: after switching to a project without external expert squads, the overlay raised `source: expert-squad` for `GET /expert-squad/catalog?directory=C%3A%5CUsers%5Cchuan%5Cmyhexin-local%5Cdemos%5Ceconomy%5Ccalculator&sessionID=ses_0cf4db568ffe904Wqo1QXc3jpq`, and the backend correctly returned `NotFoundError: Session not found`.

Acceptance criteria:

- A project-level expert-squad catalog request must not include a stale `sessionID` after the visible project directory changes.
- A project without `.opencorvus` expert squads must still load the project catalog using the built-in `general`/scheduler authority and no session override.
- Selected task catalog loading remains session-scoped only after the selected task's root session is resolved for that task.
- The fix must not add 404 fallback, retry fallback, backend compatibility, or catalog error masking.
- Overlay tests must cover the stale standalone session plus switched directory case.

Hard constraints:

- No fallback or compatibility path.
- No double source for catalog scope.
- Keep task-root session scope behavior for selected tasks.
- Do not restart or refresh the running OpenCorvus / overlay process during validation.

Landed sources read before implementation:

- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-05-overlay-expert-squad-settings-redesign.md`
- `specs/records/2026-07/2026-07-05-expert-squad-skill-projection-completeness.md`
- `specs/records/2026-07/2026-07-05-build-web-clone-reference-context-repair.md`

Repository grep:

- `rg -n "expertSquadCatalogScope|expertSquadCatalogDirectory|activeSessionID|rootTaskSessionID|activeTaskID|taskSwitching|taskOwningDirectory" packages/overlay/src packages/overlay/test`
- `packages/overlay/src/services/expert-squad-scope.ts` is the single catalog scope producer for settings expert-squad and skill market surfaces.
- `packages/overlay/src/services/expert-squad.ts` only serializes the provided scope and should keep requiring explicit project or session scope.
- `packages/overlay/src/store/board.ts` defines `activeSessionID()` as the selected standalone session source, while `rootTaskSessionID()` is the selected task root session resolver.
- `packages/overlay/test/expert-squad-scope.test.ts` already covers task-root pending/session behavior and request key stability.

Independent agent feedback: none for this targeted repair. The defect is local and directly evidenced by the overlay scope code path.

## Root Cause

`expertSquadCatalogScope()` combined `settingsStore.directory` with `activeSessionID()` whenever no task was selected. During a project switch, `settingsStore.directory` can already point at the new project while `boardStore.selectedSource` still carries a standalone session from the previous project. That creates a structurally invalid catalog request: new directory plus stale session ID.

The backend `Session not found` response is correct. The frontend should not send a session-scoped catalog request unless the selected task root session is the intended catalog authority.

## Repair Plan

1. Make no-selected-task expert-squad catalog scope project-scoped.
2. Keep selected-task catalog scope pending during task switching and session-scoped only when `rootTaskSessionID()` resolves.
3. Add a regression test that sets a stale standalone session and switches the project directory, then asserts the catalog path has no `sessionID`.
4. Run the targeted overlay expert-squad scope test.
