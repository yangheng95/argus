# Windows Titlebar and Left Dock Material Continuity

## Recall

| Item | Evidence and constraint |
| --- | --- |
| User requirement | The macOS user-interface optimization separated the Windows left Dock from the titlebar; adjust the Windows shell so the two regions read as one continuous surface. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-9ccb55a3-bc27-4f73-acb2-f9511d58a0ba.png`, inspected at its original 1920-by-1080 resolution. The screenshot shows a horizontal material boundary at the 36-logical-pixel HTML titlebar/Dock handoff while the workspace begins as a separately rounded opaque surface. |
| Acceptance criteria | Windows renders one continuous titlebar-plus-left-Dock material with no horizontal seam, duplicated gradient, or one-pixel top highlight at the Dock handoff. The workspace keeps its single top-left radius and remains opaque. Dock resize/collapse continues to consume the existing `--ui-sidebar-width` projection. macOS keeps its native menu/traffic lights and quiet Sidebar-vibrancy budget; Linux keeps the shared Windows/Linux tint contract. Focused source tests, a Node-launched real-browser shell screenshot with a seam-pixel assertion, Overlay typecheck/build, document health, and a second visual/code review pass must succeed. |
| Hard constraints | Keep a single material owner and the existing native transparency chain. Do not tune two independent colors until they look similar, add a separator-covering mask, introduce a second width/state source, parse the user agent, add a fallback, alter mobile/tablet behavior, create a worktree, or refresh/restart/close the user's running OpenCorvus. Playwright must be launched by Node; visual review uses an isolated preview. |
| Sources read | `AGENTS.md`; Browser skill; supplied screenshot; `specs/current/architecture/07-panel.md`; the platform-left-Dock glass, macOS titlebar/menu, platform-chrome, single-visible-titlebar, native-window-controls, and workspace-surface-continuity records; `App.tsx`; `main.tsx`; `pane.ts`; `tauri.conf.json`; `main.rs`; `base.css`; `design-language.css`; `titlebar.css`; `sidebar.css`; `activity.css`; `workspace.css`; focused shell/material/source/browser tests. |
| Whole-repository search | `rg` enumerated every `#overlayAppHost`, `#leftActivityShell`, `.left-activity-shell`, `.titlebar`, `.workspace-contextbar`, `--ui-titlebar-height`, `--ui-sidebar-width`, `--left-dock-material-*`, `data-platform`, native-titlebar, Tauri transparency/window-effect, and focused test occurrence. The DOM has one global titlebar before `main.panel`; the Dock begins inside the later panel, proving that `.left-activity-shell` cannot paint behind the titlebar. `pane.ts` is the only runtime writer of `--ui-sidebar-width`; `main.tsx` only projects collapse onto the existing shell. The material variables exist once in `sidebar.css`; the paint/filter currently exists once on `.left-activity-shell` in `activity.css`. `titlebar.css`, `workspace.css`, and `base.css` deliberately keep their shells transparent after the native-glass repair. |
| Independent-agent feedback | No independent agents were requested, so none were started. |

## Causal chain

1. **Observable:** the Windows screenshot shows a full-width translucent HTML titlebar above a left Dock with a distinct horizontal top edge.
2. **Direct trigger:** the native-glass repair made the titlebar transparent to Windows Mica, but moved the blue-gray Dock material and its inset edge onto `.left-activity-shell`, whose box starts below the titlebar.
3. **Deep cause:** the material owner was selected from the visual label “left Dock” rather than from the actual L-shaped window-chrome topology. The titlebar and Dock therefore became two independently composited samples, and the Dock retained an inset top highlight that advertises their DOM boundary.
4. **Why prior verification missed it:** the platform-material browser fixture rendered `.left-activity-shell` as a full-height standalone column and did not include the real `header.titlebar` followed by `main.panel`. It could prove tint budgets but could not observe the production handoff.
5. **Root repair:** paint the platform material once on an `#overlayAppHost::before` underlay clipped to the full titlebar row plus the left rail below it. Keep titlebar and Dock content transparent, retain only the vertical Dock edge, and let the opaque rounded workspace cover the underlay outside the visible L shape.

## Call-site disposition

| Call site | Decision |
| --- | --- |
| `src/styles/cascade/base.css` `#overlayAppHost` | Keep flex/transparent ownership and add only the positioned isolated stacking context required by its canonical material underlay. |
| `src/styles/surfaces/sidebar.css` platform variables | Preserve the current macOS and Windows/Linux color/image/filter budgets. Remove the obsolete horizontal component from `--left-dock-material-edge`; the variable remains the single vertical rail-edge definition. |
| `src/styles/surfaces/activity.css` | Move background color/image and both backdrop-filter declarations from `.left-activity-shell` to one `#overlayAppHost::before` rule. Clip that layer with existing titlebar, sidebar-width, and workspace-radius tokens. Keep `.left-activity-shell` transparent and retain the vertical edge shadow. Move reduced-transparency paint/filter ownership to the same pseudo-element. |
| `src/styles/surfaces/titlebar.css` | Preserve the transparent titlebar and workspace context bar; they expose the new common material and do not gain a second paint source. |
| `src/styles/surfaces/workspace.css` | Preserve the opaque raised workspace, single top-left radius, and existing left/top diffusion; it clips/covers the common underlay outside the visible chrome. |
| `src/services/pane.ts` / `src/main.tsx` | No new state or branch. Existing `--ui-sidebar-width` writes and `data-collapsed` projection continue to determine layout; the workspace covers the lower underlay when the rail is collapsed. |
| `src/components/App.tsx` | Preserve DOM and interaction ownership. The existing titlebar-before-panel order remains the geometry the underlay bridges. |
| `src-tauri/tauri.conf.json` / `src-tauri/src/main.rs` | Preserve native transparency, Sidebar/Mica effects, macOS menu/traffic lights, and Windows/Linux frameless chrome. No native-process change is required. |
| `test/left-dock-platform-material.test.ts` | Replace the obsolete “Dock box paints material” assertion with one-underlay ownership, transparent titlebar/Dock, L-shaped tokenized clip, vertical-only edge, and reduced-transparency assertions. |
| `test/overlay-architecture-guards.test.ts` | Move the compositor-owner guard from `.left-activity-shell` to the canonical app-host underlay. |
| `test/browser/left-dock-platform-material-browser.test.ts` | Replace the standalone full-height Dock fixture with the production titlebar/panel/Dock/workspace topology, retain all platform/theme computed-style checks, capture task-scoped screenshots, and assert adjacent Windows pixels across the titlebar/Dock handoff have no discontinuity. |
| `test/app-shell.test.ts` / `test/left-work-ledger-shell.test.ts` | Preserve root flex, left-rail width, collapse, and workspace geometry checks; extend only if the new stacking/transparent ownership needs explicit regression coverage. |
| `specs/README.md` / `specs/records/2026-07/README.md` | Index this record as the latest Windows titlebar/Dock material-continuity repair and run the required historical/document-health tests. |

## Verification plan

1. Add focused source assertions for the single clipped underlay and absence of Dock-local material paint/top-edge highlight.
2. Implement the root material owner without changing platform budgets, DOM, native configuration, or pane state.
3. Run the focused Bun source suite, the Node-launched platform browser test, Overlay typecheck/internationalization/build, historical links, and document health.
4. Inspect the Windows light screenshot at original resolution, then inspect the real isolated Overlay preview in the controlled browser. Iterate if any seam, wrong elbow fill, titlebar regression, or clipped workspace corner remains.
5. Re-read the final diff and screenshot as a second review, fetch/merge any newer legacy remote state, commit with the required `dsw-33987` prefix, push the current tracked branch to `legacy-remote`, and verify remote convergence.

## Progress

- [x] Screenshot, history, architecture records, production owners, width/state projection, and test coverage audited.
- [x] Root cause and exhaustive call-site disposition recorded before implementation.
- [x] Regression tests and implementation complete.
- [x] Real browser and isolated Overlay visual acceptance complete.
- [x] Second visual and code review complete.
- [ ] Commit and legacy remote push complete.

## Verification evidence

- Focused shell/source suite: 26 passed, covering app-host ownership, platform material, left Work Ledger shell, titlebar brand strip, native window-control visibility, and workspace-surface continuity.
- Focused architecture owner guard: 1 passed for the canonical primary-column shell chrome contract.
- Node-launched Playwright platform fixture: 1 passed across Windows, macOS, Linux, light, and dark variants; the Windows light handoff pixel delta stayed within the 4-channel acceptance threshold. Six task-scoped screenshots were generated and inspected.
- Real isolated Vite Overlay preview at 1920 by 1080: inspected after loading the production app topology. Geometry was titlebar `y=0, height=36`, Dock `y=36, width=440`, and workspace `x=441, y=36`; the shared underlay used the canonical 440-pixel Sidebar width and rendered without the reported horizontal seam. The missing local backend produced an expected health-request error, so this screenshot is visual evidence rather than a full End-to-End acceptance claim.
- Overlay checks: `bun run typecheck`, `bun run check:i18n`, and `bun run build:vite` passed. The build retained only its existing large-chunk advisory.
- Required historical links audit: 21 passed. The full document-health audit will be repeated after task-scoped files enter the Git index because its monthly-record ownership check intentionally rejects untracked records.
- No OpenCorvus or Overlay process/window owned by the user was stopped, restarted, refreshed, or reused for validation; all visual work ran in isolated processes that were allowed to close normally.
