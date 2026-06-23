# Screenshot Browser Defer Initial Measure

Date: 2026-06-22
Status: Implemented

## Acronyms

- GUI: Graphical User Interface, the browser-rendered overlay surface.
- UI: User Interface, visible controls and layout surfaces.
- RAF: Request Animation Frame, the browser API used to run visual work once per frame.
- DOM: Document Object Model, the browser element tree.

## Task Definition

Remove the remaining synchronous width measurement and split center workbench
RAF layout owner from screenshot toolbar open while preserving the existing
virtualized screenshot browser source, grouping, and lazy thumbnail loading.

## Live Evidence

- `http://127.0.0.1:7878/ui/index.html` currently serves old embedded assets
  `./assets/index-UQD58TVp.js` and `./assets/index-CuZLxk6G.css`.
- Current workspace `packages/overlay/dist-vite/index.html` serves
  `/assets/index-DavafFyF.js` and `/assets/index-BFbwO40P.css`.
- Port `7878` is owned by the extracted desktop sidecar process under
  `%LOCALAPPDATA%/ai.opencorvus.overlay/embedded/.../opencorvus.exe`.
- The live 7878 sample has one screenshot card; opening screenshots took about
  430ms to first card and viewport resize samples took about 316-536ms.

## Recall

| Source                                                               | Constraint carried forward                                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `AGENTS.md`                                                          | No fallback, no duplicate source, test every change, and visually verify UI work.                            |
| `2026-06-22-screenshot-browser-open-jank.md`                         | Screenshot Browser uses `virtua/solid`, lazy thumbnail loading, and shared `PreviewableImage`.               |
| `2026-06-22-screenshot-browser-bounded-card-collector.md`            | Card tree remains the single screenshot source; data derivation is bounded.                                  |
| `2026-06-22-center-workbench-deferred-reveal-single-layout-owner.md` | Layout-affecting panel-open work should run through the shared RAF scheduler.                                |
| Independent GUI audit 2026-06-22                                     | Center workbench reveal and layout were still split across two RAF callbacks.                                |
| Independent serving audit 2026-06-22                                 | Running `7878` is an immutable old packaged sidecar; do not add workspace-dist fallback to packaged runtime. |

## Call Point Inventory

| Surface                 | Evidence                                                                                                                 | Decision                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Screenshot panel mount  | `ScreenshotBrowserPanel.tsx` creates `measureOnFrame`, then calls `measure()` before installing `ResizeObserver`.        | Remove the direct call and rely on the scheduled RAF measure.                                               |
| Resize observer         | The same component already uses `new ResizeObserver(measureOnFrame.schedule)`.                                           | Keep this as the single measurement timing path.                                                            |
| Column count            | `columnCount()` returns one column until `listWidth()` is measured.                                                      | Keep this transient initial state; RAF updates it before visual settling.                                   |
| Browser test            | `screenshot-browser-panel-browser.test.ts` already instruments screenshot toolbar open before RAF.                       | Extend instrumentation to prove `.screenshot-browser-groups.clientWidth` is not read before RAF.            |
| Static test             | `resize-observer-frame-scheduler.test.ts` guards observer callback scheduling.                                           | Add a guard against direct initial `measure()` before observer setup.                                       |
| Center workbench reveal | `scheduleCenterWorkbenchPanelReveal()` used an independent RAF scheduler from `renderCenterWorkbenchPanelLayoutOnFrame`. | Use the existing center workbench layout frame as the single owner; run layout before reveal in that frame. |
| Running 7878            | Embedded sidecar serves old asset names from compiled `opencorvus.exe`.                                                  | Record as runtime artifact parity issue; reject runtime fallback to workspace `dist-vite`.                  |

## Root Cause

The screenshot browser jank work moved thumbnail rendering, thumbnail fetching,
and observer callbacks off the immediate open path. Two layout-affecting paths
remained. First, a synchronous initial `measure()` read `element.clientWidth`
immediately after the panel DOM was mounted, which can force layout during the
toolbar click task. Second, center workbench reveal and panel layout used two
independent RAF callbacks, so `scrollIntoView()` could resolve geometry in a
different frame from weight/separator writes.

## Fix Plan

1. Delete the direct `measure()` call in `ScreenshotBrowserPanel`.
2. Keep `measureOnFrame.schedule()` as the initial measurement and observer
   callback path.
3. Replace the independent reveal RAF scheduler with the existing center
   workbench layout frame; run `renderCenterWorkbenchPanelLayout()` before
   `revealPendingCenterWorkbenchPanel()`.
4. Extend static tests to reject direct initial measure before observer setup
   and reject a second reveal scheduler.
5. Extend the real browser screenshot toolbar test to instrument list
   `clientWidth` reads and require zero reads before RAF.
6. Rerun focused unit/static tests, overlay typecheck/build, browser screenshot
   test, and visual screenshot review.

## Acceptance

- Opening screenshots does not synchronously read `.screenshot-browser-groups.clientWidth`.
- Initial screenshot list measurement happens through the shared RAF scheduler.
- Center workbench reveal happens in the same RAF callback as layout, after
  weights and separators are rendered.
- Virtualized rows, lazy thumbnail loading, grouping, and shared image preview remain unchanged.
- No fallback layout, alternate screenshot source, iframe, local storage, or duplicate toolbar is introduced.

## Verification

- `bun test packages/overlay/test/resize-observer-frame-scheduler.test.ts packages/overlay/test/screenshot-browser-panel.test.ts packages/overlay/test/acceptance-panel-mount.test.ts packages/overlay/test/browser-preview-panel.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/center-workbench-separator-browser.test.ts`
- Browser runner rebuilt `packages/overlay/dist-vite` with Vite and passed the
  real screenshot panel benchmark and center workbench separator check.
- Visual QA: viewed `.scratch/screenshot-browser-panel-browser.png` and
  `.scratch/screenshot-browser-panel-browser-narrow-panel.png`; desktop and
  narrow screenshot panel layouts remain readable without clipping. Viewed
  `.scratch/center-workbench-separator-focus.png`; the workbench split layout
  remains coherent after the shared-frame reveal change.

## Self Review

- Rechecked `ScreenshotBrowserPanel.tsx`; initial measurement now only happens
  through `measureOnFrame.schedule()`, and `ResizeObserver` uses the same
  scheduler.
- Rechecked browser test instrumentation; it overrides RAF before the toolbar
  click and proves both `scrollIntoView` and `.screenshot-browser-groups`
  `clientWidth` reads are zero before RAF, then confirms both happen after RAF.
- Rechecked `main.tsx`; center workbench layout and reveal now share one RAF
  owner, and reveal runs after panel weights and separators are rendered.
- Rechecked screenshot source and rendering contracts; card tree source,
  `virtua/solid`, `IntersectionObserver`, `PreviewableImage`, and attachment
  request bounds are unchanged.
