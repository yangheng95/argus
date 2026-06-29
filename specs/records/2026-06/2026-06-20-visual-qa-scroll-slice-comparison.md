# Visual QA Scroll Slice Comparison

Date: 2026-06-20

## Acronyms

- API: Application Programming Interface, the typed route or tool contract consumed by agents.
- ID: Identifier, a stable task, target, viewport, artifact, or evidence key.
- MCP: Model Context Protocol, the browser automation protocol used by external browser tools.
- QA: Quality Assurance, the final visual review stage.
- URL: Uniform Resource Locator, a browser address.

## Problem

`region comparison tool` is the authoritative Reference vs
Implementation proof for bound regions, but it is too heavy for final
whole-page visual QA. A finished clone can still need a quick visual sweep at a
known scroll offset, where a reviewer wants to compare the same vertical slice
of the already captured reference screenshot against the live implementation.

The current alternatives are not acceptable:

- Reopening the source URL repeats expensive and unstable source capture.
- Standalone screenshots are easy to inspect but too easy to cite as final
  reference-parity proof.
- For unfinished pages, equal scroll offsets are not meaningful because the
  implementation height and layout may still be drifting.

## Decision

Add a side-by-side scroll-slice tool named
`browser_preview_compare_scroll_slices`.

The tool:

1. Requires a persisted task-scoped `browser_preview_target` ID.
2. Resolves the reference image from the existing task source package:
   `web-clone-source/reference.png` or `web-clone-source/reference-mobile.png`.
3. Crops the reference PNG at the requested absolute `scrollY` and
   `sliceHeight`.
4. Opens the implementation target, navigates to the requested route, sets the
   viewport width to the resolved reference PNG width and viewport height to
   `sliceHeight`, scrolls to the same absolute `scrollY`, verifies the actual
   scroll position, captures the visible implementation slice, and composes a
   side-by-side PNG.
5. Returns the side-by-side PNG as a tool attachment so visual-qa can inspect it
   in the same turn.

The tool does not persist `browser_preview_evidence` and must not produce
`operationKind="reference-comparison"`. Its output can be cited as supporting
`visual_diff` evidence in a Visual QA report, but it cannot satisfy
`reference_parity.reference_comparison_evidence_refs`.

## Non-Negotiable Constraints

- Build and Visual QA may use this tool after the page is believed to be
  complete enough that absolute scroll offsets are meaningful.
- No source URL parameter is accepted. Existing reference screenshots are the
  source of visual truth.
- No fallback behavior:
  - Do not clamp `scrollY` to the end of the page.
  - Do not use proportional scroll mapping.
  - Do not auto-search for similar regions.
  - Do not try adjacent routes.
  - Do not retry with a different reference image.
- Width mismatch is a failed tool result, not an implicit resize or normalized
  comparison.
- Missing reference screenshot, missing target, unreachable route, insufficient
  page height, or inaccurate final scroll position all fail loudly.

## Call Point Inventory

| Surface                                                           | Current behavior                                                                                  | Required change                                                                                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/tool/browser-preview-tool-ids.ts`        | Defines browser preview repair tool IDs.                                                          | Add a distinct scroll-slice tool ID but do not add it to `BROWSER_PREVIEW_REPAIR_TOOL_IDS`, so integrity/build repair chains remain unchanged.                                |
| `packages/opencorvus/src/tool/registry.ts`                        | Globally registers browser preview tools.                                                         | Register the new tool so visual-qa can initialize it through the normal tool adapter.                                                                                         |
| `packages/opencorvus/src/visual-qa/static-tools.ts`               | Allows browser preview comparison helpers.                                                        | Keep `browser_preview_compare_scroll_slices` in visual-qa implementation tools.                                                                                               |
| `packages/opencorvus/src/agent/tool-pool-contract.ts`             | Defines private build tools.                                                                      | Add `browser_preview_compare_scroll_slices` to build private tools.                                                                                                           |
| `packages/opencorvus/src/visual-qa/agent.ts`                      | Builds visual-qa tool set and prompt.                                                             | Instantiate the new tool and prompt visual-qa to use it as final whole-page supporting evidence, not reference-parity proof.                                                  |
| `packages/opencorvus/src/browser-preview/region-comparison.ts`    | Owns canonical reference image resolution and side-by-side composition internals.                 | Reuse canonical reference resolution. If composition helpers remain private, create a local helper with the same explicit labels.                                             |
| `packages/opencorvus/src/browser-preview/evidence-runner.ts`      | Runs Node-backed Playwright capture jobs.                                                         | Add or reuse a Node sidecar path for exact scroll-slice capture without changing region comparison semantics.                                                                 |
| `packages/opencorvus/src/visual-qa/schema.ts` / `output-tools.ts` | Requires `reference_comparison` evidence refs for formal reference parity.                        | Leave unchanged so scroll-slice evidence cannot satisfy reference parity.                                                                                                     |
| Tests                                                             | Cover visual-qa tool surface, browser preview tool registry, and reference-comparison acceptance. | Add focused tests proving visual-qa gets the tool, build does not, the tool rejects raw source URLs, and Visual QA still rejects scroll-slice-only accepted reference parity. |

## Acceptance

- `browser_preview_compare_scroll_slices` is available to visual-qa and build.
- The tool accepts `targetID`, `route`, `viewportID`,
  `sourceReferenceArtifactID`, `scrollY`, and `sliceHeight`; it rejects raw
  source or implementation URLs.
- The reference side is cropped from existing source PNG artifacts only.
- The implementation side is captured from a persisted task preview target.
- The returned tool result includes a side-by-side PNG attachment.
- Scroll-slice output cannot be used as
  `region comparison tool`/`reference-comparison` proof.
- Focused tests pass and no existing reference-comparison tests are weakened.

## Validation Findings

- Provider schema stress exposed two existing schema hygiene defects while
  validating the new tool surface:
  - discriminated-union enum merging dropped field descriptions in provider
    JSON schema output;
  - `panel.update_goal.acceptance_specs` hid its payload behind
    `z.unknown()`.
- These defects were fixed at their source instead of loosening tests:
  provider schema merge now preserves field metadata, `panel.update_goal`
  reuses `AcceptanceSpecSchema`, and panel/mission-state tool parameters now
  include concrete model-facing field descriptions.
