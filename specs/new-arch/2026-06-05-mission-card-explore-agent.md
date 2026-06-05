# Mission Card And Explore Agent Fix

## Problem

Mission standalone sessions store user wake messages and Mission assistant messages in the same `sessionID`. The overlay tree writer regrouped non-phase timelines by `sessionID`, so the first user turn claimed the whole mission transcript and Mission output rendered inside the user message card.

Mission also needed a read-only Explore path that can inspect project/task state without giving Mission general subagent dispatch or giving Explore panel mutations.

## Call Points Checked

| Surface | Decision |
| --- | --- |
| `packages/overlay/src/services/tree-writer.ts` `regroupTimelineSegments` | Split non-phase segments by `sessionID + stage`, preserving one card per semantic speaker in a shared standalone session. |
| `packages/opencorvus/src/protocol/session-mirror.ts` mission transcript stamping | Kept as the single backend source for `channel=main` user turns and `channel=mission` assistant turns. |
| `packages/opencorvus/src/tool/task.ts` subagent session creation | `explore` creates `kind="explore"` sessions; other task subagents keep `kind="assistant"`. |
| `packages/opencorvus/src/agent/agent.ts` Mission tools | Mission includes `task` but permission allows only `task/explore`; other subagent targets are denied. |
| `packages/opencorvus/src/panel/capability.ts` and `packages/opencorvus/src/tool/panel.ts` | Explore is a first-class panel actor with query-only panel actions. |

## Verification

- `bun test packages/overlay/test/tree-writer-hierarchy.test.ts`
- `bun test packages/opencorvus/test/agent/role-contract.test.ts packages/opencorvus/test/tool/task.test.ts packages/opencorvus/test/tool/panel.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/overlay typecheck`
- `bun run api:routes-check`
