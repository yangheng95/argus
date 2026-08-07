# Project Selection Ownership Convergence

## Recall

| Item | Evidence / constraint |
| --- | --- |
| User requirement | Switching to the Watch expert squad must not cause a newly created Mission/project to appear under another opened project. The user clarified that the entire project-selection mechanism must be corrected, not only Chat or Watch. |
| Acceptance | Selecting any Project, Task, Chat, or Mission in project B while project A is current makes B the sole active project before subsequent actions. Every selected source carries its owning directory; project highlighting and project-level actions resolve that same directory; `/mission/wake` receives B. |
| Hard constraints | `prompt_profile.active` changes capability projection only; no fallback, compatibility path, gate, Watch-name check, second active-project source, database migration, or generated build artifact. Preserve unrelated worktree changes. Add regression coverage and verify the real browser interaction. |
| Runtime evidence | At 14:37:38 `POST /coding/session` created `ses_08f7d0c9fffe6OeG9L55RDmBDk` in `/Users/yangheng/Documents/OpenCorvus-Demos/nova-project`. At 14:37:55 the same UI issued `POST /mission/wake`, which created Mission `ses_08f7cc802ffe6k41N2WHAA6Uv3` in `/Users/yangheng/Desktop/opencorvus`. The database confirms the sessions have different `project_id` values. |
| Causal chain | Project-row Chat creation passes its row directory explicitly. `selectCodingAssistantSession` claims and hydrates with that directory but does not run the canonical project switch. Once the source is a session, `activeProjectDirectory` falls back to stale `settingsStore.directory`. Choosing a non-general expert squad routes the next composer submit through `wakeMission`, which faithfully sends that stale directory. The backend then correctly creates the Mission in the wrong, explicitly requested namespace. |
| Sources read | `AGENTS.md`; runtime DB and `2026-07-17T142141-57090-1.log`; `main.tsx`; `services/{coding-assistant,project-directory,workspace,conversation,mission,task,config}.ts`; `store/board.ts`; coding-assistant and project-directory browser tests; July spec indexes. |
| Whole-repository grep | `selectedSource` is written by Task selection, Coding Assistant selection, Mission opening, workspace helpers, and the legacy sync service. Only Task selection invokes `applyDirectory`. `activeProjectDirectory` is consumed by task/config/locale/expert-squad/workspace/settings surfaces. Work Ledger project highlighting and project-level create/import actions bypass it and read `settingsStore.directory`. `wakeMission` has one production composer call plus Multica import. No Watch-specific project routing exists. |
| Independent agent feedback | Post-fix read-only review rejected the first delivery: async Chat/Mission selection could still publish after a newer selection; `codingAssistantStore.selectedSessionID` remained a second stale authority; the browser test did not assert settings/API/project-projection convergence; and `enterTaskWorkspace` plus `syncBoardAndTasks` remained unused bypass exports. |

## Design

Use the existing `applyDirectory` project-switch lifecycle for every user-visible Task, Chat, and Mission selection. Complete the project switch before publishing a Session source or hydrating it. Every active source carries its owning directory, and `activeProjectDirectory` rejects a selected source without one instead of silently falling back to stale settings. `settingsStore.directory` remains the project selection when no work item is selected; a selected source's directory must agree with the project lifecycle.

The independent review proves that ordering also belongs to this lifecycle. A selection intent must claim the shared `boardStore.selectEpoch` before its first asynchronous operation. `applyDirectory` accepts that epoch, returns whether the caller still owns it, and never commits or reports success after a newer Project/Task/Chat/Mission selection supersedes it. Session identity is derived exclusively from `boardStore.selectedSource`; the Coding Assistant registry must not retain a second selected ID.

Work Ledger project highlighting and project-level create/import actions use `activeProjectDirectory`, so selecting a child work item does not erase or redirect its parent-project selection. Remove or redirect production helpers that write a selected source without the canonical lifecycle.

Do not change expert-squad resolution or `/mission/wake`: both exposed the stale context but did not create it.

## Call-site disposition

| Call site | Disposition |
| --- | --- |
| `createCodingAssistantSession` | Retain; selection performs the required project switch. |
| `createGlobalCodingAssistantSession` | Retain; the server-returned owning directory becomes current before selection. |
| `main.tsx` Work Ledger Chat open/create | Retain; both already pass the row/server directory. |
| `CommandPalette.tsx` Chat open | Retain; already passes the row directory. |
| `selectTask` cross-project path | Retain unchanged; it already uses `applyDirectory`. |
| `openMissionSession` | Replace its direct Session-source publication with project switch plus a directory-bearing source. |
| `activeProjectDirectory` | Replace Session fallback-to-settings with selected-source ownership and fail-loud missing-directory behavior. |
| Work Ledger project selection/highlight/actions | Replace direct `settingsStore.directory` reads with the canonical active-project resolver. |
| `syncBoardAndTasks` / `enterTaskWorkspace` direct writes | Remove the bypass or require and carry the owning directory; neither may construct a directoryless active source. |
| `wakeMission` | Retain unchanged; it must continue requiring and explicitly transmitting the caller's directory. |

## Verification

- Unit/service tests: every active Task/Session source resolves its own directory; missing directories fail loudly; cross-project Chat and Mission selection invokes the canonical switch and leaves B active.
- Browser interaction: create a Chat from project B while project A is current, verify the B project remains active with the Chat selected, select an expert squad, submit a Mission, and assert `/mission/wake?directory=B`; capture and inspect the selected surface.
- Targeted typecheck/tests plus documentation-health tests.
- Deterministic overlap tests release A/B claim and connection requests out of order and assert that only the newest selection can publish a source, mutate settings, hydrate, or stream.
- Archiving/deleting a stale Chat while a Task or Mission is selected must preserve that current source.
- The real browser assertion must inspect `settingsStore.directory`, saved directory, API directory, config/tasks projection ownership, selector-click Mission routing, and the final directory-bearing source—not only active CSS derived from that source.

## Result

- Every Project/Task/Chat/Mission selection now claims one shared epoch before its first asynchronous operation. Directory application returns explicit ownership, close-project supersedes in-flight child selection, and stale operations cannot publish, hydrate, or start server-sent events.
- Chat creation claims its epoch before `POST /coding/session`; same-ID Chat clicks are independent intents rather than module-level activation reuse. Cross-project Task/Chat/Mission failures clear their pending source when they still own the epoch.
- `codingAssistantStore.selectedSessionID`, `enterTaskWorkspace`, task-mode `setWorkspaceDirectory`, and `syncBoardAndTasks` were deleted. Session kind and owning directory live on the single `boardStore.selectedSource` projection.
- Deterministic service tests cover out-of-order directory health responses, different-ID and same-ID Chat claims, slow Chat creation responses, failed Chat claims, Task health failure rollback, stale Chat archive, and project close supersession. The focused suites pass when executed through the repository's per-file isolation model; Overlay TypeScript checking passes.
- The real Node/Playwright browser sequence starts on project B, creates and selects a Chat in project A, proves settings/saved directory/config/path request projections all converge to A, clicks the Watch expert-squad selector, and proves `/mission/wake` plus the resulting Mission source stay in A. Screenshots were inspected at `.scratch/project-directory-new-chat-selected.png` and `.scratch/project-directory-watch-mission-ownership.png`.
- Documentation health passes 82/82 across historical links, document health, and product-doc single-source checks. Generated Vite/native build outputs remain untracked and are not part of the commit.
