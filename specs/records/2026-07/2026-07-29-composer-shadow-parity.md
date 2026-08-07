# Composer Shadow Parity

## Recall

| Item | Detail |
| --- | --- |
| User requirement | Adjust the conversation input to follow the supplied Codex reference; the Codex input has a visible shadow. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-8d5635ec-3d3b-44ac-9312-f00b4f5a2c45.png` was inspected at original resolution. It shows one continuous white Composer shell with a fine neutral boundary and a broad, low-noise elevation shadow against the white canvas. |
| Acceptance criteria | The desktop Composer reads as a clearly elevated surface at rest without becoming a dark floating card. Keyboard focus retains the existing accent boundary while strengthening the same elevation hierarchy. Border, radius, width, height, control layout, attachments, model selector, Code/Work selector, send action, and interaction behavior remain unchanged. The real desktop page is opened, the exact Composer region is captured, and the screenshot is personally reviewed. |
| Hard constraints | Desktop-only scope. Reuse the existing semantic shadow tokens and the canonical `.chat-input` owner. Do not add a theme branch, local hard-coded color, duplicate selector, fallback, compatibility path, state machine, new primitive, mobile/tablet work, or UI automated test. Do not add, modify, update, delete, or run existing UI test files. Browser control and screenshots use the Browser skill and its Node-backed page controls. Preserve all unrelated dirty worktree changes. |
| Sources read | Root `AGENTS.md`; Browser control skill; the supplied reference image; `specs/current/architecture/07-panel.md`; `2026-07-08-projects-panel-and-codex-composer-polish.md`; `ChatComposer.tsx`; `App.tsx`; `conversation.css`; `composer.css`; light, dark, and Visual Studio Code dark palette token owners. |
| Whole-repository grep | Production search found `ChatComposer.tsx` as the sole `.chat-input` and `.chat-composer-stack` renderer; `App.tsx` as the sole `#solidChatComposer` mount; `composer.css` as the sole `.chat-input` paint owner; `conversation.css` as the sole mount/grid/backdrop owner; and `index.html` as the single production stylesheet load. The palette files are the only `--shadow-md`, `--shadow-lg`, `--ui-shadow-tone`, and `--ui-highlight-tone` theme owners. Historical UI tests consume these sources but remain untouched and unrun under the current prohibition. No backend, state, route, locale, database, transport, component, or responsive change is required. |
| Independent agent feedback | No review result was available. The required Claude Code v2.1.147 read-only invocation was attempted with only `Read,Grep,Glob`, no session persistence, and streaming output, but the installed CLI returned `Not logged in` before reading the repository. The user did not request sub-agents, so the primary agent owns the evidence-based design challenge and final second review. |
| Git baseline | `baa2d9a703` and `myhexin/work-v0.0.24beta-yr-0729` were verified converged before this task. Existing uncommitted Composer-model, Conversation/Dock, rename-dialog, locale, workspace-style, and spec-index changes are preserved and excluded from this task. |

## Cause Chain

1. The visible shell is rendered once by `ChatComposer.tsx` as `.chat-input`;
   its canonical border, surface, radius, and shadow all live in
   `styles/surfaces/composer.css`.
2. The resting declaration mixes `--ui-shadow-tone` to 14% and the focused
   declaration mixes it to 22%.
3. `--ui-shadow-tone` already contains alpha: the light palette projects it
   as 10%-opaque black and the dark palettes also project transparent black.
   Mixing that transparent token toward transparent a second time reduces the
   light resting shadow to roughly 1.4% black and the focused shadow to roughly
   2.2%, so the elevation is effectively invisible on the white canvas.
4. The supplied Codex reference does not require new geometry or a darker
   border. It requires the existing shell to consume the mature theme-owned
   elevation scale directly.
5. The root repair is therefore to replace the hand-composed double-attenuated
   shadow with the existing `--shadow-md` resting elevation and
   `--shadow-lg` focused elevation, retaining the current accent focus ring.

## Complete Call-Site Disposition

| Owner / consumer | Decision |
| --- | --- |
| `packages/overlay/src/components/ChatComposer.tsx` | Preserve the sole Composer markup, textarea, Kobalte-backed controls, attachments, and submit behavior. |
| `packages/overlay/src/components/App.tsx` | Preserve the sole `#solidChatComposer` mount and Conversation composition. |
| `packages/overlay/src/styles/surfaces/composer.css .chat-input` | Replace only the double-attenuated resting shadow with `var(--shadow-md)`. Preserve border, background, radius, padding, dimensions, and stacking. |
| `packages/overlay/src/styles/surfaces/composer.css .chat-input:focus-within` | Replace only the double-attenuated focus elevation with `var(--shadow-lg)` and retain the existing accent ring. |
| `packages/overlay/src/styles/surfaces/conversation.css` | Preserve the full-height mount grid, opaque Composer band, message clearance, pointer routing, and empty-home composition. |
| Light/dark/Visual Studio Code dark palettes | Preserve. They already own the semantic theme-specific shadow values. |
| Existing Overlay UI tests | Do not modify or run. This pure UI change is accepted through build/static integrity and real-page interaction with personally inspected screenshots. |

## Implementation And Verification Plan

1. Land this Recall and both spec indexes before the product change.
2. Ask Claude Code for a read-only challenge of the causal chain and exact
   token replacement without permitting edits, delegation, or worktrees.
3. Replace the two obsolete hand-composed shadow layers in the one canonical
   `.chat-input` owner.
4. Run Overlay typecheck, production build, documentation-health checks, and
   `git diff --check`; do not run UI tests.
5. Start or reuse the real desktop Overlay page through the Browser skill,
   capture the exact Composer region at rest and with keyboard focus, inspect
   both screenshots personally, and iterate if the elevation is too weak,
   muddy, clipped, or visually detached.
6. Re-grep the owners, inspect the exact diff and rendered evidence a second
   time, update this record with verification evidence, fetch/converge, commit
   only task-owned hunks with the `dsw-33987` prefix, and push to `myhexin`.

## Progress

- [x] Inspect the supplied original, current architecture, historical design
      decision, production owners, theme tokens, and dirty Git baseline.
- [x] Record the Recall, causal chain, complete call-site disposition, and
      verification plan.
- [x] Attempt and record the read-only Claude Code review; the local CLI was
      authentication-blocked before repository access.
- [x] Replace the double-attenuated Composer shadow.
- [x] Complete static/build verification and real-page visual acceptance.
- [x] Complete second review and prepare the isolated task-owned commit.

## Verification Evidence

| Check | Result |
| --- | --- |
| Resting computed style | `--shadow-md` resolves to `rgba(32, 38, 40, 0.08) 0px 4px 12px` plus the palette-owned inset highlight. This replaces the previous effective alpha of roughly 1.4%. |
| Focused computed style | The existing 16% accent ring remains first, followed by `--shadow-lg`, which resolves to `rgba(32, 38, 40, 0.1) 0px 12px 32px` plus the palette-owned inset highlight. |
| Real-page rest capture | `specs/artifacts/2026-07-29-composer-shadow-rest.png` was captured from the real Vite Overlay connected through Settings to an isolated real OpenCorvus backend. Personal review confirms a visible, soft elevation boundary with unchanged Composer geometry and controls. |
| Real-page focus capture | `specs/artifacts/2026-07-29-composer-shadow-focus.png` was captured after focusing the real textarea. Personal review confirms the accent boundary and expanded soft elevation remain distinct without clipping, overlap, or layout movement. |
| Overlay typecheck | `bun run --cwd packages/overlay typecheck` passed. |
| Overlay production build | `bun run --cwd packages/overlay build:vite` passed across 7,055 modules. Existing Rollup directive and chunk-size warnings remained warnings. |
| Historical document health | `bun test --timeout 20000 packages/opencorvus/test/script/historical-docs-links.test.ts` passed: 22 tests, 0 failures. The first default-timeout run stopped on one repository scan after five seconds; the longer rerun reached and passed all assertions. |
| Patch integrity | `git diff --check` passed. No UI automated test was added, changed, or run. |
