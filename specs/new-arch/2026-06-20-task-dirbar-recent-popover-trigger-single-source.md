# TaskDirBar Recent Popover Trigger Single Source

Date: 2026-06-20

GUI means Graphical User Interface. CSS means Cascading Style Sheets. DOM means
Document Object Model. ARIA means Accessible Rich Internet Applications.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `AGENTS.md` | Mature UI primitives must own interaction semantics; frontend fixes require real browser screenshots. |
| `2026-06-19-task-dirbar-recent-popover-semantics.md` | The CWD recent surface is a Kobalte Popover dialog anchored to the CWD shell. |
| `2026-06-20-kobalte-trigger-open-state-single-source.md` | Kobalte triggers emit `aria-expanded` and `data-expanded`; caller-owned open-state mirrors are a second visual source. |
| `ExecutorSelector.tsx` | Existing project pattern uses `Popover.Trigger as={Button}` inside an anchor shell while `anchorRef` still points at the shell. |

## Problem

Independent GUI review found that the CWD recent-directory popup uses
`Popover.Root` and `Popover.Content`, but the trigger is still a standalone
`Button` that mirrors the same open state through local attributes:

- `.task-cwd-dropdown` writes `data-open={open() ? "true" : "false"}`.
- `[data-ui="cwd-recent-trigger"]` writes the same `data-open`, plus manual
  `aria-expanded`, `aria-controls`, and `onClick`.
- `conversation.css` drives open chrome from `.task-cwd-dropdown[data-open]`
  and trigger `[data-open]`.

Kobalte already owns the trigger relationship for Popover. Keeping local
open-state mirrors creates a second visual source and leaves static/browser
tests protecting the obsolete shape.

## Impact Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n "cwd-recent-trigger|task-cwd-dropdown|Popover\\.Trigger|data-open|data-expanded|aria-expanded" packages/overlay/src/components/TaskDirBar.tsx packages/overlay/src/styles/surfaces/conversation.css packages/overlay/test/task-cwd-row-layout.test.ts packages/overlay/test/browser/task-dirbar-keyboard.test.ts specs/new-arch -S` | The remaining recent-trigger mirror is isolated to `TaskDirBar`, `conversation.css`, and its tests. | Fix only this surface. |
| `rg -n "<Popover\\.Trigger" packages/overlay/src packages/overlay/test specs/new-arch -S` | `ExecutorSelector` and Titlebar Brand Guide already use Kobalte Popover triggers. | Reuse `Popover.Trigger as={Button}` for the recent trigger. |
| Browser test review | `task-dirbar-keyboard.test.ts` opens the real panel, checks dialog semantics and screenshots the panel, but still expects shell `data-open`. | Update it to require trigger `data-expanded` and reject local `data-open`. |

## Fix Plan

1. Replace the standalone recent trigger `Button` with
   `Popover.Trigger as={Button}`.
2. Remove local `data-open`, manual `aria-expanded`, manual `aria-controls`,
   and manual click toggling from the recent trigger.
3. Remove shell `data-open`; keep the shell as the `anchorRef` and layout owner.
4. Move open visual selectors from shell/trigger `data-open` to
   `[data-ui="cwd-recent-trigger"][data-expanded]`.
5. Update static and browser tests to require the Kobalte trigger, reject the
   retired local mirror selectors, and verify runtime `data-expanded`.

## Acceptance

- The recent trigger uses the Kobalte Popover trigger primitive and the shared
  Button primitive.
- Open chrome uses Kobalte `[data-expanded]` as the only visual open-state
  source.
- The CWD shell remains the popover anchor and same-width source, without local
  open-state mirroring.
- Real browser evidence proves the panel opens, keeps dialog semantics, exposes
  `aria-expanded="true"` and `data-expanded` on the trigger, has no trigger or
  shell `data-open`, and still screenshots the recent panel.
- No raw color or parallel token source is introduced.
