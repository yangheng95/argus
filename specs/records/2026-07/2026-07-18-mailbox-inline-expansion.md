# Mailbox Inline Expansion

## Recall

### User requirement

- Mailbox messages must support expanding their content inline.

### Acceptance criteria

1. Each Mailbox row is collapsed by default and exposes a real disclosure
   trigger with keyboard and `aria-expanded` semantics.
2. Expanding a row reveals the complete message body inside the list without
   navigating away from the Mailbox or opening a second detail surface.
3. Task navigation remains available as an explicit action inside the expanded
   message; archive/restore remains an independent row action.
4. Refreshing the server-owned Mailbox projection does not create a second
   message-detail source or alter the read/archive protocol.
5. Focused tests, Overlay typecheck/build, Node-started Playwright interaction,
   and inspected desktop light/dark screenshots pass.

### Hard constraints

- Reuse the installed Kobalte `Accordion` primitive (which owns its
  Collapsible behavior) and the canonical
  OpenCorvus Button/Icon components; do not hand-roll disclosure keyboard or
  accessibility behavior.
- Keep `/mailbox` and `protocol_event` as the only message/read/archive sources.
- Keep this a desktop-only Right Dock change. Do not add responsive variants,
  a master-detail pane, a second store, or a compatibility path.
- Do not restart or alter the user's running OpenCorvus/Overlay. Visual
  acceptance uses an isolated browser fixture.
- Work in the current main worktree, preserve unrelated changes, use the
  `dsw-33987` commit prefix, and push the completed commit to `myhexin`.

### Sources read before implementation

- `specs/current/architecture/07-panel.md`
- `specs/current/architecture/07-panel-reactivity.md`
- `specs/records/2026-07/2026-07-16-squad-mailbox-and-right-dock.md`
- `packages/overlay/src/components/MailboxPanel.tsx`
- `packages/overlay/src/styles/surfaces/mailbox.css`
- `packages/overlay/src/components/ui/Button.tsx`
- Installed Kobalte 0.13.11 Accordion and Collapsible sources.
- Mailbox unit and browser fixtures under `packages/overlay/test/**`.

### Whole-repository search evidence

Commands:

- `rg -n "mailbox|Mailbox" packages/overlay packages/opencorvus specs/current`
- `rg -n "MailboxPanel|mailbox-item__main|mailbox-item__body|mailbox-open" packages/overlay packages/opencorvus`
- `rg -n "disclosure|expanded|aria-expanded|Collapsible" packages/overlay/src packages/overlay/test`
- `rg -n "mailbox" packages/overlay/test/browser`

Call-site disposition:

| Owner / call site | Current responsibility | Decision |
| --- | --- | --- |
| `MailboxPanel.tsx` | Renders every row; the current main button immediately opens the canonical Task. | Replace the main button with a Kobalte disclosure trigger and place explicit Task navigation in its content. |
| `mailbox.css` | Clamps the body to two lines and owns compact 280/360-pixel Dock geometry. | Preserve the collapsed summary; add expanded row/content/action geometry with no media query. |
| `services/mailbox.ts` | Owns the server projection and append-only acknowledgement calls. | Preserve unchanged; inline expansion is presentation state only. |
| `mailbox-panel.test.ts` | Guards projection ownership and compact-list structure. | Add disclosure primitive, complete-body, and independent-action assertions. |
| `titlebar-toolbar-toggle-browser.test.ts` | Exercises and screenshots the real Right Dock Mailbox fixture. | Add mouse/keyboard expand-collapse checks and task-scoped expanded light/dark screenshots. |
| `RightDock.tsx` / `main.tsx` | Own the single Mailbox panel mount. | Preserve unchanged; no second detail panel. |
| `07-panel*.md` | Define Task navigation and Mailbox projection behavior. | Clarify that row disclosure is inline and Task navigation is explicit. |

### Independent-agent feedback

- No independent agents were requested by the user, so none were started.

## Root-cause chain

Observable state: a Mailbox body is permanently clamped to two lines, while
activating its only large click target navigates to the Task.

Direct trigger: `mailbox-item__main` is simultaneously the summary container
and Task-navigation button; there is no disclosure content or expanded state.

Deeper cause: the original compact-list implementation optimized for direct
Task navigation and deliberately omitted an in-list detail interaction. Long
agent reports therefore cannot be read from the Mailbox itself.

Root repair: make the summary a canonical Kobalte disclosure trigger, reveal
the complete body in the row's normal document flow, and move Task navigation
to an explicit action inside that disclosed content. The server projection and
acknowledgement protocol remain the single data source.

## Implementation plan

1. Integrate Kobalte `Accordion` into the Mailbox list and expose a full-body
   content region plus explicit Task action.
2. Extend the compact desktop CSS and bilingual interaction labels.
3. Add focused structural and real browser interaction coverage.
4. Build the Overlay, run focused checks, render isolated light/dark desktop
   screenshots, inspect them, and iterate.
5. Update architecture evidence, run a second review, commit, and push.

## Progress

- [x] Existing behavior, relevant history, primitive source, call sites, and
  browser fixture were inspected.
- [x] Kobalte Accordion disclosure, complete inline body, explicit Task action,
  bilingual labels, compact desktop styling, and regressions implemented.
- [x] Unit test, typecheck, i18n check, Vite build, and Node-started Playwright
  mouse/Enter/Space interaction passed.
- [x] Isolated 360-pixel light and 280-pixel dark expanded screenshots inspected;
  complete body wrapping, action placement, row separation, and Dock containment
  passed visual review.
- [x] Second code/data/visual review found no competing source, scope leak,
  overflow, keyboard failure, or unrelated change; commit and git-cc delivery
  follow this record update.

## Verification evidence

- `bun test packages/overlay/test/mailbox-panel.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts` — passed, 32 tests.
- `bun run --cwd packages/overlay typecheck` — passed.
- `bun run --cwd packages/overlay check:i18n` — passed.
- `bun run --cwd packages/overlay build` — passed.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/titlebar-toolbar-toggle-browser.test.ts` — passed, including mouse, Enter, Space, archive/restore, and console/page-error collection.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/mailbox-concurrency-browser.test.ts` — passed; delayed old-directory pages and replacement-scope failure behavior remain isolated.
- `bun test packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts` — passed, 83 tests after the record was tracked.
- `.scratch/right-dock-mailbox-inline-expanded-light.png` — inspected at the normal 360-pixel Dock width.
- `.scratch/right-dock-mailbox-inline-expanded-narrow-dark.png` — inspected at the narrow 280-pixel Dock width.
