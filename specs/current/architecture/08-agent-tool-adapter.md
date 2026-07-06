# 08 — Agent Tool Pool Contract

> 当前真源：`packages/opencorvus/src/agent/tool-pool-contract.ts`、`packages/opencorvus/src/agent/agent.ts`、`packages/opencorvus/src/tool/registry.ts`、`packages/opencorvus/src/agent/filter-tools.ts`。

## Current Contract

Every agent receives a canonical `AgentToolPool` assignment. The assignment has two explicit lists:

- `global`: tool IDs provided by the shared global registry.
- `private`: agent-scoped tool IDs loaded by `AgentToolPool.privateRegistryTools(...)`.

`ToolRegistry.tools(model, agent, config)` is the single runtime filter. It loads global tools, appends the agent private tools, computes `AgentToolPool.visibleToolIDs(agent.tools)`, and removes every tool ID outside that set before model-specific `apply_patch` / `edit` selection and optional batch tool injection.

There is no runtime permission-deny adapter standing in for tool visibility. `permission` still controls execution policy for primary sessions, while `AgentToolPool` controls what the model can see.

## Built-In Agent Ownership

Built-in agents are registered in `Agent.buildState(...)` with `tools: AgentToolPool.assignment(<role>)`. Their tool pools are not configurable through `opencorvus.jsonc`; `config.agent.<built-in>.tools` throws because the canonical pool is the single source for built-in visibility.

Custom agents use `AgentToolPool.customDefault()` unless their config supplies a normalized `ToolPoolAssignment`. The custom default excludes scheduler/control-plane tools such as `panel`, `request_orchestrator_decision`, and `wait`; explicit custom assignments reject the same scoped orchestration tools. Custom workers must not receive lifecycle or orchestration control. Custom assignments use the same `global` / `private` shape as built-ins.

## Role Pools

| Role                                                                    | Tool-pool source                      | Current behavior                                                                                                                                                                                               |
| ----------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coding`                                                                | `roleAssignments.coding`              | Full coding surface plus web-clone private tools.                                                                                                                                                              |
| `coding-assistant`                                                      | `roleAssignments["coding-assistant"]` | Coding surface plus `panel` for the right-sidebar assistant.                                                                                                                                                   |
| `build`                                                                 | `roleAssignments.build`               | Task coding surface, `request_orchestrator_decision`, browser-preview comparison private tools, and default runtime switches that disable broad delegation/research tools until explicitly enabled by runtime. |
| `visual-qa`                                                             | `VISUAL_QA_STATIC_TOOL_IDS`           | Visual QA evidence and repair surface.                                                                                                                                                                         |
| `general`                                                               | `roleAssignments.general`             | General subagent coding/research surface plus web-clone private tools; self-recursion is denied by permission policy.                                                                                          |
| `explore`                                                               | `roleAssignments.explore`             | Read/search/web/panel/memory exploration surface plus `request_orchestrator_decision`.                                                                                                                         |
| `compaction`, `title`, `summary`                                        | Empty pools                           | No visible tools.                                                                                                                                                                                              |
| `control`                                                               | `roleAssignments.control`             | `panel` only.                                                                                                                                                                                                  |
| `mission`                                                               | `roleAssignments.mission`             | Mission coordination surface: read/search/web/memory/wait/panel and todo tools, no writer or shell tools.                                                                                                      |
| `orchestrator`                                                          | `roleAssignments.orchestrator`        | Dispatch, review, task-control, observation, user interaction, and bookkeeping tools; executor filesystem/search/write tools are excluded from the visible pool.                                               |
| `requirements`, `architect`, `intent-analysis`, `goal-workload-analyst` | Stage context pools                   | Read/search/list/memory/skill/request-orchestrator-decision plus each role's todo/web additions. Structured output tools are injected by the stage runtime, not by the global registry.                        |
| `frontend-design`                                                       | `FRONTEND_DESIGN_STATIC_TOOL_IDS`     | The only frontend-design source and webpage evidence ownership surface.                                                                                                                                        |
| `integrity`                                                             | `INTEGRITY_DECLARED_TOOL_IDS`         | Preview repair tools plus canonical `skill`; verdict and acceptance tools are injected for each integrity run.                                                                                                 |
| `fact-check`, `deep-research`, `frontend-research`                      | Dedicated read/research pools         | Read-only or research-only specialist surfaces.                                                                                                                                                                |

## Registry Flow

1. `ToolRegistry.all()` loads shared built-in global tools plus configured plugin/custom tools. Custom and plugin tools must have unique non-canonical IDs; they may not shadow built-in global or private OpenCorvus tool IDs.
2. If an agent is present, `AgentToolPool.privateRegistryTools(agent.name, agent.tools)` loads private tools whose IDs are visible in the assignment.
3. The combined list is filtered by `AgentToolPool.visibleToolIDs(agent.tools)`.
4. `apply_patch` versus `edit` / `write` is selected from the model ID.
5. The batch tool is added only when `experimental.batch_tool === true` and the agent pool includes `batch`.

This flow means tool visibility is deterministic and inspectable from `tool-pool-contract.ts`; prompts and permissions cannot create a second visible-tool source.

## Runtime Switches And Permissions

`AgentToolPool.defaultRuntimeToolSwitches(role)` is a runtime UI/tool-switch contract, not a second registry. The build role uses it to start selected broad tools disabled while keeping the canonical assignment explicit.

Permission rules remain separate:

- non-design primary agents deny webpage evidence execution through permission rules even if a custom configuration changes execution policy;
- `visual-qa` denies retired visual evidence tools while allowing its current analysis tools;
- `general` denies recursive `task` dispatch to itself.

## Verification

The tool-pool contract is covered by:

- `packages/opencorvus/test/agent/runner-tool-scope.test.ts`
- `packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts`
- `packages/opencorvus/test/agent/core-prompt-hygiene.test.ts`
- `packages/opencorvus/test/script/document-health.test.ts`

Document health rejects stale current-architecture text that reintroduces retired tool names or old adapter shapes.
