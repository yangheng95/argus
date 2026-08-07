# Schema Stress Benchmark And Hardening

Date: 2026-06-17

## Goal

Pressure-test OpenCorvus LLM-facing schemas and harden the schema system so agent tools expose clear, strict, provider-compatible contracts. The target is not cosmetic schema churn: the benchmark must catch contracts that make models guess payload shape, trigger provider schema errors, or cause repair/retry loops after a tool call.

If a real server must be started during this work, use port `7178`.

## Recall

Reviewed before implementation:

- `AGENTS.md`: no fallback paths, no double sources, no host-side routing gates, tests required for every code change, recall specs before edits.
- `deleted pre-June record 2026-04-30-result-schema-hardening`: terminal submit tools must not be empty object schemas; terminal/result schemas must be single-source.
- `deleted pre-June record 2026-05-19-goal-contract-tool-schema-single-source`: `z.unknown()` or prose-only tool schemas make the model guess, then retry after Zod errors; canonical Zod schema must be visible to the provider.
- `specs/records/2026-06/2026-06-13-gpt-strict-tool-schema-normalization.md`: `ProviderTransform.schema` is the only provider-bound schema dialect exit; GPT/OpenAI strict schemas require every object property in `required`, optional local fields represented by provider-only `null`, and local execution must still validate with original Zod semantics.
- `specs/records/2026-06/2026-06-08-frontend-design-schema-split.md`: stage schema modules own durable contracts; tool files should not become parallel schema sources.
- `specs/records/2026-06/2026-06-10-frontend-design-material-inventory-schema.md`: important required structured fields must be explicit in schema before terminal execution.
- `specs/records/2026-06/2026-06-05-mission-task-result-schema.md`: tool output consumed by agents needs structured result shape instead of scattered prose.
- `specs/records/2026-06/2026-06-11-integrity-reviewer-investigation-plan-schema.md`: prompts and tool schemas must agree on required fields to avoid repair turns that only chase nested omissions.

## Call-Point Inventory

Commands run before design:

- `rg -n "z\\.object|z\\.discriminatedUnion|z\\.union|\\.describe\\(|schema\\s*=|inputSchema|parameters|tool\\(" packages/opencorvus/src packages/opencorvus/test specs -g "*.ts" -g "*.md"`
- `rg -n "ProviderTransform|normalizeToolSchemaForProvider|prepareProviderTool|createStructuredOutputTool|asSchema|zod-to-json-schema|toJSONSchema|inputSchema" packages/opencorvus/src/session packages/opencorvus/src/provider packages/opencorvus/test/provider packages/opencorvus/test/session -g "*.ts"`
- `rg -n "Tool\\.define|parameters:|tool\\(\\{|inputSchema:" packages/opencorvus/src/tool -g "*.ts"`
- `rg -n "inputSchema:\\s*z\\.object\\(\\{\\s*\\}\\)|z\\.object\\(\\{\\s*\\}\\)" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`

Key schema exits:

| Surface                                                                                                                                                                           | Current role                                                                                              | Decision                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/provider/schema.ts`                                                                                                                                                          | Converts Zod / AI SDK schema wrappers into provider-bound JSON Schema through `ProviderTransform.schema`. | Keep as the only schema dialect entry for tool input and structured output. Add stress coverage around it instead of creating a second normalizer. |
| `src/provider/transform.ts::schema`                                                                                                                                               | Provider dialect normalization for OpenAI/GPT strict schemas and Gemini schemas.                          | Exercise recursive strictness, root union flattening, object closure, and local optional/null cleanup through tests.                               |
| `src/session/loop.ts::prepareProviderTool`                                                                                                                                        | Single provider-bound tool preparation path for registry, MCP, extra, and structured tools.               | Stress this path because it is where provider schema and local Zod execution semantics meet.                                                       |
| `src/session/loop.ts::createStructuredOutputTool`                                                                                                                                 | Structured-output finalizer tool.                                                                         | Include structured-output schema cases because provider errors here can end sessions without valid final payloads.                                 |
| `src/tool/registry.ts` + built-in `Tool.define` tools                                                                                                                             | Default agent tool surface.                                                                               | Audit generated schemas for provider compatibility and ambiguous/prose-only fields.                                                                |
| `src/orchestrator/tools.ts::createOrchestratorTools`                                                                                                                              | Orchestrator self-built task-control tool surface.                                                        | Audit every tool schema because orchestrator retry loops often originate here.                                                                     |
| `src/architect/output-tools.ts`, `src/research/output-tools.ts`, `src/frontend-design/schema.ts`, `src/integrity/team-schema.ts`, `src/build/types.ts`, `src/acceptance/types.ts` | Stage/terminal schemas consumed by LLM agents.                                                            | Keep canonical schemas; add representative pressure cases rather than duplicating contract definitions.                                            |

Observed risk signals:

- `src/orchestrator/tools.ts::query_failed_goals` exposes a no-argument `z.object({})` schema. This is a query tool, not a terminal submit tool, so it is not changed without evidence. The benchmark should allow deliberate no-argument tools only when the root object is closed after provider normalization.
- `src/tool/todo.ts::todoread` is a deliberate no-argument registry tool. Same treatment as above.
- `src/tool/batch.ts` contains `z.object({}).loose()` for nested delegated tool parameters. It is behind experimental config and must be treated as a high-risk dynamic schema if that tool is enabled.

## Benchmark Definition

The schema benchmark must validate these properties:

1. Every provider-bound LLM tool schema normalizes to a root JSON object for GPT/OpenAI-compatible and Gemini-style providers.
2. GPT/OpenAI strict normalization recursively closes object schemas with `additionalProperties: false`, requires every exposed property, and makes locally optional fields provider-nullable only.
3. Local execution semantics stay canonical: provider `null` placeholders for optional fields are stripped before Zod execution, while invalid non-null payloads still fail before `execute`.
4. Discriminated unions used by terminal/result tools flatten to provider-visible discriminator enums at the root instead of hidden `anyOf` objects.
5. Tool schemas must not hide payload shape behind top-level `{}` / `z.unknown()` for payload-bearing tools.
6. Top-level LLM-facing tool fields must carry useful descriptions unless the field is a closed literal/discriminator whose name and enum value are already the contract.
7. Structured-output schemas and extra tool schemas both pass through the same provider normalization path.

Timeout policy: benchmark execution must fail on true inactivity, not elapsed wall time from process start. For local unit tests this is enforced by focused test scope; a standalone benchmark runner must refresh activity on each case.

## Acceptance

- Add or extend focused tests so the benchmark covers provider schema dialects, local execution validation, built-in registry tools, orchestrator tools, and representative stage terminal schemas.
- Any failing schema issue discovered by the benchmark must be fixed at the canonical schema source or provider-bound schema exit; no fallback parser, duplicate hidden schema, or host routing gate.
- Targeted schema tests pass.
- Existing targeted provider/session/orchestrator tool tests still pass.
- After tests pass, perform a manual second review of changed schema paths and benchmark assertions.
