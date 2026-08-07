# Right Dock Chrome-style adaptive tab width

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User requirement | Make the OpenCorvus Right Dock tab strip follow Chrome's tab behavior: when horizontal space becomes insufficient, reduce each tab's width instead of immediately keeping wide tabs and moving whole tabs out of view. |
| Supplied evidence | The first screenshot shows the current OpenCorvus row using two very wide independent capsules; the second shows Chrome keeping many tabs visible by distributing and shrinking their widths. Both screenshots were inspected in the conversation at their supplied resolution. |
| Acceptance criteria | Open tabs keep their existing Kobalte semantics, icon, ellipsized label, close action, order, selection, add action, Dock close action, and overflow-menu reachability. Tabs use the current preferred maximum while spare width exists, then share the strip and shrink evenly down to one explicit usable minimum. Only when every visible tab would have to become narrower than that minimum may the existing overflow menu hide tabs. The active tab remains visible. A real desktop page must be opened, exercised, screenshotted at wide and narrow desktop Dock widths, and manually reviewed. |
| Hard constraints | Preserve the single `RightDock` implementation, `centerWorkbenchPanels` tab identity, Kobalte Tabs/Button primitives, native Browser tab lifecycle, and existing overflow menu. Do not add a second tab store, renderer, iframe, preview override, fallback, feature gate, state machine, responsive/mobile scope, or UI test. Do not add, modify, update, or run UI automation tests. Use Node for browser/Playwright work. Preserve all unrelated dirty composer, Conversation surface, task-dialog, and specification changes. |
| Existing design records read | `specs/current/architecture/07-panel.md`; `2026-07-17-right-dock-codex-capsule-tabs.md`; `2026-07-28-right-dock-chrome-tabs-and-blank-tab.md`; current `RightDock.tsx`; shared `ui/Tabs.tsx` and `primitives/tabs.css`; `workspace.css`; design-language layout tokens; current git history and task diff. |
| External primary-source check | Chromium's `TabStrip` computes a preferred width and distinct minimum active/inactive widths, fitting the strip before tabs collapse or scroll. `TabStyleViews` documents that active tabs keep their close button and therefore require a larger minimum. This supports a preferred-to-minimum compression contract rather than the current preferred-width-or-overflow jump. |
| Whole-repository grep | `RightDock.tsx` is the only DOM/measurement owner of `.right-dock-tab-shell`, `data-overflowed`, active-tab preservation, and the overflow menu. `workspace.css` is the only production width owner through `--right-dock-tab-max-width` and the shell recipe. `main.tsx` only owns tab identity/open/select/close and menu signals and must remain unchanged. `07-panel.md` is the current architecture contract. Existing files under `packages/overlay/test/**` contain historical source/browser assertions for fixed tab widths and overflow, but the current rule explicitly forbids changing or running them for a UI task. |
| Independent review feedback | No sub-agent was spawned because the user did not request delegation. Claude Code `2.1.147` was invoked from the repository root with only `Read,Grep,Glob`, no session persistence, and no worktree/delegation capability, but exited before reading the repository because the local CLI is not authenticated (`Not logged in`). The primary agent therefore owns two separate evidence reviews and must record this unavailable external review honestly. |
| Git baseline | Delivery branch is `work-v0.0.24beta-yr-0729`; `HEAD` and `myhexin/work-v0.0.24beta-yr-0729` are both `b2f82a5c46` with zero divergence. The worktree is already dirty with unrelated user-owned work, including an adjacent `workspace.css` background hunk and modified spec indexes, so this task must stage only its own hunks. |

## Causal chain

1. `.right-dock-tab-shell` currently has `flex: none` and a fixed
   `width: min(100%, 176px)`, so open tabs do not participate in remaining-space
   distribution.
2. `RightDock.reflow()` measures those preferred widths. As soon as their sum
   exceeds the strip, it hides complete tabs behind the existing overflow menu.
3. Changing only the shell to flexible sizing is insufficient: after any tab is
   hidden, the remaining flex items expand, and a reflow algorithm based on their
   expanded `offsetWidth` can hide too many tabs or oscillate.
4. The root fix is one shared preferred/minimum width contract: CSS distributes
   visible tabs between those bounds; reflow computes visibility from the same
   minimum width and available slot count, independent of current expanded width.

## Call-site disposition

| Owner / consumer | Decision |
| --- | --- |
| `packages/overlay/src/components/RightDock.tsx` | Replace preferred-width summation with minimum-slot capacity calculation. Keep the active tab mandatory, then retain the most recent tabs that fit. Preserve the current `ResizeObserver`, animation-frame coalescing, stable `Set` commit, dropdown, selection, and close paths. |
| `packages/overlay/src/styles/tokens/design-language.css` | Add one Right Dock preferred-width token and one minimum-width token so geometry is not duplicated between style and measurement. |
| `packages/overlay/src/styles/surfaces/workspace.css` | Make open shells `flex: 1 1` the preferred token with the minimum token and preferred maximum. Keep selected/hover material, label ellipsis, close placement, and overflow positioning unchanged. |
| `specs/current/architecture/07-panel.md` | Amend the tab geometry contract to say tabs compress from preferred to minimum before the existing overflow menu activates. |
| `packages/overlay/src/main.tsx`, shared Tabs/Button primitives, Browser preview/native services | Preserve. They already own the correct singular state, interaction semantics, and native page lifecycle. |
| `packages/overlay/test/**` | Do not modify or run. Their assertions target UI layout/rendering and are prohibited by the current UI automation-test rule. |

## Implementation and verification plan

1. Commit and push this Recall before production edits.
2. Add the two design tokens, update the Right Dock shell flex recipe, and make
   reflow derive the visible slot count from the rendered minimum token.
3. Update the current architecture sentence; run formatting/static validation,
   Overlay TypeScript, internationalization validation, and the production Vite
   build. Do not run UI tests.
4. Start the real desktop page through the browser skill, exercise the actual
   Right Dock at wide and narrow desktop widths, capture task-scoped screenshots,
   inspect them manually, and iterate until labels/close actions/selection and
   overflow remain coherent.
5. Ask Claude Code for a read-only second review of the task-owned diff, repair
   substantiated findings, run document-health checks, selectively commit only
   task-owned hunks, fetch/converge with `myhexin`, and push through normal hooks.

## Progress

- [x] Repository rules, screenshots, history, architecture, implementation, tokens,
  dirty-worktree boundaries, and all call sites inspected.
- [x] Root cause and implementation plan recorded.
- [x] Recall commit and push complete (`baa2d9a703`).
- [x] Implementation and static/build validation complete: Overlay TypeScript,
  internationalization integrity, and the production Vite build passed.
- [x] Real desktop screenshots inspected and corrected. On the current
  production bundle, four tabs shared a `498px` Dock at approximately `99px`
  each. At a `361px` Dock, three tabs shared the visible strip at approximately
  `77px` each and the fourth moved into `More tabs`; selecting that hidden tab
  made it active and visible while moving a non-active tab into overflow.
  Manual review found no overlap, close-button displacement, clipped controls,
  or active-tab loss.
- [x] Second review, documentation health, implementation commit, and git-cc push
  complete. The three documentation-health suites passed `93/93`; implementation
  commit `9182b6fe87` passed the normal pre-push TypeScript, route, documentation,
  internationalization, and secret-scan hooks and reached `myhexin`.

## Implementation evidence

- The shell now flexes from the shared `176px` preferred width down to the
  shared `72px` minimum. Label ellipsis and the embedded close action remain
  owned by the existing Kobalte tab.
- Overflow capacity is derived from that rendered minimum rather than from the
  flexed tabs' current widths. This prevents the former preferred-width jump
  and avoids feedback from measuring already-expanded survivors.
- The existing `ResizeObserver`, active-tab requirement, newest-tab retention,
  overflow dropdown, selection, add, and close paths remain the only owners.
- A same-origin source server served the current production bundle for the
  visual pass. The pre-existing managed `7878` server was not restarted or
  replaced; the temporary `5184` and `7891` validation processes were stopped
  after the screenshots.
- Claude Code remained unavailable because its installed CLI is not
  authenticated. The primary agent performed a separate post-visual code and
  diff review instead of representing the unavailable external review as
  completed.
