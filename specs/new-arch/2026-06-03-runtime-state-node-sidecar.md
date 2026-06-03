# Runtime State Node Sidecar

## Problem

Overlay benchmark exposed a Windows runtime failure in `frontend_design` webpage
evidence materialization. The failing path is host-owned evidence preparation,
not an LLM tool choice:

| Call point | Decision |
| --- | --- |
| `packages/opencorvus/src/orchestrator/tools.ts` `frontend_design` | Keep. It calls host materialization before the frontend-design agent. |
| `packages/opencorvus/src/orchestrator/webpage-evidence.ts` `ensureLiveWebpageEvidence` | Keep. It remains the single live webpage evidence pipeline. |
| `packages/opencorvus/src/research/webpage-prd-evidence.ts` `prepareWebpagePrdEvidence` | Keep. It reuses the same pipeline for PRD evidence. |
| `packages/opencorvus/src/frontend-design/tools/webpage-runtime-state.ts` | Keep. It continues to call the same runtime-state capture entrypoint. |
| `packages/opencorvus/src/browser/webpage/runtime-state.ts` `captureWebpageRuntimeStateEvidence` | Replace internals. The public entrypoint and artifact contract stay unchanged. |
| `packages/opencorvus/src/browser/runtime/index.ts` `launchPlaywrightBrowser` | Keep for existing MCP/session callers, but remove it from runtime-state evidence capture. |

The benchmark process runs under Bun. On Windows, Bun plus Playwright failed to
launch system Chrome through `remote-debugging-pipe` within the 60 second host
timeout. The same Chrome executable launched successfully through Puppeteer and
through Playwright under Node, so increasing the timeout would only hide the
runtime boundary issue.

## Design

`captureWebpageRuntimeStateEvidence(input)` remains the only public API for
runtime-state evidence. It will execute the browser capture in a host-owned Node
sidecar process and return the same `RuntimeStateEvidence` shape. The sidecar is
not exposed to the LLM as an MCP tool.

This uses the existing `browser-mcp-node` packaging boundary as the single source
for browser Node runtime resolution. The behavior is deterministic replacement:
runtime-state evidence capture uses Node sidecar; it does not try Bun first and
then fall back to Node.

## Tests

- Runtime-state capture writes `interaction-states/*.png` and
  `source-ir/interaction-state-snapshots.json` through the Node sidecar.
- Runtime-state capture no longer calls `BrowserRuntime.launchPlaywrightBrowser`.
- The sidecar runtime resolver prefers packaged `browser-mcp-node/node.exe` and
  packaged Playwright modules when present.
- Sidecar failure modes surface explicit errors for spawn failure, non-zero
  exit, timeout, and invalid JSON.
- MCP serving tests continue to assert webpage evidence/runtime-state tools are not exposed
  as executor MCP tools.
