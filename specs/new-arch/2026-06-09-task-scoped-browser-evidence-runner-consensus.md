# Task-Scoped Browser Evidence Runner Consensus

Date: 2026-06-09

## Acronyms

- API: Application Programming Interface, the backend route or module contract consumed by callers.
- cwd: Current Working Directory, the process directory recorded in diagnostics.
- DB: Database, the persisted task, target, and evidence records.
- DOM: Document Object Model, the browser tree used for structure and style evidence.
- HTTP: Hypertext Transfer Protocol, the protocol used by preview targets and Browser MCP server mode.
- ID: Identifier, a stable database or artifact key.
- LLM: Large Language Model, the agent model that decides tool use from prompts.
- LSP: Language Server Protocol, editor integration commands that also use the shell supervisor.
- MCP: Model Context Protocol, the tool/server protocol used by external browser automation.
- P0: Priority 0, a blocker that prevents implementation from starting.
- P1: Priority 1, a high-impact issue that must be resolved in the same planning cycle.
- PID: Process Identifier, the operating-system process id returned by a spawned command.
- PR: Pull Request, one reviewable change set.
- PRD: Product Requirements Document, the implementation requirements extracted from source evidence.
- QA: Quality Assurance, verification work that proves the UI and runtime behavior.
- SDK: Software Development Kit, generated client code and types for the backend API.
- stderr: Standard Error, the child-process error stream recorded for diagnostics.
- UI: User Interface, the visible product surface.
- URL: Uniform Resource Locator, the address of a browser target.
- UX: User Experience, the interaction and workflow quality of the visible product.

## Consensus

Independent adversarial reviews agree on this root issue:

Browser automation is not converged. The codebase shares some Node runtime
resolution helpers, but task visual evidence can still be produced by separate
sidecars, separate Chromium instances, Browser MCP sessions, SingleFile capture,
browser-preview capture, runtime capture, frontend-design capture, webpage
render/extract/runtime-state tools, build screenshots, and acceptance
walkthroughs.

The Windows `npx playwright test 2>&1` failure is a symptom of using a shell
entrypoint for browser work plus a weak Windows supervisor failure path. It must
not be fixed with Playwright command detection, route bypasses, compatibility
fallbacks, or supervisor gates.

## Hard Decisions

These decisions close the choices that previous drafts left open.

1. The final task-scoped browser evidence invariant has exactly one public owner:
   `BrowserEvidenceRunner`. Partial PRs that leave legacy evidence paths live
   are not allowed to claim global convergence.
2. Product task workflows must not call `runBrowserNodeSidecar` directly for
   visual evidence. That function may remain only as a private implementation
   primitive under the runner or as a test helper.
3. Task runner inputs must not accept a bare `targetUrl`. They accept task and
   artifact identifiers; the runner resolves URLs from persisted backend
   artifacts.
4. Browser MCP is not a task evidence source. It may remain a non-task
   interactive tool, or it may call the runner as a client, but MCP-local pages,
   screenshots, console logs, and artifacts cannot enter task evidence manifests.
5. The overlay iframe is display-only. Its load state, local state, query
   parameters, local storage, and manual reloads never become evidence.
6. SingleFile capture is not a fallback. Existing task evidence paths must stop
   treating `singlefile.html` as an alternate authority. If SingleFile is needed
   later, it must be reintroduced only as an explicit runner operation.
7. Non-task browser harnesses are private to tests and benchmarks. Server
   routes, overlay, orchestrator agents, frontend-design tools, build tools, and
   prompts must not expose them as product paths.
8. Windows Playwright automation runs through Node. Bun is not an acceptable
   Playwright launch runtime on Windows.
9. `ProcessSupervisor` remains a generic process tool. It can improve PID
   diagnostics, helper cleanup, and request cleanup, but it must not inspect
   command semantics.

## Problem Statement

Current behavior has four risk surfaces:

1. Visual evidence is multi-source. The same task can produce screenshots, DOM
   metrics, runtime-state evidence, and preview artifacts through separate
   sidecar invocations and separate Chromium lifecycles.
2. Active prompt text still contains broad MCP and Playwright language that can
   steer agents toward shell-driven or MCP-driven Playwright tests instead of
   task-scoped backend evidence.
3. SingleFile capture creates a hidden second browser lifecycle and has
   fallback-style behavior in webpage extraction.
4. Windows `ProcessSupervisor` reports a PID timeout without enough diagnostics
   and does not guarantee helper/request cleanup when PID handoff fails.

## Call Point Inventory

This inventory is the implementation contract. Every listed item must be marked
as preserved, replaced, deleted, or explicitly deferred by the PR that touches
it.

| Area | Call points | Current action | Target action |
| --- | --- | --- | --- |
| Shared sidecar executor | `packages/opencorvus/src/browser/runtime/node-executor.ts` `runBrowserNodeSidecar` | Per-call `spawn(runtime.nodeExecutable, ["-"])`. | Private runner primitive or test helper only; no product task evidence caller. |
| Browser Node resolver | `packages/opencorvus/src/browser/runtime/node-sidecar.ts` `resolveBrowserNodeSidecarRuntime` | Resolves packaged/source Node and Playwright path. | Keep as the single Node runtime resolver. |
| Browser runtime helper | `packages/opencorvus/src/browser/runtime/index.ts` `launchPlaywrightBrowserInNodeProcess` | Allows Node-process Playwright launch; rejects Bun. | Keep internal to runner-owned scripts. |
| Runtime visual capture | `packages/opencorvus/src/runtime/visual-page.ts` `renderPage` | Runs a one-shot sidecar. | Defer to a later runner operation; no direct product task sidecar after migration. |
| Runtime page capture | `packages/opencorvus/src/runtime/page-capture.ts` `captureRuntimePage` | Calls `renderPage`. | Defer except where first PR migrates browser-preview capture. |
| Browser preview target discovery | `packages/opencorvus/src/browser-preview/extract.ts`, `liveness.ts`, `target.ts`, `packages/opencorvus/src/tool/bash.ts` | Extracts dev-server URLs from process output, probes candidates, persists targets. | Preserve as the single preview target source. Runner receives `taskID` plus required `targetID`, then resolves URL internally. |
| Browser preview evidence DB | `packages/opencorvus/src/browser-preview/persist.ts`, `packages/opencorvus/src/browser-preview/verification.ts` | Persists capture payloads and reads `latestEvidenceID`. | Persist runner manifest path, target ID, viewport IDs, summaries, and failure state. |
| Browser preview routes | `packages/opencorvus/src/server/routes/browser-preview.ts` GET/PUT/POST | POST allows missing `targetID` and resolves a latest target. | Keep route paths; POST requires selected `targetID`, fails missing/unknown target before runner launch, calls runner, and returns manifest-backed summary. |
| Browser preview route clients | `packages/overlay/src/services/browser-preview.ts`, `packages/overlay/src/components/BrowserPreviewPanel.tsx`, `packages/sdk/js/src/gen/types.gen.ts`, `packages/opencorvus/test/server/browser-preview-routes.test.ts` | `targetID` is optional or tests bless missing `targetID`. | Make capture request `targetID` required in overlay, SDK, generated types, panel calls, and tests. |
| Overlay preview UI | `packages/overlay/src/services/browser-preview.ts`, `packages/overlay/src/components/BrowserPreviewPanel.tsx` | Shows backend target and calls capture route; also renders iframe. | Keep iframe as live view only; capture evidence comes only from backend runner manifest. |
| SDK/OpenAPI/docs | `packages/sdk/openapi.json`, `packages/sdk/js/src/gen/sdk.gen.ts`, `packages/sdk/js/src/gen/types.gen.ts`, `packages/web/src/content/docs/reference/api.mdx`, `packages/web/src/content/docs/zh-cn/reference/api.mdx` | Describe existing preview capture contract. | Regenerate/update when route response and required request fields change. |
| Build screenshot tool | `packages/opencorvus/src/build/screenshot-tool.ts`, `packages/opencorvus/src/build/agent.ts`, `packages/opencorvus/src/build/prompt-context.ts`, `packages/opencorvus/test/build-agent/visual-reference-prompt.test.ts` | Captures via runtime path and registers screenshot/prompt evidence text. | Remove as task evidence surface until migrated, or migrate in Phase 3; no non-task product branch. |
| Frontend design reference capture | `packages/opencorvus/src/frontend-design/capture-gate.ts`, `packages/opencorvus/src/frontend-design/url-screenshot-tool.ts` | One-shot sidecar capture. | Later source-capture runner operation. |
| Frontend design dynamic prompt/tools | `packages/opencorvus/src/frontend-design/agent.ts`, `packages/opencorvus/src/frontend-design/static-tools.ts`, `packages/opencorvus/src/agent/agent.ts` | Prompt and tool registries expose webpage render/evaluate/vision flows. | Remove deferred browser evidence tools from task evidence surfaces until migrated, or migrate them in the same PR. |
| Webpage extract | `packages/opencorvus/src/browser/webpage/extract.ts`, `packages/opencorvus/src/frontend-design/tools/webpage-extract.ts` | One-shot sidecar and calls SingleFile from tool wrapper. | Later runner extraction operation; SingleFile must not remain fallback. |
| SingleFile capture and consumers | `packages/opencorvus/src/web-clone/singlefile-capture.ts`, `packages/opencorvus/src/frontend-design/tools/webpage-compile.ts`, `packages/opencorvus/src/web-clone/skeleton-project-generator.ts`, `packages/opencorvus/test/web-clone/singlefile-capture.test.ts` | Finds Chrome, creates separate capture artifacts, and downstream tools prefer `singlefile.html` when present. | Remove fallback preference from task evidence; SingleFile can return only through runner if reintroduced. |
| Webpage render | `packages/opencorvus/src/browser/webpage/render.ts`, `packages/opencorvus/src/frontend-design/tools/webpage-render.ts` | One-shot sidecar render to `rendered.png`. | Later runner render operation; keep output contract until consumers migrate. |
| Webpage evaluation consumers | `packages/opencorvus/src/frontend-design/tools/webpage-evaluate.ts`, `packages/opencorvus/src/frontend-design/tools/webpage-vision-judge.ts` | Depend on `webpage_render` output paths. | Update when runner manifest changes rendered image paths. |
| Webpage runtime/text evidence | `packages/opencorvus/src/browser/webpage/runtime-state.ts`, `packages/opencorvus/src/frontend-design/tools/webpage-runtime-state.ts`, `packages/opencorvus/src/frontend-design/tools/webpage-text-diff.ts` | One-shot sidecars or re-extraction. | Later runner operations sharing the same evidence job. |
| Orchestrator webpage evidence | `packages/opencorvus/src/orchestrator/webpage-evidence.ts`, `packages/opencorvus/src/orchestrator/tools.ts` | Serial pipeline with unshared browser lifecycle. | Later submit one runner job and consume its manifest; tool descriptions must not advertise deferred legacy evidence paths as current task acceptance. |
| Research webpage evidence | `packages/opencorvus/src/research/agent.ts`, `packages/opencorvus/src/research/webpage-prd-evidence.ts` | Research can prepare webpage PRD evidence through the same unshared webpage pipeline. | Later runner source evidence operation; until then, do not present it as runner-compliant evidence. |
| Visual QA tools | `packages/opencorvus/src/visual-qa/agent.ts`, `packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts` | Registers and advertises webpage render/evaluate/text/vision tools. | Remove deferred browser evidence tools from task evidence surfaces until migrated, or migrate them in the same PR. |
| Acceptance walkthrough | `packages/opencorvus/src/acceptance/checks/walkthrough/run.ts` | One-shot sidecar launch. | Later runner interaction operation for task work; private test harness otherwise. |
| Browser MCP launcher | `packages/opencorvus/src/mcp/browser/node-launcher.ts`, `packages/opencorvus/src/mcp/browser/index.ts` | Starts MCP child; HTTP defaults to fixed port. | Non-task interactive only, unless refactored into a runner client. Never a separate task evidence source. |
| Browser MCP sessions/tools | `packages/opencorvus/src/mcp/browser/sessions.ts`, `packages/opencorvus/src/mcp/browser/tools.ts` | MCP-local Chromium, contexts, pages, artifacts. | MCP-local outputs cannot be persisted as task evidence. |
| OpenCorvus executor MCP | `packages/opencorvus/src/mcp/serve.ts`, `docs/product/en/opencorvus/mcp.md`, `docs/product/zh-CN/opencorvus/mcp.md` | Separate MCP exposure boundary and docs for webpage evidence tools. | Keep webpage evidence tools denied from executor MCP until runner-backed contracts exist; docs must not claim MCP as task evidence owner. |
| Active user task spec | `specs/tc_clone_prompt.md` | Says MCP and Playwright should inspect regions and run tests. | Replace with backend runner evidence language. |
| Core prompts | `packages/opencorvus/src/prompt/core/build-core.txt`, `visual-qa-core.txt`, `frontend-design-core.txt`, orchestrator core prompts | Broad browser/MCP/Playwright wording remains in active instructions. | Prompt hygiene must direct agents to task-scoped backend evidence and artifact paths. |
| Workflow hints | `packages/opencorvus/src/engine/workflow.ts` | Mentions Node/Playwright or webpage evidence paths. | Align with runner terminology. |
| Windows supervisor consumers | `packages/opencorvus/src/shell/process-supervisor.ts`, `packages/opencorvus/src/shell/shell.ts`, `packages/opencorvus/src/tool/bash.ts`, `packages/opencorvus/src/session/shell-exec.ts`, `packages/opencorvus/src/lsp/server.ts`, `packages/opencorvus/src/orchestrator/tools.ts`, `packages/opencorvus/native/process-supervisor/src/main.rs` | Generic process spawning and PID handoff. | Improve failure diagnostics and cleanup for all consumers, with no command gate. |

## Target Architecture

`BrowserEvidenceRunner` is a backend service for task-scoped evidence jobs.

The runner owns:

- task ID and required target/source artifact ID
- URL resolution from persisted backend artifacts
- one Node sidecar process per active task evidence session
- one Chromium browser per session
- bounded contexts/pages for source target, current preview target, and
  interaction checks
- batch operations for viewports, regions, DOM/style probes, console/page-error
  capture, screenshots, and interaction probes
- one manifest recording every artifact path, operation result, diagnostic, and
  failure state
- deterministic teardown when the job completes, is aborted, or its lease
  expires

The first implementation must introduce a new batch sidecar script for runner
jobs. It must not attempt to compose the existing one-shot scripts as a
long-lived session, because those scripts use separate payload environment
variables and separate output assumptions.

## API Contract

Task-scoped runner input:

```ts
type BrowserEvidenceJob = {
  jobID: string
  taskID: string
  targetID: string
  artifactPackageRoot: string
  operation: BrowserPreviewCaptureOperation
}

type BrowserPreviewCaptureOperation = {
  kind: "preview-capture"
  viewports: Array<{ id: string; width: number; height: number }>
  probes: Array<"screenshot" | "dom" | "console" | "page-error">
}
```

The runner resolves the URL internally from `taskID` and `targetID`. Future
operations such as source capture, render, extract, runtime-state, text snapshot,
and interaction must not appear in the public runner union until their migration
phase implements them. A separate private test harness may accept a direct URL,
but that type must be named differently and cannot be imported by product
routes, overlay, orchestrator, frontend-design, visual QA, research, acceptance,
or build code.

Output:

```ts
type BrowserEvidenceManifestSummary = {
  manifestPath: string
  jobID: string
  taskID: string
  targetID: string
  operations: Array<{
    kind: string
    status: "completed" | "failed"
    artifactPaths: string[]
    diagnosticsPath?: string
  }>
}
```

Callers cite artifact paths and summaries. They do not inline large evidence
payloads into agent messages.

## Implementation Phases

### Phase 0: Prompt and Spec Hygiene

Scope:

- Update `specs/tc_clone_prompt.md`.
- Update `build-core.txt`, `visual-qa-core.txt`, `frontend-design-core.txt`,
  orchestrator core prompt tests, dynamic `frontend-design/agent.ts` prompt
  text, frontend-design static tool exposure, visual QA tool exposure, build
  screenshot/prompt registration text, research webpage evidence entrypoint
  language, executor MCP docs, and `engine/workflow.ts`.
- Replace mixed MCP/Playwright instructions with task-scoped backend evidence
  runner language.
- Remove or narrow active task tool exposure for deferred browser evidence paths.
  If a deferred path must stay product-callable, it must migrate in the same PR
  instead of remaining as a parallel task evidence owner.

Exit criteria:

- Active prompts and tool descriptions do not instruct agents to start
  Playwright tests through MCP, shell, or `npx`.
- Prompt tests assert that UI verification asks for backend runner artifacts and
  does not contain the mixed phrases from the bug report.
- Tool exposure tests show Browser MCP, SingleFile-backed webpage extraction,
  webpage render/evaluate/text/vision tools, build screenshot capture, research
  webpage evidence, and acceptance walkthrough are either runner-backed or not
  advertised as task evidence surfaces.

### Phase 1: Minimal Runner PR

Scope:

- Add `BrowserEvidenceRunner` types and a new Node batch sidecar script.
- Support only task browser-preview capture in this phase:
  desktop/mobile screenshots, DOM snapshot, console records, and page-error
  records in one job and one manifest.
- Migrate `verifyBrowserPreview` and
  `POST /task/:taskID/browser-preview/capture` to the runner.
- Preserve the route path, but make request `targetID` required and return a
  manifest-backed capture summary.
- Update `persistBrowserPreviewEvidence`, route tests, overlay service types,
  OpenAPI, SDK, and docs.

Deferred from Phase 1:

- `captureReferenceManifest` after it has been removed from active task evidence
  exposure or migrated in the same PR
- `webpage_extract`, `webpage_render`, `webpage_runtime_state`,
  `webpage_text_diff` after they have been removed from active task evidence
  exposure or migrated in the same PR
- SingleFile capture
- build screenshot tool
- acceptance walkthrough
- Browser MCP lifecycle refactor beyond the explicit task-evidence prohibition

Exit criteria:

- One browser-preview capture for desktop and mobile starts one Node batch
  sidecar and writes one manifest.
- The manifest records `taskID`, `targetID`, viewport IDs, artifact paths,
  console/page-error sections, and failures.
- Missing or unknown `targetID` fails before browser launch and writes a visible
  route/tool error; it does not resolve latest target and does not fall back to a
  direct URL.
- Overlay still displays the iframe, but capture evidence comes from the backend
  manifest only.
- Phase 1 proves single ownership only for task browser-preview capture. The
  overall architecture remains non-compliant until every deferred product
  evidence path is migrated or removed.

### Phase 2: Source and Webpage Evidence Migration

Scope:

- Migrate frontend source URL capture, research webpage PRD evidence, webpage
  extract/render/runtime-state/text snapshot, and their orchestrator consumers
  to runner operations.
- Remove SingleFile fallback preference from `webpage_extract`,
  `webpage_compile`, and skeleton project generation. If SingleFile is still
  required, implement it as a runner operation with manifest output.
- Update `webpage_evaluate` and `webpage_vision_judge` consumers if rendered
  output paths move into the manifest.
- Retire or rename `frontend-design/capture-gate.ts` when migrated. It cannot
  remain a gate-named parallel authority beside `BrowserEvidenceRunner`.

Exit criteria:

- Source/current/interaction evidence for a webpage task can be represented in
  one runner job manifest.
- No task webpage evidence path launches a separate browser lifecycle outside
  the runner.

### Phase 3: Interaction and Build Evidence Migration

Scope:

- Migrate build screenshot capture and acceptance walkthrough task usage to
  runner operations.
- Keep any non-task browser harness private to tests/benchmarks.

Exit criteria:

- Product build and acceptance evidence use runner manifests for task work.
- Non-task harnesses are not imported by product routes, overlay, orchestrator,
  frontend-design, or build agents.

### Phase 4: Browser MCP Boundary Enforcement

Scope:

- Keep Browser MCP as non-task interactive tooling, or refactor it into a runner
  client. In both cases, MCP-local evidence cannot be task evidence.
- Remove any prompt or route implication that Browser MCP owns task screenshots,
  DOM, console, page-error, or interaction evidence.

Exit criteria:

- Browser MCP is not a second source of task visual evidence.
- Task evidence does not depend on Browser MCP HTTP mode or fixed port `8931`.

### Phase 5: Windows Supervisor Hardening

Scope:

- Add structured diagnostics to PID timeout and early-exit failures.
- Capture helper stderr tail, helper PID, shell path, cwd, request directory,
  PID path, elapsed time, command length, environment key count, and helper
  liveness.
- Ensure `spawnWindows` disposes helper and removes request directory when PID
  handoff fails.
- Add Rust helper progress breadcrumbs for create-job, create-process,
  assign-job, write-pid, and resume phases.

Exit criteria:

- PID timeout cannot leave an unmanaged late-start helper process.
- Error messages identify the failing phase without command-specific gates.
- Generic consumers such as BashTool, session shell, LSP, and orchestrator git
  bash still work.

## Test Plan

- Prompt hygiene: active UI verification prompts reject mixed MCP/Playwright
  instructions and require backend runner artifact paths.
- Tool exposure: active task agent tool registries do not expose deferred
  browser evidence tools as task evidence surfaces.
- Runner unit: browser-preview desktop/mobile capture is one job, one Node batch
  sidecar, one Chromium browser, and one manifest.
- Runner unit: task runner input requires `taskID` and `targetID`; product code
  cannot construct a direct-URL job.
- Browser-preview route: missing or unknown `targetID` fails before browser
  launch and returns visible diagnostics; route tests no longer bless omitted
  `targetID`.
- Browser-preview DB contract: persisted evidence records manifest path,
  `targetID`, viewport IDs, `latestEvidenceID`, success summaries, and failure
  summaries.
- Overlay service: capture response types consume manifest-backed summaries and
  do not read iframe state as evidence.
- API contract: OpenAPI, SDK generated types, and API docs match the route
  response.
- SingleFile decision test: once Phase 2 starts, task evidence either invokes
  SingleFile only through a runner operation or does not invoke it at all.
- Import-boundary tests: after each migration phase, product routes, overlay,
  orchestrator, frontend-design, visual QA, research, acceptance, and build task
  paths do not import `runBrowserNodeSidecar`, `renderPage`, or
  `captureRuntimePage` for migrated task evidence.
- Runner teardown: abort closes Chromium, Node sidecar, and writes a failed
  manifest with diagnostics.
- Supervisor unit: PID timeout includes diagnostics and cleans request
  directory.
- Supervisor unit: early helper exit includes stderr tail and phase breadcrumb.
- Supervisor integration: generic Git Bash, `node -e`, and `npx --version`
  still report a PID through the supervisor.

The test suite must not contain a runtime command gate such as "if command
contains playwright". Architecture tests should assert dependencies and public
API boundaries, not command string semantics.

## Non-Goals

- Do not add Playwright-specific command detection to `ProcessSupervisor`.
- Do not add fallback from Node sidecar to Bun Playwright.
- Do not expose Browser MCP, overlay iframe, query parameters, local storage, or
  local signals as task evidence sources.
- Do not preserve legacy parallel evidence routes for compatibility.
- Do not migrate every browser tool in the first PR.

## Adversarial Review Ledger

The 2026-06-09 review cycle raised these blockers and this revision resolves
them as follows:

| Objection | Resolution |
| --- | --- |
| Browser MCP was left as a choice. | Hard decision: MCP is not a task evidence source; it is non-task interactive or runner client only. |
| `targetUrl` bypassed backend preview target. | Task job input and browser-preview public capture request now require `targetID`; direct URL is private test harness only. |
| Old public APIs were preserved as compatibility. | Product callers must move to `BrowserEvidenceRunner`; old executor can only be private/internal. |
| SingleFile was missing. | Added capture and downstream consumers to inventory; fallback behavior is forbidden. |
| Preview target and DB chains were missing. | Added target discovery, liveness, persist, route, overlay, SDK, OpenAPI, and docs call points. |
| Phase 1 was too broad. | First PR limited to prompt hygiene plus browser-preview runner manifest path. |
| Tests risked becoming command gates. | Test plan now asserts architecture boundaries and generic supervisor diagnostics. |
| Phase 1 could still claim global convergence while legacy paths stayed live. | Phase 1 now proves only browser-preview capture, and deferred product paths must be removed from task evidence exposure or migrated in the same PR. |

## Immediate Decision

Adopt `BrowserEvidenceRunner` as the single public owner of task browser
evidence. The first implementation PR must prove the model only for
browser-preview capture and prompt hygiene. Broader webpage, build, acceptance,
SingleFile, and Browser MCP work must wait until the first PR has a manifest,
route, DB, overlay, SDK, docs, and tests proving the single-source contract.
