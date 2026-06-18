# Retire Chat Plugin CSS Residue

Date: 2026-06-18

CSS means Cascading Style Sheets. DOM means Document Object Model.

## Problem

The retired chat plugin pane DOM is already absent, and the live browser
preview surface is mounted through `#solidBrowserPreviewMount` with
`.chat-browser-preview-activity`. The old `.chat-plugin-activity` and
`.chat-plugin-outlet` selectors still remained in `activity.css` and
`workspace.css`, grouped beside the live browser preview class.

That kept a dead selector family alive and made future browser-preview layout
changes look like they also needed to preserve a removed plugin shell.

## Recall

| Source | Existing decision |
| --- | --- |
| `2026-06-07-overlay-center-tab-workbench.md` | Browser preview moved from `chatBrowserPreviewPane` into the center workbench preview tab. |
| `2026-06-09-overlay-ui-tech-debt-consensus.md` | `#solidBrowserPreviewMount` is the preview mount; tests pin it as the live surface. |
| `2026-06-18-retire-workspace-panel-residue.md` | Retired workspace/plugin-era shell CSS should not remain beside current center workbench owners. |

## Impact Sweep

| Search | Result | Decision |
| --- | --- | --- |
| `rg -n -F "chat-plugin" packages/overlay/src packages/overlay/test specs/new-arch` | Only stylesheet selectors and tests asserting old `chatPlugin*` DOM is absent remained. | Delete stylesheet selectors; keep absence assertions. |
| `rg -n -F "chat-browser-preview-activity" packages/overlay/src packages/overlay/test specs/new-arch` | Live DOM owner is `src/index.html`; tests require the class and mount. | Keep `.chat-browser-preview-activity` layout rules. |
| `rg -n -F "solidBrowserPreviewMount" packages/overlay/src packages/overlay/test specs/new-arch` | `main.tsx` mounts `BrowserPreviewPanel` into the current center workbench root. | Do not add a compatibility mount or alias. |

## Fix

- Remove `.chat-plugin-activity` and `.chat-plugin-outlet` from
  `activity.css`.
- Remove the retired `.chat-plugin-activity[data-active="false"]` rule and
  the plugin selector group from `workspace.css`.
- Add regression guards so `browser-preview-panel.test.ts` and
  `overlay-architecture-guards.test.ts` reject the old CSS selectors while
  preserving `.chat-browser-preview-activity`.

## Acceptance

- `chat-plugin-*` selectors no longer appear in runtime source CSS.
- Existing DOM guards still prove `chatPluginPane`, `chatPluginOutlet`, and
  `data-chat-view="plugin"` stay absent.
- Browser preview remains mounted through `solidBrowserPreviewMount`.
- Targeted static tests and overlay typecheck pass before commit and push.
