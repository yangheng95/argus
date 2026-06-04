# Mission Back To Panel Button

Date: 2026-06-04

## Problem

User feedback: Mission view has no visible button to return to the default
Panel.

Root cause: the only existing page-mode toggle is `#btnMission` in
`src/index.html`, inside `main.panel`. `mission.css` hides `main.panel` when
`body[data-page-mode="mission"]`, so the button that is supposed to return to
Panel is hidden together with the Panel.

## Callsite Audit

| Callsite | Current role | Disposition |
| --- | --- | --- |
| `packages/overlay/src/index.html` `#btnMission` | Visible from Panel sidebar, opens Mission. Hidden in Mission mode because `main.panel` is hidden. | Keep as Panel -> Mission entry only. |
| `packages/overlay/src/main.tsx` `#btnMission` click handler | Toggles `pageMode` both ways. | Keep harmless toggle for Panel entry and tests that open Mission. Do not rely on it for Mission -> Panel. |
| `packages/overlay/src/components/Mission.tsx` `MissionHeader` | Header has New Mission and Refresh, but no return action. | Add a visible back-to-Panel action that calls `setPageMode("panel")`. |
| `packages/overlay/src/i18n/*.json` `mission.*` | `mission.back` was removed after the in-page button was deleted. | Restore `mission.back` and `mission.back_title`. |
| `packages/overlay/test/mission-html-entry.test.ts` | Asserts sidebar Mission entry and toggle wiring. | Add source assertions for the Mission in-page back button. |
| `packages/overlay/test/mission-i18n.test.ts` | Explicitly excludes `mission.back`. | Require the restored keys. |
| `packages/overlay/test/task-list-perf.test.ts` | Opens Mission with `#btnMission`, then tries to return with the same hidden button. | Open with `#btnMission`, return with `[data-ui="mission-back-panel"]`, reopen with `#btnMission`. |

## Acceptance

- Mission mode always shows a visible button that returns to Panel.
- Returning to Panel preserves the existing page-mode behavior: selected task,
  conversation state, and Mission component state are not cleared.
- Tests cover the restored UI contract and locale keys.
