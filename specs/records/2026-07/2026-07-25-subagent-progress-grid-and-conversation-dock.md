# 2026-07-25 Sub-agent Progress Grid And Conversation Dock

## Recall

### User request

- Add a Sub-agent tab to the canonical Right Dock.
- The tab shows the selected child agent's complete real conversation.
- Replace full child-agent turns in the main conversation with a compact card
  grid that scrolls through truthful progress.
- Clicking a progress card opens that exact child session in the Right Dock.
- Clicking an Agent Rail tick locates and highlights the corresponding progress
  card.
- Follow the supplied restrained Codex-like reference: low-noise identity
  pills, quiet activity rows, and no duplicated full transcript in the main
  thread.
- Follow-up: the right-side child-agent transcript must automatically track
  newly streamed content at the bottom. Manual upward scrolling pauses
  tracking so the operator can read history; returning to the bottom resumes
  tracking.
- Follow-up: main-agent conversation cards no longer use an outer disclosure;
  their full body stays mounted and visible.
- Follow-up: the Right Dock mirrors the canonical main-conversation card
  language as one continuous child-session surface. Delegated Context remains
  visually prominent but collapsed by default, while tool activity uses the
  same collapsed work-details and nested tool-card treatment.
- Follow-up: compact child-agent progress cards use the active rounded design
  tokens; retired undefined radius and animation variables must not flatten
  them into square cards.

### Acceptance criteria

- One real child `sessionID` is the identity shared by Agent Rail, progress
  card, and Right Dock transcript.
- Main-conversation progress comes only from the existing
  `conversationAgentStore` plus canonical `cardTreeStore` message/tool parts;
  no timer text, synthetic message, title inference, or local fake progress is
  introduced.
- Child session cards are grouped into a desktop grid at their first canonical
  session position. Later turns update the same card instead of duplicating a
  full inline transcript.
- A progress card has a bounded native scroll region, follows new real
  activity while running, remains keyboard operable, and exposes exact status.
- The Sub-agent Right Dock tab is programmatic rather than add-menu content:
  selecting a progress card or other exact-session launcher opens/focuses it.
- The dock fetches the canonical task-child or standalone-session conversation
  route and renders its full persisted message/tool sequence. It does not
  mutate or replace the main conversation tree.
- The dock initially opens at the newest message, follows each canonical
  transcript refresh while bottom tracking is active, releases the viewport
  when the operator scrolls upward, and resumes after the viewport returns to
  the bottom.
- Main-agent bodies have no outer fold control in the main transcript.
- One selected child session renders as one continuous canonical conversation
  card in the Dock, with a collapsed Delegated Context disclosure and the same
  Tool/work-details hierarchy as the main conversation.
- Progress cards have a non-zero token-owned border radius in the real Vite
  page.
- Agent Rail click scrolls to the stable session progress-card ID and applies
  the existing bounded highlight treatment.
- Light and dark desktop Vite screenshots, pointer interaction, keyboard focus,
  card-to-dock navigation, and Agent Rail highlight are visually reviewed.

### Hard constraints

- Preserve all unrelated staged, unstaged, and untracked work in the shared
  main worktree.
- Do not create a worktree, reset, stash, restore, or broadly stage files.
- Do not restart, close, refresh, or otherwise interfere with the user's
  running OpenCorvus or overlay process.
- Browser automation runs through Node, never Bun.
- Desktop is the only delivery target for this request; no mobile or tablet
  scope is added.
- Do not add a second conversation store, fallback route, compatibility alias,
  hidden message, workflow gate, or host-side execution state machine.

### Sources read before implementation

- Root `AGENTS.md` and the Browser control skill.
- Supplied screenshot
  `/var/folders/bj/6vby7ld11796l5bfdmc7s8l40000gn/T/codex-clipboard-e5914f8f-f284-4f85-8de0-6e0fa7757a74.png`.
- `specs/current/architecture/07-panel.md`.
- `specs/current/architecture/07-panel-reactivity.md`.
- `specs/current/architecture/12-overlay-card-system.md`.
- `specs/current/architecture/13-agent-communication-matrix.md`.
- `specs/records/2026-07/2026-07-08-subagent-terminal-summary-cards.md`.
- `packages/opencorvus/src/conversation/view.ts`.
- `packages/opencorvus/src/server/routes/orchestrator.ts`.
- `packages/opencorvus/src/server/routes/session.ts`.
- `packages/overlay/src/store/card-tree.ts`.
- `packages/overlay/src/store/conversation-agents.ts`.
- `packages/overlay/src/components/Conversation.tsx`.
- `packages/overlay/src/components/ConversationAgentRail.tsx`.
- `packages/overlay/src/components/RightDock.tsx`.
- `packages/overlay/src/components/ChatBubble.tsx`.
- `packages/overlay/src/components/Card.tsx`.
- `packages/overlay/src/components/CardParts.tsx`.
- `packages/overlay/src/components/App.tsx`.
- `packages/overlay/src/main.tsx`.
- `packages/overlay/src/services/conversation.ts`.
- `packages/overlay/src/services/conversation-scroll.ts`.
- `packages/overlay/src/styles/surfaces/conversation.css`.
- `packages/overlay/src/styles/surfaces/chat-bubble.css`.
- `packages/overlay/src/styles/surfaces/card.css`.
- Existing focused and browser Agent Rail tests.

### Whole-repository grep evidence

- `rg -n "sub.?agent|child agent|agent rail|AgentRail|right dock|RightDock|session.*agent|agent.*session" packages/overlay/src packages/overlay/test packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-07`
- `rg -n "RightDockPanel|rightDockPanelMeta|RIGHT_DOCK_CATALOG|RIGHT_DOCK_ENVIRONMENT_TOOL_CATALOG" packages/overlay/src packages/overlay/test`
- `rg -n "ConversationAgentRail|loadConversationSessionHistory|requestConversationCardScroll|conversationAgentRecordsForSource" packages/overlay/src packages/overlay/test`
- `rg -n "agentInvocationDAG|delegate_agent|dispatch_agent|AgentActivityRecord|conversationAgentRecordsForSource" packages/overlay/src packages/overlay/test`
- `rg -n "loadConversationSessionHistory|session.*conversation|conversation/view|ConversationView" packages/overlay/src packages/opencorvus/src packages/sdk/openapi.json`

### Independent agent feedback

- None. The user did not request delegation, and the active collaboration
  boundary forbids unrequested sub-agents. The primary agent owns the
  inventory, implementation, visual review, and second diff review.

### Git and workspace baseline

- Current branch: `v0.0.18beta`, synchronized with `myhexin/v0.0.18beta` at
  the start of the task.
- The shared worktree already contains staged, unstaged, and untracked changes,
  including unrelated `main.tsx`, localization, Settings, API, and spec-index
  work. These remain outside this task's ownership.

## Diagnosis

The backend already exposes the correct facts. `projectConversationView`
projects exact session, participant, parent, status, order, and message
identities. Task children have
`GET /task/:taskID/conversation/session/:sessionID`; standalone Chat children
have the canonical `GET /session/:sessionID/conversation` route. The Overlay
already merges the same session facts into `conversationAgentStore`.

The mismatch is presentation ownership:

1. `Conversation.tsx` renders every child session's full message turns as
   ordinary top-level `ChatBubble` items.
2. `ConversationAgentRail.tsx` therefore targets the latest rendered message
   card and hydrates old task history solely so that full inline card exists.
3. `RightDock.tsx` has no session-transcript panel identity.

The correct replacement keeps the canonical stores and routes, but changes the
main-thread projection. A stable session-level progress card replaces the
duplicated inline child transcript, while the exact transcript moves to one
Right Dock panel. Agent Rail then targets that stable progress card.

## Exhaustive call-site disposition

| Call site / owner                         | Current behavior                                                                 | Disposition                                                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `Conversation.tsx` virtual `order()`      | Renders every top-level card ID independently.                                   | Project child-session card IDs into stable session-grid items; preserve ordinary card order and source stores. |
| `VirtualizedConversationItem`             | Resolves every item through `StoreCardNode`.                                     | Render either a real card or a session progress grid; no second card tree.                                     |
| `ConversationAgentRail.locateRecord`      | Materializes and targets `renderedCardID`.                                       | Target the stable session progress-card ID; keep diagnostics and highlight behavior.                           |
| `goal-locate.ts`                          | Locates goal evidence by exact rendered card.                                    | Preserve unchanged; Goal navigation still targets canonical transcript evidence.                               |
| `loadConversationSessionHistory`          | Merges historical child content into the main tree for exact-card navigation.    | Preserve unchanged for Goal/history flows; Agent Rail no longer needs it.                                      |
| `conversation-scroll.ts`                  | Carries exact DOM card IDs to the Conversation virtualizer.                      | Preserve the contract; allow the virtualizer to map a stable Sub-agent card ID to its containing grid item.    |
| `RightDockPanel` union/catalog/meta       | Owns fixed panel identities and addable-tool catalog.                            | Add non-addable `subagent` meta alongside programmatic `file`; do not put it in the `+` tool chooser.          |
| `main.tsx` center panel union/order/views | Owns open tabs, active tab, and mounted panel bodies.                            | Add one `subagent` panel and selected session signal; reuse canonical open/select/close functions.             |
| `App.tsx`                                 | Mounts Agent Rail and Conversation without an exact-session navigation callback. | Thread one `onOpenSubagentConversation(sessionID)` callback into both surfaces.                                |
| `TaskDirBar` environment catalog          | Lists user-addable resource tools.                                               | Preserve unchanged; a Sub-agent tab requires an exact session and is not a generic Environment tool.           |
| task child conversation route             | Returns exact child transcript/view/events.                                      | Reuse unchanged.                                                                                               |
| standalone session conversation route     | Returns the selected session-tree transcript/view.                               | Reuse unchanged with the selected child as route root.                                                         |
| `CardParts` / `Card`                      | Canonical message/tool renderers.                                                | Reuse inside the dock transcript; no new tool/text renderer.                                                   |

## Implementation plan

1. Add a pure Sub-agent presentation utility that identifies child sessions,
   builds stable card/grid IDs, and extracts bounded real progress entries from
   existing card parts.
2. Add `SubagentProgressGrid` and integrate it into the Conversation
   virtualizer so child session turns collapse into one keyboard-operable card.
3. Retarget Agent Rail clicks to the stable progress-card identity.
4. Add the non-addable Right Dock panel, exact selected-session state in the
   current workbench owner, and `SubagentConversationPanel`.
5. Add localized labels and quiet design-token-based styles matching the
   supplied reference.
6. Update current architecture documentation and focused tests.
7. Run typecheck, unit/browser tests, required document-health checks, and
   isolated Vite visual interaction in light/dark themes.
8. Review the final diff against this Recall, commit only task-owned changes,
   and do not push unless the user separately requests it.

## Follow-up verification: Dock bottom tracking

- `bun run typecheck` passed.
- Focused bottom-follow, conversation-route, and progress-projection tests
  passed 9/9.
- The Node-launched Vite browser acceptance passed 1/1 after appending 16
  canonical child-session messages. It verified active bottom follow, manual
  upward-scroll release, preserved reading position during further appends,
  and automatic follow resumption after returning to the bottom.
- The independent in-app browser inspection found
  `data-follow-lock="true"`, zero distance from the bottom, and no browser
  warnings or errors.
- Visual review of `.scratch/subagent-progress-dock.png` confirmed the latest
  streamed messages remain visible at the bottom without disturbing the Dock
  header or main progress grid.

## Follow-up verification: canonical continuous transcript

- Extracted `ConversationCard` as the single `Card` / `ChatBubble` dispatcher.
  Both the main conversation and the Sub-agent Dock now use that owner.
- Main-conversation calls pass `collapsible={false}`. The Agent identity,
  transcript body, hover actions, and nested work disclosures remain visible,
  while the outer chevron/button is absent.
- The selected child transcript is projected into one continuous
  `subagent-transcript:<sessionID>` card. Real message boundaries stay inside
  the card, and delegated message IDs feed the existing canonical Delegated
  Context disclosure.
- The retired `--oc-radius-card`, `--oc-duration-fast`, and
  `--oc-ease-standard` consumers on Sub-agent progress cards were replaced by
  active design-language tokens.
- `bun run typecheck` passed across all 9 typechecked packages.
- Focused Sub-agent route/projection, bottom-follow, ChatBubble, and
  architecture ownership tests passed 12/12.
- The two Node-launched browser tests passed 2/2. They cover the permanently
  expanded main Agent, one-card continuous Dock transcript, collapsed
  Delegated Context, canonical Tool/work-details rendering, 8px progress-card
  radius, keyboard card navigation, Agent Rail highlighting, and bottom-follow
  release/resume.
- `bun run build:vite` passed as part of the browser run.
- The in-app browser independently observed one Dock conversation card,
  `Delegated Context=false`, `Tools=false`, no outer disclosure, a static Agent
  header, and an 8px progress-card radius.
- Visual review of
  `.scratch/subagent-conversation-canonical.png`,
  `.scratch/subagent-conversation-tool.png`, and
  `.scratch/subagent-progress-dock.png` confirmed the requested continuous,
  low-noise design language.
- `historical-docs-links.test.ts` passed 21/21. The broader radius-coverage test
  remains red on pre-existing committed consumers in `mailbox.css`,
  `settings.css`, `messages.css`, `composer.css`, and earlier
  `conversation.css` rules; the changed Sub-agent selectors no longer consume
  any retired radius or animation token.

## 2026-07-25 Follow-up: aggregate Squad agents in one Dock tab

### Recall

- The user supplied a screenshot of the current Right Dock, where the
  top-level tab and the panel header both repeat one selected Agent name.
- The requested hierarchy is one top-level `Squad agents` tab, followed by the
  individual real Agents inside that panel.
- Clicking a main-conversation progress card must still select the exact
  canonical child `sessionID`, and switching the inner Agent control must load
  that Agent's complete continuous transcript.
- The existing light/dark design language, collapsed Delegated Context,
  collapsed Tool details, bottom-follow behavior, keyboard operation, and
  session routes remain unchanged.
- The earlier delivery instruction remains commit-only; do not push.

### Hard constraints and sources

- Preserve unrelated work; do not reset, restore, stash, create a worktree, or
  restart the running OpenCorvus process.
- Keep `centerWorkbenchPanels` as the only top-level Dock tab source,
  `selectedSubagentSessionID` as the only selected child identity, and
  `conversationAgentRecordsForSource` as the only Agent collection.
- Reuse the existing Kobalte-backed Tabs, Avatar, and StatusIndicator
  primitives. Do not add hand-written tab roles, a duplicate session list, or
  another transcript store.
- Sources read: `AGENTS.md`, Browser control skill, the supplied screenshot,
  `specs/current/architecture/07-panel.md`,
  `specs/current/architecture/12-overlay-card-system.md`,
  `RightDock.tsx`, `SubagentConversationPanel.tsx`, `main.tsx`,
  `Tabs.tsx`, `Avatar.tsx`, `conversation-agents.ts`,
  `subagent-conversation.ts`, Dock/conversation CSS, focused ownership tests,
  and the real Vite Sub-agent fixture.
- Whole-repository grep:
  `rg -n "SubagentConversationPanel|selectedSubagentSessionID|right_dock.tool.subagent|subagent-conversation-panel|data-tab=\"subagent\"" packages/overlay/src packages/overlay/test specs`;
  `rg -n "RightDockPanel|rightDockPanelMeta|RIGHT_DOCK_CATALOG|conversationAgentRecordsForSource|sessionID" packages/overlay/src packages/overlay/test`.
- Independent Agent feedback: none. The user did not request delegation, so
  the primary Agent owns implementation and second review.

### Diagnosis and call-site disposition

`RightDock` already owns exactly one programmatic `subagent` panel identity.
The apparent one-tab-per-Agent behavior comes from `main.tsx` overriding that
panel's title with the selected record's `agentID`. The panel itself renders
only the selected record header and transcript, so there is no visible
collection level between the Dock and the child session.

| Owner / call site | Disposition |
| --- | --- |
| `RightDock.tsx` `SUBAGENT_PANEL_META` | Keep the single non-addable `subagent` identity; localize its fixed label as `Squad agents`. |
| `main.tsx` `titleForPanel` | Remove the per-session Agent-title override; retain dynamic titles only for Browser Preview. |
| `selectedSubagentSessionID` / `openSubagentConversation` | Keep as the single exact selection source. Progress-card clicks still set it before opening the one panel. |
| `SubagentConversationPanel.tsx` | Project all records from `conversationAgentRecordsForSource` into one internal Tabs selector; selecting a tab writes the existing session signal. |
| `loadSubagentConversation` | Preserve exact task-child and standalone routes unchanged; fetch only the selected session. |
| `inspector.css` | Add a bounded, horizontally scrollable inner Agent strip using existing density, radius, surface, stage, and status tokens. |
| Vite fixture and browser test | Require one top-level `Squad agents` tab, three inner real Agent tabs, exact selection switching, continuous transcript rendering, and existing bottom tracking. |

### Implementation and acceptance

1. Fix the top-level panel label and remove dynamic Agent naming from the Dock
   tab.
2. Add one primitive-owned inner Agent tab strip above the selected Agent
   summary and transcript.
3. Keep card clicks and inner-tab clicks converged on
   `selectedSubagentSessionID`.
4. Update current architecture and focused source/browser assertions.
5. Run typecheck, production build, focused tests, real Node-launched Vite
   pointer/keyboard interactions, and visual screenshot review before
   committing only task-owned files.

### Outcome and verification

- The programmatic top-level Dock tab now keeps the fixed localized
  `Squad agents` identity instead of mirroring the selected Agent name.
- `SubagentConversationPanel` projects the canonical source's real Agent
  records through the shared Tabs primitive. Each inner tab retains its exact
  `sessionID`, stage Avatar, status, accessible name, and selected state.
- Progress-card navigation and inner-tab selection both update the existing
  `selectedSubagentSessionID`; the task-child and standalone transcript routes
  are unchanged.
- The inner strip is horizontally scrollable for larger squads without
  painting an additional scrollbar, while the selected Agent header,
  continuous conversation card, Delegated Context, Tool details, and
  bottom-follow controller remain unchanged.
- Focused source, service, Dock ownership, and auto-scroll tests passed 8/8.
  The Node-launched Vite browser acceptance passed 1/1 and covered one
  top-level tab, three inner Agent tabs, card navigation, inner-tab switching,
  keyboard navigation, exact transcript changes, Rail highlighting, and
  bottom-follow release/resume.
- Independent in-app browser review observed `topTabs=["Squad agents"]`,
  three canonical inner session IDs, exact Backend transcript selection,
  hidden overflow chrome, and no browser warnings or errors. The final
  `.scratch/subagent-conversation-canonical.png` screenshot was visually
  reviewed after removing the noisy horizontal scrollbar paint.
- Overlay i18n validation, Overlay typecheck, and the production Vite build
  passed. Historical-link tests passed 21/21 and product-doc single-source
  tests passed 8/8.
- The broader document-health run passed 90/91. Its only failure is unrelated
  concurrent work: `specs/records/2026-07/README.md` references the untracked
  `2026-07-25-subagent-progress-refresh-projection-repair.md`. That record and
  its index changes remain outside this task's commit.
