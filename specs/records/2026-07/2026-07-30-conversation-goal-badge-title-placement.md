# Conversation Goal badge title placement

## Recall

| Item                    | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request            | Move the visible `#G1` shown above the supplied top-level Agent card into the card title area; do not keep a separate Goal marker above the Conversation-flow card.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Acceptance criteria     | A goal-owned top-level Agent card shows the canonical compact Goal label inline with its Agent title; no Goal badge is mounted as a sibling above the card border; goal-less and user cards remain unchanged; compact nested Agent summaries and structured Agent-card headers retain their existing inline Goal identity; the real desktop Overlay is opened, interacted with, screenshotted, and personally reviewed.                                                                                                                                                                                                                                       |
| Hard constraints        | Preserve `CardNode.goalID` as the durable card-to-Goal relation and `boardStore.board.goals` as the only Goal ordinal/retry metadata source. Reuse `goalCompactLabelForGoalID` and the shared `Badge` primitive. Delete the obsolete marker presentation instead of retaining compatibility or a second placement branch. Do not add, modify, update, delete, or run UI automation tests or screenshot baselines. Do not infer Goal identity from Agent names, titles, Session identifiers, or workflow-node names. Do not add a fallback, gate, state machine, or hard-coded `#G1`. Commit subjects begin with `dsw-33987`; delivery is pushed to `legacy-remote`. |
| Supplied evidence       | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-2a99e70c-de4c-4643-9bff-bf779d39fe3f.png` was inspected at original resolution. It shows an accent `#G1` marker on a separate row above the `UNIVERSAL-BUILD` Agent card.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Existing design history | `2026-07-28-agent-card-goal-marker.md` records the exact earlier decision that moved the top-level badge from the title row to a sibling above the border. The current request supersedes only that presentation decision; the canonical Goal join and compact-label projection remain valid.                                                                                                                                                                                                                                                                                                                                                                 |
| Sources read            | Root `AGENTS.md`; Browser control skill; supplied screenshot; `specs/README.md`; `specs/current/architecture/07-panel.md`; `specs/current/architecture/12-overlay-card-system.md`; `2026-07-28-agent-card-goal-marker.md`; current `ChatBubble.tsx`, `CardHeader.tsx`, `ConversationGoalBadge.tsx`, `GoalGroup.tsx`, `goal-label.ts`, `chat-bubble.css`, and Overlay package scripts.                                                                                                                                                                                                                                                                         |
| Whole-repository grep   | Production `ConversationGoalBadge` mounts are limited to `ChatBubbleIdentity`, the top-level `ChatBubble` shell marker, and `CardHeader`. `placement="card-marker"` has one production caller in `ChatBubble.tsx`; its only production style is `.conversation-goal-badge[data-placement="card-marker"]` in `chat-bubble.css`. `GoalGroup` independently renders the full canonical Goal revision in the Goals workbench and is not part of this Conversation-card change. Existing UI assertion and browser-fixture files reference the old marker, but the repository's UI-test prohibition requires leaving them untouched and not running them.           |
| Independent feedback    | Claude Code CLI 2.1.147 was discovered and invoked read-only with only `Read,Grep,Glob`, but authentication failed before inspection (`Not logged in`). No independent conclusion is claimed; Codex retains implementation and second-review responsibility.                                                                                                                                                                                                                                                                                                                                                                                                  |
| Baseline                | The clean branch `work-v0.0.24beta-yr-0729` was fetched from `legacy-remote`; local and branch remote both resolved to `2d4ccae450` with ahead/behind `0/0`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Causal analysis and call-site decisions

The Goal data path is already correct. `ChatBubble` receives the durable
`CardNode.goalID`, and `ConversationGoalBadge` resolves that identity against
the current `TaskBoard.goals` projection before formatting the compact label.
The visible mismatch is caused only by presentation ownership introduced on
2026-07-28: the top-level mount was moved out of `ChatBubbleIdentity` and made a
separate `chat-bubble-shell` child.

The direct repair is therefore to make the full top-level identity use the same
inline badge composition already used by compact nested Agent identities and
structured `CardHeader` Agent cards, then delete the now-unreachable
`card-marker` variant and its CSS. `GoalGroup` stays unchanged because it is the
canonical Goals-workbench disclosure, not a Conversation-flow card.

| Owner / call site            | Decision                                                                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChatBubbleIdentity`         | Render `ConversationGoalBadge` for full and compact Agent identities, immediately after the title and before status/duration chrome.                                             |
| Top-level `ChatBubble` shell | Remove the separate marker sibling above `.chat-bubble`; no empty row or shell gap remains.                                                                                      |
| `ConversationGoalBadge`      | Remove the unused placement prop, accent/medium marker styling branch, and placement data attribute; retain one neutral/small inline projection.                                 |
| `CardHeader`                 | Preserve the existing inline shared badge mount unchanged.                                                                                                                       |
| `GoalGroup`                  | Preserve its full `#GxVy` disclosure identity unchanged.                                                                                                                         |
| `chat-bubble.css`            | Delete the marker-only inset rule; retain all card and identity geometry.                                                                                                        |
| Architecture and indexes     | Replace the superseded top-level marker contract with inline title metadata and register this task record. Historical records remain immutable evidence of the earlier decision. |
| UI tests                     | Do not modify or run them. Their old marker assertions are historical test debt to be handled only by an independently authorized cleanup task.                                  |

## Implementation and validation plan

1. Commit and push this on-disk plan as the pre-change checkpoint.
2. Patch the production component and stylesheet owners, then update the
   canonical card-system architecture text.
3. Run formatting, Overlay TypeScript typecheck, the production Vite build,
   docs checks, the required historical-doc link check, and `git diff --check`.
   Do not run any UI test command.
4. Start the real Overlay through its existing supported runtime, navigate to a
   real goal-owned Agent card, capture a task-bound screenshot, inspect the
   rendered title/badge alignment and absence of the above-border marker, and
   iterate if needed.
5. Review the exact diff and all production call sites a second time, record
   verification evidence here, commit with the required prefix, and push the
   current branch to `legacy-remote`.

## Verification

- `ChatBubbleIdentity` now owns the Goal badge for both full and compact Agent
  identities. The separate `chat-bubble-shell` marker mount, its placement
  branch, and its marker-only CSS were removed.
- The first real-page screenshot was rejected because the narrow right Dock
  forced `universal-build` into a vertical character stack. The identity row
  was corrected so title and duration share the available shrink budget; the
  title now stays on one line with ellipsis instead of wrapping vertically.
- The real Overlay task `Phase 02: 重启反馈洞察完整交付` was opened against the
  installed backend and its persisted database. The real Agent session
  `ses_050ce0129ffeK1GYJecw5zKNCK` resolved Goal
  `gol_faf30de1c001Iv83Ofnx7zcPUK` as `#G1`.
- Final rendered geometry showed exactly one matching Goal badge, parented by
  `.chat-bubble__identity-meta`; the enclosing `.chat-bubble-shell` had zero
  direct Goal-badge children. The title was a horizontal 18-pixel-high line
  with `white-space: nowrap`, `overflow: hidden`, and
  `text-overflow: ellipsis`.
- The focused real-page evidence is
  [2026-07-30-conversation-goal-badge-title-placement.png](../../artifacts/2026-07-30-conversation-goal-badge-title-placement.png).
  It was captured through interactive Node-launched Playwright after the
  in-app Browser rejected the local backend port with
  `ERR_BLOCKED_BY_CLIENT`; the same real backend and task data were exposed
  through Vite's same-origin proxy. No fixture, query override, local signal,
  synthetic card, UI test, screenshot baseline, or automated visual assertion
  was created or used.
- Overlay typecheck and production Vite build passed. Documentation checks,
  historical-document link checks, document-health checks, and whitespace
  validation passed. No UI test file was added, modified, deleted, or run.
- A second production-call-site review found only the inline
  `ChatBubbleIdentity` and `CardHeader` mounts. No production `card-marker`
  placement or marker-only stylesheet rule remains.
