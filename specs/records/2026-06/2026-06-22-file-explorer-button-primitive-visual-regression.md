# File Explorer Button Primitive Visual Regression

Date: 2026-06-22

## Problem

The File Explorer regressed visually after the rows moved from bare buttons to
the shared `Button` primitive. The user-visible symptoms are oversized file and
folder icons, heavy row text, and a less dense file-manager feel.

The regression starts with commit `424d932543` (`fix: share file explorer row
sizing`, 2026-06-20 07:33:13 +0800). That commit correctly centralized row
height and kept the shared Button primitive, but it missed two inherited Button
primitive defaults:

- `.oc-button > svg` sizes direct child SVG icons to `--oc-density-chip-height`.
- `.oc-button` sets `font-weight: var(--ui-font-weight-strong)`.

File Explorer rows need the Button primitive behavior and accessibility, but
their visual hierarchy is a dense file list, not a toolbar button group.

## Recall

| Source                                               | Constraint                                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `2026-06-01-overlay-file-explorer-editor.md`         | Explorer rows are flat, dense, and icon-led. No nested cards.                        |
| `2026-06-18-file-explorer-row-button-semantics.md`   | Rows are command buttons, not an incomplete ARIA tree widget.                        |
| `2026-06-20-file-explorer-row-focus-visible.md`      | Keep independent keyboard focus outline.                                             |
| `2026-06-20-file-explorer-row-button-size-source.md` | Rows must keep using `Button`; row geometry source stays in `FileExplorerPanel.tsx`. |

## Impact Sweep

| Sweep                                                        | Result                                                                                          | Decision                                                 |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `rg -n "file-explorer-row                                    | oc-button > svg                                                                                 | font-weight" packages/overlay/src packages/overlay/test` | Production owner is `inspector.css`; global Button icon and font-weight rules are the inherited source. | Override only `.file-explorer-row`, not the primitive. |
| `git show 424d932543 -- FileExplorerPanel.tsx inspector.css` | The migration introduced `<Button>` rows and CSS variables but no row-local SVG/font overrides. | Add missing visual isolation.                            |
| `file-explorer-accessibility.test.ts`                        | Browser fixture already opens Explorer in an isolated page and records screenshots.             | Extend it to assert row icon width and body font weight. |

## Implementation

1. Keep `FileExplorerPanel` row markup on `Button`.
2. Add row-local `font-weight: var(--ui-font-weight-body)`.
3. Add `.file-explorer-row > svg` sizing based on
   `--file-explorer-row-icon-width`, overriding the global Button icon size.
4. Preserve current row height, virtualizer item size, focus ring, ARIA current,
   and lazy loading behavior.

## Acceptance

- Row direct SVG icons render at the Explorer row icon width, not the global
  Button chip height.
- Row text uses body weight, not strong Button weight.
- Existing row geometry and accessibility tests still pass.
- Dark-theme browser evidence is captured from an isolated test page; no running user
  OpenCorvus / overlay process is restarted, closed, or refreshed.

## Follow-up 2026-06-23: Inactive Selected File Load

### Recall

| Source                                               | Constraint carried forward                                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Sartre read-only audit                               | The `selectedFilePath()` expansion effect can call `loadDirectory()` while the center Explorer panel is inactive.             |
| `FileExplorerPanel.tsx`                              | Initial root load and refresh interval are already active-gated; selected-file ancestor loading is the remaining trigger gap. |
| `2026-06-20-file-explorer-row-button-size-source.md` | Keep row geometry and Button primitive ownership unchanged.                                                                   |

### Fix Plan

1. Make the selected-file expansion effect read `active()` and `directory()`
   before reading `selectedFilePath()`.
2. Leave `loadDirectory()` and row rendering unchanged; this is a trigger-owner
   fix, not a second cache or data source.
3. Add a source guard proving selected-file expansion is active-gated.
4. Extend the mounted browser test to assert no `/file` request is sent before
   the Explorer activity is opened, then verify the existing visible Explorer
   path still loads and renders.

### Acceptance

- Hidden Explorer panels do not load root or selected-file ancestor
  directories.
- Opening Explorer still loads root and selected ancestors from the active
  workspace directory.
- No fallback directory source, alternate file store, duplicate row component,
  or panel-local cache is introduced.

### Implementation

- The selected-file expansion effect now reads `active()` and `directory()`
  before `selectedFilePath()`, so selected-file signal changes are not
  subscribed while the Explorer panel is inactive.
- The existing initial-load and refresh active guards remain unchanged.
- The browser fixture now asserts no `/file` directory request is sent before
  the Explorer activity is opened, then verifies root load after opening.

### Verification

| Check                                                                                                             | Result                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun test packages/overlay/test/file-explorer-editor.test.ts --timeout 30000`                                     | 4 pass                                                                                                                                                                                                            |
| `bun run --cwd packages/overlay typecheck`                                                                        | Pass                                                                                                                                                                                                              |
| `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/file-explorer-accessibility.test.ts` | 2 pass                                                                                                                                                                                                            |
| Visual QA                                                                                                         | Reviewed `.scratch/file-explorer-dark-row-density.png`, `.scratch/file-explorer-search-field-focus.png`, `.scratch/file-explorer-row-focus-visible.png`, and `.scratch/file-explorer-retry-button-primitive.png`. |

### Self Review

- The change removes a hidden trigger source; it does not add a request cache or
  alternate file tree source.
- Row Button primitive ownership, virtual row sizing, upload flow, and editor
  opening behavior remain unchanged.
- The source test also updated a stale assertion so `FileChangesPanel` continues
  to assert the current active prop contract.
