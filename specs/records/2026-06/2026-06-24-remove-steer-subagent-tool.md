# 2026-06-24 Remove steer_subagent Tool

## User Request

Delete the `steer_agent` tool related logic and code. Repository search shows no `steer_agent` literal; the current shipped steering tool surface is `steer_subagent`.

## Existing Evidence

Full-repository search before this plan:

| Surface                    | Current references                                                                                                        | Action                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Tool implementation        | `packages/opencorvus/src/orchestrator/tools.ts::steer_subagent`                                                           | Delete the tool entry entirely.                                                               |
| Shared target resolver     | `packages/opencorvus/src/orchestrator/tools.ts::resolveSteerTarget`                                                       | Keep behavior for `cancel_subagent`, rename to remove steer semantics, and update error text. |
| Decision-control set       | `packages/opencorvus/src/orchestrator/tools.ts` contains `"steer_subagent"`                                               | Remove.                                                                                       |
| Orchestrator visible tools | `packages/opencorvus/src/agent/tool-pool-contract.ts` contains `"steer_subagent"`                                         | Remove from the orchestrator private tool list.                                               |
| Orchestrator prompt        | `packages/opencorvus/src/prompt/core/orchestrator-core.txt` teaches `steer_subagent`                                      | Remove steering instructions; keep `cancel_subagent` recovery guidance.                       |
| Active architecture docs   | `specs/current/architecture/01-agents.md`, `specs/current/architecture/13-agent-communication-matrix.md` list `steer_subagent` as current surface | Update current-surface docs. Historical dated specs remain historical evidence.               |
| Agent visibility tests     | `packages/opencorvus/test/agent/agent.test.ts` expects visibility                                                         | Assert absence.                                                                               |
| Tool description tests     | `packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts` reads steer schema/description             | Remove steer assertions and keep cancel schema coverage.                                      |
| Tool behavior tests        | `packages/opencorvus/test/orchestrator/tools.test.ts` contains four `steer_subagent` behavior tests                       | Replace with absence assertions for the generated orchestrator tools.                         |

## Implementation Rules

- Do not introduce a replacement probe or direct-reply fallback.
- Do not keep compatibility aliases for `steer_agent` or `steer_subagent`.
- Do not remove UI/operator-message build guidance in overlay; that is not the orchestrator tool surface and uses task-root messages.
- Keep `cancel_subagent` resolving `session_id`, `goal_id`, and `goal_run_id`.

## Acceptance

- `rg -n "steer_agent|steer_subagent" packages/opencorvus/src packages/opencorvus/test` has no matches.
- Targeted tests pass:
  - `bun test packages/opencorvus/test/agent/agent.test.ts --test-name-pattern "orchestrator"`
  - `bun test packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts`
  - `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "steer_subagent|cancel_subagent|orchestrator tools do not expose removed steering"`
- Final review confirms no steering tool logic remains in active source/tests.
