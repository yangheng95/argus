# Right Toolbar Panel Initial Max Width

Date: 2026-06-26

## Task Definition

Limit the initial maximum width of every auxiliary panel opened from the right
activity toolbar. The limit must be shared by Explorer, Diff, Browser,
Screenshots, Inspector, and Notifications, without restoring the retired right
pane width state.

## Recall

| Source                                                   | Constraint carried forward                                                                                                                               |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-23-retire-right-pane-layout-state.md`           | `sectionsWidth`, `rightPanelCollapsed`, `--ui-sections-width`, and right-pane resizers are retired. Right toolbar panels belong to the center workbench. |
| `2026-06-23-overlay-panel-legal-size-contract.md`        | Center workbench panel minimum width remains token-owned by `--ui-workbench-panel-min-width`; multiple panels scroll instead of compressing.             |
| `2026-06-22-center-workbench-panel-min-size-contract.md` | `centerWorkbenchPanelWeights` is the only persisted user resize source.                                                                                  |

## Call Point Inventory

| Area                    | File                                                                  | Decision                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Width token             | `packages/overlay/src/styles/tokens/design-language.css`              | Add one structural token for the initial right-toolbar panel max width.                                                       |
| Center workbench layout | `packages/overlay/src/styles/surfaces/workspace.css`                  | Apply the max only while a view carries an initial-width cap marker.                                                          |
| Toolbar open path       | `packages/overlay/src/main.tsx`                                       | Mark auxiliary right-toolbar panels as initially capped when opened; remove the marker on close or explicit separator resize. |
| Static tests            | `packages/overlay/test/right-panel-tabs-flat.test.ts`                 | Guard the token, CSS selector, and no retired right-pane width source.                                                        |
| Browser visual test     | `packages/overlay/test/browser/side-activity-toolbar-browser.test.ts` | Verify a freshly opened Inspector panel stays under the token, then verify separator resize removes the initial cap.          |

## Acceptance

- Fresh auxiliary panels opened from the right toolbar cannot initially exceed
  `--ui-right-toolbar-panel-initial-max-width`.
- Manual pointer or keyboard separator resize clears the initial cap and keeps
  using existing `centerWorkbenchPanelWeights`.
- Workflow/file panels are not treated as right-toolbar popup panels.
- No `sectionsWidth`, `rightPanelCollapsed`, right-pane resizer, fallback
  width, or per-panel width constant is introduced.
- Focused static tests, browser screenshot review, typecheck, and self-review
  pass.
