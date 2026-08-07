# Conversation Card Status Dot Retirement

Date: 2026-08-04

UI means User Interface. CSS means Cascading Style Sheets.

## Recall

| Item                    | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request            | The supplied desktop screenshot marks the green point between the Conversation card title `CHAT` and its duration. The user requires that point to be hidden.                                                                                                                                                                                                                                            |
| Acceptance              | Top-level Conversation cards and compact nested Agent identity rows no longer mount the lifecycle status point. Title, duration, error indicator, avatar, timestamp, actions, card status data, and all status indicators outside Conversation card identity rows remain unchanged.                                                                                                                      |
| Hard constraints        | Remove the obsolete renderer instead of hiding it with CSS. Do not add fallback, duplicate status ownership, UI automated tests, fixtures, screenshot baselines, or mobile and responsive scope. Do not alter or restart the user's running OpenCorvus or Overlay process.                                                                                                                               |
| Sources read            | `AGENTS.md`; `CLAUDE.md`; supplied screenshot; `specs/records/2026-07/2026-07-30-conversation-running-dot-and-hover-time.md`; `specs/records/2026-08/2026-08-04-conversation-error-indicator-title-adjacency.md`; `ChatBubble.tsx`; `Conversation.tsx`; `StatusIndicator.tsx`; `chat-bubble.css`; Overlay and root `package.json` files.                                                                 |
| Whole-repository search | `chat-bubble__status` has one JSX mount in `ChatBubbleIdentity` and one dedicated CSS rule. `ChatBubbleIdentity` has one compact nested-Agent call site and two mutually exclusive top-level header call sites. Other `StatusIndicator` mounts belong to the Conversation empty state, Application shell, Sub-agent panel, Board, and Work Ledger surfaces and are outside the marked card-title target. |
| Independent review      | Claude Code CLI 2.1.147 was invoked read-only with only `Read,Grep,Glob`, but authentication failed before inspection with `Not logged in`; its terminal result reported `is_error: true`. No independent conclusion is claimed, and the primary Agent retains implementation and second-review responsibility.                                                                                          |
| Git baseline            | Branch `work-v0.0.29beta-yr-0803` was clean at `9c7bb6626f38aeef41dc10d2d1ac4815728656f7`, equal to `legacy-remote/work-v0.0.29beta-yr-0803`, before this plan.                                                                                                                                                                                                                                                |

## Causal Chain

1. `ChatBubbleIdentity` unconditionally mounts a dot-appearance `StatusIndicator`
   between the identity title and duration for every non-error Conversation identity.
2. The same identity component is the single owner for both top-level cards and
   compact nested Agent rows, so local CSS hiding would preserve dead interactive
   and accessible structure.
3. Removing the renderer from that shared identity component removes the marked
   point at its source while preserving independent status projections elsewhere.
4. The now-unreferenced `chat-bubble__status` size rule must be deleted with the
   renderer so no obsolete card-specific styling remains.

## Call-Site Disposition

| Owner / call site                                   | Decision                                                                                                                   |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `ChatBubbleIdentity` status derivation and renderer | Delete the local status label derivation and `StatusIndicator` mount.                                                      |
| Compact nested Agent identity                       | Consume the same point-free identity component; preserve avatar status, title, duration, and adjacent error indication.    |
| Top-level static and disclosure headers             | Consume the same point-free identity component; preserve the existing title, duration, collapse behavior, and error order. |
| `chat-bubble__status` CSS rule                      | Delete because no production owner remains.                                                                                |
| Other `StatusIndicator` call sites                  | Keep unchanged because they represent empty-state, shell, Sub-agent, Board, or Work Ledger status rather than card chrome. |
| UI tests                                            | Do not add, modify, update, or run.                                                                                        |

## Implementation And Verification Plan

1. Commit and push this plan before editing product code.
2. Remove the shared Conversation identity status point, its unused import and
   status-label derivation, and its dedicated CSS rule.
3. Run Overlay typecheck and Vite production build, document-health and historical
   link checks, and `git diff --check`; do not run UI tests.
4. Start an isolated current-source desktop Vite page without touching the running
   OpenCorvus or Overlay process, open a real Conversation card, capture a screenshot,
   and personally verify that the title flows directly to duration with no point.
5. Re-read the scoped diff and rendered evidence, commit task-owned files with the
   `dsw-33987` prefix, push `legacy-remote`, and verify local and remote equality.

## Verification Evidence

- `bun run --cwd packages/overlay typecheck` passed.
- `bun run --cwd packages/overlay build:vite` passed after transforming 7,071
  modules. Existing third-party module-directive and large-chunk warnings remained
  warnings.
- A headed Node-driven Playwright session operated an isolated current-source Vite
  page at 2368 by 812 pixels without adding or running a UI test. It connected to
  the existing real backend, selected the real Chat titled
  `对话卡片上的这个点不要了，帮我隐藏掉`, and scrolled its canonical
  `#chatScroll` container to the first cards.
- Personal review of `.scratch/conversation-status-dot-removal-top.png` confirmed
  that the first Assistant identity row now paints `CHAT` immediately followed by
  the duration `28s`, with no lifecycle point between them. Avatar, card surface,
  body content, and Composer geometry remained intact.
- The isolated Vite service was terminated by the same foreground Node command.
  The Task created after Browser Preview rejected a context-free publication later
  obtained an execution Session and started its Task-owned service on port 5195.
  After the Task was explicitly cancelled without deleting its record, that exact
  Node Vite listener was identified by command line and stopped by its Windows
  process identifier; ports 5195 and 5196 were then both verified free.
- No UI automated test, fixture, screenshot baseline, query override, local signal,
  or source-file assertion was added, changed, or run.
