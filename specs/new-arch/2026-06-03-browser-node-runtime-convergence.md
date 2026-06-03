# Browser Node Runtime Convergence

## Acronyms

- LLM: Large Language Model. The model decides agent actions, but must not own
  deterministic browser evidence materialization.
- MCP: Model Context Protocol. In this document it refers only to the external
  tool protocol/server surface, not to every Node process that hosts browser
  automation.
- PRD: Product Requirements Document. Webpage PRD evidence reuses the same live
  webpage evidence pipeline as frontend design.
- JSON: JavaScript Object Notation. Sidecar calls exchange structured payloads
  and results as JSON over process environment and stdout.

## Context

The runtime-state evidence fix moved
`captureWebpageRuntimeStateEvidence()` from Bun-hosted Playwright launch to a
Node sidecar. That fixed the Windows Chrome launch failure without exposing new
LLM-visible MCP tools. The direction is correct, but the architecture is not yet
clean: three browser evidence callers now contain similar Node sidecar launch
protocols, inline scripts, timeout handling, and JSON parsing.

This spec defines the follow-up convergence work. It is not a new behavior
feature and must not change the agent-visible tool surface.

## Current Inventory

| Area | Current path | Current decision |
| --- | --- | --- |
| Runtime-state evidence | `packages/opencorvus/src/mirror/url/runtime-state.ts` | Keep public entrypoint; move sidecar process mechanics out. |
| Visual render | `packages/opencorvus/src/mirror/visual/render.ts` | Keep screenshot behavior; replace local `renderFilesViaNode` process boilerplate with shared executor. |
| Frontend URL screenshot capture | `packages/opencorvus/src/frontend-design/capture-gate.ts` | Keep visual capture behavior; replace local Node sidecar boilerplate and resolver with shared runtime. |
| Browser Node runtime resolver | `packages/opencorvus/src/browser/runtime/node-sidecar.ts` | Keep and promote as the shared host-only browser Node runtime resolver. |
| Browser MCP launcher | `packages/opencorvus/src/mcp/browser/node-launcher.ts` | Keep MCP-specific `stdio.mjs` bundle resolution; reuse shared Node path logic instead of duplicating it. |
| Packaged runtime payload | `browser-mcp-node/` beside the executable | Keep for now. The name is historical; code should call it browser Node runtime, not MCP runtime, when used outside MCP. |
| Build artifact packaging | `packages/opencorvus/script/build.ts`, `packages/opencorvus/script/build.local.ts` | Keep current payload layout during this convergence. |
| Overlay embedded payload | `packages/overlay/src-tauri/build.rs`, `packages/overlay/src-tauri/src/main.rs` | Do not rename payload entries in this phase. |
| Executor MCP exposure | `packages/opencorvus/src/mcp/serve.ts` | Keep mirror and runtime-state tools hidden from external coding executors. |

## Goals

1. Make browser Node sidecar execution a first-class host-only internal runtime.
2. Remove duplicated process protocol code from runtime-state, visual render,
   and frontend URL screenshot capture.
3. Keep one deterministic browser evidence runtime path per caller. Do not add
   fallback or parallel implementations.
4. Preserve existing artifact contracts:
   - `interaction-states/*.png`
   - `source-ir/interaction-state-snapshots.json`
   - render screenshot output schema
   - frontend capture manifest, screenshot, and DOM artifacts
5. Keep MCP tool exposure unchanged.

## Non-Goals

- Do not expose `webpage_runtime_state`, `webpage_extract`, or other mirror tools
  through executor MCP.
- Do not let the LLM choose between Bun browser launch, Node sidecar launch, or
  MCP browser tools.
- Do not add a Bun-first then Node fallback.
- Do not introduce Puppeteer as a second runtime alongside Playwright.
- Do not rename the packaged `browser-mcp-node/` directory in this phase.
- Do not change page load, settle, screenshot, DOM extraction, or runtime-state
  observation semantics while doing this convergence.

## Proposed Design

### 1. Shared Runtime Resolver

Promote `packages/opencorvus/src/browser/runtime/node-sidecar.ts` into the
single source for browser Node runtime resolution.

Required exports:

```ts
export interface BrowserNodeSidecarRuntime {
  nodeExecutable: string
  playwrightRequirePath: string
  packaged: boolean
}

export async function resolveBrowserNodeSidecarRuntime(input?: {
  execPath?: string
  platform?: NodeJS.Platform
}): Promise<BrowserNodeSidecarRuntime>

export function packagedBrowserNodeRuntimePaths(input?: {
  execPath?: string
  platform?: NodeJS.Platform
}): {
  nodeExecutable: string
  playwrightRequirePath: string
  mcpBundle: string
}
```

The packaged directory remains `browser-mcp-node/` for artifact compatibility,
but callers outside MCP must refer to it as the browser Node runtime.

Packaged rules:

- Packaged executable resolves only sibling packaged Node and packaged
  Playwright modules.
- Packaged executable must not use `OPENCORVUS_BROWSER_MCP_NODE` as a runtime
  escape hatch.
- Bun development runtime may use `OPENCORVUS_BROWSER_MCP_NODE` or `node.exe` /
  `node` plus source Playwright modules.

### 2. Shared Sidecar Executor

Add `packages/opencorvus/src/browser/runtime/node-executor.ts`.

The executor owns:

- spawning the Node executable
- passing base64 JSON input through a caller-named environment variable
- setting `OPENCORVUS_PLAYWRIGHT_REQUIRE_PATH`
- writing inline script to stdin
- collecting stdout and stderr
- hard timeout and abort-signal kill
- invalid JSON and non-zero exit diagnostics

Suggested API:

```ts
export async function runBrowserNodeSidecar<TResult>(input: {
  runtime?: BrowserNodeSidecarRuntime
  script: string
  payload: unknown
  payloadEnvName: string
  hardTimeoutMs: number
  signal?: AbortSignal
  label: string
}): Promise<TResult>
```

The executor should be JSON-shape agnostic. Business callers still validate and
map their own result unions to domain errors.

### 3. Caller Migration

Migration order:

1. `runtime-state.ts`
   - Replace local `spawn`/stdout/stderr/timeout code with
     `runBrowserNodeSidecar`.
   - Keep `NODE_RUNTIME_STATE_SCRIPT` until scripts are moved in a later slice.
   - Keep `captureWebpageRuntimeStateEvidence()` as the only public entrypoint.

2. `render.ts`
   - Replace `renderFilesViaNode` process boilerplate with
     `runBrowserNodeSidecar`.
   - Keep `RenderError` mapping and output schema unchanged.
   - Keep `resolveNodeRenderSidecarRuntime()` as a temporary compatibility
     wrapper only if tests/imports require it; otherwise remove it and update
     callers.

3. `capture-gate.ts`
   - Replace `captureBrowserEvidenceViaNode` process boilerplate with
     `runBrowserNodeSidecar`.
   - Replace `resolveNodeSidecarPlaywrightRequirePath()` with the shared
     resolver.
   - Remove `shouldUseNodeCaptureSidecar()` if the final design is always
     sidecar for browser capture. If an in-process path remains for non-Windows
     runtimes, it must be justified as a single source per runtime family, not a
     fallback.

4. `mcp/browser/node-launcher.ts`
   - Reuse packaged path helpers from the shared resolver.
   - Keep only MCP-specific bundle build/serve concerns here.

### 4. Script Organization

Inline script strings are acceptable during the first executor extraction
because moving them can change bundling behavior. After executor convergence,
evaluate moving scripts to explicit sidecar script modules.

The second-stage script move must preserve:

- Node target compatibility
- package artifact inclusion
- source runtime import resolution
- exact stdout JSON protocol

## Test Plan

### Unit Tests

- `browser/node-sidecar.test.ts`
  - packaged runtime prefers sibling `browser-mcp-node/node.exe`
  - packaged runtime prefers sibling `browser-mcp-node/node_modules/playwright`
  - packaged executable rejects missing packaged runtime
  - Bun development runtime can use `OPENCORVUS_BROWSER_MCP_NODE`

- New `browser/node-executor.test.ts`
  - returns parsed JSON result from stdout
  - includes stderr in invalid JSON errors
  - reports non-zero exit
  - kills process on hard timeout
  - kills process when `AbortSignal` aborts

### Caller Tests

- `mirror/url/runtime-state.test.ts`
  - runtime-state capture does not call `BrowserRuntime.launchPlaywrightBrowser`
  - writes four interaction screenshots and `interaction-state-snapshots.json`
  - keeps existing observation derivation tests

- `mirror/visual/render.test.ts`
  - render integration still captures file URL screenshot
  - visible text extraction remains unchanged

- `frontend-design/capture-gate.test.ts`
  - Node sidecar path resolves through shared runtime
  - existing diagnostics tests remain unchanged

- `mcp/serve.test.ts`
  - executor MCP still filters mirror tools
  - no new browser evidence tools become LLM-visible

### Integration Verification

- Run targeted tests:

```bash
bun test packages/opencorvus/test/browser/node-sidecar.test.ts \
  packages/opencorvus/test/browser/node-executor.test.ts \
  packages/opencorvus/test/mirror/url/runtime-state.test.ts \
  packages/opencorvus/test/mirror/visual/render.test.ts \
  packages/opencorvus/test/frontend-design/capture-gate.test.ts \
  packages/opencorvus/test/mcp/serve.test.ts
```

- Run `bun run typecheck` in `packages/opencorvus`.
- Re-run overlay benchmark after the convergence lands, because this area affects
  browser evidence materialization.

## Rollout

1. Land executor extraction with runtime-state as the first caller.
2. Migrate visual render to the executor.
3. Migrate frontend capture gate to the executor and shared resolver.
4. Reuse resolver from MCP launcher.
5. Run benchmark and inspect `frontend_design` logs for:
   - no Bun-hosted Playwright launch timeout
   - runtime-state evidence artifacts present
   - executor MCP tool surface unchanged

## Rejected Alternatives

| Alternative | Reason rejected |
| --- | --- |
| Increase browser launch timeout instead of moving browser work to Node | Hides the Bun plus Playwright Windows boundary failure and delays error feedback. After Node sidecar convergence, the timeout still belongs in the shared `BrowserRuntime` policy so Windows Chrome startup is not capped by smaller private caller defaults. |
| Expose runtime-state as an MCP tool | Makes deterministic host evidence materialization depend on LLM tool choice. |
| Bun-first then Node fallback | Creates dual-source behavior and makes failures harder to locate. |
| Rename `browser-mcp-node/` now | High artifact and overlay packaging churn; defer until runtime executor/resolver are clean. |
| Switch all callers to Puppeteer | Adds a second browser automation stack while Playwright works correctly through Node. |

## Acceptance Criteria

- One shared executor owns Node sidecar process mechanics.
- One shared resolver owns browser Node runtime path resolution.
- Runtime-state, visual render, and frontend capture no longer duplicate
  spawn/stdout/stderr/timeout code.
- Browser launch timeout defaults to 300_000ms through
  `BrowserRuntime.resolveBrowserLaunchTimeoutMs`; frontend capture passes that
  value into the Node script and must not embed a private 15s
  `chromium.launch` cap.
- No new LLM-visible MCP browser evidence tools are exposed.
- Targeted tests and `packages/opencorvus` typecheck pass.
- Overlay benchmark no longer fails `frontend_design` due to Chrome launch
  timeout in runtime-state evidence capture.
