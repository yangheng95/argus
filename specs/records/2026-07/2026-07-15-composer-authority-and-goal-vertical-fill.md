# Composer Authority and Goal Vertical Fill Repair

## Recall

### User request

- The last merge discarded the user's composer interaction changes; the user's version is authoritative: Agent parallelism and Unattended belong inside the `+` menu instead of remaining as always-visible controls below the textarea.
- Resizing the GOALS window must prioritize a vertical goal layout.
- A vertically resized GOALS window must use the full available content area instead of showing only three pills above dead space.
- Reference screenshot: `C:/Users/chuan/AppData/Local/Temp/codex-clipboard-cb2aafe8-14a7-41dc-ad84-dc1506435792.png`.

### Acceptance criteria

- Restore the user-owned menu-scoped runtime controls from the preserved pre-revert lineage: File, Folder, separator, Agent parallelism submenu/slider, and Unattended checkbox all live under the existing `+` trigger.
- Remove the duplicate always-visible parallelism stepper and Unattended switch from the composer toolbar; the menu controls remain the only interactive owner and continue writing the existing authoritative config path.
- Preserve all later functional composer work, including the shared textarea, scoped draft, input-method composition repair, runtime controls, selectors, attachment flow, keyboard resize, and send/stop behavior.
- GOALS pills fill top-to-bottom before opening a new column.
- GOALS row capacity derives from the actual floating-frame height with no three-row ceiling.
- The pill grid grows into the available body height; when all goals fit, no false `+N more` summary remains.
- The existing `TaskProgressBar` and `task-progress-floating-frame.ts` remain the only component and geometry owners. No fallback, duplicate layout source, persisted shadow state, iframe, or query override is introduced.
- Focused unit tests, Node-started browser tests, screenshot inspection, Overlay typecheck, document health, and a final diff review pass.
- Do not restart or refresh the user's running OpenCorvus / Overlay process; use an isolated browser target.

### Hard constraints

- Follow root `AGENTS.md`: no fallback or compatibility branch, no gate, no blind patch, no Git reset, tests for code changes, real visual verification, and post-benchmark review.
- Windows Playwright is started with Node, never Bun.
- Commit subjects start with `dsw-33987`; deliver through the current main worktree and push `v0.0.3beta` to `legacy-remote`.

### Hard-disk sources read before editing

- `specs/records/2026-07/2026-07-09-composer-height-font-adjustment.md`
- `specs/records/2026-07/2026-07-09-task-progress-edge-resize-density.md`
- `specs/records/2026-07/2026-07-09-task-progress-side-gutter-drag-repair.md`
- `specs/records/2026-07/2026-07-09-task-progress-window-visual-redesign.md`
- `specs/records/2026-07/2026-07-14-overlay-neutral-codex-chrome-repair.md`
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/components/composer-resizer.ts`
- `packages/overlay/src/components/TaskProgressBar.tsx`
- `packages/overlay/src/components/task-progress-floating-frame.ts`
- `packages/overlay/src/styles/surfaces/composer.css`
- `packages/overlay/src/styles/surfaces/card.css`
- Focused unit and browser tests named below.

### Merge and snapshot evidence

- The first investigation incorrectly inferred that "user version" referred to older composer dimensions. The user corrected this explicitly; those uncommitted dimension edits were immediately removed before implementation continued.
- Commit `f111df9f44 dsw-33987 WIP preserve overlay SDK and documentation work` and preserved snapshots `stash@{6}` / `stash@{7}` contain the requested interaction: the existing attachment `+` menu owns File, Folder, a parallelism slider submenu, and an Unattended checkbox.
- Later revert commits `751bbf8d17` and `a4dd6e0534` removed `composer-parallelism-slider`, proving the interaction was lost through the revert/merge history rather than intentionally superseded by a user decision.
- The restoration is surgical: the stash is not applied, unrelated SDK/runtime changes are not imported, and the later `untrack(text)` input-method composition repair remains intact.
- The current GOALS capacity helper caps rows through `TASK_PROGRESS_VISIBLE_PILL_MAX_ROWS = 3`; at the screenshot's narrow scaled width that yields one column by three rows even though the frame has enough vertical height for all eight goals.
- `.task-progress__pills` uses ordinary row-major grid placement and does not flex into the remaining body height, so it neither prioritizes vertical fill nor consumes the frame.

### Full-repository grep and call-site decisions

Command families:

- `rg -n "chat-composer-stack|chat-composer-min-height|chat-textarea-height|chat-composer-action-size|chat-input" packages/overlay/src packages/overlay/test specs/records/2026-07`
- `rg -n "TaskProgressBar|taskProgressFloatingVisibleGoalCapacity|TASK_PROGRESS_VISIBLE_PILL_MAX_ROWS|task-progress__pills|task-progress-resize" packages/overlay/src packages/overlay/test specs/records/2026-07`

| Call site / owner                                            | Decision                                                                                                                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/ChatComposer.tsx`                                | Move the existing config mutations into the `+` menu's Kobalte submenu/checkbox controls; preserve later draft/IME fixes and all attachment behavior.               |
| `styles/surfaces/composer.css`                               | Replace obsolete always-visible runtime-control chrome with the preserved menu row and slider surfaces.                                                             |
| `test/composer-run-controls.test.ts`                         | Require menu-scoped single ownership and reject the retired visible stepper/switch.                                                                                 |
| `test/composer-file-loader-right-toolbar.test.ts`            | Pin File → Folder → separator → runtime-control ordering under the one `+` menu.                                                                                    |
| `test/browser/chat-composer-resize-browser.test.ts`          | Open the real menu, mutate parallelism through the slider, toggle Unattended, verify exact PATCH bodies, and capture screenshots.                                   |
| Other composer browser fixtures                              | Remove obsolete fixture markup/assertions that still fabricate always-visible runtime controls; add menu fixture coverage only where the test owns composer chrome. |
| `components/task-progress-floating-frame.ts`                 | Replace the count-only, three-row-capped helper with one layout result containing rows, columns, and visible capacity.                                              |
| `components/TaskProgressBar.tsx`                             | Consume that one layout result for both the visible goal slice and the CSS row count variable.                                                                      |
| `styles/surfaces/card.css`                                   | Make the pills grid fill the body and use column flow with explicit rows; retain all eight resize handles and the single floating frame.                            |
| `test/task-progress-floating-frame.test.ts`                  | Cover tall/narrow, short/wide, full-fit, hidden-count, and invalid input behavior.                                                                                  |
| `test/task-progress-collapse.test.ts`                        | Reject the retired three-row cap and assert the vertical-grid source contract.                                                                                      |
| `test/browser/task-progress-floating-window-browser.test.ts` | Exercise real resize geometry, assert column-major item placement and body-height use, and capture the tall layout screenshot.                                      |

### Independent-agent feedback

- No sub-agent was started because the current collaboration policy permits delegation only when the user explicitly requests it.

## Implementation plan

1. Restore the menu-scoped parallelism slider and Unattended checkbox from the preserved user lineage while retaining later IME and config fixes.
2. Introduce a deterministic GOALS grid layout result derived from frame width, frame height, scale, and total goals.
3. Remove the obsolete three-row ceiling, project the computed row count to CSS, and use column-major grid flow that grows into the body.
4. Run focused unit tests and the Node browser fixtures, inspect screenshots, and iterate until the tall layout visibly fills the frame.
5. Run Overlay typecheck, i18n/document-health checks, `git diff --check`, and a separate final diff review before commit and push.

## Implementation result

- Restored the user-owned composer interaction from the preserved pre-revert lineage: the existing `+` menu now owns File, Folder, the Agent parallelism slider submenu, and the Unattended checkbox. The duplicate toolbar stepper/switch and their now-unused locale keys were removed.
- Replaced the GOALS three-row ceiling with one frame-derived grid result. The UI uses the same result for the visible slice and CSS row count, fills top-to-bottom before opening another column, and stretches the pill grid through the available body height.
- Preserved the later `untrack(text)` input-method composition fix and the existing config mutation paths.
- Browser screenshots reviewed:
  - `.scratch/composer-parallelism-slider.png` shows the menu-owned slider after two animation frames; the first capture's transient Windows compositor black region is absent.
  - `packages/overlay/.scratch/task-progress-floating-window/dark-window-vertical-first-full-area.png` shows ten goals filling the first column through the body bottom and the remaining five in the second column, with no false `+N` summary.

## Verification result

- PASS: 40 focused Overlay unit tests, 390 assertions.
- PASS: four Node-started browser tests covering composer config writes, neutral chrome, runtime icon ownership, and GOALS drag/edge-resize/vertical fill.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `bun run --cwd packages/overlay check:i18n`.
- PASS: `bun test packages/opencorvus/test/script/document-health.test.ts --timeout 120000`: 53 tests, 1,131 assertions.
- The combined historical-docs run passed the repository link/index tests for this new record but remains red in `scratch snapshots do not retain deleted spec trees`: 32 offenders already exist under unrelated `.scratch/o4/**` and `.scratch/opentest-message-*/**` snapshots. They are not produced or modified by this task and were not deleted because they may belong to concurrent user work.

## Pre-push integration blocker recall

- After this task committed, concurrent checkpoint `be9aabcb74` advanced the same branch and changed `dispatch_agent` ownership from one optional `child_session_id` to required `child_session_ids`, while Build and Integrity retain one required `child_session_id`.
- The repository pre-push hook then failed OpenCorvus typecheck in `engine/task-agent-lifecycle.ts` and `engine/writer.ts`; whole-repository grep also found semantic single-session reads in `engine/agent-coordination.ts` and `orchestrator/tools.ts`.
- The checkpoint's own Recall explicitly inventories those lifecycle and Agent-to-Agent consumers, so leaving them on the retired singular field would violate its stated ownership boundary and could omit cancellation of retry child sessions.
- The integration repair introduces one strict child-session projection in `engine/tool-ownership.ts`. It returns the required array for `dispatch_agent`, wraps the required singular identity for Build/Integrity, and throws on structurally invalid in-memory payloads; there is no empty-list fallback.
- Task lifecycle collection, live-ownership cancellation, Agent-to-Agent session ownership, and terminal ownership verification consume that projection. The existing Mirror Watch dispatch-ownership test pins both child sessions through the same owner.
- Integration verification passes: OpenCorvus typecheck; 16 combined Mirror Watch ownership, Agent-to-Agent coordination, and task-cancellation tests with 142 assertions; Prettier; `git diff --check`; and the 53-test document-health suite. The cancellation regression now exercises two child session trees attached to one `dispatch_agent` ownership and observes both settle before the ownership closes.
