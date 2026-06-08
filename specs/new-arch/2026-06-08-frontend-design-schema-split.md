# Frontend Design Schema Split

## Context

`frontend-research` keeps its durable output contract in `src/research/schema.ts` and lets `output-tools.ts` focus on collection, validation orchestration, and report rendering. `frontend-design` still keeps the `submit_frontend_template` terminal schema and visual anchor registration schemas inside `src/frontend-design/output-tools.ts`, making the tool implementation the schema owner.

## Call-Site Inventory

| Symbol / surface | Current callers | Decision |
| --- | --- | --- |
| `FrontendTemplateFinal` | `src/frontend-design/agent.ts`, `src/frontend-design/output-tools.ts` | Move type source to `src/frontend-design/schema.ts`; re-export from `output-tools.ts` for existing callers. |
| `FrontendTemplateFinalSchema` | `src/frontend-design/output-tools.ts` only | Move to `src/frontend-design/schema.ts`; import into `output-tools.ts`. |
| `FrontendTemplateToolInputSchema` | `src/frontend-design/output-tools.ts` only | Move to `src/frontend-design/schema.ts`; export for direct schema tests and import into `output-tools.ts`. |
| Visual anchor schemas (`ColorSchema`, `TypographySchema`, `SpacingSchema`, `LayoutSchema`, `ComponentSchema`, `InteractionSchema`, `ResponsiveSchema`) | `src/frontend-design/output-tools.ts` only | Move to `src/frontend-design/schema.ts` as exported tool input schemas. |
| `VisualSpecSchema`, `VisualSpecCategory`, `VisualSpecSeverity` | `src/frontend-design/types.ts`, `src/frontend-design/index.ts` | Move schema definitions to `schema.ts`; keep `types.ts` as a lightweight re-export, matching frontend-research. |
| Decision-log frontend-design handoff text | `src/frontend-design/handoff.ts`, `test/frontend-design/handoff.test.ts` | Add explicit decision-log guidance: `web-clone-source/` content may be deleted only after style and styling transcription has migrated from source evidence into the accepted downstream project. |

## Implementation

1. Add `src/frontend-design/schema.ts` as the single Zod schema module for frontend-design output and visual anchor tool input.
2. Replace `types.ts` with schema re-exports so public imports remain stable.
3. Trim schema definitions from `output-tools.ts`; keep normalization, collector, rendering, and tool execution there.
4. Add tests proving frontend-design schema exports are separate from output tools and decision-log handoff carries the `web-clone-source/` deletion condition.

## Non-Goals

- No workflow change, routing change, host-side gate, fallback, or compatibility path.
- No deletion of `web-clone-source/` evidence. The new rule only documents the deletion condition in decision-log handoff text.
