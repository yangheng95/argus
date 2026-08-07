# Titlebar Dropdown And Sidebar Font Parity

## Recall

| Item | Detail |
| --- | --- |
| User requirement | Reduce the titlebar dropdown-menu text so it matches the left navigation text shown in the supplied Help-menu screenshot. |
| Acceptance criteria | File, Edit, View, and Help dropdown item labels compute to exactly the same font size as `New chat`, `Expert Squads`, `Multica Import`, and `Channel`; existing shortcut metadata remains secondary; focused source tests, a Node-launched browser test, and a task-scoped screenshot pass. |
| Hard constraints | Desktop-only scope; keep Kobalte Menubar and the existing sidebar/Button primitives; use one shared design token rather than copied literals; do not introduce fallback or parallel styling; do not restart, refresh, or otherwise interfere with the user's running OpenCorvus/overlay process; preserve unrelated dirty-worktree changes and stage only task-owned hunks. |
| Sources read | `AGENTS.md`; `specs/README.md`; `specs/current/architecture/99-principles.md`; `2026-07-16-overlay-menu-shortcut-icon-budget-convergence.md`; `TitlebarMenubar.tsx`; `titlebar.css`; `sidebar.css`; design-language typography tokens; titlebar/sidebar source and browser tests. |
| Whole-repository search evidence | `rg` enumerated all `titlebar-menubar-item-title`, `MenuItem`, `sidebar-codex-action`, menu-label translations, font-size declarations, and existing assertions. There is one Kobalte titlebar dropdown-item owner (`.titlebar-menubar-item-title`) and one left shortcut owner (`.sidebar-codex-action`); the mismatch is `--ui-font-control` (14px) versus a local 13px expression. No second titlebar dropdown implementation exists. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration policy forbids unrequested delegation. |

## Evidence-Backed Cause Chain

1. The supplied screenshot shows Help dropdown labels larger than the adjacent left navigation labels.
2. `TitlebarMenubar` renders every dropdown label through `.titlebar-menubar-item-title`; the selector resolves to `--ui-font-control`, whose current base is 14px.
3. All four left shortcuts render through `.sidebar-codex-action`, which resolves to a separate 13px expression.
4. The direct trigger is therefore a one-pixel type-source mismatch, and the deeper cause is that two visually equivalent compact-navigation surfaces do not share a semantic typography token.

## Call-Site Disposition

| Owner / call site | Decision |
| --- | --- |
| `design-language.css` typography tokens | Add one semantic compact-navigation font token at the existing 13px scale. |
| `sidebar.css` `.sidebar-codex-action` | Replace the local 13px expression with the shared token; visual output remains unchanged. |
| `titlebar.css` `.titlebar-menubar-item-title` | Replace the 14px control token with the same shared compact-navigation token. This covers all File/Edit/View/Help items and range labels through the existing single owner. |
| Existing source/browser tests | Assert both owners consume the token and measure actual titlebar/sidebar computed font equality. Keep shortcut metadata on the existing smaller token. |

## Benchmark

- Use an isolated Overlay browser fixture launched by Node, without touching the user's app process.
- Open Help at the desktop acceptance viewport and measure the first visible `.titlebar-menubar-item-title` against the visible left `.sidebar-codex-action` label.
- Require exact computed-size equality and retain the compact panel/row geometry assertions.
- Save a task-scoped screenshot and inspect it for hierarchy, clipping, and menu/sidebar parity.

## Progress

- [x] Inspect user evidence and enumerate source/test owners.
- [x] Record the cause chain and call-site plan.
- [x] Implement the single typography source.
- [x] Add regression coverage and run focused verification.
- [x] Inspect screenshot, perform second review, commit, and push to git-cc.

## Verification Evidence

- Passed 22 focused source regressions covering the Kobalte titlebar primitive, sidebar ownership, Work Ledger ownership, and neighboring Right Dock assertions.
- Passed 36 typography/design-token regressions. The broader architecture-guard file still has six unrelated current-worktree failures for concurrent Terminal, Memory/SearchField, Brand Guide, root palette indirection, and ChatBubble changes; none references `--ui-font-navigation` or the two changed selectors.
- Passed Overlay TypeScript, panel internationalization, and the production Vite build (2,456 modules).
- Passed the Node-launched target browser test across English/Chinese and seven widths. Each Help item computed to exactly the same font size as the visible left navigation label; the deterministic light-theme evidence is `.scratch/titlebar-help-sidebar-font-parity.png`.
- Visual review confirms the dropdown and left navigation now share one 13px scale with no clipping, overflow, or hierarchy regression. Shortcut metadata remains on the smaller 12px tier.
- Historical links and product-doc single-source checks passed. The first document-health run correctly rejected the new record while it was untracked; the required tracked-file check will be rerun after exact staging.
- The task-owned implementation was committed as `42943e7f3` with ten exact paths. A later parallel commit retains the same task blobs; no history rewrite or unrelated hunk capture was used.
