# macOS Material and Theme Coherence

Status: implemented and visually accepted

## Recall

| Item | Detail |
| --- | --- |
| User request | The macOS UI transparency looks poor and its theme colors contradict one another. |
| Acceptance criteria | The macOS titlebar and left Dock read as one restrained native material; the selected Overlay light/dark palette remains the visible color authority; active/inactive window material follows the real window state; Windows keeps Mica without sharing a contradictory effect list; the desktop layout and interactions remain unchanged. Focused source tests, theme/material browser screenshots, manual original-resolution review, Overlay typecheck/build, document health, commit, and `legacy-remote` push pass. |
| Hard constraints | Follow `AGENTS.md`; use Tauri platform configuration and existing semantic palette tokens; no runtime platform guessing, fallback, compatibility branch, image/noise asset, duplicated theme palette, new state machine, mobile/tablet scope, worktree, or intervention in the user's running OpenCorvus/Overlay process. Playwright remains Node-launched. Preserve the unrelated untracked `C:/` directory. |
| Sources read | `AGENTS.md`; Browser control skill; `specs/current/architecture/07-panel.md`; `2026-07-14-overlay-workspace-surface-continuity.md`; `2026-07-17-platform-left-dock-glass-material.md`; current Tauri configs; `cascade/{base,light,dark,vscode-dark}.css`; `surfaces/{activity,sidebar,titlebar,workspace}.css`; theme service/callers; focused source/browser tests; official Tauri configuration and platform-specific configuration documentation. |
| Whole-repository search evidence | `rg` enumerated every `windowEffects`, `transparent`, `macOSPrivateApi`, `--rail-surface`, `--left-dock-material-*`, `backdrop-filter`, `data-platform`, `applyTheme`, and native `setTheme` occurrence. The material has one CSS owner in `surfaces/sidebar.css` and one clipped renderer in `surfaces/activity.css`. The base Tauri config currently supplies `effects: ["sidebar", "mica"]` to every target even though Tauri documents those as macOS-only and Windows-only conflicting effects. The only platform override is `tauri.macos.conf.json`, which currently owns signing only. The current macOS CSS layer adds a 34% theme tint plus an independent highlight gradient, so a system-derived native material remains more visually authoritative than the user-selected Overlay palette. |
| Independent agent feedback | None. The user did not request sub-agents, and active collaboration policy forbids unrequested delegation. |
| Git baseline | `v0.0.9beta` was fast-forwarded to `legacy-remote/v0.0.9beta` at `368bf860a` before implementation. The only existing worktree residue is untracked `C:/`. |

## Causal chain

1. **Observable:** macOS shows a washed, weakly tinted rail whose native background can disagree with the selected light/dark Overlay palette.
2. **Direct trigger:** the CSS tint preserves only 34% of `--rail-surface`, while the native effect is always active and the shared config declares both macOS Sidebar and Windows Mica in one list.
3. **Deep cause:** platform-native materials were modeled as a cross-platform effect list even though Tauri resolves platform-specific configuration by merge and ignores conflicting effects after the first. The native layer and Overlay theme therefore lack one coherent visual authority.
4. **Root repair:** move each native effect to its official platform config, make macOS material follow active-window state, and raise the quiet semantic rail tint enough that native translucency supplies depth while Overlay theme tokens supply color.

## Call-site disposition

| Call site | Decision |
| --- | --- |
| `src-tauri/tauri.conf.json` | Retain shared window geometry/transparency; remove the cross-platform `windowEffects` list. |
| `src-tauri/src/main.rs` | Apply exactly one native effect in the existing setup path through compile-time platform branches: macOS `Sidebar` with `FollowsWindowActiveState`, Windows `Mica`, and no unsupported Linux effect. |
| `src-tauri/tauri.macos.conf.json` | Keep signing configuration only; do not duplicate the main-window array. |
| `styles/surfaces/sidebar.css` | Keep one macOS material owner; use a stronger `--rail-surface` tint and a restrained same-palette highlight, with no accent hue or CSS blur competing with native Sidebar vibrancy. |
| Focused tests | Assert platform effect isolation, absence of the contradictory base list, semantic macOS tint ownership, active-state behavior, preserved Windows/Linux CSS budgets, and screenshot the macOS light/dark material over a visible desktop-like backing. |

## Verification plan

1. Add failing source assertions for platform-specific native effect ownership and the stronger semantic macOS tint.
2. Implement the config and material-token repair.
3. Run focused tests, the Node-owned browser visual test, Overlay typecheck/build, and document health.
4. Inspect macOS light/dark screenshots at original resolution, revise if the rail is washed out or opaque, then perform a second code/diff review.
5. Commit with the `dsw-33987` prefix, push `v0.0.9beta` to `legacy-remote`, and verify remote convergence.

## Codex review feedback

The first draft proposed putting native effects in `tauri.macos.conf.json` and a new `tauri.windows.conf.json`. Tauri merges platform files with JSON Merge Patch (RFC 7396), so either platform file would replace the complete `app.windows` array. Preserving geometry would require copying the whole main-window object into each file, violating the repository's single-source rule. The plan is revised to use Tauri's mature `EffectsBuilder` API in the existing native setup path with compile-time target selection; platform JSON stays free of duplicated geometry.

## Progress

- [x] Current material/config/theme owners and all call sites audited.
- [x] Baseline macOS light/dark screenshots reproduced and inspected.
- [x] Regression tests and production implementation complete.
- [x] Post-fix visual and build acceptance complete.
- [x] Second review and commits complete; legacy remote push verified below.

## Outcome

- The shared Tauri window config now owns geometry and transparency only. Its contradictory `["sidebar", "mica"]` effect list is gone.
- The existing native setup path applies one compile-target effect: semantic Sidebar vibrancy on macOS with real active-window state, Mica on Windows, and no unsupported Linux native effect. This preserves one window-geometry source and fails setup if a supported native effect cannot be applied.
- macOS keeps CSS blur disabled and raises the theme-owned rail tint from 34% to 68%. The remaining highlight also derives only from `--rail-surface`; no accent, status color, or second palette competes with the selected theme.
- The focused source/theme/workspace suites passed 36 tests. The Node-owned light/dark browser material test passed and regenerated task-scoped 1240-by-820 screenshots; original-resolution inspection confirmed a continuous titlebar/Dock, clean workspace handoff, readable rows, and no washed cross-theme layer.
- The real production Vite bundle was served from an isolated local target and inspected in the controlled in-app browser. It projected `data-platform="darwin"`, rendered the light rail as the expected 68% semantic tint with no CSS blur, kept the Dock root transparent, and retained an opaque white workspace. The isolated tab and server were closed; the user's running Overlay was not touched.
- Overlay TypeScript, panel internationalization, production Vite build, native `cargo check`, Rust formatting, diff whitespace, and all 88 historical-link/document-health/product-doc single-source tests passed. Native compilation retained two pre-existing macOS dead-code warnings for Windows-only taskbar badge helpers; no new warning was introduced.
