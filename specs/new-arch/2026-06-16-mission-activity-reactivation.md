# Mission Activity Reactivation - 2026-06-16

## Trigger

Released Mission UI can show Mission records on initial entry, but after the
operator switches from Mission to another left activity and then returns to
Mission, the Mission ledger can render empty even though `GET /mission` still
returns Mission sessions and Mission-created tasks.

## Root Cause

`a7ffb0ae26 dsw-0000 Retire mission panel into left activity` moved Mission from
the old page-mode surface into the left activity rail. That commit introduced
`Mission.active` and parked the Mission list resource with
`if (!props.active) return null`.

This changed the lifecycle from a page-level mode to a repeatedly hidden/shown
left-panel activity. The browser coverage added later checks initial Mission
rendering and Mission wake refresh, but it does not assert the path:

1. Mission activity is visible.
2. Operator opens Tasks or another left activity.
3. Operator returns to Mission.
4. Existing Mission records must be visible again.

Backend data is intact: the canonical Mission ledger remains `GET /mission`, and
Mission-created tasks remain normal task rows with `source: "mission"`.

## Call Point Sweep

| Surface | Current use | Decision |
| --- | --- | --- |
| `packages/overlay/src/components/Mission.tsx` | Owns Mission list resource and Mission record actions. | Keep Mission list backed only by `/mission`; add no task-list fallback. |
| `packages/overlay/src/main.tsx` | Owns left activity selection and passes `active` / `refreshToken` into `Mission`. | Add an explicit Mission activation token and increment it when Mission is selected. |
| `packages/overlay/test/browser/side-activity-toolbar-browser.test.ts` | Real browser coverage for left activity switching. | Add the missing Mission -> Tasks -> Mission assertion. |
| `/mission` route | Canonical Mission session list. | Unchanged. |
| `/global/tasks` route | Ordinary task sidebar list. | Unchanged; do not reinsert Mission sessions here. |

## Design

Use a single Mission activation signal in `main.tsx`:

- `missionActivityActivationToken` increments whenever `selectLeftActivity("mission")`
  or `openMissionLauncher()` activates the Mission activity.
- `Mission` receives this token as a prop.
- The Mission list resource source includes that token while active, alongside
  search and refresh tokens.

This is not a fallback or second data source. It is the explicit UI lifecycle
event that tells the same `/mission` resource to reload after the activity is
shown again.

## Acceptance

- `GET /mission` remains the only Mission ledger data source.
- Switching from Mission to Tasks and back to Mission shows existing Mission
  rows again.
- The browser side-activity test covers the reactivation path.
- Mission-created task projection still switches to the Tasks activity when
  clicked.
- No compatibility path adds Mission sessions to `/global/tasks`.
