# Visual Skeleton And Region Comparison Root Repair

Date: 2026-06-23

## Task

Repair two systemic visual-regression paths exposed by the TradingView World
Economy clone task `tsk_eef6e866c001v3gMMrwSzAcmfb`:

1. `frontend_design` can submit a `visual-html-skeleton` whose rendered
   screenshot exists but whose page structure omits source sections, reorders
   sections, or counts navigation labels as content coverage.
2. `browser_preview_compare_regions` can produce readable
   `reference-comparison` artifacts while using the wrong implementation
   viewport or marking a severe visual mismatch as passed evidence.

## Recalled Constraints

- `2026-05-30-source-skeleton-webpage-generation.md` makes DOM order, visible
  text, and reference pixels authoritative for webpage clone handoff.
- `2026-06-15-region-comparison-evidence-runner.md` separates source bbox
  authority from local implementation locators and rejects missing bindings as
  real failures.
- `2026-06-19-browser-preview-region-comparison-failure-repair-plan.md`
  documented the earlier mixed-coordinate failure. The current repair supersedes
  the source-width capture direction: viewport width differences are normalized
  by the comparison runner and are not themselves visual failures.
- `2026-06-20-reference-comparison-evidence-chain-root-repair.md` makes passed
  `reference-comparison` evidence the thing Visual QA and Integrity can cite for
  required reference parity.
- `2026-06-21-frontend-design-research-adversarial-repair.md` fixed screenshot
  self-attestation, but did not add source-structure coverage for the visual
  skeleton.

## Evidence

The failed task's FD skeleton listed this surface as complete:

```text
Header -> breadcrumb/title/tabs -> SectionAnchorTabs -> Main indicators ->
Global map -> News -> Calendar -> EconomicTrendsTable -> FAQ -> Footer
```

The source evidence contained separate Overview sections:

```text
Economic trends / Inflation map / GDP growth
Countries
Ideas
Economic indicators heatmap
Main indicators
```

Current code facts:

- `submit_frontend_template` verifies artifact-backed screenshot evidence and
  blocking-debt wording, but not source section coverage.
- `source-skeleton-consumption-audit` checks broad text coverage for final app
  consumption, not visual skeleton section inventory or order.
- `compareBrowserPreviewRegions` currently records passed evidence when
  `coverage.implementation_covers_source` is true, even if the visual score is
  far below the existing visual pass threshold.
- Viewport width differences should not be treated as visual failures. The
  comparison runner must compare source bboxes and implementation locators in a
  normalized coordinate system instead of blaming a `1440` reference vs `1280`
  implementation viewport mismatch.

## Repair Plan

### 1. Visual skeleton source-structure coverage

Add a frontend-design visual skeleton coverage inspector.

Input:

- `visual-html-skeleton/index.html`
- `web-clone-source/source-ir/content-model.json`, when present

Algorithm:

- Extract major source section signals from content-model repeated groups whose
  sample texts represent sibling visible content sections.
- For each section sample, derive a source title and secondary content terms.
  A skeleton content block must contain the title and enough secondary terms;
  a navigation label alone does not satisfy coverage.
- Parse the HTML skeleton and inspect content blocks outside navigation,
  header, footer, tabs, menus, and breadcrumbs.
- Require all extracted major source sections to be matched in skeleton content
  blocks and preserve source order.

This is not a TradingView keyword rule. The terms come from source IR for the
current task. If the source package has no content model, this check is not
applicable.

### 2. Region comparison coordinate authority

Keep persisted browser preview target viewports as the capture source, and make
`compareBrowserPreviewRegions` normalize source bboxes into the implementation
viewport coordinate space:

- Compute `scale = implementationViewport.width / sourceImage.width`.
- Preserve the original source bbox as evidence.
- Use the scaled source bbox for implementation coverage checks and diagnostics.
- Do not fail solely because reference and implementation viewport widths
  differ.

### 3. Region comparison pass semantics

`reference-comparison` evidence status must mean the compared region is a usable
passing reference comparison, not merely that crops were generated.

- Keep route health, locator visibility, crop bounds, and coverage failures as
  failed evidence with readable diagnostics/artifacts.
- After crops are generated, evaluate visual similarity using the existing
  `WEBPAGE_EVALUATE_PASS_SCORE` threshold from `verification/visual/evaluate`.
- Persist a failed `reference-comparison` row when the score is below threshold,
  while still writing source crop, implementation crop, side-by-side, and diff
  artifacts for repair.

Visual QA still must inspect artifacts and blockers; numeric scores are not an
external judge verdict. The fix is that failed visual mismatch evidence cannot
be cited as passed reference parity proof.

## Tests

- Frontend-design submit rejects a screenshot-backed visual skeleton whose
  content model requires sections that exist only as nav labels or are missing
  from content blocks.
- Frontend-design submit accepts the same fixture when each source section has
  a matching content block in source order.
- Region comparison visual mismatch now returns failed result/evidence while
  preserving readable comparison artifacts.
- Region comparison keeps the implementation target viewport and scales the
  source bbox into that coordinate space before coverage checks.

## Acceptance

- `visual-html-skeleton` cannot be marked complete when it omits required
  source sections such as Countries or Ideas while mentioning them only in a
  tab/nav label.
- A `1440px` desktop reference comparison can run against a `1280px`
  implementation viewport by scaling source bboxes before coverage checks.
- Low-similarity region artifacts are available for repair but cannot become
  passed `browser_preview_evidence` used by Visual QA or Integrity.
- Targeted tests and typecheck pass.
