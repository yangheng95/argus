# Conversation, Environment, and Mailbox hover repair

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | Remove the remaining conversation hover background. Left-align “Environment information” and place its expand/collapse icon immediately after the title. Make hovering the Mailbox icon preview the Mailbox page and restore the previous Work Ledger page when hover ends. |
| User clarification | The conversation card's regular background must remain visible. Only the additional background introduced by hover must be absent. |
| Supplied evidence | `codex-clipboard-406bfc3d-f442-4bbe-997e-5fc639345a1e.png` shows the Agent conversation header/body lane painted grey during hover. `codex-clipboard-d7818714-c120-4b2a-96f4-220c505b9ab9.png` highlights a centered Environment title with no adjacent disclosure icon. Both images were inspected at original resolution. |
| Acceptance criteria | Agent conversations retain their canonical non-transparent stage-tinted card background, and hover/focus does not add or replace that paint while actions remain available. Environment title begins on the shared heading text axis, the visible 16-pixel disclosure icon follows the rendered title by 2–6 pixels, and the plus action stays on the trailing axis. Hovering the Mailbox launcher temporarily displays Mailbox while `aria-pressed` remains false; leaving restores Work Ledger; clicking still persistently selects Mailbox. Real desktop browser fixtures and task-scoped screenshots cover all three paths. |
| Hard constraints | Reuse the existing Button text-disclosure primitive and existing Mailbox/Popover implementations. Do not add a parallel page-selection source, route, iframe, signal override, feature gate, fallback, or custom icon. Preserve unrelated dirty-worktree changes. Do not restart, refresh, stop, or reuse the user’s running OpenCorvus/Overlay; use isolated Node-launched browser targets. Desktop-only scope. |
| Sources read | Root `AGENTS.md`; Browser control skill; the two supplied screenshots; `2026-07-23-environment-heading-geometry-and-mission-presentation.md`; `2026-07-24-message-hover-timestamp-removal.md`; `2026-07-22-right-dock-terminal-visibility-and-mailbox-hover-actions.md`; `App.tsx`; `ChatBubble.tsx`; `TaskDirBar.tsx`; Button/Section primitives; conversation/chat-bubble/card CSS; focused source and browser tests. |
| Whole-repository grep | `ChatBubble.tsx` is the only producer of `data-ui="chat-bubble-head-main"`; `chat-bubble.css` owns its local presentation, while `button.css` owns the higher-specificity generic hover wash and the mature `data-chrome="text-disclosure"` exception. `TaskDirBar.tsx` is the only Environment title/disclosure DOM owner and `conversation.css` is its only geometry owner; `task-cwd-row-layout.test.ts` and `task-dirbar-keyboard.test.ts` are the direct regressions. `App.tsx` is the only Mailbox launcher/left-panel projection owner; `main.tsx` remains the sole persistent `leftSidebarPanel` owner. `mailbox-contextbar-launcher.test.ts` and `mailbox-left-sidebar-browser.test.ts` directly cover the launcher. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration boundary forbids unrequested delegation. The primary agent performs implementation and second review. |
| Git baseline | `HEAD` and `legacy-remote/work-v0.0.17beta-yr-0723` both point to `b0d22ba49`. The shared worktree already contains unrelated OpenCorvus, Overlay, test, and spec changes; only task-owned hunks will be staged. |

## Causal chain

1. The Agent row already defines the canonical
   `--conversation-card-background`, but the Agent bubble stopped consuming it
   and was incorrectly made transparent.
2. Separately, the header is a ghost Button. The generic Button hover selector
   has greater specificity than the local
   `.chat-bubble__head-main.oc-button:hover` rule, so it wins and paints
   `--hover-wash` across the flexible header/body lane seen in the screenshot.
3. The Environment disclosure Button and title group both stretch to the first
   grid column; the title span itself flexes, pushing the icon to the far edge.
   The same icon is opacity-zero until hover, so it cannot remain attached to
   the visible title.
4. Mailbox hover currently invokes the same persistent `onOpenMailbox` callback
   as a click. Pointer leave only clears the not-yet-fired timer, so an already
   opened page cannot be restored.
5. A reactive hover preview belongs locally to `App`; persistent selection
   remains solely in `main.tsx`. Rendering from
   `mailboxActive || mailboxHoverPreview` gives the requested temporary page
   without mutating or duplicating the canonical persistent selection.
6. The Work Ledger search launcher must remain mounted during transient preview;
   hiding it shifts the Mailbox icon away from the pointer and self-cancels the
   hover. It remains hidden only for a persistently selected Mailbox page.

## Call-site disposition

| Owner / consumer | Decision |
| --- | --- |
| `packages/overlay/src/components/ChatBubble.tsx` | Mark the existing fold Button with the shared `text-disclosure` chrome so the canonical primitive owns transparent hover/focus presentation. Preserve fold state, actions, status, timing, and body rendering. |
| `packages/overlay/src/styles/surfaces/chat-bubble.css` | Restore the Agent card's canonical `--conversation-card-background`. Do not add a card hover rule; the shared disclosure primitive prevents extra hover paint while the card background remains unchanged. |
| `packages/overlay/src/components/TaskDirBar.tsx` | Mark the Environment disclosure with the same shared text-disclosure primitive. Preserve title-then-icon DOM order and plus action. |
| `packages/overlay/src/styles/surfaces/conversation.css` | Change the Environment head to intrinsic disclosure/title geometry, keep the title and icon on the left, and keep the icon visible immediately after the title. Preserve the trailing plus axis and all category/resource rows. |
| `packages/overlay/src/components/App.tsx` | Add one local transient Mailbox hover-preview signal. Derive visible left-panel content from persistent selection or preview; keep `aria-pressed` and click semantics bound only to persistent selection. Clear preview on leave, click, and cleanup. |
| `packages/overlay/src/main.tsx` | Preserve as the only persistent left-sidebar selection owner; no new callback or state source. |
| `packages/overlay/src/styles/surfaces/mailbox.css` | When hover, selection, or visible focus replaces the identity glyph with the existing checkbox, make the opacity-zero identity glyph non-interactive so it cannot intercept the checkbox. |
| Focused source tests | Assert shared text-disclosure use, intrinsic Environment geometry and visible adjacent icon, and transient Mailbox derivation without hover calling `onOpenMailbox`. |
| Task-scoped Node browser verification | Measure Agent header background before/while hover; assert Environment title/icon gap, left axis, and visible icon; assert Mailbox hover-preview/leave restoration/click persistence and capture screenshots. |

## Implementation plan

1. Add failing source/browser assertions for the three reported paths.
2. Apply the minimal changes at the existing Button, Environment geometry, and
   App left-panel owners.
3. Run focused tests, Overlay typecheck/build, documentation health, and diff
   hygiene.
4. Run the isolated Node browser fixtures, inspect the generated desktop
   screenshots at original resolution, and correct any visual drift.
5. Re-grep owners, review the exact diff a second time, commit only task-owned
   files with the `dsw-33987` prefix, fetch/converge, and push the current
   branch to `legacy-remote`.

## Result

- The Agent conversation disclosure now uses the shared
  `data-chrome="text-disclosure"` Button presentation, so the disclosure remains
  transparent while the existing actions and fold interaction remain available.
  The owning Agent card retains its canonical non-transparent stage-tinted
  background, and that background is identical at rest and hover.
- The Environment head now uses an intrinsic first grid column. Its title and
  disclosure icon remain left-aligned as one group, the icon is always visible
  immediately after the rendered title, and the plus action remains on the
  trailing axis.
- Mailbox hover now controls only an `App`-local preview. Pointer leave restores
  Work Ledger, `aria-pressed` continues to describe only persistent selection,
  and click still pins Mailbox through the canonical `main.tsx` owner.
- During transient preview the Work Ledger search launcher stays mounted so the
  Mailbox icon cannot move away from the pointer. Hidden Mailbox identity glyphs
  no longer receive pointer events, so they cannot intercept the revealed
  checkbox.

## Verification

| Check | Result |
| --- | --- |
| Focused source tests | `26 pass, 0 fail, 658 assertions` across ChatBubble, Mailbox launcher/panel, and Environment geometry coverage. |
| Clarification regression | `6 pass, 0 fail, 137 assertions` for the focused ChatBubble source suite; the Node browser fixture also passed `1/1`, asserting a non-transparent resting card background and exact rest/hover paint equality. |
| Mailbox browser interaction | `1 pass`; verified delayed hover preview, false `aria-pressed`, pointer-leave restoration, click persistence, and checkbox interaction. |
| Conversation and Environment browser interaction | Conversation disclosure background remained transparent at rest and hover while the owning card retained the same non-transparent background in both states. All Environment keyboard/geometry checks passed, including a visible adjacent disclosure icon with a measured 2–6 pixel gap. |
| Visual review | Inspected `.scratch/conversation-background-rest.png`, `.scratch/conversation-background-hover.png`, `.scratch/task-dirbar-runtime-status-expanded-state.png`, `.scratch/left-sidebar-mailbox-hover-preview.png`, and `.scratch/left-sidebar-mailbox-hover-restored.png` at original resolution; all requested surfaces match the supplied intent. |
| Overlay validation | `bun run typecheck` and `bun run build` passed. `git diff --check` passed. |
| Documentation validation | Historical-link checks passed. The first combined run exhausted its 30-second per-test allowance under concurrent repository scans; the isolated document-health rerun with the repository's longer validation allowance passed `61/61`. |

## Codex second review

The first browser pass exposed that hiding the search launcher during preview
changed the launcher's geometry and canceled its own hover. Keeping that icon
mounted for transient preview fixed the root cause without introducing another
selection source. A later checkbox path exposed the opacity-zero Mailbox
identity glyph as a pointer interceptor; disabling pointer events only while
that existing glyph is hidden restored the intended checkbox owner. Re-running
the Mailbox fixture, focused tests, typecheck, build, screenshot inspection, and
diff hygiene found no remaining defect in the three requested paths.

The user's follow-up clarified that "remove the hover background" did not mean
removing the owning card's resting paint. Repository history showed that
`--conversation-card-background` remained defined but had stopped being
consumed. Restoring that existing token, while retaining the shared
`text-disclosure` hover exception, makes the card's computed background
non-transparent and byte-for-byte equal before and during hover.
