# macOS traffic-light zoom alignment

## Recall

| Item                       | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User request               | “mac上的三大金刚键对齐崩了”. The supplied 364 by 96 Retina crop shows the AppKit close, minimize, and zoom centers around 10 physical pixels above the sidebar/navigation controls.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Acceptance criteria        | At the persisted 125 percent interface zoom, the AppKit traffic lights, sidebar toggle, and back/forward controls share one vertical center line. The same titlebar remains aligned across the supported 80 to 160 percent zoom range. macOS keeps exactly one AppKit-overlay titlebar; Windows, Linux, and browser titlebar geometry remains unchanged.                                                                                                                                                                                                                                                                                                                                               |
| Hard constraints           | Preserve AppKit as the sole macOS window-control owner. Do not add simulated traffic lights, another titlebar, a fixed-position guess for the current zoom, a runtime decoration mutation, a fallback path, or UI automation. Do not restart, refresh, close, or modify the user's running Overlay. Preserve every unrelated worktree deletion and untracked artifact.                                                                                                                                                                                                                                                                                                                                 |
| Supplied and live evidence | `/var/folders/bj/6vby7ld11796l5bfdmc7s8l40000gn/T/codex-clipboard-65943137-eaf9-4b97-8c66-d4e8605ce298.png` was inspected at original resolution. The read-only persisted settings file reports `zoom: 1.25`. The native traffic-light position remains the construction-time `{ x: 10, y: 20 }` previously measured against the canonical 36-logical-pixel row.                                                                                                                                                                                                                                                                                                                                       |
| Sources read               | Root `AGENTS.md`; Browser skill; `specs/current/architecture/07-panel.md`; the July 16 single-visible-titlebar and July 17 traffic-light centering records; memory summary and the prior single-titlebar rollout; current `tauri.conf.json`, Rust startup, `App.tsx`, `WindowControls.tsx`, `TitlebarNavigation.tsx`, theme/zoom service, titlebar/design/button/icon CSS, and the read-only Overlay settings file.                                                                                                                                                                                                                                                                                    |
| Whole-repository grep      | `rg` enumerated every `trafficLightPosition`, `titleBarStyle`, `hiddenTitle`, `data-native-titlebar`, `--ui-titlebar-height`, `--ui-scale`, `applyZoom`, titlebar component, and window-control occurrence. `tauri.conf.json` is the sole native traffic-light coordinate owner. `theme.ts::applyZoom` is the CSS scale writer and is called by hydrated settings, titlebar zoom actions, hotkeys, and resize projection. `App.tsx` owns the one titlebar row. `titlebar.css` owns its geometry. `design-language.css` currently multiplies the 36px titlebar height and all titlebar control dimensions by `--ui-scale`. Existing UI test files were identified but will neither be modified nor run. |
| Independent feedback       | The user did not request multiple independent agents, so the primary Agent owns implementation and second review.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Baseline                   | `HEAD` and `legacy-remote/v0.0.27beta` both resolved to `463d534bee3e3b04fdf95a6b4870447ae1695f8c`; the pre-change push passed repository hooks and reported everything up to date.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Root cause

The July 17 native measurement aligned AppKit's fixed logical traffic-light
container to a 36-logical-pixel Web titlebar. The application zoom system later
projects the persisted `zoom` through `--ui-scale`, and
`--ui-titlebar-height: calc(36px * var(--ui-scale))` scales the Web row while
AppKit keeps the construction-time native coordinate. At the user's 125 percent
zoom the Web row becomes 45 logical pixels, moving its center down by 4.5
logical pixels, which is approximately the 9 to 10 physical-pixel Retina delta
visible in the supplied crop. The lifecycle, titlebar ownership, and individual
button alignment are intact; their two coordinate systems no longer share the
same zoom boundary.

Changing `trafficLightPosition.y` would align only one zoom level and regress
the previously measured 100 percent geometry. Runtime AppKit repositioning
would add a second geometry protocol to a chrome surface that should remain
native-sized. The root repair is to keep the macOS titlebar chrome at its
canonical native 36px geometry while application content continues to zoom.

## Call-site decisions

| Owner / call site                                             | Decision                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/styles/surfaces/titlebar.css`                            | On `html[data-native-titlebar="macos"]`, keep `--ui-titlebar-height` at the canonical 36px and keep the titlebar's chip, icon, cluster, and navigation geometry at the same native-scale values. The selector is an existing host projection, not a new runtime source. |
| `src/styles/tokens/design-language.css`                       | Preserve the general scalable tokens for browser, Windows, Linux, and application content. Do not create a parallel global scale.                                                                                                                                       |
| `src-tauri/tauri.conf.json`                                   | Preserve `{ "x": 10, "y": 20 }`, `hiddenTitle`, and `titleBarStyle: "Overlay"`; the construction-time AppKit geometry remains correct for the canonical row.                                                                                                            |
| `src/services/theme.ts` and all `applyZoom` callers           | Preserve. Zoom continues to scale application content; CSS isolates only AppKit-coupled chrome geometry.                                                                                                                                                                |
| `App.tsx`, `TitlebarNavigation.tsx`, and `WindowControls.tsx` | Preserve the single titlebar composition and mutually exclusive AppKit versus application-control ownership.                                                                                                                                                            |
| Existing UI automation files                                  | Do not modify or run. UI acceptance uses real-page interaction and manually inspected screenshots only.                                                                                                                                                                 |

## Implementation and verification plan

1. Add the macOS native-titlebar scale boundary to the existing titlebar owner,
   without changing global application zoom or native window construction.
2. Run formatting, Overlay TypeScript typecheck/build, Rust checking, document
   health, historical-link validation, and `git diff --check`; do not run UI
   tests.
3. Start an isolated real Vite page with Node-owned browser control. Project the
   existing macOS host attribute, inspect 80, 100, 125, and 160 percent zoom,
   capture task-scoped screenshots, and personally review control centerlines
   and surrounding titlebar composition.
4. Build and launch an isolated macOS application/config home, capture the real
   AppKit traffic lights at the user's 125 percent zoom, inspect the native
   screenshot, and stop only that isolated process. Do not touch the user's
   running Overlay.
5. Re-read every changed file and complete-diff, update this record with exact
   evidence, then commit only task-owned paths with the `dsw-33987` prefix and
   push `v0.0.27beta` to `legacy-remote`.

## Progress

- [x] Root cause, exhaustive ownership inventory, baseline sync, and acceptance
      plan recorded before implementation.
- [x] macOS titlebar scale boundary implemented.
- [x] Compilation, real-page, and isolated native visual acceptance completed.
- [x] Second review completed; the task-owned commit and legacy remote push follow
      this saved review.

## Verification

- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay build`: passed after transforming 7,062
  modules; only the existing third-party `use client` and large-chunk
  advisories were emitted.
- `cargo check --manifest-path packages/overlay/src-tauri/Cargo.toml`: passed.
- `bun run docs:check`: passed with 311 operations in 24 groups.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`:
  2 passed, 0 failed.
- `bun test packages/opencorvus/test/script/document-health.test.ts`: 62
  passed, 0 failed after task-owned record paths were staged. The first run's
  sole failure correctly reported the new record as untracked.
- `git diff --check`: passed.
- A Node-started isolated Vite page at `http://127.0.0.1:5187/` was operated
  through the real View / Zoom control. At 125 percent the retained browser
  titlebar measured 45px; sidebar and navigation centers were 22.5px and
  22px, confirming that non-native hosts retain their scalable geometry. The
  manually inspected screenshot is
  `specs/artifacts/2026-07-31-macos-traffic-light-zoom-alignment/browser-host-titlebar-125-zoom-boundary.png`.
- `bunx tauri build --debug --config
'{"identifier":"ai.opencorvus.overlay.zoom-qa"}'` produced an isolated,
  ad-hoc-signed macOS application. Its separate application-data directory was
  seeded with `zoom: 1.25`, an offline port, and `autoServer: false`; it did not
  attach to or restart the user's running Overlay or backend.
- Computer Use opened the isolated `tauri://localhost` application and exposed
  the real AppKit close, full-screen, and minimize accessibility controls. The
  original-resolution screenshot
  `specs/artifacts/2026-07-31-macos-traffic-light-zoom-alignment/native-macos-titlebar-125.png`
  was personally inspected: the traffic lights, sidebar toggle, back action,
  and forward action share the same vertical center; application content is
  visibly enlarged; there is exactly one titlebar row.
- The isolated application was quit through its own macOS process. A fresh app
  inventory confirmed `ai.opencorvus.overlay.zoom-qa` changed to
  `isRunning: false`. The Node-owned Vite server and browser tabs were also
  closed.
- During final review, an independent shared-worktree process advanced `HEAD`
  from the recorded baseline to `8310bf69a8` and incorporated the already
  staged CSS, indexes, and initial record into its broader checkpoint commit.
  That concurrent commit was preserved without amend, reset, or history
  rewrite; the final screenshots and verification update remain isolated in
  this task's following commit.
- No UI automated test was added, modified, updated, or run.
