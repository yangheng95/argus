# Task Root Operator Agent Context

## Evidence

- Task `tsk_eac6d76db001bLRjt4zwCLdru2` has root session `ses_153928929ffeGC7AU2S1O6NAU4`.
- The root session has no messages, so `task-api/index.ts::messageContext()` falls through to `Agent.defaultAgent()`.
- `GET /task/:taskID/operator-model-context` therefore returned `agent=coding` and the overlay wrote `agent.coding.model=kimik26/kimik26`.
- The running workflow child was `frontend-design`, whose model resolver correctly read `agent.frontend-design.model` and stayed on `hexin/cy-claude-sonnet-4-6`.
- Two `frontend-design` sessions were not simultaneous active LLM calls: the first failed with `AI_InvalidToolInputError` on empty `write` input, then orchestrator started a new frontend-design session.

## Call Points

| Call point | Current behavior | Change |
| --- | --- | --- |
| `packages/opencorvus/src/task-api/index.ts::messageContext` | Root task sessions with no history fall back to default visible agent (`coding`). | Engine task root operator messages resolve to `orchestrator` as the task control owner. |
| `packages/opencorvus/src/task-api/index.ts::appendTaskSessionMessage` | Persists operator messages using `messageContext`. | Inherits the corrected root operator agent. |
| `packages/opencorvus/src/task-api/index.ts::getTaskOperatorModelContext` | Exposes the same incorrect fallback to overlay. | Exposes `orchestrator` for task root contexts without prior root messages. |
| `packages/overlay/src/components/ExecutorSelector.tsx` | Writes whatever backend context returns. | No frontend change; backend remains the single source. |
| `packages/overlay/src/components/settings/AgentModelsPanel.tsx` | Full per-agent settings already writes explicit agent overrides. | No change. |

## Acceptance

- A workflow task whose root session has no messages reports `agent=orchestrator` from `/task/:taskID/operator-model-context`.
- Posting a task-level operator message to such a task persists the user message with `agent=orchestrator`.
- Existing behavior for agent-owned child sessions and direct agent replies is unchanged.
