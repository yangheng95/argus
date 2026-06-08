# Frontend Agents Skill Tool

## Context

The frontend agents currently cannot load skills through the `skill` tool:

- `frontend-design` static registry include is `FRONTEND_DESIGN_STATIC_TOOL_IDS`, which omits `skill`.
- `frontend-research` registry include is `[]`.
- `SystemPrompt.skills()` only renders the skill policy when the resolved tool surface contains `skill`.
- `SessionLoop.resolveTools()` treats `frontend-design` and `frontend-research` as exact runtime-contract stage agents. Registry tools are skipped for those sessions, so registry include alone does not make `skill` available at model runtime.

## Correction

The initial registry-only change was insufficient. Frontend agents must receive `SkillTool` through their attempt-scoped runtime `toolKit.tools`, because exact stage contracts are the single source of truth for the tools sent to the model. The registry include still documents the static permission surface, but it is not the runtime transport for these two agents.

## Call-Site Inventory

| Surface | Current state | Decision |
| --- | --- | --- |
| `src/agent/agent.ts` `frontend-design.tools.include` | Uses `FRONTEND_DESIGN_STATIC_TOOL_IDS` | Keep `skill` in that static list so the declared permission surface matches the runtime surface. |
| `src/agent/agent.ts` `frontend-research.tools.include` | Empty list | Change to `["skill"]` so `SystemPrompt.skills()` permits frontend-research skill loading while keeping retrieval tools unavailable. |
| `src/frontend-design/static-tools.ts` | Static IDs include `skill`; session IDs initially omitted `skill` | Add `skill` to `FRONTEND_DESIGN_SESSION_TOOL_IDS` and `FRONTEND_DESIGN_UTILITY_TOOL_IDS` because frontend-design sends exact runtime tools. |
| `src/frontend-design/agent.ts` runtime toolKit | Builds implementation/context/webpage/output tools only | Initialize `SkillTool` with the `frontend-design` agent and include it in utility tools. |
| `src/research/agent.ts` `frontend-research` runtime toolKit | With `retrievalTools: "none"`, only output tools are sent | Add `SkillTool` only for `frontend-research`; do not add retrieval tools or change deep-research. |
| `SystemPrompt.skills()` | Requires available tool name `skill` | No code change; this becomes active once the resolved frontend tool surface contains `skill`. |
| `SessionLoop.resolveTools()` | Exact stage contracts skip registry and MCP tools | No code change; add tests proving exact frontend stage contracts preserve runtime `skill` and do not inherit registry/MCP tools. |
| Tests | Pin frontend-design and frontend-research surfaces without runtime skill coverage | Update tests to assert both frontend agents expose runtime `skill`, without reopening websearch/webfetch/read_file for frontend-research. |

## Non-Goals

- Do not add websearch/webfetch/read_file to frontend-research.
- Do not use skill as a substitute for webpage render/evaluate evidence; frontend-design prompt constraints about evidence remain intact.
- Do not add host-side gates or fallback paths.
