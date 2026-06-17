# Browser Preview Evidence Test Open Path

Date: 2026-06-17

UI means User Interface. E2E means End-to-End.

## Problem

The browser-backed evidence test can falsely fail when it clicks the right
toolbar Preview button without first restoring the task-list context and
selecting the task row. Browser Preview target resolution can already call the
idempotent `openRightActivity("browser")` path. The right toolbar click is still
the user toggle path, so an unconditional click can close an already-open
Preview panel.

Visual review also exposed a fixture completeness gap: the test page produced an
unrelated error toast when `/config/prompt-profile` returned the default empty
object, because the overlay expects a prompt profile catalog with `profiles`.

This is not a product UI bug. The product split is intentional:
`BrowserPreviewPanel.onReady` opens the Browser workbench idempotently, while
the toolbar button toggles a user-selected activity.

## Call Points

| Search | Evidence | Decision |
| --- | --- | --- |
| `rg -n 'openRightActivity|selectRightActivity|onReady|centerWorkbenchBrowser|leftPanelTasks|data-activity="browser"|data-activity="tasks"' packages/overlay/src packages/overlay/test/browser/browser-preview-evidence.test.ts specs/new-arch -S` | `main.tsx` keeps `selectRightActivity` as the toolbar toggle and wires `BrowserPreviewPanel.onReady` to `openRightActivity("browser")`. The dirty browser evidence test clicked Preview directly after row render. | Test setup must follow the deterministic user path: Tasks activity, task row, Preview toggle. |
| `rg -n -F '/config/prompt-profile' packages/overlay/src packages/overlay/test -S` | Browser tests that mount the full overlay provide a prompt profile catalog. The dirty evidence test did not, so `catalog.profiles.some(...)` surfaced as a toast during visual review. | Restore the prompt profile fixture route instead of accepting a noisy screenshot. |
| `specs/new-arch/2026-06-09-browser-preview-ready-open.md` | Ready callbacks must be idempotent open; toolbar clicks remain user toggles. | Do not change product logic or add gates. |
| `specs/new-arch/2026-06-15-browser-preview-consensus-closure.md` | Browser Preview panel is mounted at startup and loads when `taskID` and directory exist. | Do not treat auto-open as a failure; make the test setup deterministic. |

## Fix Shape

- Add one browser-test helper for the user-visible path: switch to Tasks,
  wait for `#leftPanelTasks[data-active="true"]`, click the task row, then click
  the right Browser activity.
- Use the helper in both evidence test branches before waiting for
  `#centerWorkbenchBrowser[data-active="true"]`.
- Restore the prompt-profile catalog fixture route so the screenshot and browser
  test are not contaminated by unrelated settings/composer errors.
- Do not change backend browser-preview routes, target selection, evidence
  assertions, or product toolbar semantics.

## Verification

- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/browser-preview-evidence.test.ts`
- Screenshot after `#centerWorkbenchBrowser[data-active="true"]` showing the
  Browser Preview workbench and evidence image visible.
