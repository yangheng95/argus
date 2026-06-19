# Mission Task Projection Button Primitive

Date: 2026-06-19

## Problem

The 2026-06-18 mission task projection focus pass removed the old
`mission-task-projection-button` class and moved the child task selector to the
shared ledger row focus class, `.task-row-main`. That fixed keyboard focus but
left the visible selector as a raw `<button>`.

The overlay now has a stronger button primitive contract: operation and
selection buttons should render through `Button` so hover, focus, disabled
state, density, and future primitive fixes have one source.

## Recall

| Source | Evidence | Decision |
| --- | --- | --- |
| `2026-06-18-mission-task-projection-row-focus.md` | Projection rows are compact child rows under the Mission ledger and must keep visible keyboard focus. | Preserve the focus/browser coverage. |
| `MissionList.tsx` | `MissionTaskProjectionRow` renders `<button class="task-row-main mission-task-projection-select">`. | Replace the raw button with `Button`. |
| `mission.css` | Projection layout targets `.task-row-main[data-ui="mission-task-projection-select"]` and owns border/background/cursor/font. | Retarget to `.oc-button[data-ui=...]` and keep only layout/tone variables. |
| `side-activity-toolbar-browser.test.ts` | Browser flow already focuses a Mission projection selector and screenshots the focused row. | Update assertions from `.task-row-main` to `.oc-button` primitive data attributes. |

## Fix

- Render the projection selector through `<Button variant="ghost" size="md"
  tone="neutral" data-ui="mission-task-projection-select">`.
- Retarget projection CSS to
  `.mission-task-projection-row .oc-button[data-ui="mission-task-projection-select"]`.
- Remove test assertions that preserve the raw class and add guards for the
  `Button` primitive contract.

## Acceptance

- `MissionTaskProjectionRow` no longer renders a raw projection selector
  button.
- The selector node has `.oc-button`, `data-variant="ghost"`,
  `data-size="md"`, and `data-tone="neutral"`.
- Keyboard focus remains visible in the real Mission browser flow.
- Static tests reject the retired raw projection selector class.

## Verification

- `bun test packages/overlay/test/mission-launcher-component.test.ts packages/overlay/test/mission-html-entry.test.ts packages/overlay/test/mission-session-source.test.ts packages/overlay/test/overlay-architecture-guards.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `$env:OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER='1'; node --test --test-concurrency=1 --test-name-pattern "mission task projection" packages/overlay/test/browser/side-activity-toolbar-browser.test.ts`
- Visual review: `.scratch/mission-task-projection-row-focus.png`
