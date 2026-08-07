# Work Ledger Project Selection Order Stability

## Recall

### User requirement

- Stop project rows from changing order whenever a project is clicked.

### Acceptance criteria

- Repeatedly selecting an existing project does not change its persisted activity timestamp.
- A Work Ledger refresh after project selection keeps every project group in the same order.
- A newly opened project still appears immediately through the canonical `ProjectTable` and `project.updated` path.
- Real Node-launched Vite browser interaction clicks a project row, verifies the before/after directory order, and produces a visually reviewed screenshot of the goal region.

### Hard constraints

- `ProjectTable` remains the single project-list source; no local Overlay order cache, frozen array, delayed refresh, fallback, compatibility branch, gate, or synthetic project row is allowed.
- Real project metadata changes still update `time_updated` and emit `project.updated`.
- Opening a new project still inserts the row and emits `project.updated`.
- Preserve unrelated worktree changes and do not restart or interfere with the user's running OpenCorvus or Overlay process.
- Desktop-only scope; Playwright is launched with Node.

### Sources read

- `specs/current/architecture/02-data.md`
- `specs/current/architecture/07-panel.md`
- `specs/records/2026-07/2026-07-09-work-ledger-open-project-immediate-projection.md`
- `specs/records/2026-07/2026-07-24-work-ledger-stable-refresh-identity.md`
- `packages/opencorvus/src/project/project.ts`
- `packages/opencorvus/src/project/instance.ts`
- `packages/opencorvus/src/work-ledger/projection.ts`
- `packages/overlay/src/main.tsx`
- `packages/overlay/src/services/workspace.ts`
- `packages/overlay/src/components/WorkLedger.tsx`
- `packages/overlay/src/components/ProjectLedgerGroup.tsx`
- Project, Work Ledger, and Node-driven browser tests.

### Whole-repository grep evidence

The investigation searched all `Project.fromDirectory`, `ProjectTable.time_updated`, `project.updated`, `WorkLedgerProjectRow`, `compareLedgerGroups`, `onSelectProject`, `selectWorkLedgerProject`, and project-group browser call sites across `packages/opencorvus`, `packages/overlay`, their tests, and `specs`.

| Owner / call site | Evidence | Decision |
| --- | --- | --- |
| `Project.fromDirectory()` | Every successful resolution overwrites `time_updated` with `Date.now()`, upserts the row, and emits `project.updated`, even when persisted project data is unchanged. | Preserve the stored timestamp and skip the write/event for an unchanged existing project. |
| `Project.fromDirectory()` first registration | Creates the canonical `ProjectTable` row needed by the empty-project Work Ledger projection. | Keep insertion and the visible `project.updated` event. |
| `Project.update`, `relocate`, `addSandbox`, and related explicit mutations | Own real metadata or directory-set changes. | Keep their timestamp mutations; they are genuine project changes. |
| `ProjectInstance` bootstrap and refresh callers | Re-enter `Project.fromDirectory()` for ordinary project-scoped reads and selection reloads. | Do not change callers; make resolution itself read-idempotent. |
| Work Ledger SQL and `compareLedgerGroups()` | Project rows expose `ProjectTable.time_updated`; default `updated` organization compares each group's maximum timestamp. | Preserve the established sorter once its input represents real changes. |
| `ProjectLedgerGroup` → `main.tsx` → `applyDirectory()` | Clicking a project reloads project scope and therefore triggers multiple `fromDirectory()` resolutions. | Preserve selection behavior; it must no longer manufacture activity. |
| Work Ledger keyed reconciliation | Already preserves Document Object Model identity when payload and order are unchanged. | Preserve; this defect is upstream timestamp churn, not another rendering cache issue. |

### Independent agent feedback

No independent agent was requested or started. Repository policy permits delegation only when the user explicitly asks for it, so the primary agent owns the investigation, implementation, browser verification, and second review.

## Root cause

The visible movement is deterministic timestamp churn. Selecting a project calls `applyDirectory()`, and the subsequent project-scoped reload resolves the directory through `Project.fromDirectory()`. That function currently replaces `project.time.updated` with the current time on every resolution, writes the otherwise unchanged row, and emits `project.updated`. The Work Ledger consumes that canonical row and sorts project groups by their latest timestamp, so the clicked project moves to the front.

The list sorter is behaving according to its contract; freezing the Overlay order would create a second source and would also hide legitimate project changes. The root repair is to make directory resolution idempotent for an existing unchanged project.

## Implementation plan

1. Derive the canonical worktree and sandbox set without mutating the stored project object.
2. Compare the derived persistent fields with the existing row.
3. For an unchanged existing project, return the stored timestamp and skip both database write and `project.updated`.
4. For a new project or a real worktree/sandbox-set change, persist once with a fresh `time_updated` and emit the existing canonical event.
5. Add focused Project tests for timestamp/event idempotence and structural-change publication.
6. Strengthen the real Work Ledger browser fixture to capture project order before selection, click another project, wait for the real project reload, assert unchanged order, and save the left-rail screenshot.
7. Run targeted tests, typechecks, Vite/browser verification, documentation health checks, visual review, diff review, commit with the required prefix, fetch, and push to `myhexin`.

## Validation plan

```text
bun test packages/opencorvus/test/project/project.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/project-folder-picker-work-ledger.test.ts
bun run --cwd packages/opencorvus typecheck
bun run --cwd packages/overlay typecheck
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

## Validation results

- `Project.fromDirectory` regression suite passed: 40 tests, 154 assertions. The new coverage proves an unchanged second resolution preserves the persisted timestamp and emits no `project.updated`; the existing realpath-equivalent structural rewrite now proves it still emits exactly one update.
- The Node-launched Vite browser fixture passed. It opened a second empty project, captured the two project directories in rendered order, clicked the older project, drove a real Work Ledger Server-Sent Events refresh and snapshot reload, and proved the order stayed byte-for-byte identical.
- The visually reviewed goal-region screenshot is `.scratch/work-ledger-project-selection-order-stability.png`. It shows `Picked Project` remaining first and the clicked `Initial Project` remaining second.
- OpenCorvus and Overlay TypeScript typechecks passed.
- Historical links and product-document single-source checks passed. Document health initially rejected the new record because its own contract requires monthly-index targets to be tracked; after staging only the task-owned record, all 63 document-health tests passed.
- `git diff --check` and staged-diff whitespace checks pass after final record normalization.

## Codex review feedback

- The initial diagnosis considered changing the list comparator, but full-path evidence showed the comparator was consuming a false activity timestamp. The implementation therefore repairs the canonical project write boundary and leaves the established single-source sort intact.
- The implementation builds a new sandbox array before comparison instead of mutating `existing.sandboxes`, so the changed/no-change decision is based on the persisted value.
- New project insertion and real worktree/sandbox-set changes retain the existing write and event path. Only an unchanged read returns early.
- The browser fixture also corrected its project `pinned` and task `executionStatus` values to the current strict transport contract, so the acceptance run exercises current schemas rather than stale fixture shapes.
