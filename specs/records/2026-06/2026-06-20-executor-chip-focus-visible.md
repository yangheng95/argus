# Executor Chip Focus Visible

Date: 2026-06-20

CSS means Cascading Style Sheets. GUI means Graphical User Interface. UI means
User Interface.

## Problem

The bottom composer executor chips are keyboard-focusable Kobalte Popover
triggers rendered through the shared Button primitive. Their local composer
surface added a stronger hover wash and inset ring, but keyboard
`:focus-visible` only received the generic Button outline. The same entry point
therefore had different visual feedback for mouse and keyboard users.

## Recall

| Source                                                    | Existing decision                                                                                                                            |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-18-executor-chip-density-guard.md`               | Executor chips stay in the shared compact Button spacing contract.                                                                           |
| `2026-06-19-executor-model-listbox-primitive.md`          | Executor selection popovers use mature Kobalte primitives; chip triggers remain Button-backed Popover triggers.                              |
| `2026-06-19-dropdown-menu-highlighted-contrast-source.md` | Popup and selector focus/highlight states must be proven at the real runtime state source, not patched with local color fallbacks.           |
| `packages/overlay/src/styles/primitives/button.css`       | Button owns the generic `:focus-visible` outline. Component-local hover emphasis can extend it only when it shares the same selector source. |

## Impact Sweep

| Sweep                                                                                                                                  | Result                                                                                      | Decision                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `rg -n -F '.executor-chip-slot .oc-button[data-ui^="executor-chip-"]:hover' packages/overlay/src packages/overlay/test specs/new-arch` | The executor chip hover emphasis had one live CSS owner.                                    | Extend this owner to `:focus-visible`.                    |
| `rg -n -F '.executor-chip-slot .oc-button[data-ui^="executor-chip-"]:focus' packages/overlay/src packages/overlay/test specs/new-arch` | No executor chip focus selector existed.                                                    | Add `:focus-visible`, not broad `:focus`.                 |
| `ExecutorSelector.tsx` inspection                                                                                                      | Chips are `Popover.Trigger as={Button}` with `data-ui="executor-chip-${side}"`.             | Keep the component primitive unchanged.                   |
| `executor-selector-redesign.test.ts` inspection                                                                                        | Existing browser coverage already loads the real overlay and screenshots executor popovers. | Add keyboard Tab focus evidence to the same browser test. |

## Fix

Merge `.executor-chip-slot .oc-button[data-ui^="executor-chip-"]:focus-visible`
into the existing hover state. This keeps the local visual source single and
continues to inherit the Button primitive's generic focus outline.

## Acceptance

- Static tests require the executor chip hover and `:focus-visible` selectors to
  be grouped.
- Static tests reject a broad `:focus` selector.
- Browser coverage tabs to `[data-ui="executor-chip-mirror"]`, verifies
  `:focus-visible`, compares computed foreground/background/box-shadow with the
  hover state, and saves a focused chip screenshot.
- No new token, raw color, fallback, or component fork is introduced.
