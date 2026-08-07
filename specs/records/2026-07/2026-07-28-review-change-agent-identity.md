# Review Change Agent Identity

Date: 2026-07-28
Status: Complete
Owner: Codex

## Glossary

- UI: User Interface, the visible application surface.
- DOM: Document Object Model, the rendered browser element tree.
- DAG: Directed Acyclic Graph, the persisted agent-invocation relationship graph.

## Recall

### User requirement

- Replace the `#G1V1` label in Review with the identity of the agent whose
  change is being shown.

### Acceptance criteria

1. Review change-group headers and grouped row scope labels display the exact
   modifying `agentID`, not the Goal revision label.
2. Persisted Goal-attempt diffs resolve the modifier through the existing
   `buildSessionID -> agentInvocationDAG.nodes[].agent` relationship.
3. Live Tool and Patch changes retain the exact `CardNode.agentID` that emitted
   each change, including separate groups when different agents modify the same
   Goal.
4. Goal revision, Goal title, commit, diff target, counts, filtering,
   virtualization, row selection, and split diff preview behavior remain
   available and unchanged except for the primary visible group identity.
5. Focused unit tests, the real Node-launched Review browser fixture, and a
   task-scoped desktop screenshot prove the final behavior.

### Hard constraints

- Reuse the existing Board `agentInvocationDAG` and Card Tree `agentID` facts;
  do not add a second backend identity field, infer identity from titles, or
  introduce fallback/compatibility labels.
- Keep Goal attempt identity as the diff-loading scope and agent identity as
  the visible modification owner.
- Use the existing Review/FileChangesView and Listbox primitives.
- Do not restart, refresh, close, or otherwise interfere with the user's
  running OpenCorvus or Overlay processes; visual verification uses an
  isolated browser fixture.
- Start Playwright with Node, not Bun.
- Preserve unrelated staged, unstaged, and untracked worktree changes. Do not
  reset, restore, stash, or create another worktree.
- Commit subjects use the required `dsw-33987` prefix and the completed change
  is pushed to `myhexin`.

### Sources read

- Root `AGENTS.md`.
- Browser control Skill.
- User screenshot
  `C:/Users/10132/AppData/Local/Temp/codex-clipboard-cdaee5c0-70d0-4555-b1b3-418355d6d2ab.png`.
- `specs/current/architecture/07-panel.md`.
- `specs/current/architecture/12-overlay-card-system.md`.
- `specs/records/2026-07/2026-07-10-dynamic-expert-squad-agent-identity.md`.
- `specs/records/2026-07/2026-07-27-goal-retry-projection-and-running-icon.md`.
- `packages/overlay/src/components/{ChangesPanel,FileChangesPanel,FileChangesView}.tsx`.
- `packages/overlay/src/services/diff.ts`.
- `packages/overlay/src/utils/{file-change-summary,goal-label}.ts`.
- `packages/overlay/src/store/card-tree.ts`.
- `packages/opencorvus/src/workbench/board.ts`.
- `packages/opencorvus/src/engine/model.ts`.
- `packages/opencorvus/src/orchestrator/task-event.ts`.
- Focused unit and Node-browser Review tests.

### Whole-repository grep evidence

Repository-wide searches covered `#G1V1`, `goalRevisionLabel`,
`goalCompactLabel`, `ChangeGroup`, `currentChangeGroups`,
`collectAgentFileChanges`, `collectAgentFileChangeGroups`,
`mergeChangeGroups`, `groupLabel`, `changes-group-header`,
`buildSessionID`, `agentInvocationDAG`, `WorkerTurnDescriptor`, and
`agentID`.

| Call point / contract                                                                      | Evidence and disposition                                                                                                                                    |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/diff.ts::ChangeGroup`                                                            | Add exact optional `agentID`; Goal metadata remains separate.                                                                                               |
| `services/diff.ts::DiffTarget`                                                             | Carry exact `agentID` into the diff preview while retaining `goalAttemptID` as the loading scope; remove the presentation-only Goal label from this target. |
| `services/diff.ts::goalChangeGroups/currentChangeGroups`                                   | Resolve persisted change ownership by exact build session against the already-present Board DAG; never derive it from Goal labels or session titles.        |
| `services/diff.ts::changeGroupsRevisionKey`                                                | Include `agentID` so identity changes invalidate the Review projection.                                                                                     |
| `utils/file-change-summary.ts::collectFromNode`                                            | Stamp each structured Tool/Patch change with the exact owning card `agentID`; reject change-producing agent cards that lack identity.                       |
| `utils/file-change-summary.ts::mergeFileChange`                                            | Include `agentID` in the merge key so two agents touching one path do not collapse into one anonymous row.                                                  |
| `utils/file-change-summary.ts::collectAgentFileChangeGroupsFromNodes`                      | Group by Goal plus agent, retain Goal-attempt metadata, and expose the agent on `ChangeGroup`.                                                              |
| `utils/file-change-summary.ts::groupMergeKey`                                              | Merge live and persisted evidence only when both Goal scope and exact agent owner match.                                                                    |
| `components/FileChangesView.tsx::groupLabel/groupTitle`                                    | Make exact `agentID` primary while retaining Goal revision/title as secondary title metadata.                                                               |
| `components/DiffPreviewPanel.tsx`                                                          | Render the same exact agent identity beside the selected path so Review has no remaining visible Goal-revision owner label.                                 |
| `components/ChangesPanel.tsx`                                                              | Preserve the one live-plus-persisted merge and diff-opening flow.                                                                                           |
| `components/ConversationArtifactSummary.tsx`                                               | Preserve its shared ChangeGroup merge/flatten path; visible Review ownership changes do not add another artifact source.                                    |
| `components/TaskDirBar.tsx`                                                                | Preserve shared change totals; `agentID` only participates in the revision key.                                                                             |
| `utils/goal-label.ts`, `GoalGroup.tsx`, `TaskProgressBar.tsx`, `ConversationGoalBadge.tsx` | Preserve Goal identifiers outside Review; the user requested only Review modification ownership.                                                            |
| `test/agent-file-changes.test.ts`                                                          | Add exact-owner propagation, same-Goal multi-agent separation, persisted/live merge, and FileChangesView source assertions.                                 |
| `test/diff-change-groups.test.ts`                                                          | Prove `agentID` participates in the Review revision key.                                                                                                    |
| `test/browser/file-changes-task-scope-browser.test.ts`                                     | Use a real Goal diff plus Board DAG fixture, assert visible agent identity/absent `#G1V1`, and capture the task-scoped Review screenshot.                   |
| other Review, diff, file-row, filtering, virtualization, task-scope, and empty-Dock tests  | Preserve unchanged unless their fixtures must supply exact agent ownership.                                                                                 |

### Independent-agent feedback

None. The user did not request delegation, and the active collaboration
boundary forbids unrequested Subagents. The primary agent performs the required
second review after implementation and visual verification.

## Root cause

`FileChangesView.groupLabel` explicitly selects `goalLabel` before every other
group fact, so a Goal-scoped change renders as `#G1V1`. This is not an absent
identity problem: the same task Board already projects an exact persisted
agent-invocation DAG whose node is keyed by `buildSessionID`, and live Card
Tree nodes already carry exact `agentID`. The current file-change projection
drops both identities before presentation.

The root correction is to preserve exact ownership while building
`ChangeGroup`, then make that ownership the Review label. Goal revision remains
diff metadata rather than masquerading as the modifier.

## Implementation plan

1. Extend the shared ChangeGroup and live file-change projection with exact
   agent ownership from their existing sources.
2. Keep agent identity in merge/group keys so ownership is not overwritten
   when multiple agents or live/persisted evidence are combined.
3. Render `agentID` as the primary Review group label and preserve Goal
   revision/title in the hover title.
4. Add focused unit/source regressions and a real Review browser fixture that
   proves the visible label and screenshot.
5. Update current panel architecture and both required spec indexes.
6. Run focused tests, Overlay typecheck/build, documentation health, and the
   Node browser fixture; inspect the screenshot, perform a second diff review,
   commit task-owned changes, fetch/reconcile, and push to `myhexin`.

## Status

- [x] Baseline screenshot diagnosis, source/architecture read, and whole-repository search.
- [x] Change ownership projection and Review rendering.
- [x] Focused tests and real browser screenshot review.
- [x] Second review, commit, and push.

## Verification evidence

- `bun test packages/overlay/test/agent-file-changes.test.ts packages/overlay/test/diff-change-groups.test.ts`
  passes the exact-owner propagation, same-Goal multi-agent separation, merge,
  persisted session-DAG join, missing-identity rejection, and presentation
  regressions.
- `bun run --cwd packages/overlay typecheck` passes.
- `bun run --cwd packages/overlay check:i18n` passes with hash
  `6aa073ad759b98c7`.
- `bun run --cwd packages/overlay build` completes the production Vite build.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/file-changes-task-scope-browser.test.ts`
  passes using Node-launched Chromium. The task-scoped screenshot at
  `packages/overlay/.scratch/file-changes-task-scope-resource-owner.png` was
  inspected after the fixture loaded the same workspace surface stylesheet as
  production: both the group header and selected diff preview show
  `repair-engineer`, and no visible `#G1V1` remains.
- The combined documentation run passed 91 of 93 checks. The two failures are
  concurrent-workspace facts outside this task: the monthly README currently
  links eight other untracked July records, and a scratch scan raced another
  process deleting `.scratch/workspace-radius-index.patch`. This record itself
  passes historical link resolution. A focused rerun of
  `historical-docs-links.test.ts` passed 22 of 22 after that transient scratch
  race; task staging cannot claim or mutate the remaining unrelated files.
- Commit `0c03b397be` was pushed to the git-cc `myhexin` work branch. The
  pre-push hook passed repository SDK import checks, AI runtime checks, all
  scoped typechecks, API route inventory, generated API documentation,
  Overlay i18n, and the tracked-source secret scan.
