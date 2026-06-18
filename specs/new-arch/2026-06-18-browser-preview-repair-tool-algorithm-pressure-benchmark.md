# Browser Preview Repair Tool Algorithm Pressure Benchmark - 2026-06-18

## Acronyms

- API: Application Programming Interface, the backend contract used by tools and routes.
- ARIA: Accessible Rich Internet Applications, semantic attributes used to locate accessible UI regions.
- DOM: Document Object Model, the rendered browser tree inspected by Playwright.
- ID: Identifier, a task, target, viewport, region, artifact, or evidence key.
- MoM: Month-over-month, a period comparison label common in metric cards.
- QA: Quality Assurance, the visual review stage that consumes comparison evidence.
- QoQ: Quarter-over-quarter, a period comparison label common in metric cards.
- S&P: Standard & Poor's, the financial index name commonly rendered as `S&P 500`.
- URL: Uniform Resource Locator, the persisted browser preview target address.
- YoY: Year-over-year, a period comparison label common in metric cards.

## Task

Stress test the browser preview repair toolchain until each parsing module returns
the correct result across representative module scenarios:

1. `browser_preview` must persist a task-scoped preview target.
2. `browser_preview_bind_local_module` must capture only visible, non-zero local
   modules and bind them to the correct source module candidate.
3. `browser_preview_compare_regions` must consume those bindings and persist
   `reference-comparison` evidence without direct URL or whole-page substitution.
4. Build-stage registry tools must receive the same task context as stage
   runtime tools, otherwise the algorithms cannot be reached in real tasks.

## Input And Output

Input:

- Task-scoped preview targets persisted as `browser_preview_target` artifacts.
- Source evidence under the frontend-design paths:
  `web-clone-source/reference.png`, `visual-surface-candidates.json`,
  `source-ir/layout-map.json`, and
  `frontend-design-skeleton/src/data/sourceDomRegions.ts`.
- Local implementation locators using `data-oc-region`, `data-testid`, role/name,
  or declared component selectors.

Output:

- Deterministic unit and runner tests under `packages/opencorvus/test/browser-preview`.
- A runner regression test under `packages/opencorvus/test/agent` proving taskID
  reaches registry tools.
- For successful comparisons, persisted `operation_kind="reference-comparison"`
  evidence with source crop, implementation crop, and side-by-side artifacts.
- For failed parses, failed evidence or thrown tool errors that name the broken
  authority; no full-page or adjacent-region replacement is allowed.

## Timeout Strategy

Manual benchmark runs must use the existing inactivity-aware process runner, not
a mechanical process-start deadline:

```powershell
bun test test/browser-preview/local-module-source-binding.test.ts test/browser-preview/region-comparison.test.ts test/browser-preview/region-visible-locator.test.ts test/browser-preview/region-source-bbox.test.ts test/browser-preview/region-route-state.test.ts test/browser-preview/region-strict-schema.test.ts test/agent/runner-prompt.test.ts test/tool/browser-preview.test.ts
```

When wrapped by benchmark automation, the wrapper refreshes activity on stdout
or stderr and fails after an idle window. Bun's per-test timeout remains only a
last-resort hung-test guard for Playwright calls.

## Pressure Cases

| Case | Module | Expected Result |
| --- | --- | --- |
| Page-wide source candidate shares every local anchor | Candidate scoring | Select the module-sized source candidate, not the page shell. |
| CamelCase component filenames such as `HeaderNavigation.tsx` | Anchor normalization | Split component identity into usable anchors such as `header navigation`. |
| Non-Latin visible labels such as Chinese headings and table labels | Anchor normalization | Preserve Unicode letter/number anchors and match the correct source module. |
| Signed numeric labels such as `+2.1%` and `-2.1%` | Anchor normalization | Preserve sign characters so positive and negative metric cards do not collapse into the same anchor. |
| Grouped currency values such as `$1,234.56` and `$1,234,567.89` | Anchor normalization | Preserve comma group separators inside numbers so different metric magnitudes remain distinct. |
| Acronym anchors such as `GDP` near longer words such as `GDPR` | Anchor matching | Match normalized token or phrase boundaries so short metric acronyms do not bind to unrelated longer labels. |
| Dotted acronyms such as `U.S.` versus plain `US` beside decimal values | Anchor normalization | Treat dotted letter acronyms as the same anchor without collapsing decimal numbers. |
| Period-over-period labels such as `Q/Q`, `Y/Y`, and `M/M` versus `QoQ`, `YoY`, and `MoM` | Anchor normalization | Treat slash and compact period comparison labels as the same metric anchor. |
| Ampersand tickers such as `S&P 500` versus implementation text `SP 500` | Anchor normalization | Treat single-letter ampersand tickers as compact symbols so source weighting cannot select adjacent index modules. |
| Numeric ranges such as `4.25%–4.50%` versus implementation text `4.25%-4.50%` | Anchor normalization | Preserve numeric range identity without treating the second number as a negative metric. |
| Locale decimal values such as `1,2%` versus implementation text `1.2%` | Anchor normalization | Normalize decimal comma values while preserving thousands separators such as `$1,234.56`. |
| Fullwidth metric text such as `２.１％` versus implementation text `2.1%` | Anchor normalization | Normalize Unicode compatibility forms so fullwidth digits and percent signs match ASCII implementation text. |
| Present but malformed source evidence file | Source evidence parsing | Fail with the corrupt file path instead of silently dropping that evidence. |
| Present but wrong-shaped `visual-surface-candidates.json` or `layout-map.json` | Source evidence parsing | Fail with the wrong-shaped file path and expected top-level array field instead of treating it as no candidates. |
| Same visible text but different visual-surface `rootNodeId` / `sourceRefs` | Source evidence parsing | Preserve source DOM references so explicit source-node anchors can disambiguate repeated modules. |
| Same visible text but different `sourceDomRegions.ts` `sourceNodeId` / `sourceSegmentId` | Source evidence parsing | Preserve generated source region references so source-node and segment anchors can disambiguate repeated modules. |
| Same visible text but different `layout-map.json` `selector` / `role` | Source evidence parsing | Preserve layout selector and role references so source selector anchors can disambiguate repeated layout nodes. |
| Two source candidates have the same anchors, score, and size | Candidate scoring | Fail as ambiguous; do not arbitrarily choose the first candidate. |
| Hidden or collapsed local module locator | Local capture | Fail before writing passed binding evidence. |
| Local module located by `data-testid`, ARIA role/name, or owned CSS selector | Local capture | Capture and bind the same visible module through each supported locator kind. |
| Source bbox outside image bounds | Region comparison | Persist failed reference-comparison evidence with no crops. |
| Hidden or zero-size implementation region | Region comparison | Persist failed reference-comparison evidence with no one-pixel crop. |
| Below-fold implementation region | Region comparison | Crop from a full-page implementation screenshot so valid offscreen module bboxes do not fail as viewport-clipped artifacts. |
| Mobile source reference artifact | Region comparison | Use `reference-mobile.png` with the mobile viewport and persist mobile source/local comparison artifacts instead of silently comparing desktop evidence. |
| Multiple visual regions in one route and viewport | Region comparison | Persist independent source crop, implementation crop, side-by-side, diff, and evidence IDs for each region without cross-wiring artifacts. |
| Multiple routes in one viewport | Region runner | Navigate per binding and restore route-specific region coordinates. |
| Playwright sidecar lifecycle errors | Evidence runner | Propagate locator and close errors instead of converting them into missing regions or successful captures. |
| Tool-level bind output feeds compare input | Toolchain integration | `browser_preview_bind_local_module` metadata binding is accepted by `browser_preview_compare_regions`, which persists `reference-comparison` evidence and side-by-side artifacts. |
| Build registry tools on task-backed sessions | Tool context | `SessionPrompt.prompt(...).extra.taskID` equals the current task ID. |

## Acceptance

- Targeted pressure tests pass.
- Candidate scoring prefers the correct module when page-level candidates carry
  broader matching text.
- Local module binding never converts hidden or zero-size elements into passed
  evidence.
- Build sessions can execute task-scoped registry preview tools because taskID
  is present in the tool context.
- The repair toolchain has at least one successful tool-level
  `browser_preview_bind_local_module` -> `browser_preview_compare_regions`
  regression, proving the screenshot comparison tool is reachable through the
  same path agents use.
- No raw URL, output directory, whole-page comparison, or adjacent-region
  substitution is introduced.
- After tests pass, review the changed code and generated test evidence once
  more before claiming completion.
