# Component Binding Benchmark Root Repair

Date: 2026-07-03

## Recall

User request:

- Investigate why current webpage component binding almost always fails.
- Construct our own examples for webpage component extraction.
- The binding algorithm must be robust, generic, and accurate.
- Raise component binding success rate above 90%.

Acceptance criteria:

- A repeatable benchmark exists for source webpage component extraction and local-module-to-source binding.
- The benchmark uses constructed webpage examples that cover common real failure modes: repeated cards, repeated tables/rows, navigation, charts/media, generic labels, non-Latin labels, numeric metrics, source identity refs, and component-tree-only evidence.
- Binding success is at least 90% on the benchmark. A binding counts as successful only when the selected source candidate is the expected component-level region, not a page shell, tiny text node, or adjacent repeated item.
- The repair is generic and evidence-driven. It must not add website-specific wording, domain-specific selectors, fallback logic, gate logic, or a second incompatible binding path.
- Focused tests for `local-module-source-binding` pass after the repair.
- Benchmark pass is followed by a manual review of the implementation and remaining risks.

Hard constraints recalled:

- No fallback / compatibility / double-source logic.
- No gate mechanism to hide the root cause.
- Every code change needs targeted tests.
- Test timeout must be activity-based where a runner is introduced; do not depend on total wall-clock sleeps as acceptance.
- Do not use git reset or broad rollback.
- Current worktree is dirty; existing changes are treated as current facts and must not be reverted.
- Specs and records must stay under the root `specs/` tree.

Sources read before implementation:

- `AGENTS.md` from the prompt.
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/current/architecture/18-webpage-replica-agent-workflow.md`
- `specs/records/2026-06/2026-06-02-generic-source-component-extraction.md`
- `specs/records/2026-06/2026-06-16-local-module-source-binding.md`
- `specs/records/2026-06/2026-06-17-local-module-visible-locator-binding.md`
- `specs/records/2026-06/2026-06-29-browser-preview-reference-regions-tool.md`
- `specs/records/2026-06/2026-06-30-browser-preview-viewport-slice-binding.md`
- `packages/opencorvus/src/browser-preview/local-module-source-binding.ts`
- `packages/opencorvus/test/browser-preview/local-module-source-binding.test.ts`
- `packages/opencorvus/src/web-clone/source-skeleton.ts`
- `packages/opencorvus/src/web-clone/source-project-generator.ts`
- `packages/opencorvus/src/web-clone/ir.ts`
- `packages/opencorvus/test/web-clone/source-skeleton.test.ts`

Whole-repository search evidence:

- `rg -n "component binding|component-binding|bindLocalModuleToSourceRegion|local-module-source-binding|source region|source-region|reference regions|browser_preview_reference_regions|component extract|component extraction|webpage.*component|sourceCandidate|textAnchors|visual-region" specs packages/opencorvus/src packages/opencorvus/test -S`
- `rg --files packages/opencorvus/src packages/opencorvus/test specs | rg "(local-module-source-binding|reference-region|browser-preview-reference|visual-region|web-clone|component|source-region|binding)"`
- `rg -n "sourceComponentPatterns|visual-surface-candidates|layout-map|sourceDomRegions|component-tree|bounds|sourceBounds|textPreview|rootNodeId|sourceRefs" packages/opencorvus/src/web-clone packages/opencorvus/test/web-clone packages/opencorvus/test/tool/web-clone-generate-source-project.test.ts -S`
- `rg -n "selectSourceRegionCandidate|collectSourceRegionCandidates|scoreCandidate|normalizeAnchors|candidateAreaWeight|local module source binding|Ambiguous source candidates|No source candidate matched" packages/opencorvus/test packages/opencorvus/src -S`

Independent agent feedback:

- Not obtained in this round. The current multi-agent tool policy only allows spawning sub-agents when the user explicitly requests sub-agents, delegation, or parallel agent work. No independent feedback is fabricated.

## Current Evidence

The source extraction pipeline already emits robust component-level evidence:

- `source-ir/component-tree.json` contains component names, kinds, root node ids, bounds, class names, text preview, and implementation hints.
- `source-ir/content-model.json` contains `sourceComponentPatterns`, which the June 2 record defines as the generic component extraction contract.
- `source-ir/style-profile.json` groups source-region style evidence by component region.
- `frontend-design-skeleton/src/data/sourceDomRegions.ts` contains generated source DOM region metadata when the source project generator ran.

The local module binding tool currently collects candidates only from:

- `web-clone-source/visual-surface-candidates.json`
- `web-clone-source/source-ir/layout-map.json`
- `frontend-design-skeleton/src/data/sourceDomRegions.ts`

It does not read `source-ir/component-tree.json` or `source-ir/content-model.json`. The selector therefore misses the generic component extraction contract and often falls back to a weak candidate set containing page shells, text fragments, or no component candidates at all.

The current selector scores candidates from normalized text anchors, source type weight, identity match, source ref match, and area ratio. This is useful but insufficient when:

- source and local modules share generic text such as Overview, Reports, More, Price, Status, or Watchlist;
- repeated components have the same labels but distinct source node ids;
- component-tree / sourceComponentPatterns contain the correct region but visual-surface candidates are missing or sparse;
- layout-map only exposes tiny leaf nodes, making module-level binding fail or become ambiguous;
- local implementation has slightly different visible wording from the source while preserving source identity through component file names or source refs.

## Benchmark Definition

Add a focused benchmark inside `packages/opencorvus/test/browser-preview/local-module-source-binding.test.ts`.

Input:

- Synthetic source evidence packages written under task-scoped `web-clone-source` / `frontend-design-skeleton` paths.
- Each case contains source components, patterns, layout elements, or source DOM regions with expected source candidate id.
- Each case calls the real `collectSourceRegionCandidates()` plus `selectSourceRegionCandidate()` pipeline, not a fixture-only helper.

Output:

- A selected `SourceRegionCandidate` whose `id` matches the expected component-level candidate.
- A benchmark summary asserting `passed / total >= 0.9`.

Initial case set:

- component-tree-only navigation surface.
- sourceComponentPatterns-only card collection.
- sourceComponentPatterns-only data grid.
- repeated card collection with source node disambiguation.
- repeated table row / table module with source refs.
- generic labels where page shell shares all words but module-level bounds win.
- layout-map-only tiny leaf nodes should not outrank component-level evidence.
- non-Latin component names.
- signed numeric metric cards.
- chart/media surface where text is sparse but component kind and node identity exist.
- footer/navigation surface with duplicated common links.
- sourceDomRegions remains accepted and can override weaker candidates when it carries explicit source identity.

Success metric:

- At least 90% of benchmark cases bind to the expected component-level candidate.
- A page-wide candidate, tiny layout leaf candidate, adjacent duplicate item, or no match is a failure.

Timeout:

- The focused benchmark is synchronous / filesystem-only and should complete under the existing Bun test timeout.
- Browser-involving tests retain existing no-activity sidecar timeouts in `local-module-source-binding.ts`.

## Root Repair Plan

1. Extend candidate collection to include `source-ir/component-tree.json`.
   - Candidate source should be component-level, with bbox from `bounds`, text from `name`, `kind`, and `textPreview`, and refs including `component-tree.json`, `component:<name>`, `node:<rootNodeId>`, and `kind:<kind>`.

2. Extend candidate collection to include `source-ir/content-model.json` `sourceComponentPatterns`.
   - Candidate source should represent the generic structural component contract.
   - Use `nodeId`, `kind`, `recommendedReplacementKind`, and structural `signals` text when available.
   - If component-tree has the same node id, enrich the pattern candidate with component name, text, and bounds rather than creating an incompatible parallel source for the same region.

3. Adjust scoring without adding fallback:
   - Prefer component-level evidence over layout-map leaf nodes when anchor evidence is comparable.
   - Reward exact source identity refs (`node:<id>`, `component:<name>`, `kind:<kind>`) strongly.
   - Keep area-ratio penalties for page shells and tiny leaves, but do not make geometry the only decision source.
   - Keep ambiguity as a real failure when distinct same-sized same-score candidates cannot be distinguished.

4. Add benchmark tests first, confirm they fail on current code, then implement the repair.

5. Rerun:
   - `bun test packages/opencorvus/test/browser-preview/local-module-source-binding.test.ts --timeout 120000`
   - `bun test packages/opencorvus/test/tool/browser-preview.test.ts --timeout 120000`
   - `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 120000`

6. Review the final implementation for:
  - no hardcoded website or business-domain vocabulary;
   - no missing malformed-evidence failures;
   - no compatibility alias or old tool resurrection;
   - no broad changes outside source binding and its focused tests unless evidence requires it.

## Non-Goals

- Do not change the agent-facing `browser_preview_reference_regions` tool contract unless tests prove the wrapper is the root cause.
- Do not lower visual comparison thresholds.
- Do not accept screenshot-only or page-slice evidence as module binding success.
- Do not add site-specific selectors, brand terms, or business-domain words.
- Do not delete existing candidate sources without separate evidence and user approval.

## Implementation Result

Implemented in `packages/opencorvus/src/browser-preview/local-module-source-binding.ts`:

- `collectSourceRegionCandidates()` now reads generic source extraction evidence from:
  - `web-clone-source/source-ir/component-tree.json`
  - `web-clone-source/source-ir/content-model.json`
- `component-tree` candidates use real source identity fields (`name`, `id`, `rootNodeId`), component-level bounds, component text preview, kind, tag, class names, and source refs.
- `sourceComponentPatterns` candidates use `nodeId`, bounds, kind, tag, replacement kind, text preview, and signal text from the generic content model.
- When `component-tree` and `sourceComponentPatterns` refer to the same source node, the reader enriches the component candidate instead of emitting two incompatible candidates for the same region.
- Present malformed component evidence now fails explicitly; missing optional evidence files remain absent until another candidate source supplies evidence.
- Scoring prefers component-level source evidence over `layout-map` leaf nodes when textual and identity evidence are comparable.
- The duplicate helper code left during implementation review was deleted.

Implemented in `packages/opencorvus/test/browser-preview/local-module-source-binding.test.ts`:

- Added a constructed webpage component-binding benchmark covering navigation, card collections, data grids, repeated cards, repeated tables, shared generic labels, tiny layout leaves, non-Latin labels, signed numeric metrics, sparse charts, duplicated footer links, and `sourceDomRegions` identity.
- The benchmark currently requires all 12 constructed cases to bind to the expected component-level candidate; this is stricter than the >=90% acceptance target.

Verification on final state:

- PASS: `bun test packages/opencorvus/test/browser-preview/local-module-source-binding.test.ts --timeout 120000`
  - 29 pass, 0 fail, 107 assertions.
  - Constructed benchmark binds 12/12 expected component-level candidates.
- PASS: `bun test packages/opencorvus/test/tool/browser-preview.test.ts --timeout 120000`
  - 19 pass, 0 fail, 118 assertions.
- PASS: `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 120000`
  - 19 pass, 0 fail, 66 assertions.

Secondary review:

- No site-specific selectors, brand terms, or business-domain vocabulary were added to production code.
- No fallback attachment/candidate path or gate mechanism was added.
- Existing candidate sources remain available; the repair adds the missing generic component extraction sources to the same candidate pipeline.
- The previous failure was a candidate-pool root cause: source extraction already produced component-level evidence, but binding ignored `component-tree.json` and `content-model.json`, leaving no candidates or only weak leaf/page candidates.

## Generic Web Scope Audit

The repair is intended for arbitrary webpages, not for TradingView, finance pages, crypto pages, or any single reference site.

Generic requirements:

- Candidate collection must consume source evidence by schema and role: component-tree, sourceComponentPatterns, source DOM regions, visual-surface candidates, and layout-map evidence.
- Candidate scoring must use normalized explicit anchors, local visible text, source refs, source evidence type, and area ratio. It must not use brand names, URL path fragments, CSS class names from one site, or domain-specific vocabulary as privileged rules.
- Duplicate merging must be visual-evidence based: same source kind and same bbox merge into one visual candidate, regardless of structural signal differences such as display mode.
- Non-renderable content-model records with no bbox or zero-area bbox are not crop candidates. Invalid bbox shapes still fail as malformed evidence.
- Full-page local screenshots must be captured in a way that is independent of sticky headers and scroll position after the target bbox has been computed.

Current generic test coverage:

- `local-module-source-binding.test.ts` uses constructed source evidence across navigation, catalog cards, data grids, repeated lists, repeated tables, generic overview labels, documentation-style tabs, non-Latin labels, numeric metrics, sparse charts, footer links, generated source DOM regions, dashboard chart duplicates, catalog analysis grids, and fixed-header below-fold capture.
- A repository search over production binding code and the focused binding test found no TradingView, crypto, coin-ranking, or stock-market-specific terms after the genericization pass. Concrete project identifiers remain only in this spec's actual-run evidence section.

## Actual Project Test Follow-Up

After the constructed benchmark passed, the user asked to test against the actually running project at `C:\Users\chuan\myhexin-local\demos\economy\crypto`. This is one real runtime sample for validation only. It does not define the scope of the repair, and no production scoring, candidate collection, or capture rule may depend on this site's brand, route names, selectors, or visible domain vocabulary.

Real source evidence and runtime surface:

- Source package: `C:\Users\chuan\myhexin-local\demos\economy\crypto\.opencorvus\r\t\LH\6NpYhH\fd\web-clone-source`
- Real task id: `tsk_f17e611c3001vAR74hE7cAaGq7`, whose `Identifier.directoryKey()` is `LH6NpYhH`.
- Dev server started from the project itself with `BUILD_ENV=local` and `node_modules\.bin\rsbuild.CMD dev --host 127.0.0.1 --port 3025`.
- Runtime URL verified: `http://127.0.0.1:3025/tradingview-crypto/`, HTTP 200, title `Crypto market - TradingView Replica`. These concrete identifiers are recorded only as actual-run evidence.

The first production binding attempt failed before screenshot materialization:

- Error: `Malformed content model JSON: ...\content-model.json: sourceComponentPatterns[0] missing bounds`.
- Root cause: real `content-model.json` contains mixed `sourceComponentPatterns`; some rows carry component-level `bounds`, while others are structural/content records without crop geometry. Rows without a bbox are not valid source-region candidates, but treating their presence as file-level malformed evidence blocks valid candidates later in the same file, including `node_001319` and `node_002551`.
- A second production binding attempt then failed at `sourceComponentPatterns[44]` where `bounds` exists but has zero height: `{ x: 0, y: 302, w: 1440, h: 0 }`. This is a non-renderable structural node, not a crop candidate and not malformed JSON.
- A third production binding attempt then failed with ambiguity between `node_001320` and `node_001321`. They had the same source kind, same bbox, same area, and same visible text. Their only observed difference was structural signal metadata such as `display:block` versus `display:flex` and `gridOrFlex:false` versus `gridOrFlex:true`, so they represented duplicate evidence for the same visual crop rather than two distinct candidate regions.
- After duplicate merging, the market overview module bound correctly in the real project, but `coin-ranking-grid` falsely bound to `node_000928`. Manual review of the generated `module-comparison.png` showed the left source crop was the market-summary/chart area while the right implementation crop was the Coin ranking grid. Real evidence contains the correct source region as layout-map `node_002551` (`bbox=40,2042,1360x1238`, text includes `Coin ranking`, `Market cap ranking`, `TVL ranking`, `Gainers`, `Losers`, and `See all coins`). The scoring bug is that explicit caller anchors and incidental local screenshot text share one capped anchor score. A wrong component-pattern candidate can saturate the cap with common row text such as `Bitcoin`, `BTCUSD`, and `Market`, then win solely through source-type weight over the more semantically exact layout-map candidate.
- Once `coin-ranking-grid` selected `node_002551`, manual review showed a separate evidence-capture artifact: the right implementation crop contained the page's sticky TradingView navigation even though the source crop did not. The local capture script computed the below-fold element bbox after `scrollIntoViewIfNeeded()` and then took a `fullPage` screenshot at that same scroll position, which lets fixed/sticky headers be painted into the full-page image at the scrolled document position. The binding coordinates were correct, but the crop image was polluted by capture order.

Repair constraint:

- Do not add fallback logic or ignore malformed candidate records wholesale.
- Keep throwing for records that claim crop geometry in an invalid shape.
- Treat `sourceComponentPatterns` rows with no `bounds` field or zero-area `bounds` as non-candidate content-model records. They are not usable for crop binding, so they must be skipped rather than promoted to a candidate or allowed to abort the whole evidence file.
- Add a targeted regression test where unbounded and zero-area patterns precede a bounded component pattern, and assert the bounded candidate is still collected and selected.
- Merge duplicate candidates when their source kind and bbox are identical. Preserve and union their source refs and text. Do not merge same-size candidates at different coordinates; those remain real ambiguity. Non-visible structural signal differences must not split one visual crop into multiple binding candidates.
- Score explicit region anchors separately from incidental local screenshot text. This is not a gate: candidates can still be selected through local text or identity refs when explicit anchors are sparse, but a candidate matching the caller's explicit semantic anchors must not lose to a visually wrong candidate that only matches common table content.
- After computing the local module's absolute bbox and text anchors, reset the page scroll to the top before taking the `fullPage` screenshot. The crop still uses the already computed document-space bbox, while fixed/sticky headers are no longer painted over the below-fold module crop. Add a regression test with a fixed header and a below-fold target.
