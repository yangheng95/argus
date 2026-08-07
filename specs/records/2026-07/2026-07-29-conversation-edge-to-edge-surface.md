# Conversation Edge-To-Edge Surface

## Recall

| Item | Detail |
| --- | --- |
| User requirement | Remove the inner top/left Conversation gutter while retaining the rounded Workbench shell. The user's final reference requires the center Conversation and right Dock to begin on exactly the same top line below the titlebar; the macro top-left corner remains rounded. |
| Supplied evidence | `codex-clipboard-8f213cac-d76e-4ab5-a487-10d10b36c3f3.png` marks the original inner gray gutter. `codex-clipboard-b27c63dc-9a6c-4d74-aaee-69728daa2f34.png` exposed that the first acceptance crop included pixels outside the Workbench. The final target `codex-clipboard-684871e5-da74-48bc-a35d-da5721d22ea7.png` explicitly preserves the titlebar band and rounded Workbench corner while aligning the center and right workspace surfaces at one top coordinate. |
| Acceptance criteria | The desktop Conversation fills the center Workbench with no activity-owned top or left padding and no second child radius. The existing `.workspace-main` remains the single rounded macro frame. Conversation and open Right Dock share its top coordinate and continuous workspace material. The titlebar/rail band, Dock separator, tabs, resizing, message-column width, message-card padding, Composer alignment, and Conversation Agent Rail remain unchanged. A real desktop page with the Right Dock open is captured and personally reviewed. |
| Hard constraints | Desktop-only scope. Fix only the inner Conversation geometry; preserve `.workspace-main` radius, shadow, ambient fill, clipping, titlebar paint, and the live sidebar boundary. Do not add a fallback, compatibility branch, gate, duplicate shell, theme-specific geometry, temporary iframe, local signal, query override, handwritten UI primitive, mobile/tablet work, or any UI automated test. Do not add, modify, update, delete, or run existing UI test files. Use Node-backed Browser control for real-page inspection and screenshots. Preserve unrelated uncommitted changes. |
| Sources read | Root `AGENTS.md`; Browser control skill; supplied screenshot; `specs/current/architecture/07-panel.md`; `2026-07-29-conversation-dock-surface-convergence.md`; `2026-07-29-workspace-corner-shadow-confinement.md`; `2026-07-28-workspace-top-left-radius-restoration.md`; `App.tsx`; `workspace.css`; `conversation.css`; `composer.css`; `cascade/base.css`; relevant Git history and blame. |
| Whole-repository grep | Production search found `App.tsx` as the sole `.workspace-main`, `.chat-conversation-activity`, `.conversation-workspace`, and Right Dock renderer. `workspace.css` is the sole Workbench radius/shadow, Conversation activity, Right Dock, and separator geometry owner. `conversation.css` owns only internal transcript/message insets. `titlebar.css`, `design-language.css`, `activity.css`, `sidebar.css`, and `pane.ts` were inspected and must remain unchanged. Historical specs and UI tests consume or describe these selectors but are not runtime owners and remain untouched and unrun. No component, backend, route, locale, database, or transport change is required. |
| Independent review feedback | Claude Code CLI 2.1.147 was checked through command discovery, version, and help, then invoked from the repository root with the required read-only `Read,Grep,Glob` boundary, streaming output, and no session persistence. It returned `Not logged in · Please run /login` before reading code, so no Claude review evidence is available. The primary agent owns the selector-level challenge and second review; no sub-agent was created because the user did not request delegation. |
| Git baseline | The inner Conversation correction shipped in `8343307f09` and was pushed to `legacy-remote/work-v0.0.24beta-yr-0729`. The shared branch subsequently advanced through unrelated commits to `a9cf207cf1`; the remote is aligned. The later, incorrect outer-shell flattening experiment was fully reverted before any commit. Unrelated uncommitted files remain excluded from this task commit. |

## Cause Chain

1. The visible gray gutter is not a message-card margin. The sole Conversation
   activity wrapper declares `padding: 12px 0 0 12px`, scaled by `--ui-scale`,
   and paints `--rail-surface` behind that empty top/left area.
2. Its `.chat` child still declares an upper-left radius, so the white
   Conversation remains modeled as an inset child card even though the earlier
   border, shadow, right inset, and upper-right radius were removed.
3. The previous convergence record explicitly accepted “top/left breathing
   room”; that acceptance decision, not a browser cache or card-width token,
   is why the gutter survived the earlier repair.
4. The first repair correctly removed the inner inset and child radius. Its
   1010×520 evidence crop was wrong because it began 12 pixels above and 11
   pixels left of `.workspace-main`; it therefore presented the intentional
   titlebar/rail plane as if it were a surviving inner gutter.
5. The final reference clarifies that `.workspace-main`'s macro top-left radius
   and the titlebar band are required. Flattening that frame would violate the
   target.
6. Conversation and Right Dock are siblings inside the same `.workspace-main`.
   With the activity padding gone, both resolve to the Workbench's `y`
   coordinate and remain clipped by the one macro radius.
7. The completed root repair is therefore the original two-declaration inner
   correction. The outer titlebar, radius, shadow, tokens, and sidebar boundary
   must not change.

## Complete Call-Site Disposition

| Owner / consumer | Decision |
| --- | --- |
| `packages/overlay/src/components/App.tsx` | Preserve the sole Workbench → Conversation activity → `.chat` DOM chain. No conditional class or parallel layout path is needed. |
| `packages/overlay/src/styles/surfaces/workspace.css .chat-conversation-activity` | Replace the remaining top/left padding with zero. Preserve the container query identity and canonical rail-surface backing for other activity geometry. |
| `packages/overlay/src/styles/surfaces/workspace.css .chat-conversation-activity .chat` | Remove the remaining child radius. Preserve flex sizing, zero border, `--chat-canvas`, and zero shadow. |
| `packages/overlay/src/styles/surfaces/workspace.css .workspace-main` | Preserve as the single macro radius, clip, ambient fill, and shadow owner. |
| `titlebar.css`, `design-language.css`, `activity.css`, `sidebar.css`, and `pane.ts` | Preserve. Their titlebar band, radius/shadow tokens, and live sidebar boundary are part of the clarified target, not Conversation padding. |
| `conversation.css` transcript insets and `composer.css` width/alignment | Preserve. They control internal reading rhythm and are not the marked outer gutter. |
| Right Dock selectors, palettes, tokens, components, and resizing | Preserve. The Conversation already meets the canonical Dock separator and its header color is correct. |
| Existing Overlay UI tests | Do not modify or run. This pure UI correction is accepted through static/build integrity plus real-page interaction and personally inspected screenshots. |

## Implementation And Verification Plan

1. Land this Recall and both spec indexes before product changes.
2. Keep the completed activity inset/radius removal and reject any outer-shell
   flattening.
3. Run Overlay typecheck, the real production Vite build, documentation-health
   checks, and `git diff --check`; do not run UI tests.
4. Start or reuse the real desktop Overlay page through the Browser skill,
   capture the exact Conversation/Right Dock region, inspect it personally, and
   iterate if any top/left gutter or second child radius remains.
5. Re-grep all production owners, review the exact diff and rendered evidence a
   second time, update this record with verification evidence, fetch/converge,
   commit with the `dsw-33987` prefix, and push to `legacy-remote`.

## Progress

- [x] Inspect the supplied screenshot, prior decisions, Git history, production
  owners, and all call sites.
- [x] Record the Recall, causal chain, complete call-site disposition, and
  verification plan before product changes.
- [x] Attempt the required read-only Claude Code design challenge and record the
  authentication blocker.
- [x] Remove the obsolete Conversation activity inset and child radius.
- [x] Complete real-page visual acceptance with the rounded Workbench and open
  Right Dock visible in the same screenshot.
- [x] Complete the exact-diff and rendered-evidence second review against the
  user's final target.
- [x] Prepare the corrected evidence/record for the final `dsw-33987` commit
  and legacy remote push.

## Final Real-Page Visual Evidence

The production Overlay source was opened through the Node-launched Vite server
at `http://127.0.0.1:5173/`. A separate real OpenCorvus server was started on
port 7880 with this repository as its project directory and the Vite origin
explicitly allowed. Through the visible Network settings, the page connected
to that server, opened the real `你好` Conversation, and activated the real
`Open right dock` control. No fixture, local state injection, query override,
temporary iframe, or synthetic Dock was used.
The isolated server was stopped after capture, and the visible Network setting
was restored to its original `http://127.0.0.1:7879` value.

The full-shell capture is
[`specs/artifacts/2026-07-29-conversation-edge-to-edge.png`](../../artifacts/2026-07-29-conversation-edge-to-edge.png).
It was inspected at original 1280×720 resolution. The Workbench retains its
rounded upper-left corner below the titlebar, while the center Conversation
header plane and the open right Dock header visibly start on the same row.
There is no gray activity gutter between the macro corner and the Conversation.

A bounded computed-style inspection of that exact rendered state reported:

| Surface | Rectangle | Geometry |
| --- | --- | --- |
| `.workspace-main` | `x=281, y=36, width=999, height=684` | `padding: 0`; `border-radius: 24px 0 0`; macro shadow retained |
| `.chat-conversation-activity` | `x=281, y=36, width=638, height=684` | `padding: 0`; `border-radius: 0` |
| `.chat-conversation-activity .chat` | `x=281, y=36, width=638, height=684` | `padding: 0`; `border-radius: 0`; `box-shadow: none` |
| `.right-dock-resizer` | `x=919, y=36, width=1, height=684` | Canonical separator |
| `.right-dock[data-open="true"]` | `x=920, y=36, width=360, height=684` | `padding: 0`; `border-radius: 0` |
| `.right-dock-tabs` | `x=920, y=36, width=360, height=40` | Canonical white Dock header |

The Conversation, separator, and open Dock all resolve to `y=36`; the one
24-pixel radius remains exclusively on `.workspace-main`. The full-shell
screenshot and exact geometry jointly match the user's final reference.

## Static Verification And Second Review

- `bun run typecheck` from `packages/overlay` passed.
- `node node_modules/vite/bin/vite.js build --config vite.config.ts` from
  `packages/overlay` entered Vite's real production checker, transformed 7,055
  modules, and completed successfully.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`
  initially exposed that the new record had not yet been staged; this is a
  tracked-file integrity check, not a product failure. After the record and
  evidence were staged, the same command passed all 85 tests with 0 failures.
- `git diff --check` and `git diff --cached --check` passed.
- No UI automation test or UI assertion file was added, modified, or run.

The final second review compared the two-declaration product fix, the complete
shell/Dock owner grep, the user's final reference, the open-Dock screenshot,
and computed geometry. It confirms that the inner activity inset and child
radius are gone, the macro Workbench radius/shadow/titlebar remain intact, and
Conversation plus Right Dock share one top coordinate. The rejected
outer-shell flattening left no product or architecture diff.
