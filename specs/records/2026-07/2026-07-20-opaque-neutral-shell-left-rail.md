# Opaque Neutral Shell and Left Rail Proportion Correction

Status: implemented and visually accepted

## Recall

| Item | Detail |
| --- | --- |
| User request | The supplied current macOS screenshot is visually unacceptable ("要多难看有多难看"); the user then explicitly identified the color treatment and transparency as the defects. Correct the composed OpenCorvus workspace rather than polishing isolated details. |
| Acceptance criteria | The shipped window must be compositor-opaque and use one quiet Codex-like neutral light hierarchy: a subtle rail/chrome surface and an opaque white Mission/conversation/Inspector canvas, with readable active-window and inactive-window contrast and no desktop/window content bleeding through. At the desktop reference width, the Projects rail must stay close to the supplied Codex rail instead of consuming the current oversized 23.25% share; Mission/conversation content remains dominant. Existing user resizing, collapse, hidden scrolling, row alignment, rounded workspace corner, and single width source keep working. Focused source tests, Overlay typecheck/build, a real Node-launched browser fixture, current-task screenshots, and manual visual review must pass. |
| Hard constraints | Desktop-only scope. Replace the rejected glass path directly: no native vibrancy/Mica, transparent Tauri window, CSS backdrop material, platform tint branch, opacity preference branch, fallback material, or second source may remain. Preserve `--ui-sidebar-width` plus `pane.ts` as the only runtime width path and preserve mature Button/WorkLedger primitives. Do not add viewport gates, media-query branches, a second persisted state, temporary iframe/query/signal preview paths, or touch the running OpenCorvus process. Playwright must start through Node in an isolated fixture. Commit subjects start with `dsw-33987` and delivery goes to `legacy-remote/v0.0.10beta`. |
| Supplied evidence | The macOS screenshot shows the OpenCorvus shell sampling the window behind it as a broad dirty gray field, which pushes normal navigation text/icons toward disabled-state contrast. Mission/Inspector remains opaque white, creating a hard vertical material discontinuity. Separately, the Codex reference rail occupies about 275px while the visible OpenCorvus Projects region occupies about 365px before the raised Mission workspace begins. |
| Prior decisions read | `2026-07-17-platform-left-dock-glass-material.md` opened the native transparency chain (`transparent`, private macOS Sidebar effect, Windows Mica, transparent body/titlebar/Dock) after a prior screenshot requested glass; its isolated fixture could not reproduce the real multi-window macOS composition now rejected by the user. `2026-06-26-remove-overlay-transparency-capability.md` documents the earlier opaque-shell single-source contract and provides the correct architectural direction, though current implementation must be derived from present call sites rather than restored as compatibility. `2026-07-17-left-rail-scrollbar-width-workspace-shadow-parity.md` intentionally changed the rail from `280px / 20.5cqw / 392px` to `300px / 23.25cqw / 440px` using an earlier approximately 445px reference; the new screenshot supersedes that width target. `overlay-window-size-contract.test.ts` confirms desktop legal frames and forbids unreachable compact branches. |
| Whole-repository grep | Width ownership is singular: `design-language.css` defines `--ui-rail-width`, `--ui-rail-min-width`, and the `--ui-sidebar-width` projection; `pane.ts` resolves defaults, minimums, resize maximums, persistence, and ARIA values; `activity.css` and `sidebar.css` consume it. Transparency ownership is also fully enumerated: `tauri.conf.json` enables `macOSPrivateApi` and `transparent`; `Cargo.toml` enables `macos-private-api`; `main.rs` defines and calls `configure_platform_window_effect` with macOS Sidebar and Windows Mica; `base.css` makes platform bodies transparent; `sidebar.css` defines all platform `--left-dock-material-*` tint/filter branches; `activity.css` paints the clipped filtered underlay and reduced-transparency branch; titlebar, panel body, sidebar, and app host are transparent consumers. Replacement assertions live in `left-dock-opaque-shell.test.ts`, `overlay-architecture-guards.test.ts`, `window-opacity-shell-tokens.test.ts`, the width tests, and `opaque-neutral-shell-browser.test.ts`; historical glass tests are deleted rather than retained as a second contract. `data-platform` remains independently required for native titlebar/platform behavior and is not a material identity after this change. Historical records remain immutable evidence. |
| Independent agent feedback | None. The user did not request sub-agents, and current collaboration policy forbids unrequested delegation. |
| Git baseline | `HEAD` and `legacy-remote/v0.0.10beta` both resolve to `0fe6dbcbed58bffacc88f98518c363db76118104`. The unrelated untracked `C:/` tree is preserved and excluded. |

## Causal chain

1. **Observable:** the OpenCorvus navigation/chrome reads as a dirty inactive gray sheet with low-contrast content, while the white Mission/Inspector reads as a separate pasted panel; the rail is also disproportionately wide.
2. **Direct trigger:** Tauri exposes a transparent native window and `main.rs` applies Sidebar vibrancy on macOS. The body, app host, titlebar, panel body, Dock, and Dock content then leave alpha open while a partially transparent clipped underlay samples the native material. Independently, the canonical rail default is `clamp(300px * scale, 23.25cqw, 440px * scale)`.
3. **Deep cause:** the July 17 glass decision optimized for a platform material concept and isolated browser screenshots, but the real macOS composition depends on whatever content sits behind the window. That makes the application's palette externally determined and prevents stable text contrast. Opaque workspace/Inspector surfaces then expose the split material model. The width target was likewise calibrated from an earlier mismatched measurement.
4. **Why earlier work did not root-fix this result:** isolated browser fixtures could only render CSS against a controlled backing color and could not validate native multi-window sampling or inactive-window vibrancy. Later tint reductions changed the strength but kept the external-background dependency. Root repair therefore removes the native/CSS transparency chain and restores one application-owned palette; changing tint percentages would preserve the defect.

## Call-site disposition

| Surface | Decision |
| --- | --- |
| `design-language.css` | Replace the proportional default with a compact desktop clamp derived from the supplied Codex rail; keep the existing single projection and a usable resize minimum. |
| `pane.ts` | Keep unchanged. It remains the only default/min/max/persistence/ARIA resolver and automatically consumes the corrected tokens. |
| `tauri.conf.json`, `Cargo.toml`, `main.rs` | Close the native alpha chain: make the main window opaque, remove the private macOS material feature/configuration, and delete the platform-effect function and call. Keep unrelated platform chrome and `data-platform` projection. |
| `base.css` | Remove the platform-body transparency override; `--body-bg` again owns the visible native webview shell. Keep the app host transparent because it composites only against that application-owned opaque body. |
| `sidebar.css`, `activity.css` | Delete all platform material variables, gradients, filters, reduced-transparency branch, and clipped underlay. Paint the Dock once with `--rail-surface`, keep only a semantic vertical edge, and leave content layers transparent to that opaque Dock owner. |
| Theme palettes / Work Ledger / Mission / Inspector | Keep their existing opaque semantic palette tokens and row/control primitives. Verify their contrast after the shell is no longer contaminated by native sampling. |
| Focused source tests | Replace glass expectations with negative assertions proving the transparency/effect/material path is absent, native configuration is opaque, Dock paint is single-owned, and width remains token-owned. |
| Browser visual path | Use the existing full-shell/ledger/pane fixture infrastructure at desktop width, capture task-scoped light and dark evidence plus an inactive-window-representative light composition where supported, and inspect material continuity, contrast, and proportion at original resolution. Browser evidence cannot claim native compositor validation; the native chain is proven closed by configuration/Rust source assertions. |

## Verification plan

1. Write focused regression assertions for the opaque native shell, deleted material chain, single Dock paint owner, and corrected desktop rail range.
2. Close the native transparency/effect path, delete the CSS material path, and replace only the canonical width tokens while keeping runtime projection/resizing unchanged.
3. Run focused tests, Overlay typecheck/i18n/build, Rust checking where supported, and Node-launched browser fixtures for full-shell geometry, contrast, and resizing.
4. Inspect current-task screenshots at original resolution; iterate if the rail still dominates or text/actions clip.
5. Run documentation health, second diff/call-site review, commit with `dsw-33987`, and push `v0.0.10beta` to legacy remote.

## Progress

- [x] Screenshot, prior decision, production ownership, tests, and git baseline inspected.
- [x] Regression assertions updated for opacity, palette ownership, and width.
- [x] Native/CSS transparency chain deleted and canonical width corrected.
- [x] Browser screenshots inspected and accepted.
- [x] Second review complete; commit and legacy remote push are the final delivery transaction.

## Outcome

- The native main window is opaque again. The Tauri private macOS material feature/configuration, macOS Sidebar effect, Windows Mica effect, effect setup call, and platform-body transparency override were removed as one chain.
- The platform-tinted `--left-dock-material-*` variables, clipped app-host underlay, backdrop filters, and reduced-transparency material branch were deleted rather than retained as an alternate path. `data-platform` remains only for independent platform/chrome behavior.
- The Dock now has one application-owned `--rail-surface` paint owner with a restrained semantic edge. In the production light build, the inspected values are `rgb(247, 247, 247)` for body/Dock, `rgb(255, 255, 255)` for the workspace, `none` for Dock backdrop filtering, and `none` for the retired host pseudo-element content.
- The desktop default rail is now 280px at the 1280px acceptance viewport instead of the rejected roughly 365px proportional result. Existing resize ownership remains unchanged.
- The full project-group head now paints the shared hover wash while its nested toggle/actions remain transparent, fixing the detached-action feedback exposed by the real Work Ledger browser run.
- Focused source tests passed 166 assertions/tests across the shell, width, pane, architecture, window-size, and Work Ledger contracts. Overlay TypeScript, internationalization, Vite production build, Rust check, and both Node-launched browser fixtures passed. Rust's pre-existing platform-only taskbar badge warning was root-fixed with the existing Windows/test compile scope and existing icon regression test.
- Original-resolution evidence was personally inspected: `packages/overlay/.scratch/work-ledger-scrollbar-hidden-full-page.png` shows the actual production shell with readable neutral navigation and an opaque white workspace; `packages/overlay/.scratch/opaque-neutral-shell/darwin-light.png` and `darwin-dark.png` show the light/dark surface hierarchy. A controlled in-app browser opened the production bundle and independently reported the same opaque computed styles and 280px Dock. The user's running OpenCorvus process was not restarted or refreshed, so no claim is made that its already-loaded binary changed in place; the source/configuration and new build close the native compositor path for the next launch.
