# Executor Popover Dead CSS Retirement

Date: 2026-06-17

CSS means Cascading Style Sheets. UI means User Interface.

## Problem

`packages/overlay/src/styles/surfaces/composer.css` still defines
`.executor-popover-group-status` and `.executor-popover-model-badge`, but the
current executor selector renders only provider group names and model names.
Keeping CSS for unrendered popover fragments makes the executor menu contract
look broader than the component actually supports.

## Call Points

| Search | Evidence | Decision |
| --- | --- | --- |
| `rg -n "executor-popover-group-status|executor-popover-model-badge|executor-popover-group-name|executor-popover-model-name" packages/overlay/src packages/overlay/test specs/new-arch` | The status and badge classes only appear in CSS. `ExecutorSelector.tsx` renders `executor-popover-group-name` and `executor-popover-model-name`. | Delete the two dead CSS rules. |
| `specs/new-arch/2026-06-09-task-agent-model-context.md` | Model selection is owned by the task/session model context and current model row. | Do not add provider status or badge DOM. |
| `specs/new-arch/2026-06-17-hexin-budget-display.md` | Hexin budget is rendered below the dual chip bar, not as model-row badges. | Do not keep badge styling as a placeholder. |

## Fix Shape

- Remove `.executor-popover-group-status` from `composer.css`.
- Remove `.executor-popover-model-badge` from `composer.css`.
- Add a static test proving the component and CSS expose only rendered executor
  popover group/model elements.

## Verification

- `bun test packages/overlay/test/executor-popover-css.test.ts packages/overlay/test/executor-selector-dualbar.test.ts`
- `bun run --cwd packages/overlay typecheck`
- Browser smoke for the executor selector popover, with screenshot review.
