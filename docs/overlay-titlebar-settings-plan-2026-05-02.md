# Overlay Titlebar Settings Refactor Plan - 2026-05-02

## Problem

The overlay currently exposes configuration through several unrelated surfaces:

- `packages/overlay/src/components/TitlebarMenu.tsx` owns language, theme, server config, logs, auto-question, task budget, and opacity.
- `packages/overlay/src/index.html` keeps `#llmSection`, `#extensionsSection`, and `#btnConfigToggle` pinned at the bottom of the right inspector column.
- `packages/overlay/src/index.html` also keeps a separate `#settingsDialog` for server URL, password, and username.
- `packages/overlay/src/index.html` keeps the larger `#configDialog` with General, Permissions, Prompts, Channel, Memory, Providers, Agent Models, and About tabs.
- `packages/overlay/src/services/dialog.ts` imperatively rewrites `#brandVersion` for channel status and opens channel settings from the titlebar.

This creates a split mental model: core runtime controls live in the titlebar, model/provider controls live in the right inspector, deep settings live in a modal, and server settings live in a second modal. The operator has to remember where a setting belongs instead of scanning a single product-level control area.

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

Purpose: execution behavior for the next task or active task.

- Executor selector
- Per-executor model quick switch
- Max execution runs
- Parallel goal limit
- Auto-question behavior
- Default permission profile shortcut
- Stop / cancel active task when a task is running

Source of truth:

- `settingsStore.executor`
- `/executor` data through `appStore.executors`
- `appStore.config.assistant.max_runs`
- `appStore.config.assistant.max_executor_groups`
- `appStore.config.experimental.auto_question`
- `settingsStore.toolPermissions`
- `boardStore.selectedTaskID` and active task status

Current titlebar contents to keep but regroup:

- `TitlebarMenu.tsx` already has max runs, max executor groups, and auto-question. These should move into the Run menu.
- `ExecutorSelector.tsx` currently lives in the composer. Keep it there for immediate send-context visibility, but also expose the same selector in Run. Both must write to `settingsStore.executor` and backend executor model APIs.

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

- Delete `#extensionsSection` from the right inspector.
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

The old `#settingsDialog` should be removed. Server URL, username, and password already exist in `GeneralPanel`, so the second server dialog is a duplicate.

### 4. Remove Right Inspector Global Config

Delete these from `packages/overlay/src/index.html` after menu replacements exist:

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

## Migration Steps

1. Add titlebar menu shell primitives and `TitlebarMenubar` with no behavior changes except rendering the current titlebar menu items under grouped headings.
2. Move current `TitlebarMenu` controls into `ViewMenu` and `RunMenu`.
3. Move channel entry from `brandVersion` into `ToolsMenu`, then replace `renderChannelSummary()` with Solid status rendering.
4. Port `#llmSection` behavior into `ModelMenu`; delete the inline LLM section and related imperative DOM selectors.
5. Move `#extensionsSection` entry into `ToolsMenu`; delete the right-column extensions section.
6. Replace `#btnConfigToggle` with menu actions; delete `configArea`.
7. Remove `#settingsDialog`; route server settings to `openConfigDialog("general")`.
8. Clean `dom.ts`, `main.tsx`, `styles.css`, and i18n keys for removed IDs/classes.
9. Run focused tests and visual verification.

## Tests and Acceptance

Add or update tests:

- `packages/overlay/test/titlebar-menubar.test.ts`
  - Menu labels render in titlebar.
  - Hidden menus do not intercept clicks.
  - Model menu opens the config dialog on Providers and Agent Models actions.
  - Tools menu opens Permissions, Channels, Skills, Memory, and Prompts tabs.
  - View menu changes theme, locale, zoom, and opacity through existing stores.
  - Run menu changes assistant budget through `patchConfig`.

- Update existing tests:
  - `menu-collapse.test.ts`: target the new menu panel IDs.
  - `provider-oauth.test.ts` and `provider-auth-panel.test.ts`: open Providers via Model menu instead of `#btnConfigToggle`.
  - Any tests using `#btnConfigToggle`, `#llmSection`, `#extensionsSection`, or `#settingsDialog` must be rewritten and then those IDs should disappear from overlay source.

Visual acceptance:

- At 1440 px width, titlebar reads like an IDE menu bar and all global config starts from the left.
- At 760 px width, menu labels collapse without overlapping status badges or window controls.
- The right inspector no longer shows global config sections at its bottom.
- Provider/model setup is reachable in two clicks from the top-left titlebar.
- A new user can find theme/language/opacity under View without opening the full settings dialog.
- A running-task user can find executor and run budget under Run without scanning the right inspector.

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
