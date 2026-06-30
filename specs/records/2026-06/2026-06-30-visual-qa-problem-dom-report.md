# Visual QA Problem DOM Report

Date: 2026-06-30

## Recall

- User request: change Visual QA strategy and report so it passes the
  problematic local rendered DOM directly to Build. The user rejected making
  annotated images the primary repair signal, because DOM reports give Build
  selectors, markup, computed style, and code-search terms without relying on
  image interpretation.
- Acceptance:
  - Visual QA reports include structured problem DOM regions for visual
    blockers when the issue maps to rendered DOM.
  - Each DOM region links to blocker IDs and carries selector/locator, DOM path,
    local HTML excerpt, ancestor/sibling context, text, bbox, computed style,
    attributes, code-search terms, and evidence refs.
  - The report still requires screenshot-bearing evidence for visual
    acceptance; DOM reports are repair input, not visual proof.
  - Do not add a new Browser MCP tool or a duplicate browser-preview screenshot
    source for this change.
- Hard constraints:
  - No fallback, no compatibility alias, no host gate, no duplicate screenshot
    source.
  - Preserve browser-preview target/evidence as the single runtime source.
  - Do not weaken reference-comparison semantics.
  - Add focused tests for every code contract change.
  - Specs live under root `specs/records/2026-06` and must be indexed.
- Sources read before implementation:
  - `AGENTS.md`
  - `specs/README.md`
  - `specs/records/2026-06/README.md`
  - `specs/records/2026-06/2026-06-29-browser-preview-layout-geometry-diagnostic.md`
  - `specs/records/2026-06/2026-06-29-browser-preview-reference-regions-tool.md`
  - `specs/records/2026-06/2026-06-30-browser-preview-viewport-slice-binding.md`
  - `packages/opencorvus/src/browser-preview/persist.ts`
  - `packages/opencorvus/src/browser-preview/layout-geometry-diagnostic.ts`
  - `packages/opencorvus/src/tool/browser-preview-layout-geometry.ts`
  - `packages/opencorvus/src/tool/browser-preview-compare-scroll-slices.ts`
  - `packages/opencorvus/src/tool/browser-preview-tool-ids.ts`
  - `packages/opencorvus/src/agent/tool-pool-contract.ts`
  - `packages/opencorvus/src/visual-qa/static-tools.ts`
  - `packages/opencorvus/src/visual-qa/schema.ts`
  - `packages/opencorvus/src/visual-qa/output-tools.ts`
  - `packages/opencorvus/src/visual-qa/context.ts`
- Whole-repository search evidence:
  - `rg -n "browser_preview_layout_geometry|browser_preview_compare_scroll_slices|browser_preview_reference_regions|VISUAL_QA_SESSION_TOOL_IDS|VISUAL_QA_IMPLEMENTATION_TOOL_IDS|submit_visual_qa_report|production_blockers|unresolved_code_module_problems|Build Evidence Pointers|Prior Visual QA Pointers|reference_comparison_evidence_refs|browser_preview_evidence|operationKind" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-06 -g "*.ts" -g "*.txt" -g "*.md"`
  - `rg -n "playwright|sharp|pngjs" package.json packages/opencorvus/package.json packages/overlay/package.json`
  - `rg -n "annotation|annotated|draw|bbox|box|sharp|png|screenshotPath|attachments" packages/opencorvus/src/browser-preview packages/opencorvus/src/tool/browser-preview-layout-geometry.ts packages/opencorvus/test/tool packages/opencorvus/test/browser-preview`
- Independent agent feedback: none for this implementation round. A prior
  independent review of `7a6cfdaf4c` found no blocker in the browser-preview
  module binding convergence, and noted that MCP inclusion was covered by mock
  tool discovery rather than a real Browser MCP build session.

## Decision

Do not add a new tool in this round.

Change Visual QA's strategy and terminal report contract so failed visual
reports carry `problem_dom_regions[]`. Browser MCP and browser-preview tools may
still be used by the agent to inspect the page, but the persisted report is the
handoff channel to Build.

DOM means Document Object Model: the rendered browser element tree. The report
captures the local rendered DOM area that exposes a blocker, not source code
guesses and not a standalone image annotation.

## Contract

New report field:

`problem_dom_regions[]`, each with:

- `id`: stable report-local DOM region ID;
- `blocker_ids`: production blocker IDs exposed by this DOM region;
- `region`: human-readable region name;
- `route`: route where the DOM was inspected;
- `viewport`: viewport used for the DOM observation;
- `locator`: stable selector or locator expression used to find the node;
- `dom_path`: concise element path from the target node through useful
  ancestors;
- `outer_html_excerpt`: bounded target node markup excerpt;
- `ancestor_context`: nearby parent container summaries;
- `sibling_context`: nearby sibling summaries;
- `text_content`, `role`, and `accessible_name` when available;
- `bbox`: rendered CSS pixel box;
- `computed_style`: key layout/typography/color/overflow values;
- `attributes`: class, id, data attributes, ARIA attributes, and similar
  repair-relevant attributes;
- `code_search_terms`: strings Build should grep first;
- `evidence_refs`: screenshot, visual diff, geometry, or command evidence used
  to justify this DOM report;
- `notes`: concise repair guidance tied to the DOM facts.

## Report Contract

`production_blockers[].evidence_refs` still cite visual evidence. When a blocker
maps to rendered DOM, Visual QA should also include a matching
`problem_dom_regions[]` entry with the same blocker ID.

The host must not reject a failed report solely because a DOM region is absent:
some failures are route-level, data-contract, screenshot-only, or unrendered
states. The prompt makes DOM reporting the expected repair handoff when the DOM
is observable, avoiding a host gate.

## Acceptance

- No new Browser MCP or browser-preview tool is added in this round.
- Visual QA schema accepts `problem_dom_regions[]`.
- Visual QA terminal report renders `problem_dom_regions[]` clearly for Build.
- Visual QA prompt instructs agents to include DOM reports for localizable
  visual blockers.
- Build prompt/acceptance overlay instructs agents to use Visual QA DOM reports
  as first repair pointers while still verifying with screenshots afterward.
- Focused tests cover schema/report rendering and prompt guidance.
