# Work Ledger Project Pin/Unpin and Icon Repair

## Recall

- User request: the task-list pin icon looks improvised, and a pinned project cannot be unpinned. Scope is UI style/layout/spacing/proportion/font and the pin/unpin behavior required by that UI; no unrelated product changes.
- Acceptance criteria:
  - Delete the duplicate 10px row-leading pin marker; Mission/Chat rows use the existing `Button` plus central `Icon` registry as their only pin affordance.
  - Project rows expose persistent pin and unpin actions using the same mature primitives.
  - The `Pinned` section is derived only from canonical pinned Project rows; the hard-coded current-project shortcut is removed.
  - `project.time_pinned` is the only Project pin source, does not mutate recent-activity time, survives reload, emits the existing Project update event, and participates in Work Ledger pin-first ordering and cursor pagination.
  - Task rows remain non-pinnable.
  - Focused backend, API, Overlay, keyboard/action, real browser interaction, screenshot inspection, generated contract/docs, and second review pass.
- Hard constraints: no fallback, compatibility path, local shadow state, state machine, gate, database migration, or running OpenCorvus/overlay restart/refresh; use Node for Playwright; preserve unrelated dirty work; commit subject begins `dsw-33987` and push the current branch to `myhexin` after verification.
- Sources read: `AGENTS.md`; `specs/records/2026-07/2026-07-12-work-ledger-pin-unpin.md`; `specs/current/architecture/02-data.md`; `ProjectLedgerGroup.tsx`; `WorkLedger.tsx`; `Icon.tsx`; `work-ledger.css`; `sidebar.css`; Overlay Work Ledger service/tests/browser fixture; Project schema/domain; Work Ledger projection/route/tests; generated OpenAPI/SDK/docs surfaces.
- Whole-repository search evidence: `work-ledger-pinned-current-project` exists only in `WorkLedger.tsx` and one browser layout test; `work-row-pinned-mark` exists only in `WorkLedger.tsx`, its CSS, and consolidation assertions; `time_pinned` exists only on Session and its Work Ledger projection; Project has no pin field/writer; `setWorkLedgerPinned` is the only Overlay mutation; generated SDK/docs expose only the Session pin route. Project group actions are centralized by `ProjectLedgerGroup`.
- Independent agent feedback: none; the user did not request sub-agents and the active policy forbids spawning them otherwise.

## Root cause and replacement design

The prior implementation conflated two different concepts: durable Session pinning and a static current-project navigation shortcut. It then added a second tiny pin ahead of the row title because the real action rail is hover-revealed. The result had two icon semantics for Mission/Chat and no mutation semantics for Project.

Project pinning belongs to the Project domain. Add nullable `project.time_pinned`, project it through `Project.Info`, mutate it through one Project writer, and publish the existing `Project.Event.Updated`. Work Ledger remains the only combined read model. Project group headers call the Project mutation client; the `Pinned` section filters that same projection and offers a visible unpin button. Mission/Chat keep their existing Session writer but use one icon button with active state instead of a duplicate leading marker.

## Call-site disposition

| Surface | Disposition |
| --- | --- |
| `project/project.sql.ts` | Add nullable `time_pinned`; no migration for the unreleased schema. |
| `project/project.ts` | Project through `Info`/row mapping/insert; add the only pin writer and emit `Project.Event.Updated` without changing `time_updated`. |
| `work-ledger/projection.ts` | Project `pinned`; use Project pin timestamp in the existing pin partition and cursor. |
| `server/routes/work-ledger.ts` | Add typed Project pin mutation delegating to the Project writer. |
| OpenAPI/SDK/API docs/data architecture | Regenerate/update the real contract and declare Project/Session pin sources explicitly. |
| `overlay/services/work-ledger.ts` | Mirror Project pin state and expose the Project mutation client. |
| `ProjectLedgerGroup.tsx` | Add a Project pin/unpin action in the existing centralized action rail. |
| `WorkLedger.tsx` | Delete the small row marker/static shortcut; render pinned Projects from the projection; wire project group and pinned-section unpin to the same mutation/reload path. |
| Work Ledger/sidebar CSS | Delete obsolete marker rules; style the centralized icon action and pinned-project row using existing tokens. |
| backend/Overlay/browser tests | Cover persistence, no activity-time mutation, sorting/cursor, API shape, visible pin/unpin, keyboard labels, actual request sequence, and screenshot geometry. |

## Benchmark

- Fixture: at least two Projects plus Mission/Chat/Task rows, with one Project initially pinned.
- Interaction: pin an unpinned Project from its group action, verify canonical reload places it in `Pinned`, then unpin it from `Pinned` and verify removal plus the Project API request body.
- Visual pass: render the isolated Overlay fixture in a real desktop viewport and inspect the screenshot; no duplicate pin before row titles, no improvised glyph, and project action spacing aligns with existing project-group actions.
- Timeout: Node browser/test supervisors use inactivity-based progress timeout evidence, not a wall-clock timer from process start.
- Pass: focused server/projection/Overlay/browser tests, typecheck/build, generated API/docs checks, spec health, screenshot review, and final diff review all pass.

## Progress

- [x] Recall and whole-repository call-site inventory.
- [x] Root-cause design and acceptance benchmark landed.
- [x] Project persistence, projection, route, and generated contracts.
- [x] Overlay action/visual repair and regression tests.
- [x] Real browser interaction and screenshot review.
- [x] Second implementation and visual review.
- [x] Hunk-only commit and `myhexin/v0.0.3beta` push completed.

## Verification record

- `bun test packages/overlay/test/work-ledger-consolidation.test.ts packages/opencorvus/test/server/work-ledger-routes.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts`: relevant suites passed; the combined run also exposed the unrelated dirty-worktree `AttachmentRecoveryCleanupTable` writer-registry failure.
- `bun run api:routes-check`: passed, 6 rules and 30-file route inventory clean.
- `bun run docs:check`: passed, 252 operations across 24 groups.
- `bun run typecheck`: passed all 9 workspace typecheck tasks.
- Git-index virtual typechecks passed for the staged Overlay and backend files, preventing unrelated unstaged source from masking an incomplete commit.
- `bun run build:vite`: passed; the existing chunk-size warning remains informational.
- `node test/browser-runner.mjs test/browser/ledger-scrollbar-browser.test.ts`: passed through the Node inactivity-aware runner; actual Project PATCH sequence was `[false, true]`.
- Screenshots reviewed: `.scratch/work-ledger-scrollbar-visible.png`, `.scratch/work-ledger-project-unpin-hover.png`, and `.scratch/work-ledger-row-pin-hover.png`. A transform-based unpin action initially produced a Chromium black compositing layer; the transform/transition was deleted and the clean screenshots were reverified.
- `document-health.test.ts`: 52/53 passed; the remaining monthly-index failure is caused by five other user-owned untracked July records plus this new record before staging. This task does not stage the unrelated records.
