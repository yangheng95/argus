# Environment Content Clearance and Scrollbar Anchor

Date: 2026-07-28
Status: Accepted
Owner: Codex

## Glossary

- CSS: Cascading Style Sheets, the browser presentation language.
- DOM: Document Object Model, the rendered browser element tree.
- UI: User Interface, the visible application surface.
- VCS: Version Control System, the canonical repository status source.

## Recall

### User requirement

The supplied first screenshot shows the Environment Information surface moving
the conversation scrollbar left with the squeezed conversation frame. The
second screenshot is the required result: the Environment surface may reduce
the usable middle content lane, but the one conversation scrollbar remains
anchored at the far-right edge of the conversation viewport.

### Acceptance criteria

- Keep the existing single portaled Environment Information surface, its
  header anchor, contents, behavior, size, and canonical data sources.
- Keep `#chatScroll` as the one full-width conversation scroll container so
  its permanently visible native scrollbar remains at the conversation
  viewport's far-right edge when Environment opens.
- At the existing wide desktop boundary, center messages, empty state, and the
  Composer within the remaining content lane to the left of Environment.
- Do not apply Environment clearance to `#chatContentFrame`,
  `#chatMessagePane`, `#conversationBody`, or `#chatScroll` width.
- At compact desktop widths, retain the existing floating-overlay behavior and
  do not reserve a content lane.
- Opening and closing Environment must animate the internal content clearance
  with the shared motion token; reduced-motion preference must remain instant.
- Verify the exact scrollbar, message, Composer, and Environment geometry in a
  Node-launched isolated Vite page and inspect a goal-scoped desktop
  screenshot at original resolution.

### Hard constraints

- Desktop is the only requested visual target.
- Do not restart, refresh, close, or otherwise interfere with the operator's
  running OpenCorvus or Overlay processes.
- Do not add another Environment renderer, scroll container, width source,
  fallback, compatibility branch, layout gate, or state machine.
- Reuse the existing Kobalte HoverCard, `#chatScroll`, conversation inset
  variables, and shared design-language tokens.
- Preserve all unrelated worktree changes. Do not reset, restore, stash, or
  create another worktree.
- New commits use the `dsw-33987` prefix and push to `legacy-remote`.

### Material read before implementation

- Root `AGENTS.md`.
- Browser control skill.
- Supplied screenshots:
  - `C:/Users/10132/AppData/Local/Temp/codex-clipboard-f1a20036-444d-4a8f-b628-694b90d08795.png`.
  - `C:/Users/10132/AppData/Local/Temp/codex-clipboard-c12f9c3d-d40f-48d4-9d5d-15691c0fe222.png`.
- `specs/current/architecture/07-panel.md`.
- `specs/records/2026-07/2026-07-21-environment-popover-task-start-and-chat-clearance.md`.
- `specs/records/2026-07/2026-07-25-environment-popover-floating-message-overlay.md`.
- `specs/records/2026-07/2026-07-28-environment-panel-design-language-convergence.md`.
- `packages/overlay/src/components/App.tsx`.
- `packages/overlay/src/components/TaskDirBar.tsx`.
- `packages/overlay/src/styles/cascade/base.css`.
- `packages/overlay/src/styles/surfaces/conversation.css`.
- `packages/overlay/src/styles/surfaces/workspace.css`.
- `packages/overlay/src/styles/tokens/design-language.css`.
- `packages/overlay/test/task-cwd-row-layout.test.ts`.
- `packages/overlay/test/browser/task-dirbar-keyboard.test.ts`.

### Whole-repository search

The pre-change search enumerated `Environment information`,
`project-runtime-status-panel`, `#chatContentFrame`, `#chatMessagePane`,
`#conversationBody`, `#chatScroll`, `conversation-scroll-shell`,
`chat-home-composition`, `#solidChatComposer`,
`--ui-runtime-environment-chat-clearance`, every Environment source/browser
assertion, current architecture clauses, and the July Environment records.

| Owner / call point                        | Current evidence                                                                                                     | Disposition                                                                                                                            |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `TaskDirBar.ProjectRuntimeStatusPanel`    | Owns the only Kobalte HoverCard and portals it from the chat header.                                                 | Keep component markup, state, placement, and data unchanged.                                                                           |
| `App.tsx` conversation DOM                | Places `#chatScroll` and the real Composer inside one `conversation-scroll-shell`.                                   | Keep this one-scroller structure; add no wrapper or second scrollbar.                                                                  |
| `base.css`                                | Makes only `#chatScroll` opt into persistent scrollbar geometry and paint.                                           | Keep unchanged.                                                                                                                        |
| `conversation.css .chat-scroll`           | Owns full-width scrolling plus calculated message insets.                                                            | Preserve full width; split start/end content insets so only the end side receives Environment clearance.                               |
| `conversation.css #solidChatComposer`     | Aligns the non-scrolling Composer to the same message insets.                                                        | Consume the same asymmetric end inset so messages and Composer stay aligned.                                                           |
| `conversation.css .chat-home-composition` | Centers the empty-home prompt and Composer across the full conversation viewport.                                    | Reserve the same internal inline-end content clearance at wide desktop widths.                                                         |
| `conversation.css #chatContentFrame`      | Currently receives Environment `padding-inline-end`, shrinking all descendants and moving the native scrollbar left. | Remove this coupling and transition the internal content-clearance variable instead.                                                   |
| `design-language.css`                     | Owns the Environment panel width and composite clearance.                                                            | Keep these structural tokens as the single clearance source.                                                                           |
| `task-cwd-row-layout.test.ts`             | Requires frame padding and its transition.                                                                           | Replace with the full-width scrollport plus asymmetric content-inset contract.                                                         |
| `task-dirbar-keyboard.test.ts`            | Measures frame padding and message-pane geometry, but not the scrollbar anchor.                                      | Measure unchanged scrollport width/right edge, internal message/Composer clearance, and panel non-overlap; update screenshot evidence. |
| `specs/current/architecture/07-panel.md`  | Says the conversation frame reserves the Environment lane.                                                           | Replace with the full-width scrollport/internal-content-clearance contract.                                                            |

No backend route, API schema, database model, task identity, VCS behavior,
Right Dock width source, localization key, or Environment visibility state
participates in this repair.

### Independent-agent feedback

None. The user did not request delegation, and the active collaboration
boundary forbids unrequested sub-agents.

## Causal analysis

### Observable symptom

When Environment is visible on a wide desktop conversation, the native
conversation scrollbar appears immediately to the left of the floating card
instead of at the far-right edge shown by the target screenshot.

### Direct trigger

The open portaled panel matches
`body:has(.project-runtime-status-panel) #chatContentFrame`, which adds the
composite Environment width as `padding-inline-end` to the frame.

### Root cause

`#chatContentFrame` contains the complete message pane and the sole
`#chatScroll` scrollport. Reserving space on that ancestor correctly keeps
message content clear of Environment, but it also contracts the scrollport
itself. Because the native scrollbar belongs to `#chatScroll`, its physical
right edge necessarily follows the contracted ancestor. The implementation
therefore conflates two distinct responsibilities: scroll viewport geometry
and readable content-lane geometry.

The root correction is to leave the scroll viewport full width and project the
existing Environment clearance only into the message/Composer/empty-home
content insets. This preserves one scrollbar source while centering the middle
content in the remaining lane.

## Implementation plan

1. Replace frame padding with one inherited internal content-clearance variable
   at the existing wide desktop container boundary.
2. Split conversation start/end inset calculation so Environment clearance is
   added only to the content end side while the remaining lane stays centered.
3. Apply that shared end inset to transcript content, the real Composer, and
   the empty-home composition without changing `#chatScroll` width.
4. Update current architecture and focused source/browser assertions.
5. Run focused tests, Overlay typecheck/build, document health, and the
   Node-launched browser scenario. Inspect the screenshot, correct visual
   discrepancies, and repeat.
6. Perform a second diff, geometry, and screenshot review; commit task-owned
   changes, fetch/reconcile the delivery branch, and push to `legacy-remote`.

## Status

- [x] Baseline repository, history, architecture, call-point, and screenshot investigation.
- [x] CSS and architecture implementation.
- [x] Focused source and real-browser regression coverage.
- [x] Original-resolution visual review and correction.
- [x] Second code, geometry, and original-resolution screenshot review.
- [x] The accepted implementation is ready for its traceable commit and
      `legacy-remote` push.

## Verification evidence

- `bun test packages/overlay/test/task-cwd-row-layout.test.ts`: 9 passed,
  zero failed. The source contract rejects Environment frame padding, requires
  one full-width transcript with asymmetric start/end content insets, aligns
  the Composer to those same insets, and preserves reduced-motion behavior.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay check:i18n`: passed.
- `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1 node --test
--test-concurrency=1 --test-name-pattern="Environment squeezes overflowing
content without moving the transcript scrollbar"
packages/overlay/test/browser/task-dirbar-keyboard.test.ts`: passed against
  the real Node-launched Vite page.
- Browser geometry proved the long transcript genuinely overflows, its native
  scrollbar paint is non-transparent, `#chatScroll` keeps the exact closed
  width and right edge, and that right edge remains equal to
  `#chatMessagePane`. `#chatContentFrame` keeps zero Environment padding while
  the transcript content and Composer both stop at or before the panel's left
  edge.
- Original-resolution review of
  `.scratch/environment-content-clearance-scrollbar-right-anchored.png`
  confirmed the long message surface and Composer share the remaining middle
  lane, the Environment card remains a floating surface, and the scrollbar
  lane remains at the far-right conversation edge as in the supplied second
  screenshot.
- Focused Prettier verification passed for the modified CSS, source test,
  browser test, current architecture, and this record.
- Second review confirmed that no Environment selector still changes
  `#chatContentFrame`, `#chatMessagePane`, `#conversationBody`, or
  `#chatScroll` width; the sole wide projection targets the inherited content
  clearance on `#conversationBody`.
