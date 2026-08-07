# Anonymous Project Mission Classification Repair

## Recall

### User requirement

- A Mission created from an anonymous Chat must automatically remain in the same anonymous-project classification.

### Acceptance criteria

- The Mission session persists the same database `project_id` and directory as the anonymous Chat/project that owns the wake request.
- The left Work Ledger renders one anonymous project group beneath `Chats`; that group contains its Chat, Mission, and Mission-owned Task rows.
- The same anonymous Mission or Task is not duplicated beneath `Projects` or the flat one-list projection.
- Named projects retain their existing Task, Chat, and Mission grouping.
- Focused unit/integration tests, a real Node-launched Playwright run, inspected desktop screenshot evidence, and a second diff review pass succeed.

### Hard constraints

- `project_id` is the database storage namespace, not a claim that one directory can contain only one user-visible project, Mission, or Task.
- Preserve the backend project identity already selected by the request-scoped `Instance`; do not add an active-project shadow field, directory alias, fallback, gate, or compatibility branch.
- Anonymous classification has one UI owner. Do not project the same anonymous project into both `Chats` and `Projects`.
- Preserve unrelated untracked files in the shared main worktree.
- Do not restart, refresh, close, or otherwise interfere with a running OpenCorvus/overlay process.
- Launch Playwright with Node, not Bun.
- Commit subjects use the `dsw-33987` prefix and push through normal hooks to the git-cc remote.

### Sources read

- `AGENTS.md`
- `packages/opencorvus/test/AGENTS.md`
- `specs/records/2026-07/2026-07-25-anonymous-project-chats-promotion-and-attachments.md`
- `specs/records/2026-07/2026-07-25-composer-chat-mission-manual-switch-restoration.md`
- `packages/opencorvus/src/server/routes/mission.ts`
- `packages/opencorvus/src/mission/session.ts`
- `packages/opencorvus/src/session/index.ts`
- `packages/opencorvus/src/work-ledger/projection.ts`
- `packages/overlay/src/services/{api-state,mission}.ts`
- `packages/overlay/src/components/WorkLedger.tsx`
- `packages/opencorvus/test/mission/wake-route.test.ts`
- `packages/overlay/test/work-ledger-consolidation.test.ts`
- `packages/overlay/test/browser/global-new-chat-provider-error-browser.test.ts`

### Whole-repository search and call-site decisions

| Owner / call site | Evidence | Decision |
| --- | --- | --- |
| `wakeMission()` | Sends the explicit active directory on `POST /mission/wake`. | Keep; it is the single client ownership input. |
| Server project-directory middleware | Creates the request-scoped `Instance` from that directory. | Keep; no alternate project lookup is needed. |
| `ensureMissionSession()` / `Session.createNext()` | Keys the Mission by current `Instance.project.id` plus directory and persists that exact `project_id`. | Keep and add an anonymous-project regression assertion. |
| `listWorkLedger()` | Projects Mission, Chat, Task, and Project rows with their authoritative directories. | Keep; backend rows already carry one shared ownership directory. |
| `renderGroups()` | Builds one `WorkLedgerGroup` per directory. | Keep as the sole client grouping source. |
| `implicitChatGroups` | Copies an anonymous group but filters it to `row.kind === "chat"`. | Replace with an anonymous-project group containing every item kind. |
| `projectGroups` | Keeps anonymous non-Chat rows under `Projects`. | Remove anonymous groups entirely from this projection. |
| flat `oneListItems` | Excludes only anonymous Chat rows. | Exclude every anonymous-project row so the same project is not duplicated. |
| `WorkLedgerProjectGroupView` | Already renders Mission children, Task, and Chat rows under one project primitive. | Reuse unchanged for the anonymous group. |
| Work Ledger source-structure tests | Encode the Chat-only split. | Replace with assertions for one complete anonymous-project projection. |
| Anonymous-project browser fixture | Verifies the anonymous Chat group but supplies no Mission/Task in that group. | Add Mission and child Task rows, verify their DOM ownership and absence from `Projects`, and capture the repaired Dock. |
| Named-project browser fixture | Verifies unified named-project grouping. | Keep; rerun to protect named-project behavior. |
| Historical-doc scratch scanner | Reads every candidate through one unbounded `readFileSync`; a 5.18 GB benchmark log deterministically raises `ENOMEM`. | Replace the unbounded read with a fixed-size streaming scan and preserve regex matches across chunk boundaries. |

### Independent agent feedback

- None. The user did not request sub-agents, and current instructions prohibit unsolicited delegation.

## Causal chain

Anonymous Chat activates one dated project directory → Mission wake correctly creates its session with the same request-scoped `project_id` and directory → Work Ledger initially groups all rows by that directory → `implicitChatGroups` drops Mission/Task rows while `projectGroups` retains those dropped rows → one database project is displayed in two UI classifications → the Mission appears not to belong to the anonymous project even though persistence is correct.

The previous implementation did not root-cause this because its visual fixture contained only an anonymous Chat. Its tests therefore proved anonymous header/promotion behavior but never exercised a mixed anonymous Chat + Mission + Task group.

## Implementation plan

1. Make the anonymous Work Ledger projection retain the complete directory group and remove anonymous groups from every competing projection.
2. Add backend regression evidence that an anonymous Mission session persists the allocator's project ID and directory.
3. Extend the real browser fixture with an anonymous Mission and child Task; assert exact group ownership, no duplicate anonymous `Projects` group, and screenshot the repaired Dock.
4. Run focused backend/Overlay tests, Overlay typecheck, document-health checks, Node Playwright visual verification, and a second diff review.

## Verification record

- Backend: `bun test packages/opencorvus/test/mission/wake-route.test.ts` passed 24/24 after rebuilding the stale May debug process-supervisor helper from the current Rust source. The new route test creates one backend-owned anonymous project, then a Chat and Mission through their real routes, and proves identical `projectID` plus directory.
- Overlay unit: `bun run --cwd packages/overlay test:unit test/anonymous-project-mission-classification.test.ts` passed 1/1.
- Real UI: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/global-new-chat-provider-error-browser.test.ts` passed 1/1 with Node and no browser errors. It verifies one anonymous project group owns the Chat, Mission, and Mission child Task DOM, while `Projects` has no copy of the anonymous Mission.
- Visual review: `.scratch/left-dock-hierarchical-grid-vite.png` and `.scratch/anonymous-project-promotion-menu.png` were inspected at original resolution. The `Chats → 匿名项目` hierarchy visibly contains `匿名对话创建的 Mission` and `匿名项目中的已有对话`; the named `prism` project remains separate beneath `项目`, and the existing conversion action remains available.
- Build: the real Vite production build completed successfully as part of the browser runner.
- Document scanner regression: the chunk-boundary test passes after replacing unbounded scratch-file reads with a 4 MiB streaming scan and 4096-character overlap.
- Document-health blocker outside this change: the complete historical-doc test now scans the prior 5.18 GB log without `ENOMEM`, but truthfully reports 488 existing retired-spec offenders beneath `.scratch/benchmark-runs/**`. Those material user-workspace artifacts were not deleted without authorization.
- Static typecheck blocker outside this change: Overlay typecheck reports existing errors in `Conversation.tsx`, `FileChangesView.tsx`, `FileExplorerPanel.tsx`, `LogViewer.tsx`, `MailboxPanel.tsx`, `ScreenshotBrowserPanel.tsx`, the untracked `browser-preview-link.ts`, and the baseline `work-ledger.ts` value/type import collision. The task-owned Vite build and browser checker pass.
