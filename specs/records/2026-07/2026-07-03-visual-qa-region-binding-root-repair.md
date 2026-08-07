# Visual QA Region Binding Root Repair

## Recall

- User request: `visual-qa绑定的regions错的离谱，你不反思？` with task debug info for `tsk_f27349e1f001Bas0d2mDBv13yN`, a TradingView World Economy desktop replica split into ten component goals.
- Acceptance criteria:
  - Reconstruct the actual failed evidence path from task artifacts and the runtime DB before changing code.
  - Fix the generic module source-binding behavior so a local component cannot be marked as bound to an unrelated tab/header/nearby source crop just because incidental local text overlaps.
  - Keep the repair generic for webpages; do not hard-code TradingView, World Economy, or this task's region names.
  - Add regression tests for the observed wrong-region pattern.
  - Run targeted tests and review the real comparison artifacts after the benchmark-style fix.
- Hard constraints:
  - No fallback, compatibility path, gate, or prompt-only workaround.
  - No git reset, no destructive cleanup, and no edits to unrelated dirty worktree files.
  - Do not restart, refresh, kill, or otherwise interfere with running OpenCorvus / overlay processes.
  - Frontend/visual acceptance must be based on actual screenshots and artifacts, not status flags.
- Landed sources read:
  - `specs/records/2026-07/2026-07-03-component-binding-benchmark-root-repair.md`
  - `specs/records/2026-07/README.md`
  - `specs/README.md`
  - `packages/opencorvus/src/browser-preview/local-module-source-binding.ts`
  - `packages/opencorvus/src/tool/browser-preview-reference-regions.ts`
  - `packages/opencorvus/src/prompt/core/visual-qa-core.txt`
  - `packages/opencorvus/src/visual-qa/agent.ts`
  - `packages/opencorvus/test/browser-preview/local-module-source-binding.test.ts`
  - Task artifacts under `C:\Users\chuan\myhexin-local\demos\economy\world-economy\.opencorvus\r\t\2W\8zaZnJ`
  - Runtime DB `C:\Users\chuan\.local\share\opencorvus\opencorvus.db`
- Whole-repository search evidence:
  - `rg "browser_preview_reference_regions|reference_regions|local-module|module-comparison|visual.?qa|Visual QA|region_key|reference_region" packages/opencorvus/src packages/opencorvus/test -S`
  - `rg "browser_preview_reference_regions|reference_regions|local-module-source-binding|module-comparison|comparison_guidance|problem_dom_regions" packages/opencorvus/src/tool packages/opencorvus/src/browser-preview packages/opencorvus/src/prompt/core/visual-qa-core.txt packages/opencorvus/src/visual-qa packages/opencorvus/test/visual-qa packages/opencorvus/test/browser-preview packages/opencorvus/test/build-agent -S`
  - `rg "data-oc-region|HeaderNavigation|BreadcrumbHero|RankingsLists|EconomicIndicators|GlobalIndustrialMap|NewsFeed|EconomicCalendar|TradingViewFooter" C:\Users\chuan\myhexin-local\demos\economy\world-economy\src -S`
- Independent agent feedback:
  - No sub-agent was spawned because the available multi-agent tool contract explicitly forbids spawning unless the user explicitly asks for sub-agents. The independent check is therefore limited to database rows, persisted artifacts, screenshot inspection, and code-path grep evidence in this record.

## Evidence

Runtime evidence for `tsk_f27349e1f001Bas0d2mDBv13yN` shows ten goals marked passed, but only five `browser_preview_evidence` artifacts exist, and only four of those are `source-binding` comparisons. The four source-binding rows are not attached to `goal_run_id`, so the system cannot prove that each component goal consumed its own correct source region proof.

The real module comparison screenshots show the failure:

- `breadcrumb-hero-section-tabs` bound to `CountriesIdeasEconomicIndicatorsHeatRegion3`, a source crop containing only the section tab row / `Overview` band, while the local crop contains the breadcrumb, hero title, overview selector, and tabs.
- `economic-indicators-heatmap-table` also bound to `CountriesIdeasEconomicIndicatorsHeatRegion3`, while the local crop is the full heatmap table and main-indicator chips.
- `global-industrial-map` bound to a plausible source map region.
- `trading-view-footer` bound to the footer source region, but the visual comparison still exposes a major implementation mismatch: the source crop contains the large `LOOK FIRST / THEN LEAP` footer marketing graphic while the local implementation omits it. That is a Visual QA finding, not a binding success.

The binding manifests show why the first two passed incorrectly. The selector flattens identity, explicit, and local captured anchors into one pool. Incidental local text from tabs and same-page links then out-scores the owning module identity. The selected source candidate is persisted as `status: "passed"` without any semantic coverage check between the source crop and the local module crop.

## Root Cause

The immediate bug is not that Visual QA lacked a prompt sentence. The prompt already says `browser_preview_reference_regions` is only for concrete modules and that the image must be inspected. The root bug is in the evidence contract:

1. `selectSourceRegionCandidate()` treats every local text anchor equally. It does not distinguish owning/core anchors from child navigation, nearby repeated link text, or same-page table-of-contents labels.
2. `scoreCandidate()` rewards any source candidate that contains many incidental anchors. A small section-tab candidate can beat the actual component because the local component also contains those tabs.
3. `bindLocalModuleToSourceRegion()` writes `status: "passed"` for the best text candidate without requiring primary phrase coverage or rejecting partial-region matches.
4. Persisted `browser_preview_evidence` is not goal-run scoped in this path, allowing a small number of unscoped comparisons to coexist with ten passed component goals.

## Repair Plan

1. Extend local module binding scoring with primary phrase awareness:
   - Keep identity anchors from `regionID` and component filenames.
   - Keep explicit anchors from the tool call.
   - Build ordered primary phrases from explicit anchors plus the captured local module text anchors.
   - Score core primary phrase matches separately from incidental local-anchor matches.
2. Reject or de-rank candidates that only match incidental anchors:
   - A candidate must match owning identity or enough primary phrases from the actual local module.
   - Candidate size must remain plausible relative to the local module; a tiny table-of-contents strip must not bind to a full table/hero/card section.
   - The error should tell the caller that no source candidate satisfied module identity/coverage, instead of silently selecting the wrong strip.
3. Add regression tests:
   - A composite breadcrumb/hero/tabs module must not bind to a tab-only source strip.
   - A heatmap table must bind to the table body candidate rather than the navigation tab with the same heading text.
   - If only the tab strip exists for a composite module, the tool must fail rather than emit passed binding evidence.
4. Re-run targeted tests and re-check actual world-economy artifacts to ensure the original wrong comparison is explained by the old algorithm and covered by new tests.

## Implementation Result

Implemented in `packages/opencorvus/src/browser-preview/local-module-source-binding.ts`:

- Source candidates now carry `moduleCoverage` diagnostics: area ratio, matched identity anchors, matched core primary phrases, and matched coverage primary phrases.
- Candidate selection now filters out candidates whose matches are only incidental local anchors. A selected source region must satisfy plausible module area plus owning identity or core/local primary phrase coverage.
- Primary phrases are deduplicated by a punctuation-insensitive equivalence key, so formatting variants like `CPI 2.1%` / `CPI 2 1%` do not double-count coverage requirements.
- Coverage phrases exclude ordinary single-word navigation labels, while preserving numeric phrases, non-Latin text, and raw uppercase acronyms such as `GDP`.
- The selection error now reports the top rejected candidates with score, primary/core coverage, area ratio, and rejection reason instead of silently persisting a wrong passed binding.

Implemented in Visual QA output contracts:

- `VisualQaCheckItemSchema.evidence_refs` now defaults to `[]`, matching the required order where checks are registered before screenshots or command evidence exists.
- `visualQaEvidenceRefIssues()` now requires every check item to have evidence support by final submit, either through registered check item refs or through registered evidence rows whose `check_ids` include that check.
- The Visual QA core prompt and dynamic delegation prompt now state the same contract, so the model is not forced into inventing `pending-*` evidence refs.

Implemented regression tests:

- `local-module-source-binding.test.ts` covers the observed false region pattern:
  - composite hero/tabs module binds to the owning section instead of a child tab strip;
  - heatmap table binds to the table source region instead of the same-page section tabs;
  - tab-only source evidence for a full heatmap module fails instead of producing passed binding evidence.
- `output-tools.test.ts` covers the Visual QA registration order:
  - check items can be registered before evidence rows;
  - final reports still fail if a check has neither registered refs nor evidence rows;
  - failed reports with production blockers can record correctly when the failed check is supported by a later evidence row.

## Verification

Automated verification:

- PASS: `bun test packages/opencorvus/test/browser-preview/local-module-source-binding.test.ts packages/opencorvus/test/visual-qa/output-tools.test.ts packages/opencorvus/test/visual-qa/strict-reference-fidelity.test.ts packages/opencorvus/test/visual-qa/negative-fixtures.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 120000`
  - 86 pass, 0 fail, 410 assertions.
- PASS: `bun run --cwd packages/opencorvus typecheck`
- PASS: `bunx prettier --check` on the touched TypeScript, test, and Markdown files. The Visual QA `.txt` prompt is not parsed by Prettier.

Actual artifact replay, using the old world-economy binding manifests as selector input without restarting or refreshing any running OpenCorvus/overlay process:

- `economic-indicators-heatmap-table`:
  - Old selector persisted `CountriesIdeasEconomicIndicatorsHeatRegion3`.
  - New selector selects `node_002052` from `layout-map`, with accepted module coverage.
- `breadcrumb-hero-section-tabs`:
  - Old selector persisted `CountriesIdeasEconomicIndicatorsHeatRegion3`.
  - New selector rejects the tab strip because the top candidates have `core=0/2` and only incidental anchor coverage. This is the correct result for the current candidate pool: no passed binding evidence should be emitted until an owning hero source candidate exists.

Secondary review:

- No TradingView-, finance-, or World-Economy-specific production rule was added. The regression data names the observed task, but the production selector uses generic text normalization, area ratio, identity anchors, and primary phrase coverage.
- No fallback, gate, compatibility path, or prompt-only workaround was added.
- Existing unrelated dirty files in the worktree were not reverted or modified for this repair.
