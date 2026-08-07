# VS Code Style Activity Toolbars For Overlay Side Panels

Date: 2026-06-05
Status: implemented toolbar history; TUI-host requirements superseded

> The side-toolbar investigation remains historical implementation evidence.
> Requirements below that name `rightPanelTui`, `TuiHostPanel`,
> `TuiRuntimePanel`, or an embedded right-sidebar TUI host were superseded by
> `2026-06-10-tui-removal-plan.md` and the later acceptance-panel tests that
> keep those paths absent.

## Acronyms

- UI: User Interface, the visible overlay controls and panel chrome.
- UX: User Experience, the user flow for selecting side-panel content.
- DOM: Document Object Model, the browser element tree declared in `packages/overlay/src/index.html`.
- API: Application Programming Interface, the server/client routes used by overlay components.
- CSS: Cascading Style Sheets, the overlay style surfaces under `packages/overlay/src/styles`.
- TUI: Terminal User Interface, the canonical OpenTUI coding surface.
- PTY: Pseudo Terminal, the terminal process transport required for embedded TUI rendering.
- E2E: End-to-End, browser automation that exercises the rendered overlay.
- SSE: Server-Sent Events, the streaming event transport used by current session/task surfaces.

## Scope

The user requested a spec-only investigation for refactoring the overlay to VS Code style vertical icon toolbars on both sidebars:

- Left toolbar activities: task list, file manager, file changes.
- Right toolbar activities: remaining right-side panels.
- Right side no longer uses horizontal tabs.
- Selecting a toolbar icon shows its bound panel.
- Default left activity is tasks.
- Default right activity is TUI.
- Existing functionality must be preserved.
- Unit and Playwright/E2E coverage must be added.

This document originated as the independent investigation/spec pass. The follow-up implementation uses this plan as the source of truth for source and test changes.

## Worktree Snapshot

The current worktree is dirty before this spec work. Relevant overlay facts from `git status --short`:

| Path                                                      | Status    | Meaning for implementation                                                                         |
| --------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/components/RightFilesPanel.tsx`     | deleted   | The old right-side file changes component is already removed in the worktree. Tests still read it. |
| `packages/overlay/src/components/RightPanelTabs.tsx`      | deleted   | The old horizontal right-tab component is already removed in the worktree. Tests still read it.    |
| `packages/overlay/src/index.html`                         | modified  | DOM is partially migrated to activity bodies.                                                      |
| `packages/overlay/src/main.tsx`                           | modified  | Activity signals and mounts are partially migrated.                                                |
| `packages/overlay/src/components/FileChangesPanel.tsx`    | untracked | Neutral replacement for old `RightFilesPanel`.                                                     |
| `packages/overlay/src/components/SideActivityToolbar.tsx` | untracked | Shared toolbar primitive exists.                                                                   |
| `packages/overlay/src/components/TuiRuntimePanel.tsx`     | untracked | TUI status panel exists, but it is not an embedded terminal host.                                  |
| `packages/overlay/src/services/tui-runtime.ts`            | untracked | Client only reads `/tui/runtime/status`.                                                           |

The investigation below is based on the current worktree snapshot, not only `HEAD`.

## Current Implementation Evidence

### Shell DOM

| Area                        | Evidence                                                                                                                                                           | Current state                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Left activity toolbar mount | `packages/overlay/src/index.html:135-197` declares `aside#sidebar`, `#solidLeftActivityToolbar`, `#leftPanelTasks`, `#leftPanelExplorer`, and `#leftPanelChanges`. | The left DOM is already partially migrated. Default DOM active body is `tasks`.                                                |
| Left task body              | `packages/overlay/src/index.html:188-190` keeps `#taskListPanel` inside `#leftPanelTasks`.                                                                         | Existing task list mount can stay the left default.                                                                            |
| Left explorer body          | `packages/overlay/src/index.html:193-194` declares `#leftPanelExplorer` and `#solidFileExplorerMount`.                                                             | File explorer has been moved left in DOM.                                                                                      |
| Left changes body           | `packages/overlay/src/index.html:196-197` declares `#leftPanelChanges` and `#solidFileChangesMount`.                                                               | File changes has been moved left in DOM.                                                                                       |
| Right activity bodies       | `packages/overlay/src/index.html:255-276` declares `#rightPanelTui`, `#rightPanelBrowser`, `#rightPanelInspector`, and `#solidRightActivityToolbar`.               | Right DOM no longer declares old `#solidRightPanelTabs`, `#rightPanelExplorer`, `#rightPanelAssistant`, or `#rightPanelFiles`. |
| Right default DOM           | `packages/overlay/src/index.html:255-261` sets `data-right-activity="tui"` and `rightPanelTui data-active="true"`.                                                 | DOM default matches requested right default, but the body is only a status panel today.                                        |

### State And Mounts

| Code                    | Evidence                                                                                                                                                                                              | Current state                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Activity model          | `packages/overlay/src/main.tsx:177-208` defines `LeftActivity`, `RightActivity`, `DEFAULT_LEFT_ACTIVITY = "tasks"`, `DEFAULT_RIGHT_ACTIVITY = "tui"`, activity arrays, label maps, and Solid signals. | The new source exists, but the registry is split across arrays plus label maps. Target should make one registry per side the single source. |
| File diff opens changes | `packages/overlay/src/main.tsx:517-521` sets `setLeftActivity("changes")` inside `openWorkspaceDiff`.                                                                                                 | Old right-files activation has been replaced.                                                                                               |
| Acceptance focus        | `packages/overlay/src/main.tsx:609-612` listens for `acceptance:focus-changes` and selects left `changes`.                                                                                            | Correct shell binding for the new left changes activity.                                                                                    |
| File changes mount      | `packages/overlay/src/main.tsx:710-716` mounts `<FileChangesPanel diffOpen={workspaceOpen()} ... />` into `#solidFileChangesMount`.                                                                   | Neutral file-changes component is wired in source.                                                                                          |
| File explorer mount     | `packages/overlay/src/main.tsx:730-733` mounts `<FileExplorerPanel active={() => leftActivity() === "explorer"} ... />`.                                                                              | Explorer loading remains activity-gated.                                                                                                    |
| TUI mount               | `packages/overlay/src/main.tsx:736-739` mounts `<TuiRuntimePanel active={() => rightActivity() === "tui"} />`.                                                                                        | Right default currently renders runtime status, not the TUI terminal.                                                                       |
| Toolbar mounts          | `packages/overlay/src/main.tsx:932-964` mounts `SideActivityToolbar` for left and right.                                                                                                              | Shared toolbar primitive is already used.                                                                                                   |
| Browser preview mount   | `packages/overlay/src/main.tsx:966-968` gates `BrowserPreviewPanel` with `rightActivity() === "browser"`.                                                                                             | Browser preview remains a right activity.                                                                                                   |
| Body activation         | `packages/overlay/src/main.tsx:1259-1290` writes `data-active` for left and right activity bodies and updates titles.                                                                                 | Activation is single-source per side, but body IDs are manually duplicated in the effect.                                                   |

### Component Bindings

| Component/service     | Evidence                                                                                                                                                                                                                           | Binding that must survive                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TaskList`            | `packages/overlay/src/main.tsx` mounts `<TaskList/>` into `#taskListPanel`; `packages/overlay/src/components/TaskList.tsx` owns rows/actions.                                                                                      | Task grouping, selection, create, rename, delete, cancel, retry, queue actions remain task-list specific.                                                    |
| `FileExplorerPanel`   | `packages/overlay/src/components/FileExplorerPanel.tsx:61-72` calls `apiJson("file?...")` and `apiJson("find/file?...")`; `:115-137` gates initial and refresh loading on `active()`.                                              | File manager must keep canonical file and find routes and active-gated loading.                                                                              |
| File editor           | `packages/overlay/src/main.tsx:704-707` mounts `FileEditorPane` into `#solidFileEditorMount`; `packages/overlay/src/services/file-workbench.ts` owns open state.                                                                   | Editor stays in the center workspace/file-editor mount, not inside a side activity.                                                                          |
| `FileChangesPanel`    | `packages/overlay/src/components/FileChangesPanel.tsx:14-25` owns changes/diff internal view and listens to `acceptance:focus-changes`; `:51-79` renders `ChangesPanel` plus `DiffPreviewPanel`.                                   | File changes is neutral-left naming and keeps diff preview binding.                                                                                          |
| `ChangesPanel`        | `packages/overlay/src/components/ChangesPanel.tsx:33-99` merges board-derived and agent file-change groups and calls `window.openWorkspaceDiff`.                                                                                   | Clicking a changed file still resolves diff and opens center workspace diff. The line-3 comment still says "right-hand workspace" and should be neutralized. |
| `BrowserPreviewPanel` | `packages/overlay/src/components/BrowserPreviewPanel.tsx:21-36` loads only when active/task/directory exist; `packages/overlay/src/services/browser-preview.ts:44-75` uses `task/{id}/browser-preview`, `/target`, and `/capture`. | Preview must remain task-scoped and backend/evidence-backed. No local signal/query override or temporary preview source.                                     |
| `SideActivityToolbar` | `packages/overlay/src/components/SideActivityToolbar.tsx:21-52` renders `Button` and `Icon` primitives with `data-ui="side-activity-button"` and `aria-pressed`.                                                                   | Reuse this primitive; do not reintroduce hand-written SVG/text buttons for side navigation.                                                                  |
| `TuiRuntimePanel`     | `packages/overlay/src/components/TuiRuntimePanel.tsx:18-36` polls runtime status; `:74-96` renders running/stopped/error details and `tui.embedded_host_pending`.                                                                  | This is not an embedded TUI. It is only a runtime status placeholder.                                                                                        |
| `tui-runtime` service | `packages/overlay/src/services/tui-runtime.ts:10-12` calls `apiJson("tui/runtime/status")`.                                                                                                                                        | There is no browser terminal stream/input/resize binding yet.                                                                                                |

### CSS Evidence

| File                                                 | Evidence                                                                                                                                                                                              | Gap                                                                                                                                                                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/styles/surfaces/inspector.css` | Lines `31-80` still style `.sections-tabs-mount`, `.sections-tabs`, and `[data-ui="right-tab"]`; lines `102-150` still describe `.sections-tab-body[data-panel-tab=...]` and `.sections-browser-tab`. | CSS is still horizontal-tab/old-body shaped while DOM now uses `data-side-activity`, `.sections-content`, `.sections-tui-activity`, and `.sections-browser-activity`.                                                                    |
| `packages/overlay/src/styles/surfaces/sidebar.css`   | Lines `986-1006` collapse `.sidebar` to `--ui-collapsed-pane-width` and hide `.sidebar-title`, `.sidebar-body`, `.sidebar-header-actions`, `.sidebar-btn-label`.                                      | It does not define `.side-activity-toolbar`, `.side-panel-content`, `.side-activity-body`, `.sidebar-explorer-panel`, or `.sidebar-file-changes-panel`. Collapse behavior does not yet explicitly preserve toolbar while hiding content. |
| Full style grep                                      | `rg` found side-activity classes only in `index.html`/components, not in CSS.                                                                                                                         | The new toolbar/body layout is currently unstyled or relies on accidental layout.                                                                                                                                                        |

### I18n Evidence

| Key group              | Evidence                                                                                                                                                                                                                                                         | Gap                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Existing labels        | `packages/overlay/src/i18n/en-US.json:621-667` and `zh-CN.json:621-667` include `section.files`, `explorer.title`, `browser_preview.title`, and `sections.title`.                                                                                                | Existing panel labels are available.                                                                           |
| New toolbar/TUI labels | `main.tsx` uses `activity.left`, `activity.right`, and `tui.title`; `TuiRuntimePanel.tsx` uses `tui.runtime_error`, `tui.runtime_running`, `tui.runtime_stopped`, `tui.runtime_mode`, `tui.runtime_url`, `tui.runtime_session`, and `tui.embedded_host_pending`. | These keys are not present in the locale files. `check:i18n` should fail until they are added in both locales. |

### TUI Host Evidence

| Area             | Evidence                                                                                                                                                                                                                           | Current state                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Overlay TUI body | `TuiRuntimePanel` only polls `/tui/runtime/status` and displays status rows.                                                                                                                                                       | It is not a terminal renderer, not a PTY stream, and not an embedded OpenTUI host.                                |
| Server runtime   | `packages/opencorvus/src/tui/runtime.ts:77-128` starts/connects a `Tui.Handle`; `:130-138` returns status; `:153-173` proxies HTTP control.                                                                                        | Runtime controls an external/internal TUI server, but exposes no terminal stream/input/resize API to the overlay. |
| Spawn behavior   | `packages/opencorvus/src/tui/index.ts:263-287` launches a Windows visible console via `cmd.exe start`; `:289-313` launches Terminal.app on macOS; `:314-353` launches a Linux terminal emulator or detached script.                | The current spawn path is external-window oriented and cannot satisfy "TUI inside the right sidebar".             |
| Routes           | `packages/opencorvus/src/server/routes/tui.ts:117-209` exposes `/tui/runtime/start`, `/status`, `/stop`; `:252-369` exposes submit/proxy/task-status.                                                                              | No `/tui/host/*`, no PTY attach events, no input route, no resize route, no terminal snapshot route.              |
| Existing specs   | `specs/records/2026-06/right-sidebar-opencode-tui-upgrade-2026-06-04.md` and `right-sidebar-opencode-tui-copy-implementation-plan-2026-06-04.md` explicitly identify the embedded host gap and prefer `ghostty-web` plus server-side PTY. | Toolbar work should depend on that host for real TUI acceptance.                                                  |

## Relevant Call Sites And Tests To Update

### Source Call Sites

| Call site                                                           | Current role                                           | Required decision                                                                                                                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/index.html`                                   | Declares current side activity DOM.                    | Keep left `tasks/explorer/changes` and right `tui/browser/inspector`; remove any old right horizontal tab IDs from tests and CSS.                                                  |
| `packages/overlay/src/main.tsx` activity definitions                | Defines left/right IDs, defaults, labels, and signals. | Keep defaults `tasks` and `tui`. Prefer a single registry per side that includes id, icon, label key, body id, and optional mount id to avoid duplicate label/body maps.           |
| `packages/overlay/src/main.tsx` `openWorkspaceDiff`                 | Selects left changes and opens workspace.              | Keep this binding. Test it.                                                                                                                                                        |
| `packages/overlay/src/main.tsx` `acceptance:focus-changes` listener | Selects left changes.                                  | Keep this binding. Test it with `FileChangesPanel` reset to changes view.                                                                                                          |
| `packages/overlay/src/components/SideActivityToolbar.tsx`           | Shared icon toolbar.                                   | Keep `Button`/`Icon` primitives. Add any missing ARIA/current semantics through this single component, not per side.                                                               |
| `packages/overlay/src/components/FileChangesPanel.tsx`              | Neutral file changes/diff panel.                       | Keep neutral name. Add/update tests that read this file instead of deleted `RightFilesPanel.tsx`.                                                                                  |
| `packages/overlay/src/components/ChangesPanel.tsx`                  | File changes list and diff opener.                     | Update stale "right-hand workspace" comment to neutral wording in implementation.                                                                                                  |
| `packages/overlay/src/components/TuiRuntimePanel.tsx`               | TUI runtime status placeholder.                        | Do not claim this as embedded TUI completion. Either replace with real terminal host when available or mark TUI host blocked.                                                      |
| `packages/overlay/src/services/tui-runtime.ts`                      | Runtime status client.                                 | Real TUI host needs client routes for host session, events, input, resize, close, snapshot if the TUI-host spec lands.                                                             |
| `packages/overlay/src/styles/surfaces/sidebar.css`                  | Left shell CSS.                                        | Add side activity toolbar/content/body styles and collapse behavior as the left CSS source.                                                                                        |
| `packages/overlay/src/styles/surfaces/inspector.css`                | Right shell CSS.                                       | Remove old horizontal tab styles; add right activity content/body/TUI/browser/inspector styles.                                                                                    |
| `packages/overlay/src/styles/tokens/design-language.css`            | Global dimensions.                                     | Add a fixed activity toolbar width token only if needed; otherwise define locally once in side surface CSS.                                                                        |
| `packages/overlay/src/i18n/en-US.json` and `zh-CN.json`             | Labels/tooltips/status copy.                           | Add `activity.left`, `activity.right`, and all `tui.*` keys used by current source.                                                                                                |
| `packages/overlay/src/components/Icon.tsx`                          | Icon source.                                           | Existing `goals`, `folder`, `file-document`, `terminal`, `inspect`, `panel-right` are present. Add no new icon unless implementation changes the activity icon set.                |
| `packages/overlay/src/services/pane.ts`                             | Single pane/resizer service.                           | Keep as the single layout authority. Do not add another resizer/collapse model.                                                                                                    |
| `packages/overlay/src/store/settings.ts`                            | Persisted widths/collapse flags.                       | Do not overload `sidebarCollapsed`/`rightPanelCollapsed` as activity state. Persist active activities only if product explicitly wants restore; defaults remain `tasks` and `tui`. |

### Tests To Update Or Add

| Test                                                                                      | Current stale assertion                                                                                                                                                       | Required update                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/test/acceptance-panel-mount.test.ts`                                    | Asserts `#solidRightPanelTabs`, `#rightPanelExplorer`, `#rightPanelFiles`, `#solidRightFilesMount`, `<RightPanelTabs>`, `<RightFilesPanel>`, and `setRightPanelTab("files")`. | Assert `#solidLeftActivityToolbar`, `#leftPanelTasks`, `#leftPanelExplorer`, `#leftPanelChanges`, `#solidFileChangesMount`, `#solidRightActivityToolbar`, `#rightPanelTui`, `#rightPanelBrowser`, `#rightPanelInspector`, `<SideActivityToolbar>`, `<FileChangesPanel>`, `setLeftActivity("changes")`, and absence of old right-tab IDs. |
| `packages/overlay/test/file-explorer-editor.test.ts`                                      | Reads deleted `RightFilesPanel.tsx` and `RightPanelTabs.tsx`; asserts default right tab `explorer`.                                                                           | Read `FileChangesPanel.tsx` and `SideActivityToolbar.tsx`; assert explorer and changes live in left activities, default left tasks, default right TUI, file editor still center-mounted.                                                                                                                                                 |
| `packages/overlay/test/browser-preview-panel.test.ts`                                     | Reads deleted `RightPanelTabs.tsx`; asserts `rightPanelTab`/`.sections-browser-tab`.                                                                                          | Assert right `browser` activity through `rightActivity`, `rightPanelBrowser`, and `.sections-browser-activity`; keep backend preview service assertions.                                                                                                                                                                                 |
| `packages/overlay/test/coding-assistant-panel.test.ts`                                    | Asserts old assistant right tab and `CodingAssistantPanel` mount.                                                                                                             | Retire or rewrite for TUI host. It must not accept `CodingAssistantPanel` as the default-right TUI implementation. If keeping coding assistant tests, scope them to non-default legacy service behavior and not side toolbar shell.                                                                                                      |
| `packages/overlay/test/titlebar-menubar.test.ts`                                          | Lines around `543`, `921-952`, `1002-1034` inspect `[data-ui="right-tab"]` and right tabs spacing.                                                                            | Replace with `[data-ui="side-activity-button"][data-side="right"]` checks, toolbar geometry, and absence of horizontal right tabs.                                                                                                                                                                                                       |
| `packages/overlay/test/pane-collapse-layout.test.ts`                                      | Asserts collapsed side panes as narrow header rails.                                                                                                                          | Assert activity toolbar remains visible while content bodies are hidden/collapsed and resizers are disabled.                                                                                                                                                                                                                             |
| `packages/overlay/test/pane-collapse-rail.test.ts`                                        | Measures old collapse rail behavior.                                                                                                                                          | Update to fixed activity toolbar plus content collapse geometry.                                                                                                                                                                                                                                                                         |
| `packages/overlay/test/overlay-architecture-guards.test.ts`                               | Guards `.sections-tab-body[data-panel-tab=...]` and right shell ownership.                                                                                                    | Replace with side activity CSS ownership and no stale `.sections-tabs`/`[data-ui="right-tab"]` shell rules.                                                                                                                                                                                                                              |
| `packages/overlay/test/sections-single-source.test.ts`                                    | Guards right `.sections` source rules.                                                                                                                                        | Update to side activity body selectors and old tab selector absence.                                                                                                                                                                                                                                                                     |
| `packages/overlay/test/sidebar-chat-single-source.test.ts`                                | Guards left sidebar/task-list source rules.                                                                                                                                   | Add toolbar/content/body selector ownership and collapsed-toolbar persistence.                                                                                                                                                                                                                                                           |
| `packages/overlay/test/icon-affordance-visibility.test.ts` and `button-primitive.test.ts` | Existing primitive coverage.                                                                                                                                                  | Add side activity buttons using `Button` and `Icon`, with accessible labels and no visible text overflow.                                                                                                                                                                                                                                |
| New focused unit test                                                                     | None yet.                                                                                                                                                                     | Add `side-activity-toolbar.test.ts` or equivalent source/render test for exactly left `tasks/explorer/changes`, exactly right `tui/browser/inspector`, defaults, body activation, and no `RightPanelTabs`/`RightFilesPanel` imports.                                                                                                     |
| New TUI status/host test                                                                  | None yet for `TuiRuntimePanel`.                                                                                                                                               | If the placeholder remains, test that it visibly says embedded host is pending and does not masquerade as a terminal. For completion, replace with real terminal-host tests.                                                                                                                                                             |

## Target Architecture And Binding Model

## Follow-up 2026-06-23: Retire Stale Right Tab Body Class

### Recall

| Source                | Constraint carried forward                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| This spec             | Right horizontal tabs were replaced by side activity toolbar controls; old right-tab meanings must not be kept as compatibility mappings. |
| Sagan read-only audit | Active DOM/CSS still uses `.sections-tab-body`, preserving the old tab vocabulary after `RightPanelTabs` was deleted.                     |
| `AGENTS.md`           | No fallback/compat classes; replace old sources directly and test the absence of stale contracts.                                         |

### Call Point Inventory

| Call point                            | Current evidence                                                                       | Decision                                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/index.html`                      | `#rightPanelInspector` and `#rightPanelNotifications` use `class="sections-tab-body"`. | Rename both to `right-activity-body`.                                                         |
| `src/styles/surfaces/inspector.css`   | Four selectors target `.sections-tab-body[...]`.                                       | Rename selectors to `.right-activity-body[...]`; do not keep an alias.                        |
| `overlay-architecture-guards.test.ts` | Guards old class ownership and old tab selector absence.                               | Update ownership to the activity body class and assert the old class is absent from HTML/CSS. |
| `right-panel-tabs-flat.test.ts`       | Guards removed horizontal tab mount/selectors.                                         | Add a no-`sections-tab-body` assertion so the stale tab vocabulary cannot return.             |

### Root Cause

The functional right-tab component was removed, but the right activity body kept
the old `.sections-tab-body` class. That keeps tests and CSS vocabulary tied to
a retired interaction model and makes future right activity work look like it
still has a tab body layer.

### Fix Plan

1. Replace `.sections-tab-body` with `.right-activity-body` in DOM and CSS.
2. Update architecture tests to make the new class the CSS owner.
3. Add explicit absence checks for the stale class in HTML and CSS.
4. Run focused static tests, side activity browser visual QA, typecheck,
   self-review, commit, and push.

### Acceptance

- No production HTML/CSS uses `.sections-tab-body`.
- The active right inspector/notifications bodies still toggle through
  `data-side-activity` and `data-active`.
- Browser visual QA confirms the right activity toolbar and inspector/
  notifications layout still render correctly.

### Browser Test Finding: Center Workbench Keyboard Resize Refresh

While running the side activity browser test for this rename, the separator
keyboard resize assertion failed: `ArrowLeft` reached a focused separator but
the panel widths stayed unchanged after the pointer resize state. The root cause
is in the center workbench weight write path, not in the renamed right activity
body class. `updateCenterWorkbenchPanelWeights()` is the single writer for
pointer and keyboard resize weights, but it only writes settings; keyboard
resize relies on a store effect to schedule layout. The fix is to schedule the
existing `renderCenterWorkbenchPanelLayoutOnFrame` from that single writer so
pointer and keyboard paths share one post-write render owner.

Additional acceptance:

- `updateCenterWorkbenchPanelWeights()` schedules the existing center workbench
  layout frame owner after writing weights.
- Separator keyboard resize changes visible panel widths in the real browser
  side activity test.

### Verification

- PASS: `bun test packages/overlay/test/right-panel-tabs-flat.test.ts packages/overlay/test/overlay-architecture-guards.test.ts --timeout 30000`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/side-activity-toolbar-browser.test.ts`.
- PASS: `bun test packages/overlay/test/resize-observer-frame-scheduler.test.ts --timeout 30000`.
- Visual QA reviewed:
  `.scratch/side-activity-toolbar-illegal-narrow-legal-frame.png`.

### Self Review

- Rechecked production source: `.sections-tab-body` is absent from
  `packages/overlay/src/**`; the remaining occurrences are historical recall
  text and explicit no-regression assertions.
- Rechecked right activity behavior: inspector and notifications still use
  `data-side-activity` and `data-active` on `#rightPanelInspector` and
  `#rightPanelNotifications`.
- Rechecked keyboard resize fix: `updateCenterWorkbenchPanelWeights()` remains
  the single center workbench weight writer and now schedules the existing
  `renderCenterWorkbenchPanelLayoutOnFrame` owner after writing.

### One Activity Registry Per Side

Use one registry per side as the source for toolbar items and body activation:

```ts
type LeftActivityID = "tasks" | "explorer" | "changes"
type RightActivityID = "tui" | "browser" | "inspector"

interface SideActivity<T extends string> {
  id: T
  icon: IconName
  labelKey: string
  bodyId: string
}
```

Target registries:

| Side  | ID          | Label key               | Icon                      | Body ID               | Mount/binding                                            |
| ----- | ----------- | ----------------------- | ------------------------- | --------------------- | -------------------------------------------------------- |
| left  | `tasks`     | `sidebar.title`         | `goals` or task-list icon | `leftPanelTasks`      | existing `TaskList` in `taskListPanel`                   |
| left  | `explorer`  | `explorer.title`        | `folder`                  | `leftPanelExplorer`   | `FileExplorerPanel active={leftActivity==="explorer"}`   |
| left  | `changes`   | `section.files`         | `file-document`           | `leftPanelChanges`    | `FileChangesPanel`                                       |
| right | `tui`       | `tui.title`             | `terminal`                | `rightPanelTui`       | real embedded TUI host when available                    |
| right | `browser`   | `browser_preview.title` | `inspect`                 | `rightPanelBrowser`   | `BrowserPreviewPanel active={rightActivity==="browser"}` |
| right | `inspector` | `sections.title`        | `panel-right`             | `rightPanelInspector` | existing `Board` stack                                   |

Defaults:

- `DEFAULT_LEFT_ACTIVITY = "tasks"`
- `DEFAULT_RIGHT_ACTIVITY = "tui"`

Do not keep `RightPanelTabs`, `rightPanelTab`, old `files/explorer/assistant` right-tab meanings, or any compatibility mapping from old right tabs to new activities.

### Panel Binding Rules

- Moving a panel between side shells must not change its data source.
- File explorer remains file-route backed.
- File changes remains board/diff/agent-file-evidence backed.
- Browser preview remains task-scoped backend preview target/capture backed.
- Inspector remains board/card-tree backed.
- File editor and workspace diff remain center workspace surfaces.
- TUI default requires an embedded terminal host backed by the canonical OpenTUI process. A status-only placeholder is not a completed TUI panel.

### Collapse And Resizing

Keep `services/pane.ts` as the single resizer source. Side activity toolbars are fixed navigation rails inside the left/right side containers:

- Collapsing a side hides or shrinks only the content pane.
- Toolbar icons remain visible and clickable.
- Resizer handles remain disabled while collapsed.
- Clicking an activity while collapsed may expand the content pane, but that must be one explicit behavior, not a fallback chain.

## Implementation Plan

1. Re-run targeted grep before coding because the worktree is already in-flight:
   - `RightPanelTabs|RightFilesPanel|rightPanelTab|solidRightPanelTabs|solidRightFilesMount`
   - `solidLeftActivityToolbar|solidRightActivityToolbar|leftActivity|rightActivity`
   - `activity.left|activity.right|tui.`
   - `sections-tabs|right-tab|data-panel-tab|side-activity`
2. Finish source single-source cleanup:
   - Keep `SideActivityToolbar`, `FileChangesPanel`, and `TuiRuntimePanel` only if they are intentional.
   - Delete all active references to deleted `RightPanelTabs` and `RightFilesPanel`.
   - Derive activity titles/body activation from the registry instead of separate hand-maintained maps where practical.
3. Complete i18n:
   - Add `activity.left`, `activity.right`, `tui.title`, `tui.runtime_error`, `tui.runtime_running`, `tui.runtime_stopped`, `tui.runtime_mode`, `tui.runtime_url`, `tui.runtime_session`, and `tui.embedded_host_pending` in both locales.
4. Complete CSS:
   - Add shared side activity toolbar/body layout styles in one surface source.
   - Replace old right horizontal tab CSS in `inspector.css`.
   - Add left explorer/changes body sizing and overflow rules.
   - Preserve browser preview, file explorer, file changes, and inspector internal CSS.
5. Resolve TUI host honestly:
   - If embedded TUI host work is not implemented, keep the right default as TUI but label it pending in tests/spec and do not claim final product acceptance.
   - For completion, implement the host from `right-sidebar-opencode-tui-copy-implementation-plan-2026-06-04.md`: server PTY process, terminal events, input, resize, close, snapshot, and a mature renderer such as `ghostty-web`.
6. Update unit/source tests in the same implementation PR.
7. Add Playwright/E2E visual tests using the existing Node browser sidecar in `packages/overlay/test/launch.ts`. Do not launch Playwright through Bun on Windows.
8. Run focused verification:
   - `bun test --timeout 120000 packages/overlay/test/acceptance-panel-mount.test.ts packages/overlay/test/file-explorer-editor.test.ts packages/overlay/test/browser-preview-panel.test.ts`
   - `bun test --timeout 120000 packages/overlay/test/titlebar-menubar.test.ts packages/overlay/test/pane-collapse-layout.test.ts packages/overlay/test/pane-collapse-rail.test.ts`
   - `bun run --cwd packages/overlay check:i18n`
   - `bun run --cwd packages/overlay typecheck`

## Test Plan

### Unit And Source Tests

- Assert old horizontal right tabs are gone:
  - no `RightPanelTabs.tsx`
  - no `rightPanelTab`
  - no `#solidRightPanelTabs`
  - no `data-ui="right-tab"`
  - no old `#rightPanelFiles`, `#rightPanelExplorer`, `#rightPanelAssistant`
- Assert left activity shell:
  - `#solidLeftActivityToolbar`
  - three left activity buttons: `tasks`, `explorer`, `changes`
  - default `leftActivity()` is `tasks`
  - only `#leftPanelTasks` is active on first render
  - explorer click activates only `#leftPanelExplorer`
  - changes click activates only `#leftPanelChanges`
- Assert right activity shell:
  - `#solidRightActivityToolbar`
  - three right activity buttons: `tui`, `browser`, `inspector`
  - default `rightActivity()` is `tui`
  - only `#rightPanelTui` is active on first render
  - browser click activates only `#rightPanelBrowser`
  - inspector click activates only `#rightPanelInspector`
- Assert panel bindings:
  - `FileExplorerPanel` still calls `file` and `find/file`.
  - `FileExplorerPanel` still gates load/refresh by `active`.
  - `FileChangesPanel` renders `ChangesPanel` and `DiffPreviewPanel`.
  - `ChangesPanel` still calls `resolveDiff` and `window.openWorkspaceDiff`.
  - `openWorkspaceDiff` selects left `changes` and opens center workspace.
  - `acceptance:focus-changes` selects left `changes` and resets file changes internal view.
  - `BrowserPreviewPanel` still uses `task/{taskID}/browser-preview`, `/target`, and `/capture`.
  - `BrowserPreviewPanel` is active-gated by `rightActivity() === "browser"`.
  - `FileEditorPane` remains mounted at `#solidFileEditorMount`.
- Assert i18n:
  - all `activity.*` and `tui.*` keys used in source exist in both locales.
- Assert CSS ownership:
  - side activity toolbar/body selectors exist in exactly one intended surface source.
  - old right tabs selectors are absent except in retired docs/specs.
  - collapse selectors keep toolbar visible and hide content bodies.

### Playwright/E2E Tests

Use `packages/overlay/test/launch.ts`, which spawns the browser through Node (`node.exe` on Windows) instead of launching Playwright through Bun.

Required E2E coverage:

- Load overlay and verify default visible side panels:
  - left toolbar visible
  - left tasks body visible
  - right toolbar visible
  - right TUI body visible
  - no horizontal right tab strip
- Click left toolbar icons:
  - tasks/explorer/changes each shows exactly its bound body
  - file explorer can render without overlapping center chat
  - file changes can open center diff without switching right activity
- Click right toolbar icons:
  - TUI/browser/inspector each shows exactly its bound body
  - browser preview still loads task-scoped target through API route stubs
  - inspector board remains visible when selected
- Collapse/expand:
  - collapsing left/right leaves toolbar icons visible
  - content body is hidden or width-collapsed
  - resizer handles are disabled while collapsed
  - expanding restores content and active body
- Responsive geometry:
  - desktop wide viewport has no overlap across left toolbar, left content, chat, right content, right toolbar
  - narrow viewport has no text overflow from toolbar labels, since labels should be visually hidden or constrained
- TUI acceptance:
  - If only `TuiRuntimePanel` exists, E2E must assert it is a pending/status placeholder and mark embedded TUI acceptance incomplete.
  - Once host exists, E2E must assert terminal renderer pixels are nonblank, input can be sent, resize is observed, and runtime errors are visible.

## Risks

| Risk                                                  | Severity | Evidence                                                                                                                                                          | Mitigation                                                                                                                              |
| ----------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Embedded right-side TUI host does not actually exist  | High     | `TuiRuntimePanel` only polls status; `Tui.spawn()` launches external terminal windows; no `/tui/host/*` routes.                                                   | Treat real TUI host as a prerequisite for final acceptance. Do not use `CodingAssistantPanel` or a static status panel as TUI fallback. |
| CSS is behind DOM/state                               | High     | New `side-activity-*` classes appear in DOM/components but not CSS; `inspector.css` still styles `.sections-tabs` and `[data-ui="right-tab"]`.                    | Replace right-tab CSS and add side activity CSS before visual acceptance.                                                               |
| Tests are stale and read deleted files                | High     | `acceptance-panel-mount`, `file-explorer-editor`, `browser-preview-panel`, and `coding-assistant-panel` still read `RightPanelTabs.tsx` or `RightFilesPanel.tsx`. | Update tests in the same implementation pass.                                                                                           |
| I18n keys missing                                     | Medium   | Source uses `activity.left`, `activity.right`, and `tui.*`; locale files do not contain them.                                                                     | Add keys and run `check:i18n`.                                                                                                          |
| Duplicate activity metadata                           | Medium   | `main.tsx` currently has activity arrays plus separate label maps plus hard-coded body maps.                                                                      | Collapse to one registry per side for ids/icons/labels/body IDs.                                                                        |
| Collapse semantics may regress                        | Medium   | Existing collapse CSS hides task `.sidebar-body` and right `.sections-tab-body`; new layout needs toolbar persistence.                                            | Test collapse with Playwright and update CSS using pane service as single source.                                                       |
| Browser preview source could be weakened accidentally | Medium   | Preview uses task-scoped backend routes today.                                                                                                                    | Keep route-backed service; tests must reject local query/signal override or raw fetch/EventSource.                                      |
| Concurrent dirty worktree                             | Medium   | Relevant files changed during investigation.                                                                                                                      | Re-run grep and status before implementation; do not revert unrelated changes or use git reset.                                         |

## Review Checklist

- Left activities are exactly `tasks`, `explorer`, `changes`.
- Right activities are exactly `tui`, `browser`, `inspector`.
- Default left is `tasks`.
- Default right is `tui`.
- No horizontal right-panel tabs remain in source, CSS, or tests.
- No active source imports `RightPanelTabs` or `RightFilesPanel`.
- File explorer and file changes are left activities.
- Browser preview and inspector remain right activities.
- TUI body is either a documented pending status panel or a real embedded terminal host; it is never `CodingAssistantPanel`.
- File manager routes, diff routes, browser preview routes, and board/card-tree sources are unchanged.
- `acceptance:focus-changes` selects left file changes.
- Collapse keeps toolbar navigation visible.
- Unit tests and Playwright/E2E tests cover default, click selection, collapse, and panel bindings.
