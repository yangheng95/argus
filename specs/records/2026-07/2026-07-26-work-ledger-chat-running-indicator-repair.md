# Work Ledger Chat running-indicator repair

## Recall

### User requirement

The user reported that a Work Ledger Chat row no longer shows the Codex-inspired
rotating progress indicator while its conversation is actively running. The
provided screenshots identify the missing affordance at the trailing edge of the
Chat row and confirm that this behavior existed previously.

### Acceptance criteria

- An active Chat row renders the existing registered loading icon at the row's
  trailing edge.
- Idle and terminal Chat rows do not render a loading indicator or a Task
  lifecycle dot.
- Active Mission rows continue to use the same loading indicator.
- Child Task rows continue to own the existing active, failed, cancelled, and
  completed status dots.
- The loading indicator remains visible when row actions are revealed by pointer
  hover or keyboard focus, matching the existing Mission interaction.
- A real Overlay fixture, exercised with the Node browser runner, proves rendered
  geometry, animation, idle-row exclusion, hover behavior, and the target visual.

### Hard constraints

- Preserve `resolveSessionActivityStatus` and `workLedgerPresentationStatus` as
  the single backend and frontend status projection path; do not add a second
  running-state source.
- Reuse the existing `loading` icon, `.work-row-loading-icon` geometry, and
  `oc-spin` animation.
- Do not introduce a lifecycle state machine, fallback, compatibility branch, or
  task-specific status inference.
- Do not restart, refresh, or otherwise disturb the user's running OpenCorvus or
  overlay process. Visual verification uses an isolated test server.
- Playwright must be launched by Node.

### Materials read

- `specs/current/architecture/07-panel.md`
- `specs/current/architecture/07-panel-reactivity.md`
- `specs/current/architecture/12-overlay-card-system.md`
- `specs/records/2026-07/2026-07-24-work-ledger-child-status-and-mission-loading.md`
- `packages/opencorvus/src/work-ledger/projection.ts`
- `packages/overlay/src/services/work-ledger.ts`
- `packages/overlay/src/components/WorkLedger.tsx`
- `packages/overlay/src/styles/surfaces/work-ledger.css`
- Work Ledger source, service, and browser tests named in the grep inventory
  below.

### Whole-repository grep inventory

| Surface                     | Evidence                                                                                                                                 | Decision                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Backend Chat activity       | `packages/opencorvus/src/work-ledger/projection.ts` calls `resolveSessionActivityStatus(sessionID)` for Chat rows                        | Preserve; this is the canonical activity source.                                              |
| Frontend presentation       | `packages/overlay/src/services/work-ledger.ts` maps active Chat rows to `active`, terminal rows to `completed`, and other rows to `idle` | Preserve; no additional projection is required.                                               |
| Row renderer                | `packages/overlay/src/components/WorkLedger.tsx` currently limits `.work-row-loading-icon` to `row().kind === "mission"`                 | Replace the renderer predicate with one shared active-session predicate for Mission and Chat. |
| Task status dots            | The same component limits `StatusIndicator` to child Task rows                                                                           | Preserve unchanged.                                                                           |
| Loading geometry and motion | `packages/overlay/src/styles/surfaces/work-ledger.css` owns `.work-row-loading-icon` and its `oc-spin` animation                         | Reuse unchanged.                                                                              |
| Source regression tests     | `packages/overlay/test/work-ledger-status-hierarchy.test.ts` and `work-ledger-consolidation.test.ts` assert the Mission-only predicate   | Update both to assert active Mission/Chat loading and Task-only dots.                         |
| Service/runtime tests       | `work-ledger-status-display.test.ts`, `work-ledger-runtime-state.test.ts`, and `work-ledger-service.test.ts` cover status projection     | Run focused coverage; change only if an uncovered semantic is found.                          |
| Static visual fixture       | `packages/overlay/test/browser/work-ledger-status-hierarchy-browser.test.ts` covers Mission loading and child Task dots                  | Preserve as the hierarchy fixture.                                                            |
| Real Overlay fixture        | `packages/overlay/test/browser/work-ledger-conversation-row-browser.test.ts` exercises actual Mission/Chat rows in the built Overlay     | Extend with active and idle Chat evidence and a goal-scoped screenshot.                       |
| Historical decision         | `2026-07-24-work-ledger-child-status-and-mission-loading.md` explicitly removed Chat lifecycle marks                                     | Supersede only its Chat clause; retain Mission loading and Task dot ownership.                |

### Independent agent feedback

No independent agent was requested for this focused repair. The investigation,
implementation, and second review remain in the primary agent.

## Causal chain

The observable missing spinner is not a backend liveness failure. Chat activity is
still projected from the active session through the canonical Work Ledger status
pipeline. The direct trigger is the Mission-only renderer predicate introduced by
the 2026-07-24 hierarchy change. That change correctly separated Task lifecycle
dots from parent rows, but incorrectly treated a Chat's active progress affordance
as a lifecycle dot and removed it entirely. The repair belongs in the renderer
predicate, where the existing active status can drive the existing loading
primitive for both session-like rows without changing status ownership.

## Implementation plan

1. Replace the Mission-only loading predicate with a named active-session
   predicate covering Mission and Chat.
2. Keep Task `StatusIndicator` ownership and loading CSS unchanged.
3. Update source regression assertions.
4. Extend the real Overlay browser fixture with active and idle Chat rows, verify
   animation and hover geometry, and inspect the captured screenshot.
5. Run focused tests, document-health checks, typecheck/build checks, and a second
   diff review before committing and pushing to `myhexin`.

## Result

Implemented the repair in `WorkLedgerRowView` by replacing the Mission-only
loading predicate with `sessionLoading`, which accepts active Mission and Chat
rows from the existing presentation-status projection. The Task-only status-dot
predicate and all loading geometry, icon, animation, and backend status code
remain unchanged.

The real Overlay browser fixture now carries active, idle, and terminal Chat
rows. It proves that the active row has exactly one animated `oc-spin` loading
primitive, has no Task status dot, retains non-zero loading geometry while hover
actions are visible and while keyboard-focused, and that idle and terminal rows
have neither loading nor status-dot markup.

## Verification

- `bun test packages/overlay/test/work-ledger-status-hierarchy.test.ts packages/overlay/test/work-ledger-consolidation.test.ts packages/overlay/test/work-ledger-status-display.test.ts packages/overlay/test/work-ledger-runtime-state.test.ts packages/overlay/test/work-ledger-service.test.ts`
  - 16 passed, 0 failed.
- `bun run --cwd packages/overlay typecheck`
  - passed.
- `bun run --cwd packages/overlay check:i18n`
  - passed.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/work-ledger-conversation-row-browser.test.ts`
  - passed against the built Overlay using the Node runner.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/work-ledger-status-hierarchy-browser.test.ts`
  - passed, retaining Mission loading and the four child Task lifecycle colors.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`
  - 84 passed, 0 failed.

## Visual review

- `.scratch/work-ledger-chat-running-indicator.png` shows the active Chat's
  rotating incomplete-circle glyph at the trailing edge in the default row
  presentation; the adjacent idle and completed Chat rows have no glyph.
- `.scratch/work-ledger-chat-running-indicator-hover.png` shows the same loading
  glyph retained when stop, rename, and archive actions become visible.
- `packages/overlay/.scratch/work-ledger-status-hierarchy.png` and its hover
  variant confirm that the existing Mission/child Task hierarchy remains
  visually intact.
