# Diff Preview Full Body Source

Date: 2026-07-02

## Problem

The overlay changes panel can show real file change stats while the inline diff
panel says there is no change or that a new file body has not arrived. This is
not a rendering-only bug. The build path collects full `before` and `after`
file bodies, but the acceptance read model intentionally strips those bodies to
bounded summaries. The frontend then passes those summary-only rows into the
diff renderer, so `undefined === undefined` is treated as unchanged and added
files without bodies are shown as pending server content.

## Recall

### User Request

The user reported two visible failures:

- modified files with nonzero additions/deletions render "No changes between
  before and after";
- added files render "New file -- server hasn't sent its contents yet".

The follow-up instruction was to fix the issue after independent-agent review.

### Acceptance Criteria

1. Added and modified file rows with real build diffs render actual file
   content in the overlay inline diff panel.
2. Summary-only acceptance rows are not rendered as if they were complete diff
   bodies.
3. Acceptance result payloads remain bounded summaries and do not persist full
   file bodies in `result.diffs`.
4. Full body diff preview has one canonical source for task and goal-run
   surfaces: the `workspace-diff` artifact.
5. The frontend does not call `/vcs/diff` or synthesize a body from summary
   stats.
6. Regression coverage proves the backend stores bounded acceptance summaries
   while exposing full preview bodies through the dedicated route, and frontend
   coverage proves body resolution uses that route.
7. A real browser screenshot of the diff panel is inspected before delivery.

### Hard Constraints

- No fallback path, compatibility path, double source, or gate mechanism is
  allowed.
- Do not resurrect the superseded `/vcs/diff` preview plan.
- Do not revert existing user changes.
- Do not create a new worktree.
- Do not restart, kill, refresh, or otherwise disturb running OpenCorvus or
  overlay processes without explicit user approval.
- Preserve the existing acceptance summary memory repair.

### Sources Read

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-06/2026-06-05-diff-preview-vcs-fallback-plan.md`
- `specs/records/2026-06/2026-06-10-acceptance-diff-summary-memory-fix.md`
- `packages/opencorvus/src/build/agent.ts`
- `packages/opencorvus/src/engine/model.ts`
- `packages/opencorvus/src/engine/persist.ts`
- `packages/opencorvus/src/engine/store.ts`
- `packages/opencorvus/src/task-api/index.ts`
- `packages/opencorvus/src/server/routes/orchestrator.ts`
- `packages/overlay/src/services/diff.ts`
- `packages/overlay/src/components/DiffView.tsx`
- `packages/overlay/src/components/FileChangesView.tsx`

### Whole-Repository Search Evidence

- `rg -n "workspace-diff|finalizeBuildAttempt|AcceptanceDiffSummary|goal-run/.*/acceptance|run/.*/acceptance|resolveDiff|DiffView|InlineDiffPanel" packages specs -g "*.ts" -g "*.tsx" -g "*.md"`
  found acceptance summary persistence, the goal-run finalize writer, the
  existing acceptance routes, overlay diff resolution, and the inline panel that
  falls back to a summary-only row.
- `rg -n "/vcs/diff|vcs.diff|resolveDiff" packages specs -g "*.ts" -g "*.tsx" -g "*.md"`
  found the retired preview fallback plan and current frontend guard tests that
  must continue rejecting live version-control preview fallback.
- `rg -n "workspace-diff|kind: \"diff\"|label: \"workspace-diff\"" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`
  found task-level acceptance artifact writes and the absence of a goal-run
  full body diff artifact.

### Independent Agent Feedback

- Backend review: the build pipeline already has full `Snapshot.FileDiff`
  bodies, but `summarizeAcceptanceDiffs()` and `viewAcceptance()` intentionally
  strip unknown fields. The fix needs a typed, explicit full-body read source
  instead of stuffing bodies back into acceptance results.
- Frontend review: `FileChangesView` uses `change() || props.row.item`, so a
  failed body lookup still renders the summary stub. `DiffView` also treats
  missing `before` and missing `after` as equal content.
- Documentation and tests review: the June memory repair is an active
  constraint. The June `/vcs/diff` fallback plan is superseded and must not be
  revived.

## Decision

Acceptance result diffs stay as bounded summaries:

```text
Acceptance.result.diffs[] = file + status + additions + deletions
```

The full preview body source is a sibling `engine_artifact` row:

```text
kind = "diff"
label = "workspace-diff"
payload.diffs[] = Snapshot.FileDiff
acceptance_id = owning acceptance artifact id
```

Task and goal-run API routes expose only that artifact payload for preview.
When the artifact is absent, the frontend reports no preview body; it does not
use acceptance summaries as bodies and does not query version-control fallback
routes.

## Implementation Plan

1. Keep `AcceptanceDiffSummary` unchanged.
2. Persist full `workspace-diff` artifacts for task-level and goal-run
   acceptance while keeping acceptance and changed-file artifacts summary-only.
3. Add task API and route methods for task and goal-run workspace diffs.
4. Point overlay diff resolution at the new workspace-diff routes.
5. Stop the inline diff panel from rendering summary-only rows as diff bodies.
6. Tighten `DiffView` empty-state checks so missing bodies are not classified as
   unchanged file content.
7. Add backend, frontend, route, and browser screenshot regression coverage.

## Validation Plan

- `bun test packages/opencorvus/test/engine/start-new-attempt.test.ts`
- `bun test packages/opencorvus/test/server/app-routes.test.ts`
- `bun test packages/opencorvus/test/server/runtime-isolation-routes.test.ts`
- `bun test packages/overlay/test/diff-resolve-inflight-cache.test.ts`
- node-based browser test for the toolbar diff navigation screenshot
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`
