# Sub-agent grid dynamic-split reactivity repair

## Recall

### User request and observed evidence

- The user reported that the same `universal-build` card was visible twice.
- The supplied screenshot shows one copy in the initial two-column
  `research-investigator` / `universal-build` grid and a second copy after a
  later Orchestrator message.
- Both copies show the same Delegated context, Tool activity, running status,
  and TODO progress. This is evidence of two DOM consumers of one canonical
  session record, not proof of duplicate backend execution.

### Acceptance criteria

- One canonical child `sessionID` renders at most one progress card after a
  mounted multi-session grid is split by a newly inserted ordinary
  conversation card.
- The old grid immediately reflects its current `sessionIDs` membership
  without remounting solely to refresh its payload.
- The new grid renders the moved child session in the correct chronological
  position.
- Stable virtual-row identity, scroll behavior, Agent Rail targeting, exact
  child-conversation routing, and the canonical conversation-agent store
  remain unchanged.
- A real Node-launched Vite and Playwright run reproduces the dynamic split,
  proves unique session/card identities, and produces an inspected screenshot.

### Hard constraints

- Preserve all parallel tracked and untracked work; do not reset, restore,
  stash, create a worktree, or broadly stage files.
- Do not restart, refresh, close, or otherwise interfere with the user's
  running OpenCorvus or Overlay process.
- Use Node, not Bun, for Playwright.
- Do not add a deduplication gate, a second store, a remount-only identity
  workaround, or a compatibility/fallback renderer.
- Keep canonical `sessionID` as the child identity and the existing
  conversation-agent projection as the single progress-card source.
- Commit subjects use the required `dsw-33987` prefix and push only to
  `myhexin` through normal hooks.

### Sources read

- `AGENTS.md`.
- The user-supplied screenshot.
- `specs/current/architecture/07-panel-reactivity.md`.
- `specs/current/architecture/12-overlay-card-system.md`.
- `specs/records/2026-07/2026-07-25-subagent-progress-grid-and-conversation-dock.md`.
- `specs/records/2026-07/2026-07-25-subagent-progress-refresh-projection-repair.md`.
- `specs/records/2026-07/2026-07-25-subagent-todo-progress-footer.md`.
- `packages/overlay/src/components/Conversation.tsx`.
- `packages/overlay/src/components/SubagentProgressGrid.tsx`.
- `packages/overlay/src/utils/subagent-presentation.ts`.
- `packages/overlay/src/store/conversation-agents.ts`.
- `packages/overlay/node_modules/virtua/lib/solid/index.jsx`.
- Existing unit and Node/Vite browser tests for Sub-agent progress cards.

### Whole-repository grep

- `rg -n "SubagentProgressGrid|subagent-grid|buildSubagentConversationItems|subagentProgressCardID" packages/overlay/src packages/overlay/test specs`
- `rg -n "conversationAgentRecordsForSource|renderedCardID|sessionID" packages/overlay/src/store packages/overlay/src/services packages/overlay/src/components packages/overlay/test`
- `rg -n "Virtualizer|itemByID|conversation-virtual-window" packages/overlay/src packages/overlay/test package.json`
- `rg -n "subagent-progress-dock" packages/overlay/test package.json packages/overlay/package.json`

### Independent Agent feedback

- The read-only source audit proved that hydrated and live records converge by
  `sessionID`; the store does not contain the duplicate shown in the
  screenshot.
- The same audit traced the stale payload to Virtua's untracked child
  construction: `Conversation.tsx` snapshots `itemByID().get(id)` inside the
  virtualizer callback, so a reused grid ID retains its old `sessionIDs`.
- The read-only test audit identified the missing transition: existing tests
  cover static grouping and truncated refresh, but never split an already
  mounted grid by inserting an ordinary card between its child sessions.
- Both audits recommend a reactive item resolver at the virtual-row consumer
  boundary and reject encoding all grid membership into the row ID because
  remounting would discard stable virtual scroll identity.

## Causal chain

1. `buildSubagentConversationItems` groups adjacent child records and gives a
   grid the stable ID of its first child session.
2. Initially, adjacent research and build records produce one grid whose
   membership is `[research, build]`.
3. A later Orchestrator message with an order key between those records changes
   the correct projection to `[research]`, Orchestrator, `[build]`.
4. The first grid keeps the same stable ID. Virtua reuses that row and does not
   rerun its untracked child factory for the unchanged ID.
5. `Conversation.tsx` passed the old item object as a static component prop, so
   the reused row continued to render `[research, build]`.
6. Virtua also mounted the new build-only grid. Both progress-card instances
   resolved the same canonical build record, producing visually identical
   cards.

## Single-source repair

Keep the stable virtualizer data and row IDs, but pass a reactive item accessor
from `VirtualizedConversationCards` into `VirtualizedConversationItem`.
Resolve the current item from `itemByID` inside Solid's reactive component
scope. Derive the row's virtual ID, grid/card branch, session membership, and
agent-boundary state from that accessor. The virtualizer remains responsible
only for row identity and measurement; the current conversation projection
remains responsible for row content.

## Exhaustive call-site disposition

| Owner / call site                                   | Disposition                                                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `buildSubagentConversationItems`                    | Preserve grouping and stable first-session grid IDs; the pure projection is correct.                           |
| `VirtualizedConversationCards.items/itemByID/order` | Preserve as the single reactive conversation projection and ID index.                                          |
| Virtua child callback in `Conversation.tsx`         | Stop snapshotting the item object; pass a reactive resolver keyed by the stable row ID.                        |
| `VirtualizedConversationItem`                       | Resolve its current item and boundary state reactively before rendering the grid or ordinary card.             |
| `SubagentProgressGrid`                              | Preserve exact `sessionID` lookup and card rendering; it correctly exposes the stale parent payload.           |
| `conversation-agents.ts` hydrate/live upserts       | Preserve unchanged; all paths already converge by canonical `sessionID`.                                       |
| Agent Rail and Right Dock                           | Preserve unchanged; they already route by exact canonical `sessionID`.                                         |
| `subagent-progress-presentation.test.ts`            | Add the before/after pure projection contract for the split shape.                                             |
| Sub-agent progress Vite fixture and browser test    | Add an in-place timeline split, unique-session assertions, exact grid membership assertions, and a screenshot. |

## Verification plan

1. Add the pure projection transition regression.
2. Add the mounted Node/Vite/Playwright dynamic split regression and inspect
   its screenshot.
3. Run focused Overlay unit and browser tests.
4. Run Overlay typecheck plus required historical-doc and document-health
   checks.
5. Review the complete diff and current `HEAD`, stage only task-owned hunks,
   commit with `dsw-33987`, fetch/reconcile `myhexin`, and push with hooks.
