# Multi-Agent Message Panel Redesign

## Recall

### User Requirements

- Reconsider the message panel from the original message elements instead of merely making the current sparse surface prettier.
- Cover normal conversation, multiple agents, delegated agents, tools, reasoning, patches, artifacts, interactions, streaming, completion, and failure.
- Keep implementation and visual design aligned while iterating through screenshots during the work.

### Acceptance Criteria

- Every agent turn has a persistent, scannable identity and runtime state without requiring hover.
- Narrative content remains the primary reading surface; tool calls, reasoning, patches, and delegated context stay collapsed by default.
- Collapsed execution exposes a meaningful summary, and expanded execution reads as one chronological rail rather than unrelated nested cards.
- Parallel and child agents remain attributable and visually connected to their parent without card-inside-card framing.
- User, agent, running, completed, error, artifact, rich text, embed, question, and steer states retain their existing behavior.
- English and Chinese labels remain complete.
- Real isolated browser screenshots are inspected and revised for at least the representative default, expanded-work, multi-agent, and dark/light states.

### Hard Constraints

- Keep `ChatBubble` as the single owner of top-level message/agent turns and `CardParts` as the single part renderer.
- Do not create fallback renderers, synthetic messages, hidden message streams, or duplicated state.
- Do not restart, refresh, or otherwise interfere with the user's running Overlay process.
- Use Node-based isolated browser verification, targeted tests, typecheck, i18n checks, and build verification.

### Landed Sources Read

- an untracked July planning draft that was read during the original task and is not retained
- `specs/records/2026-07/2026-07-10-overlay-codex-strict-parity-remediation.md`
- `packages/overlay/src/components/ChatBubble.tsx`
- `packages/overlay/src/components/Card.tsx`
- `packages/overlay/src/components/CardParts.tsx`
- `packages/overlay/src/components/AgentSessionReplyBox.tsx`
- `packages/overlay/src/store/card-tree.ts`
- `packages/overlay/src/styles/surfaces/chat-bubble.css`
- `packages/overlay/src/styles/surfaces/messages.css`

### Whole-Repository Call-Site Audit

- `Conversation.tsx` routes top-level `message` and `agent` nodes into `ChatBubble`; all other timeline nodes remain in `Card`.
- `ChatBubble.tsx` invokes `CardParts` for normal, delegated, and child-agent content and owns child recursion and steering.
- `Card.tsx` has two additional `CardParts collapseWorkDetails` call sites for structured non-bubble cards; they must inherit the same execution-summary semantics.
- `CardParts.tsx` is the only classifier for reasoning, tool, patch, subtask, files, embeds, interactions, and delegated context.
- Existing static and browser tests reference `.chat-bubble__hover-toolbar` and generic `transcript.work_details`; those assertions must be replaced with the new persistent identity and execution-summary contract.

### Independent Review

- No new independent-agent review was requested for this redesign. Visual adjudication is based on repeated real screenshots plus the final code/test review; a separate reviewer can be added before acceptance if implementation evidence reveals ambiguity.

## Root Problem

The current panel removed too much structure. Agent identity, state, and actions live in a hover-only absolute toolbar, while every non-narrative event collapses under the same generic label. This makes the transcript calm but unattributed: users cannot scan who acted, what kind of work happened, whether an agent is still running, or how child-agent work relates to the parent.

## Scenario Model

| Scenario | Resting presentation | Expanded presentation |
| --- | --- | --- |
| User turn | Compact authored bubble | Rich text and attachments inline |
| Agent narrative | Persistent identity/status row plus open body | Same; actions appear without moving content |
| Reasoning/tools/patches | Counted execution summary | Chronological vertical execution rail |
| Delegated context | Compact context row | Context body within the same rail language |
| Child agent | Connected branch with its own identity/status | Child narrative and execution rail |
| Parallel agents | Sibling branches with stable identity | Independent expandable execution histories |
| File/embed/artifact | Visible artifact strip/body item | Native preview or iframe/embed behavior |
| Interaction/question | Narrative-priority interactive block | Existing response controls |
| Running/error | Persistent semantic state | Latest execution event and error detail |

## Component Direction

`ChatBubble` becomes a conversation turn with four semantic regions: persistent identity, narrative body, artifacts/interactions, and an execution branch. `CardParts` continues to render all part types, but its collapsed work disclosure becomes a count-aware execution summary and its expanded body becomes a timeline. Child agents remain recursive `ChatBubble` instances connected by a branch rail, not framed nested cards.

## Screenshot Iteration

1. Capture the existing representative fixture as a visual baseline.
2. Implement persistent identity and semantic execution summary; capture light default and expanded states.
3. Add child/parallel-agent branch treatment; capture a multi-agent fixture.
4. Review spacing, rhythm, text density, hover/focus, long content, and dark theme; revise and recapture.
5. Record final screenshot paths and verification results here before acceptance.

## Verification Log

- First browser run exposed stale `dist-vite` reuse; those screenshots were rejected and the isolated production bundle was rebuilt before visual acceptance.
- Default light transcript: `packages/overlay/.scratch/overlay-codex-conversation-default.png` verifies persistent identity/status, open narrative, collapsed delegated context, rich embed, and the compact activity summary.
- Expanded execution: `packages/overlay/.scratch/overlay-codex-conversation-work-expanded.png` verifies the reasoning/tool/patch/delegation timeline and led to removal of the remaining framed subtask row.
- Chronological multi-turn transcript: `packages/overlay/.scratch/message-card-chronological-turns-browser/timeline-top.png` verifies user/assistant/orchestrator/architect attribution, running/completed states, delegated context, and adjacent role boundaries.
- Dense and failure states: `packages/overlay/.scratch/agent-compact-visual-stress/03-validation-failure.png` and `07-minimum-layout.png` verify running/completed/error identity, long content, resumed sessions, and minimum legal layout.
- Visual correction after review: user narrative now forms a right-aligned low-contrast bubble so its right-side identity is no longer detached from left-aligned text; agent narrative remains open and unframed.
- Browser tests passed: `chat-bubble-disclosure-button-browser`, `agent-summary-card-browser`, `message-card-chronological-turns-browser`, and `agent-compact-visual-stress`.
- Static verification passed: focused message tests, Overlay TypeScript typecheck, production Vite build, and historical docs link health. The first i18n run correctly rejected dynamic translation-key references; implementation was changed to explicit keys and the retired generic work-details key was removed before final rerun.
