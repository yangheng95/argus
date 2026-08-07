# Conversation Agent Divider Retirement

Date: 2026-08-03

UI means User Interface.

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | Remove the unexplained thin line above the pending-thinking and Orchestrator cards shown in the supplied screenshot. |
| Supplied evidence | `/var/folders/bj/6vby7ld11796l5bfdmc7s8l40000gn/T/codex-clipboard-150c3e26-22ae-4dd2-8b1b-a767863b308e.png` shows a one-pixel divider extending beyond the rounded Orchestrator card edge. |
| Acceptance criteria | Pending-thinking and ordinary Agent cards render without the separate top divider; the rounded Agent card retains its own complete border; no second card or transcript boundary owner is introduced; the current real Overlay surface is inspected and captured after the change. |
| Hard constraints | Preserve all unrelated dirty-worktree changes. Do not refresh or restart the running Overlay. Do not add, modify, update, or run UI automation tests. Delete the existing UI-only divider test encountered in this task. Use the shared rounded card border as the single visual boundary. |
| Sources read | Root `AGENTS.md`; Browser control skill; supplied screenshot; `specs/current/architecture/12-overlay-card-system.md`; `2026-07-14-agent-rail-center-and-pinned-project-affordance.md`; `2026-07-31-conversation-pending-thinking-and-empty-stop.md`; current `Conversation.tsx`, `ConversationCard.tsx`, `chat-bubble.ts`, `conversation-agent-boundary.ts`, `conversation.css`, and `chat-bubble.css`; introducing commits and line history. |
| Whole-repository grep | `adjacentAgentBoundaryCardIDs()` has one production caller in `Conversation.tsx`; `data-agent-boundary` has one producer there and one CSS consumer in `conversation.css`; `conversation-agent-message-grouping.test.ts` is the sole test consumer. The rounded Agent card already owns its complete border in `chat-bubble.css`. |
| Independent-agent feedback | None. The user did not request sub-agents, so the primary Agent owns implementation and second review. |
| Git baseline | Local `v0.0.29beta` is at `8c801af60b7064e839d194b9a5cc21a713ffc526`. Existing Expert Squad authoring and Composer changes remain outside this task. |

## Causal Chain

1. The July 14 message-grouping change marked the later of two adjacent Agent
   rows when their exact `agentID` values differed and painted a one-pixel
   pseudo-element above that virtual row.
2. The July 28 main-message redesign gave every Agent bubble its own complete
   rounded border, making the older divider a second visual-boundary owner.
3. The July 31 pending lifecycle renderer preserved `kind="agent"` while
   replacing the bubble body with the unboxed thinking row, so the older
   adjacency marker also remained active above pending-thinking.
4. The duplicate paint now reads as a stray line and can extend beyond the
   rounded card edge. The defect is not in the Orchestrator card border or
   screenshot rasterization.

## Call-Site Disposition

| Owner / consumer | Decision |
| --- | --- |
| `Conversation.tsx` | Remove the adjacency computation, marker prop, and `data-agent-boundary` projection. Keep the virtual transcript as the sole row renderer. |
| `conversation-agent-boundary.ts` | Delete the obsolete UI-only predicate; no runtime or data contract consumes it. |
| `conversation.css` | Delete the pseudo-element divider. Preserve virtual-row sizing and the pending-thinking presentation. |
| `chat-bubble.css` | Preserve the complete rounded Agent card border as the sole card boundary. |
| `conversation-agent-message-grouping.test.ts` | Delete the UI-only divider assertion without running it, as required by the repository UI-test prohibition. |
| Current architecture | Record that Agent-owner transitions do not add a second divider above the rounded card or pending row. |

## Implementation And Verification Plan

1. Commit and push this Recall before product edits.
2. Remove the obsolete divider implementation, helper, and UI-only test.
3. Update the current Overlay card architecture.
4. Run Overlay typecheck, production Vite build, required document-health
   checks, exact owner grep, and `git diff --check`; do not run UI tests.
5. Inspect the existing real Overlay page through Browser control, capture the
   affected Conversation region, and personally verify the stray line is gone
   while card borders remain complete.
6. Re-read the exact diff and rendered evidence, update this record with the
   result, commit only task-owned paths, fetch/reconcile legacy remote, and push
   `v0.0.29beta`.

## Progress

- [x] Screenshot, source, history, affected callers, current architecture, and
  dirty-worktree boundaries inspected.
- [x] Recall committed; the first legacy remote push was correctly rejected because
  concurrent Orchestrator and Expert Squad edits had not yet restored their
  type contracts.
- [x] Obsolete divider implementation and UI-only test removed.
- [x] Non-UI verification and real-page visual acceptance completed.
- [x] Second review, final implementation commit, reconciliation, and legacy remote
  push completed.

## Verification Evidence

- `bun run typecheck` in `packages/overlay`: passed.
- `bun run build:vite` in `packages/overlay`: passed. Existing third-party
  module-directive and large-chunk notices remained warnings.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 2
  document-index contracts passed.
- Exact owner grep found no production `adjacentAgentBoundaryCardIDs`,
  `data-agent-boundary`, `conversation-agent-boundary`, or
  `conversation-agent-message-grouping` reference. Historical names remain
  only in this Recall.
- Task-scoped `git diff --check`: passed.
- A Node-launched current-source Vite page connected to the already-running
  production sidecar on port 7878 without refreshing or restarting that
  process. The existing Conversation rendered its real persisted User and
  Agent cards.
- Browser inspection found zero `[data-agent-boundary]` elements. The real
  Agent bubble retained `border-top: 1px solid` and `border-radius: 12px`;
  its virtual row `::before` computed to `content: none` and `height: auto`.
  The inspected screenshot showed the complete rounded card edge with no
  protruding top divider. Browser warnings and errors: zero.
- Final implementation commit: `5a35e1daa56930f604ac056559625e9ad8fcb8fd`.
  The legacy remote pre-push hook passed SDK imports, AI runtime ownership, all-package
  typecheck, route inventory, API documentation, Overlay localization, and
  secret scan before updating `legacy-remote/v0.0.29beta`.
