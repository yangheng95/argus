# Browser Preview Ready Open Regression

## Problem

The right toolbar browser preview could collapse immediately after the user opened it. The preview panel resolves the task-scoped browser preview target asynchronously, then calls its `onReady` callback. `main.tsx` wired that callback to `selectRightActivity("browser")`.

`selectRightActivity` is the toolbar click handler and intentionally toggles an already-open activity closed. Reusing it for the preview-ready callback turned a successful target resolution into a second toggle, so the browser workbench panel closed itself after opening.

## Call Points

| Symbol                     | Call point                                                      | Decision                                                          |
| -------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| `selectRightActivity`      | `SideActivityToolbar onSelect`                                  | Keep as the user-click toggle entrypoint.                         |
| `selectRightActivity`      | `BrowserPreviewPanel onReady`                                   | Replace. Ready notifications must be idempotent open, not toggle. |
| `openCenterWorkbenchPanel` | Workspace diff, file editor, acceptance focus, coding assistant | Keep as existing idempotent panel open primitive.                 |

## Fix

Add `openRightActivity(activity)` as the programmatic activity-open entrypoint. It delegates assistant activation to the existing assistant path and otherwise calls `openCenterWorkbenchPanel(activity)`. `BrowserPreviewPanel.onReady` uses `openRightActivity("browser")`, while toolbar clicks continue using `selectRightActivity`.

## Verification

- Source regression test asserts `BrowserPreviewPanel.onReady` is wired to `openRightActivity("browser")`.
- Source regression test asserts the stale `onReady={() => selectRightActivity("browser")}` wiring is absent.
