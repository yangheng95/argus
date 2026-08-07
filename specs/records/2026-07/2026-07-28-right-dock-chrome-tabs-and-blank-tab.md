# Right Dock Chrome tabs and blank-tab gesture

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | Render the right-side tab buttons with the visual effect of Chrome tabs, and create a blank tab when the user double-clicks an empty part of the tab strip. |
| Supplied evidence | `codex-clipboard-28616502-d6ae-4ea4-aed8-8f30c530d164.png` was inspected at original resolution. The requested surface is the right Dock's top tool-tab row: one rounded tab at the left, a broad empty strip, then the existing add and close actions. |
| Acceptance criteria | Right Dock tabs retain Kobalte tab semantics and keyboard behavior while inactive tabs use a quiet Chrome-like hover surface and the active tab becomes a connected raised shape with curved lower shoulders. The selected tab remains visually joined to the Dock body rather than a detached capsule. A double-click on only the empty tab-strip background opens and selects the canonical blank Browser `New tab`; double-clicking a tab, its close action, overflow, add, or Dock close control must not create a tab. Existing single-instance panel identity and overflow behavior remain intact. A real desktop fixture verifies interaction and task-scoped dark/light screenshots are inspected. |
| Hard constraints | Reuse `RightDock`, the shared Kobalte `Tabs` primitive, `openCenterWorkbenchPanel("browser")`, and the existing Browser missing-target `New tab` surface. Do not add a second tab store, duplicate Browser instances, local preview target, iframe, query override, fallback, feature gate, state machine, responsive/mobile scope, or hand-written replacement for Kobalte. Playwright runs through Node. Do not restart, refresh, terminate, or reuse the user's running OpenCorvus/Overlay process. Preserve unrelated worktree changes. |
| Sources read | Root `AGENTS.md`; Browser control skill; supplied screenshot; `RightDock.tsx`; shared `ui/Tabs.tsx` and `primitives/tabs.css`; `main.tsx`; `BrowserPreviewPanel.tsx`; `workspace.css`; `2026-07-14-right-dock-panel-ownership-and-browser-draft.md`; `2026-07-28-right-dock-subagent-tab-standard-typography.md`; focused source and Node-launched browser tests. |
| Whole-repository grep | Production tab identity and rendering are singular: `RightDock.tsx` owns `RIGHT_DOCK_CATALOG`, the tab collection, Kobalte triggers, close/add/overflow actions, and empty launcher; `main.tsx` owns `centerWorkbenchPanels`, open/select/close functions, the one Browser `TabPanel`, and the dynamic Browser title; `BrowserPreviewPanel.tsx` owns the missing-target `New tab` view; `workspace.css` is the only Right Dock tab geometry owner; shared `Tabs.tsx`/`tabs.css` remain unchanged. Direct source assertions are concentrated in `right-dock-panel-ownership.test.ts`, `right-panel-tabs-flat.test.ts`, `tabs-primitive.test.ts`, and `overlay-startup-chrome-parity.test.ts`. Real interaction/overflow/visual coverage is concentrated in `titlebar-toolbar-toggle-browser.test.ts`; adjacent Browser close behavior is covered by `browser-preview-live-input-batch.test.ts`, and other browser tests only select or close existing panel tabs. |
| Independent agent feedback | None. The user did not request sub-agents, so the primary agent owns implementation and the required second review. |
| Git baseline | `work-v0.0.23beta-yr-0728` and `legacy-remote/work-v0.0.23beta-yr-0728` are both at `b0754fdc0c` with zero divergence. Three pre-existing specification/index changes are unrelated and remain unstaged. |

## Causal chain

1. The current Right Dock already uses the correct mature interaction primitive,
   but `workspace.css` paints every tab as an isolated rounded capsule with the
   same hover background in both inactive and selected states.
2. That geometry cannot produce the Chrome relationship in which the active
   tab is raised and visually connected to the content surface through curved
   lower shoulders.
3. The empty strip already belongs to the Kobalte `TabList`, and the canonical
   empty Browser page already exists. The missing behavior is therefore one
   precise gesture projection from the list's own background to the existing
   Browser open callback.
4. Expanding the panel model to arbitrary tab instances would introduce a
   second identity paradigm and duplicate mounted panel bodies. The requested
   blank-tab gesture needs no such architecture change: the existing Browser
   panel is the one task-scoped blank-page owner.

## Call-site disposition

| Owner / consumer | Decision |
| --- | --- |
| `packages/overlay/src/components/RightDock.tsx` | Add a named empty-strip double-click handler that accepts only events whose target is the `TabList` itself, closes both menus, and calls the existing Browser open callback. Preserve Kobalte roles, manual activation, close propagation isolation, overflow measurement, and unique panel identities. |
| `packages/overlay/src/main.tsx` | Preserve `openCenterWorkbenchPanel` as the single tab-state mutation path and the one mounted Browser `TabPanel`; `RightDock.onOpen` already projects directly to it. |
| `packages/overlay/src/components/BrowserPreviewPanel.tsx` | Preserve the existing missing-target blank surface and page-title projection; no local preview or reset state is introduced. |
| `packages/overlay/src/styles/surfaces/workspace.css` | Replace detached capsule geometry with local Chrome-style tab tokens, inactive hover/separator behavior, and selected lower-shoulder pseudo-elements that visually connect to the Dock body. Keep shared Tabs styles unchanged. |
| `packages/overlay/test/right-dock-panel-ownership.test.ts` | Replace the old capsule assertions with source contracts for Kobalte ownership, exact blank-strip targeting, menu dismissal, Browser open projection, and Chrome-style selected geometry. |
| `packages/overlay/test/browser/titlebar-toolbar-toggle-browser.test.ts` | Add real double-click acceptance for the empty strip, negative double-click coverage on a tab, and rendered geometry/color checks; retain existing keyboard, close, add, and overflow coverage. Capture and inspect focused dark/light screenshots. |
| Other Right Dock and Browser tests | Preserve. They cover mounted ownership, existing add/close paths, panel content, browser native lifecycle, or overflow behavior not changed by this task. |

## Implementation and verification plan

1. Update the focused source/browser expectations and observe the old behavior
   fail where practical.
2. Add the exact-target double-click projection in `RightDock` and replace only
   the local Right Dock tab styling with the connected Chrome geometry.
3. Run focused source tests, Overlay typecheck/build, and the Node-launched real
   browser fixture. Inspect task-scoped dark/light screenshots at original
   resolution and iterate on visual evidence.
4. Run documentation health checks, inspect the exact task diff, and repeat
   focused checks for the required second review.
5. Stage only task-owned hunks, commit with the `dsw-33987` prefix, fetch and
   converge with `legacy-remote`, then push through normal hooks.

## Progress

- [x] Recall, causal chain, and full call-site inventory recorded.
- [x] Regression expectations and implementation complete.
- [x] Real browser interaction and screenshot acceptance complete.
- [x] Second review, commit, convergence, and legacy remote push complete.

## Verification evidence

| Surface | Evidence |
| --- | --- |
| Focused source contracts | `bun test packages/overlay/test/right-dock-chrome-tabs.test.ts packages/overlay/test/right-dock-panel-ownership.test.ts packages/overlay/test/right-panel-tabs-flat.test.ts packages/overlay/test/tabs-primitive.test.ts packages/overlay/test/overlay-startup-chrome-parity.test.ts` passed after concurrent branch updates with 21 tests, 0 failures, and 330 assertions. |
| Static validation | `bun run --cwd packages/overlay typecheck` passed. |
| Production bundle | `bun run --cwd packages/overlay build:vite` passed after transforming 7,056 modules; only the existing directive and chunk-size warnings were emitted. |
| Real interaction | `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/titlebar-toolbar-toggle-browser.test.ts` passed both desktop browser subtests. It exercised the existing add/close/keyboard/overflow paths, double-clicked the actual empty `TabList` area to open the canonical blank Browser panel, and proved that double-clicking a populated tab does not open Browser. |
| Rendered geometry | The browser fixture asserted the selected tab and Dock body share the active surface token, the selected tab ends at the header bottom, both lower radii are zero, and both lower-shoulder pseudo-elements render their connecting shadows. |
| Visual review | Dark and light task-scoped screenshots were inspected at original resolution: `.scratch/right-dock-dark-chrome-active-tab.png`, `.scratch/right-dock-light-active-tab-layer.png`, and `.scratch/right-dock-browser-double-click-new-tab.png`. The active tab reads as a raised Chrome tab connected to the Dock body in both themes, and the double-click result is the existing blank `New tab` Browser surface. |
| Documentation health | `historical-docs-links.test.ts` and `product-docs-single-source.test.ts` passed. `document-health.test.ts` has one concurrent-worktree failure because the shared July README currently links six untracked records owned by other active tasks; this task's tracked record is not an offender. |
| Git delivery | Implementation commit `09aace4251` (`dsw-33987 implement Right Dock Chrome tabs`) passed the normal pre-push SDK import, AI runtime, workspace typecheck, API route, generated docs, Overlay i18n, and secret-scan checks, then pushed to `legacy-remote/work-v0.0.23beta-yr-0728`. |

## Second review

- The gesture uses exact `event.target === event.currentTarget` ownership, so
  bubbling double-clicks from a tab or any child control cannot create Browser.
- `RightDock` still delegates to its existing `onOpen("browser")` callback;
  `main.tsx` remains the only panel identity/state owner and
  `BrowserPreviewPanel` remains the only blank-page implementation.
- The visual change is local to the Right Dock and keeps the shared Kobalte
  primitive, ARIA semantics, manual activation, focus path, overflow
  measurement, and single-instance panel behavior intact.
- The inspected diff contains adjacent concurrent Right Dock overflow and
  Subagent work. Those hunks are not part of this task and must remain outside
  this task's implementation commit.
