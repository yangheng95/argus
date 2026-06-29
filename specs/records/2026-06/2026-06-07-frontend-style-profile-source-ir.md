# Frontend Style Profile Source IR

## Problem

TradingView-style webpage clone tasks currently produce `source-ir/style-tokens.json` and `source-ir/layout-map.json`, but downstream agents still receive style evidence as loose inventory. This lets Build infer visual style from PRD prose or screenshots instead of consuming a region-scoped style contract.

## Decision

Do not add an independent `frontend_style` LLM agent or workflow stage. Add a deterministic `source-ir/style-profile.json` artifact produced by the existing `frontend_design` web-clone source skeleton pipeline. `frontend_research`, Requirements, Architect, and Build consume that path as evidence; they do not create a second style truth source.

## Call Points

- `packages/opencorvus/src/web-clone/source-skeleton.ts`
  - `writeWebCloneSourceSkeleton` writes `source-ir/*`.
  - `buildSourceIr` already builds `component-tree`, `content-model`, `layout-map`, `style-tokens`, `interaction-hints`, and `source-quality-audit`.
  - Add `style-profile.json` beside those outputs and include it in skeleton manifest/audit checks.
- `packages/opencorvus/src/web-clone/context.ts`
  - `prepareWebCloneContext` copies `source-ir/*` into `web-clone-source`.
  - Add `style-profile.json` to required reads, implementation contract, README, and source package manifest entrypoints.
- `packages/opencorvus/src/prompt/core/frontend-design-core.txt`
  - Direct frontend_design to publish style profile as the style source artifact and not report maintainable completion when source-dom debt remains.
- `packages/opencorvus/src/prompt/core/frontend-research-core.txt`
  - Keep frontend_research advisory. It may point packets to `style-profile.json`, but must not generate a parallel style summary.
- `packages/opencorvus/src/build/prompt-context.ts`
  - In the clone overlay, require CSS/layout repair to read `style-profile.json` before freehand CSS changes.
- `packages/opencorvus/src/prompt/core/requirements-core.txt`
  - Replace the misleading PRD 70% / skeleton 30% weighting with the single-source split: PRD explains semantics; source skeleton/style artifacts bind implementation facts.

## Acceptance

- New web-clone source packages include `source-ir/style-profile.json`.
- The style profile groups style/layout evidence by source segment/component with node ids, bounds, style summaries, matched CSS selectors, assets, and implementation guidance.
- Handoff validation treats missing `style-profile.json` as missing source IR.
- Agent prompts tell downstream agents to consume the style profile path instead of inventing TradingView-like style from prose.
