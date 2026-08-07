# Sub-agent Conversation Tab Overflow Repair

## Recall

- User request: repair the Squad Agent selector shown in the supplied screenshot, where additional Agent tabs are clipped at the right edge.
- Acceptance:
  - a narrow Dock with many Agent sessions exposes an obvious, always reachable complete Agent selector;
  - choosing an Agent through either the tab strip or complete selector writes the existing `sessionID` selection;
  - the selected tab is brought into the horizontal viewport;
  - Agent identity and status remain readable without wrapping the strip or shrinking labels into avatar-only controls;
  - real Node-launched Vite interaction and a task-scoped screenshot prove the narrow overflow state.
- Hard constraints:
  - preserve `conversationAgentRecordsForSource(boardStore.selectedSource)` as the sole Agent collection;
  - preserve the current exact-session transcript routes and `props.onSessionSelect` ownership;
  - reuse Kobalte Tabs, DropdownMenu, shared Button, Avatar, Icon, and StatusIndicator primitives;
  - do not add a second selection signal, hidden session catalog, temporary iframe, local fixture-only state override, or compatibility path;
  - preserve all unrelated dirty-worktree changes and do not restart or refresh the running OpenCorvus / Overlay process.
- Read:
  - `specs/current/architecture/12-overlay-card-system.md`;
  - `specs/records/2026-07/2026-07-25-subagent-progress-grid-and-conversation-dock.md`;
  - `packages/overlay/src/components/SubagentConversationPanel.tsx`;
  - `packages/overlay/src/components/RightDock.tsx`;
  - `packages/overlay/src/components/ui/Tabs.tsx`;
  - `packages/overlay/src/components/ui/DropdownMenu.tsx`;
  - `packages/overlay/src/styles/surfaces/inspector.css`;
  - focused unit and browser tests for the Sub-agent conversation Dock.
- Whole-repository grep:
  - `SubagentConversationPanel` is mounted only by `main.tsx` and the task-scoped browser fixture;
  - `conversationAgentRecordsForSource` is the canonical projection used by the Agent Rail, progress grid, exact-session Dock, goal locate, and Environment summary;
  - the exact Agent-tab styles and tests are limited to `SubagentConversationPanel.tsx`, `inspector.css`, `subagent-conversation-autoscroll.test.ts`, and `subagent-progress-dock-browser.test.ts`;
  - `RightDock.tsx` already establishes Kobalte DropdownMenu as the mature overflow-selection primitive.
- Independent Agent feedback: none requested; the user did not request multiple independent agents or parallel audit.

## Root cause

The current selector only applies `overflow-x: auto` to the Kobalte TabList. This
preserves access through an undiscoverable horizontal gesture, but the Dock edge
clips the next Agent name without exposing the complete collection or ensuring
that a newly selected off-screen tab is visible. Label truncation is already
present, so further compression would only defer the same failure.

## Call-site disposition

| Call site                                            | Disposition                                                                                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SubagentConversationPanel.tsx`                      | Wrap the existing TabList in one selector row, add a Kobalte complete-Agent menu sourced from the same `records()`, and scroll the selected existing Tab into view. |
| `main.tsx`                                           | Keep unchanged; it continues to own `selectedSubagentSessionID` and passes the existing selection callback.                                                         |
| `conversation-agents.ts`                             | Keep unchanged as the sole Agent projection.                                                                                                                        |
| `RightDock.tsx`                                      | Keep unchanged; reuse its established primitive pattern without sharing Dock-local open state.                                                                      |
| `inspector.css`                                      | Give the strip the remaining row width and keep a fixed menu trigger visible at the trailing edge.                                                                  |
| `subagent-conversation-autoscroll.test.ts`           | Assert primitive reuse, one canonical record source, direct selection callback, and selected-tab reveal.                                                            |
| `subagent-progress-dock-browser.test.ts` and fixture | Add enough canonical sessions to force narrow overflow, exercise complete-menu selection, verify selected-tab geometry, and capture visual evidence.                |

## Implementation

1. Add a fixed trailing complete-Agent DropdownMenu next to the scrollable
   Kobalte TabList. Menu items render the same Agent avatar, name, and status and
   call `props.onSessionSelect(candidate.sessionID)`.
2. Track no new business state. A render-timed effect observes only the canonical
   selected `sessionID` and record collection, finds the already-rendered Tab,
   and invokes `scrollIntoView({ block: "nearest", inline: "nearest" })`.
3. Keep the strip single-line. The menu trigger remains outside its scrolling
   viewport, reports the total count, and uses the shared compact Button/Icon
   language.
4. Extend focused source tests and the real narrow Dock fixture. Run Node-based
   Vite browser acceptance, inspect the screenshot, then run typecheck and
   required documentation health checks.

## Verification

- `bun test packages/overlay/test/subagent-conversation-autoscroll.test.ts packages/overlay/test/mission-i18n.test.ts packages/overlay/test/right-dock-panel-ownership.test.ts` — 84 passed, 0 failed.
- `bun run typecheck --filter @opencorvus-ai/overlay` — passed before a concurrent branch merge introduced unrelated unresolved worktree conflicts.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/subagent-progress-dock-browser.test.ts` — 1 passed, 0 failed through the required Node runner and real Vite page.
- Browser geometry after complete-menu selection of `session-integrity`: horizontal overflow present, selected tab fully within the strip viewport, fixed menu trigger visible, and `scrollLeft` advanced to `100`.
- Visual evidence:
  - `.scratch/subagent-conversation-agent-overflow.png` shows the fixed complete-Agent menu expanded with all canonical Agent names and statuses;
  - connected-browser review shows the last selected Agent fully visible without wrapping or Dock-height movement.
- Delivery blocker: while verification was running, a concurrent task changed the branch from `v0.0.20beta` to `v0.0.21beta` and left an unrelated merge with unresolved files. This repair must not resolve, overwrite, stage, commit, or push those parallel conflicts.

## 2026-07-27 redundant selected-Agent header removal

### Recall

- User request: remove the redundant header directly beneath the Agent tab strip
  shown in the supplied screenshot.
- Acceptance:
  - the Agent tab strip remains the sole visible Agent identity and status
    surface;
  - the repeated Agent name, raw session ID, and completion label row no longer
    renders;
  - the conversation begins directly below the selector without changing exact
    session selection, transcript loading, or bottom-follow behavior;
  - a real Vite screenshot proves the duplicate row is gone.
- Hard constraints:
  - delete the redundant DOM and its dead CSS rather than hiding it;
  - preserve `records()`, `props.sessionID`, and `props.onSessionSelect` as the
    existing single sources;
  - preserve unrelated dirty-worktree changes and do not restart or refresh the
    running OpenCorvus / Overlay process.
- Read: this record, `SubagentConversationPanel.tsx`, `inspector.css`,
  `subagent-conversation-autoscroll.test.ts`, and
  `subagent-progress-dock-browser.test.ts`.
- Whole-repository grep: the repeated header/heading/status classes occur only
  in `SubagentConversationPanel.tsx` and their dedicated `inspector.css` block;
  no other component or test consumes them. `data-ui="subagent-selected-agent"`
  remains the TabPanel identity and is not part of the redundant header.
- Independent Agent feedback: none requested; the user did not request multiple
  independent agents or parallel audit.

### Root cause and call-site disposition

The selector tab already renders the selected Agent name and status from the
canonical `records()` projection. The selected TabPanel then repeated that
identity, exposed the raw session ID, and rendered the same status a second
time. The second row was a second presentation of identical state, not a
navigation or transcript control.

| Call site                                                 | Disposition                                                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `SubagentConversationPanel.tsx`                           | Delete the repeated header DOM and derived display-only labels; keep `record()` and `status()` for transcript card projection. |
| `inspector.css`                                           | Delete the orphaned header, heading, session-ID, and status rules.                                                             |
| `subagent-conversation-autoscroll.test.ts`                | Assert the selector remains and all repeated-header source/style classes are absent.                                           |
| `subagent-progress-dock-browser.test.ts`                  | Assert the rendered Dock contains no repeated Agent header and retain its task-scoped screenshot.                              |
| `main.tsx`, `conversation-agents.ts`, transcript services | Keep unchanged because selection, projection, and exact-session loading semantics do not change.                               |

### Implementation and verification plan

1. Remove the selected-Agent summary row and dead CSS.
2. Run focused source and real Node-launched Vite browser acceptance.
3. Inspect the task-scoped screenshot, then run Overlay typecheck and required
   documentation health checks.

### Verification

- `bun test packages/overlay/test/subagent-conversation-autoscroll.test.ts` —
  3 passed, 0 failed.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/subagent-conversation-header-browser.test.ts`
  — 1 passed, 0 failed through the required Node runner and a real Vite page.
- Connected-browser inspection: `redundantHeaderCount=0`,
  `selectedAgentTabCount=1`, and the conversation scroll surface begins directly
  at the selector bottom edge.
- Screenshot:
  `.scratch/subagent-conversation-without-redundant-header.png`.
- `bun run typecheck` in `packages/overlay` — passed.
- `historical-docs-links.test.ts` — 22 passed. The combined document-health run
  reported one unrelated concurrent-index failure because the July README
  points to three record files that are not currently tracked.

## 2026-07-28 hidden tab-strip scrollbar

### Recall

- User request: remove the visible horizontal scrollbar beneath the child-Agent
  tabs because the fixed trailing complete-Agent control already exposes every
  option.
- Acceptance:
  - the overflowing child-Agent strip paints no horizontal scrollbar;
  - the trailing complete-Agent trigger remains visible;
  - opening the trigger exposes every canonical Agent option;
  - selecting an off-screen Agent still writes the existing `sessionID` and
    reveals its existing tab;
  - a real Node-launched Vite interaction and task-scoped screenshot prove the
    overflow state.
- Hard constraints:
  - preserve `conversationAgentRecordsForSource(boardStore.selectedSource)` as
    the sole collection and `props.onSessionSelect` as the sole selection
    writer;
  - preserve Kobalte Tabs and DropdownMenu plus the shared Button, Avatar, Icon,
    and StatusIndicator primitives;
  - retain horizontal programmatic reveal without adding a second catalog,
    local state override, fallback, gate, or replacement interaction;
  - preserve unrelated dirty-worktree changes and do not restart, refresh, or
    otherwise intervene in the running OpenCorvus / Overlay process;
  - launch Playwright only through Node.js.
- Read: this record, the supplied screenshot,
  `SubagentConversationPanel.tsx`, `inspector.css`, `base.css`,
  `subagent-conversation-autoscroll.test.ts`,
  `subagent-progress-dock-browser.test.ts`, and
  `visible-scrollbar-whitelist.test.ts`.
- Whole-repository grep:
  - `SubagentConversationPanel.tsx` remains the sole selector/menu owner and
    uses the same `records()` projection for both surfaces;
  - `inspector.css` is the only feature-local rule that opts the Agent TabList
    back into a visible `thin` scrollbar;
  - `base.css` already defines hidden scrollbar chrome as the product default;
  - `subagent-conversation-autoscroll.test.ts` owns the selector source
    contract, while `subagent-progress-dock-browser.test.ts` owns real overflow,
    complete-menu, exact-session selection, selected-tab reveal, and screenshot
    evidence;
  - no server route, SDK, record projection, Right Dock owner, or localization
    contract needs to change.
- Independent Agent feedback: none requested; the active collaboration policy
  does not authorize sub-agent delegation for this coupled CSS and test change.

### Cause and call-site disposition

The complete-Agent menu already solves discoverability and exact-session
selection. The remaining scrollbar is produced solely by
`.subagent-conversation-panel__agent-tabs.oc-tabs { scrollbar-width: thin; }`,
which overrides the product-wide hidden-scrollbar default. Removing the visible
chrome does not require removing the overflow container: the existing
`scrollIntoView` behavior must continue to reveal a menu-selected off-screen
tab.

| Call site | Disposition |
| --- | --- |
| `SubagentConversationPanel.tsx` | Keep unchanged; canonical records, menu selection, and selected-tab reveal already implement the requested behavior. |
| `inspector.css` | Replace the local visible-scrollbar opt-in with the explicit hidden-scrollbar contract while retaining horizontal overflow. |
| `subagent-conversation-autoscroll.test.ts` | Require hidden chrome and retained horizontal overflow on the one Agent TabList. |
| `subagent-progress-dock-browser.test.ts` | Prove computed hidden scrollbar chrome, visible complete-menu trigger, complete canonical option coverage, exact-session selection, reveal geometry, and screenshot evidence. |
| `base.css`, `main.tsx`, `conversation-agents.ts`, SDK/server routes | Keep unchanged; none owns this feature-local visual override. |

### Verification plan

1. Update the focused source and browser assertions.
2. Remove the feature-local visible scrollbar opt-in without changing the
   canonical menu or selection implementation.
3. Run the focused Bun tests, Overlay typecheck, and the existing Node-launched
   Vite browser fixture.
4. Inspect the fresh overflow/menu screenshot at original resolution.
5. Run required documentation health checks, review the task-owned diff, commit
   only task-owned paths, and push the current delivery branch to `legacy-remote`.

### Verification

- Focused source coverage passed: 7 tests, 0 failures, 51 assertions across
  `subagent-conversation-autoscroll.test.ts` and
  `visible-scrollbar-whitelist.test.ts`.
- Overlay TypeScript passed with `tsc --noEmit`.
- The focused Node-launched Vite browser acceptance
  `subagent-conversation-header-browser.test.ts` passed. Its first run completed
  all page assertions and screenshot capture but hit a Windows sidecar-cleanup
  race when one child process had already exited; the unchanged rerun completed
  with 1 pass and 0 failures.
- Real rendered geometry reported `overflow=true`,
  `scrollbarWidth="none"`, and a fully visible fixed complete-Agent trigger.
  The expanded menu exposed exactly `session-frontend-audit`,
  `session-backend-audit`, and `session-integrity`; selecting the last entry
  wrote `sessionID="session-integrity"` and brought its selected Tab fully
  inside the strip viewport.
- Connected-browser review reproduced the same state from the isolated Vite
  fixture and found no console warnings or errors.
- Original-resolution visual review of
  `.scratch/subagent-conversation-hidden-scrollbar-menu.png` confirmed the
  horizontal scrollbar is absent, the selector height no longer reserves a
  scrollbar band, the trailing menu remains visible, and all three options fit
  the expanded menu without clipping or layout displacement.
- Historical-link and product-document single-source checks passed. The
  combined document-health run passed 90 of 93 checks; two unrelated
  repository-wide scans exceeded their five-second test timeout under the
  concurrent workload, and the monthly-index check listed ten unrelated
  concurrently untracked July records already referenced by the shared index.
  This task adds no new record or index entry and does not own those files.
