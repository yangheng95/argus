# Conversation pointer visibility repair

## Recall

- User request: while a Task is running, keep the mouse pointer visibly recognizable inside the conversation area.
- Acceptance indicators:
  - the Conversation canvas uses a stable default arrow over whitespace and running activity;
  - text remains selectable;
  - interactive descendants retain their primitive-owned pointer, resize, copy, and zoom cursors;
  - the real desktop Conversation is inspected in the running state and a goal-bound screenshot is reviewed manually.
- Hard constraints:
  - no new, modified, or executed User Interface (UI) automation tests;
  - visual acceptance uses real-page interaction and manually reviewed screenshots;
  - no Task-state cursor branch or fallback path;
  - do not restart or close the operator's running OpenCorvus client;
  - preserve the current branch and push the git-cc `myhexin` remote with a `dsw-33987` commit subject.
- Read records and architecture evidence:
  - `AGENTS.md` and `CLAUDE.md`;
  - `specs/current/architecture/12-overlay-card-system.md`;
  - `packages/overlay/src/styles/cascade/base.css`;
  - `packages/overlay/src/styles/surfaces/conversation.css`;
  - `packages/overlay/src/components/App.tsx` and `packages/overlay/src/components/Conversation.tsx`;
  - `packages/overlay/src/components/ui/Dialog.tsx` and `packages/overlay/src/styles/surfaces/dialog.css`.
- Whole-repository grep evidence:
  - no Overlay source sets `cursor: none`, a transparent cursor, `set_cursor_icon`, or `set_ignore_cursor_events`;
  - `.chat-scroll` is the only Conversation-wide cursor declaration and forces `cursor: text` over the complete scroll canvas;
  - the only sibling `cursor: text` declaration belongs to a settings text surface and is unrelated;
  - buttons, links, image previews, resizers, draggable headers, and other interaction surfaces already own their specific cursors through existing primitives or local selectors;
  - `user-select: text` and `-webkit-user-select: text` independently own Conversation text selection, so the canvas-wide I-beam is not required for selection.
- Call-site disposition:

| Source                                           | Current role                      | Disposition                                              |
| ------------------------------------------------ | --------------------------------- | -------------------------------------------------------- |
| `conversation.css` `.chat-scroll`                | whole Conversation scroll canvas  | replace `cursor: text` with the default arrow            |
| `settings.css` text surface                      | editable/selectable settings copy | retain; unrelated owner                                  |
| local button/link/image/resizer/dialog selectors | explicit interaction affordances  | retain; descendants override the inherited canvas cursor |

- Independent review:
  - Claude Code `2.1.147` was invoked read-only with `Read,Grep,Glob`, but the installed client returned `authentication_failed` / `Not logged in`; it produced no review evidence and made no files changes.
  - a separate read-only child Session completed the same bounded repository review without modifying the worktree; the parent independently rechecked the cited source and call-site inventory before implementation.

## Causal chain

1. The complete Conversation scroll owner declares `cursor: text`, not only actual text runs.
2. Running activity leaves substantial dark or animated canvas under the pointer, where the narrow Windows I-beam can visually blend into the rendered surface and appear absent.
3. Task lifecycle is only when the issue is most noticeable; it does not own cursor semantics. Adding a running-state override would create an unnecessary second behavior path.
4. Restoring the canvas to the default arrow fixes the semantic owner. Existing descendants continue to provide specialized cursors, while text selection remains enabled by the independent selection declarations.

## Implementation plan

1. Change only the Conversation scroll owner's cursor from the canvas-wide text I-beam to the default arrow.
2. Run Overlay typecheck, locale/static checks, Vite production build, spec-link health checks, and `git diff --check`; do not run UI automation tests.
3. Start an isolated Vite page backed by the existing application data path, inspect the running Conversation at desktop size, capture a screenshot with the visible pointer context, and perform a second manual visual review.
4. Record verification evidence here, independently review the final diff, commit, fetch/merge the current git-cc branch when necessary, and push `myhexin/work-v0.0.30beta-yr-0804`.

## Verification record

- Pending implementation and real-page visual review.
