# Mailbox Global Project Grouping and Action Geometry

Status: implemented and verified

## Recall

| Item | Detail |
| --- | --- |
| User request | Refine the desktop Mailbox from the supplied screenshot: hidden archive/delete controls must not reserve row width; messages must identify and group by project directory; replace the unsuitable launcher icon and align it with Refresh; replace the checkmark used for mark-all-read with the former Inbox-style icon; and provide a directly draggable Mailbox scrollbar. |
| Acceptance criteria | The backend returns one registered-project Mailbox page whose items carry canonical project directories. The Overlay renders one directory group per owning worktree in page order. A resting row has a three-column grid with its heading reaching the trailing edge; its action rail is absolutely positioned, invisible, and pointer-inert until hover/focus. The Mailbox body has a non-zero vertical scroll range, `overflow-y: scroll`, stable gutter, and visible scrollbar thumb. The launcher uses Lucide Mailbox, mark-all-read uses Lucide Inbox, and the launcher/Refresh centers share the canonical right inset within one rendered pixel. Focused tests, typecheck, Node-launched headed browser interaction, screenshots, original-resolution review, second diff review, commit, and legacy remote push must pass. |
| Hard constraints | Desktop-only scope. Reuse the existing Button, Icon, Checkbox, SegmentedControl, SearchField, Kobalte Accordion, global protocol-event projection, Project registry, and Node browser harness. Do not add local project inference, a second Mailbox source, hidden/synthetic messages, responsive scope, an iframe, a gate, a worktree, or a restart/refresh of the user's running OpenCorvus/Overlay. Preserve unrelated dirty files. Commit subjects use `dsw-33987` and delivery goes to `legacy-remote`. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-e68607d2-40a5-4195-8443-f0cd4377c2c8.png` shows the right-side archive/delete area consuming row width, repeated same-project messages without project identity, unsuitable/misaligned header icons, a checkmark mark-all-read action, and a long list without a draggable scrollbar. |
| Sources read | Root `AGENTS.md`; Browser control skill; `specs/README.md`; July record index; `2026-07-20-left-sidebar-mailbox-mark-all-read.md`; `2026-07-20-desktop-left-rail-and-mailbox-refinement.md`; current panel and panel-reactivity architecture; Mailbox engine/routes/tool, route and tool tests, Overlay component/service/icon registry/CSS, contextbar launcher, design tokens, focused tests, and Node browser fixtures. |
| Whole-repository search evidence | `listProjectMailbox`, acknowledgement functions, `/mailbox` routes, `send_mailbox_message`, `MailboxPanel`, mailbox transport services, `mailbox` semantic icon mapping, contextbar toggle, `mailbox.css`, and every focused/browser Mailbox test were enumerated. The old engine source query filtered `EngineTaskTable.project_id`; `MailboxPanel` was the sole row renderer; `mailbox.css` alone owned the four-column row and trailing action column; `Icon.lucide.ts` alone mapped the Mailbox semantic icon; the contextbar token already defined the canonical trailing inset. No second project-group renderer or scrollbar owner existed. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration boundary forbids unrequested delegation. |

## Causal Chain

1. **Reserved row width:** the action rail occupied a fourth grid column even when opacity hid its buttons. Opacity changes paint only; they do not remove layout participation, so every summary was permanently shortened.
2. **Missing project structure:** the server filtered source and acknowledgement rows by the selected `project_id`. Because cross-project events never reached the client, the Overlay had no canonical dataset it could group without inventing another fetch/source.
3. **Icon semantics and axis drift:** the contextbar launcher used Inbox while mark-all-read used Check. Refresh lived in the Mailbox header and the launcher lived in the contextbar; without deriving both centers from the existing project-action inset their trailing axes drifted.
4. **Undraggable long list:** the body used automatic overflow without the product scrollbar opt-in or stable gutter. Wheel scrolling worked, but the platform thumb was absent or transient and could not serve the requested direct drag affordance.

## Call-Site Disposition

| Surface | Decision |
| --- | --- |
| `engine/mailbox.ts` | Replace selected-project queries with one join from protocol events through Tasks to registered Projects. Use `ProjectTable.worktree` as the canonical `taskDirectory`. Fold acknowledgement state once globally; do not add a per-project fallback or client fan-out. |
| Mailbox routes and generated API artifacts | Keep the existing paths and directory transport middleware, but document and test their global registered-project result/action semantics. The event stream invalidates for any Mailbox source/acknowledgement event. |
| `send-mailbox-message.ts` | Continue appending canonical protocol events; update only calls to renamed global acknowledgement/query functions. |
| `MailboxPanel.tsx` | Group the already ordered visible page with a `Map<taskDirectory, group>`, render a directory header and one Kobalte Accordion root per group, and preserve message-ID-owned expansion/selection/action state. Search includes canonical directory, name, and parent path. |
| `Icon.lucide.ts` | Map the left launcher semantic `mailbox` name to Lucide Mailbox and add the former Lucide Inbox glyph as the mark-all-read semantic. |
| `mailbox.css` | Remove the fourth grid column. Absolutely position the action rail with an opaque local surface and pointer-inert hidden state; reveal on row hover/focus. Make the body the sole stable vertical scrollbar owner and align the header action center with the shared contextbar inset token. |
| Tests | Cover cross-project list/count/read/archive/delete and stream invalidation in backend route tests; cover grouping/icon/CSS structure in focused Overlay tests; use 10 real rendered items across two directories in the Node-launched headed browser, assert geometry/interaction/scroll range, and capture resting, hovered, and bottom-scrolled screenshots. |

## Verification Results

- `bun test packages/overlay/test/mailbox-panel.test.ts packages/overlay/test/mailbox-contextbar-launcher.test.ts`: 14 passed.
- `bun test packages/opencorvus/test/server/mailbox-routes.test.ts`: 6 passed, including cross-project list/actions and stream invalidation.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/opencorvus typecheck`: passed.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/mailbox-left-sidebar-browser.test.ts`: passed in headed mode through Node.js. It proved two directory groups, a three-column resting row, absolute/pointer-inert hidden actions, hover reveal, a positive draggable scrollbar range, stable gutter, Lucide Mailbox/Inbox semantics, one-pixel trailing-axis tolerance, read-all, single delete, batch delete, and keyboard return.
- Vite production build passed with 2,648 transformed modules. The first browser attempt exposed zero-byte JavaScript/CSS assets left by a concurrent build; rebuilding produced non-empty assets before the passing run. This was a test-artifact failure, not a Mailbox code failure.
- Original-resolution screenshots reviewed:
  - `.scratch/left-sidebar-mailbox-focused-open.png` — project headers and full-width resting summaries;
  - `.scratch/left-sidebar-mailbox-project-group-hover.png` — non-layout hover action layer;
  - `.scratch/left-sidebar-mailbox-project-group-scrolled.png` — visible scrollbar thumb at the bottom range.

## Progress

- [x] User evidence, historical decisions, full call sites, and current git state inspected.
- [x] Recall, causal chain, and single-source implementation recorded.
- [x] Backend global projection and cross-project actions implemented with tests.
- [x] Project grouping, icons, action geometry, alignment, and scrollbar implemented with tests.
- [x] Focused/typecheck/browser verification passed.
- [x] Original-resolution screenshot review and second code review passed.
- [ ] Documentation health, final commit, legacy remote push, and remote equality verification.
