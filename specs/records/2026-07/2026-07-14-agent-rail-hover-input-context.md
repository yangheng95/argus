# Agent Rail Hover Input Context

## Recall

| Item | Detail |
| --- | --- |
| User requirement | Agent Rail 的细线 hover 必须显示内容，并且内容不能只考虑 Agent 输出，还必须考虑用户输入。 |
| Acceptance criteria | Hover/focus on every rail tick opens a real Kobalte tooltip containing agent identity and status; the same Agent Session's latest real user-authored prompt is shown as “User input” and its durable `session.status.summary` is shown as “Agent output”; the tooltip opens into the left whitespace and does not intersect the transcript lane; click-to-locate and stepped tick proximity remain unchanged; hydrate and live message paths preserve the input context; a real desktop screenshot is inspected. |
| Hard constraints | No native `title`, rendered DOM scan, agent-output card-text summary, task-trace polling, second message source, fallback preview, compatibility branch, gate, handwritten popover primitive, mobile/tablet scope, running Overlay refresh/restart, broad Git restore/reset, or new worktree. Preserve unrelated dirty work. Node starts Playwright and the browser runner uses activity-reset inactivity timeout. |
| Sources read | `AGENTS.md`; benchmark-debug and Browser skills; `2026-07-08-conversation-agent-history-left-rail.md`; `2026-07-09-agent-rail-hover-removal.md`; `2026-07-14-agent-rail-center-and-pinned-project-affordance.md`; current server conversation projection/schema/tests; Overlay agent store, live event projection, rail component/CSS/i18n/tests; existing Kobalte tooltip primitive and visual fixture. |
| Whole-repository search evidence | The 2026-07-09 decision deliberately removed the Kobalte tooltip and native title because its right-opening card covered the transcript. `ConversationAgentRail.tsx` still has summary data only for its accessible label. `projectConversationAgentView` owns the durable session projection; `ConversationSessionView.displaySummary` comes only from `session.status.summary`; it does not project user-message text. `conversation-agents.ts` hydrate and live `message.updated` paths explicitly discard user-role messages. Kobalte Tooltip is already the mature shared primitive, while `.card-meta-tooltip` is a generic compact metadata surface. |
| Independent agent feedback | None. The user did not request sub-agents and active policy forbids spawning them otherwise. |

## Root cause and design

This is a contract regression, not a hover hitbox bug. The prior removal deleted
the only hover surface, while leaving the rail as an agent-only status
projection. Restoring the old tooltip verbatim would recreate transcript
occlusion and would still omit the prompt that caused the execution.

Extend the canonical server `ConversationSessionView` with one explicit
`inputPreview` sourced from the latest displayable user-role message in that
session. Preserve that field through hydrate and live `message.updated`
projection into the existing agent record. The component reads only the record:
no rendered-card scan or second fetch. Use Kobalte Tooltip with left placement so
the detail surface occupies the existing left whitespace rather than the
message lane. Input and output sections render only when their authoritative
fields exist; identity and status always render.

## Call-site disposition

| Surface | Disposition |
| --- | --- |
| `packages/opencorvus/src/conversation/view.ts` | Project the latest real user-message preview into its owning Agent Session. |
| `packages/opencorvus/src/engine/model.ts` | Extend the conversation-session schema with the exact input-preview contract. |
| server conversation tests | Prove user text projection and latest-input ownership. |
| `packages/overlay/src/store/conversation-agents.ts` | Preserve input preview through hydrate, live user message, status merge, and source reset. |
| `packages/overlay/src/utils/agent-activity.ts` | Type the canonical record field; do not create another store. |
| `ConversationAgentRail.tsx` and `conversation.css` | Render left-opening Kobalte detail content while retaining Button locate and proximity logic. |
| i18n and focused/browser tests | Add semantic labels and verify real hover/focus content, non-overlap, live/hydrate retention, and screenshot output. |

## Benchmark

- Input: an isolated desktop Overlay fixture containing one Agent Session with
  a real user-role prompt, an agent response, and a durable status summary.
- Output: hovering the session tick reveals user input plus agent output in a
  left-opening tooltip without covering the transcript; the tick still locates
  the response card.
- Environment: Windows host source, repository Vite/TypeScript, Node-driven
  Playwright fixture, no interaction with the user's running Overlay.
- Timeout: activity-reset browser-runner inactivity timeout, not elapsed time
  since process start.
- Pass criteria: focused server/store/component tests, Overlay and server
  typecheck/build, i18n, real hover and keyboard focus assertions, geometric
  non-overlap, task-scoped screenshot review, docs health, diff review,
  selective task commit, and legacy remote push.

## Progress

- [x] Recall historical decisions and current contracts.
- [x] Enumerate server, schema, hydrate, live, component, CSS, i18n, and test call sites.
- [x] Implement the single-source input-context projection and hover surface.
- [x] Run focused and rendered benchmark.
- [x] Inspect screenshots and complete second review.
- [x] Selectively commit and push.

## Verification result

- PASS: 74 focused server projection, Overlay store/component, i18n rendering,
  and owner-surface tests.
- PASS: targeted canonical Agent Rail architecture guard.
- PASS: Overlay, OpenCorvus, and generated SDK TypeScript checks.
- PASS: Overlay i18n contract.
- PASS: generated OpenAPI route inventory and generated SDK synchronization.
- PASS: API docs check, historical docs links, and `git diff --check`.
- PASS: production Vite build through the Node browser runner.
- PASS: `conversation-agent-rail-hover-context-browser.test.ts` verifies real
  user-role input plus durable Agent output on hover and keyboard focus,
  stepped tick geometry, absence of native title, and zero transcript overlap.
- The first browser run failed correctly because Kobalte flipped a 320px
  tooltip into the transcript. The root fix disabled flipping for this
  left-owned surface and reduced its token-scaled width to 280px; two unchanged
  reruns passed.
- Visual review PASS:
  `.scratch/conversation-agent-rail-hover-context/input-output-tooltip.png`
  shows the complete input/output card to the left of the rail while the
  transcript remains unobstructed.
- `document-health.test.ts`: 71/73 passed. The two failures are pre-existing
  dirty-worktree issues outside this repair: the model-catalog health assertion
  expects a removed status field, and the July index links nine other untracked
  records. This task record becomes tracked in the selective commit.

## Second review

- `ConversationSessionView.inputPreview` is sourced only from the latest real
  user-role text message in the owning session; hydrate and live part updates
  converge on the same `AgentActivityRecord.inputPreview` field.
- Agent output remains sourced only from durable `session.status.summary`; no
  rendered output text or task trace is scanned.
- Kobalte Tooltip and the existing Button remain the only interaction owners;
  no native title, custom popper, secondary fetch, or shadow message store was
  introduced.
- Locate, focus, stepped proximity, status color, vertical centering, and the
  five-column message geometry remain intact.
- The retired no-hover browser fixture was replaced rather than retained as a
  contradictory second contract. No other dead or obsolete code was found in
  the touched scope.

## Delivery result

- Functional commit: `e55ee18c2f` (`dsw-33987 restore agent rail hover input context`).
- PASS: legacy remote pre-push SDK import, AI runtime, 11-package monorepo typecheck,
  API route inventory, generated API docs, Overlay i18n, and secret scan.
- `legacy-remote/v0.0.3beta` advanced from `d4f2ff57ab` to `e55ee18c2f` without
  bypassing hooks.
