# Work Ledger Mission and Chat border removal

## Recall

### User requirement

- Remove the outer border around Mission and Chat rows in the attached Work Ledger screenshot.
- Eliminate the visibly clipped border instead of recoloring or masking it.

### Acceptance criteria

- Mission and Chat rows have no border geometry in resting, pointer-hover, selected, or keyboard-focus states.
- The Mission and Chat main-button focus treatment does not draw a clipped outer frame inside the row.
- Mission and Chat selected rows keep their existing selected background, icons, text, loading indicator, and trailing actions.
- Task rows keep their existing hover, selected, notification, and focus contracts.
- A real desktop browser fixture verifies computed border widths, radius, focus shadow, preserved selected paint, and screenshots the Mission/Chat region.

### Hard constraints

- Preserve unrelated concurrent worktree changes and do not restart or refresh the user's running Overlay.
- Keep `.oc-navigation-row` and `.oc-button` as shared primitives; scope the exception to Work Ledger Mission and Chat rows.
- Do not hide the defect with an overlay, transparent color, fallback, or clipping adjustment. Remove the unwanted frame at its owner.
- Desktop-only delivery; no responsive or mobile scope is added.

### Read material

- Attached `image.png` reference.
- `AGENTS.md` and `CLAUDE.md`.
- `specs/records/2026-07/2026-07-24-work-ledger-conversation-hover-and-kind-icons.md`.
- `specs/records/2026-07/2026-07-24-work-ledger-child-status-and-mission-loading.md`.
- `packages/overlay/src/components/WorkLedger.tsx`.
- `packages/overlay/src/styles/primitives/{button,navigation-row}.css`.
- `packages/overlay/src/styles/surfaces/{sidebar,work-ledger}.css`.
- Existing Work Ledger source and Node browser regressions.

### Whole-repository grep evidence

| Owner / call site                              | Decision                                                                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkLedgerRowView`                            | Mission, Chat, and Task share one row renderer and expose exact `data-kind` attributes; preserve this single renderer.                                  |
| `.task-row-mini`                               | Owns the generic one-pixel transparent border and `overflow: hidden`; remove border geometry only for Mission/Chat instead of changing Task rows.       |
| `.oc-navigation-row`                           | Owns shared rounded hover/selected wash; Mission/Chat no longer need the framed silhouette, so override radius locally while preserving selected paint. |
| `.oc-button:focus-visible`                     | Owns the two-pixel focus shadow that is clipped by the row overflow; suppress only the Mission/Chat ledger main-button shadow.                          |
| `.work-row-kind-mark` and trailing actions     | Preserve icon, loading, lifecycle, and action geometry; they do not produce the reported outer frame.                                                   |
| `.project-group` / `.work-row-shell`           | Already borderless and must remain unchanged.                                                                                                           |
| `work-ledger-conversation-row-browser.test.ts` | Extend the real Overlay fixture to cover Mission/Chat resting, hover, selected, and focus borderlessness while confirming Task feedback remains.        |

### Independent agent feedback

- A read-only audit agreed that `.work-row-shell` and `.project-group` are not the border owners. The visible frame comes from the row/button interaction layers and should be removed with a Mission/Chat-scoped override rather than a global primitive change.

## Implementation plan

1. Remove border width and radius from Work Ledger Mission/Chat rows and suppress only their ledger-main focus shadow.
2. Extend source and Node browser regressions for resting, hover, selected, and keyboard-focus computed styles plus a desktop screenshot.
3. Run focused tests, Overlay typecheck/build, documentation health, real screenshot review, and final diff review.

## Result

- Work Ledger Mission and Chat rows now remove their inherited border width and rounded frame at the row owner. The fix does not recolor, cover, or clip the unwanted frame.
- The Mission/Chat ledger-main button no longer draws the generic two-pixel focus shadow that the row's overflow clipped. Keyboard focus remains visible through the existing row `:focus-within` wash without recreating an outer border.
- Selected Mission/Chat rows retain their selected background. Task rows retain the shared rounded hover/selected treatment and notification border behavior.

### Verification

- `bun test packages/overlay/test/work-ledger-consolidation.test.ts`: 9 passed, 454 assertions.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/work-ledger-conversation-row-browser.test.ts`: passed through the required Node-launched real Overlay fixture; its prerequisite Vite build also passed with only the existing large-chunk warning.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay check:i18n`: passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 21 passed.
- `git diff --check`: passed.

### Visual review

- `.scratch/work-ledger-conversation-borderless.png` was reviewed at original resolution. Mission and Chat render as borderless list content without clipped right or rounded edge fragments; icons, text, project hierarchy, and Task hover feedback remain intact.
- The user's running OpenCorvus/Overlay process was not restarted, refreshed, stopped, or reused for validation.
