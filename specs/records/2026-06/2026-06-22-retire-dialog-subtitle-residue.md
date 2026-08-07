# Retire Dialog Subtitle Residue

Date: 2026-06-22
Status: Implemented

## Acronyms

- CSS: Cascading Style Sheets, the overlay styling language.
- UI: User Interface, the visible overlay surface.
- DOM: Document Object Model, the browser element tree.

## Task Definition

Remove the dead `.dialog-subtitle` typography selector and its stale test
contract without adding a second dialog header slot.

## Recall

| Source                                                | Constraint carried forward                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `AGENTS.md`                                           | Delete high-confidence dead CSS, avoid double-source UI contracts, and test the deletion.        |
| `2026-06-01-overlay-mature-ui-primitives-refactor.md` | Dialog semantics should live behind the shared Dialog primitive boundary.                        |
| `2026-06-19-retire-dialog-head-residue.md`            | Dialog header/title DOM should stay primitive-owned rather than feature-owned.                   |
| `2026-06-19-retire-session-dialog-diff-residue.md`    | Session dialogs should use the canonical `.dialog-title` path, not nested dialog title elements. |

## Call Point Inventory

| Surface                  | Evidence                                                                                                                                                               | Decision                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Runtime dialog primitive | `Dialog.tsx` renders `.dialog-header`, `.dialog-title`, and optional header actions; it has no subtitle prop.                                                          | Keep the primitive unchanged.                                                             |
| Feature dialog hosts     | `AppDialogHost`, `ConfigDialogHost`, `GoalDialogHost`, `InteractionDialogHost`, `SessionDialogHost`, and `WorkspaceOnboardingDialog` do not render `.dialog-subtitle`. | Do not add a subtitle slot just to justify stale CSS.                                     |
| CSS                      | `.dialog-subtitle` appears only in `styles/cascade/typography.css`.                                                                                                    | Delete the selector.                                                                      |
| Tests                    | `content-tier2-typography.test.ts` only asserted the stale selector avoided uppercase.                                                                                 | Convert it to an absence guard while preserving the live pill uppercase negative control. |

## Root Cause

The dialog primitive consolidated dialog titles under `.dialog-title`, but a
pre-primitive subtitle typography selector and its test remained. This created a
phantom dialog header contract with no DOM owner.

## Acceptance

- Production CSS contains no `.dialog-subtitle`.
- Dialog primitive and feature dialog hosts remain on `.dialog-title`.
- Focused typography and dialog cleanup tests pass.

## Verification

- `rg -n -F "dialog-subtitle" packages/overlay/src packages/overlay/test specs/records/2026-06/2026-06-22-retire-dialog-subtitle-residue.md`
- `bun test packages/overlay/test/content-tier2-typography.test.ts packages/overlay/test/dead-dialog-cleanup.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay build:vite`
- Node-owned browser screenshot:
  `.scratch/retire-dialog-subtitle-config-dialog.png`, reviewed on the real
  `#configDialog` opened from `data-ui="connection-badge"` with `.dialog-title`
  visible and `.dialog-subtitle` absent.
