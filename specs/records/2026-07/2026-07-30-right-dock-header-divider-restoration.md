# Right Dock Header Divider Restoration

## Recall

| Item                        | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement            | Restore the missing horizontal line beneath the Right Dock tab header, in the exact region marked in the supplied screenshot.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Supplied evidence           | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-c25edee1-0b7f-413b-a358-60077fc4c2ba.png` was inspected at original resolution. The marked region spans the full Right Dock width between the tab/action row and the mounted panel body; the expected boundary is absent.                                                                                                                                                                                                                                                                                           |
| Acceptance criteria         | One quiet semantic divider spans the full Right Dock width directly between the tab header and body. Header height, white canvas, selected-tab wash, tab ordering/selection/close behavior, overflow/add/Dock-close controls, Dock resizing, mounted body content, and the separate vertical Conversation/Dock separator remain unchanged. A real desktop page with the Dock open is captured and personally reviewed.                                                                                                                                                 |
| Hard constraints            | Reuse the existing border-width and divider-color tokens in the canonical Right Dock style owner. Do not add markup, a pseudo-element, a second separator owner, theme-specific styling, fallback, compatibility logic, gate, local state, query override, temporary frame, mobile/tablet scope, or a User Interface (UI) automated test. Do not add, modify, update, delete, or run existing UI tests. Preserve unrelated dirty-worktree changes and do not restart or reuse another task's running page.                                                             |
| Sources read                | Root `AGENTS.md`; Browser control skill; supplied screenshot; `specs/current/architecture/07-panel.md`; `2026-07-14-right-dock-header-height-and-seam.md`; `2026-07-29-conversation-dock-surface-convergence.md`; `2026-07-29-conversation-edge-to-edge-surface.md`; `RightDock.tsx`; `workspace.css`; theme divider-token definitions.                                                                                                                                                                                                                                |
| Whole-repository grep       | Searches covered `right-dock-tabs`, `right-dock-body`, `RightDock`, `border-bottom: 0`, `divider-soft`, and all production/test/spec consumers. `RightDock.tsx` is the sole Dock header/body Document Object Model (DOM) owner. `workspace.css::.right-dock-tabs` is the sole production geometry and paint owner for this boundary and explicitly sets `border-bottom: 0`. Theme palettes already define `--divider-soft`; no component, state, route, backend, locale, or data owner participates. Existing UI tests were identified but remain untouched and unrun. |
| Independent review feedback | Claude Code Command-Line Interface (CLI) 2.1.147 was invoked from the repository root with the required read-only `Read,Grep,Glob` tool boundary, streaming output, and no session persistence. It returned `Not logged in · Please run /login` before reading code, so no Claude review evidence is available. The primary agent owns the selector-level challenge and second review.                                                                                                                                                                                 |
| Workspace preservation      | Goal/Requirement disclosure, progressive-list, Tool hierarchy, and associated evidence changes already present in the worktree are unrelated and must remain unstaged and uncommitted by this task.                                                                                                                                                                                                                                                                                                                                                                    |

## Cause Chain

1. The screenshot shows no visual boundary between the fixed-height Dock tab
   header and the independently mounted panel body.
2. `RightDock.tsx` already places these surfaces as adjacent siblings:
   `.right-dock-tabs` followed by `.right-dock-body`; no missing component or
   conditional rendering is involved.
3. The canonical `.right-dock-tabs` rule explicitly declares
   `border-bottom: 0`. A 2026-07-14 continuity change deliberately removed the
   prior line, so the current result is authored behavior rather than a browser
   rendering failure.
4. The user's current visual requirement supersedes that one historical paint
   decision while preserving its shared header-height correction.
5. The root repair is therefore one tokenized declaration in the existing
   header owner: restore its bottom border with `--oc-border-width` and
   `--divider-soft`. Adding markup or a body border would create a second
   boundary owner without solving a deeper problem.

## Complete Call-Site Disposition

| Owner or consumer                                                      | Decision                                                                                                                                                                   |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/components/RightDock.tsx`                        | Preserve the single header/body DOM, Kobalte Tabs semantics, open-tab membership, selection, close, add, overflow, and Dock-close behavior.                                |
| `packages/overlay/src/styles/surfaces/workspace.css::.right-dock-tabs` | Replace the explicit zero bottom border with one semantic tokenized bottom border. Preserve fixed height, padding, white canvas, active-tab token, and all child geometry. |
| `packages/overlay/src/styles/surfaces/workspace.css::.right-dock-body` | Preserve. The body remains the mounted-content and overflow owner and must not draw a duplicate top border.                                                                |
| `.right-dock-resizer`, theme palettes, and shared Tabs primitive       | Preserve. They already own the vertical Conversation/Dock separator, semantic divider color, and tab interaction respectively.                                             |
| `specs/current/architecture/07-panel.md`                               | Record that the Dock header/body boundary now uses the shared quiet divider while retaining the existing tab geometry and selection contract.                              |
| Existing Overlay UI tests and fixtures                                 | Do not add, modify, update, delete, or run. Visual acceptance uses an isolated real desktop page and personally reviewed screenshot.                                       |

## Implementation And Verification Plan

1. Commit and push this Recall before product edits.
2. Restore the one bottom-border declaration in the canonical
   `.right-dock-tabs` rule and update the current panel architecture.
3. Run Overlay typecheck, production build, required documentation health,
   formatting/static integrity, and `git diff --check`; do not run UI tests.
4. Start an isolated current-source desktop page through the Browser skill,
   open the real Right Dock, capture the exact header/body region, and inspect
   the divider, alignment, color, and unaffected controls personally.
5. Re-grep production owners, review the exact diff and rendered evidence a
   second time, update this record, commit only task-owned hunks with the
   `dsw-33987` prefix, fetch/converge, push to `myhexin`, and verify the remote.

## Progress

- [x] Inspect the screenshot, historical decisions, current architecture,
      production owners, semantic tokens, and complete call-site inventory.
- [x] Attempt the required read-only Claude Code review and record the
      authentication blocker.
- [x] Commit and push the pre-change Recall.
- [x] Restore the canonical Dock header/body divider.
- [x] Complete static/build verification and real-page visual acceptance.
- [x] Complete the final task-owned commit and git-cc push.

## Real-Page Visual Evidence

The current-source Vite Overlay at `http://127.0.0.1:5173/` was opened in a
fresh in-app Browser tab and connected to the already-running healthy
OpenCorvus backend on port `7878`. The real `你好` Chat was selected through
the visible Projects list, the visible `Open right dock` control opened the
Dock, and the real `Goals` launcher opened the selected Goals tab. No fixture,
query override, local signal, temporary frame, synthetic record, or hidden
state write was used.

The final screenshot was personally inspected at its original 1280-by-720
resolution:

- [`2026-07-30-right-dock-header-divider-restoration.png`](../../artifacts/2026-07-30-right-dock-header-divider-restoration.png)

The quiet horizontal divider visibly spans the full 360-pixel Dock width
directly below the selected tab/action row. The selected Goals tab, close
action, add action, Dock close action, Conversation/Dock vertical separator,
body content, and white header canvas remain visually intact. Bounded
read-only style/geometry inspection of the same rendered state reported:

| Surface              | Evidence                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Dock                 | `x=920`, `y=36`, `width=360`, `height=684`, `data-open="true"`                                                         |
| Tab header           | `x=920`, `y=36`, `width=360`, `height=40`; selected tab is `Goals`                                                     |
| Header/body boundary | Header bottom and body top both resolve to `y=76`; no gap or duplicate line                                            |
| Divider              | `0.571429px solid rgba(32, 38, 40, 0.1)` at the active UI scale, sourced from `--oc-border-width` and `--divider-soft` |
| Header canvas        | `rgb(255, 255, 255)`, unchanged                                                                                        |

The task-owned isolated Vite server on port `5197` was stopped after it proved
unable to load project context. The healthy pre-existing Vite/backend
processes on ports `5173` and `7878` were neither restarted nor stopped.

## Verification And Second Review

| Check                               | Result                                                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Overlay TypeScript typecheck        | Passed                                                                                                                                       |
| Overlay production Vite build       | Passed; 7,054 modules transformed, with only existing dependency-directive and chunk-size warnings                                           |
| Historical documentation links      | Passed                                                                                                                                       |
| Document health                     | Passed                                                                                                                                       |
| Product documentation single source | Passed                                                                                                                                       |
| Documentation suites total          | 93 passed, 0 failed, 1,448 assertions                                                                                                        |
| Targeted Prettier check             | Passed for the task record and architecture document; the CSS file retains its existing surrounding formatting to avoid an unrelated rewrite |
| `git diff --check`                  | Passed                                                                                                                                       |
| UI automated tests                  | None added, modified, updated, deleted, or run                                                                                               |

The second review re-read the exact production diff, the sole
`RightDock.tsx` header/body composition, every `right-dock-tabs` and
`right-dock-body` production owner, the historical zero-border decision, the
current architecture wording, and the final rendered screenshot. The repair
changes only the obsolete zero-border declaration and current architecture
statement; it adds no renderer, alternate separator, theme branch, state
source, geometry constant, fallback, gate, or interaction change.

## Delivery

- Pre-change Recall commit `0b6254dac6` was pushed to
  `myhexin/work-v0.0.24beta-yr-0729`.
- Product, architecture, record, and visual-evidence commit `5fbcfd5fb8` was
  pushed to `myhexin/work-v0.0.24beta-yr-0729`.
- The push hook passed Software Development Kit (SDK) import validation,
  Artificial Intelligence (AI) runtime validation, monorepo typecheck, route
  inventory, generated Application Programming Interface (API) documentation,
  Overlay localization validation, and secret scan.
