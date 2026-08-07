# Review Modified Preview Body Repair

Date: 2026-07-28
Status: Implemented and visually verified
Owner: Codex

## Glossary

- UI: User Interface, the visible application surface.
- VCS: Version Control System, Git in this repository.
- API: Application Programming Interface, the server contract consumed by the Overlay.
- DB: Database, the durable SQLite store used by OpenCorvus.

## Recall

### User requirement

The Review component lists a `Modified` Markdown file but renders
`No preview available for this file.` when that row is selected. The supplied
desktop screenshot shows one `Modified` file and thirteen `Added` files under
the same `#G3V1` change group.

### Acceptance criteria

1. A tracked file modified in a Goal-managed worktree after its latest commit
   is captured with exact `before` and `after` bodies in the immutable Build
   Host observation.
2. Review continues to resolve selected-file bodies only through the existing
   task-scoped `GET /goal-attempt/:goalAttemptID/diff` route and renders the
   real modified lines.
3. Added, deleted, committed, merge-contribution, filtering, row selection,
   keyboard activation, and split Review layout remain intact.
4. No live `/vcs/diff` read, frontend fallback, synthetic body, second diff
   source, or host workflow gate is introduced.
5. Focused backend and Overlay tests, type checks, the Node-launched Review
   browser fixture, a task-scoped screenshot, direct visual inspection, and a
   second source review pass complete before delivery.

### Hard constraints

- Preserve the `build_host_observation.diffs` artifact as the single durable
  full-body diff source.
- Compare the Goal contribution base directly with the terminal worktree so
  committed and dirty Goal-owned changes are captured in one observation.
- Preserve unrelated staged, unstaged, untracked, and concurrently written
  worktree changes. Do not reset, restore, stash, or create a worktree.
- Do not restart, refresh, close, or otherwise interfere with the user's
  running OpenCorvus or Overlay process.
- Start Playwright with Node, not Bun.
- Commit subjects use the required `dsw-33987` prefix and push to `legacy-remote`
  through the normal hooks.

### Sources read

- Root `AGENTS.md`.
- Browser control Skill.
- User screenshot
  `C:/Users/10132/AppData/Local/Temp/codex-clipboard-f553dee9-1681-4712-8cfe-f619226ea28f.png`.
- `specs/records/2026-07/2026-07-02-diff-preview-full-body-source.md`.
- `specs/records/2026-07/2026-07-18-review-codex-reference-parity.md`.
- `specs/records/2026-07/2026-07-21-review-split-diff-and-change-total-convergence.md`.
- `specs/current/architecture/07-panel.md`.
- `packages/opencorvus/src/build/agent.ts`.
- `packages/opencorvus/src/{engine/{persist,store},task-api/index}.ts`.
- `packages/opencorvus/src/server/routes/orchestrator.ts`.
- `packages/overlay/src/services/diff.ts`.
- `packages/overlay/src/components/{ChangesPanel,FileChangesView,DiffPreviewPanel,DiffView}.tsx`.
- `packages/overlay/src/utils/file-change-summary.ts`.
- Focused Build Host, diff service, Review unit, and Review browser tests.

### Whole-repository grep evidence

Repository-wide searches covered `No preview available`, `DiffPreviewPanel`,
`resolveDiff`, `fetchGoalAttemptDiffs`, `getGoalAttemptDiff`,
`findWorkspaceDiffsForGoalAttempt`, `build_host_observation`,
`recordBuildHostObservation`, `Snapshot.FileDiff`,
`collectGoalContributionDiffs`, `collectGoalDiffs`,
`collectAgentFileChangeGroups`, and `mergeChangeGroups`.

| Call point / contract | Evidence and disposition |
| --- | --- |
| `build/agent.ts::collectGoalContributionDiffs` | Root repair owner. Preserve contribution-base selection, but collect the terminal worktree rather than only `baseRef..HEAD`. |
| `build/agent.ts::collectGoalDiffs` | Replace the committed-ref-only status, statistics, and after-body reads with one base-to-worktree projection; include untracked Goal files without mutating the real index. |
| `engine/persist.ts::recordBuildHostObservation` | Preserve unchanged; it already persists exact typed full bodies once and rejects partial body payloads. |
| `engine/store.ts::findWorkspaceDiffsForGoalAttempt` | Preserve unchanged as the one durable read owner. |
| `task-api/index.ts::getGoalAttemptDiff` | Preserve unchanged as the task/project boundary. |
| `server/routes/orchestrator.ts::GET /goal-attempt/:goalAttemptID/diff` | Preserve unchanged as the only Review body route. |
| `overlay/services/diff.ts::resolveDiff` | Preserve the no-live-VCS contract and exact Goal-attempt cache. |
| `ChangesPanel` / `file-change-summary` | Preserve live Tool/Patch row merging. Those rows expose the mismatch but must not become a second preview-body source. |
| `FileChangesView` / `DiffPreviewPanel` / `DiffView` | Preserve the selected split-preview renderer; real bodies arriving through the canonical route are sufficient. |
| `test/build-agent/commit-diff-source.test.ts` | Add dirty tracked `Modified` and untracked `Added` full-body regressions while retaining committed, deleted, merge, and error coverage. |
| `test/diff-resolve-inflight-cache.test.ts` | Preserve the explicit assertion that Review never calls live `vcs/diff`. |
| `test/browser/file-changes-task-scope-browser.test.ts` | Preserve and execute the real `FileChangesView` fixture whose `Modified` row resolves task-scoped `before/after`, renders add/delete lines, and produces a screenshot. |
| `test/browser/toolbar-diff-navigation.test.ts` | Preserve the wider Review navigation regression. Its modified-body checker succeeds before a pre-existing split-pane minimum-width assertion currently fails at `375 < 400`; this unrelated shared-worktree layout failure is recorded rather than hidden. |

### Independent-agent feedback

None. The user did not request delegation, and the active collaboration
boundary forbids unrequested Subagents. The primary agent performs the required
second review.

### Evidence boundary

The live OpenCorvus sidecar reports a healthy `0.0.23-beta` process, but its
current formal DB contains no Task rows and the supplied commit is not present
in the available local repositories. Therefore the exact historical artifact
payload behind the screenshot cannot be inspected. The code-level cause is
proved independently: Review merges live Tool/Patch rows into its file list,
while the Build Host observation for a managed worktree currently reads only
`baseRef..HEAD`. A tracked dirty modified file can consequently appear in the
list without existing in the only full-body preview artifact. The screenshot's
one Modified versus thirteen Added rows is consistent with this path but is not
used as sole causal proof.

## Causal chain

1. **Observable symptom:** selecting the `Modified` row renders the generic
   no-preview state, while the same Goal group contains previewable added rows.
2. **Direct trigger:** `resolveDiff` correctly asks the Goal-attempt diff route,
   but the returned Build Host observation has no matching full-body row.
3. **Deep cause:** the Review inventory merges structured live Agent file
   evidence with durable Host diff rows, while the managed-worktree Host
   collector only diffs the contribution base against `HEAD`. Dirty tracked
   changes made after the last commit are visible to Agent evidence but absent
   from `build_host_observation.diffs`.
4. **Why earlier paths did not root-correct it:** the existing Build regression
   covers committed modified/deleted files, and the browser fixture serves a
   canned modified body from the route. Neither creates a modified tracked file
   after the terminal commit, so both sides of the split-source symptom appear
   complete in tests.

## Implementation plan

1. Add failing Build Host regressions for a dirty tracked modified file and an
   untracked added file after a committed Goal contribution.
2. Make `collectGoalDiffs` compare the selected contribution base with the
   terminal worktree, read exact after bodies from the worktree, and include
   untracked files through read-only Git inventory and diff statistics.
3. Execute the existing Node Review browser fixture that selects a real
   `Modified` row whose body comes from the Goal-attempt route, asserts the
   rendered modified content, and captures the task-scoped Review panel.
4. Run focused backend/Overlay tests, type and internationalization checks, the
   production Overlay build, and documentation health checks.
5. Inspect the rendered screenshot at original resolution, correct any visual
   or interaction regression, rerun affected checks, then perform a second
   exact-diff/call-site review.
6. Record final evidence, commit only task-owned changes, fetch/reconcile the
   current branch, push to `legacy-remote`, and confirm local/remote equality.

## Status

- [x] Screenshot, history, implementation, route, artifact, and test diagnosis.
- [x] Whole-repository call-site inventory and causal chain.
- [x] Failing regression and Build Host repair.
- [x] Real Review browser screenshot and visual correction loop.
- [x] Full validation and second review.

The final implementation commit and `legacy-remote` push are the delivery action and
are reported with their resulting Git identifiers.

## Implementation

`collectGoalDiffs` now projects the selected contribution base directly
against the terminal Goal worktree:

- tracked staged and unstaged changes are obtained from the same read-only
  `git diff <baseRef> -- .` inventory and statistics;
- untracked, non-ignored Goal files are obtained from read-only
  `git ls-files --others --exclude-standard`;
- exact `before` bodies still come from the contribution base, while exact
  `after` bodies come from the terminal worktree;
- internal OpenCorvus runtime paths remain excluded, and invalid, duplicate,
  escaping, or incomplete Git inventory remains a hard error.

No Review component, API route, DB schema, live VCS route, cache, or fallback
was added. Existing committed, deletion, merge-contribution, and strict Git
failure contracts continue through the same collector.

## Verification evidence

### Automated

- `bun test --timeout 20000 packages/opencorvus/test/build-agent/commit-diff-source.test.ts packages/opencorvus/test/engine/build-host-observation.test.ts packages/opencorvus/test/server/app-routes.test.ts`
  - 42 passed, 0 failed.
- `bun test --timeout 20000 packages/overlay/test/diff-resolve-inflight-cache.test.ts`
  - 4 passed, 0 failed; preserves the no-live-`/vcs/diff` body contract.
- `bun run --cwd packages/opencorvus typecheck`
  - passed.
- `bun run --cwd packages/overlay typecheck`
  - passed.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/file-changes-task-scope-browser.test.ts`
  - passed under the Node test runner.

### Visual

The Node-launched Playwright fixture captured
`packages/overlay/.scratch/file-changes-task-scope-resource-owner.png`.
Original-resolution inspection confirms that the selected `Modified` file
renders the old line as a deletion and the current line as an addition in the
left Review pane. The prior no-preview empty state is absent.

### Known unrelated shared-worktree failure

`toolbar-diff-navigation.test.ts` reached and passed its task-scoped modified
body route and rendered-add-line checks, then failed its split-pane layout
minimum with `diff pane width 375`. The expected minimum is 400 pixels. This
failure belongs to concurrent Review layout work already present in the shared
worktree; this repair does not edit or relax that assertion.

### Second review

The final call-site and exact-diff review found one producer change and one
producer regression only. Persistence, route, Overlay resolver, renderer, and
live Tool/Patch inventory remain unchanged. The repair therefore closes the
missing canonical body at its source without creating a second source or
workflow gate.
