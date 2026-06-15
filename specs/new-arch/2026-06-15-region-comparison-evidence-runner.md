# Region Comparison Evidence Runner (2026-06-15)

## Acronyms

- API: Application Programming Interface, the backend route and typed contract consumed by agents, overlay, and SDK clients.
- DOM: Document Object Model, the browser-rendered element tree used only as one locator signal.
- ID: Identifier, a stable task, target, region, artifact, or evidence key.
- MCP: Model Context Protocol, the tool protocol used by external browser automation or executor integrations.
- QA: Quality Assurance, the review stage that checks visual, functional, and product-readiness evidence.
- SDK: Software Development Kit, generated client types and functions for backend APIs.
- UI: User Interface, the visible browser surface.
- URL: Uniform Resource Locator, the address resolved from a persisted preview target.

## Problem

Build can now be instructed to inspect screenshots, but the screenshot evidence is still too coarse for reference-parity work. A full-page screenshot lets the build agent see that something is wrong, but it does not reliably answer which source region maps to which local component. When the build agent cannot see a focused source-vs-local region comparison in the same turn, low-fidelity visual work can propagate into Visual QA and Integrity, causing late-stage failure and noisy rework.

The experiment in `.scratch/economy-tv-compare-20260615085702` compared TradingView World Economy against `examples/tradingview-world-economy` and proved the useful shape:

- Full-page side-by-side image is useful for global drift.
- Region side-by-side images are more actionable for build repair.
- Source region selection cannot rely only on DOM selectors or text.
- Local implementation selection works well with explicit component selectors.
- Region granularity must be consistent; comparing a source card content area to a local full card creates noisy evidence.

## Hard Decisions

1. The feature belongs to `BrowserEvidenceRunner`, not to Build, Browser MCP, Visual QA, or overlay.
2. MCP may expose a convenience tool only as a runner client. MCP-local pages, screenshots, logs, monitor frames, and attachments are not task evidence.
3. Build must see the generated side-by-side image in the same agent turn that requested comparison, before reporting success.
4. Source region authority comes from frontend-design/source-capture evidence, preferably `SourceRegion.bbox`. Build must not invent source bounding boxes during implementation.
5. Local region authority comes from implementation-owned bindings such as `data-oc-region`, `data-testid`, role/name, or a declared component selector. No `nth-child`, broad text search, or screenshot matching fallback is allowed.
6. Comparison scores are evidence only. They do not become a workflow gate, host gate, or pass/fail shortcut.
7. A missing source or local binding is a real failed comparison result, not permission to compare the whole page or an adjacent region.

## Experiment Evidence

Experiment command:

```powershell
node .scratch\economy-tv-compare.mjs
```

Final output:

- Manifest: `.scratch/economy-tv-compare-20260615085702/manifest.json`
- Full-page comparison: `.scratch/economy-tv-compare-20260615085702/fullpage-side-by-side.png`
- Header comparison: `.scratch/economy-tv-compare-20260615085702/regions/header/side-by-side.png`
- Page title comparison: `.scratch/economy-tv-compare-20260615085702/regions/page-title/side-by-side.png`
- Inflation map comparison: `.scratch/economy-tv-compare-20260615085702/regions/inflation-map/side-by-side.png`
- GDP card comparison: `.scratch/economy-tv-compare-20260615085702/regions/gdp-card/side-by-side.png`
- Countries comparison: `.scratch/economy-tv-compare-20260615085702/regions/countries/side-by-side.png`

Observed lessons:

- `header` failed when source lookup used the literal `header` selector.
- `TradingView` text also failed as a source header anchor because the source logo did not expose that text as a matching node.
- Explicit source `bbox` fixed the header comparison.
- `Overview` text found the page-title region, but the source crop included breadcrumb while local crop did not. The correct contract should split `breadcrumb` and `title-switcher`.
- `Inflation map` and `GDP growth` produced focused, useful comparison images.
- GDP comparison showed a scope mismatch: source side captured the content/table area, local side captured the full card. The binding needs `region_scope`.

## Target Architecture

Introduce first-class region bindings consumed by a runner operation.

```ts
type VisualRegionBinding = {
  region_id: string
  task_id: string
  viewport_id: "desktop" | "tablet" | "mobile"
  state_id: string
  source: SourceRegion
  implementation: ImplementationRegion
  region_scope: "page-section" | "card" | "content" | "title" | "chart" | "table" | "control" | "navigation"
  acceptance_refs: string[]
}
```

Source side:

```ts
type SourceRegion = {
  reference_artifact_id: string
  bbox: { x: number; y: number; width: number; height: number }
  semantic_role: string
  text_anchors: string[]
  source_refs: string[]
}
```

Implementation side:

```ts
type ImplementationRegion = {
  target_id: string
  route: string
  locator:
    | { kind: "test-id"; value: string }
    | { kind: "data-oc-region"; value: string }
    | { kind: "role"; role: string; name: string }
    | { kind: "selector"; value: string; owner_file: string }
  component_files: string[]
}
```

The runner operation:

```ts
type RegionComparisonOperation = {
  kind: "reference-comparison"
  taskID: string
  targetID: string
  bindings: VisualRegionBinding[]
  output: {
    include_fullpage_overview: boolean
    include_side_by_side: boolean
    include_diff: boolean
  }
}
```

Output:

```ts
type RegionComparisonManifest = {
  manifestPath: string
  jobID: string
  taskID: string
  targetID: string
  operation: "reference-comparison"
  viewport_id: string
  regions: Array<{
    region_id: string
    status: "completed" | "failed"
    reason?: string
    source_bbox?: { x: number; y: number; width: number; height: number }
    implementation_bbox?: { x: number; y: number; width: number; height: number }
    artifacts?: {
      source_crop: string
      implementation_crop: string
      side_by_side: string
      diff?: string
    }
    diagnostics: string[]
  }>
}
```

## Build Agent Flow

1. Build starts or reuses the task preview target through `browser_preview`.
2. Build reads frontend-design region bindings and local implementation files before editing.
3. Build adds or updates stable local region locators when implementing the component.
4. Build calls the runner-backed comparison tool for the specific region it just changed.
5. The tool returns a manifest path and attaches the side-by-side image to the build turn.
6. Build inspects the image. If the region is wrong, it repairs and reruns comparison.
7. Build may report success only after current-scope comparison artifacts are fresh, visible, and cited in `tests[]` or verification evidence.

## Tool Surface

Add a build-visible tool name such as `browser_preview_compare_region`.

The tool is not a screenshot owner. It is a typed client around the backend runner route. It returns:

- title: concise comparison summary
- output: JSON summary with manifest path, region statuses, and artifact paths
- image attachment: primary `side_by_side` image for each requested region, capped to a small number per call

This directly addresses the build-stage failure mode: the model sees the bad comparison before handing work to Visual QA.

## Backend API

Add a new thin route:

```http
POST /task/:taskID/browser-preview/compare
```

Request:

```ts
{
  targetID: string
  bindingIDs?: string[]
  inlineBindings?: VisualRegionBinding[]
  viewportIDs: Array<"desktop" | "tablet" | "mobile">
}
```

Rules:

- `targetID` is required and must refer to a persisted `browser_preview_target`.
- Raw implementation URL is not accepted.
- Source reference path is not accepted unless it resolves through an authoritative frontend-design/source package artifact.
- Missing bindings return failed region results before browser launch where possible.
- Unknown `targetID` returns route failure before browser launch.

## Persistence

Extend `browser_preview_evidence` payload or add a sibling evidence kind with explicit operation semantics:

```ts
kind: "browser_preview_evidence"
operation_kind: "reference-comparison"
target_id: string
viewport_id: string
region_id: string
manifest_path: string
artifact_paths: {
  source_crop?: string
  implementation_crop?: string
  side_by_side?: string
  diff?: string
}
```

Do not let `latestEvidenceID` silently mix plain preview screenshots and comparison evidence. Queries must be operation-aware.

The existing `capture.png` route is not enough because comparison has multiple images. Add artifact selection:

```http
GET /task/:taskID/browser-preview/evidence/:evidenceID/artifact/:artifactName
```

Allowed artifact names are explicit: `source`, `implementation`, `side-by-side`, `diff`.

## Visual QA And Integrity Consumption

Visual QA should cite comparison artifacts as report evidence:

- `evidence[].type = "visual_diff"` or a new `comparison_collage` type
- `coverage[].evidence_refs`
- `findings[].evidence_refs`
- `production_blockers[].evidence_refs`

Integrity should consume the same artifacts through Visual QA report inspection or a `VisualEvidenceBundle` extension.

Extend `VisualEvidenceBundle` with a comparison section:

```ts
comparison?: {
  manifest_path: string
  regions: Array<{
    region_id: string
    side_by_side_path: string
    source_crop_path: string
    implementation_crop_path: string
    diff_path?: string
  }>
}
```

The report explains why something blocks production. The manifest explains where the evidence lives and what exact region/state/viewport was compared.

## Call Point Inventory

| Surface | Current behavior | Required change |
| --- | --- | --- |
| `packages/opencorvus/src/browser-preview/evidence-runner.ts` | Supports `preview-capture` manifest and screenshots. | Add `reference-comparison` operation with source crop, implementation crop, side-by-side, optional diff, and region diagnostics. |
| `packages/opencorvus/src/browser-preview/verification-core.ts` | Persists single capture by viewport. | Add comparison verification path or a sibling module that persists operation-aware region evidence. |
| `packages/opencorvus/src/browser-preview/persist.ts` | Evidence payload is target/viewport/capture oriented. | Add operation kind, region ID, manifest path, artifact selector support. |
| `packages/opencorvus/src/server/routes/browser-preview.ts` | Has `/capture` and `/evidence/:id/capture.png`. | Add `/compare` and artifact read route. |
| `packages/opencorvus/src/tool/browser-preview.ts` | Starts preview service and persists target. | Keep as target owner; do not add comparison here unless it delegates to backend route. |
| Build agent tools | Build can start preview but has no direct runner-backed compare tool. | Add `browser_preview_compare_region` as runner client. |
| Browser MCP tools | Can screenshot/observe MCP-local pages. | Do not persist MCP-local outputs as task evidence; optional MCP tool must call backend compare route. |
| Visual QA schema | Supports visual evidence and production blockers. | Add or document comparison collage evidence refs. |
| `VisualEvidenceBundle` | Has reference/rendered/evaluation/vision/regions, no collage. | Add comparison artifact section. |
| Overlay preview panel | Displays preview screenshots and live view. | Display comparison artifacts from manifest; iframe remains display-only. |
| OpenAPI/SDK | Knows current capture route. | Regenerate route types for compare and artifact read. |

## Test Plan

- Runner unit: source bbox plus local locator produces source crop, implementation crop, side-by-side, and manifest.
- Runner unit: missing source bbox fails the region without comparing whole page.
- Runner unit: missing local locator fails the region without using text or screenshot fallback.
- Runner unit: source and local boxes are recorded separately and clipped to screenshot bounds.
- Route test: `/compare` rejects missing/unknown `targetID` before browser launch.
- Route test: raw implementation URL is not accepted.
- Persist test: `operation_kind="reference-comparison"` does not overwrite or pollute latest plain capture evidence.
- Artifact route test: `side-by-side`, `source`, `implementation`, and `diff` are selected explicitly.
- Build prompt/tool test: frontend visual work requires region comparison evidence when bindings exist.
- MCP boundary test: MCP comparison tool, if exposed, calls backend route and does not write MCP-local screenshots into task evidence.
- Visual QA test: report can cite comparison artifacts in evidence and production blockers.
- Integrity test: comparison section appears in visual evidence inspection.
- Negative evidence test: comparison scores alone cannot mark Visual QA accepted.

## Acceptance

- Build can request a focused source-vs-local comparison for one changed region and receive a side-by-side image in the same turn.
- The comparison manifest is task, target, viewport, region, and state scoped.
- Source and local region authority are separate and explicit.
- Missing bindings fail loudly and do not trigger full-page or adjacent-region fallback.
- Browser MCP is not a second evidence owner.
- Visual QA and Integrity consume the same manifest artifacts instead of recapturing or reinterpreting the region.
- Poor visual matches are visible to Build before merge/report, reducing late-stage visual QA explosions.

## Non-Goals

- Do not implement a build-local screenshot tool.
- Do not let MCP own task evidence.
- Do not compare by screenshot template matching when source/local bindings are missing.
- Do not turn visual similarity score into a host gate.
- Do not preserve old webpage render/evaluate artifacts as a parallel comparison authority.
- Do not accept arbitrary local filesystem paths as source references.
