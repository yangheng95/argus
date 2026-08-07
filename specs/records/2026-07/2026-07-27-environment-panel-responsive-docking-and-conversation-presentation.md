# Environment Panel Responsive Docking And Conversation Presentation

Date: 2026-07-27
Status: Implemented
Owner: Codex

## Glossary

- UI: User Interface, the visible application surface.
- CSS: Cascading Style Sheets, the browser layout and presentation language.
- DOM: Document Object Model, the browser's rendered element tree.
- VCS: Version Control System, the canonical repository status source.

## Recall

### User requirement

The supplied desktop screenshot shows Environment Information covering the
conversation and leaving an excessive gap to the Workbench's right edge. The
requested behavior is:

1. when the conversation Workbench is wide enough, Environment and the
   conversation share the available inline width instead of Environment
   covering messages;
2. when that Workbench is narrow, the same Environment surface remains a
   floating overlay;
3. empty Chat and Mission conversations do not automatically present
   Environment, while Chat and Mission conversations with visible content do;
4. the floating surface sits closer to the right edge, following the Codex
   toolbar geometry shown by the user.

### Acceptance criteria

- One controlled Kobalte Popover remains the only Environment surface and open
  signal.
- At the existing 900-pixel `chat-workbench` desktop boundary, an open Popover
  reserves an inline-end lane and message content does not intersect its
  bounds.
- Below that boundary, the conversation frame keeps its full width and the
  Popover overlaps the message layer through the existing overlay z-index.
- The Environment trigger is the trailing chat-header action, so
  `bottom-end` placement aligns the card near the Workbench's right inset
  without a transform or positioning override.
- Task entry keeps its established one-time presentation. Chat and Mission
  entry presents once only after the canonical visible conversation projection
  contains an item; an empty Session is not marked as already presented, so a
  later hydrate with content may still present it.
- Focused source tests, Overlay typecheck/build, Node-launched real-browser
  geometry, task-scoped screenshots at narrow and wide desktop widths,
  original-resolution visual review, document health, and a second diff review.

### Hard constraints

- Reuse the current `Popover`, `Button`, Portal, `cardTreeStore`,
  conversation-Agent projection, named `chat-workbench` container, structural
  tokens, and existing browser fixture.
- Do not add a second Environment card, second open store, viewport media
  query, temporary iframe, DOM positioning override, hidden message, fallback,
  compatibility path, or process intervention.
- Keep this delivery desktop-only. The narrow state is a narrow desktop
  Workbench behavior, not a tablet/mobile deliverable.
- Do not restart, refresh, close, or reuse the operator's running
  OpenCorvus/Overlay process. Browser verification uses an isolated
  Node-launched fixture.
- Preserve the unrelated Composer pointer-focus, Work Ledger, Task-directory
  row, and design-language working-tree edits already present.
- Commit subjects use `dsw-33987`; delivery goes to `myhexin`.

### Material read before implementation

- Root `AGENTS.md` and the Browser control skill.
- The supplied screenshot at original resolution.
- `specs/current/architecture/07-panel.md`.
- The July 21 Environment task-start/clearance record.
- The July 22 Environment anchor/hover record.
- The July 23 responsive coexistence record.
- The July 24 Right Dock width-boundary record.
- The July 25 all-width floating record.
- `App.tsx`, `TaskDirBar.tsx`, `Conversation.tsx`, `main.tsx`, the canonical
  conversation service and stores, the Popover primitive, layout tokens,
  conversation/workspace styles, and focused source/browser tests.

### Whole-repository search evidence

Searches enumerated every `ProjectRuntimeStatusPanel`,
`ProjectRuntimeToolbarActions`, `project-runtime-status-panel`,
`sourceIdentity`, `presentOnSourceChange`, `cardTreeStore.order`,
`conversationAgentRecordsForSource`, `chat-header-actions`,
`solidChatHeaderRightDockToggle`, named `chat-workbench` container rule,
Environment width/clearance token, and focused browser geometry consumer.

| Call point / owner | Current fact | Disposition |
| --- | --- | --- |
| `TaskDirBar.ProjectRuntimeStatusPanel` | Owns the single controlled Popover and one-time source presentation. The tracked source is currently marked from Task/Mission identity alone. An uncommitted partial attempt duplicates the rendered panel into a manually measured Portal dock. | Keep the single Popover/open signal and source memory. Replace the duplicate dock attempt with the existing Popover plus container-owned layout. Gate Session auto-presentation on the canonical visible-conversation predicate. |
| `Conversation.tsx#hasItems` | Defines visible conversation content as top-level card-tree items or canonical Subagent activity records. | Move this exact predicate behind one shared conversation-service reader and consume it from both Conversation and Environment presentation. |
| `App.tsx` | Mounts editor launchers, Environment, then the Right Dock toggle. Environment therefore anchors one control-width away from the Workbench's right inset. | Keep the same controls but place the Right Dock toggle before Environment so `bottom-end` positioning naturally uses the trailing edge. Keep Task auto-presentation and make both Chat/Mission Session kinds content-aware. |
| `conversation.css` | The Popover already owns width, viewport bounds, and overlay z-index. The all-width floating contract deliberately removed the former wide container clearance. | Restore a wide-only inline-end clearance at the existing 900-pixel named-container boundary. Narrow containers keep zero clearance. |
| `design-language.css` | Owns the 300-pixel Environment width. The former clearance included all trailing header chrome, which produced a large gap. | Add one clearance derived only from panel width plus the canonical header inline inset after Environment becomes the trailing action. |
| `workspace.css` / `App.tsx` uncommitted dock host | A partial manual dock uses a `ResizeObserver`, component-local numeric fallbacks, duplicated panel markup/IDs, and a second Portal mount. | Remove this partial path; layout remains CSS-container-derived around the one mature Popover. |
| Focused source tests | Still encode either all-width floating or the partial duplicate dock. | Assert one Popover, shared conversation visibility, Task plus content-bearing Session presentation, wide clearance, narrow overlay, and trailing action order. |
| `task-dirbar-keyboard.test.ts` | Already exercises narrow/wide Right Dock coexistence and screenshots, but its dirty expectation targets the duplicate dock. The New Chat case proves empty Chat non-presentation. | Retarget wide geometry to frame clearance/non-overlap, retain narrow overlay, add the reduced right inset assertion, and extend Session coverage to content-bearing Chat/Mission presentation. |
| Current architecture | Still states that every entered Chat/Mission presents and that Environment reserves no lane at any desktop width. | Replace those clauses with content-aware Session presentation and wide/narrow container behavior. |

No backend route, database schema, API contract, localization key, Right Dock
width store, or Environment resource loader requires modification.

### Independent agent feedback

No independent agents were requested, so none were started. The primary agent
performed the required repository-wide call-point audit.

### Working-tree and remote evidence

The branch started at `348db78255` and matched the locally known
`myhexin/work-v0.0.19beta-yr-0727` ref. The worktree already contained unrelated
uncommitted edits plus an incomplete Environment dock attempt, so a clean
pre-change commit was not possible without taking ownership of user/concurrent
work. `git fetch myhexin` was attempted before implementation and failed because
`git-cc.myhexin.com` could not be resolved; local implementation and validation
continue without rewriting or hiding that external blocker.

## Root cause

The visible overlap and oversized right gap come from two coupled layout facts,
not from the Environment card's content. Environment is already a correctly
portaled `bottom-end` Popover, but the current architecture reserves no message
lane at any width. Its anchor is also followed by the Right Dock toggle, so the
card's right edge aligns to the Environment button rather than the Workbench's
trailing action edge.

The auto-presentation defect has a separate direct trigger: source identity and
source kind are the only inputs to the one-time effect. The canonical visible
conversation projection is never read, so an empty Mission may open while a
content-bearing Chat is excluded. The root correction is to reuse the same
visible-item predicate that the Conversation renderer already uses, without
creating a second message store or inferring content from names.

## Implementation plan

1. Replace the partial duplicate dock with the existing single Popover and the
   previously proven named-container clearance model.
2. Make Environment the trailing chat-header action and derive wide clearance
   from its width plus the canonical header inset, reducing the right gap.
3. Extract the renderer's visible-conversation predicate into the canonical
   conversation service. Preserve Task presentation and make Chat/Mission
   Session presentation content-aware.
4. Update focused source/browser tests, run the isolated Node browser fixture,
   inspect narrow and wide screenshots at original resolution, and correct
   visual defects.
5. Update verification evidence and architecture, run typecheck/build/i18n and
   documentation health, perform a second diff review, commit only task-owned
   hunks with `dsw-33987`, reconcile the delivery branch, and push to
   `myhexin`.

## Verification ledger

- `bunx biome check` passed for every task-owned TypeScript and TSX source/test
  file.
- `bun run --cwd packages/overlay typecheck` passed.
- `bun run --cwd packages/overlay check:i18n` passed with catalog digest
  `0762a4bc7c9590d2`.
- `bun test packages/overlay/test/task-cwd-row-layout.test.ts
  packages/overlay/test/environment-local-branch-controls.test.ts` passed all
  14 focused source-contract tests.
- Node-launched headed Playwright passed the focused narrow/wide Environment
  and empty-New-Chat cases in `task-dirbar-keyboard.test.ts`. The inspected
  1280-by-760 screenshot keeps the full conversation width and floats the panel
  above it; the inspected 1800-by-900 screenshot reserves the conversation lane
  and keeps the message edge before the panel edge. Both panel states use the
  Workbench's approximately 16-pixel right inset.
- Node-launched headed Playwright passed
  `chat-mission-inline-handoff-browser.test.ts`. Its current strict fixture now
  supplies `pendingQuestions`, Mission skill catalog, and file-information
  responses. The test proves automatic presentation for a populated Chat and
  the populated Mission that takes over the same conversation surface.
- The Mission screenshot was inspected at original resolution and confirms the
  card does not cover the conversation at the wide desktop geometry.
- The combined `historical-docs-links.test.ts` and
  `document-health.test.ts` command passed all 85 checks after staging the new
  record. Its earlier run correctly rejected the same record while it was
  untracked.
- `git diff --check` passed. The second review confirmed one Kobalte Popover,
  no `ResizeObserver`, no duplicated Portal/dock mount, one shared visible-item
  predicate, a wide-only container clearance, the narrow overlay path, and the
  trailing header anchor.
