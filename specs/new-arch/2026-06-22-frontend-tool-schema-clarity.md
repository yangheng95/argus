# Frontend Tool Schema Clarity

Date: 2026-06-22

## Problem

The TradingView world-economy clone task showed that `frontend_design` and
`frontend_research` were invoked with valid inputs, but the exposed schema text
did not make the operator-facing distinction sharp enough:

- `frontend_design` fresh input uses `urls`, not legacy `url`, and accepts at
  most one non-Figma live/page URL for the task-scoped webpage clone evidence
  package.
- `frontend_research` fresh input uses `source_urls`, not `urls` or `url`, and
  accepts exactly one HTTP(S) source page per call.
- `submit_frontend_template.reuse_source` must name an installed package or real
  project/source path; prose explanations belong in `project_specific_reason`,
  `parity_guard`, or notes.
- `frontend_project.entrypoints` has role-specific semantics: implementation
  targets require real project-root-relative files; visual baselines name the
  visual HTML skeleton files and validation artifacts.

## Call-Point Inventory

| Surface | Call points checked | Decision |
| --- | --- | --- |
| `FrontendDesignInputSchema` | `packages/opencorvus/src/orchestrator/tools.ts`, `packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts` | Clarify field descriptions only; keep strict shape and existing validation. |
| `FrontendResearchInputSchema` | `packages/opencorvus/src/orchestrator/tools.ts`, `packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts` | Clarify `source_urls` fresh-mode semantics; keep exactly-one URL validation. |
| `ComponentReusePlanItemSchema.reuse_source` and tool mirror | `packages/opencorvus/src/frontend-design/schema.ts`, `packages/opencorvus/src/frontend-design/output-tools.ts`, `packages/opencorvus/test/frontend-design/schema.test.ts` | Keep validator behavior; add schema descriptions that point at installed packages or real paths. |
| `BaselineReplacementPlanItemSchema.reuse_source` and tool mirror | same as above | Same clarification as component reuse. |
| `frontend_project.entrypoints` | `packages/opencorvus/src/frontend-design/schema.ts`, `packages/opencorvus/src/frontend-design/output-tools.ts`, `packages/opencorvus/test/frontend-design/schema.test.ts` | Clarify role-specific path expectations. |
| `script/inspect-task.ts` | `script/inspect-task.ts`, `packages/opencorvus/test/engine-goal-retry-count-derived.test.ts`, `packages/opencorvus/test/engine-goal-contract-runtime-split.test.ts` | Remove retired `engine_goal.retry_count` / `workspace_branch` reads from the diagnostic script. |

## Non-Goals

- No route gate, fallback, compatibility alias, hidden message, or host-side tool
  choice rule.
- No schema field rename and no acceptance behavior change.
- No OpenCorvus / overlay process restart.
