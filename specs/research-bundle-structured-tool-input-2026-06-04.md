# Research Bundle Structured Tool Input

Superseded by `specs/new-arch/2026-06-04-research-brief-chunked-collector.md`. The structured bundle input described here was an intermediate step; the active design now registers the whole research brief in small collector chunks and leaves `submit_research_brief` as a strict finalizer.

## Problem

`submit_research_brief` currently asks the model to submit `bundle.full_markdown`, `bundle.evidence_json`, and `bundle.citation_map_json` as large JSON string fields. The observed failure text says the model hit an unterminated JSON string while trying to submit the bundle. That failure happens before Zod validation because the provider/session boundary cannot parse malformed tool-call JSON.

Root cause: the terminal tool schema makes the model manually escape a long markdown document and two JSON documents inside one tool-call object. Prompting the model to "be careful" only retries the same fragile contract.

## Grep Evidence

| Symbol or text | Call points | Decision |
| --- | --- | --- |
| `ResearchSubmitSchema` | `packages/opencorvus/src/research/output-tools.ts` and `packages/opencorvus/test/research/output-tools.test.ts` | Replace `bundle` input shape. |
| `ResearchBundleSchema` / `ResearchBundle` | `schema.ts`, `output-tools.ts`, `agent.ts`, `index.ts`, `types.ts` | Keep materialized persisted bundle type as strings for files; add a separate structured tool-input schema. |
| `researchBundleFromDraft` | `output-tools.ts`, `agent.ts` | Convert structured bundle input to materialized markdown/JSON strings before persistence. |
| `full_markdown` prompt text | `research-core.txt`, `frontend-research-core.txt`, `webpage-prd-evidence.ts`, prompt tests | Replace with structured sections instructions. |
| `full_markdown_path` / `evidence_json_path` / `citation_map_path` | `engine/describe.ts`, `orchestrator/tools.ts`, persist tests, schema integrity checks | Keep unchanged; downstream consumes paths, not raw bundle content. |

## Design

Introduce `ResearchBundleInputSchema` for `submit_research_brief.bundle`:

- `full_markdown_sections`: ordered sections with short single-line `title`, optional `evidence_ids`, and bounded single-line `points`.
- `evidence_notes`: structured evidence records keyed by existing `evidence_index` ids.
- `citation_map`: structured citation entries keyed by existing evidence ids and claim ids.

The host renders these structured fields into the existing persisted `ResearchBundle`:

- `research-bundle.md`
- `evidence.json`
- `citation-map.json`

This is a direct contract replacement, not a compatibility path. Raw `full_markdown` / `evidence_json` / `citation_map_json` are removed from the terminal tool input.

## Validation

- Existing brief semantic validation remains the source for evidence/fact/document references.
- Add bundle semantic validation so `evidence_notes.evidence_id` and `citation_map.evidence_ids` point to submitted evidence ids.
- Keep materialized bundle size limits after host rendering.
- Unit tests must prove:
  - valid structured bundle finalizes and materializes.
  - legacy raw string bundle is rejected by schema.
  - quoted notes are rendered by host serialization without requiring raw JSON-string documents in the tool call.
  - embedded newlines in bundle text fields are rejected; multiline notes must be split into separate array items.
