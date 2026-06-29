# Generic Source Component Extraction

Date: 2026-06-02

## Problem

TradingView visual fidelity is currently capped by a broader extraction defect. The source clone pipeline treats site-specific class names, `data-qa-id` values, and business words as semantic component boundaries. That improves some TradingView fixtures, but it does not generalize to structurally equivalent pages in other domains and it leaves unmatched TradingView variants as generated source-dom debt.

## Evidence

Repository search covered these affected surfaces before implementation:

- `packages/opencorvus/src/web-clone/source-skeleton.ts`
  - `buildContentModel` emits tables, lists, cards, controls, links, media, and repeated groups, but it does not publish a unified structural component pattern contract.
  - `collectRepeatedGroups` uses `structuralSignature`, and `structuralSignature` includes class tokens, so hashed or stateful classes can split identical repeated items.
  - `looksLikeCard` still relies partly on class words such as card, tile, item, article, and panel.
- `packages/opencorvus/src/web-clone/source-project-generator.ts`
  - `isSemanticDataTableCandidate`, `isSemanticMetricRankingCardCandidate`, `isSemanticMetricChartCardCandidate`, `isSemanticEventCardListCandidate`, `isSemanticNewsListCandidate`, `isSemanticHeaderNavigationCandidate`, `isSemanticMapSurfaceCandidate`, and `classifySourceDomReplacementKind` contain TradingView, finance, news, and economic text or selector dependencies.
  - `shouldExtractSourceRegion` is the central region boundary decision and currently calls the specialized candidates directly.
  - `sourceDomEvidenceSources`, `sourceDomDataSources`, `sourceDomAssetSources`, `sourceDomFirstReplacementStep`, and `sourceDomParityGuard` consume replacement kinds, so the kind contract must stay single-source.
- `packages/opencorvus/src/web-clone/source-skeleton-consumption-audit.ts`
  - The audit checks source usage broadly, but does not prove high and medium priority replacement-plan regions were individually extracted.
- `packages/opencorvus/src/frontend-design/agent.ts`
  - `hostPreparedFrontendProject` is currently undefined, so runtime `analyze()` does not pass host-prepared compact source evidence into the prompt.
  - `record_frontend_region_selection` and `record_frontend_replacement_result` are process evidence tools and should record factual extraction evidence, not act as flow gates.
- `packages/opencorvus/src/frontend-design/output-tools.ts`
  - `ensureMaintainableSourceRegionPlan` can synthesize a whole-page `source-page-baseline` defer plan. That can hide missing region extraction behind a structured report.
- Tests currently pin special cases:
  - `packages/opencorvus/test/tool/web-clone-generate-source-project.test.ts` asserts TradingView and economic component names and content for table, event, ranking, header, footer, map, and card extraction.
  - `packages/opencorvus/test/frontend-design/prompt.test.ts` covers host-prepared prompt helpers but not the real `analyze()` path.
  - `packages/opencorvus/test/frontend-design/output-tools.test.ts` allows the synthesized `source-page-baseline` plan.
  - `packages/opencorvus/test/web-clone/source-skeleton-consumption-audit.test.ts` has no per-region coverage expectation.

## Design

Introduce one source-owned structural contract named `sourceComponentPatterns` in `source-ir/content-model.json`.

Each pattern is evidence, not a gate:

- `kind`: one of `navigation_surface`, `data_grid_surface`, `card_collection_surface`, `media_chart_surface`, `section_shell_surface`, `form_control_surface`, or `text_content_surface`.
- `nodeId`, `tag`, `classNames`, `bounds`, `textPreview`: traceability back to source evidence.
- `signals`: structural facts such as repeated sibling count, table-like row count, link density, media density, heading count, control count, and grid or flex display.
- `recommendedReplacementKind`: the existing replacement-kind string used by source replacement plans.
- `implementationHint`: short extraction guidance for frontend agents.

The generator consumes this contract as the primary classification source. Existing specialized extractors may still render richer components when their structure matches, but their site selectors and business words must not decide whether a region is extractable.

## Implementation Sequence

1. Add tests first:
   - Same structure with unrelated words for table, event/list, and navigation/card extraction.
   - `source-skeleton` test for `sourceComponentPatterns` and class-insensitive repeated signatures.
   - Frontend-design tests for host-prepared evidence in real `analyze()` and removal of synthesized whole-page baseline completion.
2. Extend `source-skeleton.ts` to emit `sourceComponentPatterns` from structural and visual signals.
3. Extend `source-project-generator.ts` to read the source component patterns, attach pattern evidence to regions by `data-source-node-id`, classify replacement kind from the pattern, and loosen specialized candidates by structure instead of business text.
4. Extend source audit to report per-region replacement coverage for high and medium priority rows.
5. Restore frontend-design host-prepared compact evidence in `FrontendDesignAgent.analyze()`, remove automatic whole-page baseline plan synthesis, and record extraction evidence fields.

## Implementation Status

- Completed: `source-ir/content-model.json` now publishes structural `sourceComponentPatterns`.
- Completed: repeated sibling signatures are class-insensitive, so CSS module hashes and state classes do not split identical repeated items.
- Completed: `source-project-generator.ts` reads `sourceComponentPatterns`, carries pattern evidence into extracted regions, and uses `recommendedReplacementKind` before text-preview classification.
- Completed: structurally equivalent table, repeated list, and link-navigation fixtures pass without TradingView, GDP, or Economic words.
- Completed: BBC-style repeated promo lists are extracted by a generic repeated-list renderer rather than a TradingView/news-specific card recognizer.
- Completed: `FrontendDesignAgent.analyze()` resolves host-prepared task-runtime source package and skeleton evidence, then injects compact evidence into prompt construction.
- Completed: `submit_frontend_template` no longer synthesizes a whole-page `source-page-baseline` replacement plan when frontend_design did not provide region work.
- Completed: source-project generator tests audit generated skeleton evidence with `visual_baseline_allowed`, while final target-project maintainable audit remains strict about `SourceDomPage` and `src/data/sourceDom*` residue.

## Non-Goals

- No host-side selector gate or workflow bypass.
- No fallback path that keeps both old and new classification as equal sources.
- No TradingView-only fixture expansion as the main solution.
- No visual threshold lowering or evaluator suppression.
