# Ledger Row Action Rail Keyboard Single Source

Date: 2026-06-19

## Recall

- `AGENTS.md` requires no fallback, no double-source UI logic, tests for every code change, real browser evidence for UI work, and commit/push after the fix.
- Previous row-action work made `TaskList.tsx` the canonical implementation for hidden `.task-row-actions`: hidden action buttons are removed from plain Tab order, `ArrowRight` opens the rail for keyboard users, and `Escape` / `ArrowLeft` returns focus to the row main button.
- Current working tree already contains unrelated dirty changes. `MissionList.tsx` has an existing uncommitted mission-project download action. The fix must preserve that action and include it in the keyboard rail contract instead of reverting or rewriting it.

## Evidence

Independent audit found that Mission and Coding Assistant ledgers reuse `.task-row-actions` but not the keyboard contract:

- `packages/overlay/src/components/TaskList.tsx` owns `actionsKeyboardOpen`, `actionButtonTabIndex`, `data-actions-keyboard-open`, `aria-keyshortcuts="ArrowRight"`, `ArrowRight` open, and `Escape` / `ArrowLeft` close.
- `packages/overlay/src/components/MissionList.tsx` renders `class="task-row-actions"` without `data-actions-keyboard-open`, `aria-keyshortcuts`, or action button `tabIndex` control.
- `packages/overlay/src/components/CodingAssistantSessionList.tsx` has the same gap.
- `packages/overlay/test/browser/ledger-row-interactions.test.ts` currently asserts the wrong behavior by tabbing through hidden row actions.

Impact grep:

```text
rg -n 'actionsKeyboardOpen|setActionsKeyboardOpen|actionButtonTabIndex|openActionsFromKeyboard|closeActionsFromKeyboard|data-actions-keyboard-open|aria-keyshortcuts|class="task-row-actions"' packages/overlay/src/components packages/overlay/test -g '*.tsx' -g '*.ts'
```

Result: only `TaskList.tsx` implements the keyboard contract; `MissionList.tsx` and `CodingAssistantSessionList.tsx` only render the shared action rail class.

## Problem

The CSS contract for `.task-row-actions` hides row actions until hover or `data-actions-keyboard-open="true"`. Without matching tab management, keyboard users can tab into invisible controls. That is both an accessibility defect and a visual-state bug because focused hidden buttons can occupy the overlay slot while the row has not entered its open state.

## Plan

1. Extract TaskList's row action rail keyboard behavior into one shared hook for task-row-style ledgers.
2. Update `TaskList.tsx` to consume the hook, preserving its current behavior as the canonical source.
3. Update `MissionList.tsx` and `CodingAssistantSessionList.tsx` to use the same hook:
   - add `data-actions-keyboard-open` to the row container;
   - add `aria-keyshortcuts="ArrowRight"` and `onKeyDown` to the row main button;
   - add `onFocusOut` close behavior to the row;
   - add rail `onKeyDown` close behavior;
   - pass `tabIndex={actionButtonTabIndex()}` to every action button, including the existing mission download action.
4. Update static tests to guard that all three ledgers use the shared hook.
5. Update the browser ledger-row test so hidden actions are skipped by Tab, `ArrowRight` opens the rail, screenshots are captured for closed/open states, and `Escape` / `ArrowLeft` returns focus to the main row button.

## Acceptance

- Mission and Coding Assistant hidden actions have `tabindex="-1"` while closed.
- Plain Tab reaches each row's main selection button and skips hidden action buttons.
- `ArrowRight` from a row main button opens visible actions and focuses the first enabled action.
- `Escape` or `ArrowLeft` from an action closes the rail and returns focus to the row main button.
- TaskList behavior remains covered by the existing browser test.
- Visual screenshots prove closed and keyboard-open ledgers do not overlap the timestamp/action rail incoherently.
