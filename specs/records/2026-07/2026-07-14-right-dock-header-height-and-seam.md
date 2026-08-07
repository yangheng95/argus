# Right Dock Header Height and Seam Repair

## Recall

| Item | Detail |
| --- | --- |
| User requirement | 右侧 Dock header 高度不对，而且多出一条细线。 |
| Acceptance criteria | The expanded Right Dock tab header and Chat header have the same computed height at desktop scale; the Dock header draws no resting bottom border; tab underline, hover/focus, resize, add, runtime, and close interactions remain intact; dark rendered screenshot is inspected at original resolution. |
| Hard constraints | No fallback, duplicate height constant, component-local inline style, second Dock owner, theme-specific geometry, gate, mobile/tablet scope, restart/refresh of the running Overlay, broad Git restore/reset, or new worktree. Preserve unrelated dirty work. Node starts Playwright with the existing activity-reset inactivity timeout. |
| Sources read | `AGENTS.md`; `specs/records/2026-07/2026-07-13-sidebar-surface-continuity.md`; `2026-07-14-overlay-workspace-surface-continuity.md`; `2026-07-08-message-pane-agent-rail-geometry-toolbar-alignment.md`; current `design-language.css`, `header.css`, `workspace.css`, `RightDock.tsx`, source tests, and the real titlebar/right-dock and three-theme browser fixtures. |
| Whole-repository search evidence | `--ui-panel-header-height` is the existing 48px-scaled panel-header token and has two live consumers; Chat duplicates the same 48px value through a local `--oc-header-height`; `.right-dock-tabs` has no height contract and derives a shorter height from a 28px control plus asymmetric padding; its `border-bottom` is the only horizontal resting line at the Dock/header boundary. Right Dock DOM ownership is centralized in `RightDock.tsx`. |
| Independent agent feedback | None. The user did not request sub-agents and active policy forbids spawning them otherwise. |

## Root cause and design

The Chat header and Right Dock header model the same workspace row but use two
different sizing systems. Chat owns a duplicated 48px value while Dock derives
its height from child controls and padding. Scaling preserves the mismatch. The
Dock also draws a bottom border even though the current workspace continuity
decision requires the message canvas and expanded Dock to be one uninterrupted
material.

Reuse `--ui-panel-header-height` as the single height source for both headers.
Bind the Dock's height, minimum height, and maximum height to that token so its
existing padding stays inside the fixed border box. Remove the resting Dock
border; the active-tab underline and interactive hover/focus affordances remain
the only local state indicators.

## Call-site disposition

| Surface | Disposition |
| --- | --- |
| `styles/tokens/design-language.css` | Keep the existing `--ui-panel-header-height` token unchanged as the single source. |
| `styles/surfaces/header.css` | Replace Chat's duplicated 48px value with `var(--ui-panel-header-height)`. |
| `styles/surfaces/workspace.css` | Bind `.right-dock-tabs` to the shared token and remove its bottom border. |
| `components/RightDock.tsx` | Keep the single DOM and interaction owner unchanged. |
| source/browser tests | Assert shared token ownership, exact computed height equality, zero Dock bottom border, and real dark screenshot evidence. |

## Benchmark

- Input: isolated desktop Overlay with Chat header and expanded Right Dock.
- Output: equal computed header heights and no horizontal Dock seam.
- Environment: Windows host source, repository Vite/TypeScript, Node-started
  Playwright fixture; no user Overlay process interaction.
- Timeout: activity-reset browser-runner inactivity timeout, not wall-clock time
  from process start.
- Pass criteria: focused source tests, Overlay typecheck/build, real rendered
  height/border assertions, dark screenshot review, spec health, diff review,
  task-owned commit, and git-cc push.

## Progress

- [x] Recall current and historical decisions.
- [x] Enumerate height, border, DOM, and browser-test call sites.
- [x] Implement the single-source geometry repair.
- [x] Run rendered benchmark and inspect screenshot.
- [x] Complete second implementation and visual review.
- [x] Selectively commit and push.

## Verification result

- PASS: 19 focused density, surface-header, and workspace-continuity tests.
- PASS: Overlay `tsc --noEmit`.
- PASS: production Vite build through the Node browser runner.
- PASS: `titlebar-toolbar-toggle-browser.test.ts`; the real expanded Dock header
  and Chat header differ by at most 1.5px and the Dock border computes to 0px.
- PASS: `workspace-surface-continuity-browser.test.ts`; exact header-height
  equality and zero Dock border passed in light, dark, and VS Code dark themes.
- PASS: `historical-docs-links.test.ts` and `git diff --check`.
- PASS: git-cc pre-push SDK import, AI runtime, monorepo typecheck,
  API route inventory, generated API docs, Overlay i18n, and secret scan;
  functional commit `e63ae02a14` reached `myhexin/v0.0.3beta`.
- Visual review PASS: `.scratch/codex-message-header-toolbar-open.png` shows the
  real Dock action row aligned with the Chat header and no horizontal seam;
  `.scratch/workspace-surface-continuity-dark.png` confirms the aligned fused
  surface at original resolution.
- `document-health.test.ts`: 71/73 passed. The two failures are pre-existing
  dirty-worktree issues outside this repair: the model-schema test expects a
  removed `status` field, and the July README links seven other untracked
  records. This record becomes tracked in the selective task commit.

## Second review

- `--ui-panel-header-height` is now the only 48px-scaled source shared by Chat
  and Dock; no duplicate geometry constant was added.
- Right Dock DOM and interaction ownership remain unchanged in `RightDock.tsx`.
- The removed line was a resting material seam, not the active-tab underline;
  tab, hover, focus, resize, add, runtime, and close affordances remain intact.
- No fallback, extra selector path, theme-specific geometry, or dead code was
  introduced or discovered in the touched scope.
