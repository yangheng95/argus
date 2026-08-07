# Left-sidebar Mailbox and project-wide mark-all-read

## Recall

- User request: move the Mailbox component out of the right side and into the
  left side; add a one-click read-all action.
- Acceptance criteria:
  - the durable Mailbox has exactly one mounted UI surface, inside the existing
    left sidebar;
  - the workspace Mailbox launcher switches the left sidebar between Projects
    and Mailbox, reveals a collapsed sidebar, exposes pressed state, and clears
    launcher attention only when the Mailbox is actually visible;
  - Mailbox is absent from `RightDockPanel`, the Right Dock add/empty catalogs,
    center-workbench tabs, and Environment Information shortcuts;
  - one action marks every active unread item in the current backend project
    namespace as read, including rows outside the loaded page and current
    search, while leaving archived unread rows unchanged;
  - the bulk action appends the same canonical `mailbox.acknowledged` events as
    single-item read and returns an idempotent changed count;
  - English and Chinese labels, OpenAPI/SDK output, current architecture docs,
    focused unit/integration tests, and a real desktop screenshot agree with the
    new behavior.
- Hard constraints:
  - keep `/mailbox` plus `mailbox.acknowledged` as the sole durable source;
  - do not add a notification center, local read cache, compatibility route,
    fallback, gate, responsive/mobile scope, or second Mailbox mount;
  - keep Kobalte Accordion, canonical Button/SearchField/SegmentedControl/Icon
    primitives, Node-launched Playwright, and task-scoped visual evidence;
  - do not restart, reload, close, or otherwise disturb a running OpenCorvus or
    overlay process; use an isolated test page;
  - preserve the pre-existing dirty worktree files and stage only this task's
    changes.
- Read before implementation:
  - `specs/current/architecture/07-panel.md`;
  - `specs/current/architecture/07-panel-reactivity.md`;
  - `specs/records/2026-07/2026-07-16-squad-mailbox-and-right-dock.md`;
  - `specs/records/2026-07/2026-07-17-cross-platform-mailbox-notification-repair.md`;
  - `specs/records/2026-07/2026-07-18-mailbox-contextbar-attention-launcher.md`;
  - `specs/records/2026-07/2026-07-18-mailbox-inline-expansion.md`.
- Whole-repository grep:
  - `MailboxPanel` is mounted only in `packages/overlay/src/main.tsx`; the
    structural contract is asserted by `mailbox-panel.test.ts`;
  - Right Dock identity is owned by `components/RightDock.tsx`, projected by
    `main.tsx`, consumed by `TaskDirBar.tsx`, and guarded by
    `acceptance-panel-mount.test.ts`, `right-dock-panel-ownership.test.ts`,
    `task-cwd-row-layout.test.ts`, and the titlebar browser scenario;
  - the left launcher is owned by `components/App.tsx` and
    `mailbox-contextbar-launcher.test.ts`, with attention styling in
    `styles/surfaces/titlebar.css`;
  - frontend transport is solely `services/mailbox.ts`; backend projection and
    acknowledgement are solely `engine/mailbox.ts` and
    `server/routes/mailbox.ts`; server behavior is covered by
    `server/mailbox-routes.test.ts`;
  - route registration is `server/routes/app.ts`; generated API surfaces are
    `packages/sdk/openapi.json`, `packages/sdk/js/src/gen/**`, and the English
    and Chinese API reference docs;
  - the agent-tool description in `tool/send-mailbox-message.ts` still names the
    Right Dock and must be corrected to the left sidebar;
  - the existing broad titlebar scenario contains Mailbox coverage alongside
    unrelated Mission and toolbar contracts; task-scoped ownership and visual
    acceptance belong in `browser/mailbox-left-sidebar-browser.test.ts`, while
    mailbox-only directory concurrency remains in
    `browser/mailbox-concurrency-browser.test.ts`.
- Independent Agent feedback: none. The user did not request sub-agents or an
  independent parallel audit, so this task does not delegate.

## Causal finding

The Mailbox data model is not right-side-specific. The coupling is entirely in
the presentation projection: `RightDockPanel` includes `mailbox`,
`CenterWorkbenchPanel` mounts it as a forced Right Dock tab, and
`TaskDirBar` re-exports that identity as an Environment Information shortcut.
The left context-bar button therefore opens a right-side owner even though it
is physically placed in the left rail. Moving only the button or using CSS
would leave the right-side ownership and a second launcher intact.

The existing single-item read endpoint cannot implement one-click read-all in
the frontend: the Overlay loads at most 40 rows and search is local. Iterating
visible rows would silently leave later pages unread. The project namespace and
full folded acknowledgement state already live in `engine/mailbox.ts`, so the
backend must enumerate every active unread source row and append canonical read
acknowledgements in one transaction.

## Call-site disposition

| Call site                                               | Disposition                                                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `components/RightDock.tsx` Mailbox union/catalog/meta   | Delete Mailbox identity; retain every real right-side tool.                                                                     |
| `main.tsx` center panel union/order/view/TabPanel       | Delete the right-side Mailbox projection and mount one always-alive Mailbox inside the left sidebar.                            |
| `components/App.tsx` left launcher and sidebar body     | Switch the left sidebar view, expose pressed/attention semantics, and keep Projects plus Mailbox mounted as sibling activities. |
| `components/TaskDirBar.tsx` `mailboxItemCount` shortcut | Delete the count prop and Mailbox Environment Information shortcut.                                                             |
| `components/MailboxPanel.tsx` header/actions            | Add canonical mark-all-read control and preserve background hydration/notification ownership.                                   |
| `services/mailbox.ts`                                   | Add one strict project-scoped bulk-read request.                                                                                |
| `engine/mailbox.ts`                                     | Add one atomic, idempotent all-active-unread acknowledgement operation.                                                         |
| `server/routes/mailbox.ts`                              | Add the documented bulk route before the dynamic message route.                                                                 |
| `tool/send-mailbox-message.ts`                          | Replace stale Right Dock wording with left-sidebar wording.                                                                     |
| i18n JSON                                               | Add `mailbox.mark_all_read` in English and Chinese.                                                                             |
| current architecture docs                               | Replace Right Dock ownership with left-sidebar ownership and document bulk-read semantics.                                      |
| static/unit/server tests                                | First make the new contract fail, then update it to the sole new behavior.                                                      |
| browser fixture/scenario                                | Exercise left-side reveal, mark-all-read, keyboard focus, and screenshot the left Mailbox.                                      |
| generated SDK/API docs                                  | Regenerate from the route source; do not hand-edit generated contracts.                                                         |

## Implementation and verification

1. Add failing structural and server tests for sole left mounting, absence from
   Right Dock/Environment Information, toggle semantics, and read-all across
   pagination with archived rows excluded.
2. Add the backend transaction and strict route/result schema; add the Overlay
   transport action and canonical Mailbox button.
3. Recompose the left sidebar with always-mounted Projects and Mailbox bodies;
   remove every right-side identity and stale description.
4. Run focused Overlay and backend tests, typecheck, API route check, SDK/API
   generation checks, i18n check, historical links, document health, and the
   relevant architecture tests.
5. Launch the isolated focused Overlay browser harness with Node, capture the
   left Mailbox in its normal desktop geometry and after one-click read-all,
   inspect the PNGs, correct visible defects, and rerun the browser scenario.
6. Review the complete task diff against this Recall, commit only task files,
   push `myhexin`, then verify local/remote commit equality and preserved
   unrelated worktree changes.

## Verification evidence

- Focused Overlay structure and interaction tests: 44 passed.
- Mailbox route/tool tests, including cross-page bulk read and archived unread
  preservation: 10 passed.
- Documentation health, historical links, product docs, and route/OpenAPI
  checks: 99 passed.
- `api:routes-check`, `docs:check`, and Overlay i18n checks passed against the
  generated 274-operation contract.
- Node-launched headed browser scenario passed with right-side Mailbox absence,
  left launcher mouse and keyboard behavior, and one bulk request. Reviewed
  screenshots:
  - `.scratch/left-sidebar-mailbox-focused-open.png`;
  - `.scratch/left-sidebar-mailbox-focused-read-all.png`.
