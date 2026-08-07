# Task title Mission-child status index repair

## Recall

| Field | Evidence |
| --- | --- |
| User requirement | The Task conversation title must visibly show the current Task lifecycle state, including in-progress, failed, completed, and cancelled. The status point that previously followed the title is currently absent. |
| Supplied visual evidence | `C:\Users\10132\AppData\Local\Temp\codex-clipboard-d89f281c-f67f-4286-9e04-4c60c4a41b41.png` shows a selected `Phase 01: 调查并修复公开缺陷` Task title with no following status presentation. |
| Acceptance criteria | Every selected Task whose canonical lifecycle is queued, active, completed, failed, or cancelled renders the existing title `StatusIndicator` point and localized label. A Task nested under a Mission must behave exactly like a top-level Task. Existing Task elapsed-time behavior and Mission/Chat title status behavior remain intact. A Node-launched real Overlay fixture must render and capture the Mission-child Task title region. |
| Hard constraints | Preserve the Work Ledger presentation service as the single Task/Mission/Chat lifecycle projection. Do not add a title-side fallback, second status store, keyword inference, compatibility route, gate, or new status primitive. Reuse `StatusIndicator`, lifecycle labels, and the existing conversation-header geometry. Preserve unrelated dirty changes in `work-ledger.css`, `agent-card-separation-browser.test.ts`, `task-dirbar-keyboard.test.ts`, and `navigation-row-primitive.test.ts`. Do not restart or refresh the user's running OpenCorvus/Overlay; visual verification uses an isolated server. Playwright must run through Node. Desktop-only scope. |
| Architecture and records read | `specs/current/architecture/07-panel.md`; `specs/current/architecture/07-panel-reactivity.md`; `2026-07-23-settings-menu-skill-hub-and-work-status-semantics.md`; `2026-07-24-work-ledger-child-status-and-mission-loading.md`; `2026-07-26-work-ledger-chat-running-indicator-repair.md`; current Work Ledger projection/service/component, Task selection/store, conversation-title, status-label, status-mapping, and browser-test sources. |
| Repository state | Branch `work-v0.0.19beta-yr-0727` is at `47674e9748`, matching the fetched `myhexin` tracking ref after another process concurrently completed the same baseline push. Pre-push typecheck, route, docs, i18n, and secret checks passed. Four pre-existing dirty files are preserved. |
| Independent-agent feedback | No subagent was launched because the user did not request delegation; the primary agent owns the required second review. |

## Causal chain

1. **Observable symptom:** the selected Mission child Task title renders, but the status point, status label, and elapsed time are all absent.
2. **Direct trigger:** `TaskStatusHeader.execution()` calls `workLedgerTaskExecution(source.id)`. `workLedgerTaskExecution()` returns `null`, so `visible()` is false and Solid renders no `#taskStatus` subtree.
3. **Deep cause:** the backend Work Ledger deliberately embeds Mission child Tasks in `WorkLedgerMissionRow.tasks`. `setWorkLedgerRuntimeRows()` indexes only each top-level response row and never indexes those embedded real Task rows. The visible Work Ledger can therefore render a Mission child while the shared runtime lookup cannot resolve the same child identity.
4. **Why earlier coverage missed it:** the Task-status browser fixture projected every Task as a top-level Work Ledger row. The runtime service test also used an empty `mission.tasks` array plus a separate top-level Task row, so neither exercised the production Mission-child shape.
5. **Reproduction evidence:** importing the current service, setting one Mission row containing `task-child`, and calling `workLedgerTaskExecution("task-child")` prints `{"nestedTask":null}`.

This is an indexing-boundary defect, not a Cascading Style Sheets visibility
problem and not a missing backend lifecycle fact.

## Whole-repository call-site inventory

| Owner / call site | Disposition |
| --- | --- |
| `setWorkLedgerRuntimeRows()` | Repair here: index every top-level non-Project row and every `WorkLedgerMissionRow.tasks` child into the same keyed runtime projection. |
| `WorkLedger.loadPage()` | Preserve as the only production writer of runtime Work Ledger rows. It continues passing the schema-validated response unchanged. |
| `workLedgerTaskExecution()` | Preserve as the selected Task title lookup; it will resolve top-level and Mission-child Tasks from the completed index. |
| `workLedgerSessionExecution()` / `workLedgerSessionInterruptible()` | Preserve Mission/Chat lookup and composer behavior unchanged. |
| `workLedgerPresentationStatus()` / `workLedgerPresentationLabel()` / `workLedgerStatusVisible()` | Preserve as the single status/label/visibility semantics consumed by Work Ledger and the conversation title. |
| `TaskStatusHeader` | Preserve the existing `StatusIndicator` dot, localized text, elapsed-time, and strict timestamp diagnostics. No fallback to `board.task.status` is added. |
| `WorkLedgerRowView` / `WorkLedgerTaskChildRow` | Preserve child rendering and Task-only status-dot structure; the repair changes lookup completeness, not left-rail hierarchy. |
| `main.tsx` session execution lookup | Preserve; it reads only Mission/Chat rows and is unaffected by child Task indexing. |
| `work-ledger-runtime-state.test.ts` | Add a regression where the only Task row is nested inside a Mission and must be discoverable by exact Task ID. |
| `task-status-header-missing-completion-browser.test.ts` | Change the Work Ledger fixture to the production Mission-with-embedded-Tasks shape; assert title status presence and parity for active, queued, completed, failed, and cancelled child Tasks; capture the selected title region. |
| Status/architecture/source tests | Run unchanged to prove no second lifecycle mapping or primitive was introduced. |

## Implementation plan

1. Extend the Work Ledger runtime indexer to include Mission child Task rows by
   their canonical `task:<id>` keys.
2. Add focused runtime-service coverage proving exact lookup of a Mission child
   without a duplicate top-level Task row.
3. Make the existing real Overlay Task-status fixture production-shaped by
   serving one Mission row containing its child Tasks. Cover active, queued,
   completed, failed, and cancelled title states, existing elapsed semantics,
   and icon/label parity.
4. Run focused tests, Overlay typecheck/i18n/build, document health, and
   `git diff --check`.
5. Use the Browser skill against the isolated fixture to inspect the rendered
   title-region screenshot at original resolution, correct any visual mismatch,
   rerun acceptance, and perform a second source/diff review.
6. Commit only attributable files with the required `dsw-33987` prefix and push
   the current delivery branch to `myhexin`.

## Result

- `setWorkLedgerRuntimeRows()` now indexes every Mission-embedded Task under
  its canonical `task:<id>` identity in the existing runtime projection.
- `TaskStatusHeader` remains unchanged and continues to consume only
  `workLedgerTaskExecution()` plus the shared Work Ledger presentation
  semantics. No title-side fallback or duplicate lifecycle source was added.
- The browser fixture now matches the production response shape: one Mission
  owns its child Tasks, and terminal execution status values follow the schema
  contract (`success` or `failed`) instead of copying lifecycle values.
- Regression coverage proves that active, queued, completed, failed, and
  cancelled Mission-child Tasks all render the existing title status point and
  localized accessible label.

## Verification and visual review

| Check | Result |
| --- | --- |
| Focused Work Ledger/status unit tests | 27 passed, 0 failed. |
| Overlay TypeScript check | Passed. |
| Overlay internationalization check | Passed. |
| Real Overlay browser acceptance | 8 passed, 0 failed through the Node-launched Playwright runner. |
| Production Overlay build | Passed while preparing the isolated browser fixture; only the repository's existing Vite advisory warnings were emitted. |
| Historical-link and document-health suites | 85 passed, 0 failed after the new record was staged. |
| Staged-diff whitespace check | Passed. |
| Visual inspection | Original-resolution captures show the point immediately following the title: blue for active, neutral for queued, green for completed, red for failed, and amber for cancelled. The full header capture confirms that the point preserves title spacing and does not collide with the right-side toolbar. |

The screenshot crop intentionally exposes only the visible point. Status text
remains visually clipped by the established accessible-label design and is
available through the indicator title and accessible name.

## Second review

The second source and fixture review found and repaired two test-tool contract
gaps rather than weakening acceptance: the isolated app startup now serves the
required Mission-skill catalog route, and Work Ledger fixture execution values
now conform to the protocol schema. The production change remains the single
nested-row indexing repair.

Two broader source-contract test files contain pre-existing stale assertions,
and one Work Ledger hierarchy assertion conflicts with the user's current
unstaged stylesheet work. They are outside this repair and were not overwritten.
The focused ownership tests, real browser acceptance, build, typecheck, and
visual evidence all pass for the requested title-status delivery surface.
