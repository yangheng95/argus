# AI SDK v6 Complete Migration Plan

Date: 2026-05-01

## Purpose

Move OpenCorvus from AI SDK v5 to AI SDK v6 as a single runtime replacement.
This is not a compatibility bridge and not a dual-runtime experiment. The
target state has one AI SDK major version in the repository, one provider
adapter contract, and one tool schema path.

Terminology:

- AI: Artificial Intelligence, the model-backed execution layer.
- SDK: Software Development Kit, the TypeScript packages imported as `ai` and
  `@ai-sdk/*`.
- LLM: Large Language Model, the provider-hosted model that streams text and
  tool calls.
- API: Application Programming Interface, including provider request and
  response contracts.
- MCP: Model Context Protocol, the external tool protocol wrapped into AI SDK
  tools.
- UI: User Interface, including AI SDK message parts consumed by the terminal
  and overlay.
- JSON: JavaScript Object Notation, the schema-validated payload format for
  tools and structured outputs.

## Initial State

At plan creation, the repository pinned:

- root workspace catalog `ai: 5.0.124`
- `packages/opencorvus` dependency `ai: catalog:`
- `@ai-sdk/provider: 2.0.1`
- `@ai-sdk/provider-utils: 3.0.21`
- mixed `@ai-sdk/*` provider majors
- `@openrouter/ai-sdk-provider: 1.5.4` with a matching patch
- `script/check-ai-runtime.ts` explicitly rejects any non-v5 `ai` runtime

The v6 migration must update the dependency guard first or every push will
fail by design.

Official current target versions checked on 2026-05-01:

- `ai`: `6.0.172`
- `@ai-sdk/provider`: `3.0.10`
- `@ai-sdk/provider-utils`: `4.0.25`
- `@openrouter/ai-sdk-provider`: `2.9.0`

## Implementation Status

Completed in the active migration branch:

- Replaced the runtime dependency graph with `ai@6.0.172`,
  `@ai-sdk/provider@3.0.10`, `@ai-sdk/provider-utils@4.0.25`, and
  `@openrouter/ai-sdk-provider@2.9.0`.
- Updated `script/check-ai-runtime.ts` so the guard enforces AI SDK v6,
  provider v3, provider-utils v4, and OpenRouter v2.
- Removed the stale OpenRouter v1 patch and regenerated `bun.lock`.
- Migrated provider/session API references to AI SDK v6 types, including async
  `convertToModelMessages()`, `ToolExecutionOptions`, and v6 usage fields.
- Removed all repo source/test references to `streamObject()` and
  `generateObject()`; structured helpers now use
  `streamText({ output: Output.object(...) })`.
- Kept `@/llm/api` as the single stream wrapper for timeout, retry, and
  abortable iterable behavior.
- Marked `StructuredOutput` strict and marked terminal submit tools strict when
  terminal-tool scoping exposes the submit tool as the only available tool.
- Verified the current GitLab provider still exposes a v2 language-model
  implementation under the v6 runtime. `ProviderLLM.wrapModel()` therefore
  wraps only v3 models and passes non-v3 models through as the AI SDK v6
  `LanguageModel` union allows. This is a provider-version fact, not a v5/v6
  fallback path.

Focused verification completed:

- `bun run check:ai-runtime`
- `bun run --cwd packages/opencorvus typecheck`
- `bun test --timeout 60000 packages/opencorvus/test/session/structured-output-tool.test.ts packages/opencorvus/test/session/terminal-tool-recovery.test.ts packages/opencorvus/test/mirror/webpage-vision-judge-idle-gate.test.ts`

## Official Migration Constraints

The official AI SDK v6 migration guide requires these package-major targets:

- `ai` package: `^6.0.0`
- `@ai-sdk/provider`: `^3.0.0`
- `@ai-sdk/provider-utils`: `^4.0.0`
- `@ai-sdk/*`: `^3.0.0`

The same guide identifies code changes relevant to this repo:

- `convertToModelMessages()` is async in AI SDK v6.
- `generateObject()` and `streamObject()` are deprecated in favor of
  `generateText()` and `streamText()` with `Output.object(...)`.
- `ToolCallOptions` is renamed to `ToolExecutionOptions`.
- tool strict mode is controlled per tool via `strict: true`.
- the tool-call repair function accepts `string | SystemModelMessage` for the
  `system` parameter.
- provider changes include OpenAI strict JSON schema defaults, Azure Responses
  API defaults, Google Vertex metadata key changes, and v3 mock classes.

Sources:

- <https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0>
- <https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling>
- <https://ai-sdk.dev/docs/reference/ai-sdk-core/tool>

## Migration Principles

1. One runtime only: remove v5 package pins and v5-specific runtime guards in
   the same change that lands v6.
2. No provider fallback: provider-specific differences are represented as
   explicit provider adapter behavior and tests, not v5/v6 branching.
3. Tool schema single source: `SessionLoop.providerBoundInputSchema()` remains
   the only schema normalization path for provider-bound tools.
4. Streaming only: keep all LLM interactions on `streamText()` or
   `generateText()` with streaming-compatible output handling; do not introduce
   non-streaming LLM paths.
5. Strict terminal tools first: enable `strict: true` first on terminal
   structured tools such as `submit_verdict`, `submit_architect`, and
   `StructuredOutput`, after their schemas pass provider compatibility tests.
6. Local validation remains mandatory: provider strict mode improves request
   compliance, but execute-time schema and semantic validation still owns local
   correctness.

## Workstream A: Dependency Graph Replacement

Files:

- `package.json`
- `packages/opencorvus/package.json`
- `bun.lock`
- `script/check-ai-runtime.ts`
- `patches/@openrouter%2Fai-sdk-provider@1.5.4.patch`

Tasks:

- Replace root catalog `ai: 5.0.124` with a pinned v6 version.
- Upgrade all `@ai-sdk/*` runtime provider packages to v6-compatible majors.
- Upgrade `@ai-sdk/provider` and `@ai-sdk/provider-utils`.
- Replace `@openrouter/ai-sdk-provider@1.5.4` with the v6-compatible major.
- Delete the old OpenRouter v1 patch if the upgraded provider no longer needs
  it; if a patch is still needed, create a new patch for the exact new package
  version only.
- Rewrite `check-ai-runtime.ts` so it enforces v6, provider v3,
  provider-utils v4, and the selected OpenRouter major.

Acceptance:

- `bun install` produces one `ai@6.x` resolution and no `ai@5.x` resolution.
- `check-ai-runtime` fails on any v5 runtime dependency.
- pre-push no longer contains a v5-only runtime assertion.

## Workstream B: Provider Adapter Contract

Files:

- `packages/opencorvus/src/provider/provider.ts`
- `packages/opencorvus/src/provider/bundled.ts`
- `packages/opencorvus/src/provider/llm.ts`
- `packages/opencorvus/src/provider/transform.ts`
- `packages/opencorvus/test/provider/`
- `packages/opencorvus/test/workspace/mock-control-model.ts`

Tasks:

- Replace `LanguageModelV2` imports and mocks with the v6 provider contract.
- Audit provider metadata keys for OpenAI, Azure, Google Vertex, and
  OpenRouter.
- Keep `ProviderLLM.wrapModel()` as the single wrapper point for model
  middleware.
- Preserve request-body tests for tool choice, provider options, reasoning
  options, headers, and abort behavior.
- Update model mocks to v3 equivalents and keep tool-call stream fixtures
  structurally identical at the session boundary.

Acceptance:

- Provider tests prove request bodies match v6 for every supported provider.
- The OpenRouter provider can stream tool calls and tool results through the
  same session loop as first-party providers.
- No provider path imports v5 types.

## Workstream C: Message Conversion And Session Loop

Files:

- `packages/opencorvus/src/session/message.ts`
- `packages/opencorvus/src/session/llm.ts`
- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/src/llm/api.ts`
- `packages/opencorvus/test/session/`

Tasks:

- Make every `convertToModelMessages()` call `await`-aware.
- Rename `ToolCallOptions` to `ToolExecutionOptions`.
- Update `experimental_repairToolCall` typing for
  `string | SystemModelMessage`.
- Confirm `streamText()` result and `fullStream` part names consumed by
  `SessionLoop.processTurn()` are unchanged or update parser tests.
- Keep `@/llm/api` as the single stream wrapper and preserve the abortable
  iterable behavior that prevents parked streams.
- Audit `ProviderMetadata` and `callProviderMetadata` usage for v6 UI message
  parts.

Acceptance:

- Session message conversion tests pass with async model-message conversion.
- Tool-call repair still only lowercases known tool names and returns `null`
  for non-repairable calls.
- Structured output recovery still triggers on missing terminal tool calls.
- Abort tests prove a parked provider stream is still interrupted.

## Workstream D: Structured Object Streaming Replacement

Files:

- `packages/opencorvus/src/agent/agent.ts`
- `packages/opencorvus/src/mirror/image/extract.ts`
- `packages/opencorvus/src/mirror/tools/webpage-vision-judge.ts`
- `packages/opencorvus/src/task-api/index.ts`
- `packages/opencorvus/src/llm/api.ts`
- `packages/opencorvus/test/mirror/`
- `packages/opencorvus/test/server/`

Tasks:

- Replace direct `streamObject()` calls with `streamText()` plus
  `Output.object(...)`.
- Preserve partial object streaming semantics by adapting from
  `partialOutputStream` to the existing call-site expectations.
- Keep direct object-generation helpers behind `@/llm/api` so tracing,
  timeout, and abort handling stay centralized.
- Do not introduce `generateObject()` as a replacement.

Acceptance:

- Existing object-streaming tests pass without `streamObject()` imports from
  repo source.
- Vision judge idle-gate tests still prove abort wiring.
- Task API structured streams preserve public response shape.

## Workstream E: Tool Strict Mode And Schema Compatibility

Files:

- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/src/delivery/output-tools.ts`
- `packages/opencorvus/src/architect/output-tools.ts`
- `packages/opencorvus/src/design-analyst/output-tools.ts`
- `packages/opencorvus/src/requirements/output-tools.ts`
- `packages/opencorvus/src/intent-analysis/output-tools.ts`
- `packages/opencorvus/src/integrity/agent.ts`
- `packages/opencorvus/test/session/`
- `packages/opencorvus/test/integrity/`

Tasks:

- Add a `strict` policy to terminal structured tools after schema audit.
- Keep non-terminal work tools non-strict unless their schema is proven
  compatible and the provider supports strict mode.
- Add tests that inspect prepared AI SDK tools and assert strict mode is enabled
  for terminal tools only.
- Validate Zod-to-JSON-schema output against OpenAI strict JSON schema
  requirements: no unsupported optional `undefined`, ambiguous unions, or
  unconstrained records in terminal tools.
- Keep execute-time semantic guards, including delivery `submit_verdict`
  cross-field checks.

Acceptance:

- `submit_verdict` and other terminal submit tools carry `strict: true`.
- Strict terminal tools pass provider-bound schema tests.
- Invalid tool inputs still fail locally even if a provider ignores strict mode.
- There is no keyword-only or text-parsing structured output path.

## Workstream F: Test Runtime And Mock Migration

Files:

- `packages/opencorvus/test/workspace/mock-control-model.ts`
- `packages/opencorvus/test/provider/`
- `packages/opencorvus/test/session/`
- `packages/opencorvus/test/llm/`

Tasks:

- Replace mock model v2 types with v3 types.
- Update stream part fixtures to v6 names and payload shapes.
- Update `APICallError`, `LoadAPIKeyError`, and `NoSuchModelError` tests if
  constructors or static guards changed.
- Add a replay corpus for invalid `submit_verdict` attempts before and after
  strict mode.

Acceptance:

- Mock model fixtures compile without v2 imports.
- Session-loop tests cover tool calls, tool results, tool errors, text chunks,
  finish reasons, and aborts under v6.
- Replay shows fewer schema-invalid terminal calls without losing semantic
  rejection coverage.

## Workstream G: Verification And Rollout

Required checks:

- `bun run check:sdk-imports`
- `bun run check:ai-runtime`
- `bun run --cwd packages/opencorvus typecheck`
- focused tests:
  - `packages/opencorvus/test/session`
  - `packages/opencorvus/test/provider`
  - `packages/opencorvus/test/llm`
  - `packages/opencorvus/test/delivery`
  - `packages/opencorvus/test/agent`
  - `packages/opencorvus/test/mirror`
- `bun run api:routes-check`
- `bun run docs:check`

Runtime probes:

- OpenRouter streaming with a pinned terminal tool call.
- OpenAI strict terminal tool call.
- Anthropic multi-step tool loop.
- Azure provider option and metadata key behavior.
- Google Vertex provider option and metadata key behavior.
- MCP dynamic tool call with provider-normalized schema.

Acceptance:

- Lockfile contains no `ai@5`, `@ai-sdk/provider@2`, or
  `@ai-sdk/provider-utils@3` runtime resolution.
- Source contains no `LanguageModelV2` imports except in historical docs.
- Source contains no `ToolCallOptions` imports.
- Source contains no `streamObject` imports.
- All terminal structured tools use v6-compatible schema and local validation.
- Delivery still persists only the existing `delivery-agent-verdict` artifact.

## Suggested Commit Sequence

1. Dependency and runtime guard replacement.
2. Provider v3 adapter and mock model migration.
3. Async message conversion and session loop type migration.
4. `streamObject()` replacement behind `@/llm/api`.
5. Terminal tool strict mode and schema compatibility tests.
6. Provider matrix replay and delivery `submit_verdict` invalid-call corpus.
7. Documentation update and removal of obsolete v5 comments or patches.

Each commit must be independently typechecked and pushed through hooks. Do not
leave a partial v5/v6 runtime in the tree.
