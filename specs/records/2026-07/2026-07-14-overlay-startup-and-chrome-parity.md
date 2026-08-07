# Overlay Startup And Chrome Parity

## Recall

### User requirement

- Prevent the Projects rail from showing `Failed to fetch / Retry` while the managed server is still starting.
- Match Codex icon density for the window titlebar, project/conversation actions, and Right Dock header.
- Restore the hidden conversation action, add a visible center/Right Dock boundary, and correct the Right Dock overflow dropdown.
- Preserve the existing information architecture and interactions shown in the seven supplied screenshots.

### Acceptance criteria

- Work Ledger does not request before the canonical connection store reports `online`; it automatically loads when that source becomes online and does not expose a transient startup fetch error.
- Titlebar sidebar/back/forward icons use one compact size; all Work Ledger action buttons use the same compact action geometry and every rendered action remains visible.
- The center workbench and Right Dock have a persistent one-pixel visual divider with the existing resizer hit target.
- Right Dock add/runtime/close controls use compact, aligned button and icon geometry.
- Kobalte overflow/add menu items reset native button appearance and render as flat menu rows.
- Focused source tests, a Node-launched real-browser regression, screenshot review, typecheck, and `bun run build:overlay` pass without restarting or closing the user's running Overlay process.

### Hard constraints

- No fallback, duplicate connection state, retry gate, temporary iframe, or local preview override.
- `appStore.connectionStatus` remains the only startup connection authority; `WorkLedger` reacts to it directly.
- Existing Icon, Button, Kobalte DropdownMenu, and Right Dock resizer primitives remain the implementation owners.
- Do not reset, restore, stash, or overwrite unrelated dirty worktree changes; do not create a worktree.
- Do not push, because the user explicitly requested local-only work earlier in this task.
- Playwright runs through Node, and the user's running OpenCorvus/Overlay process is not restarted or closed.

### Sources read

- `AGENTS.md`
- `specs/records/2026-07/2026-07-14-left-dock-vertical-density.md`
- `specs/records/2026-07/2026-07-14-right-dock-header-height-and-seam.md`
- `specs/records/2026-07/2026-07-14-overlay-workspace-surface-continuity.md`
- `specs/records/2026-07/2026-07-08-codex-message-panel-titlebar-toolbar.md`
- `packages/overlay/src/components/WorkLedger.tsx`
- `packages/overlay/src/components/ProjectLedgerGroup.tsx`
- `packages/overlay/src/components/RightDock.tsx`
- `packages/overlay/src/components/TaskDirBar.tsx`
- `packages/overlay/src/components/titlebar/TitlebarNavigation.tsx`
- `packages/overlay/src/main.tsx`
- `packages/overlay/src/store/app.ts`
- `packages/overlay/src/services/init.ts`
- `packages/overlay/src/services/connection.ts`
- `packages/overlay/src/styles/surfaces/{titlebar,sidebar,work-ledger,workspace,activity}.css`
- Focused Overlay unit and browser tests covering Work Ledger, titlebar, Right Dock, runtime toolbar, and dropdown ownership.

### Whole-repository search evidence

Repository searches covered `WorkLedger`, `loadWorkLedger`, `refreshToken`, `connectionStatus`, `onConnected`, all `project-group-*` and `work-row-actions` selectors, titlebar navigation controls, Right Dock tabs/add/more/close/menu selectors, runtime toolbar actions, separator/resizer ownership, and all focused source/browser tests.

| Owner / call site | Decision |
| --- | --- |
| `WorkLedger` load effect | Include canonical connection status in the reactive key and only load while online. |
| `initApp` / `connection.ts` / `appStore` | Preserve as the sole server readiness lifecycle; add no timer or shadow state. |
| `TitlebarNavigation` and `main.tsx` sidebar toggle | Reduce only Icon primitive sizes; preserve existing compact buttons. |
| `work-ledger.css` action selector | Add the omitted Mission/Chat action IDs to the existing shared compact geometry rule. |
| `ProjectLedgerGroup` actions | Preserve the established 16px project action contract as the comparison authority. |
| `.right-dock-resizer` | Turn the existing resize owner into the persistent visual divider while preserving an expanded pointer hit area. |
| Right Dock header controls | Apply a context-scoped compact button/icon contract to add, runtime, and close controls. |
| Kobalte menu items | Keep the current primitive and complete its native appearance reset. |
| Browser tests | Extend startup and Right Dock geometry evidence; capture scoped screenshots for manual review. |

### Independent agent feedback

- None. The user did not request delegated agents; the current collaboration contract does not authorize spawning them.

## Root cause

The six symptoms come from four concrete ownership gaps: Work Ledger loads independently of the existing connection lifecycle; its shared action selector omits several Mission/Chat action IDs; the Right Dock resizer deliberately paints no resting boundary; and runtime/header controls inherit dimensions intended for the old collapsed side toolbar. The malformed dropdown was the native button appearance leaking through Kobalte item elements because the menu-row reset was incomplete.

## Implementation

1. Bind Work Ledger loading to `appStore.connectionStatus` and cover the delayed-start transition in a real browser fixture.
2. Normalize titlebar and Work Ledger action icon geometry through their existing owners.
3. Paint the existing Right Dock resizer as the separator and scope compact header geometry to Right Dock.
4. Complete menu-row appearance reset, update focused tests, inspect screenshots, and package with `bun run build:overlay`.

## Verification

- `bun test` focused Overlay source tests.
- `bun run --cwd packages/overlay typecheck`.
- `node packages/overlay/test/browser-runner.mjs ...` for delayed startup and Right Dock visual geometry.
- Manual inspection of the generated scoped screenshots.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` and related document-health checks.
- `bun run build:overlay` from the repository root.

## Result

- PASS: the delayed-health browser fixture proved Work Ledger makes zero requests before the canonical connection becomes online, exposes no `ledger-error`, then loads exactly once after readiness.
- PASS: real browser geometry measured the titlebar icons at 14px, Right Dock add/close icons at 12px, runtime icon at 14px, all three header controls at 26px, and the persistent resizer divider at 1px.
- PASS: the real Chat row rendered pin, rename, and delete as three visible 18px action buttons fully contained by the 62px action rail; screenshot: `.scratch/work-ledger-chat-actions-visible.png`.
- PASS: the Kobalte overflow menu rendered flat transparent 12px rows with no native border/appearance; screenshots: `.scratch/right-dock-add-menu-open.png` and `.scratch/right-dock-many-tabs-stable.png`.
- PASS: the startup loading screenshot `.scratch/work-ledger-loading-status.png` was manually reviewed and contains only the expected Projects skeleton, not `Failed to fetch / Retry`.
- PASS: 12 focused source tests, Overlay TypeScript, panel i18n, historical links, product-doc single source, both Node browser regressions, and scoped `git diff --check`.
- PASS: `bun run build:overlay` generated `packages/overlay/dist/opencorvus-overlay-windows-x64/opencorvus-overlay.exe` (168,614,912 bytes; SHA-256 `E9A935759A5F30670E7C3BC4E35B055FCEF5A09BB450CF7122C99E059FB04701`).
- External document-health blocker: the tracked-record check also reports five pre-existing untracked July records; this local-only task record is likewise untracked because the user explicitly requested no push/commit workflow.

## 2026-07-14 Mission Status And Embedded Toolbar Follow-up

### Recall

#### User requirement

- Reduce the Mission expand/collapse control and make the Mission/Chat pin action match the compact Codex pin affordance.
- Replace the running row's passive status mark with an animated loading icon.
- Reduce the editor launcher capsule background in the conversation header.
- Remove the duplicate Files title from the Review panel while preserving its Changes/Diff toolbar.
- In the light theme, give the active Right Dock tab a visible layer and give highlighted dropdown rows a visible hover layer.

#### Acceptance criteria

- Mission disclosure fits the row action rhythm and the pin glyph is clearly legible without enlarging the complete action rail.
- Active Mission/task rows show one animated loading glyph at the right edge; non-running rows retain their existing status and timestamp metadata.
- The editor launcher uses the existing split-launcher primitive at a compact Codex-like height and width.
- Review renders one title in the Right Dock tab strip; its embedded second row contains only the Changes/Diff toolbar.
- Light-theme active tabs and keyboard/mouse-highlighted add/overflow menu rows have a non-white interaction layer derived from the shared wash tokens.
- Focused source tests, Node-launched browser screenshots in dark and light themes, typecheck, and `bun run build:overlay` pass without restarting the user's running process.

#### Hard constraints

- Preserve Work Ledger status, Right Dock tab, Kobalte DropdownMenu, SurfaceHeader, Tabs, Button, and Icon as the only owners; add no duplicate state or CSS-only content hiding workaround.
- Use the Lucide loading glyph through the Icon registry and the existing `oc-spin` motion token.
- Do not reset, restore, stash, overwrite unrelated worktree changes, create a worktree, commit, or push.
- Launch Playwright with Node and do not close or restart the user's OpenCorvus/Overlay process.

#### Sources read

- `packages/overlay/src/components/{WorkLedger,WorkspaceEditorLaunchers,FileChangesPanel,RightDock,Icon}.tsx`
- `packages/overlay/src/components/ui/{SurfaceHeader,Tabs}.tsx`
- `packages/overlay/src/styles/surfaces/{work-ledger,conversation,activity,workspace}.css`
- `packages/overlay/src/styles/{primitives/tabs,tokens/design-language,cascade/light}.css`
- `packages/overlay/test/browser/titlebar-toolbar-toggle-browser.test.ts`

#### Whole-repository search evidence

Repository searches covered every Work Ledger status/disclosure/pin render site, all workspace editor launcher selectors, the only `FileChangesPanel` mount, every Right Dock tab/add/overflow selector, global `oc-spin`, light-theme surface tokens, and focused source/browser tests.

| Owner / call site | Decision |
| --- | --- |
| `WorkLedgerRowView` | Render the registered loading icon only for the existing `active` tone; preserve status/timestamp for all other tones. |
| `work-ledger.css` | Compact Mission disclosure and enlarge only the pin glyph inside the existing action geometry. |
| `WorkspaceEditorLaunchers` / `conversation.css` | Keep the split launcher and reduce its header-context height, minimum width, padding, icon, and caret geometry. |
| `FileChangesPanel` | Keep one panel toolbar but omit its title structurally; do not hide duplicate text with a selector. |
| `RightDock` / `workspace.css` | Preserve Kobalte and tab ownership; replace white-on-white `surface-strong` mixes with shared `selected-wash` and `hover-wash`. |
| Browser fixture | Add running-row, disclosure/pin, compact editor, single-title Review toolbar, and light-theme layer measurements plus scoped screenshots. |

#### Independent agent feedback

- None. The user did not request delegated agents, and no delegation is needed for these tightly coupled overlay owners.

### Root cause

The Mission disclosure uses a 24 by 32 control inside an 18-pixel action rhythm, while the pin glyph is only 11 pixels. Running rows still render the generic text status/timestamp pair even though the existing status tone already identifies active work. The editor split launcher retains the previous 32-pixel control contract. Review mounts a `SurfaceHeader` title below a Right Dock tab that already owns the title. Finally, light-theme `--surface-strong` is white, so mixing it with transparency cannot produce a visible active or hover layer on the white panel.

### Implementation

1. Normalize Mission disclosure/pin geometry and map the existing active tone to a Lucide loading icon using `oc-spin`.
2. Compact the editor split launcher and convert Review's second header into an actions-only toolbar through the SurfaceHeader contract.
3. Use shared interaction wash tokens for Right Dock active/hover surfaces, then extend real-browser geometry and light/dark screenshot evidence.

### Follow-up Result

- PASS: active Mission rows render the registered Lucide loading glyph with `oc-spin`, without the old status dot/timestamp pair; screenshot `.scratch/work-ledger-running-loading-icon.png`.
- PASS: Mission disclosure measured 20px high and 26–28px wide, while the pin remains in the 18px action box with a 13px glyph; screenshot `.scratch/work-ledger-mission-actions.png`.
- PASS: the editor split launcher measures 28px high and collapses to the compact icon/caret form when the Right Dock reduces header width; screenshot `.scratch/codex-message-header-toolbar-closed.png` covers the expanded header state.
- PASS: Review renders one `Review` title in the Right Dock tab and an actions-only `Changes / Diff` second row; screenshot `.scratch/right-dock-review-single-title-toolbar.png`.
- PASS: light-theme active tabs use `--selected-wash` and hovered Kobalte menu rows use `--hover-wash`; screenshots `.scratch/right-dock-light-active-tab-layer.png` and `.scratch/right-dock-light-menu-hover-layer.png`.
- PASS: 23 focused Overlay source tests, Overlay TypeScript, panel i18n, the Node browser regression, 20 historical-doc checks with an explicit 20-second scan timeout, and scoped `git diff --check` passed.
- PASS: `bun run build:overlay` completed after the user closed the running locked executable and generated `packages/overlay/dist/opencorvus-overlay-windows-x64/opencorvus-overlay.exe` (168,627,712 bytes; SHA-256 `39CC75768E0CE750C6475B50E628CC61E570ECC14EB6F1FE00FA9B85AC5B61EF`).
- At that earlier local-only phase, no commit or push was performed.

## 2026-07-14 Right Dock Tab As Sole Title

### Recall

#### User requirement

- Treat each Right Dock tab as the panel's only title.
- Remove secondary content titles from Notifications, Requirements, Architect, Screenshots, Explorer, Goals, and Changes.
- Preserve only useful second-row toolbars such as browser controls, Explorer search, Screenshots count, and Changes/Diff switching.
- Reduce the oversized left-sidebar search icon beside New chat.

#### Acceptance criteria

- No listed Right Dock panel repeats its tab label inside the content surface.
- Requirements, Architect, and Goals omit their shared title/icon row; a status badge may remain only as an actions-only toolbar when data exists.
- Explorer retains its search field without the Explorer title; Screenshots retains its count without the Screenshots title; Changes retains its view switcher without the Files title.
- Notification task-group headings remain because they describe grouped content, not the panel itself; Notification Center adds no panel title.
- The left Work Ledger search toggle renders a 14px search/close glyph through the existing Button and Icon owners.
- Focused tests, Node browser geometry, scoped screenshots, typecheck, and `bun run build:overlay` pass without pushing.

#### Hard constraints

- Right Dock tab metadata remains the single title source; do not hide duplicate text with theme selectors or maintain a second title source.
- Preserve SurfaceHeader for actions-only toolbars and Kobalte/Button/Icon ownership.
- Do not reset, stash, restore, overwrite unrelated changes, create a worktree, commit, or push.
- Use Node for Playwright and do not stop a running Overlay process without explicit authorization.

#### Sources read

- `packages/overlay/src/components/{Board,NotificationCenter,ScreenshotBrowserPanel,FileExplorerPanel,FileChangesPanel,WorkLedger,RightDock}.tsx`
- `packages/overlay/src/components/ui/SurfaceHeader.tsx`
- `packages/overlay/src/styles/surfaces/{activity,inspector,notifications,sidebar,work-ledger,workspace}.css`
- Focused panel ownership, SurfaceHeader, Work Ledger, and browser tests.

#### Whole-repository search evidence

Repository searches covered every `SurfaceHeader` use in the target panels, the shared `TaskScopePanelShell`, Notification Center group headings, all Right Dock mounts, Work Ledger search toggle render/style sites, and source/browser assertions for the affected panel titles.

| Owner / call site | Decision |
| --- | --- |
| `TaskScopePanelShell` | Delete title/icon inputs and render an actions-only SurfaceHeader only when a badge exists. |
| `FileExplorerPanel` | Omit the SurfaceHeader title and keep the search actions slot. |
| `ScreenshotBrowserPanel` | Omit the SurfaceHeader title and keep the count actions slot. |
| `FileChangesPanel` | Preserve the already-correct actions-only Changes/Diff toolbar. |
| `NotificationCenter` | Preserve task-group headings; it already has no panel-level secondary title. |
| `WorkLedger` / `sidebar.css` | Reduce only the existing search toggle glyph to 14px. |
| Browser regression | Measure the search glyph and assert all opened target panels have no content-level duplicate title. |

#### Independent agent feedback

- None. The change is localized to one panel-title contract and one sidebar control.

### Root cause

Right Dock already owns panel identity through its tab metadata, but several content components still render legacy standalone headers from the previous side-activity architecture. The left search toggle also retained a 17px glyph while adjacent Codex-density controls use 14px chrome icons.

### Implementation

1. Convert the shared task-scope shell and Explorer/Screenshots headers to actions-only toolbars.
2. Remove dead task-scope title/icon styling and retain semantic content-group headings.
3. Set the Work Ledger search toggle glyph to 14px, then verify every affected panel in a real browser and rebuild the Overlay.

### Follow-up Result

- PASS: the Node-launched titlebar/Right Dock browser regression rendered tabs as the only panel titles while keeping Explorer search, Screenshots count, and Changes/Diff controls as toolbars.
- PASS: the Work Ledger search glyph, Mission actions, loading state, Browser blank tab, add/overflow menus, light-theme layers, and multi-tab geometry were re-rendered after the `v0.0.3beta` merge.
- PASS: scoped screenshots were manually reviewed after the merge, including `.scratch/right-dock-add-menu-open.png`, `.scratch/right-dock-many-tabs-stable.png`, `.scratch/right-dock-review-single-title-toolbar.png`, and `.scratch/work-ledger-search-icon-compact.png`; no clipping, duplicate content title, or unintended white-on-white interaction layer remained.
- PASS: focused Overlay source tests, Overlay TypeScript, and the real-browser titlebar/Right Dock scenario passed after the merge.

- PASS: Requirements, Architect, Goals, Screenshots, Explorer, Changes, and Notifications use the Right Dock tab as their sole panel title; Notifications' legacy `sections-header` and title synchronization source were deleted structurally.
- PASS: Explorer's sole search tool now fills the actions-only toolbar row instead of leaving a title-sized blank region; screenshot `.scratch/right-dock-explorer-toolbar-only.png`.
- PASS: the Work Ledger search/close glyph measures 14px inside the existing 32px button; screenshot `.scratch/work-ledger-search-icon-compact.png`.
- PASS: real-page screenshots confirm Requirements and Notifications have no duplicate content heading: `.scratch/right-dock-requirements-tab-only-title.png` and `.scratch/right-dock-notifications-tab-only-title.png`.
- PASS: 63 focused source/component tests, Overlay TypeScript, panel i18n, the Node-launched Playwright regression, 20 historical-document checks, and scoped `git diff --check` passed.
- PASS: `bun run build:overlay` generated `packages/overlay/dist/opencorvus-overlay-windows-x64/opencorvus-overlay.exe` (168,628,736 bytes; SHA-256 `66C31D7DE6D27A37D74F3CB6DCBB2E27C2C118F6F74FED8F73C98038FEAAE68B`).
- At that earlier local-only phase, no commit or push was performed.

## 2026-07-15 Environment Menu, Review Diff Action, and Message Chrome

### Recall

#### User requirement

- Reproduce the Codex environment-information control beside the existing Open in editor launcher.
- Keep Review free of a duplicate secondary title while restoring its Diff function button.
- Place each conversation copy action below the sent message rather than beside the identity metadata.
- Increase the `OpenCorvus Workspace` title typography to the Codex sidebar-title scale.

#### Acceptance criteria

- The existing project runtime dropdown moves from the Right Dock tab strip to the chat header, directly after the editor split launcher, and remains the only runtime/environment entrypoint.
- The Kobalte-owned environment panel projects the selected directory, VCS branch/state, current change totals, worktrees, and task attachments from existing stores/services; it does not create local substitute data.
- Review still has no duplicate title. An actions-only toolbar restores the compact Changes/Diff switch and keeps Diff disabled until a remembered diff target exists.
- Copy remains available on hover/focus, but its button occupies an action row below the message body. User-message alignment follows the sent bubble rather than the identity line.
- The workspace brand title uses the existing heading/title typography tokens and remains aligned with the adjacent compact search action.
- Focused source tests, Node Playwright interaction/screenshots, TypeScript, i18n, historical-document checks, and `bun run build:overlay` pass without stopping the running Overlay process or pushing.

#### Hard constraints

- Reuse `DropdownMenu`, `Button`, `Icon`, `currentChangeGroups`, `boardStore.vcs`, the Worktree service, `cardTreeStore`, and the existing image preview/attachment controls.
- Remove the old Right Dock runtime slot rather than keeping two environment controls.
- Do not restore a Review title inside the content panel; the actions-only Changes/Diff toolbar is allowed. Do not fabricate commit/push or GitHub CLI capabilities absent from the backend.
- Do not reset, stash, restore, overwrite unrelated changes, create a worktree, commit, or push.

#### Sources read

- `packages/overlay/src/components/{App,TaskDirBar,WorkspaceEditorLaunchers,RightDock,FileChangesPanel,ChangesPanel,FileChangesView,ChatBubble,ImagePreview}.tsx`
- `packages/overlay/src/services/{diff,workspace,worktree,api,image-preview}.ts`
- `packages/overlay/src/store/{board,card-tree}.ts`
- `packages/overlay/src/styles/surfaces/{activity,conversation,changes,chat-bubble,titlebar,workspace}.css`
- Existing titlebar/Right Dock, Review navigation, message copy, brand guide, and TaskDirBar tests.

#### Whole-repository search evidence

Repository searches covered every `ProjectRuntimeToolbarActions` mount, `runtimeActions` prop, VCS/worktree projection, diff active-view mutation, Review toolbar assertion, `chat-bubble-copy-message` render/style/test site, brand wordmark typography assertion, and task-attachment projection into `ctx:user-request`.

| Owner / call site | Decision |
| --- | --- |
| `App` / `main.tsx` | Add one environment-actions slot immediately after `WorkspaceEditorLaunchers`. |
| `RightDock` | Delete the old runtime-actions prop and tab-strip mount so environment state has one entrypoint. |
| `TaskDirBar` | Retain Kobalte and existing service ownership; reshape the panel to Codex density and project changes, local directory, branch/worktrees, and task sources. |
| `FileChangesPanel` | Restore the controlled Changes/Diff Tabs inside an actions-only `SurfaceHeader`; omit every content title/icon. |
| `ChatBubble` | Separate structural card controls from the copy action and render copy after the body. |
| `titlebar.css` | Promote the wordmark and workspace label using existing heading/title tokens. |

#### Independent agent feedback

- None. The affected surfaces share titlebar and message-layout contracts and require one coordinated visual regression.

### Root cause

The project runtime control already owns the required environment data and Kobalte interaction, but it is mounted in the Right Dock tab strip instead of beside Open in editor, which both diverges from Codex and consumes scarce tab chrome. Review lost its Diff action because the entire actions-only toolbar was removed together with the duplicate title treatment, even though the toolbar itself was not a title. Message copy is structurally grouped with identity controls, so CSS cannot place it beneath the sent message without also moving unrelated rewind/trace controls. The brand remains on the generic card-title scale rather than the sidebar heading scale shown by the reference.

### Implementation

1. Relocate and reshape the existing runtime dropdown as a Codex-style environment menu beside the editor launcher.
2. Restore the controlled Changes/Diff switch in an actions-only toolbar with no panel title.
3. Move copy into a dedicated post-body message action row and promote the workspace brand typography.
4. Update focused regressions, render real screenshots, and rebuild the Windows Overlay artifact.

### Result

- The environment-information dropdown now occupies the chat-header slot beside the editor launcher and projects current changes, local directory, branch state, worktrees, and task sources from the existing stores/services.
- Review keeps the Right Dock tab as its only title while restoring the Changes/Diff action toolbar; a remembered diff target can be reopened after returning to Changes.
- Message copy actions render below the message body, including right-aligned sent messages, and the workspace wordmark uses the promoted Codex-like title scale.
- Focused source regressions passed (`54 pass`), Node Playwright interaction/visual regressions passed (`3 pass`), TypeScript and i18n checks passed, and historical-document validation passed (`20 pass`).
- Visual review completed for `.scratch/codex-environment-info-menu.png`, `.scratch/right-dock-review-actions-toolbar.png`, `.scratch/overlay-user-message-copy-action.png`, and `.scratch/workspace-title-search-action.png`.
- `bun run build:overlay` completed successfully without stopping a running process. Artifact: `packages/overlay/dist/opencorvus-overlay-windows-x64/opencorvus-overlay.exe` (`152537600` bytes, SHA-256 `C1331747988C17D2AEC3576BEE7A9D076712DA28EE26D1369305D5F96C5C0510`).
