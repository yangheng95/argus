# Frontend Agents Skill Tool

## Context

The frontend agents currently cannot load skills through the `skill` tool:

- `frontend-design` static registry include is `FRONTEND_DESIGN_STATIC_TOOL_IDS`, which omits `skill`.
- `frontend-research` registry include is `[]`.
- `SystemPrompt.skills()` only renders the skill policy when the resolved tool surface contains `skill`.
- `SessionLoop.resolveTools()` merges registry tools and runtime-contract tools, so adding `skill` to the registry include is enough for skill loading without adding it to submit/output tool kits.

## Call-Site Inventory

| Surface | Current state | Decision |
| --- | --- | --- |
| `src/agent/agent.ts` `frontend-design.tools.include` | Uses `FRONTEND_DESIGN_STATIC_TOOL_IDS` | Add `skill` to that static list so registry resolution exposes SkillTool and skill policy. |
| `src/agent/agent.ts` `frontend-research.tools.include` | Empty list | Change to `["skill"]` so frontend-research can load curated skill instructions while keeping retrieval tools unavailable. |
| `src/frontend-design/static-tools.ts` | Static IDs omit `skill`; session IDs omit `skill` | Add `skill` only to `FRONTEND_DESIGN_STATIC_TOOL_IDS`. Do not add it to `FRONTEND_DESIGN_SESSION_TOOL_IDS` because frontend-design's runtime extra tool kit does not own SkillTool; registry resolution owns it. |
| `SystemPrompt.skills()` | Requires available tool name `skill` | No code change; this becomes active once the resolved frontend tool surface contains `skill`. |
| `SessionLoop.resolveTools()` | Merges registry tools then runtime tools | No code change; this is the existing single source for making registry SkillTool available to the model. |
| Tests | Pin frontend-design and frontend-research surfaces without skill | Update tests to assert both frontend agents expose `skill`, without reopening websearch/webfetch/read_file for frontend-research. |

## Non-Goals

- Do not add websearch/webfetch/read_file to frontend-research.
- Do not use skill as a substitute for webpage render/evaluate evidence; frontend-design prompt constraints about evidence remain intact.
- Do not add host-side gates or fallback paths.
