# Conversation Artifact File Summary

Status: Superseded by `2026-07-28-conversation-terminal-artifact-overview-repair.md`
Date: 2026-07-27
Owner: Codex

The implementation recorded here incorrectly treated file diffs as the whole
Artifact inventory. The superseding repair enumerates the canonical current
Task Artifact Catalog and retains file changes as a separate section.

## Recall

### User request

Display one Codex-style file-change window at the end of both Chat and Mission
conversations. The window must summarize the file changes collected by
Artifacts, show an `Artifacts` identity, per-file additions and deletions, and
keep the full review surface available.

The supplied desktop reference establishes the required information
architecture: one restrained bordered card, total changed files and aggregate
line counts in the header, a short file list, an explicit remaining-file
disclosure, and a Review action.

### Acceptance criteria

1. Chat and Mission conversations with persisted file-change evidence render
   exactly one Artifact summary after the final conversation item.
2. Mission rows derive from canonical `build_host_observation.diffs`; Chat rows
   derive from the canonical persisted `SessionSummary` diff.
3. The summary reports the unique file count and aggregate additions and
   deletions, shows the first three rows by default, and exposes all remaining
   rows through an accessible disclosure.
4. Review and file-row actions reuse the existing Files workbench and diff
   resolution path.
5. Empty conversations and conversations without changed files render no
   summary card.
6. The card remains visually aligned with the desktop conversation column and
   is verified in a real Vite browser page with screenshots.
7. Focus, keyboard activation, localization, targeted tests, typecheck, and
   document-health checks pass.

### Hard constraints

- Preserve all existing dirty-worktree changes.
- Do not restart, refresh, close, or otherwise touch the user's running
  OpenCorvus/overlay process.
- Do not derive the summary from a fresh workspace scan, local signal, query
  override, or a second Git-diff implementation.
- Keep the existing Files workbench as the full review owner.
- Use the existing UI primitives and desktop-only acceptance scope.

### Sources read

- `AGENTS.md`
- `specs/records/2026-07/2026-07-26-unified-task-artifact-catalog-protocol.md`
- `specs/records/2026-07/2026-07-27-projected-worker-task-artifact-publication.md`
- `packages/opencorvus/src/engine/persist.ts`
- `packages/opencorvus/src/engine/model.ts`
- `packages/opencorvus/src/session/summary.ts`
- `packages/opencorvus/src/server/routes/session.ts`
- `packages/overlay/src/components/Conversation.tsx`
- `packages/overlay/src/components/ChangesPanel.tsx`
- `packages/overlay/src/components/FileChangesView.tsx`
- `packages/overlay/src/services/diff.ts`
- `packages/overlay/src/utils/file-change-summary.ts`
- `packages/overlay/src/styles/surfaces/conversation.css`
- the supplied Codex file-summary screenshot

### Full-repository grep result

The repository-wide search covered `artifact`, `build_host_observation`,
`SessionSummary.diff`, `patch`, `changedFileDiffs`, `currentChangeGroups`,
`collectAgentFileChangeGroupsFromNodes`, `FileChangesView`, `Conversation`, and
all route definitions containing Artifact or diff.

| Call-point family              | Current owner                                                                  | Disposition                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Mission persisted file changes | `recordBuildHostObservation` and Goal evidence in the task board               | Preserve as the canonical Mission source.                                                              |
| Chat persisted file changes    | `SessionSummary.publishDiff/readDiff` and `GET /session/:sessionID/diff`       | Project the persisted diff into session conversation hydration; do not rescan Git.                     |
| Live transcript mutations      | structured tool metadata and patch parts collected by `file-change-summary.ts` | Preserve as the live projection and merge with persisted evidence through the existing merge function. |
| Full review surface            | `ChangesPanel`, `FileChangesView`, `resolveDiff`, and the Files workbench      | Reuse; the new card only opens/focuses this existing owner.                                            |
| Conversation rendering         | `Conversation.tsx` virtualized top-level timeline                              | Add one terminal summary item outside individual message cards.                                        |
| File rows and counts           | `FileChange`, `ChangeGroup`, `summarizeChangeGroups`                           | Reuse the canonical normalized shapes and aggregate helper.                                            |

## Implementation plan

1. Include the persisted session diff in the standalone Chat conversation board
   response and cover the route contract.
2. Extract one shared current-conversation change-group projection so both the
   Files workbench and terminal Artifact card consume the same merged groups.
3. Build the compact Artifact summary with existing buttons/icons, accessible
   row controls, a three-row disclosure, and the existing diff/review actions.
4. Mount the card after the virtualized conversation timeline, add localized
   copy and conversation-owned styling, and update focused tests.
5. Run targeted tests, typecheck, document health, an independent source review,
   and real Vite/browser screenshot acceptance. Iterate on visual findings.

## Verification log

- `bun test packages/overlay/test/conversation-artifact-summary.test.ts packages/overlay/test/agent-file-changes.test.ts`
  - 9 passed, 0 failed.
- `bun test packages/opencorvus/test/server/session-conversation-routes.test.ts`
  - 15 passed, 0 failed.
- `bun run --cwd packages/overlay typecheck`
  - passed.
- `bun run --cwd packages/opencorvus typecheck`
  - passed.
- `bun run api:routes-check`
  - passed; 6 rules and 32-file route inventory clean.
- `bun run --cwd packages/overlay check:i18n`
  - passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  - 22 passed, 0 failed.
- `git diff --check`
  - passed.

### Real Vite/browser acceptance

An isolated Vite fixture was started with Node on port 4187. The current
OpenCorvus/overlay process was not touched.

The real rendered page was inspected in the in-app browser at a 900 × 500
desktop viewport:

- the terminal card measured 804 px wide;
- the collapsed card showed 3 of 6 files and the canonical aggregate
  `+116 -7`;
- the header, file rows, trailing statistics, Review action, and disclosure
  matched the supplied reference's hierarchy and density;
- expanding the disclosure produced 6 visible rows and
  `aria-expanded="true"`;
- Review changed the fixture's observable result from `Review closed` to
  `Review opened`, proving that the card calls the existing Files workbench
  event;
- long paths remained single-line and ellipsized instead of widening the
  conversation.

### Secondary review

The final diff was reread against the single-source constraints. Chat hydration
reads only the persisted `SessionSummary` diff. Mission continues to read only
the board-projected `build_host_observation` diffs. Live structured Tool/patch
facts are merged by the existing `ChangeGroup` owner, and the terminal card
contains no Git invocation, workspace scan, preview iframe, local query
override, or second diff reader.
