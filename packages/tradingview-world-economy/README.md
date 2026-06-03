# TradingView World Economy Extracted Clone

React/Vite implementation of the public TradingView world economy page extracted by OpenCorvus frontend_design with `glm51/glm51`.

This project intentionally renders extracted materials first. The current app entrypoint uses extracted source CSS, copied assets, extracted navigation data, and semantic replacements for page chrome/navigation. It does not use hand-written visual approximations for maps, tables, or page layout.

Evidence:
- Source URL: `https://www.tradingview.com/markets/world-economy/`
- OpenCorvus report: `.opencorvus/runtime/tasks/tsk_e8b012d9e001/frontend-design/frontend-template.md`
- Visual reference: `reference.png`

Source layout:
- `src/components/SourceClonePage.tsx` is the app entrypoint.
- `src/components/SourceDomPage.tsx` composes extracted page chrome and semantic body boundaries.
- `src/components/semantic/HeaderNavigation.tsx`, `src/components/semantic/FooterNavigation.tsx`, `src/components/semantic/EconomyPageHeader.tsx`, and `src/components/semantic/WorldEconomyTabNavigation.tsx` are extracted semantic replacements.
- `src/components/source-dom/EconomicTrendsRegion5.tsx` is the only remaining high-fidelity extracted source DOM region.
- `src/data/extractedNavigation.ts` contains extracted breadcrumb and tab labels.
- `src/data/sourceData.ts` contains extracted text/table/asset signals from the source page.
- `src/data/sourceDomReplacementPlan.ts` and `src/data/sourceDomIterationState.ts` document the maintainable refactor order without inventing visual structures.
- `src/styles/source-critical.css`, `src/styles/source-full.css`, and `public/assets/` are copied extracted materials.
- `reference.png` is the captured visual reference.

Run:

```sh
bun run --cwd packages/tradingview-world-economy dev
```

Verify:

```sh
bun run --cwd packages/tradingview-world-economy test
bun run --cwd packages/tradingview-world-economy typecheck
bun run --cwd packages/tradingview-world-economy build
```
