# Skill Settings Matrix Density

Date: 2026-06-26
Status: implementation plan

## User Report

The Config & Settings Skills matrix is neither compact nor visually polished. The
attached screenshot shows the settings dialog matrix consuming too much vertical
space, presenting loose mount cells, and cutting the right side of the agent
columns in the first viewport.

## Recall

| Source                                                 | Constraint                                                                                                                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                            | Inspect landed plans before edits, do not add fallback or parallel sources, cover code changes with tests, visually verify frontend work with real screenshots.  |
| `2026-06-23-agent-skill-mount-matrix.md`               | `/skill/mounts` remains the single matrix projection. Settings and toolbar panels share one component contract, but settings must use a management-grade layout. |
| `2026-06-25-skill-panel-refresh-cache-invalidation.md` | The reload button must keep using `/skill/mounts?refresh=true`; layout changes must not touch request semantics.                                                 |
| Current screenshot                                     | Settings non-compact matrix is the problem surface; the left toolbar compact panel is not the reported target.                                                   |

## Callpoint Inventory

| Call point             | Evidence                                                                                                                                                                   | Decision                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Settings tab mount     | `packages/overlay/src/components/ConfigDialogHost.tsx` renders `<SkillsPanel directory={activeProjectDirectory} />` for `data-config-panel="skill"`.                       | Keep the same component and data path.                                                           |
| Settings entry scroll  | `packages/overlay/src/services/dialog.ts::CONFIG_SECTION_TARGETS` maps `skill` to `skillList`.                                                                             | Remove the old list anchor so Skills opens at the matrix top.                                    |
| Matrix column model    | `packages/overlay/src/components/settings/SkillMarketPanel.tsx::matrixGridTemplate()` and `matrixAgentTrack()` build one CSS grid template for compact and settings modes. | Tune only the settings branch and preserve compact branch behavior.                              |
| Matrix visual contract | `packages/overlay/src/styles/surfaces/settings.css` owns `.agent-skill-matrix*` and `.agent-skill-grid-*`.                                                                 | Add settings-specific dense sizing, header wrapping, and less heavy table chrome.                |
| Matrix combo hover     | `packages/overlay/src/components/settings/SkillMarketPanel.tsx` renders each mount cell with its skill and agent context.                                                  | Track the active skill-agent pair in the matrix component and expose it through data attributes. |
| Browser coverage       | `packages/overlay/test/browser/skill-mount-matrix-browser.test.ts` already captures toolbar and settings screenshots.                                                      | Extend settings assertions for dense rows, visible viewport fit, and wrapped full agent names.   |

## Root Cause

The previous density pass tightened only `data-compact="true"`. Settings mode
still uses large row heights, large pool and agent columns, no header wrapping,
and a heavy bordered grid. Because long agent names reserve full single-line
width, the grid over-expands horizontally while each row still spends roughly 50
pixels vertically. The result feels sparse and shows fewer useful columns in the
settings viewport.

The settings entry path also still scrolls `skillList` into view. That was
correct when the installed skill list was the primary Skills surface, but it is
wrong after the matrix-first redesign because it opens the tab with the top of
the matrix already scrolled away.

## Design

1. Keep `/skill/mounts` and the shared `SkillMarketPanel` renderer as the only
   data and interaction source.
2. Change the non-compact matrix grid template to use a narrower skill column
   and dense fixed agent tracks that can wrap long hyphenated names.
3. Reduce settings matrix row/header heights and padding while keeping mounted,
   available, and conflict states readable.
4. Allow settings agent headers to wrap to two tight lines instead of forcing
   every long name into a wide one-line column.
5. Keep source directory badges and unmounted highlighting, but reduce their
   visual weight in the matrix rows.
6. Remove the Skills tab's old `skillList` scroll target so the tab opens at the
   matrix top.
7. On mount-cell hover or keyboard focus, highlight the matching left skill
   header and top agent header so the current configuration pair is obvious.

## Tests

- Update the existing browser test to assert settings rows and cells are dense,
  the matrix viewport is fully visible, and agent headers retain full text
  without horizontal text clipping.
- Assert that opening the Settings Skills tab starts with `#configContent` at the
  top.
- Assert that hovering a matrix cell marks exactly one skill header, one agent
  header, and one cell as the active configuration pair, then capture a hover
  screenshot.
- Run the browser test with the Node runner.
- Run `bun run build:overlay`.
- Inspect the generated settings screenshot before considering the fix done.
