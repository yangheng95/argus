# Sub-agent Conversation Refresh Storm Repair

## Recall

### User request

- Inspect OpenCorvus resource consumption and explain why the running desktop
  application became slow.
- After the evidence-backed diagnosis, fix the problem.

### Acceptance criteria

- Opening the canonical task-scoped `Squad agents` Right Dock still loads the
  exact selected child Session transcript.
- A real selected child-Session transcript change refreshes that transcript.
- Unrelated Conversation tree changes, other child Sessions, TODO-only
  progress, and scroll-only visible-tree churn do not issue another complete
  child-Session request.
- Existing Agent selection, full transcript rendering, follow-lock, manual
  reading position, Agent menu, and task replacement behavior remain intact.
- Focused tests, Overlay typecheck, document-health checks, and a real
  Node-launched Vite browser run with inspected screenshots pass.

### Hard constraints

- Preserve every concurrent worktree change. Do not stash, reset, restore, or
  broadly stage unrelated files.
- Do not restart, refresh, stop, or otherwise interfere with the currently
  running OpenCorvus/Overlay process. Browser acceptance uses an isolated Vite
  fixture.
- Keep the exact task/session backend route and the canonical
  conversation-Agent projection as the single sources. Do not add polling,
  fallback, a duplicate transcript store, a host gate, or a second Dock.
- Playwright browser acceptance must be launched with Node, not Bun.
- The branch is `v0.0.22beta`; new commit subjects use the `dsw-33987` prefix
  and delivery pushes to `myhexin`.

### Evidence captured before implementation

- The packaged `0.0.22-beta` sidecar reached a 1.8 GiB physical footprint and
  a 2.0 GiB peak. Its JavaScript heap grew from 131 MiB to a 1.28 GiB maximum,
  while the machine used 8.3 GiB of 9 GiB swap.
- The sidecar ranged from 3% to 92% CPU. Its paired WebKit GPU and WebContent
  processes consumed about 47% and 21% CPU during an observed burst.
- The two-hour log contained 175,583 records and about 60 MB. Only 18 distinct
  child Sessions produced 20,539 completed
  `/task/:taskID/conversation/session/:sessionID` requests.
- One minute contained 433 completed exact-session transcript requests.
  Individual measured responses were about 66 KB, 414 KB, and 1.01 MB; the
  three most frequently requested Sessions alone caused more than 4 GB of
  repeated JSON serialization, transport, parsing, and projection.
- Same-session requests appeared back-to-back within milliseconds.

### Existing records and architecture read

- `specs/current/architecture/07-panel.md`
- `specs/current/architecture/12-overlay-card-system.md`
- `specs/records/2026-07/2026-07-25-subagent-progress-grid-and-conversation-dock.md`
- `specs/records/2026-07/2026-07-25-subagent-progress-refresh-projection-repair.md`
- `specs/records/2026-07/2026-07-27-subagent-conversation-tab-overflow.md`

### Whole-repository grep

| Owner / call site                                                | Finding                                                                                                                        | Decision                                                                                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `SubagentConversationPanel.tsx`                                  | Sole exact-session Dock resource owner; its request object includes global `cardTreeStore.visibleVersion`.                     | Replace only that broad request dependency with an exact selected-session transcript revision.                                   |
| `main.tsx`                                                       | Sole product mount for the force-mounted `subagent` Dock panel and canonical selected `sessionID`.                             | Preserve.                                                                                                                        |
| `subagent-conversation.ts`                                       | Owns exact task-child and standalone child transcript paths plus strict response projection.                                   | Preserve routes; add one pure revision-key helper based on the canonical selected Agent record.                                  |
| `conversation-agents.ts`                                         | Owns hydrated/live child-Session identity, lifecycle, bounded persisted activity, target message, and target observation time. | Reuse; do not create a second store.                                                                                             |
| `card-tree.ts` / `tree-writer.ts`                                | `visibleVersion` is the correct global scroll/render notification and changes for every visible message/part delta.            | Preserve for Conversation scroll ownership; remove it only from transcript network identity.                                     |
| `Conversation.tsx`                                               | Reads `visibleVersion` to notify the existing scroll controller.                                                               | Preserve.                                                                                                                        |
| `conversation.ts`, `goal-locate.ts`, `ConversationAgentRail.tsx` | Use the same exact-session route for explicit history/location actions.                                                        | Preserve; these are user/navigation reads, not reactive Dock refreshes.                                                          |
| `orchestrator.ts`                                                | Exact-session route reloads transcript, events, task Agent sessions, and a complete projected view on every call.              | Preserve contract; stop invoking it for unrelated global churn.                                                                  |
| `subagent-progress-dock` fixture/browser test                    | Canonical real Vite acceptance currently simulates transcript growth by mutating global `visibleVersion`.                      | Move the fixture signal to the selected canonical Agent record and assert broad visible churn produces zero additional requests. |
| `subagent-conversation-service.test.ts`                          | Covers strict transcript projection and exact route choice.                                                                    | Add revision-key regression cases.                                                                                               |
| current/historical specs                                         | Require one exact selected Session, one canonical conversation-Agent projection, and no duplicate transcript store.            | Preserve and document the narrower reactive contract.                                                                            |

### Independent Agent feedback

- None. The user did not request independent or parallel Agent review, so no
  sub-Agent was delegated.

## Causal chain

1. Every visible Conversation mutation calls
   `markCardTreeVisibleChanged()`, including coalesced text deltas and unrelated
   parent/child activity.
2. `SubagentConversationPanel` includes that global counter in its
   `createResource` source.
3. Each counter increment therefore downloads the complete selected child
   Session again.
4. The backend reconstructs the complete transcript, event slice, Agent
   catalog, and projected view; the WebView parses and rerenders it.
5. As the transcript grows, each subsequent event repeats more accumulated
   history. Allocation, garbage collection, logging, WebKit rendering, and
   system swap therefore grow together.

The final slow state is not caused by the `healthy` control-plane response, the
database size, or the idle Browser MCP processes. They are secondary context;
the direct trigger is the global-to-exact-session reactive coupling.

## Implementation

1. Define one pure selected-session transcript revision from the canonical
   Agent record's target message identity, target observation time, lifecycle,
   completion time, and bounded persisted/live activity.
2. Make `SubagentConversationPanel` use a primitive serialized request key
   containing only source identity, selected `sessionID`, directory, and that
   revision. Primitive equality prevents unrelated store writes from
   retriggering `createResource`.
3. Keep `loadSubagentConversation` and both backend routes unchanged.
4. Update the real Vite fixture so persisted transcript growth updates the same
   canonical selected Agent record. Add an explicit visible-tree churn control
   and assert it creates no request while a selected-session change creates
   exactly one.
5. Add focused unit coverage for stable and changing transcript revisions.

## Verification

- `bun test packages/overlay/test/subagent-conversation-service.test.ts
packages/overlay/test/subagent-conversation-autoscroll.test.ts
packages/overlay/test/card-tree-visible-version.test.ts`: 11 passed, 0
  failed.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun test
packages/opencorvus/test/script/historical-docs-links.test.ts
packages/opencorvus/test/script/product-docs-single-source.test.ts`: 30
  passed, 0 failed.
- The Node-launched `subagent-progress-dock` Vite browser acceptance passed
  against the installed isolated Chrome for Testing executable with:
  - request-count regression assertions;
  - selected-session refresh;
  - follow-lock and paused reading position;
  - Agent switching and task replacement;
  - 40 global visible-tree revision increments producing zero transcript
    requests;
  - one persisted unrelated-Session activity revision producing zero transcript
    requests;
  - one persisted selected-Session activity revision producing exactly one
    transcript request.
- The first two runs against the system Chrome reached cleanup and then exposed
  its reproducible five-second `closeBrowser` incompatibility. A run against
  the installed isolated Chrome for Testing removed that toolchain fault and
  exposed an inaccurate fixture signal. The fixture now uses the same bounded
  persisted activity projection as production; the corrected run passed in
  6.8 seconds.
- The implementing Agent inspected
  `.scratch/subagent-conversation-canonical.png`,
  `.scratch/subagent-conversation-tool.png`, and
  `.scratch/subagent-progress-dock.png`. The exact selected transcript,
  primitive Agent selector, expanded Tool surface, refreshed transcript,
  bottom-follow position, and unchanged surrounding grid are visually correct.
- Final formatting, diff review, staged-path audit, commit hooks, and push hooks
  are completed immediately before delivery.
