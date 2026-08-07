# Agent Card Goal Marker

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | Add a Goal marker such as `#G1` above each goal-owned Agent card. The supplied 1836×426 screenshot shows a `mirror-prd-author` card with no Goal ownership marker above its border. |
| Acceptance criteria | A goal-owned top-level Agent card shows the canonical compact Goal label above the card; the marker is visually associated with the card without entering the Agent identity/title row; goal-less and user cards gain no marker or empty spacing; compact nested/structured Agent surfaces retain their existing density; the real isolated page is rendered with Node-launched Playwright, screenshot, and manual visual review. |
| Hard constraints | Preserve `CardNode.goalID` as the durable card-to-Goal relation and `boardStore.board.goals` as the sole Goal ordinal/retry metadata source. Reuse `goalCompactLabelForGoalID` and the shared `Badge` primitive. Do not infer Goal identity from Agent names, titles, Session identifiers, or workflow-node names. Do not add a fallback catalog, compatibility path, UI-only fake label, gate, state machine, or hard-coded `#G1`. Do not refresh, restart, close, or otherwise manipulate the running OpenCorvus/Overlay. Commit subjects begin with `dsw-33987`; delivery is pushed to `legacy-remote`. |
| Existing dirty worktree | Before this request, the shared worktree already contained concurrent edits in `ChatBubble.tsx`, `chat-bubble.css`, conversation/ledger/UI tests, i18n, architecture docs, and July indexes/records. Preserve those edits, patch overlapping files surgically, and stage only this task's hunks. The pre-change branch/remote baseline converged at `f3c1b389485cae72a8cd4dadd389554f9113e246` after the full pre-push hook passed; the initial push race was resolved by fetching the concurrently advanced remote without force or history rewriting. |
| Sources read | `AGENTS.md`; Browser skill; supplied screenshot at original resolution; `specs/current/architecture/12-overlay-card-system.md`; `specs/current/architecture/15-agent-facts-and-turns.md`; `specs/records/2026-07/2026-07-22-conversation-card-goal-identifier.md`; `ChatBubble.tsx`; `ConversationGoalBadge.tsx`; `CardHeader.tsx`; `Card.tsx`; `card-tree.ts`; `goal-label.ts`; `tree-writer.ts`; badge/chat-bubble CSS; focused unit and browser tests; Mirror Prism manifest goal dispatch contracts. |
| Whole-repository grep | `ConversationGoalBadge` has exactly two production mounts: `ChatBubbleIdentity` and `CardHeader`; it is backed only by `goalCompactLabelForGoalID(boardStore.board.goals, goalID)`. `ChatBubble` is the sole top-level `message`/`agent` renderer through `ConversationCard`; structured/nested cards use `CardHeader`. `CardNode.goalID` is populated only by the `tree-writer` message/Session projection. `mirror-prd-author` is explicitly `dispatch_scope: "goal"` in both Mirror Prism workflows. Existing regression owners are `chat-bubble.test.ts`, `card-header-title.test.ts`, `goal-label.test.ts`, and `browser/conversation-goal-identifier-browser.test.ts`. |
| Independent Agent feedback | None. The user did not request sub-agents, and the active collaboration policy forbids unrequested delegation. |

## Causal analysis

The observable defect is not the absence of a Goal-label formatter or primitive: the July 22 implementation already added both. Its mount is inside `ChatBubbleIdentity`, immediately after the Agent title. That satisfies title correlation but cannot produce the newly requested card-level marker above the border. The supplied screenshot therefore has no separate visual ownership layer even when the card carries a resolvable `goalID`.

The direct trigger is the render hierarchy: `ChatBubble` creates `chat-bubble-shell > chat-bubble > identity-row`, and the badge exists only inside `identity-row`. The deeper cause is that the earlier requirement was modelled as title metadata, while this request specifies card ownership placement. The earlier browser test proves title/badge/status horizontal order and vertical centering; it does not assert an above-card sibling, marker-to-card geometry, or absence of empty marker spacing. Repeating the inline mount, hard-coding `#G1`, or guessing from `mirror-prd-author` would leave the placement or identity source wrong.

The running database exposed by the current local sidecar was inspected read-only and contains no `mirror-prd-author` Session/message matching the supplied screenshot, so it cannot prove whether that screenshot's remote/historical card carried `goalID`. This unknown is kept explicit. The implementation remains bound to the canonical `CardNode.goalID` plus current TaskBoard Goal projection and does not invent a label when that relation is absent.

## Plan

1. Extend `ConversationGoalBadge` with an explicit presentation placement while retaining its single Goal lookup and shared `Badge` owner.
2. Move the top-level `ChatBubble` badge from the identity row to a sibling immediately above the Agent card inside `chat-bubble-shell`. Keep compact nested identity and structured `CardHeader` badges inline because those are embedded summaries rather than the full top-level card shown in the request.
3. Add marker geometry to `chat-bubble.css` using existing spacing, typography, radius, and color tokens. The shell must collapse naturally when the badge emits no DOM so user and goal-less cards acquire no blank row.
4. Update focused source tests and the existing real agent-card browser fixture to assert DOM ownership, exact Goal labels, goal-less absence, marker-above-card geometry, left alignment, and retained nested/structured inline ownership.
5. Run focused unit tests, Overlay typecheck/build, the Node browser test, inspect the emitted screenshot, iterate on visual defects, run spec/document health and `git diff --check`, then perform a second exact-diff review.

## Validation targets

```sh
bun test packages/overlay/test/goal-label.test.ts packages/overlay/test/chat-bubble.test.ts packages/overlay/test/card-header-title.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay build:vite
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-goal-identifier-browser.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts
git diff --check
```

## Implementation and verification

- `ConversationGoalBadge` remains the single TaskBoard-to-label projection and
  now exposes an explicit `inline` / `card-marker` presentation. Card markers
  use the shared `Badge` primitive's `md` / `accent` variant; embedded inline
  ownership remains `sm` / `neutral`.
- `ChatBubble` renders the card marker as the first
  `chat-bubble-shell` child, before the top-level Agent card. The identity-row
  mount is retained only for compact embedded Agent summaries; structured
  Agent headers continue to consume the same component's default inline
  presentation.
- The shell is a content-sized column with a tokenized gap. When the canonical
  Goal lookup returns no label, the badge emits no DOM and flex `gap` reserves
  no empty row. The browser regression proves this for a goal-less Agent and
  separately proves user cards have zero Goal-badge descendants.
- Focused source/unit validation passed: 14 tests, 0 failures, 186 assertions.
  Overlay TypeScript and the production Vite build passed.
- The Node-launched focused browser test passed after the final geometry
  assertions. It proves exact labels, shared primitive ownership, marker
  placement/tone/size, marker-above-border geometry, left inset, no top-level
  inline duplicate, goal-less shell collapse, and user-card absence. The dark
  screenshot at `.scratch/conversation-goal-identifier.png` was inspected
  directly. The first neutral/small visual pass was rejected as too weak; the
  final medium/accent marker is legible and spatially attached to the card.
- Historical-document link validation passed. The first combined document
  health run had one repository-state failure because concurrently indexed
  July records were still untracked; none of those links or records belongs to
  this task. The exact document-health command is rerun after the concurrent
  commits settle rather than treating that failure as acceptance.
- The running OpenCorvus/Overlay and browser sidecars were never refreshed,
  restarted, stopped, closed, or otherwise manipulated.

## Second review

The requested marker has one durable relation (`CardNode.goalID`), one ordinal
metadata source (`TaskBoard.goals`), one formatter, and one badge primitive.
There is no hard-coded `#G1`, Agent-name inference, alternate Goal catalog,
empty placeholder row, or top-level duplicate. The marker is a sibling above
the card rather than title text, while compact embedded surfaces preserve their
existing density. The final dark screenshot matches the requested visual
hierarchy and the goal-less negative case remains unchanged.
