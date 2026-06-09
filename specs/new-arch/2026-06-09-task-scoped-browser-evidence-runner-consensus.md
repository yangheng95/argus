# Task-Scoped Browser Evidence Runner Consensus

Date: 2026-06-09

## Acronyms

- API: Application Programming Interface, the backend route or module contract consumed by callers.
- DOM: Document Object Model, the browser tree used for structure and style evidence.
- HTTP: Hypertext Transfer Protocol, the protocol used by preview targets and Browser MCP server mode.
- LLM: Large Language Model, the agent model that decides tool use from prompts.
- MCP: Model Context Protocol, the tool/server protocol used by external browser automation.
- PID: Process Identifier, the operating-system process id returned by a spawned command.
- PRD: Product Requirements Document, the implementation requirements extracted from source evidence.
- UI: User Interface, the visible product surface.
- UX: User Experience, the interaction and workflow quality of the visible product.

## Consensus

Three independent read-only reviews and a local cross-check agree on the same
root issue:

Browser automation is not yet converged to one task-scoped evidence runtime.
Several callers share the Browser Node sidecar resolver, but the lifecycle is
still per-call for visual evidence. Browser MCP has its own longer-lived browser
process inside its MCP child, while webpage extraction/render/runtime-state,
frontend-design capture, browser-preview capture, build screenshot capture, and
acceptance walkthrough can each launch separate Node sidecars and Chromium
instances.

The Windows `npx playwright test 2>&1` failure is a symptom of using the wrong
entrypoint and an under-diagnosed process supervisor failure path. It must not be
fixed by adding Playwright-specific routing or command gates in the supervisor.

## Problem Statement

Current behavior has three separate risk surfaces:

1. Visual evidence is multi-source. The same task can produce screenshots,
   DOM metrics, runtime-state evidence, and browser-preview artifacts through
   separate sidecar invocations and separate Chromium lifecycles.
2. Active prompt text still contains broad "MCP + Playwright" language that can
   steer agents toward shell-driven or MCP-driven Playwright tests instead of
   task-scoped backend evidence.
3. Windows `ProcessSupervisor` reports a PID timeout without enough diagnostics
   and does not guarantee helper/request cleanup when `waitForPidFile` throws.

## Design Principles

- Single source: task-scoped browser evidence is owned by one backend runner.
- No fallback: missing target or runtime is an explicit failure with evidence.
- No supervisor gate: shell supervision cannot inspect command semantics such as
  `playwright` or `npx`.
- Node-only browser automation on Windows: Playwright must not launch from Bun.
- Artifact-first acceptance: desktop, mobile, region, DOM, style, console, and
  page-error evidence must be persisted and referenced by path.
- Batch before spawn: a multi-region or multi-viewport check must run through one
  task evidence session instead of creating one sidecar per region.

## Call Point Inventory

This inventory is based on full-repo grep before drafting this plan.

| Area | Call points | Current action | Target action |
| --- | --- | --- | --- |
| Shared sidecar executor | `packages/opencorvus/src/browser/runtime/node-executor.ts` `runBrowserNodeSidecar` | Per-call `spawn(runtime.nodeExecutable, ["-"])`. | Keep as low-level primitive or replace with a long-lived task evidence session host. Do not expose it as the primary visual evidence API. |
| Browser Node resolver | `packages/opencorvus/src/browser/runtime/node-sidecar.ts` `resolveBrowserNodeSidecarRuntime` | Resolves packaged/source Node and Playwright path. | Keep as the single runtime path resolver. |
| Browser runtime | `packages/opencorvus/src/browser/runtime/index.ts` `launchPlaywrightBrowserInNodeProcess` | Allows Node-process Playwright launch; rejects Bun. | Keep as internal Node-side script utility, owned by the task evidence session or Browser MCP session. |
| Runtime visual capture | `packages/opencorvus/src/runtime/visual-page.ts` `renderPage` | Calls `runBrowserNodeSidecar`, launches Chromium in inline script. | Route through task evidence runner batch capture. |
| Runtime page capture | `packages/opencorvus/src/runtime/page-capture.ts` `captureRuntimePage` | Calls `renderPage`. | Become a thin client of the task evidence runner. |
| Browser preview capture | `packages/opencorvus/src/browser-preview/verification.ts`, `packages/opencorvus/src/server/routes/browser-preview.ts` `POST /task/:taskID/browser-preview/capture` | Captures by calling `captureRuntimePage`. | Call the task-scoped evidence runner for selected target and viewport. |
| Build screenshot tool | `packages/opencorvus/src/build/screenshot-tool.ts` | Calls `captureRuntimePage`. | Call the same task evidence runner when task context exists; require explicit non-task mode only for isolated build tests. |
| Frontend design reference capture | `packages/opencorvus/src/frontend-design/capture-gate.ts` `captureReferenceManifest` | Calls `runBrowserNodeSidecar`, launches Chromium. | Capture source URL through the task evidence runner and persist source artifacts in the task evidence package. |
| URL screenshot tool | `packages/opencorvus/src/frontend-design/url-screenshot-tool.ts` | Calls `captureReferenceManifest`. | Use task evidence runner source-capture operation. |
| Webpage extract | `packages/opencorvus/src/browser/webpage/extract.ts` `extractPage`, `packages/opencorvus/src/frontend-design/tools/webpage-extract.ts` | Per-call Node sidecar and Chromium; writes extraction artifacts. | Use the task evidence runner extraction operation and lock output to the task evidence package. |
| Webpage render | `packages/opencorvus/src/browser/webpage/render.ts` `renderFiles`, `packages/opencorvus/src/frontend-design/tools/webpage-render.ts` | Per-call Node sidecar and Chromium. | Use the task evidence runner render operation with explicit target URL/file. |
| Webpage runtime state | `packages/opencorvus/src/browser/webpage/runtime-state.ts` `captureWebpageRuntimeStateEvidence`, `packages/opencorvus/src/frontend-design/tools/webpage-runtime-state.ts` | Per-call Node sidecar and Chromium. | Use the same task evidence session after source page load. |
| Webpage text diff | `packages/opencorvus/src/frontend-design/tools/webpage-text-diff.ts` | Re-runs `extractPage` for rendered target. | Use task evidence runner DOM/text snapshot operation against current target. |
| Orchestrator live evidence | `packages/opencorvus/src/orchestrator/webpage-evidence.ts` | Serially calls extract/compile/analyze/runtime-state, but browser lifecycle is not shared. | Submit one evidence job to the task runner and consume its manifest. |
| Orchestrator visual reference | `packages/opencorvus/src/orchestrator/tools.ts` around live URL capture | Calls `captureReferenceManifest`. | Use task evidence runner source-capture operation. |
| Acceptance walkthrough | `packages/opencorvus/src/acceptance/checks/walkthrough/run.ts` | Calls `runBrowserNodeSidecar`, launches Chromium. | Use task evidence runner interaction operation when tied to a task; keep a separate non-task test harness only if explicitly isolated. |
| Browser MCP launcher | `packages/opencorvus/src/mcp/browser/node-launcher.ts` | Long-lived Node MCP child using the shared resolver. | Reuse the same browser runtime service lifecycle or become a client of it. Avoid a separate HTTP port source for task evidence. |
| Browser MCP sessions | `packages/opencorvus/src/mcp/browser/sessions.ts`, `tools.ts` | Reuses one Chromium inside the MCP child; contexts/pages are MCP-local. | Keep MCP semantics, but align lifecycle ownership with the task evidence runner for task-scoped work. |
| Overlay preview API client | `packages/overlay/src/services/browser-preview.ts`, `packages/overlay/src/components/BrowserPreviewPanel.tsx` | Consumes backend preview target and capture route. | Keep UI as a backend evidence client. Do not add local query/signal/iframe evidence sources. |
| Prompt: task template | `specs/tc_clone_prompt.md` | Says "MCP and Playwright" and "MCP start Playwright tests". | Replace with task-scoped backend evidence runner language. |
| Prompt: build agent | `packages/opencorvus/src/prompt/core/build-core.txt` | Mentions "MCP browser/render/preview tooling or equivalent task-scoped preview target". | Narrow to backend task preview target and evidence runner. |
| Prompt: visual QA agent | `packages/opencorvus/src/prompt/core/visual-qa-core.txt` | Mentions "Playwright/browser-style interaction through available runtime tools or project scripts". | Narrow to task evidence runner and webpage render/evaluate tools. |
| Workflow hint | `packages/opencorvus/src/engine/workflow.ts` | Mentions Node/Playwright or webpage tool evidence. | Align with final runner name after API is introduced. |
| Windows supervisor | `packages/opencorvus/src/shell/process-supervisor.ts`, `packages/opencorvus/native/process-supervisor/src/main.rs` | Waits for `pid.txt`; timeout has poor diagnostics and cleanup risk. | Improve diagnostics and cleanup only; no Playwright command routing. |

## Target Architecture

Introduce a backend `BrowserEvidenceRunner` with task-scoped session ownership.

The runner owns:

- task id and preview target id
- one Node sidecar process per active task evidence session
- one Chromium browser per session
- bounded contexts/pages for source target, current preview target, and
  interaction checks
- batch operations for viewports, regions, DOM/style probes, console/page-error
  capture, screenshots, and interaction probes
- one manifest that records every artifact path and operation result
- deterministic teardown when the task completes, the lease expires, or capture
  is aborted

The existing `runBrowserNodeSidecar` remains a low-level implementation detail
only where a short isolated test explicitly needs it. Product workflows should
not call it directly for task visual evidence after this refactor.

## API Shape

The exact API can be revised during implementation, but the consensus contract
is:

```ts
type BrowserEvidenceJob = {
  taskID: string
  targetID?: string
  targetUrl: string
  outDir: string
  viewports: Array<{ id: string; width: number; height: number }>
  regions?: Array<{ id: string; selector?: string; rect?: { x: number; y: number; width: number; height: number } }>
  probes: Array<"screenshot" | "dom" | "style" | "console" | "page-error" | "interaction">
}
```

Output must be a manifest path plus structured summaries. Callers should cite
artifact paths instead of inlining large evidence payloads.

## Phased Plan

### Phase 0: Prompt and Spec Hygiene

- Update `specs/tc_clone_prompt.md` to remove "MCP and Playwright" mixed
  instructions.
- Narrow `build-core.txt` and `visual-qa-core.txt` so agents ask for
  task-scoped backend evidence, not shell `npx playwright test`.
- Add prompt hygiene tests for the new wording.

Exit criteria:

- Active prompts do not instruct agents to start Playwright tests through MCP or
  shell.
- `tc_clone_prompt.md` names task-scoped backend evidence runner as the source
  of screenshots/diagnostics.

### Phase 1: Runner Skeleton and Manifest

- Add `BrowserEvidenceRunner` and manifest types.
- Implement a batch capture operation by reusing existing Node sidecar scripts
  without changing public evidence semantics.
- Keep old public function names as thin clients where needed, but their
  implementation must delegate to the runner for task-scoped work.

Exit criteria:

- A desktop + mobile capture for one task uses one evidence job and one
  manifest.
- Tests prove prompt/UI callers receive artifact paths from the runner.

### Phase 2: Migrate Visual Evidence Callers

- Migrate `browser-preview` capture, `captureRuntimePage`,
  `captureReferenceManifest`, `webpage_render`, `webpage_extract`,
  `webpage_runtime_state`, `webpage_text_diff`, and acceptance walkthrough.
- Remove direct task workflow calls to `runBrowserNodeSidecar`.

Exit criteria:

- Task visual evidence callers share one runner API.
- Concurrent region checks batch through one session instead of per-region spawn.

### Phase 3: Browser MCP Lifecycle Alignment

- Decide whether Browser MCP becomes a client of the runner for task-scoped work
  or only remains a non-task interactive browser tool.
- If HTTP mode remains, remove fixed-port collision as a task evidence
  dependency.

Exit criteria:

- Browser MCP is not a second source of task visual evidence.
- Task evidence does not depend on a fixed Browser MCP HTTP port.

### Phase 4: Windows Supervisor Hardening

- Add structured diagnostics to PID timeout and early-exit failures.
- Capture helper stderr tail, helper PID, shell path, cwd, request directory,
  pid path, elapsed time, command length, environment key count, and whether the
  helper is still alive.
- Ensure `spawnWindows` disposes helper and removes request directory when
  `waitForPidFile` throws.
- Add Rust helper progress breadcrumbs for create-job, create-process,
  assign-job, write-pid, and resume phases.

Exit criteria:

- PID timeout cannot leave an unmanaged late-start helper process.
- Error messages identify the failing phase without command-specific gates.

## Test Plan

- Unit: `BrowserEvidenceRunner` batches desktop/mobile/region operations into
  one session.
- Unit: task visual evidence callers do not call `ProcessSupervisor.spawnShell`
  for Playwright.
- Unit: task visual evidence callers do not call `runBrowserNodeSidecar` more
  than once for a single batch job.
- Unit: browser-preview capture uses persisted backend target and rejects
  missing target without launching browser work.
- Unit: prompt hygiene rejects `npx playwright test`, `MCP start Playwright`, and
  "MCP and Playwright" mixed wording in active prompts/templates.
- Unit: Windows helper timeout disposes helper and cleans request directory.
- Unit: Windows helper early exit includes stderr diagnostics.
- Integration: Git Bash `echo ok`, `node -e`, and `npx --version` still report a
  PID through the supervisor.
- Integration: task browser evidence desktop/mobile capture writes one manifest
  with screenshot, DOM, console, and page-error sections.

## Non-Goals

- Do not add Playwright-specific command detection to `ProcessSupervisor`.
- Do not add fallback from Node sidecar to Bun Playwright.
- Do not expose webpage evidence tools through external executor MCP as a new
  visual evidence source.
- Do not make overlay iframe state, query parameters, local storage, or local
  signals an evidence source.
- Do not preserve legacy parallel evidence routes for compatibility. This
  project is unreleased; old task visual evidence paths should be replaced.

## Consensus Risk Assessment

| Risk | Severity | Reason |
| --- | --- | --- |
| Multiple task evidence sidecars and Chromium instances | P0 | Confirmed per-call spawn in visual/webpage/front-end evidence callers. |
| Prompt steering toward MCP/Playwright mixed paths | P0 | `tc_clone_prompt.md` and active core prompts contain broad wording. |
| Windows PID timeout cleanup gap | P1 | `spawnWindows` waits for PID without `finally` cleanup around the wait. |
| Browser MCP fixed HTTP port collision | P1 | HTTP mode defaults to a fixed port and is separate from task evidence. |
| Artifact overwrite/order ambiguity | P1 | Multiple evidence paths write separate outputs for the same task. |

## Immediate Decision

Adopt the task-scoped `BrowserEvidenceRunner` as the single owner of browser
evidence for UI cloning, visual QA, browser preview capture, and webpage
evidence. Browser MCP may remain as an interactive MCP tool, but it must not be
the source of task visual evidence unless it is refactored to share the same
runner lifecycle and manifest.
