# TaskDirBar Breadcrumb Focus Visible

## Problem

The current working directory breadcrumb renders real command buttons for
browse, open path, and choose parent directory, but the breadcrumb CSS only
styles hover states:

| Source                                                       | Evidence                                                                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/overlay/src/utils/dom-utils.ts`                    | `pathBreadcrumb()` emits `.task-dir-tool`, `.task-dir-node`, and `.task-dir-step` buttons.                                           |
| `packages/overlay/src/components/TaskDirBar.tsx`             | `TaskDirContent` mounts the breadcrumb through `innerHTML={breadcrumbHtml()}` as the single runtime source.                          |
| `packages/overlay/src/styles/surfaces/conversation.css`      | `.task-dir-tool:hover`, `.task-dir-node:hover`, and `.task-dir-step:hover` have visible chrome; no matching `:focus-visible` exists. |
| `packages/overlay/test/browser/task-dirbar-keyboard.test.ts` | The browser test focuses `.task-dir-step` and proves behavior, but does not assert focus chrome.                                     |

Keyboard users can tab to the breadcrumb commands, but the focused segment,
slash step, or browse button does not get the same tokenized visual feedback as
mouse hover or shared button primitives.

## Recall

| Search                                                                                                  | Result                                                                                                                              |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `rg "task-dir-tool                                                                                      | task-dir-node                                                                                                                       | task-dir-step       | pathBreadcrumb" packages/overlay/src packages/overlay/test specs`   | `pathBreadcrumb()` is the single breadcrumb markup source; `TaskDirBar.tsx` only injects it and handles delegated actions. |
| `rg "task-dir-tool:focus                                                                                | task-dir-node:focus                                                                                                                 | task-dir-step:focus | task-dir.\*focus-visible" packages/overlay/src/styles packages/overlay/test` | No breadcrumb focus-visible selector exists before this repair.                                                            |
| `specs/records/2026-06/2026-06-19-task-dirbar-recent-popover-semantics.md`                                     | Recent directory popup controls use normal button/focus semantics; breadcrumb path buttons remain separate from the recent trigger. |
| `packages/overlay/src/styles/primitives/button.css` / `packages/overlay/src/styles/primitives/tabs.css` | Shared primitives use tokenized `:focus-visible` outlines; breadcrumb needs the same visible keyboard contract.                     |

## Fix Plan

1. Keep `pathBreadcrumb()` as the only breadcrumb HTML source.
2. Add tokenized `:focus-visible` states to `.task-dir-tool`,
   `.task-dir-node`, and `.task-dir-step`, pairing them with the existing hover
   background/color states where appropriate.
3. Keep the danger tool focus state on the `--bad` token, matching its hover
   state.
4. Add static CSS tests that require breadcrumb `:focus-visible` selectors and
   token outlines.
5. Extend the existing Node browser test to tab through the real breadcrumb
   buttons, assert focused chrome for step/node/tool, and save a breadcrumb
   focus screenshot.

## Acceptance

- Breadcrumb action buttons have visible `:focus-visible` states.
- Focus chrome uses existing tokens, not raw color literals.
- Browser evidence confirms `.task-dir-step`, `.task-dir-node`, and
  `.task-dir-tool` all show non-transparent focused styles.
