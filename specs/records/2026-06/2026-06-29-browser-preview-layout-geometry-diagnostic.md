# Browser Preview Layout Geometry Diagnostic

Date: 2026-06-29

## Acronyms

- API: Application Programming Interface, the backend or tool contract consumed by callers.
- CSS: Cascading Style Sheets, the browser styling language whose computed values define spacing and layout.
- DOM: Document Object Model, the browser element tree used for geometry capture.
- ID: Identifier, a stable task, target, viewport, region, or evidence key.
- MCP: Model Context Protocol, the external tool protocol used for generic browser automation.
- QA: Quality Assurance, the review workflow that verifies visible product behavior.
- UI: User Interface, the rendered product surface.

## Problem

Generated webpage components can align inconsistently at page edges, use
different margin or padding rhythms, and support desktop width changes unevenly.
The existing evidence stack can show screenshots and region crops, but it does
not produce a typed geometry contract for:

- viewport/page overflow;
- component border box and computed margin/padding/gap;
- edge offsets from viewport and page;
- source-to-implementation size and edge deltas;
- same-component width behavior across explicit desktop samples.

This leaves Build and Visual QA with screenshots and prose instead of structured
evidence they can cite and repair against.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `2026-06-09-task-scoped-browser-evidence-runner-consensus.md` | Browser MCP is not a task evidence source. Task visual evidence is owned by backend browser-preview artifacts. |
| `2026-06-18-preview-repair-tool-adapter-single-source.md` | `Tool.define` owns tool ID, description, schema, and execution; stage adapters must not duplicate definitions. |
| `2026-06-28-browser-preview-pane-width-autoscale.md` | Overlay pane autoscale is not this tool's scope; it keeps backend viewport dimensions as the source and must not use transform scaling. |
| `2026-06-29-remove-region-diff-agent-tool.md` | Do not restore the removed agent-callable region diff wrapper. Backend comparison evidence may remain, but generic agent diff wrappers must not return. |

## Call Point Inventory

Command set:

```powershell
rg -n "browser_preview|BrowserPreview|MCP|reference-comparison|layout-map|style-profile|margin|padding|gap|viewport|bbox|scale" packages/opencorvus/src packages/opencorvus/test specs/current/architecture specs/records/2026-06 -g "*.ts" -g "*.txt" -g "*.md"
```

| Surface | Current role | Decision |
| --- | --- | --- |
| `packages/opencorvus/src/tool/browser-preview.ts` | Starts and persists the task-scoped preview target. | Preserve as the only preview target creation tool. |
| `packages/opencorvus/src/browser-preview/persist.ts` | Persists `browser_preview_target` and `browser_preview_evidence`. | Add a new explicit evidence operation for layout geometry diagnostics. |
| `packages/opencorvus/src/browser-preview/evidence-runner.ts` | Captures preview screenshots, DOM, page size, and region bbox evidence through Node Playwright sidecars. | Reuse the same backend sidecar boundary; do not call MCP or accept raw URLs. |
| `packages/opencorvus/src/browser-preview/region-comparison.ts` | Produces source/local true-size comparison evidence for bound regions. | Keep separate; layout geometry diagnostics are not `reference-comparison` proof. |
| `packages/opencorvus/src/browser-preview/scroll-slice-comparison.ts` | Produces Visual QA supporting `visual_diff` slices. | Keep separate; scroll slices remain supporting evidence only. |
| `packages/opencorvus/src/mcp/browser/tools.ts` | Generic browser automation tools such as screenshot and observe. | Do not add task layout geometry diagnostics here. |
| `packages/opencorvus/src/agent/tool-pool-contract.ts` | Single source for agent tool assignment. | Add the new internal tool through this contract only. |
| `packages/opencorvus/src/visual-qa/static-tools.ts` | Visual QA static preview tool list. | Expose the diagnostic to Visual QA for final layout review. |
| `packages/opencorvus/src/prompt/core/visual-qa-core.txt` and Build prompt text | Tell agents to inspect layout and screenshots. | Mention structured layout geometry evidence as the precise tool for margin/edge/scale claims. |

## Decision

Implement an internal browser-preview tool named
`browser_preview_layout_geometry`. It is not an MCP tool.

The core implementation lives under `packages/opencorvus/src/browser-preview`
and resolves the URL only from persisted `taskID` plus `targetID`. The model
wrapper lives under `packages/opencorvus/src/tool` and is exposed through
`AgentToolPool`.

The tool writes a task-runtime manifest and persists a
`browser_preview_evidence` row with `operationKind="layout-geometry"`. That
operation is supporting geometry evidence. It must not be treated as
`reference-comparison` proof.

## Contract

Input:

- required `targetID`;
- required `viewportID`;
- required `route`;
- required `regions`, each with a stable `regionID` and implementation locator;
- optional source bbox per region for source-to-implementation edge and size
  deltas;
- optional explicit desktop width samples for same-component scaling checks.

Output:

- manifest path;
- persisted evidence ID;
- page-level overflow and root metrics;
- one or more viewport samples;
- per-region border box, computed margin, padding, gap, overflow, transform,
  edge offsets, and optional source delta;
- width-sample scale records when explicit extra widths were requested.

## Acceptance

- The tool never accepts a raw URL and fails when the task context is missing.
- The tool resolves only persisted task preview targets.
- The sidecar runs through Node Playwright, not Browser MCP and not Bun
  Playwright.
- The manifest includes page overflow, region box/style/edge metrics, and
  optional source deltas.
- Persisted evidence uses the explicit `layout-geometry` operation kind.
- Visual QA can call the tool; Build can call it when repairing layout geometry.
- Prompts describe it as supporting geometry evidence, not reference-comparison
  proof.
- Targeted tests cover schema strictness, source delta math, tool assignment, and
  persisted evidence semantics.

## Non-Goals

- Do not repair overlay preview pane autoscale here.
- Do not restore the removed region diff agent wrapper.
- Do not expose this through MCP.
- Do not invent mobile/tablet/responsive requirements. Extra width samples are
  explicit desktop diagnostic inputs only.
- Do not add host gates or flow-control preflights. Missing required artifacts
  fail as data errors.
