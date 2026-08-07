# Work Ledger Open Project Immediate Projection

## Recall

| Item | Detail |
| --- | --- |
| User request | "打开新项目文件夹的时候左侧panel一定要立即出现该文件夹,而不是延迟出现。" |
| Goal | When a project folder is opened through the existing project directory lifecycle, the left Projects panel must show that folder immediately after the canonical project-open reload, even when the project has no Mission, Task, or Chat rows yet. |
| Acceptance criteria | `/work-ledger` returns an opened project row from `ProjectTable` for an empty newly opened project; Work Ledger SSE emits a change event for `project.updated`; the overlay Work Ledger uses that backend project row to seed an empty project group instead of waiting for a later chat/task/mission; visual browser evidence shows the empty opened project group in the left panel. |
| Hard constraints | No fallback, no compatibility branch, no local-only front-end guessed directory, no second project directory source, no polling/delay workaround, do not restart/refresh running OpenCorvus/overlay processes, preserve unrelated dirty `AGENTS.md`, use Node-run Playwright for visual verification. |
| Sources read | `AGENTS.md`; `specs/records/2026-07/2026-07-09-open-project-freeze-systemic-repair.md`; `specs/records/2026-07/2026-07-08-projects-panel-and-codex-composer-polish.md`; `specs/records/2026-07/2026-07-08-project-directory-new-chat-icon.md`; `specs/records/2026-07/README.md`; `packages/overlay/src/services/workspace.ts`; `packages/overlay/src/services/config.ts`; `packages/overlay/src/services/sse.ts`; `packages/overlay/src/services/work-ledger.ts`; `packages/overlay/src/components/WorkLedger.tsx`; `packages/overlay/src/components/ProjectLedgerGroup.tsx`; `packages/opencorvus/src/work-ledger/projection.ts`; `packages/opencorvus/src/server/routes/work-ledger.ts`; `packages/opencorvus/src/project/project.ts`; `packages/opencorvus/src/project/project.sql.ts`; `packages/opencorvus/test/server/work-ledger-routes.test.ts`; `packages/overlay/test/work-ledger-consolidation.test.ts`; `packages/overlay/test/browser/project-ledger-group-browser.test.ts`. |
| Whole-repository grep evidence | `rg -n "Projects\|ProjectDirectory\|project directory\|openProject\|open project\|openFolder\|Open Folder\|directory picker\|showDirectoryPicker\|recent\|work ledger\|WorkLedger\|projectActions\|project\\.open\|Project\\.open\|/project\|projectList\|project list" packages/overlay/src packages/overlay/test packages/opencorvus/src packages/opencorvus/test -S`; `rg -n "WorkLedger\|refreshWorkLedger\|setWorkLedger\|loadWorkLedger\|workLedger\|project directory\|project-group\|directory" packages/overlay/src/main.tsx packages/overlay/src/components/WorkLedger.tsx packages/overlay/src/components/ProjectLedgerGroup.tsx packages/overlay/src/services/work-ledger.ts -S`; `rg -n "global/projects\|projects/discover\|work-ledger\|workLedger\|ledger\|project/open\|project/current\|directory" packages/opencorvus/src/server packages/opencorvus/src/work-ledger packages/opencorvus/src/project packages/opencorvus/test/server -S`; `rg -n "WorkLedgerList\|WorkLedgerRow\|loadWorkLedger\|work-ledger" packages/overlay/src packages/overlay/test packages/opencorvus/src packages/opencorvus/test -S`; `rg -n "Project\\.Event\|project\\.updated\|Event\\.Updated\|ProjectTable\|project.updated" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test -S`. |
| Independent agent feedback | Not spawned: the fault boundary is narrow after reading the existing project-open and Projects-panel records, and the fix stays within the already identified Work Ledger projection owner plus focused browser/server tests. |

## Diagnosis

The Projects panel currently groups `WorkLedgerRow` values by `row.directory`. Those rows only come from Mission sessions, right-sidebar Coding Assistant sessions, and Engine tasks. A freshly opened project folder writes or updates `ProjectTable` through `Project.fromDirectory()`, but it has no ledger row until the user later creates a Chat, Mission, or Task. That is why the folder appears late.

The backend already has the correct authoritative project-open source: `Project.fromDirectory()` upserts `ProjectTable` and emits `project.updated`. The Work Ledger projection and change stream must consume that source directly. Adding a front-end local insert from `settingsStore.directory` would create a second directory source and would hide backend projection bugs.

## Design

1. Add a `project` row to the Work Ledger discriminated union. It carries `id`, `title`, `directory`, `created`, and `updated` from `ProjectTable`.
2. Extend the SQL `top_rows` union to include `ProjectTable` rows, filtered by the existing `directory` and `search` query arguments.
3. In the overlay Work Ledger, use `project` rows to seed directory groups and carry the project display name, but do not render them as child work rows. The visible group count remains the number of Mission/Task/Chat rows.
4. Extend `/work-ledger/events` to emit `work-ledger.changed` for `project.updated`, so a project-open event refreshes the Projects panel through the same Work Ledger SSE path.
5. Add focused backend, source, and browser tests proving empty opened projects appear immediately and project updates trigger the ledger stream.

## Verification Plan

```powershell
bun test packages/opencorvus/test/server/work-ledger-routes.test.ts packages/overlay/test/work-ledger-consolidation.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/project-ledger-group-browser.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/opencorvus typecheck
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
git diff --check
```

The browser run must produce a screenshot showing the left Projects panel with an opened empty project folder group and no child work rows.

## Verification Results

| Check | Result |
| --- | --- |
| `bun test packages/opencorvus/test/server/work-ledger-routes.test.ts packages/overlay/test/work-ledger-consolidation.test.ts --timeout 90000` | PASS: 10 tests. |
| `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/project-ledger-group-browser.test.ts` | PASS after tightening the wrapper-specific `waitForFunction` usage. Generated `.scratch/work-ledger-empty-opened-project.png`. |
| Visual review | PASS: screenshot shows `Empty Opened Project` in the left Projects panel with count `0` and no child work rows. |
| `bun run --cwd packages/overlay typecheck` | PASS. |
| `bun run --cwd packages/opencorvus typecheck` | PASS. |
| `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 60000` | PASS: 20 tests. |
| `git diff --check` | PASS. |

## Second Review

- The backend projection uses `ProjectTable` and `project.updated`, the existing authoritative project-open source. No front-end local directory insertion, delayed refresh, polling, fallback, or compatibility path was added.
- `project` rows are excluded from selectable Work Ledger item rendering. They only seed `ProjectLedgerGroup` with directory and project name, so no pseudo Task, Mission, or Chat row is created.
- Empty opened projects remain actionable through the existing project-row new-chat control, with visible count `0`.
