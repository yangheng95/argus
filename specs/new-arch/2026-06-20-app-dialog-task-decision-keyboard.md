# App Dialog Task Decision Keyboard

Date: 2026-06-20

## Problem

The task queue decision dialog had been visually checked with hand-written
HTML, not the real Solid `AppDialogHost` and Kobalte-backed `SegmentedControl`
chain. A follow-up GUI review found a deeper bug: AppDialog used
`SegmentedControl`'s `onActivate` to settle the choice, but `SegmentedControl`
only called `onActivate` from pointer clicks. Kobalte prevents native button
click synthesis for Enter and Space, so keyboard activation changed selection
without settling the task decision.

## Recall

| Source                                                | Relevant decision                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `2026-06-18-app-dialog-segmented-control.md`          | Task decisions must use the shared Kobalte ToggleGroup-backed `SegmentedControl`; do not restore raw buttons or a local group. |
| `2026-06-19-kobalte-selected-state-single-source.md`  | Kobalte `data-pressed` and `aria-pressed` are the single selected-state source for segmented controls.                         |
| `2026-06-19-app-dialog-select-value-single-source.md` | AppDialog choice values are validated by the service before the dialog opens; host code must not invent a fallback value.      |

## Impact Sweep

| Sweep                                                                                | Result                                                                                                         | Decision                                                                                           |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------- | ------ | -------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `rg -n "AppDialogHost                                                                | task-queue-decision                                                                                            | app-dialog-decision                                                                                | SegmentedControl | settle | decision | app-dialog-segmented" packages/overlay/src packages/overlay/test specs/new-arch` | `app-dialog-segmented-control.test.ts` used `page.setContent()` and hand-written dialog markup. `AppDialogHost` used `SegmentedControl` with `onActivate`, and task creation opens that dialog through `createTask()`. | Replace the browser test with a real overlay fixture and keep production dialog ownership unchanged. |
| `packages/overlay/node_modules/@kobalte/core/src/toggle-group/toggle-group-item.tsx` | Kobalte prevents Enter/Space native click synthesis and routes keyboard selection through its own `onKeyDown`. | Add keyboard `onActivate` in the shared wrapper without replacing Kobalte selection.               |
| `packages/overlay/src/components/AppDialogHost.tsx`                                  | Initial focus picked the first decision item, not the current `selectValue`.                                   | Focus the already validated selected item so visual and keyboard starting points share one source. |

## Fix

- Extend `SegmentedControl` so Enter and Space call `onActivate(option.value)`
  when a consumer explicitly supplies `onActivate`.
- Preserve the existing `onChange` behavior where same-value selection does not
  call `onChange`.
- Focus the AppDialog task decision item whose `data-value` matches
  `dialogStore.app.selectValue`; only fall back to the first rendered item if no
  matching DOM node exists.
- Replace the hand-written browser fixture with a real `/ui/index.html` test
  that submits through `#chatTextarea` and `#chatSend`, opens
  `AppDialogHost`, verifies Kobalte pressed attributes, screenshots the real
  dialog, and asserts click/Enter/Space settlement reaches `POST /task` with
  the correct `queue` value.

## Acceptance

- No new dialog shell, segmented primitive, fallback route, or state gate is
  introduced.
- Task queue decision starts focused on the selected recommended value.
- Enter on the focused selected value submits `queue: false`.
- Keyboard focus can move to queue, Space submits `queue: true`.
- Pointer click on queue still submits `queue: true`.
- The browser screenshot comes from the real rendered overlay, not static HTML.
