# Overlay Titlebar Settings Refactor Plan - 2026-05-02

## Original Problem

The overlay currently exposes configuration through several unrelated surfaces:

- `packages/overlay/src/components/TitlebarMenu.tsx` owns language, theme, server config, logs, auto-question, task budget, and opacity.
- `packages/overlay/src/index.html` keeps `#llmSection`, `#extensionsSection`, and `#btnConfigToggle` pinned at the bottom of the right inspector column.
- `packages/overlay/src/index.html` also keeps a separate `#settingsDialog` for server URL, password, and username.
- `packages/overlay/src/index.html` keeps the larger `#configDialog` with General, Permissions, Prompts, Channel, Memory, Providers, Agent Models, and About tabs.
- `packages/overlay/src/services/dialog.ts` imperatively rewrites `#brandVersion` for channel status and opens channel settings from the titlebar.

This creates a split mental model: core runtime controls live in the titlebar, model/provider controls live in the right inspector, deep settings live in a modal, and server settings live in a second modal. The operator has to remember where a setting belongs instead of scanning a single product-level control area.

## Implementation Status

Status as of 2026-05-02: implemented and pushed on `codex/opencode-upstream-infra-adapt`.

- `TitlebarMenu.tsx`, `services/llm-inline.ts`, `#llmSection`, `#extensionsSection`, `#btnConfigToggle`, and `#settingsDialog` were removed from the overlay runtime.
- `TitlebarMenubar.tsx` is the titlebar configuration entry point for Workspace, Model, Run, Tools, View, and Help.
- `GeneralPanel` owns connection and notification settings only; View owns theme, locale, zoom, and opacity writes.
- `SkillMarketPanel` is mounted in the real config-dialog `tools` tab, and Tools menu routes to that tab.
- Provider/model setup routes through Model menu into the Providers and Agent Models tabs; no inline LLM double writer remains.
- Browser tests now run against the Vite `dist-vite` bundle through `packages/overlay/test/overlay-dist.ts`, so runtime import and hydration errors surface in the harness.
- Residual sweep on 2026-05-02 removed dead `dom.ts` refs for deleted settings, Skill/MCP, and channel dialogs, and added regression coverage that Tools opens the real Skills/MCP tab.

## 2026-05-02 Follow-Up: Left Titlebar Gateway

Status: implemented in this session.

- The titlebar menu mount moved from the right action cluster into the left product cluster, next to the OpenCorvus mark. Window controls remain the only persistent right-edge controls.
- The brand remains the left anchor; narrow viewports collapse the visible brand text while keeping the logo, connection status dot, setup CTA, menu triggers, and window controls inside bounds.
- Connection port and PID are no longer rendered as visible titlebar copy. They remain in the connection badge `title` and `aria-label`, so the chrome stays quiet while hover/accessibility text still carries runtime diagnostics.
- Help > Connection Diagnostics routes to the About runtime grid, where the server URL and PID are visible without adding persistent titlebar text.
- Cold start now uses a single startup project picker backed by `settingsStore.directory` and the existing `services/workspace.ts` directory switching path. The picker offers recent projects, open folder, and new folder without creating a second project state source.
- The old BoardIntro directory warning now points to the same workspace selection flow and exposes an open-folder action that calls `browseDirectory()`.
- Browser coverage now asserts left-side menu geometry, no visible port text, hover runtime text, compact setup CTA bounds, and the no-directory startup picker.

## Target

Move scattered configuration into a PyCharm / VS Code style titlebar command area, with the top-left titlebar as the only configuration entry point.

The titlebar should become:

```text
[OpenCorvus]  Workspace  Model  Run  Tools  View  Help                    [status] [window controls]
```

`OpenCorvus` remains the app identity and opens the product menu. The menu words are not decorative navigation; each word opens a compact menu containing the most-used settings and a link into the same full settings dialog for detailed editing.

The right inspector must stop owning global configuration. It should only inspect the selected task: spec, plan, goals, evaluation, delivery, files, and related task state.

## Design Principles

1. Single entry point: all app-level settings are reachable from the top-left titlebar.
2. Single source of truth: each setting reads from the existing owning store or server config. No local duplicate defaults and no compatibility shadow fields.
3. Progressive disclosure: common switches are inline menus; complex editors open the existing config dialog at the exact tab.
4. No right-column global chrome: the inspector is for task evidence, not app configuration.
5. Stable dimensions: titlebar menus must use fixed menu widths, ellipsis, and scrollable long panels so Chinese labels and model names cannot resize the titlebar.

## Glossary

- API: Application Programming Interface; overlay reads/writes backend data through the OpenCorvus HTTP API.
- CTA: Call To Action; an explicit button or link that routes the user to the one owning settings surface.
- DOM: Document Object Model; browser node tree currently targeted by old imperative selectors.
- ID: Identifier; in this plan it usually means a DOM `id` selector such as `#llmProvider`.
- IDE: Integrated Development Environment; PyCharm and VS Code are the interaction reference for titlebar menus.
- LLM: Large Language Model; provider/model configuration controls which model the agents call.
- MCP: Model Context Protocol; tool-server integrations listed with Skills in the overlay.
- SSE: Server-Sent Events; the streaming connection that keeps the overlay live.
- UI: User Interface.
- UX: User Experience.
- VS Code: Visual Studio Code.
- Tauri: the native desktop host used by the overlay.

## Review Corrections Before Implementation

The first implementation phase must resolve the P1 review findings before runtime code changes land:

1. Tools tab first, then right-column deletion. `SkillMarketPanel` currently mounts only under `#extensionsConfigBody`, so `#extensionsSection` cannot be deleted until the full config dialog has a real `tools` tab that mounts `SkillMarketPanel`.
2. No `llm-inline` double writer. The first implementation does not copy the old inline model/provider form into the titlebar. `ModelMenu` shows status and opens the existing Providers and Agent Models panels. The old `llm-inline.ts` path is deleted together with `#llmSection`; model/provider writes stay in the config dialog panels.
3. View owns appearance writes. Theme, locale, zoom, and opacity move to `ViewMenu`. `GeneralPanel` keeps connection and behavior settings only, so there is one writable surface for appearance.
4. First-run and offline CTAs stay visible. When provider/server setup blocks use, titlebar/status/banner CTAs route to `Model` or `General` settings. They are navigation affordances only and do not create another settings store.
5. Implementation follows the call-site inventory below. Any affected selector/function not listed there must be added before editing code.

## Information Architecture

### OpenCorvus Menu

Purpose: app-level identity, diagnostics, and global settings.

- About
- Open full Settings
- Open Logs
- Reload project scope
- Developer tools
- Quit / hide window when native host supports it

Implementation notes:

- Replace the current hover guide as the primary control. The quick guide can remain as a Help menu item, not as a brand hover card.
- Keep connection state visible beside the brand, but do not make it the settings entry.

### Workspace Menu

Purpose: project scope and working directory controls.

- Current directory
- Recent directories
- Browse directory
- Open directory in system shell / editor when host supports it
- Init Git toggle or action
- Workspace panel height / reset layout

Source of truth:

- `settingsStore.directory`
- `settingsStore.savedDirectory`
- `loadRecentDirectories()`
- `applyDirectory()`, `browseDirectory()`, `openDirectory()`
- `settingsStore.workspacePanelHeight`

Remove from old surfaces:

- The right-column global config toggle must no longer be the way to reach project settings.
- The task directory bar can stay because it is task context, but directory-changing affordances should be shared with the Workspace menu rather than duplicated ad hoc.

### Model Menu

Purpose: model/provider setup, because this is the configuration users need most while running agents.

- Active project model
- Provider quick switch
- API key status and connect/edit action
- Agent model overrides
- Open Providers tab
- Open Agent Models tab

Source of truth:

- `appStore.config.model`
- `appStore.config.provider`
- `appStore.executors`
- `components/settings/ProvidersPanel.tsx`
- `components/settings/AgentModelsPanel.tsx`
- `services/llm-inline.ts` behavior should be ported into a Solid component or removed with the old inline section.

Remove from old surfaces:

- Delete `#llmSection` from the right inspector.
- Remove `llmConfigBody`, `llmProvider`, `llmModel`, `llmApiKey`, `llmNotice`, and related imperative wiring once the Solid titlebar menu owns the same controls.

### Run Menu

Purpose: execution defaults for the next task. Active-task commands stay in task/composer context so the menu does not blur whether an action affects the selected task or future tasks.

- Executor selector
- Per-executor model quick switch
- Parallel goal limit
- Auto-question behavior
- Default permission profile shortcut

Source of truth:

- `settingsStore.executor`
- `/executor` data through `appStore.executors`
- `appStore.config.assistant.max_executor_groups`
- `appStore.config.experimental.auto_question`
- `settingsStore.toolPermissions`
- `boardStore.selectedTaskID` and active task status

Current titlebar contents to keep but regroup:

- `TitlebarMenu.tsx` already has max runs, max executor groups, and auto-question. These should move into the Run menu.
- `ExecutorSelector.tsx` currently lives in the composer. Keep it there for immediate send-context visibility. The first implementation leaves executor selection there and gives Run a read-only executor summary plus an action to focus the composer selector, avoiding a second writable executor surface.

### Tools Menu

Purpose: integrations and agent capability configuration.

- Channels
- Skills
- MCP servers
- Memory / task context
- Prompt catalog
- Permissions

Source of truth:

- Existing config dialog tabs and panels:
  - `ChannelsPanel`
  - `SkillMarketPanel`
  - `MemoryPanel`
  - `PromptCatalog`
  - `PermissionsPanel`

Remove from old surfaces:

- Add a real `tools` tab to `#configDialog`, mount `SkillMarketPanel` there, then delete `#extensionsSection` from the right inspector.
- Stop using `brandVersion` as the channel settings button. Channel status can become a small Tools menu badge.

### View Menu

Purpose: visual and layout settings.

- Theme segmented control
- Language toggle
- Zoom in / out / reset
- Opacity slider
- Toggle sidebar
- Toggle inspector
- Reset pane layout

Source of truth:

- `settingsStore.theme`
- `settingsStore.locale`
- `settingsStore.zoom`
- `settingsStore.opacity`
- `settingsStore.sidebarCollapsed`
- `settingsStore.sidebarWidth`
- `settingsStore.sectionsWidth`

Current titlebar contents to keep but regroup:

- Language, theme, and opacity currently live in `TitlebarMenu.tsx`; move them into View.
- Remove the matching appearance controls from `GeneralPanel` in the same implementation step. `GeneralPanel` keeps server connection and desktop-notification behavior only.

### Help Menu

Purpose: support, runtime facts, and diagnostics.

- About
- Open Logs
- Runtime info
- Connection diagnostics
- Keyboard shortcuts

Source of truth:

- Existing About panel data from `renderAboutVersion()`
- `LogViewer`
- `ConnectionBadge`
- `CommandPalette`

Diagnostics owner: Help owns About, Logs, Runtime Info, Connection Diagnostics, and Keyboard Shortcuts. The OpenCorvus menu owns app/window/project commands only.

## Component Plan

### 1. Replace `TitlebarMenu` With `TitlebarMenubar`

Create `packages/overlay/src/components/titlebar/TitlebarMenubar.tsx`.

Responsibilities:

- Render the menu labels in the titlebar.
- Own open/close focus behavior for menus.
- Use roving focus and Escape close.
- Ensure every interactive element has `data-no-drag="true"`.
- Never store config values locally except transient input edit buffers.

The current `TitlebarMenu.tsx` should be deleted after migration, not kept as a fallback.

### 2. Add Menu Sections as Small Solid Components

Create focused menu components:

- `ProductMenu.tsx`
- `WorkspaceMenu.tsx`
- `ModelMenu.tsx`
- `RunMenu.tsx`
- `ToolsMenu.tsx`
- `ViewMenu.tsx`
- `HelpMenu.tsx`

These components should import the existing stores/services directly. Avoid a central generic "menu renderer" until duplication is real; the shared abstraction should be limited to menu shell primitives:

- `TitlebarMenuRoot`
- `TitlebarMenuItem`
- `TitlebarMenuGroup`
- `TitlebarMenuRadioGroup`
- `TitlebarMenuSlider`

### 3. Keep the Full Config Dialog, but Make It a Detail Surface

`#configDialog` remains useful for dense forms. The change is entry ownership:

- Opening providers from Model calls `openConfigDialog("providers")`.
- Opening agent models from Model calls `openConfigDialog("agent-models")`.
- Opening permissions from Tools calls `openConfigDialog("permissions")`.
- Opening channels from Tools calls `openConfigDialog("channel")`.
- Opening skills or MCP from Tools calls `openConfigDialog("tools")`.

The old `#settingsDialog` should be removed. Server URL, username, and password already exist in `GeneralPanel`, so the second server dialog is a duplicate.

### 4. Remove Right Inspector Global Config

Delete these from `packages/overlay/src/index.html` after menu replacements exist and their owning config-dialog/menu targets are live:

- `#configArea`
- `#llmSection`
- `#extensionsSection`
- `#btnConfigToggle`
- `#settingsDialog`

Delete matching DOM references from:

- `packages/overlay/src/main.tsx`
- `packages/overlay/src/dom.ts`
- `packages/overlay/src/services/dialog.ts`
- `packages/overlay/src/styles.css`

This must be a direct replacement, not a hidden old path.

### 5. Move Channel Summary Out of `brandVersion`

Replace `brandVersion` mutation with a Solid component:

- `TitlebarStatusCluster.tsx`
- Shows connection, channel badge, and maybe active project model as compact read-only status.
- Clicking channel badge opens `Tools -> Channels` or `openConfigDialog("channel")`.

`renderChannelSummary()` should stop writing `brandVersion.innerHTML`. Channel data belongs in Solid state rendering, not imperative HTML string assembly.

The static `#brandVersion` element in `index.html`, the `brandVersion` click handler in `main.tsx`, and `fitBrandVersion()` in `services/window.ts` must be removed or replaced with a Solid-owned titlebar status mount in the same commit.

## Call-site Inventory

| Current selector / function | Current owner | Replacement decision |
| --- | --- | --- |
| `TitlebarMenu.tsx` | `main.tsx` mounts it at `#solidTitlebarMenu` | Delete after `TitlebarMenubar` replaces it. |
| `#btnTitlebarMenu`, `#titlebarMenu` | `TitlebarMenu.tsx`, `dom.ts`, `controls.test.ts`, `copy-actions.test.ts`, `menu-collapse.test.ts` | Replace with role-based menubar/menu targets plus stable `data-testid` values for tests. |
| `#btnLog` | `TitlebarMenu.tsx`, `copy-actions.test.ts` | Replace with Help menu "Logs" action; tests click the Help action and then `LogViewer` buttons. |
| `#llmSection`, `#llmProvider`, `#llmModel`, `#llmApiKey`, `#llmStatus`, `#llmNotice`, `#llmSummary`, `#cfgAvailableProviders` | `index.html`, `dom.ts`, `services/llm-inline.ts`, provider auth tests | Delete with `services/llm-inline.ts` import/install/refresh calls. Model writes stay in Providers and Agent Models config tabs. |
| `installInlineLlmConfig()`, `refreshInlineLlmConfig()` | `main.tsx`, `services/llm-inline.ts` | Delete calls and then delete `services/llm-inline.ts` if no imports remain. |
| `#extensionsSection`, `#extensionsConfigBody` | `index.html`, `main.tsx`, `styles.css` | Add `tools` tab in config dialog, mount `SkillMarketPanel` there, then delete old section and style. |
| `#btnConfigToggle`, `#configToggleMeta`, `#configArea` | `index.html`, `main.tsx`, `dom.ts`, provider tests, `services/dialog.ts` | Delete. Open config dialog only from titlebar menu actions and first-run/offline CTAs. |
| `#settingsDialog`, `#settingsForm`, server input IDs | `index.html`, `services/dialog.ts`, `dom.ts`, `main.tsx` | Delete duplicate server dialog and `installSettingsFormHandlers()`. GeneralPanel remains the only server settings editor. |
| `openServerSettings()` | `services/dialog.ts` | Delete if no imports remain; server settings route to `openConfigDialog("general")`. |
| `brandVersion`, `renderChannelSummary()`, `configToggleMeta` | `index.html`, `services/dialog.ts`, `main.tsx`, `dom.ts` | Replace with Solid titlebar status cluster; no `innerHTML` writes. |
| `fitBrandVersion()` | `services/window.ts`, indirect theme/window sizing comments | Delete if unused after `brandVersion` removal; titlebar status uses CSS ellipsis. |
| `GeneralPanel` appearance controls | `components/settings/GeneralPanel.tsx` | Remove theme/locale/opacity controls; ViewMenu is the sole writer for those settings. |
| Provider auth tests using old selectors | `provider-oauth.test.ts`, `provider-auth-panel.test.ts` | Rewrite to open Model/Providers and assert the new owning controls. |
| Hidden menu click tests | `menu-collapse.test.ts`, `controls.test.ts` | Rewrite to assert hidden menubar panels do not intercept inspector clicks. |

## Visual Specification

### Titlebar Layout

```text
left:
  brand button
  menu bar labels

center:
  draggable empty area

right:
  connection dot
  optional active model chip
  channel badge
  window controls
```

Menu dimensions:

- Menu label height: existing titlebar button height.
- Menu panel width: 280-360 px depending on content.
- Long provider/model names: one-line ellipsis with tooltip.
- Sliders: fixed right column width.
- Submenus: avoid nested flyouts in the first version; use grouped rows and "Open ..." actions.

### Interaction

- Click menu label opens the menu.
- Clicking another label switches the open menu.
- Escape closes.
- Outside click closes.
- Arrow left/right moves across menu labels.
- Arrow up/down moves inside the open menu.
- Menu panels must not block inspector clicks when hidden. Preserve and extend the existing `menu-collapse.test.ts` behavior.

### Responsive Behavior

When width is tight:

- Keep `OpenCorvus`, active menu label, and window controls.
- Collapse the full menu bar behind a single menu icon only below the breakpoint.
- The collapsed menu still uses the same menu components and source of truth.
- Priority order from most important to most disposable: window controls, active menu trigger, connection state, brand mark, menu labels, channel badge, model chip, long brand text.
- Test viewports: 320px, 480px, 600px, 760px, and 1440px in both `en-US` and `zh-CN`, with a long provider/model name.

## Migration Steps

1. Add titlebar menu shell primitives and `TitlebarMenubar` with no behavior changes except rendering the current titlebar menu items under grouped headings.
2. Move current `TitlebarMenu` controls into `ViewMenu` and `RunMenu`.
3. Move channel entry from `brandVersion` into `ToolsMenu`, then replace `renderChannelSummary()` with Solid status rendering.
4. Replace `#llmSection` with `ModelMenu` status/actions that open the single writable Providers and Agent Models tabs; delete the inline LLM section and related imperative DOM selectors.
5. Add a config-dialog `tools` tab, mount `SkillMarketPanel` there, then delete the right-column `#extensionsSection`.
6. Replace `#btnConfigToggle` with menu actions; delete `configArea`.
7. Remove `#settingsDialog`; route server settings to `openConfigDialog("general")`.
8. Remove `GeneralPanel` appearance controls after `ViewMenu` owns theme/locale/zoom/opacity.
9. Clean `dom.ts`, `main.tsx`, `styles.css`, and i18n keys for removed IDs/classes.
10. Run focused tests and visual verification.
11. Commit and push without bypassing hooks. Required gates: `bun run --cwd packages/overlay check:i18n`, focused overlay tests, `bun run --cwd packages/overlay build:vite`, root `bun run typecheck`, `bun run api:routes-check`, and `bun run docs:check`.

## Tests and Acceptance

Implemented test coverage:

- `packages/overlay/test/titlebar-menubar.test.ts`
  - Covers documented widths `320`, `480`, `600`, `760`, and `1440` in both `en-US` and `zh-CN`.
  - Verifies menu triggers render, the titlebar stays in bounds, visible controls do not overlap, and brand drag space remains present.
- `packages/overlay/test/menu-collapse.test.ts`
  - Opens and closes the new titlebar menu panel, then verifies hidden panels do not intercept inspector clicks.
- `packages/overlay/test/provider-oauth.test.ts` and `packages/overlay/test/provider-auth-panel.test.ts`
  - Open Providers through the Model menu instead of `#btnConfigToggle`.
  - Assert OAuth/API auth flows complete through the config dialog provider surface.
- `packages/overlay/test/controls.test.ts`
  - Exercises Help/View/Tools titlebar paths in the real Vite dist bundle.
  - Verifies Tools opens the real config-dialog `tools` tab and renders the Skills/MCP surface before the old right-column `#extensionsSection` can regress.
  - Verifies View changes theme, locale, zoom, and opacity through the existing stores.
- Static residual scans after implementation:
  - `#btnConfigToggle`, `#llmSection`, `#extensionsSection`, and `#settingsDialog` no longer appear in overlay source or browser tests.
  - `services/llm-inline.ts` and `TitlebarMenu.tsx` are deleted.

Visual acceptance:

- At 1440 px width, titlebar reads like an IDE menu bar and all global config starts from the left.
- At 760 px width, menu labels collapse without overlapping status badges or window controls.
- At 320/480/600/760 px widths, there is still draggable titlebar space and no overlap in both `en-US` and `zh-CN`.
- The right inspector no longer shows global config sections at its bottom.
- Provider/model setup is reachable in two clicks from the top-left titlebar.
- First-run or offline states show a visible CTA to Model or General settings.
- A new user can find theme/language/opacity under View without opening the full settings dialog.
- A user preparing the next task can find run budget under Run without scanning the right inspector; active stop/cancel remains task-local.

## Non-goals

- Do not redesign task cards, delivery, or file panels in this pass.
- Do not change backend config schema.
- Do not introduce a second settings persistence layer.
- Do not keep the old right-column config as a compatibility path.

## Risks

- Provider auth tests currently open settings through `#btnConfigToggle`; these need deliberate rewrites.
- `services/llm-inline.ts` is imperative and ID-heavy. Porting it poorly would preserve the same problem inside a menu. The correct fix is to move the behavior into Solid and then delete the DOM-ID path.
- Channel summary currently mutates `brandVersion.innerHTML`; this can conflict with Solid ownership if only partially migrated. Replace the whole surface at once.
- The titlebar is also the Tauri drag region. Every menu and control must opt out of dragging with `data-no-drag="true"` and must be included in `WindowControls.tsx` drag exclusion checks.
