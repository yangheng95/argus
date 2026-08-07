# Conversation Terminal Artifact Overview Repair

Status: Complete
Date: 2026-07-28
Owner: Codex

## Recall

### User request

The requested conversation-end Artifacts overview is not visible. Repair the
delivery so the end of a completed Work or Mission conversation presents the
actual Task Artifact inventory, rather than treating file diffs as the entire
Artifact model.

### Acceptance criteria

1. A terminal Task conversation enumerates the canonical current Task Artifact
   Catalog and renders one overview after the final conversation item.
2. Reports, screenshots, documents, structured Engine Artifacts, and Task
   Artifact snapshots remain visible even when the Task changed no source
   files.
3. File changes remain visible in the same overview as a distinct file-change
   section and continue to open the existing Files review surface.
4. Active Tasks do not show a premature terminal overview. Standalone Chat
   keeps its persisted session-diff summary because it has no Task Artifact
   Catalog authority.
5. Catalog provider errors are visible; the UI must not turn an incomplete
   catalog into an empty successful summary.
6. Catalog pagination is consumed to completion from the Task-owned server
   route. The Overlay performs no workspace scan and creates no second Artifact
   index.
7. Route, SDK, Overlay, localization, focused regression, typecheck, document
   health, and real isolated Vite/browser visual checks pass.

### Hard constraints

- Preserve every concurrent dirty-worktree change and stage only files or
  hunks owned by this repair.
- Do not restart, refresh, close, or otherwise interfere with the user's
  running OpenCorvus or Overlay process.
- Do not create a compatibility path, fallback inventory, local signal,
  synthetic message, query override, or Host scheduling gate.
- Use the Task Artifact Catalog as the sole durable Artifact inventory and the
  existing Files workbench as the sole full diff-review owner.
- Use Node, not Bun, for Playwright-backed browser execution.

### Sources read

- `AGENTS.md`
- `specs/records/2026-07/2026-07-27-conversation-artifact-file-summary.md`
- `specs/records/2026-07/2026-07-26-unified-task-artifact-catalog-protocol.md`
- `packages/opencorvus/src/artifact-catalog/index.ts`
- `packages/opencorvus/src/task-api/index.ts`
- `packages/opencorvus/src/server/routes/orchestrator.ts`
- `packages/opencorvus/src/engine/model.ts`
- `packages/plugin/src/artifact-catalog.ts`
- `packages/overlay/src/components/Conversation.tsx`
- `packages/overlay/src/components/ConversationArtifactSummary.tsx`
- `packages/overlay/src/services/conversation.ts`
- `packages/overlay/src/services/diff.ts`
- `packages/overlay/src/store/board.ts`
- `packages/overlay/src/utils/file-change-summary.ts`
- `packages/overlay/src/styles/surfaces/conversation.css`

### Full-repository grep result

Repository-wide searches covered `ConversationArtifactSummary`,
`SessionSummary.diff`, `build_host_observation`, `currentChangeGroups`,
`artifact_search`, `searchTaskArtifacts`, `ArtifactCatalogEntry`,
`query_task_artifacts`, every Task route, and every Overlay Artifact component.

| Call-point family                       | Current owner                                                             | Disposition                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Terminal conversation mount             | `Conversation.tsx`                                                        | Preserve the single post-timeline mount.                                                                      |
| Existing summary                        | `ConversationArtifactSummary.tsx`                                         | Replace the file-diff-only identity with a combined catalog and file-change projection.                       |
| Mission/Work durable Artifact inventory | `artifact-catalog/index.ts` through `EngineService.searchArtifactCatalog` | Reuse directly through one read-only Task route; consume all cursor pages.                                    |
| Standalone Chat persisted edits         | `SessionSummary.diff` in `GET /session/:sessionID/conversation`           | Preserve because a standalone Session has no Task catalog authority.                                          |
| Task file changes                       | `build_host_observation.diffs` projected by `currentChangeGroups`         | Preserve as a distinct section, not as the Artifact inventory.                                                |
| Message-owned interactive Artifacts     | `interactive-artifact/**` and `CardParts.tsx`                             | Keep inline with their producing messages; do not duplicate their payload bodies into the terminal inventory. |
| Full file review                        | `ChangesPanel`, `FileChangesView`, and `acceptance:focus-changes`         | Preserve as the only full diff-review path.                                                                   |
| Agent Artifact discovery tools          | `artifact_search`, `artifact_read`, `artifact_select`                     | Preserve unchanged; the new endpoint is operator UI projection, not a second model transport.                 |

### Independent agent feedback

No independent Agent was requested for this repair. The root cause is directly
proved by the existing component: it imports only diff services and never calls
the Task Artifact Catalog.

## Root cause

The prior implementation equated “Artifacts” with changed source files. Its
`rows()` value is derived exclusively from `SessionSummary.diff`,
`build_host_observation.diffs`, and live patch metadata. Therefore a Task can
publish many real Engine Artifacts or Task Artifact snapshots and still render
no terminal summary whenever no file diff exists. The fixture only injected
file changes, so it verified the mistaken model instead of the requested
Artifact inventory.

## Implementation plan

1. Add a read-only Task Artifact overview route that delegates directly to
   `EngineService.searchArtifactCatalog` with current-version, newest-first,
   cursor-bounded enumeration.
2. Add an Overlay catalog reader that follows every returned cursor, preserves
   provider errors, rejects cursor cycles, and returns canonical catalog
   entries without rescanning the workspace.
3. Refactor the terminal component to show catalog entries and file changes as
   separate sections, only after Task terminality; keep the standalone Session
   diff behavior.
4. Extend localization, styles, focused unit/route/browser fixtures, and SDK
   generation.
5. Run focused tests and typechecks, then inspect the real isolated Vite
   rendering and interaction in the browser. Update this record with exact
   evidence before delivery.

## Verification log

- `bun test packages/opencorvus/test/server/task-artifact-overview-route.test.ts packages/overlay/test/conversation-artifact-overview-service.test.ts packages/overlay/test/conversation-artifact-summary.test.ts packages/overlay/test/agent-file-changes.test.ts`
  - 14 passed, 0 failed.
- `bun run --cwd packages/overlay typecheck`
  - passed.
- `bun run --cwd packages/opencorvus typecheck`
  - passed.
- `bun run --cwd packages/sdk/js typecheck`
  - passed.
- `bun run --cwd packages/overlay check:i18n`
  - passed.
- `bun run api:routes-check`
  - passed; 6 rules and the 33-file route inventory were clean.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  - 22 passed, 0 failed.
- `git diff --check`
  - passed.

### Real Vite/browser acceptance

An isolated Vite fixture was started with Node on port 4187. The user's running
OpenCorvus and Overlay processes were not touched.

The final current-goal Artifact card was personally inspected at a 900 × 700
desktop viewport:

- the card measured 804 px wide;
- a terminal Task with 5 canonical catalog Artifacts and 6 changed files
  rendered one post-conversation overview;
- the collapsed view showed 3 produced Artifacts and 3 files, with an explicit
  `Show 5 more items` disclosure;
- expanding showed all 5 produced Artifacts and all 6 files with
  `aria-expanded="true"`;
- the Artifact-only rows included a Markdown report, a visual-review snapshot,
  and a fact-check result independently of file diffs;
- `Review` changed the observable fixture result from `Review closed` to
  `Review opened`, proving reuse of the existing Files workbench event;
- the screenshot review caught and repaired `1 resources` and visible `-0`
  noise before the final rerender;
- the final console error/warning collection was empty.
