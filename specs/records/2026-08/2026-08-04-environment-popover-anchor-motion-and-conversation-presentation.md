# Environment Popover Anchor Motion And Conversation Presentation

Date: 2026-08-04
Status: Implemented
Owner: Coding Assistant

## Glossary

- UI: User Interface, the visible application surface.
- DOM: Document Object Model, the browser-rendered element tree.
- CSS: Cascading Style Sheets, the browser layout and motion language.
- SSE: Server-Sent Events, the selected conversation's live event stream.

## Recall

### User requirement

The supplied desktop screenshot identifies the chat-header Environment Information
HoverCard. Two behaviors must be restored or corrected:

1. When the Right Dock opens or closes and moves the Environment toolbar icon,
   the already-open HoverCard must move horizontally with that icon from the first
   animation frame, without waiting and then catching up.
2. Selecting a Task with visible conversation data must automatically present the
   HoverCard. Selecting an empty Task must not present it immediately, but the
   first visible conversation data produced after Composer submission must present
   it. This behavior existed previously.

### Acceptance criteria

- The existing Kobalte HoverCard, its one controlled open signal, Portal,
  `bottom-end` placement, viewport fitting, safe pointer region, hover preview,
  click pinning, and explicit close paths remain canonical.
- During the existing Right Dock width transition, the portaled positioner follows
  its moving Environment trigger on each animation frame in both directions.
- Frame tracking is opt-in for the Environment HoverCard. Other Kobalte poppers do
  not acquire a permanent animation-frame loop.
- A selected Task/Chat/Mission source with a non-empty published Card Tree opens
  Environment once for that exact selection episode.
- An empty selected source remains closed until its first visible Card Tree item is
  published, then opens once. Later stream updates do not reopen a panel that the
  operator explicitly closed during the same generation.
- Empty launcher home still tears down the hidden anchor and closes the panel.
- No second coordinate source, timer, DOM observer, viewport signal, duplicate
  panel state, positioning fallback, or UI automation test is introduced.
- Overlay typecheck/build/localization checks, document health, an isolated real
  desktop page, actual Right Dock interaction, screenshots, and a second manual
  review complete before delivery.

### Hard constraints

- Preserve unrelated working-tree changes, including the current Work Ledger spec
  files, and do not create a worktree.
- Do not restart, close, refresh, or otherwise interfere with the operator's running
  OpenCorvus/Overlay process. Visual verification uses an isolated Vite process.
- Playwright, if used as an interactive browser driver, runs through Node and does
  not create, update, or execute UI test files.
- Commit subjects use `dsw-33987`; delivery goes to `legacy-remote`.

### Material read before implementation

- `AGENTS.md` and `CLAUDE.md`.
- The supplied screenshot.
- `specs/current/architecture/07-panel.md`.
- `specs/records/2026-07/2026-07-21-environment-popover-task-start-and-chat-clearance.md`.
- `specs/records/2026-07/2026-07-22-environment-popover-anchor-lifecycle-and-hover-open.md`.
- `specs/records/2026-07/2026-07-23-environment-popover-right-dock-responsive-coexistence.md`.
- `specs/records/2026-07/2026-07-31-environment-popover-click-close-latency.md`.
- `packages/overlay/src/components/TaskDirBar.tsx` and `App.tsx`.
- `packages/overlay/src/components/ui/HoverCard.tsx`.
- `packages/overlay/src/store/card-tree.ts`.
- `packages/overlay/src/services/conversation.ts`, `task.ts`, and
  `tree-writer.ts`.
- `packages/overlay/src/styles/surfaces/workspace.css` and `conversation.css`.
- Installed Kobalte 0.13.11 Popper and HoverCard source.
- Existing `patches/@kobalte%2Fcore@0.13.11.patch` package patch.

### Whole-repository search evidence

Searches covered `ProjectRuntimeStatusPanel`, `panelOpen`, `panelPinned`,
`anchorVisible`, `rightDockOpen`, every Right Dock open writer, `cardTreeStore.order`,
`treeEpoch`, `visibleVersion`, `replaceCardTreeOrder`, `resetWriter`,
`hydrateConversation`, Kobalte `autoUpdate`, the current package patch, historical
Environment records, and the Git history that added and later removed source/run
auto-presentation.

| Owner / call point                                   | Current fact                                                                                                                                          | Disposition                                                                                                       |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `TaskDirBar.ProjectRuntimeStatusPanel`               | Owns the single Environment open/pin state and all close paths.                                                                                       | Add one generation-presentation memory and derive eligibility from selected source plus published Card Tree data. |
| `App.tsx`                                            | Mounts Environment once and supplies the canonical hidden-anchor fact.                                                                                | Keep unchanged; the Card Tree and selected source are already canonical stores available to the owner.            |
| `card-tree.ts`                                       | `order` is the visible top-level conversation projection; complete replacements may occur while one source remains selected.                          | Require visible `order` content, but key presentation to the current source-selection episode.                    |
| `tree-writer.ts` / `conversation.ts`                 | Hydration and first live data publish through the same Card Tree owner.                                                                               | Keep unchanged; no message/SSE callback bridge is needed.                                                         |
| `workspace.css`                                      | Right Dock continuously animates `flex-basis`, `width`, and `max-width`, moving the header trigger each frame.                                        | Keep the canonical motion and width sources unchanged.                                                            |
| Kobalte Popper                                       | Floating UI `autoUpdate` enables resize observation but not its `animationFrame` option, so a moving fixed-size reference is not measured each frame. | Expose the mature Floating UI option through an opt-in Popper root prop in the existing package patch.            |
| `HoverCard.tsx`                                      | Thin canonical wrapper over Kobalte HoverCard.                                                                                                        | Keep unchanged; pass the opt-in prop only at the Environment feature call site.                                   |
| Git history `6765856a6b`, `316bcce465`, `26cf454572` | Environment previously auto-opened by Task run or source identity, then the behavior was removed to stop empty new chats opening immediately.         | Restore the intent with the stricter visible-data condition rather than reverting the broad source-only trigger.  |
| UI test paths                                        | Historical Environment browser/source tests were already deleted under the UI automation prohibition.                                                 | Do not recreate or run them; use an isolated real page and manual screenshot review.                              |

No backend route, database model, message protocol, Right Dock visibility state,
Card Tree writer, localization key, panel catalog, or layout-width token changes.

### Independent feedback

- Two bounded read-only child investigations were launched for the animation and
  auto-presentation chains. Their sessions completed but returned no substantive
  findings to the parent, so no conclusion is attributed to them.
- Claude Code 2.1.147 was invoked with `Read,Grep,Glob`, medium effort, no session
  persistence, and a bounded budget. It could not review because the local CLI is
  not authenticated (`Not logged in · Please run /login`). No files were changed.

## Evidence-backed root cause

### Delayed horizontal movement

The trigger participates directly in the Conversation/Right Dock flex layout and
moves continuously while the Dock width transitions. The HoverCard is portaled and
positioned by Kobalte Popper. Its installed `autoUpdate` call observes element
resizes, but the trigger keeps the same dimensions while its viewport position
changes. Floating UI therefore does not recompute every transition frame; a later
layout observation updates the Portal transform, producing the visible pause and
catch-up movement. Floating UI already provides `animationFrame: true` specifically
for continuously moving reference elements, but Kobalte 0.13.11 does not expose it.

### Missing automatic presentation

The current `TaskDirBar` has no reactive effect that links selected conversation
content to `openRuntimePanel()`. Historical implementations opened by active Task run
or source identity; a later change removed that behavior to prevent a newly created,
still-empty Chat from opening Environment. Source identity alone was too broad, but
removing the effect also discarded the valid cases: hydrated history and the first
visible result of an empty conversation. The Card Tree now provides the exact fact
needed to distinguish them.

## Implementation plan

1. Extend the existing Kobalte package patch with an opt-in
   `autoUpdateAnimationFrame` Popper option and forward it to Floating UI
   `autoUpdate` in source and both distributed runtime builds.
2. Enable that option only on the Environment HoverCard.
3. Add one local selected-source episode and presented-source key in
   `ProjectRuntimeStatusPanel`. When the anchor is visible, the selected source exists,
   and `cardTreeStore.order` is non-empty, pin and open the same HoverCard once for
   that selection episode. A source change resets presentation eligibility; a Card
   Tree replacement within the same selection does not.
4. Update current panel architecture and documentation indexes.
5. Run non-UI validation, launch an isolated real Overlay page, exercise actual Dock
   open/close and conversation-data presentation, capture and inspect screenshots,
   then perform a second diff review.

## Status

- [x] Screenshot, history, architecture, component, Card Tree, Dock, and dependency diagnosis.
- [x] Kobalte opt-in anchor-motion implementation.
- [x] Conversation-data auto-presentation implementation.
- [x] Non-UI validation.
- [x] Real-page interaction and screenshot review.
- [x] Second review, commit, reconciliation, and push.

## Validation results

- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay build:vite`: passed after transforming 7,073
  modules. Existing third-party `use client` and chunk-size advisories remained
  informational.
- `bun run --cwd packages/overlay check:i18n`: passed with catalog hash
  `9a47c298c4878311`.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts
packages/opencorvus/test/script/document-health.test.ts
packages/opencorvus/test/script/product-docs-single-source.test.ts`: 70 passed,
  0 failed.
- `git apply --reverse --check` against the installed Kobalte package passed,
  proving the complete tracked package patch matches its installed projection.
- `git diff --check`: passed.
- An isolated Vite page was opened in real Chromium through Node without touching
  the operator's running Overlay. Selecting the current Task with 33 visible Card
  Tree roots produced `aria-expanded="true"` and `data-pinned` on the Environment
  trigger without hover or click on that trigger.
- Opening the actual Right Dock moved both trigger and panel 361 pixels left;
  closing it moved both 361 pixels right. Across animation-frame samples, their
  relative horizontal offset varied by no more than 0.25 pixel, with no stationary
  panel interval or catch-up translation.
- Manual original-resolution review confirmed the complete panel remains aligned,
  unclipped, readable, and above Conversation content both before and after the
  Dock transition:
  - [automatic presentation](../../artifacts/2026-08-04-environment-popover-auto-presented.png)
  - [Right Dock open](../../artifacts/2026-08-04-environment-popover-right-dock-open.png)
- The isolated preview Task was explicitly cancelled after verification and its
  terminal record was retained.

Second review re-read the component effect, selected-source and Card Tree owners,
Kobalte source/runtime/type patch, current architecture, complete diff, geometry
samples, and both screenshots. It confirmed that Environment retains one open/pin
state and one native placement owner; the only new presentation memory is scoped to
the current source selection, and animation-frame tracking exists only while this
one HoverCard is mounted. No timer, DOM observer, duplicate message callback,
coordinate override, compatibility path, UI test artifact, or unrelated CSS change
is part of the delivery.
