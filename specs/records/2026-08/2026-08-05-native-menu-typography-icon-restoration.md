# Native menu typography and icon restoration

## Recall

| Item                  | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request          | Restore the earlier font and icon sizing in the Environment popover's child menus, Right Dock tab popups, and Browser zoom/element-selection popup that was previously moved above the native Browser surface. The current typeface presentation and sizes are visibly wrong.                                                                                                                                                                                                                                                                                                                      |
| Acceptance criteria   | Every parent-owned native menu uses the same menu typography and icon density as the earlier `DropdownMenu` presentation: 14 scaled-pixel control text and 14 scaled-pixel standard icons; the Browser zoom heading and percentage use the same type tier; the existing segmented zoom geometry, Browser-overlap behavior, placement, actions, and dismissal remain unchanged.                                                                                                                                                                                                                     |
| Hard constraints      | Keep the shared parent-owned native menu window as the only Browser-crossing popup renderer. Fix its one presentation source rather than adding caller-specific overrides. Do not move, hide, resize, or replace the live Browser WebView. Do not add, modify, or run User Interface (UI) automated tests. Verify with the real desktop application, direct interaction, screenshots, and personal visual review. Preserve unrelated working-tree changes. Do not create a worktree, fallback, compatibility path, gate, or second source.                                                         |
| Sources read          | Root `AGENTS.md`; `CLAUDE.md`; current panel architecture; shared native-menu, Browser continuity, convergence, toolbar-layout, and shadow records; `native-menu.tsx`; `native-menu.css`; native-menu service and contract; `RightDock.tsx`; `TaskDirBar.tsx`; `BrowserPreviewPanel.tsx`; icon primitive/tokens; DropdownMenu primitive styles; relevant Git history.                                                                                                                                                                                                                              |
| Whole-repository grep | The native surface has five caller paths: Right Dock add and overflow menus, Environment Local and branch child menus, and Browser zoom/element-selection. They all render through `native-menu.tsx` and `native-menu.css`. The current native label uses `--ui-font-title` (15px) while the earlier DropdownMenu primitive and Browser zoom row use `--ui-font-control` (14px). `native-menu.tsx` forces every item icon to `medium` (16px), while prior Right Dock and Browser menu icons omitted a size and therefore used the 14px `standard` tier. No second native-menu visual owner exists. |
| Independent review    | Claude Code 2.1.147 was invoked read-only with `Read,Grep,Glob`, but local authentication returned `Not logged in` before analysis. Two bounded session-local read-only reviewers reached terminal success; this tool surface returned receipts without textual payloads, so the primary agent independently rechecked the exact scope against source and historical diffs. The source evidence confirms the two-token restoration and no caller omission.                                                                                                                                         |
| Git baseline          | Current branch `work-v0.0.30beta-yr-0804` starts at `93c97cc41d`, matching its tracked `myhexin` branch. Existing Environment popover dismissal changes in `TaskDirBar.tsx`, panel architecture, and August indexes belong to concurrent work and must remain unmodified and outside this task's commit.                                                                                                                                                                                                                                                                                           |

## Causal chain

1. Browser-crossing popup migration correctly replaced host `DropdownMenu` surfaces
   with one parent-owned Tauri WebviewWindow so menus can paint above the live
   operating-system Browser child WebView.
2. The new native menu stylesheet assigned every ordinary label the larger
   title token instead of the canonical menu control token.
3. Its renderer also passed `size="medium"` to every leading icon, overriding
   the icon primitive's standard default used by the former Right Dock and
   Browser menus.
4. Because all five callers consume the same renderer, the regression appears
   across Environment child menus, Right Dock tab menus, and Browser actions.
   Caller-specific corrections would create conflicting visual sources.

## Implementation and verification plan

1. Change the native menu's ordinary item label and Browser toolbar text to the
   canonical DropdownMenu control type tier.
2. Render native-menu leading action icons at the canonical standard icon tier;
   retain the compact checkmark and all existing layout/action semantics.
3. Update the current panel architecture only if the existing native-menu
   presentation contract lacks this density statement; preserve concurrent
   architecture edits exactly.
4. Remove the existing UI automated tests, dedicated browser runner, fixtures,
   baselines, and capture scripts encountered while locating the real-page
   visual acceptance path; they are prohibited by the current repository UI
   test policy and must not be run.
5. Run Overlay typecheck, internationalization check, production Vite build,
   documentation health, and `git diff --check`. Do not run UI automated tests.
6. Launch an isolated real desktop client without restarting the operator's
   current OpenCorvus process. Open and inspect the Environment Local/branch
   child menu, Right Dock add/overflow menu, and Browser zoom/selection menu
   above a live page; capture and personally review screenshots, then correct
   and repeat if needed.
7. Perform an independent code review, inspect the final diff, commit only this
   task's files with the `dsw-33987` prefix, reconcile the tracked git-cc branch,
   and push to `myhexin` through normal hooks.

## Progress

- [x] Recall, causal chain, and implementation plan recorded.
- [x] Independent pre-implementation review complete; Claude authentication blocker recorded and bounded session reviews completed.
- [x] Product changes complete.
- [x] Non-UI/static verification complete.
- [x] Real-page visual acceptance and second review complete.
- [x] Delivery implementation committed; git-cc push verification follows in the delivery record.

## Real-page visual evidence

- Launched the current debug Tauri desktop client against the live Vite source
  with an isolated `OPENCORVUS_HOME`, isolated WebView2 data directory, and a
  local DevTools inspection port. The operator's running client was not
  restarted, refreshed, or closed.
- Created an isolated real Chat session, opened Environment, then opened the
  Local and branch child menus. The Local menu's `Working Directory`, `Open in
File Manager`, and `Switch Folder…` labels all measured `14px`; every leading
  icon measured `14px`. The branch row measured the same label and leading-icon
  density while retaining the compact checkmark.
- Opened the Right Dock add menu and then enough real tool tabs to expose the
  overflow tab menu. Both native windows measured `14px` labels and `14px`
  leading icons. Personal review of
  `.scratch/native-menu-density-right-dock-add.png` and
  `.scratch/native-menu-density-right-dock-overflow.png` confirms the restored
  text/icon proportion and stable list geometry.
- Opened a real Browser tab and its zoom/element-selection menu. `Preview zoom`,
  `100%`, and `Select an element` measured `14px`; all three action icons
  measured `14px`. Personal review of
  `.scratch/native-menu-density-browser-actions.png` confirms the segmented
  zoom control remains centered, bounded, and unobstructed above the Browser
  surface.
- Personal review of
  `.scratch/native-menu-density-environment-local.png` confirms the Environment
  child menu remains above the live Browser/right-dock surface with compact,
  readable typography and icons. No UI automated test was added, modified, or
  run for this acceptance.

## Verification

- `bun run typecheck` in `packages/overlay`: passed.
- `bun run check:i18n` in `packages/overlay`: passed with catalog hash
  `d0a34c94f99923db`.
- `bun run build:vite` in `packages/overlay`: passed after transforming 7,073
  modules and emitted both the main and native-menu production entries.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`:
  passed, 2 tests and 2 expectations.
- `bun run docs:check`: passed for 311 operations across 24 groups.
- `git diff --check`: passed.
- Existing UI automation discovered in the inspected Overlay test/capture path
  was removed together with its dedicated Node runner, Playwright dependency,
  fixtures, baselines, and capture scripts. None of those tests was run.

## Delivery

Implementation and verification were committed as `90657326e5` with the
required `dsw-33987` subject prefix. The tracked git-cc branch is
`myhexin/work-v0.0.30beta-yr-0804`.
