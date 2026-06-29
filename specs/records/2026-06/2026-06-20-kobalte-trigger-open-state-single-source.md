# Kobalte Trigger Open State Single Source

Date: 2026-06-20

GUI means Graphical User Interface. CSS means Cascading Style Sheets. DOM means
Document Object Model. ARIA means Accessible Rich Internet Applications.

## Problem

Several overlay controls use Kobalte Trigger primitives, but still project the
same open state through local `data-open` or `data-active` attributes. Kobalte
already emits `aria-expanded`, `data-expanded`, and `data-closed` on these
triggers, so the local attributes create a second visual state source.

## Recall

| Source                                                    | Relevant decision                                                                                              |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `2026-06-01-overlay-mature-ui-primitives-refactor.md`     | Workspace split launchers, executor selector, and titlebar menubar were migrated to mature Kobalte primitives. |
| `2026-06-19-kobalte-selected-state-single-source.md`      | Kobalte runtime state attributes must own visual selected/pressed/checked state instead of local mirrors.      |
| `2026-06-19-dropdown-menu-highlighted-contrast-source.md` | Kobalte popup highlighted state must use Kobalte attributes.                                                   |
| `2026-06-18-task-dirbar-recent-trigger-semantics.md`      | The CWD recent panel is a separate manual trigger surface and is not this Kobalte Trigger open-state pass.     |

## Impact Sweep

| Sweep                           | Result                                                                                                                                                       | Decision                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `rg -n "data-open               | data-active                                                                                                                                                  | data-expanded                                                                                             | aria-expanded" packages/overlay/src/components/WorkspaceSplitLauncher.tsx packages/overlay/src/components/ExecutorSelector.tsx packages/overlay/src/components/TaskDirBar.tsx packages/overlay/src/components/titlebar/TitlebarMenubar.tsx packages/overlay/src/styles/surfaces` | Kobalte Trigger local mirrors exist in workspace split menu, executor chips, project worktree dropdown, and titlebar menubar triggers. | Remove only those local mirror attributes and restyle with `[data-expanded]`. |
| Kobalte source scan             | `MenuTrigger` and `PopoverTrigger` emit `aria-expanded` and spread the root dataset that includes `data-expanded`.                                           | Use Kobalte as the single open-state source.                                                              |
| Test scan                       | Static tests currently require `.executor-chip-slot[data-open="true"]` and titlebar `[data-active="true"]`; browser tests mostly check only `aria-expanded`. | Update tests to reject the mirror attributes and assert `[data-expanded]` in real runtime.                |
| Independent GUI QA agent review | The four local mirror attributes were removed, but executor caret still read `props.disclosure.open()` directly for its visual direction.                    | Treat caret direction as open-state chrome and move it behind the trigger `[data-expanded]` selector too. |

## Fix

- Remove `data-open` from Kobalte `DropdownMenu.Trigger` / `Popover.Trigger`
  consumers.
- Remove `data-active` from Kobalte `Menubar.Trigger`.
- Change open-state CSS selectors to Kobalte `[data-expanded]`.
- Make executor chip caret static in JSX; rotate and recolor it from the
  trigger `[data-expanded]` rule.
- Consolidate `project-worktree-cleanup-hint` CSS into one selector block so
  the existing duplicate-selector budget remains below the guard.
- Keep unrelated business state attributes unchanged, including panel
  `data-active`, CWD recent panel `data-open`, and recent directory
  `data-active`.

## Acceptance

- Workspace split, executor chip, project worktree, and titlebar menubar open
  chrome use `[data-expanded]`.
- The four Kobalte Trigger surfaces no longer write local open-state mirror
  attributes.
- Static guards reject the retired selector families.
- Real browser tests verify open triggers expose `aria-expanded="true"` and
  `data-expanded`, while the retired mirror attributes are absent.
- No raw color or parallel token source is introduced.

## Evidence

| Surface                   | Runtime screenshot                                         | Verified state                                                                                                       |
| ------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Workspace split menu      | `.scratch/workspace-split-launcher-expanded-state.png`     | `aria-expanded="true"`, `data-expanded` present, trigger `data-open` absent.                                         |
| Executor chip             | `.scratch/executor-chip-expanded-state.png`                | `aria-expanded="true"`, `data-expanded` present, trigger and slot `data-open` absent; caret rotation comes from CSS. |
| Project worktree dropdown | `.scratch/task-dirbar-project-worktree-expanded-state.png` | `aria-expanded="true"`, `data-expanded` present, trigger `data-open` absent.                                         |
| Titlebar menubar          | `.scratch/titlebar-menubar-trigger-expanded-state.png`     | `aria-expanded="true"`, `data-expanded` present, trigger `data-active` absent.                                       |

Validation commands:

- `bun test packages/overlay/test/workspace-split-launcher-primitive.test.ts packages/overlay/test/task-cwd-row-layout.test.ts packages/overlay/test/executor-selector-dualbar.test.ts packages/overlay/test/titlebar-menubar-primitive.test.ts packages/overlay/test/flat-redesign-border-policy.test.ts packages/overlay/test/owner-surface-consistency.test.ts packages/overlay/test/overlay-architecture-guards.test.ts`
- `$env:OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER='1'; node --test --test-concurrency=1 packages/overlay/test/browser/pane-collapse-layout.test.ts`
- `$env:OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER='1'; node --test --test-concurrency=1 packages/overlay/test/browser/executor-selector-redesign.test.ts`
- `$env:OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER='1'; node --test --test-concurrency=1 packages/overlay/test/browser/titlebar-menubar.test.ts`
- `$env:OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER='1'; node --test --test-concurrency=1 packages/overlay/test/browser/task-dirbar-keyboard.test.ts`
