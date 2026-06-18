# Config Dialog Close Button Primitive

Date: 2026-06-18

## Problem

`ConfigDialogHost` kept a raw `<button class="config-close-btn">` in the
dialog header while the same surface already routes sidebar navigation through
the shared Tabs primitive. The close action duplicated icon button chrome in
`surfaces/settings.css` instead of using the shared `Button` primitive.

The local style also referenced `--settings-surface-muted` from the dialog
header. That token was defined only on `.config-dialog-layout`, which is a
body sibling of the header, so the close button did not inherit the intended
settings hover surface.

## Evidence Sweep

| Search | Result | Decision |
| --- | --- | --- |
| `rg -n "config-close-btn" packages/overlay/src packages/overlay/test specs/new-arch` | Only `ConfigDialogHost`, `surfaces/settings.css`, and architecture guards owned the class. | Delete the class and make tests reject its return. |
| `rg -n "btnCloseConfigDialog" packages/overlay/src packages/overlay/test specs/new-arch` | Browser tests click the id as the public dialog close locator. | Keep the id on the primitive button. |
| `rg -n 'data-ui="file-changes-diff-close"|data-ui="trace-close"|data-ui="app-notification-close"' packages/overlay/src packages/overlay/test specs/new-arch` | Peer close actions use `Button` plus a stable `data-ui` selector. | Follow the same selector contract with `data-ui="config-dialog-close"`. |
| `rg -n -- "--settings-surface-muted|--settings-surface-hover|--settings-surface-base" packages/overlay/src/styles` | Settings surface variables were declared on `.config-dialog-layout` but consumed by header close chrome. | Move the variable owner to `#configDialog .dialog-form`, the common ancestor for header and body. |

## Fix

- Import and use `Button` for the config dialog close action.
- Keep `id="btnCloseConfigDialog"` for existing browser contracts.
- Add `data-ui="config-dialog-close"` for the component-level style hook.
- Preserve the localized close tooltip/title through `t("common.close")`.
- Remove `.config-close-btn` and its hover rule.
- Scope the settings surface variables to `#configDialog .dialog-form` so
  header chrome and panel content share the same single token owner.
- Update static guards to require the shared primitive and reject the retired
  class.

## Acceptance

- `ConfigDialogHost` contains `<Button` for the close action and no
  `class="config-close-btn"`.
- `settings.css` contains no `.config-close-btn` selector.
- The close action renders as `.oc-button[data-ui="config-dialog-close"]`.
- Settings surface tokens are owned by `#configDialog .dialog-form`.
- Existing browser tests can still close the dialog via `#btnCloseConfigDialog`.
- Browser coverage asserts the close button's primitive attributes,
  hover background, focus-visible ring, and screenshot evidence.
