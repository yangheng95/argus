# Composer File Loader And Right Toolbar Hover

Date: 2026-07-08
Status: Complete
Owner: Codex

## Recall

### User Request

The user asked to add a component below the input box for loading supported files such as documents and images, and to change the right toolbar so it only shows on hover.

### Acceptance Criteria

- Composer exposes visible file and folder loading controls below the textarea/send row in the same single meta row as the mode and expert-squad controls.
- File and folder loading controls sit on the right side of the meta row; mode and expert-squad controls stay on the left.
- File loading reuses the existing composer attachment pipeline (`addAttachment`, `messageStore.chatAttachments`, existing size checks), without a second upload protocol or fallback store.
- Folder loading uses the browser folder picker on the existing hidden file input path; selected files still become ordinary attachments, with safe display filenames derived from `webkitRelativePath`.
- Supported file selection is explicit through the file input accept contract for images, PDFs, text, markdown, JSON, CSV, office documents, archives, and common code/config files.
- The right toolbar remains the same DOM owner (`solidRightActivityToolbar`), but it must not reserve layout width at rest. It starts as a zero-width flex item with a right-edge hover target, and only expands to `var(--ui-collapsed-pane-width)` on hover or keyboard focus.
- Hover/focus behavior must keep keyboard accessibility and existing right toolbar actions.
- Frontend validation must include focused unit/source tests and an isolated browser screenshot check.

### User Revision

After the first implementation placed the file loader on its own line above the mode/expert-squad row, the user clarified: "做成一行，别做成几行". The accepted layout is therefore one row below the input: file loader, mode selector, and expert-squad selector share the same `chat-compose-meta-left` grid row.

After the single-row revision put the file button on the left, the user clarified: "添加文件和文件夹放到右侧才顺手，不要不动脑子". The accepted layout is therefore one row below the input with mode/expert-squad on the left and file/folder attachment actions right-aligned.

After the compact shell revision made the bottom controls too faint, the user clarified the target: "我让你给下面的下拉框变明显一点儿，不要瞎改". The accepted visual contract is therefore a low-contrast default boundary on the bottom mode and expert-squad dropdowns, not a border on the textarea/editing surface.

After the default dropdown boundary revision, the user clarified: "把这两个改成短按钮，放到左下角，下拉箭头太丑了". The accepted visual contract is therefore two short bottom-left SelectControl trigger buttons with no visible caret; the menu behavior remains Kobalte Select, and the popover width must not be constrained by the short trigger width.

After the short-button revision, the user clarified: "模型选择器加回来，要符合样式". The accepted contract is to restore the OpenCorvus model picker as a third short bottom-left composer button that shares the same subtle pill boundary as Mode and Expert Squad. This does not restore the retired external executor dualbar below the input; external executor selection remains outside the composer control row.

### Hard Constraints

- No fallback/compatibility path, no duplicate attachment source, no hidden file-message send, no direct Kobalte duplication.
- Do not restart, refresh, kill, or interfere with the user's running OpenCorvus/Tauri window; use isolated Vite/Playwright for visual checks.
- Preserve unrelated dirty worktree changes; no git reset or broad cleanup.
- User clarification 2026-07-08: "所谓的右侧toolbar hover出现是指开始的时候不占控件，hover才真正占用空间". The previous "visually hidden but pane-sized" implementation is therefore wrong. `solidRightActivityToolbar` must also be removed from `PANEL_PANE_CONFIG.remainingFixedControlIds` so pane sizing does not reserve hidden toolbar width.
- User clarification 2026-07-08: "模型选择器加回来，要符合样式". The model selector must reuse the existing OpenCorvus model write path and provider model list, while preserving the earlier requirement that the old external executor slot stays hidden from the composer.

### Sources Read

- `AGENTS.md`
- `specs/records/2026-07/2026-07-08-mission-task-chat-toolbar-consolidation-impact.md`
- `specs/current/architecture/07-panel.md`
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/services/composer-attach.ts`
- `packages/overlay/src/services/composer-attachment-acceptance.ts`
- `packages/overlay/src/services/composer-attach-validate.ts`
- `packages/overlay/src/services/chat-attach-limits.ts`
- `packages/overlay/src/services/file-to-data-url.ts`
- `packages/overlay/src/styles/surfaces/composer.css`
- `packages/overlay/src/styles/surfaces/activity.css`
- `packages/overlay/src/main.tsx`
- `packages/overlay/src/services/pane.ts`
- `packages/overlay/test/work-ledger-consolidation.test.ts`
- `packages/overlay/test/browser/chat-composer-button-primitives.test.ts`

### Repository Search Evidence

- `rg -n "ChatComposer|attachment|file input|upload|image|document|right.*toolbar|solidRightActivityToolbar|SideActivityToolbar|rightActivity|right toolbar|activity.tooltip" packages/overlay/src packages/overlay/test packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-07 -g '*.ts' -g '*.tsx' -g '*.css' -g '*.html' -g '*.md'`
  - Found existing composer attachment pipeline, i18n keys, right toolbar mount, and pane fixed-control ownership.
- `rg -n "solidRightActivityToolbar|rightActivity|RIGHT_ACTIVITIES|RightActivity|SideActivityToolbar|activeSemantics=|activity.right|side-activity-toolbar-mount" packages/overlay/src/main.tsx packages/overlay/src/components packages/overlay/test packages/overlay/src/styles -g '*.ts' -g '*.tsx' -g '*.css'`
  - Found `solidRightActivityToolbar` mounted once in `index.html`, rendered by `main.tsx`, and previously included in `PANEL_PANE_CONFIG.remainingFixedControlIds`.
- `rg -n "chat\.attach|attach_|attachment|composer-mode|expert_squad|file_loader|upload|drop" packages/overlay/src/i18n packages/overlay/test -g '*.json' -g '*.ts'`
  - Found existing attachment i18n and tests covering composer mode selector; no existing formal file-loader component.

### Independent Agent Feedback

Not used. The user did not request parallel sub-agent review; this is a focused frontend implementation on already discovered surfaces.

## Implementation Plan

1. Add file and folder loader controls inside `ChatComposer.tsx` that call the existing `addAttachment` for each selected file and reset their input values after processing.
2. Add explicit accepted file MIME/extensions and localized labels/titles for the file/folder loader buttons.
3. Style the attachment loaders as the right-aligned compact control group in the single meta row below the textarea/send row, while mode and expert-squad selects remain on the left.
4. Collapse `#solidRightActivityToolbar` to zero flex width at rest, provide a narrow right-edge hover target, expand the mount to `var(--ui-collapsed-pane-width)` on hover/focus-within, and remove it from pane fixed-control sizing.
5. Add/update focused tests for source contract and CSS hover contract.
6. Run focused tests, typecheck, docs link test for this record, `git diff --check`, and isolated Playwright screenshot review.

## Implementation Summary

- `packages/overlay/src/components/ChatComposer.tsx`
  - Added `SUPPORTED_COMPOSER_FILE_ACCEPT` for images, PDF, text/markdown/CSV/TSV/JSON/XML, Office documents, archives, and common source/config files.
  - Added `ComposerAttachmentLoaders`, a compact Button-driven file/folder picker with hidden native file inputs.
  - Routed selected files through `addFiles()`, which calls the existing `addAttachment(file)` pipeline for every selected file.
  - Routed selected folder files through `addFolderFiles()`, using `webkitRelativePath` to build safe display filenames such as `folder - subdir - file.ts`.
  - Mounted `ComposerAttachmentLoaders` to the right of `.chat-compose-meta-left`, so mode/expert-squad stay left and file/folder actions stay right in one row.
- `packages/overlay/src/styles/surfaces/composer.css`
  - Changed `.chat-compose-meta` to `flex-wrap: nowrap`.
  - Changed `.chat-compose-meta-left` to a left-aligned short-button row for mode selector, expert-squad selector, and composer model selector.
  - Added `.composer-attachment-loaders` as the right-aligned file/folder action group.
  - Added a low-contrast default background and inset boundary to the bottom mode, expert-squad, and model selector buttons so they remain visible before hover/focus.
  - Hid the SelectControl caret and set `sameWidth={false}` so the triggers can remain short buttons while their popovers keep content-owned width.
- `packages/overlay/src/components/ExecutorSelector.tsx`
  - Added `ComposerModelSelector`, a composer-specific OpenCorvus model picker that reuses the existing provider catalog, task operator model context, `patchSessionConfig`, and project `patchConfig` write paths without restoring the external executor dualbar.
  - Removed the 520px container rule that stacked meta controls into multiple rows.
- `packages/overlay/src/styles/surfaces/activity.css`
  - Changed `#solidRightActivityToolbar` to a zero-width flex item at rest with a narrow right-edge hover target.
  - Expanded `#solidRightActivityToolbar` to `var(--ui-collapsed-pane-width)` only on hover/focus-within, then revealed `.side-activity-toolbar`.
- `packages/overlay/src/services/pane.ts`
  - Removed `solidRightActivityToolbar` from `PANEL_PANE_CONFIG.remainingFixedControlIds` so hidden toolbar chrome is not reserved by pane sizing.
- `packages/overlay/src/i18n/en-US.json` and `packages/overlay/src/i18n/zh-CN.json`
  - Added localized attachment loader title/count strings and folder path error copy.
- `packages/overlay/test/composer-file-loader-right-toolbar.test.ts`
  - Added source-level coverage for the right-side file/folder loader contract, single-row meta placement, existing attachment pipeline reuse, folder input setup, safe folder display names, accept list, i18n keys, and hover toolbar CSS.
- `packages/overlay/test/workspace-composer-density.test.ts`
  - Updated the historical narrow-composer expectation from stacked meta controls to one-row meta controls.

## Validation

- `bun test packages/overlay/test/composer-file-loader-right-toolbar.test.ts packages/overlay/test/workspace-composer-density.test.ts`
  - 10 pass, 0 fail.
- `bun run --cwd packages/overlay typecheck`
  - Passed.
- `bun run --cwd packages/overlay check:i18n`
  - Passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  - 20 pass, 0 fail.
- `git diff --check`
  - Passed.
- Isolated Playwright/Vite visual check on `http://127.0.0.1:5275`
  - Composer screenshot: `.scratch/visual/composer-attachment-loaders-right-crop.png`.
  - Right toolbar hover screenshot: `.scratch/visual/right-toolbar-hover-crop.png`.
  - Measured attachment loaders right-aligned to the meta row (`rightAligned: true`); folder input carried `webkitdirectory`; file and folder controls visually shared the same row as mode/expert-squad.
  - Right toolbar hover reached `opacity: 1` and `pointer-events: auto` after transition.
