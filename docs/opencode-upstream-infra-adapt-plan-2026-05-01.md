# OpenCode Upstream Infrastructure Adapt Plan

Date: 2026-05-01

## Purpose

This plan adapts infrastructure improvements from the active upstream
`anomalyco/opencode` repository into local `argus-opencode` without creating a
second implementation path.

Terminology:

- LLM: Large Language Model, the model runtime called through provider adapters.
- API: Application Programming Interface, the HTTP and Software Development Kit
  contract consumed by clients.
- SDK: Software Development Kit, the generated client and provider packages.
- BOM: Byte Order Mark, the leading Unicode marker some text files preserve.
- LSP: Language Server Protocol, code intelligence servers used by tools.

## Evidence Baseline

Latest checked upstream branch:

- Repository: `https://github.com/anomalyco/opencode`
- Branch: `dev`
- Remote head checked on 2026-05-01: `4eae8ec037356a587521c7bc38cd1416f7d92cdc`

Local evidence:

- Local provider stack is already on `ai@5.0.124`.
- Local `@openrouter/ai-sdk-provider` is pinned to `1.5.4` and patched.
- Local provider transform tests already cover DeepSeek `reasoning_content`,
  OpenRouter `reasoning_details`, Azure reasoning variants, Bedrock cachePoint,
  providerOptions remapping, and tool-choice behavior for reasoning models.
- Local `SessionCompaction` still has an older reactive summary owner, but the
  session loop already has predictive prompt-budget checks.
- Local `api:routes-check` is a route-layer static rule check, not a complete
  OpenAPI route inventory gate.

## Current Gap Classification

### Implemented And Keep

- DeepSeek OpenAI-compatible assistant turns keep empty `reasoning_content`.
- OpenRouter DeepSeek reasoning metadata stays on `reasoning_details`.
- Reasoning models avoid hard `toolChoice: "required"` for JSON-schema output.
- Azure reasoning variants include `reasoningSummary` and encrypted-content
  include fields.
- Bedrock cache markers are injected for Anthropic-style Bedrock messages.
- Agent tool exposure is already controlled through `Agent.Info.tools`.

### Implemented But Under-Verified

- Provider request bodies are verified mostly through transform-level unit
  tests, not one normalized request-body contract harness.
- Bedrock cache coverage is tested for representative models, not every local
  configured Bedrock provider shape.
- Azure request compatibility is tested at option level, not full body shape.
- Compaction pruning exists, but recent-turn preservation and long-session
  continuation are not proven by a focused benchmark.
- API generated OpenAPI output exists, but registered route inventory is not
  compared to SDK coverage.

### Missing Or Needs Local Design

- Provider option namespace splitting for dotted provider identifiers.
- A provider request-body contract harness that fails before stream consumption.
- Route inventory tests that compare registered server routes, OpenAPI output,
  and generated SDK operations.
- BOM round-trip tests for text read/write/edit paths.
- Bash parser tree disposal or a long-run memory benchmark proving no parser
  retention.

### Explicit Non-Goals

- Do not migrate to upstream Effect HttpApi in this plan.
- Do not introduce mixed AI SDK v5/v6 runtime paths.
- Do not wholesale merge upstream commits.
- Do not add fallback serializers, compatibility branches, or keyword-only
  acceptance checks.

## Adaptation Rules

1. Every upstream improvement must be reduced to a local owner file, local test,
   and one local implementation path.
2. Request-body compatibility must be proven by structured body contracts or
   snapshots, not log text or provider error strings.
3. Existing local behavior that already satisfies an upstream fix must be marked
   implemented and covered, not reimplemented.
4. Dependency upgrades must be isolated behind a spike commit unless the current
   package cannot express the target request body.
5. Benchmarks must fail on the real regression class: malformed provider body,
   invalid tool adjacency, route drift, schema rejection, memory growth, or
   missing terminal LLM event.
6. When a phase changes runtime behavior, the same commit must include tests
   that prove the intended behavior.

## Phase 0: Provider Request-Body Contract

Status: complete.

Owner files:

- `packages/opencorvus/src/provider/transform.ts`
- `packages/opencorvus/src/provider/vendor-messages.ts`
- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/test/provider/`

Scope:

- Add a provider request-body contract test harness.
- Prove DeepSeek `reasoning_content`, OpenRouter `reasoning_details`, Azure
  reasoning defaults, Bedrock cache markers, and reasoning-model toolChoice.
- Implement dotted provider option namespace splitting if the contract fails.
- Decide the `@openrouter/ai-sdk-provider` upgrade only after the body contract
  proves the current package cannot serialize the required shape.

Acceptance:

- Provider contract tests pass.
- Existing provider transform tests pass.
- Typecheck passes.
- No second provider serializer is added.

Work queue:

- [x] Rebaseline old plan against current local code.
- [x] Add provider request-body contract tests.
- [x] Fix dotted provider option namespace splitting if failing.
- [x] Re-run provider tests and typecheck.
- [x] Mark Phase 0 complete only after tests prove the request-body matrix.

## Phase 1: Session Compaction And Retry Reliability

Status: complete.

Owner files:

- `packages/opencorvus/src/config/paths.ts`
- `packages/opencorvus/src/session/compaction.ts`
- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/src/session/message.ts`
- `packages/opencorvus/src/llm/activity.ts`
- `packages/opencorvus/test/session/`
- `packages/opencorvus/test/llm/`

Scope:

- Map upstream compaction tail concepts to local session metadata. Local code
  has no `tail_start_id` equivalent; fork safety is owned by cloned message
  `parentID` links.
- Add recent-turn preservation tests around compaction summaries.
- Keep the existing compacted-tool placeholder path as the single tool
  adjacency owner.
- Keep `withLLMActivity` as the single LLM retry and timeout owner; existing
  tests already prove successful, failed, and aborted calls emit one terminal.
- Fix non-git `.opencorvus` directory search so parent temp/user directories do
  not override the active project's local config.

Acceptance:

- [x] Long-session compaction continues without invalid tool adjacency.
- [x] Failed, aborted, and successful LLM calls each emit exactly one terminal
  activity event.
- [x] Fork tests prove cloned message parent links remain valid after
  compaction.
- [x] Compaction disable config cannot be overridden by unrelated parent
  `.opencorvus` directories in non-git projects.

## Phase 2: API And SDK Contract Parity

Status: pending Phase 1.

Owner files:

- `packages/opencorvus/src/server/routes/`
- `packages/opencorvus/script/check/routes.ts`
- `packages/sdk/openapi.json`
- `packages/sdk/js/src/gen/`
- `packages/opencorvus/test/server/`

Scope:

- Extend `api:routes-check` or add an adjacent check so it compares route
  inventory, OpenAPI operations, and generated SDK operations.
- Add safe GET parity tests for direct HTTP and SDK surfaces.
- Add optional-field omission tests for response bodies.
- Add raw-route authorization tests.

Acceptance:

- Adding a server route without OpenAPI and SDK coverage fails the route gate.
- Authorization tests prove both accepted and rejected raw routes.
- `docs:check` remains green after generated API changes.

## Phase 3: Tool Schema And Output Safety

Status: pending Phase 2.

Owner files:

- `packages/opencorvus/src/tool/`
- `packages/opencorvus/src/provider/transform.ts`
- `packages/opencorvus/test/tool/`
- `packages/opencorvus/test/provider/`

Scope:

- Add stable tool parameter snapshot tests for all built-in tools.
- Add provider-specific schema sanitation tests for rejected JSON Schema shapes.
- Add BOM round-trip tests for text read/write/edit.
- Add bash parser disposal or memory-growth benchmark.
- Add LSP permission metadata parity only if local LSP tool exposes the same
  request metadata concept.

Acceptance:

- Tool schemas are stable under snapshots.
- Provider schema sanitation removes only explicitly tested constructs.
- Repeated bash parsing does not retain syntax tree memory.
- Text tool round trips preserve BOM where the file has one.

## Phase 4: Dependency And Runtime Modernization

Status: pending explicit spike.

Scope:

- Spike OpenRouter provider upgrade in isolation.
- Spike AI SDK v6 only if upstream parity requires it and current v5 cannot
  express the required request contract.
- Evaluate upstream core package consolidation only after duplicated local
  runtime code is measured.
- Add oxlint correctness gates only after existing violations are known and
  fixed.

Acceptance:

- No mixed AI SDK major versions remain.
- No duplicate runtime owner remains.
- New lint gates run in the same quality path as typecheck and route checks.

## Immediate Implementation Decision

Phase 0 is complete. The provider request-body contract now proves the current
AI SDK v5 stack can serialize the required local matrix, with one local fix for
dotted OpenAI-compatible provider option namespaces. Do not start Session, API,
or Tool phases until this Phase 0 commit is pushed.
