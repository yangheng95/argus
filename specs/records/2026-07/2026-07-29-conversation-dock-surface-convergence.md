# Conversation And Right Dock Surface Convergence

> Superseded for the remaining top/left inset and child radius by
> [`2026-07-29-conversation-edge-to-edge-surface.md`](2026-07-29-conversation-edge-to-edge-surface.md).
> Its border, shadow, right-edge, and Right Dock findings remain historical
> delivery evidence.

## Recall

| Item | Detail |
| --- | --- |
| User requirement | Remove the middle Conversation surface's outer border; remove its right-side rounding and let it meet the Right Dock edge directly; make the Right Dock component header use the same white surface color as the middle Conversation. |
| Supplied evidence | `codex-clipboard-25fd628e-96fc-48f2-bcab-58c41d6d8330.png` shows the Codex shell outside and the current OpenCorvus shell inside. The OpenCorvus Conversation is visibly framed by a full border, shadow, 12-pixel inset on both sides, and two rounded upper corners. `codex-clipboard-6d3a7594-cfee-434f-9ca0-a3bade070cf4.png` marks the Codex Right Dock header, which is continuous white with the Conversation surface. Both originals were inspected at full resolution. |
| Acceptance criteria | The desktop Conversation retains its intended upper-left curve and top/left breathing room, but has no outer border or card shadow; its right edge has no radius or inset and meets the canonical Right Dock separator directly. The Right Dock tab header consumes the same `--chat-canvas` surface token as the Conversation and reads as white in the light theme. Dock tabs, controls, resizing, selection, ordering, body rendering, and the macro Workbench top-left radius remain unchanged. A real desktop page is opened, captured, and personally reviewed after the change. |
| Hard constraints | Desktop-only scope. Preserve `.workspace-main` as the sole macro Workbench radius/shadow owner and keep its `var(--oc-radius-xl) 0 0 0` geometry. Reuse existing semantic surface/radius tokens. Do not add a fallback, compatibility branch, gate, duplicate selector, theme-specific geometry, temporary iframe, local signal, query override, handwritten UI primitive, mobile/tablet work, or any UI automated test. Do not add, modify, update, delete, or run existing UI test files. Browser control and screenshots use the Browser skill with Node-backed Playwright only. |
| Sources read | Root `AGENTS.md`; Browser control skill; both supplied screenshots; `specs/current/architecture/07-panel.md`; `2026-07-29-codex-task-header-and-ledger-actions.md`; `2026-07-29-right-dock-codex-parity-and-browser-tab-instances.md`; `2026-07-29-workspace-corner-shadow-confinement.md`; `2026-07-28-workspace-top-left-radius-restoration.md`; `App.tsx`; `RightDock.tsx`; light/dark palette owners; `header.css`; and the complete canonical `workspace.css` selectors involved in the Conversation and Right Dock composition. |
| Whole-repository grep | Production search found `App.tsx` as the sole `.chat-conversation-activity` and `.conversation-workspace` renderer; `RightDock.tsx` as the sole `.right-dock-tabs`, `.right-dock-body`, and tab-control renderer; and `workspace.css` as the sole production geometry/paint owner for all of those selectors. `light.css` defines `--chat-canvas` and `--surface-strong` as white while `--surface-inset` is gray; dark palettes already project `--chat-canvas` to their canonical Conversation background. Historical UI tests were identified as consumers but remain untouched and unrun under the current prohibition. No backend, state, route, locale, database, transport, or component change is required. |
| Independent review feedback | Claude Code CLI 2.1.147 was invoked once in the repository root with the required read-only `Read,Grep,Glob` tool boundary, streaming output, and no session persistence. It returned `Not logged in · Please run /login` before reading code, so no Claude review evidence is available. The primary agent therefore owns the selector-level challenge and required second review; no sub-agent was created because the user did not request delegation. |
| Git baseline | Existing Windows database/history recovery work was verified, committed separately as `b2f82a5c46`, and pushed to `myhexin/work-v0.0.24beta-yr-0729`. The worktree was clean before this record. Concurrent Composer and rename-dialog changes appeared afterward; they are preserved and excluded from this task. |

## Cause Chain

1. The visible middle frame is not produced by the macro Workbench shell:
   `.chat-conversation-activity` adds a 12-pixel top/inline inset and paints the
   rail behind it, while its `.chat` child adds a full soft divider border,
   two upper radii, and a small shadow.
2. Those declarations deliberately implemented an earlier rounded inset-card
   request, so changing the macro `.workspace-main` radius or palette would
   damage the outer shell without removing the inner card model.
3. The right edge cannot meet the Dock while the Conversation activity retains
   right padding, and it cannot read as square while the `.chat` child retains
   its upper-right radius.
4. The Right Dock header mismatch has a separate exact trigger:
   `.right-dock-tabs` paints `--surface-inset`, which is gray in the light
   palette, while the adjacent Conversation header/canvas paints
   `--chat-canvas`, which is white.
5. The root repair is therefore confined to the canonical `workspace.css`
   composition: retain only top/left Conversation inset, delete the child's
   outer border and shadow, retain only its upper-left radius, and make the
   Dock header consume `--chat-canvas`.

## Complete Call-Site Disposition

| Owner / consumer | Decision |
| --- | --- |
| `packages/overlay/src/components/App.tsx` | Preserve the sole Conversation/Workbench DOM and Right Dock order. No conditional class or parallel layout path is needed. |
| `packages/overlay/src/components/RightDock.tsx` | Preserve Kobalte Tabs, tab instances, controls, empty state, body mounting, and resizing callbacks. No component behavior changes. |
| `packages/overlay/src/styles/surfaces/workspace.css .chat-conversation-activity` | Replace symmetric inline padding with top/left-only inset so the Conversation reaches the right separator directly. Keep the existing container query and rail backing. |
| `packages/overlay/src/styles/surfaces/workspace.css .chat-conversation-activity .chat` | Remove the complete outer border and shadow; keep the semantic white canvas; retain only the upper-left tokenized radius. |
| `packages/overlay/src/styles/surfaces/workspace.css .right-dock-tabs` | Replace the gray `--surface-inset` background with the same semantic `--chat-canvas` surface used by Conversation. Preserve the selected-tab surface and every control geometry. |
| `.workspace-main`, `right-dock-resizer`, palettes, header styles | Preserve. They already own the macro curve/shadow, canonical separator, semantic color definitions, and Conversation header correctly. |
| Existing Overlay UI tests | Do not modify or run. This pure UI change is accepted through build/static integrity plus real-page interaction and personally inspected screenshots. |

## Implementation And Verification Plan

1. Land this Recall and both spec indexes before product changes.
2. Ask the required read-only Claude Code reviewer to challenge the exact
   selector-level repair without authorizing edits or delegation.
3. Replace the obsolete inset-card declarations in the single
   `workspace.css` owner.
4. Run Overlay typecheck, production Vite build, documentation-health checks,
   and `git diff --check`; do not run UI tests.
5. Start or reuse the real isolated desktop Overlay page through the Browser
   skill, open a Conversation with the Right Dock visible, capture the exact
   Conversation/Dock region, inspect it personally, and iterate if the border,
   right inset/radius, or header color is still wrong.
6. Re-grep all owners, review the exact diff and rendered evidence a second
   time, update this record with verification evidence, fetch/converge, commit
   with the `dsw-33987` prefix, and push to `myhexin`.

## Progress

- [x] Inspect the supplied originals, historical decisions, production owners,
  all call sites, and clean Git baseline.
- [x] Record the Recall, causal chain, complete call-site disposition, and
  verification plan.
- [x] Attempt the required read-only Claude Code design challenge; record the
  authentication blocker without substituting invented feedback.
- [x] Replace the obsolete Conversation card geometry and Dock header paint.
- [x] Complete real-page visual acceptance and static/build verification.
- [x] Complete the exact-diff and rendered-evidence second review.
- [ ] Commit, reconverge with the remote branch, and push to git-cc.

## Real-Page Visual Evidence

The production Overlay was opened from the live local OpenCorvus server at
`http://127.0.0.1:4096/ui/`. A restored Mission was selected, its Right Dock
was expanded through the visible `Open right dock` control, and the complete
desktop viewport was captured and personally inspected.

The rendered result meets the requested surface composition:

- the Conversation retains only its upper-left curve;
- the Conversation has no visible outer frame or elevation;
- the Conversation's right edge terminates immediately at the canonical
  one-pixel Dock separator rather than at a rounded, inset card edge;
- the Right Dock header is white and visually continuous with the adjacent
  Conversation surface.

A bounded computed-style inspection of the same rendered state reported:

| Surface | Evidence |
| --- | --- |
| Conversation activity | `padding: 12px 0px 0px 12px`; right edge at `919px` |
| Conversation `.chat` | `border-top/right: 0px`; `border-radius: 24px 0px 0px`; `box-shadow: none`; `background: rgb(255, 255, 255)`; right edge at `919px` |
| Right Dock | left edge at `920px`, leaving only the canonical one-pixel separator |
| Right Dock header | `background: rgb(255, 255, 255)`; no radius or shadow |

These numbers are supporting diagnostics only; acceptance is based on the
personally inspected real-page capture, not an automated UI assertion.

## Static Verification And Second Review

- `bun run --cwd packages/overlay typecheck` passed.
- `node node_modules/vite/bin/vite.js build --config vite.config.ts`, executed
  from `packages/overlay`, entered Vite's real production checker, transformed
  7,055 modules, and completed successfully.
- `git diff --check` and `git diff --cached --check` passed.
- No UI automation test or UI assertion file was added, modified, or run.

The second review compared the staged selector diff against both supplied
screenshots and the real-page capture. It confirmed that the patch modifies
only the three canonical paint/geometry declarations identified in the Recall,
does not alter `.workspace-main`, the Dock separator, component behavior,
resizing, tab state, or theme token definitions, and does not stage the
concurrent Right Dock adaptive-width work that shares `workspace.css`.
