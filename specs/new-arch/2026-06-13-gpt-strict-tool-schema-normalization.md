# 2026-06-13 GPT Strict Tool Schema Normalization

## Evidence

7878 task comparison:

- GPT task `tsk_ebd109d74001Eu5azzohcYiOrX` uses `hexin/gpt-5.5` for every agent in the root session config snapshot.
- Kimi task `tsk_ebd16824c001Xm5TqIgHUIM3rK` uses `hexin/kimi-k2.6` for every agent.
- GPT goal1 `gol_ebd33dd0f001l53EOYI9dpunJE` is still running with retry count 4.
- Kimi goal1 completed and later goals continued.

SQLite evidence from `/home/yangheng/.local/share/opencorvus/opencorvus.db`:

```text
Provider hexin returned HTTP 400:
litellm.BadRequestError: OpenAIException - Invalid schema for function 'StructuredOutput':
In context=('properties', 'chronology', 'items'), 'required' is required to be supplied
and to be an array including every key in properties. Missing 'evidence'.
Received Model Group=gpt-5.5
Available Model Group Fallbacks=None
```

Later GPT retry attempts reached `report_build_result`, but schema-invalid terminal
tool calls were recorded as `tool-execute-error`; the build session then ended
without a valid terminal report and the orchestrator retried goal1.

## Prior Design Recall

- `specs/new-arch/2026-04-30-result-schema-hardening.md`
  requires `report_build_result` to reuse the shared `BuildResultSchema`; no
  parallel build-report schema.
- `specs/new-arch/2026-04-30-terminal-contract-hard-pin.md`
  replaced split build terminal tools with the single `report_build_result`.
- `specs/new-arch/2026-04-30-terminal-extra-tool-schema-normalization.md`
  made `prepareProviderTool` the single provider-bound schema exit.

Therefore this fix must stay inside the shared provider-bound schema exit and
must not add a fallback provider, split terminal tools again, or make the local
schema accept invalid `status="passed"` plus `error`.

## Exhaustive Grep

Commands:

- `rg -n 'BuildResultSchema|report_build_result|files_changed|TerminalToolMissingError|BuildAgentContractError|status="passed"|status="failed"' packages/opencorvus/src packages/opencorvus/test -g '!**/dist/**'`
- `rg -n 'prepareProviderTool|normalizeToolSchemaForProvider|asSchema|z\.toJSONSchema|jsonSchema\(' packages/opencorvus/src/session packages/opencorvus/src/provider packages/opencorvus/test/session -g '!**/dist/**'`
- `rg -n 'strict|json_schema|additionalProperties|required.*properties|ProviderTransform\.schema|openai-compatible|gpt-5.5|hexin' packages/opencorvus/src packages/opencorvus/test specs -g '!**/dist/**'`

| Call point | Finding | Decision |
| --- | --- | --- |
| `session/loop.ts::prepareProviderTool` | Single exit for registry, MCP, extra, and structured tools | Keep as the entry point; pass through `ProviderTransform.schema` only |
| `session/loop.ts::createStructuredOutputTool` | Marks StructuredOutput as strict | Provider JSON Schema must satisfy OpenAI strict rules before it reaches GPT |
| `provider/transform.ts::schema` | Flattens root `anyOf`, but does not recursively strictify object `required` arrays | Add recursive OpenAI-strict object normalization for GPT/OpenAI-style strict schemas |
| `build/types.ts::BuildResultSchema` | Local runtime correctly rejects `status="passed"` with `error` | Keep local schema strict and add provider-schema regression coverage |
| `build/agent.ts::report_build_result.inputSchema` | Reuses `BuildResultSchema` | Keep single schema source |

## Design

Add a provider schema normalization step for OpenAI-style GPT routes:

- Applies only in `ProviderTransform.schema`, the existing single source.
- Detects OpenAI SDK, Azure SDK, or OpenAI-compatible GPT model routes.
- Recursively converts every object schema with `properties` to include every
  property key in `required`, because GPT strict tool schemas reject optional
  properties that are not listed.
- Optional local fields stay optional semantically by allowing `null` in the
  provider schema only; local execution still validates against the original
  Zod/JSON schema and rejects invalid payloads.
- Root `anyOf` flattening remains in the same helper so providers that require
  root object tool parameters still receive an object.

This is not a fallback path. It is a deterministic translation from the local
schema contract to the stricter JSON Schema dialect required by the GPT route.

## Verification

- Add a provider transform test reproducing the GPT 400 shape:
  `chronology.items.evidence` appears in properties and must also appear in
  the provider-bound `required` array.
- Add a build report provider schema test so `report_build_result` still
  exposes root object status enum and local schema still rejects passed/error.
- Run targeted provider/session/build tests.
