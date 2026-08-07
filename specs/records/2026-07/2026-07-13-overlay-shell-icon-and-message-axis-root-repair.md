# Overlay Shell, Icon, and Message-Axis Root Repair

## Recall

| Item | Detail |
| --- | --- |
| User requirement | 修复当前前端页面崩坏，不只解释原因。 |
| Acceptance criteria | The desktop Overlay root shell has non-zero viewport-filling height; `panelBody`, `workspaceMain`, Conversation, File Editor, pane resizer, and Right Dock retain their real layout ownership; Composer runtime icons render without a page exception; the agent rail/message lane uses the accepted centered five-column geometry; focused unit, type, i18n, build, real Node/Playwright, screenshot, and second-review checks pass. |
| Hard constraints | No fallback, compatibility path, gate, root error-boundary masking, duplicate icon identity source, second layout path, broad Git restore/reset, new worktree, mobile/tablet scope, or manual `dist-vite` edits. Playwright runs through Node. Do not restart, refresh, close, or kill the user's OpenCorvus/Overlay. Preserve unrelated dirty work. |
| Sources read | `AGENTS.md`; `specs/current/architecture/{07-panel,12-overlay-card-system,99-principles}.md`; `2026-06-17-icon-html-single-source.md`; `2026-07-08-message-pane-rail-header-scrollbar-repair.md`; `2026-07-13-composer-runtime-control-icons.md`; `2026-07-13-right-dock-native-menu-render-stall.md`; current `App.tsx`, `Icon.tsx`, `ChatComposer.tsx`, `workspace.css`, `conversation.css`, Overlay browser runner, dist snapshot helper, and related tests. |
| Whole-repository search evidence | `IconName`, both icon registries, `REGISTERED_ICONS`, all typed consumers and browser icon fixtures were enumerated; `panel`, `panel-body`, `workspaceMain`, File Editor, pane resizer, Right Dock, rail/mirror/message selectors and their unit/browser contracts were enumerated; Git history proves commit `3fad861094` deleted the shell/File Editor/resizer/Right Dock owner block while editing the native-menu delivery. |
| Independent agent feedback | Icon audit found the handwritten union/`Partial<Record>` dual source and a broken union parser that reads only 92/113 names. Layout audit confirmed the exact accepted five-column order and four CSS dispositions. Runtime audit measured `workspaceMain` at `0px`, confirmed the latest bundle lacks `.panel`/`.panel-body`, and confirmed the Node browser runner uses activity-reset inactivity timeouts and random fixture ports. |

## Observable Failure to Root Cause

1. **Collapsed application shell**
   - Observable: the current rendered `#workspaceMain` has zero height and the page appears blank/broken.
   - Direct trigger: `.panel` and `.panel-body` no longer have the flex chain that fills the viewport below the titlebar.
   - Root cause: commit `3fad861094` accidentally deleted approximately 294 lines of unrelated canonical workspace CSS while repairing the native Right Dock menu. The deletion also fused Right Dock properties into `.file-editor-header`, and removed File Editor, pane resizer, section density, workspace surface, and `.right-dock` root rules.
   - Why earlier validation missed it: the native-menu repair focused on Tauri event completion; it did not run the shell geometry/browser contracts that own the deleted selectors.

2. **Composer mount white screen**
   - Observable: Vite/WebView emitted `Unknown icon "workflow"` and the root render became white.
   - Direct trigger: `ChatComposer` rendered `workflow` after only the handwritten `IconName` union had been extended.
   - Root cause: icon identity was authored twice: a handwritten union plus two `Partial<Record<IconName, ...>>` registries. `Partial` explicitly allowed the runtime entry to be missing.
   - Why earlier validation missed it: the static union parser stops at an unrelated semicolon and reads only 92/113 names; the Composer test asserted source text without mounting the component.

3. **Message/Composer axis regression**
   - Observable: the agent rail/message group shifts left and the transcript no longer shares the Composer center axis.
   - Direct trigger: the current uncommitted `conversation.css` removes the left flexible spacer and rail mirror, reducing five columns to three.
   - Root cause: a later visual edit replaced the accepted geometry without updating or running the exact browser contract.
   - Why earlier validation missed it: the unit test checks only that a conditional grid exists; it does not assert the five column order or assigned column indices.

## Call-Site Disposition

| Surface | Disposition |
| --- | --- |
| `styles/surfaces/workspace.css` | Restore the deleted canonical shell, File Editor, resizer, density, workspace surface, and `.right-dock` root blocks from their last valid source while preserving the newer Right Dock tab styling and native-menu work. |
| `components/Icon.tsx` | Delete the handwritten `IconName` union and `Partial<Record<IconName,...>>`; define the two mutually exclusive backend registries as concrete records and derive `IconName` from their keys. Preserve loud unknown-string validation for `iconHtml`; do not add a glyph fallback. |
| `components/ChatComposer.tsx`, `styles/surfaces/composer.css` | Preserve the intended workflow/assistant icon controls and their existing semantics. |
| `styles/surfaces/conversation.css` | Restore the accepted five-column rail/message/mirror geometry exactly. |
| `test/flat-redesign-icon-coverage.test.ts` | Remove the obsolete union parser and assert registry-derived type ownership; keep source-policy guards. |
| `test/browser/runtime-icon-single-source-visual.test.ts` | Exercise the real Composer runtime icons in a rendered Overlay, assert both visible SVGs, no page errors, and capture the task-scoped control screenshot. |
| `test/conversation-agent-rail.test.ts` | Strengthen the unit contract to require exact five-column ordering and column ownership. |
| Existing shell/File Editor/resizer/browser tests | Run unchanged; they are authoritative regression owners and should catch the restored behavior. |

## Benchmark

- **Input:** current Windows host workspace and current desktop Overlay source.
- **Output:** a rendered desktop Overlay with a non-collapsed shell, renderable Composer icons, and centered rail/message/Composer geometry.
- **Environment:** repository-pinned Bun/TypeScript/Vite and Playwright; Node browser runner; random fixture HTTP ports; no user process restart or refresh.
- **Timeout:** `OPENCORVUS_OVERLAY_BROWSER_RUNNER_IDLE_MS` controls real inactivity timeout and resets on stdout/stderr activity; no absolute runtime deadline.
- **Pass criteria:**
  1. focused icon, shell, File Editor, pane, and rail unit contracts pass;
  2. Overlay typecheck and i18n checks pass;
  3. Vite build passes;
  4. real Node browser fixtures report no page/console/request errors;
  5. `panelBody` and `workspaceMain` have positive height, the rendered rail grid has at least five columns, transcript and Composer center axes differ by at most 1.5px, and runtime-control SVGs are visible;
  6. light and dark task-scoped screenshots are personally reviewed and show no collapse, clipping, or axis drift;
  7. historical/document health and final diff review pass.

## Version-Control Boundary

`HEAD` and `legacy-remote/v0.0.3beta` are synchronized at `67ef9f5907` before implementation. The main worktree contains extensive unrelated tracked and untracked changes, including overlapping intended Composer changes. A pre-change task commit cannot safely capture that dirty state without claiming unrelated work; the baseline is therefore recorded by exact `HEAD`, `git status`, targeted diffs, and file hashes. Task-owned hunks will be staged selectively after verification; no broad staging, stash, reset, or worktree is allowed.

## Progress

- [x] Reproduce and evidence the three failure chains.
- [x] Recall current architecture and historical constraints.
- [x] Enumerate call sites and obtain independent audits.
- [x] Repair shell and registry ownership.
- [x] Restore five-column geometry and strengthen contracts.
- [x] Run real rendered benchmark and inspect screenshots.
- [x] Complete second review and selective implementation commit (`9610f45ab4`).
- [ ] Push the verified commits to `legacy-remote/v0.0.3beta`.

## Verification Result

- Focused contracts: 41 passed, 0 failed across Composer controls, icon ownership, conversation rail, pane resizer, and workspace density.
- Overlay TypeScript: `tsc --noEmit` passed.
- Overlay i18n: passed with digest `8994cac2bbb2992a`.
- Production Vite build: passed with 2,438 transformed modules.
- Real Node/Playwright benchmark: both `runtime-icon-single-source-visual.test.ts` and `conversation-agent-rail-scroll-browser.test.ts` passed. The runner rebuilt from current source, used random fixture ports, and retained activity-reset inactivity timeout semantics.
- Browser geometry: `panelBody`, `workspaceMain`, and Conversation exceeded their non-collapse thresholds; both Composer control icons rendered as 15px SVGs with actual geometry; the rail fixture retained five columns and the transcript/Composer axis contract.
- Visual review: `runtime-icon-workspace-shell.png`, `runtime-icon-composer-controls.png`, `chat-section-after-locate.png`, and `chat-section-ambient-dark.png` were inspected at original resolution. Light and dark views show a full-height workbench, visible workflow/assistant controls, a narrow left rail, a full-width centered message lane, and no collapse, clipping, or axis drift.
- Documentation health: all 20 historical-doc link/storage checks passed.
- Known unrelated dirty-worktree failures remain in the unfinished center-workbench/inspector refactor: `App.tsx` lacks legacy File Explorer mounts expected by old architecture tests, and `inspector.css` exceeds duplicate-selector/raw-pixel guards. These files were already modified outside this repair and are not used to claim this benchmark passed.
- Push result: `legacy-remote/v0.0.3beta` was 0 behind / 2 commits ahead locally, but the mandatory pre-push full-repository typecheck rejected the dirty worktree. The independent in-progress source-snapshot refactor removed `sourcePackage*` and `webpageEvidence*` from `ProjectRuntimePaths.frontendDesignPaths()` and changed `prepareWebCloneContext` to `stagingRoot`, while roughly 30 call sites still use the retired contract. Restoring those fields would create forbidden compatibility/fallback; completing that unrelated architecture migration would overwrite user work outside this repair. No hook bypass or GitHub push was used, so commits `9610f45ab4` and `cc19505b51` remain local and the remote is unchanged.
