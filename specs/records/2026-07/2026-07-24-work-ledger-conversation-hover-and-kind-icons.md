# Work Ledger conversation hover and kind icons

## Recall

### User requirement

- Remove the hover background from the conversation cards shown in the attached Work Ledger screenshot.
- Correct the leading kind icon so Chat and Mission rows communicate their actual meaning.

### Acceptance criteria

- Pointer hover over Mission and Chat conversation rows does not paint a card background.
- Task rows keep their existing hover feedback.
- The selected row keeps the existing selected background.
- Keyboard focus and trailing action-button hover behavior remain unchanged.
- Chat uses the registered message-bubble icon, Mission uses the registered goal/target icon, and Task keeps the registered task-list icon.
- A real desktop browser fixture verifies computed hover paint and rendered Lucide icon identities and produces a reviewed screenshot.

### Hard constraints

- Preserve unrelated concurrent worktree changes.
- Keep `.oc-navigation-row` as the shared navigation primitive; scope the visual exception to Work Ledger rows instead of changing every navigation surface.
- Reuse the existing `message`, `goals`, and `tasks` icon registrations; do not add custom SVG paths or a second icon source.
- Do not change selected, focus-within, action-button, Project-row, or non-Work-Ledger hover contracts.

### Read material

- Attached `image.png` reference.
- `AGENTS.md` and `CLAUDE.md`.
- `specs/records/2026-07/2026-07-24-work-ledger-child-status-and-mission-loading.md`.
- `packages/overlay/src/components/WorkLedger.tsx`.
- `packages/overlay/src/components/ui/Icon.tsx` and `Icon.lucide.ts`.
- `packages/overlay/src/styles/primitives/navigation-row.css`.
- `packages/overlay/src/styles/surfaces/work-ledger.css`.
- Work Ledger source and Node browser regressions.

### Whole-repository grep evidence

| Owner / call site                              | Decision                                                                                                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkLedger.kindIcon`                          | Change only Mission from the rocket-shaped `mission` registration to the goal-shaped `goals` registration; preserve Chat=`message` and Task=`tasks`.                          |
| `ArchivePanel.kindIcon`                        | Preserve because the user identified the live conversation list, not the Archive settings surface.                                                                            |
| `Icon.lucide.ts`                               | Reuse the existing `Target`, `MessageSquare`, and `ListTodo` registrations.                                                                                                   |
| `navigation-row.css`                           | Preserve shared hover and selected behavior for every other navigation surface.                                                                                               |
| `work-ledger.css`                              | Add the single scoped pointer-hover exception for Mission and Chat rows while excluding selected rows and preserving Task hover.                                              |
| `work-ledger-conversation-row-browser.test.ts` | Use an isolated real Overlay fixture to assert Mission/Chat transparent hover, preserved Task and selected feedback, exact rendered icon classes, and the desktop screenshot. |

### Independent agent feedback

- A read-only audit confirmed that Work Ledger owns the row kind mark, the hover paint comes from the shared navigation-row primitive, and the safest repair is a local Work Ledger override rather than a global primitive change.

## Implementation plan

1. Replace the live Mission row icon mapping with the existing goal/target icon while preserving Chat and Task mappings.
2. Suppress only non-selected Mission/Chat pointer-hover background paint while preserving Task hover feedback.
3. Add source and Node browser regressions for hover paint, selected-state preservation, and exact icon identities.
4. Run focused tests, typecheck/build, real browser screenshot review, documentation health, and final diff review.
