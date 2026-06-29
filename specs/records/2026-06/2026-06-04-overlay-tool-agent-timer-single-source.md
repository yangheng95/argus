# Overlay Tool And Agent Timer Single Source

Date: 2026-06-04
Status: Implementation plan

## Problem

Overlay duration chips can restart while the same tool or agent is still visible.

The concrete tool-card root cause is in `packages/overlay/src/components/CardParts.tsx`: `toolToCardNode()` promoted an inline tool part into a transient `CardNode` and stamped `time: Date.now()`. Because these cards are transient, any parent update, virtualized remount, or body re-render created a fresh card with a fresh start time.

The agent-card root cause is a server/frontend timestamp double source. `Session.updateMessage()` preserved the SQL `message.time_created` column on conflict but updated JSON `data.time.created` and published the incoming `message.updated` payload unchanged. If a repeated update for the same message id carried a fresh `Date.now()`, overlay received a later `info.time.created`; `tree-writer` then rewrote the existing `CardNode.time`, so the duration chip restarted.

Agent cards already read `CardNode.time`, but the same risk applies to any promoted tool card because `CardHeader` renders duration from `node.time` / `node.timeCompleted`.

## Call-Site Inventory

Grep covered `toolToCardNode`, `CardParts`, `card__duration`, `timeCompleted`, `time.start`, and `state.time`.

| Area                       | File                                                                                                                                                                                                                             | Decision                                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duration renderer          | `packages/overlay/src/components/CardHeader.tsx`                                                                                                                                                                                 | Keep. It already reads `CardNode.time` and `CardNode.timeCompleted` as the single duration source.                                                                  |
| Agent bubble duration      | `packages/overlay/src/components/ChatBubble.tsx`                                                                                                                                                                                 | Keep. It reads the same `CardNode.time` and `CardNode.timeCompleted` fields.                                                                                        |
| Tool promotion             | `packages/overlay/src/components/CardParts.tsx`, `packages/overlay/src/utils/tool-card-node.ts`                                                                                                                                  | Route promotion through one pure helper that reads `part.state.time.start` and `part.state.time.end`.                                                               |
| Tool-state normalizer      | `packages/overlay/src/utils/tool.ts`                                                                                                                                                                                             | Keep. It preserves `state.time` via `{ ...prevState, ...nextState }`; no duplicate time parser needed there.                                                        |
| Backend tool state writers | `packages/opencorvus/src/session/processor.ts`, `packages/opencorvus/src/session/loop.ts`, `packages/opencorvus/src/build/agent.ts`, `packages/opencorvus/src/engine/writer.ts`, `packages/opencorvus/src/orchestrator/tools.ts` | Keep. They already stamp `state.time.start/end`.                                                                                                                    |
| Overlay event bridge       | `packages/overlay/src/services/events.ts`                                                                                                                                                                                        | Keep. It already creates tool state with `time.start` for generated tool deltas.                                                                                    |
| Agent message projection   | `packages/overlay/src/services/tree-writer.ts`                                                                                                                                                                                   | Preserve the first observed `Message.info.time.created` for a message id; later `message.updated` events may update content/usage but not card birth time.          |
| Server message persistence | `packages/opencorvus/src/session/index.ts`                                                                                                                                                                                       | Preserve existing `MessageTable.time_created` across `updateMessage()` / `saveMessage()` and publish the normalized message info, not the incoming drifted payload. |

## Implementation

1. Add a pure `toolToCardNode()` helper under `utils/tool-card-node.ts` so tests can exercise behavior without importing TSX.
2. `toolToCardNode()` sets:
   - `time` from `state.time.start`.
   - `timeCompleted` from `state.time.end` when it is after start.
3. If a tool part lacks `state.time.start`, keep an observation timestamp only as the required `CardNode.time` value. That fallback is not a second timer source for normal tool parts; it is only for malformed or pre-normalized test data.
4. Preserve message-created time at both overlay projection and server persistence boundaries.
5. Add tests that lock this behavior so remount/re-render or repeated `message.updated` cannot regress to `Date.now()`.

## Acceptance

- Tool cards with `state.time.start/end` render duration from those fields, not from mount time.
- Completed tool cards get a stable `timeCompleted`.
- Agent cards keep their original start time across repeated `message.updated`.
- Server `message.updated` bus events keep the persisted message created time.
- Existing duration single-source tests still pass.
