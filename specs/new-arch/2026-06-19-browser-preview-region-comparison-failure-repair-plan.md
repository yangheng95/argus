# Browser Preview Region Comparison Failure Repair Plan - 2026-06-19

## Acronyms

- DB: Database, the persisted OpenCorvus task and message store.
- DOM: Document Object Model, the rendered browser element tree.
- GUI: Graphical User Interface, the visible browser surface being verified.
- ID: Identifier, a stable task, target, session, part, evidence, region, or artifact key.
- MPA: Multi Page Application, a frontend build layout with separate HTML entry files per page.
- QA: Quality Assurance, the review stage that validates visual and functional evidence.
- URL: Uniform Resource Locator, the persisted browser preview address.

## Problem

The user asked why the World Economy task appeared to never call the screenshot
comparison tool. A first repair already made missing final reference-comparison
evidence a blocker and stopped `browser_preview` from returning stale targets.
The deeper DB investigation shows a different current failure shape:

1. The bind and compare tools are available and were called.
2. The calls happened after the user's debug snapshot time, so the earlier UI
   observation was correct for that timestamp.
3. The later calls did not produce usable final visual proof because they failed
   in multiple different ways and some artifact paths are not readable from the
   task evidence root.

This is not one bug. Treating it as "the model did not call the tool" misses the
actual root causes.

## Investigation Commands

```powershell
git status --short --branch
rg -n "browser_preview_(bind_local_module|compare_regions)|resolveSourceReferencePath|implementation_covers_source|routeUrl|BrowserPreviewRegionBinding|sourceReferenceArtifactID" packages/opencorvus/src packages/opencorvus/test specs/new-arch
rg -n "Instance\.directory|taskProject|worktree|ProjectRuntimePaths\.browserPreviewJobRoot|browserPreviewJobRoot\(" packages/opencorvus/src packages/opencorvus/test -g "*.ts"
```

DB query used `bun:sqlite` against:

```text
C:/Users/chuan/.local/share/opencorvus/opencorvus.db
```

Task under investigation:

```text
task.id:      tsk_edb303f00001koOay5ND4C22Wo
session.id:   ses_124cfc109ffeC8ofnSAVXF1O5y
directory:    C:\Users\chuan\myhexin-local\demos\economy\economy_7
debug time:   2026-06-18 17:08:44Z
```

## DB Evidence

Recursive session-tree query under `ses_124cfc109ffeC8ofnSAVXF1O5y` found four
relevant tool parts:

| Part ID                          | Tool                                | Status      | Created UTC           | Finding                                                                                                                         |
| -------------------------------- | ----------------------------------- | ----------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `prt_edc374667001PWlSAr40fKipB1` | `browser_preview_bind_local_module` | `error`     | `2026-06-18 19:31:10` | Agent passed `.opencorvus/r/t/S9/qzBwOu/fd/webpage-evidence/reference.png` as `sourceReferenceArtifactID`; runtime rejected it. |
| `prt_edc377f7c001EpbG6dWCzxj54l` | `browser_preview_bind_local_module` | `completed` | `2026-06-18 19:31:25` | Binding succeeded with canonical `web-clone-source/reference.png`.                                                              |
| `prt_edc37c44c001Y5my538NRJYucd` | `browser_preview_compare_regions`   | `completed` | `2026-06-18 19:31:42` | Comparison ran but failed coverage: source `1408x936`, implementation `1216x889`.                                               |
| `prt_eddb64f0d001NROpcxWRxaxEEH` | `browser_preview_compare_regions`   | `completed` | `2026-06-19 02:29:33` | Comparison ran but opened a not-found page and reported the failure as missing locator.                                         |

Task evidence counts in `engine_artifact` now include:

| Kind                       | Operation              | Status   | Count |
| -------------------------- | ---------------------- | -------- | ----- |
| `browser_preview_evidence` | `preview-capture`      | `passed` | 6     |
| `browser_preview_evidence` | `preview-capture`      | `failed` | 12    |
| `browser_preview_evidence` | `reference-comparison` | `passed` | 1     |
| `browser_preview_evidence` | `reference-comparison` | `failed` | 3     |
| `browser_preview_target`   | target artifact        | n/a      | 14    |

The single passed `reference-comparison` evidence is a local-module binding
puzzle, not the final Reference vs Implementation comparison artifact.

Independent sub-agent review reached the same root-cause classification:

- Tool calls exist.
- First failure is an invalid source reference parameter.
- Second failure is bbox/viewport geometry mismatch.
- Third failure is a preview route/target rendering a not-found page, not a
  missing implementation locator.

## Artifact Evidence

### Invalid Source Reference

Rejected input:

```text
.opencorvus/r/t/S9/qzBwOu/fd/webpage-evidence/reference.png
```

Runtime error:

```text
Source reference must resolve to web-clone-source/reference.png or web-clone-source/reference-mobile.png
```

Current code:

- `packages/opencorvus/src/tool/browser-preview-bind-local-module.ts`
  exposes `sourceReferenceArtifactID` as `z.string().min(1)`.
- `packages/opencorvus/src/browser-preview/region-comparison.ts`
  rejects invalid paths later in `resolveSourceReferencePath`.

This is a tool-contract ergonomics bug: the model-facing schema accepts values
that the runtime contract will always reject.

### Viewport And Coverage Mismatch

Manifest:

```text
C:\Users\chuan\myhexin-local\demos\economy\economy_7\.opencorvus\r\t\S9\qzBwOu\bp\1b\nvnCGk\manifest.json
```

Side-by-side:

```text
C:\Users\chuan\myhexin-local\demos\economy\economy_7\.opencorvus\r\t\S9\qzBwOu\bp\1b\nvnCGk\regions\desktop\default\desktop_default_economic-trends-repair-slice-8dea49ba\side-by-side.png
```

Source reference dimensions:

```text
web-clone-source/reference.png        1440x6571
web-clone-source/reference-mobile.png 390x7825
```

Comparison output:

```json
{
  "source_bbox": { "x": 16, "y": 278, "width": 1408, "height": 936 },
  "implementation_bbox": { "x": 32, "y": 334, "width": 1216, "height": 889 },
  "coverage": {
    "source_width": 1408,
    "source_height": 936,
    "implementation_width": 1216,
    "implementation_height": 889,
    "implementation_covers_source": false
  },
  "reason": "Implementation crop is smaller than source region: source=1408x936 implementation=1216x889."
}
```

Current code:

- `packages/opencorvus/src/browser-preview/viewport.ts` fixes `desktop` at
  `1280x800`.
- `packages/opencorvus/src/browser-preview/region-comparison.ts` directly
  compares source bbox pixels to implementation bbox pixels:

```ts
Math.ceil(input.implementationBox.width) >= Math.ceil(input.sourceBox.width)
```

The source desktop screenshot is 1440px wide, but the implementation desktop
capture is 1280px wide. The coverage check is mathematically comparing two
different coordinate systems.

### Route Not Found Misclassified As Locator Failure

DB target:

```text
art_eddb2b37c001Xgj461108C7j1E
http://127.0.0.1:43881/world-economy/
```

DB manifest path:

```text
.opencorvus/r/t/S9/qzBwOu/bp/mG/0rZAib/manifest.json
```

The path above does not exist under the task root. The actual file exists under
the goal worktree:

```text
C:\Users\chuan\myhexin-local\demos\economy\economy_7\.opencorvus\r\w\5m\BJ3oSy\worktree\.opencorvus\r\t\S9\qzBwOu\bp\mG\0rZAib\manifest.json
```

Implementation full screenshot:

```text
C:\Users\chuan\myhexin-local\demos\economy\economy_7\.opencorvus\r\w\5m\BJ3oSy\worktree\.opencorvus\r\t\S9\qzBwOu\bp\mG\0rZAib\implementation\desktop\full.png
```

The screenshot renders:

```text
This page could not be found
```

Yet the evidence reason is:

```text
Implementation locator did not match any visible element.
```

The source code contains the locator in both root and goal worktree:

```text
C:\Users\chuan\myhexin-local\demos\economy\economy_7\src\pages\world-economy\components\EconomicTrendsDashboard.tsx:14
C:\Users\chuan\myhexin-local\demos\economy\economy_7\.opencorvus\r\w\5m\BJ3oSy\worktree\src\pages\world-economy\components\EconomicTrendsDashboard.tsx:14
```

This is a route/target runtime failure, not a locator failure.

Current code:

- `packages/opencorvus/src/browser-preview/evidence-runner.ts` region
  comparison sidecar navigates with:

```js
new URL(route || "/", base).toString()
```

- It immediately runs `locate(page, binding.locator)`.
- It does not collect the preview-capture HTTP, asset, DOM, JavaScript, glyph,
  or pixel layers before blaming the locator.

### Artifact Root Split

`browser_preview_compare_regions` and `browser_preview_bind_local_module` call
runtime code with:

```ts
projectRoot: Instance.directory
```

In a goal worktree session, `Instance.directory` is the goal worktree. The DB
stores task-scoped runtime-relative paths, and readers later resolve them
against the task project root. This creates registered-but-unreadable evidence.

Existing project model already distinguishes:

- `Instance.directory`: active session directory, which may be a goal worktree.
- `Instance.project.worktree`: primary project worktree recorded as the project
  identity root.
- `Instance.worktree`: active sandbox directory.

Browser preview task evidence must be rooted at the task evidence owner, not at
the current goal worktree.

## Root Causes

1. Model-facing source reference schemas are too broad.
   The runtime source contract is canonical and narrow, but the Zod tool
   parameters accept arbitrary strings. This lets the model choose a path that
   cannot ever pass.

2. Region comparison has no source viewport authority.
   A 1440px source reference is compared against a 1280px implementation
   capture under the same `desktop` label. The tool then reports an
   implementation crop failure even when the mismatch is actually a coordinate
   system mismatch.

3. Region comparison does not classify route health before locator lookup.
   A route that renders a not-found page is currently reported as a locator
   miss. This hides the actionable failure: the target URL or route is wrong.

4. Browser preview evidence uses active session directory as artifact root.
   Goal worktree sessions can write `.opencorvus/r` under the worktree while DB
   evidence is later read from the task project root.

5. Failed comparison output lacks enough diagnostics for agents to self-repair.
   The failed result does not include route URL, response status, DOM size, page
   title, screenshot path, source image dimensions, requested viewport
   dimensions, or normalized comparison dimensions.

## Non-Root Causes

- Tool registration is not the current blocker. The tools are in the visual QA
  toolset and DB proves calls occurred.
- `data-oc-region="economic-trends-dashboard"` is not missing from source code.
- AInvest component implementation is not the cause of the `This page could not
be found` screenshot.
- Visual QA prompt text alone cannot fix this; the tool contract and runner
  diagnostics must be corrected.

## Repair Plan

### Desktop-only scope correction - 2026-06-19

The World Economy clone acceptance currently only needs the desktop page. Mobile
and tablet evidence must not be used to block this task's visual comparison.

For desktop Reference vs Implementation comparison, the source desktop reference
screenshot width is the viewport authority. The runner should capture the local
implementation at that same desktop width instead of failing because the built-in
`desktop` preset is `1280px` while `web-clone-source/reference.png` is `1440px`.
This keeps a single coordinate source and avoids manual bbox normalization.

Non-desktop mismatches remain explicit failures unless a future task introduces
an intentional source reference for that viewport.

### Phase 1 - Canonical Source Reference Schema

Create one exported schema for source reference IDs, for example:

```ts
export const BrowserPreviewSourceReferenceArtifactID = z.enum([
  "reference.png",
  "reference-mobile.png",
  "web-clone-source/reference.png",
  "web-clone-source/reference-mobile.png",
])
```

Use this schema in:

- `BrowserPreviewRegionBinding.source.reference_artifact_id`
- `BrowserPreviewBindLocalModuleToolParameters.sourceReferenceArtifactID`
- Any route/server compare request schema that accepts inline bindings.

Keep `resolveSourceReferencePath` as the filesystem boundary check, but invalid
IDs should fail at schema parse time before side effects.

Tests:

- `packages/opencorvus/test/browser-preview/region-comparison.test.ts`
  should assert the binding schema rejects `.opencorvus/.../reference.png`.
- `packages/opencorvus/test/tool/browser-preview.test.ts` should assert
  `browser_preview_bind_local_module` rejects non-canonical source references
  before local capture.

### Phase 2 - Task Evidence Root Single Source

Introduce a browser-preview evidence root resolver that returns the project
identity root for task artifacts:

```ts
function browserPreviewTaskEvidenceRoot(): string {
  return Instance.project.worktree
}
```

Use it in:

- `packages/opencorvus/src/tool/browser-preview.ts`
- `packages/opencorvus/src/tool/browser-preview-bind-local-module.ts`
- `packages/opencorvus/src/tool/browser-preview-compare-regions.ts`
- `packages/opencorvus/src/server/routes/browser-preview.ts` for evidence
  reads and writes.

Do not change code-editing tools to use this root. The implementation worktree
still owns source edits. Only task-scoped runtime evidence should use the
primary evidence root.

Tests:

- Add a tool or persistence regression where `Instance.provide` runs under a
  nested goal worktree directory and `compareBrowserPreviewRegions` persists
  evidence readable from the primary task root.
- Assert `findReadableBrowserPreviewEvidenceByID({ projectRoot: primaryRoot })`
  returns the failed and passed comparison evidence.
- Assert no artifact path is stored relative to the nested goal worktree.

### Phase 3 - Route Health Diagnostics Before Locator Diagnosis

Extend `runBrowserPreviewRegionComparisonCapture` sidecar to collect route
diagnostics after each navigation and before locator lookup:

- final routed URL
- HTTP status and content type when available
- main response body length when available
- failed non-favicon requests
- console and page errors
- DOM body descendant count
- document title
- screenshot path for the route attempt

If the route does not render an app page, return a region failure like:

```text
Implementation route did not render a valid app page: route=/world-economy/ url=http://127.0.0.1:43881/world-economy/ status=404 dom_descendants=...
```

Then only run locator diagnosis if route health passes. This is not a fallback
or a route gate. It is correct failure classification for the same capture path.

Tests:

- Add `packages/opencorvus/test/browser-preview/region-route-diagnostics.test.ts`.
- Server fixture returns a not-found page for `/world-economy/` and a valid app
  page for `/world-economy`.
- Assert the failed region reason starts with route health, not
  `Implementation locator did not match any visible element`.
- Assert the route screenshot still exists as evidence.
- Assert a valid app page with a genuinely missing locator still reports the
  locator failure.

### Phase 4 - Source Viewport Authority And Geometry Normalization

Do not silently accept mixed coordinate systems. Add explicit source viewport
metadata to the comparison input or derive it from source image dimensions and
persist it in each region result:

```ts
source_image_size: {
  width: number
  height: number
}
implementation_viewport: {
  width: number
  height: number
}
scale: {
  x: number
  y: number
}
normalized_source_bbox: BrowserPreviewRegionBox
```

Preferred behavior:

1. If the source reference width matches the requested viewport width, keep the
   current strict pixel coverage check.
2. If the source reference width differs from the requested viewport width, fail
   before visual scoring with an explicit geometry contract error unless the
   binding supplies an approved source-to-implementation viewport mapping.
3. In a follow-up implementation pass, allow the runner to capture the
   implementation at the source reference viewport width for the same semantic
   viewport. That is better than making every agent hand-normalize source bboxes.

Do not repeat the economy task's manual workaround where normalized bboxes are
invented by the agent. That creates a second source of truth. The runner should
own the source-viewport contract.

Tests:

- Existing under-crop test should still fail when source and implementation
  share a viewport and the implementation crop is genuinely smaller.
- New test with `reference.png` width 1440 and desktop preset 1280 should fail
  with `source reference viewport width 1440 does not match implementation
viewport width 1280`, not with `Implementation crop is smaller`.
- New accepted-path test should use a matching source reference width and prove
  the current crop coverage behavior still works.

### Phase 5 - Result Payload And Attachment Completeness

For every failed or passed region comparison, persist these fields in the
manifest and evidence capture:

- `source_image_size`
- `implementation_fullpage_size`
- `implementation_viewport`
- `route_diagnostics`
- `source_reference_artifact_id`
- `source_reference_path`
- `implementation_screenshot_path`
- `route_url`
- `locator`

For failed route or locator regions, attach or persist the implementation
full-page screenshot as a readable artifact even when there is no side-by-side
crop. Otherwise the user sees "comparison failed" but cannot inspect the real
screen that failed.

Tests:

- Failed route evidence has an implementation screenshot artifact readable from
  the task root.
- Failed locator evidence has diagnostics that include the locator and route.
- `findReadableBrowserPreviewEvidenceByID` treats failed evidence with readable
  diagnostic artifacts as readable; passed evidence still requires visual
  artifacts.

### Phase 6 - Prompt And Acceptance Contract Tightening

After the runtime fixes, update visual QA and build prompt text to require:

- Use only canonical source reference IDs.
- If comparison fails due to route health, fix preview target or route first.
- If comparison fails due to source viewport mismatch, do not normalize bboxes
  manually. Re-run with a matching source reference or runner-supported
  viewport mapping.
- Accepted visual parity must cite `reference-comparison` artifacts that are
  readable from the task evidence root.

Tests:

- `packages/opencorvus/test/visual-qa/strict-reference-fidelity.test.ts`
- `packages/opencorvus/test/build-agent/prompt-goal-discipline.test.ts`
- `packages/opencorvus/test/orchestrator/architect-fidelity-gate.test.ts`

## Implementation Order

1. Schema narrowness for source references.
2. Evidence root resolver and read/write path tests.
3. Route diagnostics and failure classification.
4. Source viewport metadata and mismatch error.
5. Failed-comparison readable artifacts.
6. Prompt contract updates.

This order makes the earliest fixes small and high-signal while preserving the
hard constraint that missing or mismatched evidence must fail loudly.

## Acceptance

The repair is complete only when all of these are true:

- `browser_preview_bind_local_module` cannot accept arbitrary `.opencorvus/...`
  source paths.
- `browser_preview_compare_regions` writes artifacts under the task evidence
  root even when invoked from a goal worktree.
- Evidence paths stored in DB are readable from the task project root.
- A not-found implementation page is reported as route health failure, not as a
  locator miss.
- A valid page with a missing locator is still reported as a locator miss.
- A 1440 source reference compared to a 1280 implementation viewport produces
  an explicit source viewport mismatch, not an under-crop diagnosis.
- A genuine under-crop at matching viewport scale still fails.
- Failed comparison artifacts include enough readable screenshots and
  diagnostics for the next agent to repair without guessing.
- Visual QA accepted reports cannot cite local binding puzzles as final
  Reference vs Implementation proof.

## Verification Matrix

| Area                              | Command                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Browser preview source schema     | `bun test packages/opencorvus/test/browser-preview/region-comparison.test.ts --timeout 120000`                                                   |
| Tool schema and readable evidence | `bun test packages/opencorvus/test/tool/browser-preview.test.ts --timeout 120000`                                                                |
| Route diagnostics                 | `bun test packages/opencorvus/test/browser-preview/region-route-diagnostics.test.ts --timeout 120000`                                            |
| Route state regression            | `bun test packages/opencorvus/test/browser-preview/region-route-state.test.ts --timeout 120000`                                                  |
| Visual QA contract                | `bun test packages/opencorvus/test/visual-qa/strict-reference-fidelity.test.ts packages/opencorvus/test/visual-qa/agent.test.ts --timeout 60000` |
| Type safety                       | `bun run --cwd packages/opencorvus typecheck`                                                                                                    |

## Risks And Constraints

- Do not add fallback route retries such as silently trying both
  `/world-economy` and `/world-economy/`. The runner should report the route it
  actually used and the app should pass an intentional route.
- Do not relax visual comparison into score-only acceptance. Scores remain
  diagnostics only.
- Do not let agents hand-normalize source bboxes as a normal workflow. That
  duplicates source authority.
- Do not move implementation editing or file tool roots to the task evidence
  root. Only browser preview evidence artifacts need the primary root.
- Existing dirty worktree files are unrelated and must not be staged with this
  repair unless they are intentionally part of the implementation pass.
