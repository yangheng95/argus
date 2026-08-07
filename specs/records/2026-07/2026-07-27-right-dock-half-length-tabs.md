# Right Dock Half-Length Tabs

## Recall

| Item | Detail |
| --- | --- |
| User requirement | “缩短右侧dock栏的tab长度到一半长度。” The supplied screenshot shows the open `Squad agents`, `Review`, and `Files` tabs consuming the full 240-pixel configured maximum apiece. |
| Acceptance criteria | Reduce each open Right Dock tab's maximum desktop length from 240 pixels to 120 pixels; retain the current icon, ellipsized label, visible close action, selection, overflow, add, and Dock-close behavior; verify the rendered result on a real Vite page and inspect a task-scoped screenshot. |
| Hard constraints | Preserve the canonical Kobalte Tabs/Button primitives and `RightDock.tsx` ownership. Change the single CSS dimension source instead of adding component state, fallback sizing, query overrides, local signals, or a second tab implementation. Use Node for Playwright. Do not restart or refresh the user's running OpenCorvus/Overlay process. Preserve every parallel worktree edit and stage only task-owned hunks. |
| Sources read | `AGENTS.md`; browser-control skill; supplied screenshot; memory note for canonical Right Dock ownership and Vite `networkidle0`; current `RightDock.tsx`; `workspace.css`; `right-dock-panel-ownership.test.ts`; Right Dock browser fixtures; prior capsule-tab and multi-tab records; current git status and diff. |
| Whole-repository grep | `RightDock.tsx` is the sole tab DOM and overflow-measurement owner. `workspace.css .right-dock-tab-strip` is the sole production owner of `--right-dock-tab-max-width`, currently 240 pixels. `right-dock-panel-ownership.test.ts` is the sole exact source-contract assertion for that variable. Existing browser tests cover real open-tab measurement, overflow stability, close, and selection; no second production width source exists. Other 240-pixel values belong to unrelated Tooltip, card, message, settings, and inspector surfaces and must remain unchanged. |
| Independent agent feedback | None. The user did not request sub-agents, so no delegation is permitted for this task. |
| Git baseline | Delivery branch is `v0.0.19beta` at `87c7987022`, one commit ahead of `myhexin/v0.0.19beta`. The shared worktree contains unrelated concurrent source, test, i18n, and spec edits; this task must use selective staging and must not reset, stash, restore, or broadly stage them. |

## Root Cause

The visible length is not produced by panel content or duplicated component state.
Every open tab shell is capped by the single
`--right-dock-tab-max-width: calc(240px * var(--ui-scale))` declaration, and the
tab fills that shell. Therefore the direct, single-source implementation of “half
length” is a 120-pixel maximum. The existing ellipsis and measured-overflow paths
already handle labels that no longer fit and require no component change.

## Call-Site Disposition

| Surface | Disposition |
| --- | --- |
| `workspace.css .right-dock-tab-strip` | Replace the sole 240-pixel tab maximum with 120 pixels. |
| `right-dock-panel-ownership.test.ts` | Update the exact single-source contract to require the 120-pixel maximum. |
| `RightDock.tsx` | Keep unchanged; it remains the canonical DOM, selection, close, and real-width overflow owner. |
| Existing Right Dock browser fixture | Reuse the real Node + Vite route to verify rendered 120-pixel geometry, ellipsis, active-tab visibility, overflow stability, and a task-scoped screenshot. |
| Other 240-pixel declarations | Keep unchanged because they own unrelated UI surfaces. |

## Implementation And Verification Plan

1. Commit and push this Recall before production edits.
2. Change the one CSS maximum and its focused source contract.
3. Run the focused unit test, Overlay typecheck, i18n check, and Vite build.
4. Run the existing Right Dock fixture through Node, capture a task-scoped screenshot, inspect it at original resolution, and correct any visual regression.
5. Re-run the whole-repository search, review the exact task diff, record evidence here, selectively commit only task-owned hunks, and push `v0.0.19beta` to `myhexin` through normal hooks.

## Progress

- [x] Inspect the supplied screenshot, current owners, prior records, all width references, tests, and parallel worktree state.
- [x] Commit this Recall; the initial push entered the normal hook but did not reach the remote before concurrent repository typechecks saturated the shared checkout.
- [x] Implement the half-length maximum and regression contract.
- [x] Complete focused, build, browser, visual, and documentation verification.
- [ ] Perform second review, selectively commit, and push.

## Implementation Result

- The sole production value is now
  `--right-dock-tab-max-width: calc(120px * var(--ui-scale))`.
- `RightDock.tsx`, the Kobalte Tabs/Button primitives, panel catalog, selection,
  close, add, and measured-overflow logic remain unchanged.
- The exact source regression now requires the 120-pixel maximum. No second
  sizing source, minimum-width override, fallback, or query/local-state path was
  introduced.

## Visual Review

The isolated existing `subagent-progress-dock` Vite fixture was started through
Node on port 4179 and opened in the in-app Browser. Selecting the existing
Frontend audit progress card opened the production `RightDock` and its canonical
`Squad agents` tab. Read-only rendered-geometry inspection reported:

- shell width: 120 pixels;
- Tab width: 120 pixels;
- computed maximum: 120 pixels;
- selected state: present;
- long-label ellipsis: active.

I inspected `.scratch/right-dock-half-length-tabs.png` at original resolution.
The capsule is visually half the prior 240-pixel length, its leading icon and
close affordance remain aligned inside the capsule, the long title truncates
cleanly, and the global add/Dock-close actions remain separate. There is no
extra title bar, overlap, clipped close button, or layout seam.

## Verification Result

| Evidence | Result |
| --- | --- |
| Focused source contract | `bun test packages/overlay/test/right-dock-panel-ownership.test.ts`: 2 passed, 0 failed, 108 expectations. |
| Overlay contracts | `bun run --cwd packages/overlay typecheck` and `check:i18n`: passed. |
| Production build | `bun run --cwd packages/overlay build:vite`: passed with 7,041 modules transformed; existing dependency directive and large-chunk warnings remain informational. |
| Real Vite visual/geometry | Existing fixture rendered the canonical tab at exactly 120 by 120-pixel maximum with selected state and ellipsis; screenshot inspected at original resolution. |
| Documentation | `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 22 passed, 0 failed, 71 expectations. |
| Broad Right Dock browser suite | The production build passed, but both suite cases stopped before opening a task because the concurrent fixture still uses the now-invalid underscore ID `task_chat_header_toolbar`; the visible Zod error requires lowercase alphanumerics and hyphens. This is pre-existing fixture input evidence, not a Tab-width failure, and no task-owned product or fixture code was expanded to conceal it. |

## Second Review

- Whole-repository search still finds one production
  `--right-dock-tab-max-width` owner and one exact test contract; unrelated
  240-pixel Tooltip/card/message/settings values remain untouched.
- The browser measurement proves the CSS value reaches the real shared
  primitive, so the result is not a source-only or mocked signal.
- The smaller rendered width is consumed by the existing real-width overflow
  algorithm. No state ownership, panel semantics, or keyboard path changed.
- The exact task diff is limited to the one CSS value, one regression value,
  this record, and its already-committed index entries. Parallel worktree edits
  remain unstaged and unmodified by this task.
