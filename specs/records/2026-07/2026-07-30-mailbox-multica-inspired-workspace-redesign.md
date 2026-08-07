# Multica-Inspired Mailbox Workspace Redesign

Date: 2026-07-30
Status: Proposed; design only
Owner: Codex

## Glossary

- UI: User Interface, the visible application surface.
- API: Application Programming Interface, the server contract used by the Overlay.
- SSE: Server-Sent Events, the one-way server change-notification stream.
- A2A: Agent-to-Agent, communication between OpenCorvus agents.
- DOM: Document Object Model, the rendered browser element tree.

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User requirement | Redesign the Mailbox page and provide a design proposal before changing code. The follow-up explicitly allows Multica as a reference. |
| Acceptance criteria | Produce an implementation-ready desktop design grounded in the current OpenCorvus page, repository ownership, historical Mailbox decisions, and Multica's official Inbox implementation. The proposal must define information architecture, layout, states, interactions, source ownership, call-site disposition, implementation phases, and later visual acceptance without changing product code in this task. |
| Hard constraints | This turn changes only this record and its two spec indexes. Preserve the canonical Mailbox event projection and one rendered Mailbox owner; do not create a parallel inbox, fallback, compatibility path, workflow gate, mobile scope, route-like right-dock tab, temporary iframe, or UI automated test. A future UI implementation must use the real desktop page, Node-launched Browser/Playwright interaction, screenshots, and personal visual review. |
| Sources read | Root `AGENTS.md`; Browser control skill; current `MailboxPanel.tsx`, `App.tsx`, `main.tsx`, `mailbox.css`, `services/mailbox.ts`, `desktop-notifications.ts`, `mailbox-request-owner.ts`, both locale catalogs, `engine/mailbox.ts`, `server/routes/mailbox.ts`, current panel architecture, and all July Mailbox records found by repository search. |
| Current visual evidence | The live OpenCorvus desktop page at `http://127.0.0.1:7878/ui/` was opened in the native in-app Browser. The existing original-resolution `.scratch/left-sidebar-mailbox-focused-open.png` was inspected. It shows a global, information-dense message reader compressed into the narrow navigation sidebar: project disclosures, tall cards, body excerpts, badges, metadata, and actions compete within one small column. |
| Multica evidence | Official repository `multica-ai/multica`, commit `da74518`, was inspected locally from a shallow reference clone. Relevant owners are `packages/views/inbox/components/inbox-page.tsx`, `inbox-list.tsx`, `inbox-list-item.tsx`, `inbox-display.ts`, plus `packages/core/inbox/queries.ts` and `packages/core/types/inbox.ts`. Multica uses a resizable desktop master-detail page, a virtualized compact list, hover-only row archive, and a full issue detail view. |
| Whole-repository grep | `MailboxPanel` is imported and mounted only by `packages/overlay/src/main.tsx`; `App.tsx` is the sole left-launcher and hover-preview layout owner; `mailbox.css` is the sole feature geometry owner; `services/mailbox.ts` is the sole Overlay transport; `engine/mailbox.ts` and `server/routes/mailbox.ts` are the canonical projection and route owners. `CenterWorkbenchPanel` entries other than `conversation` are right-dock tools, so Mailbox must not be added to that union. Mailbox-producing tools, protocol events, scheduler descriptions, native notifications, and server tests are consumers of the same canonical event model and are not alternate UI owners. |
| Historical decisions | `2026-07-22-mailbox-single-row-expanding-search.md` explicitly removed Archived from the left-sidebar Mailbox. Later records establish global cross-project grouping, a native desktop notification projection, inline read acknowledgement, evidence locators, deletion, hover lifecycle, and a single active Mailbox view. The redesign preserves those product semantics and does not silently restore Archived. |
| Independent review | Claude Code `2.1.147` was checked and invoked from the repository root in one-shot, read-only mode with only `Read,Grep,Glob`, streaming output, no session persistence, and no delegation or worktree. It stopped before reading files because the local CLI is not authenticated (`Not logged in`). No Claude finding is claimed. Codex performed the second evidence and design review recorded below. |
| Git baseline | Delivery branch is `work-v0.0.24beta-yr-0729`. The shared worktree already contains unrelated user changes in workspace/design-language CSS, current panel architecture, a workspace-corner record, and a visual artifact. This design delivery must not edit, stage, or commit those paths. |

## Decision

Mailbox becomes a first-class **primary center workspace**, opened from the
existing left-context Mailbox launcher. It is not a left-sidebar replacement,
not a right-dock tool, and not a modal.

The page uses a desktop master-detail composition inspired by Multica:

1. a compact, independently scrolling message list;
2. an adjustable divider using the repository's existing pane-resize
   infrastructure;
3. a flexible detail reader for the selected message.

The current Work Ledger remains permanently visible in the left sidebar.
Clicking or keyboard-activating the Mailbox launcher opens the center Mailbox
surface and clears the transient attention pulse. Activating it again, using
the explicit “Back to current work” action, or selecting a Work Ledger item
returns to the preserved conversation. Opening the message's Task uses the
existing task-selection lifecycle and also returns to Conversation.

The current full interactive Mailbox-on-hover preview is retired. The launcher
keeps its tooltip, unread badge, attention treatment, and native system
notifications, but hover no longer swaps the complete left sidebar. This
removes the cramped reading surface, prevents two Mailbox render contexts, and
makes pointer and keyboard activation equivalent.

## Root-Cause Chain

1. The visible symptom is a crowded, hard-to-scan Mailbox with repeated project
   headings and tall message cards.
2. The direct trigger is structural: `App.tsx` swaps the entire Work Ledger for
   `MailboxPanel` inside the narrow left sidebar when the launcher is hovered.
3. `MailboxPanel` then has to combine list navigation, reading, project context,
   progress, evidence, bulk operations, and task navigation inside that single
   column. Incremental spacing or card styling cannot create the missing
   reading area.
4. The hover lifecycle also makes the main information surface pointer-first;
   the keyboard-accessible launcher does not own an equivalent click route.
5. The center Workbench already distinguishes a primary Conversation surface
   from right-dock tool panels. Mailbox has global navigation and reading
   semantics, so its correct peer is the primary Conversation surface, not a
   right-dock panel.
6. A single center master-detail renderer directly fixes the ownership and
   geometry problem while preserving the canonical Mailbox projection.

## Reference Adoption and Rejection

| Multica pattern | OpenCorvus decision | Reason |
| --- | --- | --- |
| Resizable desktop master-detail page | Adopt | Separates scanning from reading and uses available center width without hiding the Work Ledger. |
| Compact virtualized list | Adopt through the existing `virtua` dependency | OpenCorvus already ships a Solid-compatible mature virtualization library; adding Multica's React-specific `react-virtuoso` would duplicate tooling. |
| Full selected-item detail view | Adopt, but render Mailbox-specific data | OpenCorvus messages have body, category, attention, progress, evidence, Project, Task, Goal, Agent, Squad, and session context rather than a Multica Issue page. |
| Selection automatically marks the row read | Adopt through the existing acknowledgement contract | It matches the current inline-expansion behavior and keeps durable read state in the backend. |
| Hover-only low-frequency row action | Adapt | Keep only a compact destructive overflow or selection affordance; primary row activation selects the message. “Open Task” belongs in the detail header. |
| One notification per Issue, newest event wins | Reject | Multiple OpenCorvus events for one Task can carry distinct progress, status, failure, or operator-attention meaning. Task-level deduplication would hide valid messages without a proven product contract. |
| Archived footer/subview | Reject | OpenCorvus explicitly removed Archived from this UI. Backend archived records remain outside this active Mailbox page. |
| Mobile/responsive branch | Reject for this task | The repository's parity scope is desktop-only unless separately requested. |
| Multica brand tokens and component styling | Reject | The redesign uses the existing OpenCorvus design language, Kobalte primitives, Lucide icon system, density, focus, and motion tokens. |

## Information Architecture

```text
┌─ Left navigation ─┬─ Primary center workspace ─────────────────────────────────┬─ Right Dock ─┐
│ Mailbox  [9]      │ Mailbox · 9 unread               Mark all read   ⋯   Close │ optional     │
│ Work Ledger       ├──────── message list ───────┬──────── detail reader ───────┤ task tools   │
│ remains visible   │ Search all messages…       │ Progress · Attention      2m │ unchanged    │
│                   │                             │ Build finished               │              │
│                   │ Project A                   │ Complete message body         │              │
│                   │ ● Build finished       2m  │                              │              │
│                   │   Task title · Squad        │ Project / Task / Goal / Agent │              │
│                   │   Evidence available        │ Progress and evidence         │              │
│                   │                             │                 Open Task  ⋯  │              │
│                   │ Project B                   │                              │              │
│                   │   Waiting for input    14m  │                              │              │
└───────────────────┴─────────────────────────────┴──────────────────────────────┴──────────────┘
```

### Primary Page Header

- Reuse the current center surface-header height, typography, Button, Badge,
  Tooltip, focus, and divider tokens.
- Leading content: Mailbox icon, “Mailbox”, unread count. The unread count is a
  quiet numeric badge, not a second page title.
- Trailing actions: “Mark all read” when unread messages exist, an overflow
  menu for selection mode/delete, and “Back to current work”.
- The header must not display active total and unread total as competing
  counters. Unread is the operator-action metric; active total belongs to the
  list result summary or accessible name.

### Message List Pane

- Initial width: one named layout token equivalent to 340 pixels; minimum 300
  and maximum 440. These values live in the canonical pane configuration, not
  repeated CSS literals.
- Reuse the existing keyboard-operable pane-resizer infrastructure and extract
  a shared split-pane owner if the current helper cannot address an inner
  divider cleanly. Do not hand-build a second drag lifecycle.
- Keep Search permanently visible at the top of the list rather than replacing
  the complete toolbar on expansion.
- Search is server-backed across the canonical active Mailbox, not limited to
  the first loaded page. The existing `GET /mailbox` gains one optional query
  parameter and remains the only list source.
- Retain cross-project organization, but replace large collapsible project
  blocks with lightweight sticky project separators. Projects are context, not
  another navigation hierarchy.
- Each row has a stable compact rhythm:
  - sender or Squad avatar;
  - unread dot or attention edge;
  - one-line subject;
  - one-line Task/Squad/category context;
  - relative time;
  - optional one-line progress/evidence summary.
- Do not repeat the complete body in the list. Do not expand rows inline.
- The selected row uses one semantic selected surface. Unread and selected are
  independent visual states.
- Bulk checkboxes appear only after entering explicit selection mode. Row
  selection must not simultaneously toggle a bulk checkbox.
- Long lists use `virtua`; pagination continues through the existing cursor and
  appends into the same list. No separate loaded-data source is introduced.

### Detail Reader

- Empty selection: a quiet centered prompt describing that selecting a message
  shows its details; do not show a decorative dashboard.
- Header: category and attention indicators, subject, relative/absolute time,
  “Open Task” primary action when a Task exists, and a destructive overflow.
- Body: render the canonical message body once, at readable line length, with
  the existing Markdown/link treatment only if the current message contract
  already permits it. Do not infer rich content from plain text.
- Context block: Project, Task, Goal, Agent, expert Squad, and session values
  that exist on the selected item. Omit absent fields instead of rendering
  placeholders.
- Progress: show the existing percentage only when present.
- Evidence: show every canonical evidence locator as an actionable row using
  the existing artifact/link navigation owner. Do not create a parallel
  evidence resolver.
- Delete removes only the Mailbox projection after the existing confirmation;
  the Task and protocol history remain unchanged.

## State and Interaction Contract

| State or action | Single owner and behavior |
| --- | --- |
| Primary surface | A new `PrimaryWorkspaceSurface = "conversation" | "mailbox"` signal in `main.tsx`. It does not replace `PrimaryCenterPanel`, whose `task | mission | chat` value describes the preserved Conversation source. |
| Open Mailbox | Left launcher click/keyboard sets the primary surface to `mailbox` and clears transient attention. It does not mutate `boardStore.selectedSource`, open the Right Dock, or create a Workbench tab. |
| Return to Conversation | Close action, launcher toggle, Work Ledger selection, New Chat/Mission, and successful “Open Task” set the primary surface to `conversation`. The prior board/conversation remains mounted and preserved. |
| Selected message | Ephemeral `MailboxPanel` state keyed by message ID. On refresh, preserve it only while that ID remains in the canonical result; otherwise select the next neighboring row or show the empty detail prompt. |
| Read state | Existing backend acknowledgement is the only durable owner. Selecting an unread row acknowledges it once and updates the optimistic projection through the current request owner. |
| Bulk selection | Ephemeral set of message IDs within explicit selection mode. Search or pagination must not reinterpret which IDs are selected. |
| Search | Query text is ephemeral UI state; `GET /mailbox?query=...` is the canonical result. Empty query uses the normal active listing. Request ownership/cancellation remains in `mailbox-request-owner.ts`. |
| Live changes | Existing SSE stream remains a pure invalidation signal; `MailboxPanel` refetches the canonical list. It does not merge an independent event-derived list. |
| Native notification | Existing `desktop-notifications.ts` projector remains independent from whether the center Mailbox page is open. No duplicate in-app toast feed is added. |
| Resized list width | Persist through the existing settings/pane configuration owner if persistence is required. Do not store it in Mailbox component-local durable state. |

## Complete Call-Site Disposition

| Owner or consumer | Current evidence | Future implementation disposition |
| --- | --- | --- |
| `packages/overlay/src/components/App.tsx` | Sole Mailbox launcher, hover timers, left-panel swap, and primary Conversation DOM shell. | Delete the hover-preview timers and left-panel Mailbox swap. Keep one launcher with badge/attention, add click/toggle semantics, and project one center Mailbox primary surface beside the preserved Conversation surface. |
| `packages/overlay/src/main.tsx` | Sole `MailboxPanel` mount, unread owner, task-selection lifecycle, `PrimaryCenterPanel`, and center/right-dock tab model. | Own `PrimaryWorkspaceSurface`, open/close actions, and the single Mailbox mount. Never add Mailbox to `CenterWorkbenchPanel`, because every non-conversation entry in that union becomes a right-dock tool. Reset to Conversation in existing task/chat/mission selection lifecycles. |
| `packages/overlay/src/components/MailboxPanel.tsx` | Sole list state, search, pagination, read, deletion, grouping, selection, inline expansion, and renderer. | Refactor the same component into page header, virtualized master list, and detail reader. Remove inline expansion and project disclosure state; retain request, acknowledgement, delete, cursor, notification, and unread ownership. |
| `packages/overlay/src/components/mailbox-request-owner.ts` | Canonical refresh ownership and stale-response protection. | Preserve and extend its request identity with the search query if required; do not add a second request coordinator. |
| `packages/overlay/src/styles/surfaces/mailbox.css` | Sole Mailbox geometry owner. | Replace left-sidebar-only geometry with center workspace, split pane, compact row, selected/unread states, and detail-reader styles using existing tokens. Remove obsolete hover-preview and accordion geometry. |
| `packages/overlay/src/styles/surfaces/titlebar.css` | Mailbox launcher active and attention presentation. | Preserve badge/attention styling; change active semantics from hover visibility to primary Mailbox surface visibility. |
| `packages/overlay/src/services/mailbox.ts` | Sole Overlay list/acknowledge/delete/SSE transport. | Add the optional search query to the existing list request and response identity; preserve all existing mutation and stream paths. |
| `packages/opencorvus/src/server/routes/mailbox.ts` | Canonical `/mailbox` list, read-all, delete, acknowledge, and SSE routes. | Add an optional normalized query to the existing list route and OpenAPI contract. No new Mailbox route or store. |
| `packages/opencorvus/src/engine/mailbox.ts` | Canonical event projection, filters, counts, cursor, mutations, and scheduler views. | Add search filtering inside the canonical active projection before cursor pagination. Preserve counts as global active/unread counts and preserve scheduler/producer semantics. |
| `packages/overlay/src/services/desktop-notifications.ts` | Sole native Mailbox notification projector. | Preserve unchanged unless a later implementation review proves center-page visibility should affect notification policy; no such change is part of this design. |
| `packages/overlay/src/i18n/en-US.json` and `zh-CN.json` | Canonical Mailbox visible/accessibility strings. | Replace obsolete expand/collapse language with detail, back, selection-mode, search-result, context, and empty-detail strings in both catalogs. Keep Archived absent. |
| `packages/overlay/src/index.html` | Loads `mailbox.css`. | Preserve the single stylesheet load. |
| Mailbox producer/protocol files | `send-mailbox-message.ts`, coordination runtime tools, protocol model, agent prompts, and scheduler descriptions create or consume canonical messages. | Preserve message semantics and production paths. Update the stale tool description that says messages appear in the “left-sidebar mailbox” to say “Mailbox workspace”. |
| `specs/current/architecture/07-panel.md` and `07-panel-reactivity.md` | Current architecture still describes the left-sidebar Mailbox lifecycle. | Update during implementation, after reconciling the current shared dirty edits, to record primary-surface ownership, one center renderer, SSE invalidation, and preserved Conversation state. Do not edit them in this design-only turn. |
| Existing Mailbox UI tests and browser fixtures | Historical files assert the old sidebar DOM, hover lifecycle, accordion, CSS, and screenshots. | Leave untouched and unrun under the UI automated-test prohibition. They are not implementation acceptance. |
| Non-UI Mailbox route/engine tests | Existing route tests cover list, pagination, cross-project behavior, counts, read, archive, delete, and SSE. | If canonical server search is implemented, add non-UI positive/negative/query-plus-cursor contract coverage. UI appearance and interaction remain outside automated tests. |

## Required Page States

1. Initial loading with a stable list and detail skeleton geometry.
2. Active messages with no selection.
3. Selected unread message, then acknowledged selected message.
4. Selected attention message.
5. Selected progress message with evidence.
6. Empty active Mailbox.
7. Search loading, search results, and no search results.
8. Pagination loading and exhausted list.
9. Bulk-selection mode and destructive confirmation.
10. List-load, acknowledgement, deletion, and Task-open failures with the
    existing visible error owner; failures must not erase the last valid page.
11. A live invalidation where the selected message remains.
12. A live invalidation or delete where the selected message disappears.

## Implementation Sequence

1. Update this plan after reconciling any newer user decision, current
   architecture change, or repository call-site change.
2. Add canonical server-side Mailbox search to the existing list route and
   cover only its non-UI contract with route/engine tests.
3. Introduce primary workspace-surface ownership in `main.tsx` and `App.tsx`,
   retire the hover swap, and preserve Conversation and Right Dock owners.
4. Refactor the single `MailboxPanel` renderer into the virtualized master list
   and detail reader. Reuse Kobalte, existing Button/Badge/SearchField/Tooltip,
   Lucide, `virtua`, confirmation, error, link, and pane-resize owners.
5. Replace obsolete Mailbox CSS and locale strings; update current
   architecture and stale left-sidebar wording.
6. Run typecheck, localization, production build, API route/OpenAPI checks,
   focused non-UI search contracts, documentation health, formatting, and diff
   checks. Do not add, modify, update, delete, or run UI automated tests.
7. Start the real current-source desktop page with Node-based Browser tooling,
   exercise the launcher, list/detail selection, search, read, resize, evidence,
   Task navigation, bulk selection, empty/error states, keyboard/focus paths,
   and live updates. Capture and personally inspect task-scoped screenshots.
8. Correct every visual or interaction mismatch, repeat real-page review, then
   perform a second source/diff/ownership review before commit and `legacy-remote`
   push.

## Visual Acceptance

- At the standard desktop viewport, Mailbox reads as a primary workspace, while
  Work Ledger remains visible and the Right Dock remains independently usable.
- The list supports rapid scanning: subject, context, and time share a stable
  baseline; project separators are quieter than rows; unread, attention, and
  selection cannot be confused.
- The detail body is materially more readable than the current sidebar card and
  does not duplicate the same body in the list.
- Divider drag and keyboard resize remain visible, bounded, and smooth.
- Header, row, empty, loading, selection, destructive, hover, and focus states
  use the existing design system with no Multica brand imitation.
- Opening Mailbox does not destroy the current Conversation or change the
  selected Task/session. Opening a Task from Mailbox returns to the canonical
  Task Conversation.
- There is exactly one rendered Mailbox data surface and one canonical
  server projection.

## Out of Scope

- Mobile, tablet, or responsive navigation.
- Archived Mailbox UI.
- Threading, replying, composing, or editing A2A messages.
- Task-level notification deduplication.
- Changing Mailbox producers, scheduler wakeup semantics, or lifecycle state.
- A dashboard, notification center, or duplicate toast feed.
- Product-code implementation in this turn.

## Second Review

The design was challenged against the current center/right-dock model, the
existing global cross-project contract, and the official Multica implementation.
The review rejected three superficially attractive shortcuts:

1. putting Mailbox in `CenterWorkbenchPanel`, which would incorrectly make it a
   right-dock tool;
2. keeping the full hover preview beside the new center page, which would create
   two presentation contexts and retain the pointer-first lifecycle;
3. copying Multica's Issue-level deduplication and Archived destination, which
   would hide valid OpenCorvus events and contradict explicit history.

The remaining design has one primary-surface owner, one Mailbox renderer, one
canonical server projection, and a direct implementation path.

## Status

- [x] User requirement and Multica follow-up recorded.
- [x] Current source, current architecture, historical decisions, and whole-repository call sites inspected.
- [x] Live page and existing Mailbox screenshot personally inspected.
- [x] Official Multica Inbox source inspected and adoption/rejection decisions recorded.
- [x] Claude Code read-only review attempted; authentication blocker recorded without claiming findings.
- [x] Codex second design and ownership review complete.
- [ ] User design approval.
- [ ] Product implementation, real-page interaction, screenshot review, second implementation review, commit, and push.

## Verification

This is a design-only delivery. Verification is limited to document health,
index integrity, diff review, and confirmation that no product-code path changed.
The implementation acceptance described above remains pending user approval.
