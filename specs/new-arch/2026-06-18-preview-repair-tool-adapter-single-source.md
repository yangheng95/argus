# Preview Repair Tool Adapter Single Source - 2026-06-18

## Acronyms

- AI: Artificial Intelligence, the model-facing tool caller.
- SDK: Software Development Kit, the `ai` package tool wrapper API used by agent sessions.
- QA: Quality Assurance, the visual review agent surface.
- ID: Identifier, a stable tool or artifact key.

## Problem

`browser_preview_bind_local_module` and `browser_preview_compare_regions` are
registered `Tool.define` tools, but stage-agent runtimes can still drift when
each agent writes its own `Tool.Info -> ai.tool` adapter. The current risk is
highest in integrity because its runtime `createSingleSessionIntegrityToolKit`
is hand-built, while `Agent.get("integrity").tools.include` is a separate
static whitelist.

The repair toolchain must have one definition source:

- `Tool.define` owns tool ID, description, parameters, and execution.
- Stage-agent AI SDK adapters call `Tool.Info.init()` and copy those initialized
  values directly.
- Static whitelists and runtime tool kits derive preview IDs from the same
  local tool-info list.

## Recall

- `08-agent-tool-adapter.md` says stage agents such as `frontend-design`,
  `visual-qa`, and `integrity` go through `ToolRegistry`, while orchestrator
  workflow tools are a separate self-built dispatch/control surface.
- `2026-06-16-local-module-source-binding.md` introduces
  `browser_preview_bind_local_module` as the source/local binding step before
  `browser_preview_compare_regions`.
- `2026-06-17-browser-preview-region-runner-single-source.md` keeps region
  comparison capture owned by task-scoped target/evidence runner state, not a
  direct URL or output-directory input.
- `2026-06-17-browser-preview-strict-request-schema.md` requires preview
  request schemas to reject stale direct evidence fields instead of stripping
  them.

## Grep Inventory

Command set:

```powershell
rg -n "initialized\.execute|inputSchema:\s*initialized\.parameters|Tool\.Info|BrowserPreviewToolParameters|browser_preview_bind_local_module|browser_preview_compare_regions|ToolRegistry\.tools|tools:\s*\{\s*include" packages/opencorvus/src packages/opencorvus/test -g "*.ts"
rg -n "create[A-Za-z0-9_]*Tool\b|create[A-Za-z0-9_]*Tools\b|tool\(\{\s*description|inputSchema:\s*|execute:\s*async" packages/opencorvus/src packages/opencorvus/test -g "*.ts"
rg -n "browser_preview|BrowserPreviewTool|BrowserPreviewBindLocalModuleTool|BrowserPreviewCompareRegionsTool|INTEGRITY_PREVIEW_TOOL|VISUAL_QA_STATIC_TOOL|FRONTEND_DESIGN_STATIC_TOOL" packages/opencorvus/src packages/opencorvus/test -g "*.ts"
```

| Surface | Finding | Decision |
| --- | --- | --- |
| `src/tool/registry.ts` | Registers `browser_preview`, `browser_preview_bind_local_module`, and `browser_preview_compare_regions`. | Keep registry as the public tool definition surface. |
| `src/agent/agent.ts` visual-qa | Whitelist uses `VISUAL_QA_STATIC_TOOL_IDS`, which includes all three preview tools. | Keep; test runtime matches this static contract. |
| `src/visual-qa/agent.ts` | Local `createVisualQaTool` copies initialized description/schema/execute. | Replace with one shared `Tool.Info` AI SDK adapter. |
| `src/integrity/static-tools.ts` | `INTEGRITY_PREVIEW_TOOL_INFOS` is the intended single source for integrity preview IDs. | Keep; use it for whitelist tests and runtime construction. |
| `src/integrity/team-agent.ts` | Local `createIntegrityTool` duplicates the same adapter shape. | Replace with the shared adapter. |
| `src/frontend-design/agent.ts` | Local `createFrontendTool` duplicates the adapter and adds process-trace hooks. | Replace only the common adapter core; keep trace hooks as callbacks. |
| `src/research/agent.ts` | Local `createResearchTool` duplicates the adapter for `skill`. | Replace with the shared adapter. |
| `src/orchestrator/tools.ts` | Orchestrator exposes only `browser_preview`, but manually repeats the preview tool description and imports `BrowserPreviewToolParameters`. | Keep orchestrator free of bind/compare; move the preview startup schema/description reference to a single static export from the tool module because the orchestrator tool factory is synchronous. |
| `src/orchestrator/webpage-evidence.ts` | Host-prepared webpage evidence calls `Tool.Info.init().execute()` outside an AI SDK tool surface. | Leave as a direct host operation, not a model-visible adapter. |

## Fix

1. Add a small shared adapter that converts a `Tool.Info` into an AI SDK tool by
   calling `Tool.Info.init()` once and using initialized `description`,
   `parameters`, and `execute`.
2. Require real session/message execution identity from `SessionLoop` for
   model-visible stage tools; do not silently use empty IDs.
3. Replace the duplicated visual-qa, integrity, frontend-design, and research
   adapters with the shared helper.
4. Move orchestrator `browser_preview` description/schema references to the
   browser-preview tool module so the synchronous orchestrator factory no
   longer carries hand-written copies. Do not add bind/compare to orchestrator.
5. Strengthen tests so registry definitions, agent whitelists, and runtime tool
   kits agree for preview repair tools.

## Acceptance

- `Agent.get("integrity").tools.include`, `INTEGRITY_PREVIEW_TOOL_IDS`, and the
  task-backed integrity runtime preview tool keys agree.
- Non-task integrity runtime does not expose task-scoped preview tools.
- Integrity runtime preview tools use the same initialized descriptions and
  schemas as their `Tool.define` sources.
- Visual QA runtime exposes `browser_preview`,
  `browser_preview_bind_local_module`, and `browser_preview_compare_regions`.
- Orchestrator exposes `browser_preview` only, never bind/compare.
- Required targeted tests and `bun run --cwd packages/opencorvus typecheck`
  pass.
