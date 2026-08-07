# Mission Board AI-primary stable create dialog

Status: implementation and direct end-to-end verification complete; the backend Base audit's stale terminal verdict is recorded below.
Date: 2026-08-07

## Recall

### User request

- The Task Board create dialog must not alternate between a narrow and a wide layout.
- Artificial Intelligence creation and task management are the primary entry; manual creation is secondary.
- Publish a real Task through the running backend and exercise every Task Board feature end to end.

### Acceptance criteria

1. Opening the create dialog and switching between Artificial Intelligence and manual modes preserves one compact desktop dialog width.
2. The dialog opens in Artificial Intelligence mode, places Artificial Intelligence first in the mode control, and focuses its request field.
3. Manual creation remains available as the secondary mode and retains title, request, Project, Expert Squad, validation, and submit behavior.
4. The real Task Board page is opened from the running Overlay, both modes are exercised through real interaction, and screenshots are personally reviewed without creating or running User Interface automation tests.
5. A real model-backed Mission is submitted through `POST /mission/wake` on the running managed backend, then its canonical board record, conversation, and lifecycle facts are inspected through backend/Application Programming Interface reads and the real board.
6. Existing management features are exercised: navigation summary, lane counts, search, Project filter, refresh, card open, manual draft creation, draft dispatch, and deletion. Destructive cleanup is limited to records created by this verification.
7. Focused non-User-Interface checks, Overlay typecheck/build, documentation health, diff review, commit, and legacy remote push pass.

### Hard constraints

- Mission remains the sole top-level Task Board identity; Task remains nested execution detail.
- Use the existing Kobalte-backed Dialog, SegmentedControl, fields, select controls, and buttons.
- Do not add, modify, or run User Interface automation tests or screenshot baselines.
- Do not add a viewport-specific layout branch, fallback, duplicate create path, or lifecycle state.
- Backend publication must use the canonical streaming Mission wake route and create an ordinary visible user message.
- Commit subjects start with `dsw-33987`; push only to legacy remote.

### Sources read

- `AGENTS.md`
- `specs/records/2026-08/2026-08-06-mission-board-creation-and-summary-design.md`
- `specs/records/2026-08/2026-08-06-mission-board-creation-and-summary-implementation-plan.md`
- `packages/overlay/src/components/MissionCreateDialog.tsx`
- `packages/overlay/src/components/MissionBoard.tsx`
- `packages/overlay/src/components/ui/Dialog.tsx`
- `packages/overlay/src/styles/cascade/base.css`
- `packages/overlay/src/styles/surfaces/dialog.css`
- `packages/overlay/src/styles/surfaces/mission-board.css`
- `packages/overlay/src/services/mission.ts`
- `packages/opencorvus/src/server/routes/mission.ts`
- The two user-provided current dialog screenshots.

### Whole-repository search result

- `MissionCreateDialog` currently initializes and orders `manual` before `ai`, so the declared product priority is inverted at the component authority.
- The shared dialog primitive already defines the compact `--ui-dialog-width` token at 380 scaled pixels.
- Mission Board overrides that mature primitive with a private 760-pixel width derived from the full Overlay shell, causing the same create surface to appear compact in a constrained shell and oversized in a wide shell.
- Manual draft, dispatch, immediate Artificial Intelligence wake, shared Mission list/counts, Project filter, search, refresh, card open, and permanent delete already have canonical backend/service owners; this change does not need a second path.
- A real managed backend is listening on `127.0.0.1:7878`, and the current Overlay development page is available on `127.0.0.1:5297`.
- No existing User Interface automation test was opened or run in the touched implementation paths.

### Independent agent feedback

None requested. No sub-agent was used.

## Implementation plan

- [x] Remove the Mission-specific wide sizing owner so the create surface inherits the shared compact Dialog width in every mode and shell width.
- [x] Make Artificial Intelligence the initial and first mode, and focus the request field whenever the dialog opens.
- [x] Run formatting/static checks, Overlay typecheck, localization check, production build, documentation health, and `git diff --check`.
- [x] Open the real development page, exercise the Task Board and both create modes, capture current screenshots, inspect them, and correct any observed visual defect.
- [x] Publish the all-feature end-to-end Mission through the managed backend, inspect its Task Board/conversation facts, exercise management actions, and record exact evidence. Mission `c17f455354d98ebe` and child Task `tsk_fd9d8b857001GF6jao0D5grRs6` ran the complete Base workflow.
- [x] Perform a second diff/status review, update this record with outcomes, commit, and push to legacy remote.

## Verified implementation and runtime evidence

- Commit `5b9bf99a95` made Artificial Intelligence the default and first mode, focused its request field, and removed the Mission-specific 760-pixel width owner. The shared Dialog primitive is now the only width authority.
- Real Overlay inspection measured the `.dialog-form` surface at exactly 380 pixels in both Artificial Intelligence and manual modes. Both modes also measured 581 pixels high after the model-selection repair.
- The first Artificial Intelligence submission exposed a second root defect: the enabled primary action sent `model: undefined` and received `No model configured for agent "mission"`. The create dialog now reuses the existing `ComposerModelSelector`, requires a selected model before enabling Artificial Intelligence submission, and raises that selector's portal above the Dialog through the named z-index token.
- The repaired selector was visually inspected open, filtered to `openai/gpt-5.6-terra`, and used to create Mission `c7bf69870021d757`, session `ses_0260d0dc0ffeBUAAv73nvYXNTB`. The real page immediately opened that Mission conversation and the backend recorded visible `author=user` and `author=mission` messages.
- Manual Mission `b623a4d0b44f8cc1`, session `ses_0260bf75bffe35CfuJos5ly53R`, was created in Backlog. Dispatch reused the selected model and opened the same session; its backend conversation likewise contains the expected user request and Mission response.
- Search empty state, Project filtering, refresh, card open, navigation running count, five-lane hover summary, child Task title/status/progress, Backlog, Running, and Attention projection during a validation question were exercised on the real page and visually inspected. Review and Completed are represented by the same canonical five-lane projection; no synthetic records or User Interface assertions were introduced to force those states.
- The two temporary verification Missions above were deleted by exact recorded identity, both delete calls returned `true`, and the anonymous Project then returned an empty Mission list. The requested all-feature Mission `c17f455354d98ebe` was preserved.
- Browser startup initially exposed a Windows cold-start timing defect: the bundled 86.9-megabyte Node.js executable took 11.8 seconds on its first launch while the native readiness wait was fixed at five seconds. The official disconnect/connect lifecycle and a warm launch recovered the real Browser Model Context Protocol (MCP); no fake page or alternate test surface was used.

## Backend audit reconciliation

- The backend Task reached terminal `failed` because its first Tester did not operate the newly visible model selector and treated its own `model=undefined` request as a product result. Its first Visual Reviewer also reported that manual mode did not render from a stale interaction capture.
- A resumed Developer pass on the current page explicitly reversed the manual-mode finding: the manual title, Description, and Create draft controls rendered immediately at stable width. The Mission reconciler also recorded that the no-model verdict conflicts with the later successful selected-model Mission/session evidence and must not be treated as the final product conclusion.
- The same Mission moved through real Running, Attention, and Review projections; its failed child Task displayed one-of-one terminal progress and the failure badge in Review. A Completed-lane card was not manufactured merely to populate the lane.
- The Mission reconciler attempted to resume the same terminal Task for another Tester pass, but the Host did not expose the required `terminal_lifecycle_reference`; the schema-correct recovery could therefore not be dispatched. This is a remaining backend orchestration defect, not a failure of the repaired create, draft, or Dispatch paths.
- Commit `22b3bd1fad` contains the model-selection repair and this evidence record. Overlay typecheck, localization completeness, production build, documentation health, Application Programming Interface route inventory, diff checks, pre-push checks, and the legacy remote push all passed.
