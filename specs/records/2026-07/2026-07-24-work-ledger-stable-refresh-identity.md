# Work Ledger Stable Refresh Identity

## Recall

### User requirement

- Diagnose and remove the intermittent flash in the left task list shown in the attached screenshot.

### Acceptance criteria

- A background Work Ledger refresh whose payload is unchanged keeps the existing project-group and row DOM nodes mounted.
- A refresh that changes one row updates that row without remounting unchanged sibling rows.
- A genuinely inserted, removed, or reordered row still appears in the server-projected order.
- Hover, selection, keyboard focus, Mission child disclosure, and the existing insertion animation keep their current behavior.
- A real desktop Overlay fixture drives a Work Ledger Server-Sent Events (SSE) refresh, verifies DOM identity, and produces a visually reviewed left-rail screenshot.

### Hard constraints

- `GET /work-ledger` remains the single list snapshot source and `/work-ledger/events` remains the change-notification source.
- Do not add a second cache, polling path, gate, state machine, or Cascading Style Sheets (CSS) masking workaround.
- Use Solid's established fine-grained store reconciliation rather than a hand-written UI remount controller.
- Preserve unrelated dirty worktree changes and do not restart, refresh, or otherwise interfere with the user's running OpenCorvus/Overlay process.
- Desktop-only scope; no responsive or mobile work is introduced.

### Sources read

- User screenshot `codex-clipboard-2f137580-b61a-4c20-9699-4f967f1ffd25.png`.
- `specs/current/architecture/07-panel.md`.
- `specs/records/2026-07/2026-07-16-work-ledger-selection-primitive.md`.
- `specs/records/2026-07/2026-07-24-work-ledger-conversation-hover-and-kind-icons.md`.
- `specs/records/2026-07/2026-07-24-work-ledger-child-status-and-mission-loading.md`.
- `specs/records/2026-07/2026-07-24-mission-child-task-staggered-insertion-motion.md`.
- `packages/overlay/src/components/WorkLedger.tsx`, `LedgerList.tsx`, and `ProjectLedgerGroup.tsx`.
- `packages/overlay/src/services/work-ledger.ts`, `services/sse.ts`, `store/board.ts`, and `main.tsx`.
- Work Ledger source tests and Node-driven browser fixtures.

### Whole-repository search evidence

The investigation searched all `WorkLedger`, `work-ledger`, `refreshToken`, `missionSharedRefreshToken`, `setRows`, Work Ledger SSE, task-list projection, and list-rendering call sites across `packages/overlay`, `packages/opencorvus`, and `specs`. The captured raw call-site list is `.scratch/work-ledger-flicker-call-sites.txt`.

| Owner / call site | Evidence | Decision |
| --- | --- | --- |
| `main.tsx` `handleWorkLedgerStreamEvent` | Every relevant global event increments the Work Ledger refresh token. | Preserve; the event is a change notification, not a full payload. |
| `WorkLedger.createEffect` | Debounces the token and calls `reload()`. | Preserve; this is the component's single refresh owner. |
| `WorkLedger.loadPage(false)` | Replaces the decoded snapshot with newly allocated row objects even when their content is unchanged. | Keep the transport snapshot outside rendering and reconcile the keyed render projection at the existing write boundary. |
| `WorkLedger.groups` | Derives new group objects from rows for sorting and organization. | Reconcile the derived render groups by canonical directory. |
| `LedgerList` and pinned-group `<For>` | Solid `<For>` tracks objects by reference, so new group objects remount entire project subtrees. | Feed both surfaces the same reconciled project-group store. |
| `WorkLedgerProjectGroupView` row `<For>` | Tracks row objects by reference. | Give render rows stable `kind:id` keys so recursive reconciliation retains unchanged rows. |
| Mission child `<For>` | Tracks backend-projected child task rows. | Nested keyed reconciliation keeps unchanged children mounted while retaining canonical order and insertion animation for real additions. |
| `board.ts` task list | Already has a separate `reconcileTaskItems` boundary for the legacy task projection. | Preserve; the screenshot surface is Work Ledger, and duplicating its projection would violate single-source ownership. |

### Independent agent feedback

No independent agent was requested or started. The active repository policy forbids sub-agent delegation unless the user explicitly asks for it; the primary agent owns investigation, implementation, browser verification, and second review.

## Root cause

The observable flash is not a missing-data interval. A Work Ledger change event reloads a complete JSON snapshot, and `setRows(result.rows)` replaces every row object even when the payload is byte-for-byte equivalent. Solid's `<For>` reuses children by object identity, while the derived project groups are also recreated on every rows update. The unchanged list is therefore torn down and mounted again. That replacement resets pointer/focus state and repaints selected backgrounds, icons, text, tooltips, and Mission child motion, producing the intermittent single-frame flash.

## Implementation plan

1. Keep the decoded Work Ledger snapshot as the transport source and build one keyed render projection from it.
2. Reconcile project groups by canonical directory and rows, including Mission children, by `kind:id` with Solid's established `reconcile(..., { key: "renderKey", merge: true })`.
3. Feed both pinned and unpinned project-group surfaces from those reconciled stores while retaining the server-projected row order.
4. Add focused source contracts and a Node-launched browser regression that emits unchanged Work Ledger events and asserts project/row DOM identity plus hover and focus continuity.
5. Build, run focused tests, inspect the goal-scoped screenshot, run documentation health checks, review the diff twice, commit with the required prefix, fetch, and push to `legacy-remote`.

## Validation plan

```powershell
bun test packages/overlay/test/work-ledger-consolidation.test.ts packages/overlay/test/task-row-right-alignment.test.ts packages/overlay/test/owner-surface-consistency.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/project-folder-picker-work-ledger.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay build:vite
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

## Validation results

- The real browser regression failed before implementation with both `project: false` and `task: false`, proving that an unchanged existing project and task were remounted when a second project arrived through the live Work Ledger refresh.
- After the keyed reconciliation change, the same Node-launched desktop fixture passed. It then emitted a second payload-equivalent Work Ledger event and proved that the project node and task node remained identical, the task still matched `:hover`, and keyboard focus remained inside the same row.
- The reviewed goal-region screenshot is `.scratch/work-ledger-stable-refresh-identity.png`. It shows the unchanged task row retaining its hover wash, visible focus ring, title, kind icon, and trailing actions after the no-op refresh; the newly projected project appears in the server-defined order.
- Focused Work Ledger source/geometry/ownership tests passed: 24 tests, 567 assertions.
- Overlay TypeScript typecheck passed.
- Vite production build passed through the browser runner; only the repository's existing large-chunk warning was reported.
- `git diff --check` passed.
- Historical-document links, product-document single-source, and document-health checks passed: 87 tests, 1,420 assertions.

## Codex review feedback

- The first implementation draft exposed render-model predicates that still named the transport Task type; they were narrowed to the keyed render Task type so queue ordering remains type-safe.
- The first strengthened browser assertion used a response-wait method unavailable in the repository's browser wrapper. The fixture now observes the actual server-side snapshot request count, then verifies DOM, hover, and focus continuity; it does not use a timer as acceptance evidence.
- Final review confirmed that `renderKey` is presentation-only: raw backend rows remain the input to `setWorkLedgerRuntimeRows`, `/work-ledger` remains the single snapshot source, and no second list cache, polling path, or CSS masking behavior was introduced.
