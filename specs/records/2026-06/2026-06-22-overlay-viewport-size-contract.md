# Overlay Viewport Size Contract

Date: 2026-06-22
Status: Verified

## Acronyms

- GUI: Graphical User Interface, the visible overlay surface.
- UI: User Interface, visible controls and layout surfaces.
- CSS: Cascading Style Sheets, the browser layout and styling language.
- RAF: Request Animation Frame, the browser callback used to run visual work once per frame.

## Task Definition

Prevent illegal overlay window sizes and illegal pane widths from entering the
operable layout. The immediate evidence is the live `7878` overlay at `700px`
wide, where resize leaves titlebar/project chrome overlapped and makes
toolbar/panel operations feel stuck.

## Recall

| Source                                            | Constraint carried forward                                                                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AGENTS.md`                                       | No fallback logic, no duplicate source, no blind patches, test every change, visually verify UI work, and commit/push every round.                                                   |
| `2026-06-22-overlay-resize-frame-coalescing.md`   | Resize work is already frame-coalesced; do not add debounce/gate paths.                                                                                                              |
| `2026-06-22-window-resize-center-layout-frame.md` | Center workbench layout has one RAF owner.                                                                                                                                           |
| `2026-06-22-pane-semantics-layout-frame.md`       | Pane layout and ARIA semantics remain owned by `services/pane.ts`.                                                                                                                   |
| Live 7878 visual evidence                         | `700x720` viewport shows titlebar wordmark/menu overlap and crowded project chrome.                                                                                                  |
| Archimedes read-only audit                        | `.titlebar-brand` is forced to `32px` at `max-width: 760px`, while `.brand-guide-copyblock` stays visible until `520px`.                                                             |
| Zeno read-only audit                              | `900px` is below the generated `1120px` desktop layout boundary from `tauri.conf.json`; native overlay should reject that geometry instead of treating it as a valid full workbench. |

## Call Point Inventory

| Surface                 | Evidence                                                                                                                                                         | Decision                                                                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native window creation  | `packages/overlay/src-tauri/tauri.conf.json` sets `width`, `height`, `minWidth`, and `minHeight`.                                                                | Raise native min dimensions to the desktop layout contract and keep the config as the creation-time source.                                                         |
| Native startup sizing   | `packages/overlay/src-tauri/src/main.rs` independently clamps startup size to `760..1600` and `480..920`.                                                        | Read the configured `main` window minimum from `tauri.conf.json` through `app.config()` and use a pure size-contract helper.                                        |
| Native resize           | `main.rs` currently only handles `RunEvent::Exit`; Windows has a `WM_SIZING` pre-commit hook in the later aspect-frame follow-up.                                | Enforce native aspect before commit only where the OS/Tauri stack exposes a supported hook; do not add a post-resize `set_size()` feedback loop on other platforms. |
| Browser shell sizing    | `base.css` owns the body shell.                                                                                                                                  | Add overlay minimum viewport dimensions so browser/dev fixtures cannot compress the workbench below the desktop contract.                                           |
| Layout tokens           | `design-language.css` owns structural layout tokens.                                                                                                             | Add overlay viewport and center workbench panel minimum tokens here.                                                                                                |
| Pane layout             | `services/pane.ts` uses hardcoded `120 * scale` and `300 * scale` floors while tokens already define `--ui-rail-min-width` and `--ui-chat-min-width`.            | Resolve layout tokens from CSS and remove the smaller hardcoded floors.                                                                                             |
| Center workbench panels | `main.tsx` uses `CENTER_WORKBENCH_MIN_PANEL_WIDTH = 128`; `workspace.css` uses `280px` for compact open panel width.                                             | Route both through one `--ui-workbench-panel-min-width` token.                                                                                                      |
| Titlebar compact chrome | `titlebar.css` hides the brand label at `760px` but hides the whole copyblock only at `520px`.                                                                   | Compact titlebar mode must hide the copyblock at the same `760px` breakpoint that constrains the brand slot.                                                        |
| Tests                   | `titlebar-menubar.test.ts`, `pane-config.test.ts`, `resize-observer-frame-scheduler.test.ts`, and `left-pane-resizer-browser.test.ts` cover pieces of this area. | Add static contract tests and browser geometry/screenshot coverage for the illegal-width visual regression.                                                         |

## Root Cause

The overlay currently has three incompatible size rules:

1. Native creation allows a `900x480` window, which is narrower than the existing `1120px` desktop layout boundary.
2. Native startup sizing independently allows `760px` width.
3. Pane layout still permits rail/chat widths far below the design tokens.

That lets resize place the workbench into an unsupported geometry. The
titlebar's `760px` compact CSS then creates a second defect by shrinking the
brand slot to icon width while leaving the wordmark visible.

## Fix Plan

1. Set native minimum dimensions to the operable desktop workbench contract:
   `1120x720`.
2. Add a pure Rust size helper that applies configured min dimensions plus a
   minimum aspect ratio derived from them.
3. Change startup sizing and Windows live sizing to use that helper without
   reintroducing resize-event feedback.
4. Add CSS overlay viewport tokens and apply them to the shell.
5. Add a layout-token resolver for JS/TS code that needs pixel values from CSS
   tokens.
6. Use token-resolved rail/chat/workbench panel minimums in pane and center
   workbench resize logic.
7. Hide the brand guide copyblock at the `760px` titlebar compact breakpoint.
8. Add static and browser tests, then capture and inspect screenshots at
   `1120x720` and `1280x760`. Existing narrower browser cases remain
   component-responsive coverage, not legal native overlay sizes.

## Acceptance

- The native overlay minimum window dimensions are `1120x720`.
- Startup sizing cannot choose a width/height below the configured native
  minimum.
- Windows native resize cannot leave the overlay below the minimum aspect ratio
  implied by `1120x720`; other platforms rely on the browser legal shell unless
  a verified native pre-commit aspect API is added.
- Browser/dev shell layout has matching minimum viewport tokens.
- Pane layout no longer contains the `120 * scale` rail floor or `300 * scale`
  chat floor.
- Center workbench panel minimum width is token-owned.
- `1120x720` browser visual evidence shows the full workbench without titlebar,
  project chrome, or pane overlap; narrower component coverage is explicitly
  classified as non-native responsive behavior.
- Focused unit tests, browser visual tests, typecheck, self-review, commit, and
  push pass.

## Verification Plan

- `bun test packages/overlay/test/overlay-window-size-contract.test.ts packages/overlay/test/pane-config.test.ts packages/overlay/test/titlebar-brand-guide-primitive.test.ts packages/overlay/test/workspace-surface-consistency.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/titlebar-menubar.test.ts packages/overlay/test/browser/left-pane-resizer-browser.test.ts`
- Visual QA of the screenshots written by the browser tests.

## Verification Result

- PASS: `bun test packages/overlay/test/overlay-window-size-contract.test.ts packages/overlay/test/pane-config.test.ts packages/overlay/test/titlebar-brand-guide-primitive.test.ts packages/overlay/test/workspace-surface-consistency.test.ts --timeout 30000`.
- PASS: `cargo test --manifest-path packages/overlay/src-tauri/Cargo.toml overlay_window_size -- --nocapture`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/titlebar-menubar.test.ts packages/overlay/test/browser/left-pane-resizer-browser.test.ts`.
- Visual QA reviewed:
  `.scratch/overlay-minimum-1120-full.png`,
  `.scratch/titlebar-compact-700-component.png`,
  `.scratch/titlebar-top-level-menus.png`,
  `.scratch/left-pane-resizer-desktop-resize.png`, and
  `.scratch/left-pane-resizer-component-compact-resize.png`.

## Self Review

- The `1120x720` native minimum follows the generated Tauri config legal
  frame and removes the old `900x480`/`760x480` illegal native geometry.
- Pane and center workbench minimums now resolve from layout tokens, removing
  `120 * scale`, `300 * scale`, `128`, and `80 * scale` independent width
  sources.
- The 520px brand copyblock hide rule was removed as dead CSS after moving the
  rule to the 760px compact titlebar breakpoint.
- Browser component tests below `1120px` remain classified as responsive
  component coverage, not legal native overlay sizes.
