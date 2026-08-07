# Environment Summary, Resource Groups, and Git Actions

## Recall

### User request

1. Make the Codex-style right-side Environment Information surface collapsible; when collapsed, keep the change additions and deletions visible.
2. Classify Goals, Worktrees, Browser, Review, Files, Screenshots, Requirements, and Architecture instead of rendering one undifferentiated list.
3. Align each category heading and its rows on one leading axis.
4. Implement the currently inert commit and push control using Codex as the interaction reference; generate the Git commit message with AI and show it immediately for editing.
5. Follow-up reference: clicking Commit or push must open a dedicated dialog;
   the editor and Commit / Commit & Push / Push actions must not expand inline
   inside Environment Information.

The supplied references are:

- `C:/Users/10132/AppData/Local/Temp/codex-clipboard-eb50ec45-8444-4289-8f35-70bbdefc4909.png`
- `C:/Users/10132/AppData/Local/Temp/codex-clipboard-1d40fb1c-2842-483c-a222-ea42ae70acc6.png`

### Acceptance criteria

- Environment Information remains the one chat-header-owned Kobalte Popover and gains an internal expanded/collapsed presentation. Collapsing does not dismiss the Popover or erase its requested-open intent.
- The collapsed row shows Environment Information, a clear disclosure affordance, the canonical change additions/deletions, and the existing add affordance without retaining the expanded body.
- Expanded task facts are grouped as Task (Goals, Requirements, Architecture), Workspace (Worktrees), and Tools (Browser, Review, Files, Screenshots, active File). Empty groups are absent.
- Each group header and row uses one explicit leading-axis contract; Goal and Worktree child rows do not drift to an unrelated inset.
- Opening Commit or push automatically starts one streaming AI commit-message request. The streamed result is visible and editable in the canonical textarea primitive.
- The Environment row is only the dialog trigger. The modal dialog shows the
  current branch, generated message, regeneration control, and applicable Git
  actions; closing it does not mutate Git.
- Dirty repositories expose Commit and Commit & Push. Clean repositories with outgoing commits expose Push. Success refreshes the canonical VCS store; failures remain visible and never report success.
- The backend owns exact Git add/commit/push execution through the existing `Vcs` and `git()` process chokepoints. The Overlay never shells out or invents a second repository state.
- Focused backend and Overlay tests, OpenAPI/SDK/docs freshness, Overlay typecheck/i18n, document health, Node-launched browser interaction, task-scoped screenshots, and manual visual review pass.

### Hard constraints

- Desktop-only delivery; no mobile/tablet/responsive expansion beyond the existing Environment Popover contract.
- Reuse the existing `Popover`, `Disclosure`/`Section`, `Button`, `AutoGrowTextarea`/`TextField`, `Icon`, and HostTransport streaming primitives.
- Every LLM call remains streaming. The commit-message helper is a real helper-model call, not a non-streaming completion, hidden chat message, or synthetic conversation.
- No fallback remote, implicit upstream creation, hidden force push, compatibility route, state-machine gate, or second change-count source.
- Do not restart, refresh, resize, or close the user's running OpenCorvus/Overlay. Visual validation uses an isolated Node-launched preview.
- Preserve unrelated dirty files. No worktree creation, reset, hook bypass, or GitHub push.
- Commit subjects use the required `dsw-33987` prefix and delivery targets `myhexin/work-v0.0.16beta-yr-0723`.

### Sources read

- `AGENTS.md`
- Browser control skill instructions.
- The two supplied Codex screenshots.
- `specs/current/architecture/07-panel.md`
- `specs/records/2026-07/2026-07-15-codex-sidebar-search-environment-parity.md`
- `specs/records/2026-07/2026-07-17-environment-right-dock-tool-shortcuts.md`
- `specs/records/2026-07/2026-07-21-current-project-uncommitted-goal-attribution.md`
- `specs/records/2026-07/2026-07-23-environment-popover-right-dock-responsive-coexistence.md`
- `packages/overlay/src/components/{TaskDirBar,TaskProgressBar,RightDock}.tsx`
- `packages/overlay/src/components/ui/{Popover,Disclosure,Section,Button,AutoGrowTextarea,TextField}.tsx`
- `packages/overlay/src/services/{meta,diff,api,host-transport,tauri-transport}.ts`
- `packages/overlay/src/styles/{primitives/section.css,surfaces/conversation.css}`
- `packages/opencorvus/src/{project/vcs.ts,util/git.ts,llm/api.ts,agent/model.ts,task-api/index.ts}`
- `packages/opencorvus/src/server/{routes/app.ts,sse.ts}`
- Focused VCS, environment, task-progress, architecture-guard, and browser tests.

### Whole-repository grep evidence

| Owner / call site                                                                     | Current fact                                                                                                                                                 | Decision                                                                                                                                                                |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TaskDirBar.ProjectRuntimeStatusPanel`                                                | Sole Environment Popover owner; the header `plus` is decorative, `panelOpen` only supports open/closed, and `project-runtime-commit-push` is a static `div`. | Keep this owner. Add internal expansion, grouped projections, and the real Git action editor here.                                                                      |
| `TaskProgressBar`                                                                     | Owns Goal rows and its own fold control.                                                                                                                     | Keep Goal row semantics and locate behavior; place it in the Task category and normalize its leading axis through the Environment category contract.                    |
| `RIGHT_DOCK_ENVIRONMENT_TOOL_CATALOG`                                                 | Sole identity/order/icon/label catalog for Browser, Review, Files, Screenshots, Requirements, Architecture, Goals, and File.                                 | Keep catalog identity. Split the visible, data-driven projection into task and tool category arrays without duplicating metadata.                                       |
| `currentChangeGroups`, `resolveCurrentChangeGroups`, `summarizeChangeGroups`          | Sole Environment/Review task-change additions and deletions source.                                                                                          | Reuse unchanged for expanded and collapsed totals. Git mutation state continues to come from `Vcs.Info`; the two facts are not merged.                                  |
| `boardStore.vcs`, `loadMeta`                                                          | Sole Overlay VCS status projection.                                                                                                                          | Refresh this exact projection after commit or push.                                                                                                                     |
| `services/meta.ts`                                                                    | Owns Overlay VCS branch requests.                                                                                                                            | Extend the same VCS service owner with commit, push, and commit-message streaming; do not create a second VCS client module.                                            |
| `HostTransport.openStream`                                                            | Sole cross-host POST Server-Sent Events (SSE) transport.                                                                                                     | Reuse for AI commit-message deltas and terminal result/error events.                                                                                                    |
| `Vcs.info`, `Vcs.branches`, `Vcs.switchBranch`, `Vcs.diff`                            | Sole project Git metadata/diff implementation, used by app routes, engine publishing/checkpoints, project bootstrap, and tests.                              | Add exact `commit` and `push` mutations beside these functions through the existing `git()` process wrapper. Existing callers remain unchanged.                         |
| `git()` / `GitTimeout`                                                                | Sole OpenCorvus Git process wrapper with local/network timeout profiles.                                                                                     | Use local profile for add/commit and network profile for push. Never invoke a shell from Overlay.                                                                       |
| `streamText` wrapper, `HelperAgentRegistry`, `resolveAgentModel`, `ProviderLLM`       | Existing streaming helper-model path used by follow-up generation.                                                                                           | Add one project VCS commit-message helper using the same resolver and wrapper. It consumes `Vcs.diff` plus recent subjects and emits streamed text.                     |
| `/vcs`, `/vcs/branches`, `/vcs/branch`, `/vcs/diff` in `server/routes/app.ts`         | Complete current VCS HTTP surface; no commit, push, or generation route exists.                                                                              | Add `/vcs/commit`, `/vcs/push`, and `/vcs/commit-message/stream` with exact schemas and documented errors.                                                              |
| OpenAPI, generated JavaScript SDK, English/Chinese API docs                           | Generated from route definitions.                                                                                                                            | Regenerate after route changes; do not hand-maintain a second contract.                                                                                                 |
| `project/vcs.test.ts`, `server/vcs-routes.test.ts`                                    | Cover Git status/diff/branch behavior and route schemas.                                                                                                     | Add real temporary-repository commit/push behavior and positive/negative route cases.                                                                                   |
| `meta-vcs-branches.test.ts`, Environment source tests, `task-dirbar-keyboard.test.ts` | Cover the current Overlay request and real browser path.                                                                                                     | Extend with streaming client events, commit/push request bodies, collapse persistence, categories, alignment, editable generated message, commit, and push interaction. |
| `specs/README.md`, `specs/records/2026-07/README.md`, architecture `07-panel.md`      | Canonical documentation indexes and current panel contract.                                                                                                  | Update all three with the finished single-source behavior.                                                                                                              |

### Independent agent feedback

None. The user did not request sub-agents, and the active repository instructions prohibit unsolicited delegation. The primary agent owns the implementation, focused tests, screenshot review, and second diff review.

### Shared-workspace evidence

- The worktree began dirty with unrelated backend, Overlay, SDK, and spec changes.
- While this investigation was running, the shared branch advanced from `2b1ba7baf` to `e45121639`; the latter committed the pre-existing section-heading typography slice.
- Pre-change git-cc hooks passed, but the first push transport ended with a connection error. A later local remote-tracking ref showed `e7382ae05`; direct `ls-remote` then failed because `git-cc.myhexin.com:6443` was unreachable. No remote delivery is claimed until a final remote-ref check succeeds.

## Root cause

The visible defects are one incomplete product boundary, not four isolated CSS bugs.

Environment Information already projects task changes, VCS status, Worktrees, Goals, and Right Dock resources, but it only has Popover open/closed state and renders every resource in one flat sequence. Its alignment is therefore an accident of three unrelated child layouts (`TaskProgressBar`, Worktree rows, tool shortcuts). The commit/push row is more fundamental: it has no Overlay handler, no service call, no backend route, and no VCS mutation implementation. Styling that row as a button would leave the real feature absent.

The repair keeps one Environment owner and one VCS owner. Internal disclosure changes only the Environment presentation. Categories remain projections over the existing board/worktree/catalog sources. Git actions flow through `Vcs`, and the AI message uses the existing streaming helper-model/HostTransport path.

## Implementation plan

1. Add internal Environment expansion and three data-driven resource categories. Reuse the canonical Section/Disclosure and navigation primitives; define one Environment leading-axis layout.
2. Add a streaming project VCS commit-message helper that reads the canonical Git diff and recent subject style, resolves the configured summary helper model, streams deltas, and returns one normalized subject.
3. Extend `Vcs` with exact add/commit and upstream push operations and expose typed routes. Refresh generated OpenAPI/SDK/docs.
4. Extend the Overlay VCS service and replace the inert row with an auto-generating, editable commit surface plus Commit, Commit & Push, and Push actions.
5. Add backend, service, source, and real-browser regressions. Render and personally inspect expanded, collapsed, grouped, and Git editor screenshots.
6. Run the required document, type, i18n, route, build, and diff checks; perform a second exact-diff review; selectively commit only this task and push to git-cc.

## Delivery evidence

### Implemented contract

- `ProjectRuntimeStatusPanel` now owns one internal disclosure while the
  Environment Popover remains open. The collapsed header renders the canonical
  additions/deletions summary and the existing add affordance.
- Expanded facts are projected into Task, Workspace, and Tools `Section`
  primitives. The category body axis also owns Goal and Worktree child-row
  alignment, so headings and items no longer depend on unrelated child padding.
- `Vcs.commit` stages the complete current project worktree and commits the exact
  edited subject. `Vcs.push` uses the current branch's configured upstream.
- `/vcs/commit-message/stream` resolves the configured summary helper model,
  streams one subject from bounded real diff/recent-subject context, and leaves
  the final normalized subject editable before commit.
- The Environment Commit or push row opens the shared Kobalte-backed `Dialog`
  primitive. Its current-branch header, AI message editor, regeneration
  control, and menu-like Commit / Commit & Push / Push rows match the follow-up
  Codex reference without retaining the superseded inline editor.
- Overlay actions call those project-scoped routes and refresh `loadMeta` after
  every successful mutation. No shell, optimistic VCS copy, fallback remote, or
  implicit upstream exists in the Overlay.

### Automated verification

- PASS: `bun test packages/opencorvus/test/project/vcs-commit-message.test.ts packages/opencorvus/test/server/vcs-routes.test.ts --timeout 120000`
  — 9 tests.
- PASS: `bun test packages/opencorvus/test/project/vcs.test.ts -t "Vcs commit and push"`
  — 4 real-repository tests, including a local bare upstream.
- PASS: `bun test test/meta-vcs-actions.test.ts test/meta-vcs-branches.test.ts test/task-cwd-row-layout.test.ts --timeout 120000`
  from `packages/overlay` — 13 tests and 243 assertions.
- PASS: package-local `bun run typecheck` for both `packages/opencorvus` and
  `packages/overlay`.
- PASS: `bun run api:routes-check`, `bun run docs:check`,
  `bun run check:sdk-imports`, and
  `bun run --cwd packages/overlay check:i18n`.
- PASS: `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts --timeout 120000`
  — 87 tests and 1,415 assertions after selective staging.

### Visual verification

The Node-launched Playwright scenario exercised the real Environment trigger,
internal disclosure, task/workspace/tool categories, editable streamed message,
Commit, and Commit & Push request path. Browser geometry verified category title
and first-row left positions within one pixel, transparent category containers,
and matching title/item font size.

The first screenshot exposed bordered category boxes and a ten-pixel title/item
axis drift. Those styles were removed and the scenario was rerun. The accepted
task-scoped evidence is:

- `.scratch/task-dirbar-runtime-status-collapsed-change-counts.png`
- `.scratch/task-dirbar-runtime-git-action-dialog.png`

Both accepted screenshots were personally inspected. The collapsed surface
keeps complete green/red totals visible. The expanded surface shows flat,
aligned Task/Workspace/Tools categories. The dedicated Git dialog shows the
current branch, generated editable subject, Regenerate, Commit, Commit & Push,
and Push actions; the Environment Popover is absent behind the modal.

After all new collapse, category, dialog, exact edited-message, Commit & Push
request, modal geometry, and screenshot assertions passed, the broader browser
file continued into its older cross-task scenario and encountered an unrelated
concurrent `TaskStatusHeader` change calling `statusIconName("")` during an
empty-status transition. The owned Environment interaction path had already
passed; the foreign in-progress `StatusIndicator.tsx` and its owner files were
not modified or claimed by this delivery.

### Second review

The exact backend, transport, component, style, generated-contract, test, and
documentation diffs were reviewed after typecheck and visual correction.
Generated VCS operations match the three route definitions. Mixed shared files
must be staged by hunk so concurrent Mission, settings, mailbox, status, and
heading work does not enter this commit.
