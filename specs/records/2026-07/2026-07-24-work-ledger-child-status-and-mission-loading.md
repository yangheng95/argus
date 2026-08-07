# Work Ledger child status and Mission loading repair

## Recall

### User requirement

- Correct the Work Ledger lifecycle colors for the four primary child-task states: in progress, failed, cancelled, and completed.
- Restore the original hierarchy: a Mission parent row shows only the loading treatment while it is running; lifecycle status dots belong only to child Task rows.
- Use the attached screenshot as the visual reference for the left-sidebar Mission and child-task region.

### Acceptance criteria

- Active child Tasks use the blue accent status dot.
- Failed child Tasks use the red failure status dot.
- Cancelled child Tasks use the yellow warning status dot.
- Completed child Tasks use the green success status dot.
- Mission parent rows never render a lifecycle status dot.
- A running Mission parent row renders the existing registered loading glyph with the shared `oc-spin` animation; a settled Mission parent row renders no trailing lifecycle mark.
- Hover and keyboard-open action rails continue to replace the trailing indicator without changing the existing right-column geometry.
- The desktop Work Ledger fixture is rendered through the Node-launched browser runner and visually reviewed without touching the user's running Overlay process.

### Hard constraints

- Preserve unrelated concurrent worktree changes.
- Reuse `Icon name="loading"`, `StatusIndicator`, the existing action-size axis, and shared motion/color tokens; do not add a second status primitive or animation.
- Keep the Task lifecycle source in `work-ledger.ts`; do not infer states from titles, labels, or child counts in Cascading Style Sheets.
- Desktop-only delivery; no mobile or responsive scope is added.
- Add focused source and real-browser regression coverage, then commit with the required `dsw-33987` prefix and push to `myhexin`.

### Read material

- Attached `image.png` reference.
- `AGENTS.md` and `CLAUDE.md`.
- `specs/records/2026-07/2026-07-14-overlay-startup-and-chrome-parity.md`.
- `specs/records/2026-07/2026-07-15-task-attention-interaction-dialog.md`.
- `specs/records/2026-07/2026-07-23-overlay-goal-status-settings-macos-keyboard-repair.md`.
- `packages/overlay/src/components/WorkLedger.tsx`.
- `packages/overlay/src/services/work-ledger.ts`.
- `packages/overlay/src/components/ui/StatusIndicator.tsx`.
- `packages/overlay/src/styles/primitives/icon.css`.
- `packages/overlay/src/styles/surfaces/work-ledger.css`.
- Existing Work Ledger source and Node browser regressions.

### Whole-repository grep evidence

| Owner / call site                                                                               | Decision                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workLedgerPresentationStatus`                                                                  | Preserve canonical lifecycle calculation for Task, Mission, and Chat consumers; this repair changes Work Ledger row presentation, not backend state semantics. |
| `WorkLedgerRowView`                                                                             | Branch by row kind: Mission owns loading-only presentation, Task owns lifecycle dots, Chat owns no Work Ledger lifecycle mark.                                 |
| `WorkLedgerTaskChildRow`                                                                        | Remains the child-task mounting owner; no second child renderer is introduced.                                                                                 |
| `StatusIndicator` / `icon.css`                                                                  | Keep the shared primitive. Correct the global cancelled lifecycle semantic from muted gray to warning yellow so all consumers share one color source.          |
| `work-ledger.css`                                                                               | Restore the existing loading icon box and `oc-spin` animation while preserving the action-size right-axis and hover collapse contract.                         |
| `TaskStatusHeader`                                                                              | Continues using `StatusIndicator`; it benefits from the corrected cancelled color but does not adopt the Work Ledger parent/child structural rule.             |
| `titlebar-toolbar-toggle-browser.test.ts`                                                       | Replace the obsolete assertion that an active Mission parent owns a lifecycle dot with the loading-only contract.                                              |
| `hover-action-geometry.test.ts`                                                                 | Render one Mission parent and all four child lifecycle states, assert colors/structure/geometry, and capture the reviewed desktop evidence.                    |
| `work-ledger-consolidation.test.ts`, `task-row-right-alignment.test.ts`, motion/ownership tests | Assert the single-owner source structure, shared tokens, and restored loading animation without duplicating status rules.                                      |

### Independent agent feedback

- None. The implementation, shared primitive, geometry, and browser fixture are tightly coupled and have overlapping files, so delegation would not create an independent write surface.

## Implementation plan

1. Restore Mission loading-only and Task dot-only rendering in `WorkLedgerRowView` while keeping shared status labels and lifecycle calculation.
2. Correct the shared cancelled lifecycle color to the warning token and restore the existing loading icon animation/geometry styles.
3. Update source and Node browser regressions for all four child colors, Mission parent structure, hover behavior, accessibility, and screenshots.
4. Run focused tests, Overlay typecheck/i18n/build, documentation health, and diff checks; inspect screenshots and correct any visual mismatch.
5. Conduct a second diff review, commit the scoped files, fetch, and push the branch to git-cc.

## Result

- `WorkLedgerRowView` now receives one explicit `showTaskStatus` structural permission from `WorkLedgerTaskChildRow`. Mission children render lifecycle dots; top-level Tasks, Chats, and Mission parent rows do not infer visibility from IDs or status data.
- Active Mission parent rows render the existing registered `loading` icon through the shared `oc-spin` animation. Settled Mission rows render no trailing lifecycle mark.
- The shared `StatusIndicator` maps cancelled lifecycle state to `--warn`; active, failed, and completed remain on `--accent`, `--bad`, and `--good`. The rendered child-task colors are therefore blue, red, yellow, and green from one primitive source.
- Loading and child dots retain the existing 18-pixel trailing action axis and collapse when hover or keyboard actions replace that slot.

### Verification

- `bun test packages/overlay/test/work-ledger-consolidation.test.ts packages/overlay/test/task-row-right-alignment.test.ts packages/overlay/test/owner-surface-consistency.test.ts`: 24 passed, 555 assertions.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/hover-action-geometry.test.ts`: passed through the required Node-launched browser sidecar.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay check:i18n`: passed.
- `bun run --cwd packages/overlay build:vite`: passed; Vite reported only its existing large-chunk warning.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 21 passed.
- `git diff --check`: passed.

### Visual review

- `.scratch/work-ledger-mission-loading-child-status-colors.png` was reviewed at original resolution. The Mission parent has a rotating loading glyph and no dot; the child rows show active blue, failed red, completed green, and cancelled yellow dots on one trailing axis.
- `.scratch/work-ledger-attention-lifecycle-separation.png` confirms the interaction-attention badge remains visually separate from the Mission loading indicator.
- `.scratch/work-ledger-status-column-alignment.png` confirms the failure dot remains centered in the shared trailing box.
- The user's running OpenCorvus/Overlay process was not restarted, refreshed, stopped, or reused for validation.

### Concurrent-work boundary

- During validation, independent Work Ledger hover/kind-icon and child-insertion-motion edits appeared in the same shared files. They were preserved and excluded from this repair's staged patch. Full cross-surface motion and titlebar suites also observed unrelated concurrent failures in `conversation.css` timing and Right Dock/focus contracts; the dedicated Work Ledger tests, browser fixture, typecheck, i18n, build, and document-link checks above are the acceptance evidence for this scoped change.

## Follow-up correction — loading visibility during child expansion

### User correction

- The previous delivery did not fix the real interaction: the loading indicator disappeared when the Mission row was hovered to reveal its child tasks.

### Root cause

- Mission loading rendering and state calculation were correct.
- `work-ledger.css` grouped `.work-row-loading-icon` with child lifecycle dots in the hover/action-rail collapse selector.
- Mission children are revealed only while the parent shell is hovered or focused, so the interaction required to inspect children simultaneously forced the parent loading box to width `0` and opacity `0`.
- The previous browser fixture validated only the resting state and therefore missed the contradictory hover combination.

### Corrected acceptance

- Hovering or focusing a Mission can reveal child tasks and actions without hiding the Mission loading indicator.
- Child lifecycle dots continue to yield their own trailing slot to row actions when the child row itself is hovered.
- The real browser regression asserts loading width, opacity, animation, child-drawer visibility, and action-rail visibility in the same hover state and captures that rendered state.
