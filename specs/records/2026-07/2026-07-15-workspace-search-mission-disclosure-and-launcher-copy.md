# Workspace Search, Mission Disclosure, And Launcher Copy

## Recall

### User requirement

- Move the workspace search button to the far right of the `OpenCorvus 工作区` row.
- Move the Mission child-task count and expand/collapse control to the far left of the Mission row, present it as a left-attached semicircular control, and reduce its contrast.
- Make the file-manager launcher wording follow the same `用 XXX 打开` language as the editor entries rather than `在文件管理器中打开`.
- Compact the Settings Provider catalog: vertically center `显示 147 / 147`, indent the `可用 Provider` heading to the list content edge, remove the visible `custom` source and `需要 API 密钥` status, and keep each collapsed catalog Provider on one line.

### Acceptance criteria

- The workspace row order is brand copy, flexible drag spacer, then search; the search button is aligned against the right content inset.
- Mission rows with children render one disclosure control as their first visual item, before the Mission kind icon and title; rows without children keep the existing grid.
- The disclosure has a flat left edge, a pill-rounded right edge, a low-contrast resting wash, muted glyph/text, and a restrained hover/expanded wash.
- The disclosure remains one accessible `Button`, preserves child auto-expansion, and continues to show the canonical task count.
- File-manager copy reads `Open in File Manager` / `用文件管理器打开` from the existing `cwd.open` localization source.
- The Provider count is vertically centered with the stat cards and header actions; the Available Provider heading aligns with Provider-row content.
- A collapsed catalog row contains only the Provider name/id, model count, optional auth action, and Configure action on one horizontal line. Source and API-key status text are not mounted in the catalog list; expanding Configure still reveals the existing API-key editor.
- Focused source tests, Overlay TypeScript and i18n checks, Node-launched browser interaction/geometry checks, and manually reviewed dark screenshots pass.

### Hard constraints

- Preserve `App`, `WorkLedgerRowView`, `Button`, `Icon`, `WorkspaceEditorLaunchers`, and the locale catalogs as the only owners; add no second launcher or disclosure implementation.
- Desktop-only scope; Playwright runs with Node, not Bun.
- Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus/Overlay process.
- Preserve all concurrent uncommitted work; no reset, stash, worktree, hook bypass, or broad staging.

### Supplied visual evidence

- `codex-clipboard-12a0f402-4416-4647-a4d9-659625140831.png`: search is immediately after the workspace title instead of at the far right.
- `codex-clipboard-f173fefe-f147-4b61-9a0d-909ce375f147.png`: Mission task count/disclosure occupies the right metadata rail with stronger contrast than desired.
- `codex-clipboard-d11701b5-98aa-4a1e-95f1-3a5b83d40ae4.png`: the file-manager row uses a different sentence pattern from the five editor rows above it.
- `codex-clipboard-6766c67e-612e-4bfd-9c60-c3047ee6e93e.png`: the shown/total count sits too high, the Available Provider heading starts outside the row inset, and catalog rows spend a second line on `custom` plus a redundant API-key-required badge.

### Sources read

- `AGENTS.md`, `specs/README.md`, `specs/records/2026-07/README.md`, and `specs/current/architecture/99-principles.md`.
- `specs/records/2026-07/2026-07-15-project-row-surface-and-search-alignment.md`.
- `specs/records/2026-07/2026-07-15-task-attention-interaction-dialog.md`.
- `specs/records/2026-07/2026-07-15-workspace-file-manager-launcher.md`.
- `packages/overlay/src/components/{App,WorkLedger,WorkspaceEditorLaunchers}.tsx`.
- `packages/overlay/src/components/settings/{ProvidersPanel,primitives}.tsx`.
- `packages/overlay/src/styles/surfaces/{sidebar,titlebar,work-ledger,settings}.css` and the shared Button/settings primitives.
- Related source/browser tests for workspace search, Mission disclosure, interaction attention, and file-manager launching.

### Whole-repository search evidence

Repository searches covered every `workspace-command-search` / `work-ledger-search-toggle` mount and assertion; every `mission-task-disclosure` render, style, geometry check, and interaction check; all `cwd.open` consumers and both locale definitions; and the prior records governing these owners.

| Owner / call site                                   | Decision                                                                                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `App.tsx` workspace context row                     | Reorder the existing spacer and search button; preserve one command-palette event source.                                                                                            |
| `titlebar.css` workspace grid                       | Change the columns to brand / flexible spacer / action; preserve current sizing and optical vertical correction.                                                                     |
| `WorkLedgerRowView`                                 | Move the existing Mission disclosure before `WorkLedgerKindMark`; keep its signal, count, labels, and click behavior unchanged.                                                      |
| `.work-row[data-has-task-disclosure]`               | Project a dedicated first max-content column only for Mission rows that have child tasks.                                                                                            |
| `.work-row-task-disclosure`                         | Own the left-attached semicircle and low-contrast interaction tokens.                                                                                                                |
| `cwd.open` in `en-US.json` / `zh-CN.json`           | Replace the inconsistent wording at its single visible launcher use; preserve the key and native open-path behavior.                                                                 |
| `ProvidersPanel` command summary                    | Keep the count in the existing stat strip and vertically center it; do not create a second toolbar count.                                                                            |
| `SettingsDetailSection` Available Provider instance | Add a Provider-catalog modifier and use its existing header/list surface to share one horizontal inset.                                                                              |
| `provider-catalog-row`                              | Remove mounted source/status metadata from the catalog renderer and project a center-aligned, single-line collapsed grid; retain the expanded API-key editor as the only second row. |
| Provider source/browser regressions                 | Pin absent source/status markup, one-line geometry, header inset, count alignment, Configure expansion, and a scoped dark screenshot.                                                |
| Source/browser regressions                          | Pin DOM order, conditional grid projection, low-contrast tokens, click behavior, right alignment, launcher copy, and scoped screenshots.                                             |

### Independent agent feedback

- None. The user did not request sub-agents; all changes are tightly coupled to the same Overlay shell and existing browser fixture.

## Root cause

The workspace context grid declares `brand / search / spacer`, so the flexible track grows after the search instead of between the title and action. The Mission disclosure is nested in `.work-row-right`, which structurally forces it into the far-right metadata rail and subjects it to the right-side contrast treatment. The file-manager row reuses the older generic `cwd.open` sentence while editor rows use the `Open in / 用…打开` pattern. In Provider Settings, the count participates in a stretch-aligned stat strip without centering its own content, the generic detail header has no row-content inset, and each catalog row explicitly mounts source plus auth status in a two-level grid; those structural choices create the reported offset and unnecessary second line.

## Implementation

1. Reorder the workspace context children and grid tracks so the existing search action anchors at the right inset.
2. Move the existing Mission disclosure to the row's first grid column, add a conditional Mission layout, and restyle the same Button as a low-contrast left-attached semicircle.
3. Update the existing localized file-manager copy and focused regressions, then run isolated dark-theme browser acceptance and screenshot review.
4. Use the existing Provider panel/detail/row primitives to center the count, share the catalog inset, and reduce collapsed catalog rows to one line while preserving Configure and its expanded key editor.

## Verification

- Focused Overlay source tests for Work Ledger, titlebar brand/search, launcher copy, and Provider catalog density.
- Overlay TypeScript and i18n checks.
- Node-launched browser fixtures for Mission disclosure interaction/geometry, workspace search placement, file-manager menu copy, and Provider catalog layout.
- Required spec health checks, Prettier, `git diff --check`, and a second diff review.

## Result

- Workspace search now occupies the rightmost context-bar track while retaining its existing optical vertical correction.
- Mission task disclosure is the first row item, left-attached with a flat left edge and muted resting/interaction contrast; its existing count, accessible label, and expansion behavior remain intact.
- The file-manager launcher now reads `Open in File Manager` / `用文件管理器打开` through the existing `cwd.open` localization key.
- Provider catalog count and section inset are aligned. Collapsed catalog rows mount one information line and no source/API-key-status metadata; Configure still adds the canonical key-editor row.
- Node-launched Playwright acceptance passed for Provider catalog layout, workspace search placement, file-manager copy, and the complete titlebar/Work Ledger fixture. Reviewed dark screenshots: `.scratch/provider-catalog-compact-one-line.png`, `.scratch/provider-settings-primitive-owner.png`, `.scratch/work-ledger-mission-disclosure-left.png`, `.scratch/workspace-search-title-alignment.png`, and `.scratch/workspace-editor-file-manager-option.png`.
- Browser acceptance also exposed a stale Right Dock fixture count left behind when the committed Terminal entry expanded the canonical catalog from eight to nine; the focused assertion now follows that existing single source.
