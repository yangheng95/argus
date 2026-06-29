# Right Toolbar Workflow Active Single Source - 2026-06-17

## Problem

The right activity toolbar still keeps a residual `selectedRightActivity`
signal next to `centerWorkbenchPanels`. Historical records already state that
right toolbar active state must derive from open center workbench panels only.

The no-directory onboarding path exposes the drift: the workflow panel is open
and visible, but the right workflow toolbar button renders `data-active="false"`
because `isRightActivityOpen("workflow")` also requires
`primaryCenterPanel() === "task"`.

## Evidence Sweep

| Command                                                                                                                                                            | Result                                                                                            | Decision                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `rg -n -F 'primaryCenterPanel() === "task"' packages/overlay/src packages/overlay/test specs`                                                                      | Only `isRightActivityOpen("workflow")` uses this extra active-state condition.                    | Remove the extra condition; visible workflow state is `centerWorkbenchPanels`.   |
| `rg -n -F 'selectedRightActivity' packages/overlay/src/main.tsx packages/overlay/test/acceptance-panel-mount.test.ts specs/new-arch`                               | `main.tsx` and static tests still keep the residual signal. Specs say it should be removed.       | Delete the signal and derive selected/active state from `centerWorkbenchPanels`. |
| `node --test --test-name-pattern "workspace intro owns first-run directory setup when no directory is set" packages/overlay/test/browser/titlebar-menubar.test.ts` | Fails because workflow button active is `false` while the onboarding workflow surface is visible. | Browser test becomes the regression check.                                       |

## Fix

- Remove `selectedRightActivity` and `setSelectedRightActivity`.
- Keep `activeRightActivity` as a derived accessor over
  `selectedCenterWorkbenchPanel`.
- Let `isRightActivityOpen("workflow")` return true whenever the workflow
  center panel is open.
- Keep `selectedCenterWorkbenchPanel` based on the ordered open panel list, so
  the selected center body is still derived from the same single source.
- Update static tests to reject the residual signal.

## Acceptance

- No `selectedRightActivity` remains in `main.tsx`.
- No right-toolbar active-state rule depends on `primaryCenterPanel() === "task"`.
- The no-directory onboarding browser test passes and shows workflow active.
- Overlay typecheck passes.
- A real browser screenshot of the onboarding workflow state is inspected.
