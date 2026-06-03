# TradingView world economy extracted clone

## Requirement

Use OpenCorvus frontend_design with `glm51/glm51` to extract `https://www.tradingview.com/markets/world-economy/`, then ship a human-readable and maintainable project while preserving at least 80% visual similarity.

The user explicitly corrected the implementation rule: extract materials as much as possible, and avoid hand-written visual approximation code in principle.

## Evidence

- OpenCorvus task: `.opencorvus/runtime/tasks/tsk_e8b012d9e001`
- frontend_design report: `.opencorvus/runtime/tasks/tsk_e8b012d9e001/frontend-design/frontend-template.md`
- Evidence manifest: `.opencorvus/runtime/tasks/tsk_e8b012d9e001/frontend-design/evidence-source-manifest.md`
- Extracted skeleton: `.opencorvus/runtime/tasks/tsk_e8b012d9e001/frontend-design/frontend-design-skeleton`
- Target package: `packages/tradingview-world-economy`
- Document Object Model source regions: `packages/tradingview-world-economy/src/components/source-dom`
- Cascading Style Sheets source material: `packages/tradingview-world-economy/src/styles/source-critical.css` and `packages/tradingview-world-economy/src/styles/source-full.css`
- Visual reference: `packages/tradingview-world-economy/reference.png`

## Source grep

This package is new. The relevant source boundaries are:

| Boundary | Current source | Decision |
| --- | --- | --- |
| App entry | `src/App.tsx` | Render `SourceClonePage` only. |
| Page composition | `src/components/SourceDomPage.tsx` | Keep frontend_design source page composition. |
| Generated regions | `src/components/source-dom/*Region.tsx` | Keep as the visual baseline until a region is replaced with measured parity. |
| Semantic extracted replacements | `src/components/semantic/HeaderNavigation.tsx`, `src/components/semantic/FooterNavigation.tsx` | Keep because these were produced by frontend_design extraction. |
| Material data | `src/data/sourceData.ts`, `src/data/sourceDomReplacementPlan.ts`, `src/data/sourceDomIterationState.ts` | Keep as the maintainability map and regression-test target. |
| Styling | `src/styles/source-critical.css`, `src/styles/source-full.css`, `src/styles.css` | Keep extracted styles; `styles.css` only wires extracted material and minimal shell reset. |

No existing route, API, database, provider, or shared OpenCorvus runtime contract is modified.

## Implementation decision

The target package is a direct extracted-material project, not a hand-built TradingView-like recreation. The app keeps source DOM regions, copied assets, extracted style sheets, source data, and the frontend_design replacement plan as the single source of truth.

The previous hand-written approximation components were removed. Future maintainability work should follow `sourceDomReplacementPlan` one region at a time and delete a source region only after measured visual parity is preserved against `reference.png`.

## Verification

- `bun run --cwd packages/tradingview-world-economy test`
- `bun run --cwd packages/tradingview-world-economy typecheck`
- `bun run --cwd packages/tradingview-world-economy build`
- Browser visual inspection at `http://127.0.0.1:5178/`

The build may warn about large chunks because the current package intentionally keeps extracted raw source material to protect visual fidelity.
