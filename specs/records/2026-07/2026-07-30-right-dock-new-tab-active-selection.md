# Right Dock New-Tab Active Selection Repair

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User requirement | In the Right Dock `+` menu shown in the supplied screenshot, a newly opened page must immediately become the active page. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-fba1b29f-5e18-4401-bcf5-d8305165506d.png` was inspected at original resolution. It shows the real Right Dock with `目标`, `需求`, and an Agent conversation tab already open while the add-tool menu is visible. |
| Acceptance criteria | Selecting any unopened fixed tool from the add menu closes the menu, keeps the new tab visible, gives that exact tab the selected Kobalte state, and shows that tab's body immediately. Creating an additional Browser tab continues to select the new Browser instance. Existing tab order, overflow, close, selection, and Browser instance identity remain intact. |
| Hard constraints | Preserve Kobalte Tabs and DropdownMenu, the shared Button/Icon primitives, `centerWorkbenchPanels` as the sole business collection, last-entry active ownership, unique Browser instance IDs, and pre-registered trigger identity. Do not add a second active signal, timer, retry, stale-selection filter, gate, state machine, compatibility branch, local override, fixture, screenshot baseline, or User Interface (UI) automated test. Do not add, modify, update, delete, or run existing UI tests. Browser interaction uses the Node.js Browser sidecar, not Bun. Preserve unrelated dirty worktree changes. |
| Sources read | Root `AGENTS.md`; Browser control skill; supplied screenshot; `specs/current/architecture/12-overlay-card-system.md`; `2026-07-17-overlay-primitive-system-convergence.md`; `2026-07-29-right-dock-codex-parity-and-browser-tab-instances.md`; `2026-07-29-right-dock-chrome-adaptive-tab-width.md`; `packages/overlay/src/main.tsx`; `RightDock.tsx`; shared `Tabs.tsx`; and primitive/right-dock styles. |
| Whole-repository grep | `main.tsx` is the sole production owner of `centerWorkbenchPanels`, `selectedCenterWorkbenchTab`, `openCenterWorkbenchPanel`, `openBlankBrowserTab`, `activateCenterWorkbenchTab`, and `rightDockTabPanels`. `RightDock.tsx` is the sole production owner of `tabCollection`, `ALL_RIGHT_DOCK_PANELS`, fixed-tool add/empty launchers, overflow selection, and Kobalte `Tabs` wiring. `Tabs.tsx` is the sole wrapper around Kobalte Tabs. Existing Overlay source-string, browser, DOM, and screenshot tests were identified but are prohibited from modification or execution for this UI behavior task. |
| Real pre-fix reproduction | The real Vite Overlay at `http://127.0.0.1:5173/` used the current main OpenCorvus backend. Opening `目标` from the empty Dock correctly selected it. Opening `需求` next through the real `+` menu closed the menu but left `目标` with `aria-selected="true"` and `tabindex="0"`; `需求` had `aria-selected="false"` and `tabindex="-1"`, and `centerWorkbenchGoals` remained the active body. No fixture, test hook, local signal, query override, or synthetic record was used. |
| First correction review | Keying the fixed-tool collection by stable strings repaired both `需求` and `架构` in the real page, but opening a new Browser instance still restored `目标`. The new Browser tab appeared with its unique `browser:<UUID>` identity, yet `目标` remained selected and its body active. This proves the first correction covered replacement of fixed placeholders but not registration of a genuinely new dynamic key. |
| Independent review | Claude Code `2.1.147` was invoked from the repository root with only `Read,Grep,Glob`, no session persistence, streaming output, and explicit prohibitions on edits, UI tests, delegation, and worktrees. It exited before reading the repository because the local command-line interface is not authenticated (`Not logged in`). No Claude finding is claimed; the primary Agent owns the evidence-based repair and second review. |
| Git baseline | Initial inspection found branch `work-v0.0.24beta-yr-0729` and `legacy-remote/work-v0.0.24beta-yr-0729` at `e7d299d5c1`. While this Recall was being prepared, the existing Sub-Agent tab/menu work was independently committed and pushed as `0428cc1123`; the current branch and remote then converged at that commit. Remaining pre-existing shared-button and delegated-context-record edits are unrelated and must stay excluded from this task's selective commits. |

## Causal Chain

1. `main.tsx` already expresses the required business behavior correctly:
   opening a fixed panel removes its prior entry and appends it, while
   `selectedCenterWorkbenchTab` defines the last entry as active.
2. The real page disproves a missing `openCenterWorkbenchPanel` call: the new
   `需求` entry and tab both appear, but Kobalte immediately restores the
   previous `目标` selection. The only production path that can move `目标`
   back to the collection tail is `Tabs.onValueChange -> props.onSelect ->
   selectRightDockTab -> activateCenterWorkbenchTab`.
3. The July primitive-convergence repair intentionally kept the finite fixed
   trigger collection mounted so controlled selection could not advance before
   a new trigger registered.
4. The later Browser-instance refactor changed `tabCollection` from stable
   primitive panel IDs to `RightDockTab` objects. Every closed-tool projection
   creates a fresh `{ id, panel }` object, and opening a tool replaces that
   placeholder with the different parent-owned object. Solid's keyed `For`
   therefore unregisters and remounts the trigger even though its business ID
   is unchanged. Stable string keys repair this fixed-tool regression.
5. A new Browser instance has no finite catalog key to pre-mount. The first
   correction's real-page review proved that advancing controlled selection to
   its fresh UUID in the same update that registers its trigger reproduces the
   same missing-key branch.
6. Kobalte's local `tabs-root.tsx` is the direct trigger: its effect observes
   collection and controlled selection together; when
   `!collection.getItem(selectedKey)`, it selects the first enabled collection
   item and publishes that key through `onChange`. Filtering that callback
   would hide the race rather than repair it.
7. The root repair is one pre-registered next-Browser identity derived by
   `RightDock` from the current open Browser-ID set. Every Browser launcher
   passes that reserved UUID to the sole parent collection writer; when it
   opens, the existing trigger keeps the same key while `RightDock` derives
   and mounts the next reservation. Fixed tools remain keyed by stable panel
   IDs. No additional active state or delayed correction is required.

## Codex Review Feedback

The first plan claimed unique dynamic Browser IDs could remain unchanged after
fixed tools moved to stable string keys. Real Browser interaction rejected that
claim: fixed `需求` and `架构` activated correctly, but a new Browser UUID still
lost selection to `目标`. The plan is revised before the final implementation
to cover both trigger-identity classes and records the exact Kobalte source
branch instead of treating the first partial result as accepted.

## Complete Call-Site Disposition

| Owner or consumer | Decision |
| --- | --- |
| `packages/overlay/src/components/RightDock.tsx` | Change fixed mounted collection identity from freshly allocated tab objects to stable string IDs. Derive and pre-register one next blank-Browser UUID from the open Browser-ID set, pass that exact ID through every Browser launcher, and resolve current tab metadata by ID. Keep `props.tabs`, `props.active`, Kobalte Tabs, and add/overflow menus unchanged. |
| `packages/overlay/src/main.tsx` | Preserve its ordered collection and last-entry active contract. Change the sole blank-Browser writer to accept the pre-registered ID supplied by `RightDock` instead of generating the ID after the launch event. |
| `packages/overlay/src/components/ui/Tabs.tsx` and primitive styles | Keep unchanged. Kobalte's controlled Tabs contract and the shared design system are correct when trigger identity remains mounted. |
| Browser panel/native ownership | Keep unchanged. New Browser tabs already receive unique IDs and the repair retains those exact IDs as collection keys. |
| Existing Overlay UI tests | Do not add, modify, update, delete, or run. UI acceptance is a real-page interaction, exact selected/body inspection, screenshots, and personal visual review. |
| Current architecture and prior July records | Keep unchanged. This record repairs a regression against the already-documented stable finite trigger collection; it does not introduce a new architecture. |

## Implementation And Verification Plan

1. Commit and push this Recall and index update before product edits.
2. Make `RightDock` render fixed triggers from stable IDs, keep one derived
   next-Browser identity registered, pass that identity to the sole parent
   Browser writer, and resolve each tab's reactive metadata by ID.
3. Run Overlay typecheck, localization validation, production Vite build,
   historical-document link health, relevant documentation health, and
   `git diff --check`; do not run UI tests.
4. Reload the real desktop page. Starting with one active tool, use the actual
   `+` menu to open at least two distinct fixed tools and create a new Browser
   tab. After every action, inspect the exact selected tab and active body,
   capture the affected Dock, and personally review it.
5. Re-grep the complete owner set, review the exact diff and screenshot a
   second time, update this record with delivery evidence, selectively commit
   only task-owned paths/hunks, fetch, push to `legacy-remote`, and verify remote
   convergence.

## Progress

- [x] Screenshot, source owners, prior architecture records, full call-site
      grep, Git baseline, and real pre-fix interaction inspected.
- [x] Authentication-blocked Claude Code read-only review attempt recorded.
- [x] Recall commit and legacy remote push complete.
- [x] Product correction, targeted typecheck/build, and exact-diff verification
      complete; the final whole-worktree i18n check is waiting on an unrelated
      concurrent Image Preview locale cleanup.
- [x] Real-page interaction, screenshot review, and second review complete.
- [x] Final record update and task-owned product commit complete.
- [x] Final legacy remote push and remote convergence complete.

## Delivery Evidence

- Recall commit `797f205f71` passed the normal pre-push hook and was pushed to
  `legacy-remote/work-v0.0.24beta-yr-0729` before product edits.
- Product commit `7da4ebe62b` contains only the two product owners, this
  delivery record, and the reviewed real-page screenshot; the concurrent
  `main.tsx` formatting hunk was excluded by selective staging.
- The normal final pre-push hook passed full-repository typecheck, route
  inventory, generated documentation, localization, and secret scanning. A
  concurrent push advanced the legacy remote branch to `9cc25ef34b` first; explicit
  ancestor checks confirmed both task commits were already present there.
- Fixed-tool regression path: in the real completed Work conversation
  `修复公开开源项目缺陷`, `目标` was active first. Selecting `需求` from the
  actual `+` menu closed the menu, changed the selected trigger to
  `requirements`, and made the exact Requirements body active. The earlier
  review also proved the same behavior for `architect`.
- Dynamic path: selecting Browser created
  `browser:601c5c31-288b-4131-92f2-b3363cc5326c` and selected it immediately.
  Reopening the real `+` menu created the independent second instance
  `browser:73908919-0e62-4467-9367-c874713b8996`; that second ID became the
  selected Kobalte trigger and its exact dynamic Browser body was the only
  active dynamic Browser body. The first instance remained open.
- The menu was absent after every selection. Open-tab order, fixed-tool
  single-instance disabling, overflow, close actions, Task Preview ownership,
  and unique Browser identities remained unchanged.
- The final real desktop composition was captured at
  [`../../artifacts/2026-07-30-right-dock-new-tab-active-two-browsers.png`](../../artifacts/2026-07-30-right-dock-new-tab-active-two-browsers.png)
  and personally reviewed. The Right Dock contains both Browser tabs, the
  second newly opened tab is the visible selected surface, and the blank
  Browser address/body renders without tab-strip or overflow displacement.
- Overlay TypeScript passed after the final source change. The final
  production Vite build transformed 7,055 modules and completed with only the
  existing third-party directive and chunk-size warnings. Target-path
  `git diff --check` and the final owner grep passed.
- A final whole-worktree localization check reached the checker but reported
  three concurrently added, unused `image_preview.*` keys in unrelated
  Image Preview edits. This task does not own or alter locale data; the same
  localization check passed immediately before those concurrent changes.
- No User Interface automated test, fixture, assertion script, snapshot, or
  screenshot baseline was added, modified, updated, deleted, or run.

## Second Review

- Re-read the exact Kobalte `TabsRoot`, DOM collection registration, and
  controllable selection implementation. The product repair removes both
  ways the controlled value can temporarily be absent: stable fixed IDs
  survive closed-to-open transitions, and one next Browser UUID is already
  registered before any Browser launcher writes it to the parent collection.
- Confirmed the reservation is derived only from the open Browser-ID set and
  rotates only when that set changes. It is not a second active source,
  persisted state, timer, retry, stale-callback filter, gate, or state machine.
- Confirmed every Browser creation entry point—the add menu, empty Dock
  launcher, and exact empty-strip double-click—passes the same reserved ID to
  the sole `openBlankBrowserTab` writer. No caller still generates a late ID.
- Confirmed hidden reserved/fixed triggers stay excluded from overflow
  measurement through the existing `data-open="true"` query, while dynamic
  Browser title, native lease, selection, close, and cleanup consumers retain
  the exact opened ID.
