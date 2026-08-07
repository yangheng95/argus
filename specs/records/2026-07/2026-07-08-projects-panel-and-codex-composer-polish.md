# 2026-07-08 Projects Panel And Codex Composer Polish

## Recall

| Item | Detail |
| --- | --- |
| User request | "把左侧的panel标题改成Projects，然后panel标题栏右侧用加号提供打开文件夹作为项目的能力。然后把输入框改成codex风格，不要低仿，要精致". The attached reference shows a rounded Codex-style composer with one continuous shell, embedded lower controls, and a round primary send action. |
| User follow-up | "输入框太丑了，要控制宽度和高度和圆角，然后确保空间不压线不越界"; then "把加载的图片和文件挪到输入窗口外面". |
| Acceptance criteria | Left panel title reads `Projects`; the title bar right side has a plus icon button that opens a folder as the active project through the existing project directory lifecycle; the composer becomes a refined Codex-style unified rounded input shell without replacing mature primitives; focused source tests, i18n checks, typecheck, docs link check, and browser screenshot review verify the change. |
| Hard constraints | No fallback, no compatibility alias, no second project directory source, no broad git reset, no new worktree, preserve unrelated dirty files, do not restart or refresh any running OpenCorvus or overlay window, use existing Button/Icon/SelectControl primitives, run Playwright through Node on Windows. |
| Sources read | `AGENTS.md`; `specs/README.md`; `specs/records/2026-07/README.md`; `specs/artifacts/tv2ainvest.md`; `specs/records/2026-07/2026-07-08-mission-task-chat-toolbar-consolidation-impact.md`; `specs/records/2026-07/2026-07-08-cwd-project-control-right-toolbar.md`; `specs/records/2026-07/2026-07-08-right-toolbar-runtime-status-panel-merge.md`; `packages/overlay/src/index.html`; `packages/overlay/src/main.tsx`; `packages/overlay/src/components/ChatComposer.tsx`; `packages/overlay/src/services/workspace.ts`; `packages/overlay/src/styles/surfaces/composer.css`; `packages/overlay/src/styles/surfaces/sidebar.css`; focused overlay tests. |
| Existing dirty worktree | Before this task, `git status --short` already showed modifications in `packages/overlay/src/components/Icon.tsx`, `packages/overlay/src/components/WorkLedger.tsx`, `packages/overlay/src/styles/surfaces/work-ledger.css`, `packages/overlay/test/work-ledger-consolidation.test.ts`, and July spec records. This task must not overwrite or revert those unrelated edits. |
| Whole-repository grep evidence | `rg -n "workLedgerPanel|WorkLedger|work_ledger|ledger|chat\\.panel_title|task\\.panel_title|coding_assistant\\.input_placeholder|chat-input|chat-textarea|ChatComposer|openDirectory\\(|setDirectory\\(|WorkspaceOnboarding|project\\.title|cwd\\." packages/overlay/src packages/overlay/test`; `rg -n "openProject|browseDirectory|pickDirectory|setDirectory\\(|applyDirectory\\(|openDirectory\\(" packages/overlay/src packages/overlay/test packages/opencorvus/src packages/opencorvus/test`; `rg -n "chat-input|chat-textarea|composer-mode-select|expert-squad-select|composer-attachment|chat-send|solidChatComposer|work_ledger\\.title|sidebar-header" packages/overlay/src packages/overlay/test specs/current specs/records/2026-07`; `rg -n "Plus|\\\"plus\\\"|plus|Add|\\\"add\\\"|CirclePlus|SquarePlus" packages/overlay/src/components/Icon.tsx packages/overlay/src`. |
| Independent agent feedback | Not spawned because the current request did not ask for sub-agents and the available tool policy limits delegation. The main-agent review will include focused source tests and screenshot inspection. |

## Evidence Summary

- `packages/overlay/src/index.html` owns the left panel header markup and still points `leftPanelTitle` at `work_ledger.title`.
- `packages/overlay/src/main.tsx` mounts `WorkLedger` into `workLedgerPanel`; no left toolbar remains.
- `packages/overlay/src/services/workspace.ts` already exposes `browseDirectory()`, which uses `pickDirectory(activeDirectory())`, then `setDirectory(selected)`, then `applyDirectory(..., save: true)` to refresh project scope and recent directories.
- `packages/overlay/src/components/titlebar/TitlebarMenubar.tsx` already uses `browseDirectory()` for the menu-driven folder switch path, so the panel plus button can reuse the same lifecycle.
- `packages/overlay/src/components/ChatComposer.tsx` already uses real textarea, Button, SelectControl, and attachment input primitives. The refinement should be CSS and minimal markup only.
- `packages/overlay/src/styles/surfaces/composer.css` is the single owner for `.chat-input`, `.chat-textarea`, `.chat-compose-row`, selectors, attachment buttons, and send button chrome.

## Design Decision

1. Rename `work_ledger.title` to `Projects` in both locale catalogs and keep the existing `data-i18n="work_ledger.title"` key so the Work Ledger remains the single left panel list owner.
2. Add a new Solid mount `solidLeftPanelActions` beside the left panel title. Render one Button primitive with `Icon name="plus"` and `data-ui="left-panel-open-project"`.
3. The plus button calls `browseDirectory()` through `runMainAsync("projects.open-folder", ...)`. It does not implement a new picker, recent list, hidden cwd popup, or a second directory store.
4. Keep previous project-group cwd popup removal intact. The new open-project affordance lives at panel level, not per project group.
5. Restyle the composer as a single rounded shell:
   - outer `.chat-input` carries the rounded border, background, subtle shadow, and focus ring;
   - `.chat-textarea` becomes visually integrated with transparent border/background while staying the real textarea;
   - send/stop Button remains the primitive but becomes a compact circular embedded action;
   - mode/expert-squad SelectControl triggers and attachment buttons become quiet chips inside the same shell;
   - existing drag/drop, resize, keyboard submit, attachments, and Kobalte select semantics remain unchanged.

## Implementation Plan

1. Update `index.html` with `solidLeftPanelActions` and visible fallback copy `Projects`.
2. Import `browseDirectory` in `main.tsx`, mount the left panel action Button, and preserve the debug double-click handler on `.sidebar-title`.
3. Update `en-US.json` and `zh-CN.json` for `work_ledger.title` and add an explicit `work_ledger.open_project` label.
4. Update `sidebar.css` for the header plus button.
5. Update `composer.css` to the Codex-style single-shell visual while preserving existing selectors and test-owned single-source rules.
6. Update focused tests for the Projects title, panel plus button, project open lifecycle, and composer style contract.
7. Run focused unit/source tests, typecheck, i18n check, docs link check, `git diff --check`, then a Node Playwright screenshot review on an isolated page.

## Verification Plan

```powershell
bun test packages/overlay/test/left-activity-toolbar.test.ts packages/overlay/test/work-ledger-consolidation.test.ts packages/overlay/test/mission-html-entry.test.ts packages/overlay/test/workspace-composer-density.test.ts packages/overlay/test/chat-input-flat.test.ts packages/overlay/test/chat-textarea-single-source.test.ts packages/overlay/test/composer-file-loader-right-toolbar.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
git diff --check
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/chat-composer-button-primitives.test.ts
```

Visual review must inspect the generated screenshot and confirm:

- left panel header reads `Projects`;
- the header plus button is visible, right aligned, and visually integrated;
- the composer reads as one polished Codex-style rounded input shell rather than a flat block plus detached send button;
- embedded controls do not overlap, truncate badly, or lose focus visibility.

## Addendum: Attachments Outside Input Shell

### Recall

- Current user request: loaded image/file attachment chips must move outside the input window.
- Current evidence: `ChatComposer.tsx` renders `<div class="chat-attachments" id="chatAttachments">` inside `<form class="chat-input">`, above the resize handle and textarea row.
- Constraint: the move must not create a second attachment source. The chips still render from `attachments()` and the remove button still calls `removeAttachment(index())`.
- Constraint: drag/drop/paste/file/folder loaders must keep the existing attachment pipeline and acceptance predicate.

### Design

1. Add one outer `.chat-composer-stack` wrapper around the attachment strip and the form.
2. Move the attachment strip before `<form class="chat-input">`, so loaded images/files are visually outside the rounded input shell.
3. Keep the form as the submit/drop/resize owner; only the visual placement of already-loaded attachments changes.
4. Move shared composer width variables to `.chat-composer-stack`, then let `.chat-input` and `.chat-attachments` consume that single geometry source.
5. Update tests and browser screenshot fixture to assert attachments are siblings before the form, aligned to the composer width, and do not overlap or sit inside `.chat-input`.

### Verification Delta

```powershell
bun test packages/overlay/test/composer-attach-store-integration.test.ts packages/overlay/test/workspace-composer-density.test.ts packages/overlay/test/chat-input-flat.test.ts packages/overlay/test/overlay-architecture-guards.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/chat-composer-button-primitives.test.ts
```

## Addendum: Projects Header Icon Semantics

### Recall

- Current user request: "icon要深思熟虑，不要粗制滥造".
- Current evidence: `main.tsx` renders `<Icon name="plus" size={14} />` for `data-ui="left-panel-open-project"`.
- Constraint: the action opens a folder as a project, so the visual affordance must carry folder/project semantics, not only a generic add glyph.
- Constraint: `lucide-solid@1.17.0` is the existing mature icon source, but local evidence found no `FolderPlus` export in that version.
- Constraint: keep the Icon primitive as the only icon rendering source; no inline SVG in `main.tsx`.

### Design

1. Add a `project-add` icon name to `Icon.tsx` as a product-specific custom glyph: folder outline plus a small integrated add mark.
2. Keep stroke-only, `currentColor`, round caps/joins, and the existing 16x16 viewbox so it aligns with the local icon system.
3. Replace the left panel `plus` callsite with `project-add`; do not change the `browseDirectory()` lifecycle or i18n label.
4. Update source tests to assert the semantic icon name is used for the Projects header action.

## Addendum: Overlay Icon Audit

### Recall

- Current user request: "全部overlay UI icon都要审查，不要粗制滥造".
- Current grep evidence:
  - `rg -n "displayToolIcon\\(" packages/overlay/src packages/overlay/test -S` found production consumers in `CardHeader.tsx`, `InlineToolPart.tsx`, `card-tree-stats.ts`, `card-tree.ts`, and `tool.ts`.
  - `rg -n 'Icon name="plus"|icon="plus"' packages/overlay/src packages/overlay/test -S` found only settings add/install controls after the Projects header change. Those callsites carry add/install copy or titles and can remain a generic plus affordance.
  - `rg -n "<svg|lucide-solid|[📄✏️📝💻🔍📂🤖☑️⚡]" packages/overlay/src packages/overlay/test -S` found the only source-level UI regression in `displayToolIcon()`: tool cards returned emoji/text glyphs instead of registered overlay icons.
- Existing icon system: `Icon.tsx` is the single JSX icon primitive, `iconHtml()` is the single installed string-template utility, and `flat-redesign-icon-coverage.test.ts` already guards inline SVG and character-icon regressions for components.
- Constraint: do not introduce another icon registry or import lucide directly outside `Icon.tsx`.

### Design

1. Replace `displayToolIcon(name): string` with `displayToolIconName(name): IconName`, backed by the existing `IconName` union in `Icon.tsx`.
2. Update `ToolDisplayModel.icon` to be an `IconName` and propagate that type through card tree preview, cached stats, inline tool chips, and session dialog rendering.
3. Render tool chip/card icons with `<Icon name={...} />` in Solid components and with `iconHtml(display.icon, ...)` in string-template dialog flows.
4. Keep collapsed text previews readable without character icons by formatting them as `<ToolName>: <detail>`.
5. Expand icon coverage tests so emoji-based tool icon regressions and direct `displayToolIcon()` callsites fail.

## Addendum: Composer Height And Unified Bottom Toolbar

### Recall

- Current user request: "默认的输入框太高了，而且发送按钮跟其他按钮为什么不放到一行？" followed by "先修UI".
- Screenshot evidence: the current composer presents a tall rounded shell; the send action floats on the textarea row while chat mode, expert-squad selector, file loader, and folder loader sit on a lower row.
- Code evidence: `composer.css` sets `--chat-composer-min-height: calc(118px * var(--ui-scale));` and `--chat-textarea-height: calc(72px * var(--ui-scale));`; `ChatComposer.tsx` renders the send/stop `Button` inside `.chat-compose-row` while loader buttons render inside `.chat-compose-meta`.
- Constraint: keep the existing real `Button`, `SelectControl`, textarea, attachment input, folder input, drag/drop, resize, Enter-submit, and stop semantics. Do not introduce a second composer state source or hand-rolled SVG/icon button.

### Design

1. Make the default composer shell materially shorter by lowering the shell floor and textarea floor from the current 118/72px pair.
2. Let `.chat-compose-row` own only the textarea surface.
3. Move the send/stop `Button` into a new `.chat-compose-meta-right` cluster beside the file and folder loader buttons, so all actions share the same bottom toolbar baseline.
4. Keep attachments outside the input shell and keep loader controls inside the toolbar.
5. Add layout assertions that the send action shares the meta row with attachment loaders, the shell height stays compact, and controls remain inside the rounded boundary without overlap.

### Verification Delta

```powershell
bun test packages/overlay/test/workspace-composer-density.test.ts packages/overlay/test/chat-input-flat.test.ts packages/overlay/test/chat-textarea-single-source.test.ts packages/overlay/test/composer-file-loader-right-toolbar.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/chat-composer-button-primitives.test.ts
```
