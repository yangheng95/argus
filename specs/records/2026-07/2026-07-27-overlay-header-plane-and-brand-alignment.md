# Overlay Header Plane And Brand Alignment

## Recall

| Item | Detail |
| --- | --- |
| User requirement | Repair the top chrome shown in the supplied desktop screenshot: the OpenCorvus brand region is not level with the adjacent header, appears optically short, and the header mixes conflicting visual languages. |
| Acceptance criteria | The left brand/context row, Conversation header, and Right Dock tabs share one 40px desktop row; the workspace top edge is continuous instead of being cut by a large card corner; Open in, the adjacent header icon actions, and the selected Dock tab share one 32px control height, one ordinary large radius, and one quiet filled rest surface; the OpenCorvus wordmark remains aligned to the canonical left-navigation icon axis; real Vite rendering and inspected desktop screenshots pass. |
| Hard constraints | Preserve every concurrent worktree change; do not resolve, discard, stage, or overwrite unrelated conflicts; do not restart, refresh, or otherwise interfere with the user's running OpenCorvus/Overlay; desktop-only scope; keep the existing Button and Tabs primitives and the existing production owners; add no fallback, duplicate header, temporary iframe, local signal override, or alternate visual source; launch Playwright through Node, never Bun. |
| Supplied evidence | `/var/folders/bj/6vby7ld11796l5bfdmc7s8l40000gn/T/codex-clipboard-208cd802-213f-434e-9211-9e2783e1dc14.png`, inspected at its original 1916 x 70 resolution. The crop shows a large rounded cutout where the center Workbench meets the brand row and three competing control silhouettes across one header. |
| Sources read | `AGENTS.md`; Browser skill; `2026-07-25-titlebar-brand-wordmark-scale.md`; `2026-07-25-left-dock-brand-and-focus-weight.md`; `2026-07-25-interaction-dialog-scroll-footer-and-header-control-convergence.md`; `App.tsx`; `TitlebarBrand.tsx`; `WorkspaceEditorLaunchers.tsx`; `ChatHeaderRightDockToggle.tsx`; `design-language.css`; `titlebar.css`; `header.css`; `conversation.css`; `workspace.css`; focused source and browser tests. |
| Whole-repository grep | `rg` enumerated every `workspace-contextbar`, `--ui-workspace-contextbar-height`, `workspace-editor-launchers`, `chat-header-toolbar-toggle`, `right-dock-control-height`, and `right-dock-tab` occurrence across production, tests, current architecture, and July records. `App.tsx` is the sole shell composition owner; `titlebar.css` is the sole brand-row geometry owner; `header.css` owns the Conversation row height; `conversation.css` owns the center header controls; `workspace.css` owns the Workbench corner and Right Dock tabs; `design-language.css` owns the shared dimensions. |
| Independent agent feedback | None. The user did not request sub-agents and the coupled chrome surface remains with the primary agent. |
| Git baseline | `v0.0.21beta`, one commit ahead of `legacy-remote/v0.0.21beta`, with extensive unrelated staged changes and unresolved index conflicts already present before this task. A pre-change commit/push is unsafe because it would absorb or rewrite concurrent work; this task must remain hunk-scoped. |

## Cause chain

1. Observable: the brand, Conversation title, and Dock tabs do not read as one level header; the center header begins with a deep rounded cutout and its controls use visibly unrelated silhouettes.
2. Direct triggers: `--ui-workspace-contextbar-height` is 48px while `--ui-panel-header-height` is 40px; `.workspace-main` applies `var(--oc-radius-xl)` only at the top-left; center launchers use a bordered pill, the adjacent icon action inherits a circular icon-button radius, and Dock tabs use a filled ordinary large radius.
3. Deeper cause: structurally adjacent pieces acquired local geometry recipes even though they now occupy one continuous desktop header plane. The existing primitives are sound, but the surface owners override them with three competing roles.
4. Root repair: make the shared tokens own one header row/control rhythm, flatten only the Workbench's outer top-left composition edge, and route each existing control owner through the same ordinary large-radius quiet-fill recipe without changing behavior or markup ownership.

## Complete call-site disposition

| Owner / call site | Disposition |
| --- | --- |
| `design-language.css` | Make the workspace context row alias the canonical panel-header height and add one shared header-control height alias to the existing icon-button density. |
| `titlebar.css` | Retain the sole brand owner and its left-navigation axis; consume the corrected shared row height with no selector-local offset. |
| `header.css` | Retain the canonical 40px Conversation header contract unchanged. |
| `workspace.css .workspace-main` | Remove only the outer top-left card corner so the brand and workspace header share a continuous top edge. |
| `conversation.css .workspace-editor-launchers` | Replace the pill/border recipe with the shared control height, ordinary large radius, and quiet fill. Preserve the split-button behavior and menu. |
| `conversation.css [data-chrome="chat-header-toolbar-toggle"]` | Consume the same height, radius, and rest surface for Environment and Right Dock; preserve hover/focus/pressed behavior. |
| `workspace.css .right-dock-tabs/.right-dock-tab` | Consume the same control height and existing ordinary large radius; preserve Tabs semantics, overflow, close, add, and selection behavior. |
| Focused source tests | Replace the obsolete 48px density assertion and add a regression proving row, top-edge, height, radius, and fill convergence from the canonical owners. |
| Existing Node browser fixture | Run the real Vite Overlay header and Dock path, inspect fresh screenshots, and report any unrelated fixture conflict honestly rather than weakening the acceptance. |

## Implementation and verification plan

1. Add the source regression for the single header-plane contract.
2. Update only the shared token and three existing surface owners.
3. Run focused tests, Overlay typecheck/build, and the existing Node-launched Vite header fixture.
4. Inspect fresh desktop screenshots at original resolution and iterate on visible geometry.
5. Run documentation health and a scoped diff review. Commit/push only if the pre-existing unresolved index conflicts can be cleared without touching concurrent work; otherwise leave the task-owned patch explicit and report the repository blocker.

## Progress

- [x] Inspect supplied evidence, prior records, canonical owners, call sites, tests, and dirty-worktree overlap.
- [x] Record Recall, causal chain, complete call-site disposition, and verification plan.
- [x] Add regressions and implement the single header-plane contract.
- [x] Complete Vite/browser visual acceptance and second review.
- [x] Prepare the reviewed task-owned patch for scoped commit and push without absorbing concurrent changes.

## Verification

- Focused source coverage passed: `bun test packages/overlay/test/header-plane-convergence.test.ts packages/overlay/test/design-density-tokens.test.ts packages/overlay/test/right-dock-panel-ownership.test.ts packages/overlay/test/workspace-split-launcher-primitive.test.ts packages/overlay/test/task-cwd-row-layout.test.ts` — 25 passed, 0 failed, 565 assertions.
- Real Vite build passed: `bun run --cwd packages/overlay build:vite` transformed 7048 modules and emitted the production bundle. Existing third-party `use client` and chunk-size warnings remained non-fatal.
- Real Node-launched browser acceptance passed: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/titlebar-toolbar-toggle-browser.test.ts` — 2 passed, 0 failed. Rendered geometry measured the brand/context row and Conversation/Right Dock rows at 40px, Environment/Right Dock/Open-in wrapper controls at 32px with 12px radius and the same rest fill, and the Workbench outer radius at 0.
- Personally inspected screenshots: `.scratch/codex-message-header-toolbar-closed.png`, `.scratch/right-dock-browser-selection-composer-draft.png`, and `.scratch/right-dock-light-active-tab-layer.png`. The light full-page view has one continuous top edge, aligned header rows, and one restrained filled control family without the supplied screenshot's macro corner cutout or mixed pill/circle/tab silhouettes.
- Overlay TypeScript passed: `bun run --cwd packages/overlay typecheck`.
- `git diff --check` passed.
- Historical-doc links passed. Document health passed 84 of 85 checks; the sole failure is the tracked-file check for this not-yet-committed record plus two unrelated concurrently indexed, untracked records (`overlay-text-contrast-deepening` and `mission-gemini-like-icon`). No product, architecture, or link-health assertion failed.
