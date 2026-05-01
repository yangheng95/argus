# OpenCode Upstream Infrastructure Adapt Plan

Date: 2026-05-01

## Scope

This audit compares the local `argus-opencode` infrastructure with the active upstream repository `anomalyco/opencode` on branch `dev`, focusing on changes from 2026-01-01 through 2026-05-01. The older `opencode-ai/opencode` repository is an archived Go implementation and is not treated as the adaptation target.

Evidence gathered from the upstream clone:

- Latest audited upstream head: `4e451a4 chore: update nix node_modules hashes`
- Relevant infra commits since 2026-01-01: 1444 commits across provider, session, server, tool, and SDK paths.
- Relevant path diff since 2026-01-01: 289 files changed, 135340 insertions, 21069 deletions.
- Upstream package version: `packages/opencode` `1.14.30`.

Primary references:

- Upstream repository: https://github.com/anomalyco/opencode
- OpenCode provider documentation: https://opencode.ai/docs/providers/
- DeepSeek reasoning model protocol: https://api-docs.deepseek.com/guides/reasoning_model

The goal is not to wholesale merge upstream. The goal is to extract infrastructure improvements that reduce provider failures, session stalls, API drift, tool protocol errors, and benchmark blind spots while preserving a single implementation path in this project.

## Executive Summary

Highest-value adaptation is provider protocol reliability. The recent DeepSeek failure in this project matches upstream's April 2026 provider fixes around interleaved `reasoning_content`, OpenRouter reasoning payloads, Azure reasoning defaults, and provider option remapping. The local fix for empty DeepSeek `reasoning_content` has already been implemented, but the upstream provider stability wave contains additional concrete fixes that should be adapted next.

Second priority is session compaction and streaming reliability. Upstream has significantly hardened compaction, fork tails, retry metadata, shell cancellation, and streaming hot paths. Local `SessionCompaction` still uses an older token-buffer heuristic and does not yet encode upstream's recent-preservation and tool-output budget rules.

Third priority is API and SDK parity. Upstream has moved many HTTP routes into a typed Effect HttpApi backend and added route inventory, SDK parity, middleware, authorization, and optional-field tests. A full HttpApi migration would be high risk for this project right now, but the parity tests and response-contract rules are directly useful and should be adopted before any backend rewrite.

Fourth priority is tool schema and output safety. Upstream migrated built-in tool schemas, expanded parameter tests, hardened bash memory behavior, preserved byte order marks in text round trips, and added provider-specific tool sanitization. Some local equivalents already exist, such as output truncation, so the adaptation should be selective.

Longer-term infrastructure work includes AI SDK v6, shared core runtime packages, OpenTelemetry, and lint correctness gates. These are valuable but should not be mixed into provider/session stabilization because they can create a large dependency and runtime migration at the same time.

## Upstream Changes With Local Benefit

### 1. Provider And LLM Compatibility

Important upstream commits:

- `a12333310 fix(provider): split providerOptions key on dot for openai-compatible, openai, and anthropic providers`
- `a740d2c66 fix: adjust azure defaults to closer match openai to prevent Item .. of type 'reasoning' was provided without its required following item`
- `588261076 fix: make deepseek string check a bit looser`
- `738b3065d tweak: make interleaved reasoning_content default to true for openai compat deepseek setups`
- `e7053c41f fix: bump openrouter sdk version to resolve deepseek reasoning issue`
- `86715fecc fix: ensure assistant messages always have reasoning on them for deepseek`
- `923af96d2 fix: preserve empty reasoning_content for DeepSeek V4 thinking mode`
- `f8e939d96 fix: support max for deepseek`
- `a882e958b fix: deepseek variants`
- `334ab4707 fix: account for additional openai retry case`
- `024979f3f feat(bedrock): Add token caching for any amazon-bedrock provider`

Local status:

- Implemented: empty interleaved DeepSeek `reasoning_content` is preserved for OpenAI-compatible DeepSeek payloads.
- Implemented: OpenRouter reasoning parts preserve `reasoning_details` instead of being converted into interleaved `reasoning_content`.
- Missing: provider option key splitting for dotted provider IDs.
- Missing: Azure reasoning compatibility defaults and dual provider option keys.
- Missing: full DeepSeek variant/capability matrix, including `max`.
- Missing: OpenRouter SDK upgrade validation.
- Missing: Bedrock cache-control coverage across all Amazon Bedrock providers.
- Partial: provider serializer tests exist, but they do not yet cover the full upstream provider matrix.

Adaptation value:

- Prevents HTTP 400 failures caused by malformed reasoning payloads.
- Reduces model-provider regressions when providers expose OpenAI-compatible APIs with divergent option keys.
- Turns provider behavior into body-level tests instead of relying on manual task failures.

### 2. Session, Streaming, Compaction, And Retry Reliability

Important upstream commits:

- `8b56d1712 refactor(session): pass project to list`
- `5984d917d refactor(session): yield instance context in system prompt`
- `8aa8798e0 refactor(session): yield instance context in llm`
- `e3134a2a9 refactor(session): align prompt input types with their schemas`
- `d71b827d8 fix(session): remap compaction tail_start_id when forking`
- `ce78a4265 fix(session): remove compaction summary dividers`
- `c4a2353ac fix(session): omit undefined optional fields`
- `139c4fd55 fix(session): harden shell cancellation`
- `574b2c217 fix(session): improve session compaction`
- `882b8e1e7 core: track retry attempts with detailed error context on assistant entries`
- `f83cecaaf fix(opencode): untrace streaming event hot paths`
- `4ca809ef4 fix(session): retry 5xx server errors even when isRetryable is unset`
- `348a84969 fix: ensure tool_use is always followed by tool_result`
- `f9d99f044 fix(session): keep GitHub Copilot compaction requests valid`
- `e8471256f refactor(session): move llm stream into layer`
- `f73ff781e fix(opencode): export AI SDK telemetry spans`

Local status:

- Local LLM calls are already wrapped by `withLLMActivity`, which gives first-byte, idle, and total-deadline guarantees.
- Local compaction still uses an older `SessionCompaction` shape with a broad buffer heuristic.
- Local code does not yet appear to encode upstream's recent-token preservation, protected tool output budget, fork tail remap, or detailed assistant retry context.

Adaptation value:

- Reduces context-overflow loops and invalid compaction requests.
- Improves reproducibility when a task forks or resumes after compaction.
- Makes retry and cancellation failures observable rather than hidden inside generic assistant errors.

### 3. HTTP API, SDK, And Route Contract Parity

Important upstream commits:

- `dd3aa9673 test(httpapi): cover more safe GET parity`
- `3c24d22d4 fix(httpapi): omit absent optional response fields`
- `5ba68a28c refactor(httpapi): scope async prompt fiber`
- `3544ea024 refactor(httpapi): drop session prompt bridge`
- `451650b58 refactor(httpapi): preserve typed errors in session prompt handlers`
- `96f4da1e1 Serve instance events through HttpApiBuilder`
- `2dd1f2d45 Avoid request-time HttpApi layer provisioning`
- `3250b814c Fix HttpApi raw route authorization`
- `6015084fa Prepare Effect HttpApi backend parity`
- `9052e8a1b test: cover HttpApi workspace routing middleware`
- `acd15dcc8 test(httpapi): cover full OpenAPI route inventory`
- `58244eb68 feat(httpapi): bridge event stream`
- `fc6d4b401 core: Add User-Agent header to identify client version in HTTP requests`

Local status:

- Local project already has OpenAPI route generation and a `api:routes-check` quality gate.
- Local project has Hono-based routing and should not jump directly to a second Effect HttpApi implementation.
- Missing: upstream-style route inventory tests, safe GET parity, optional-field omission checks, typed error preservation checks, and route authorization tests.

Adaptation value:

- Prevents overlay, SDK, and server contracts from drifting.
- Converts API compatibility from manual inspection into repeatable tests.
- Enables later server refactors without accepting a second runtime path.

### 4. Tool Framework And Output Safety

Important upstream commits:

- `3910a6e52 refactor(tool): migrate tool framework + all 18 built-in tools to Effect Schema`
- `6aa8e894b chore: rm broken codesearch tool`
- `d4bf70be0 fix(bash): memory leak - release parsed syntax trees`
- `528fb1d40 fix: sanitize tools for moonshot`
- `8718b98ee fix: pass workspace symbol query to experimental LSP tool`
- `9ff999cc2 tool/lsp: include request details in permission metadata`
- `f8c6ddd4c feat(truncate): allow configuring tool output truncation limits`
- `8113a4360 fix: preserve BOM in text tool round-trips`
- `f7514d9ec refactor(tool): convert bash to defineEffect with ChildProcessSpawner`

Local status:

- Local project already has a tool output truncation module and tests.
- Local project has not yet adopted upstream's full tool parameter snapshot suite.
- Missing: bash syntax-tree release verification, byte order mark round-trip tests, provider-specific tool schema sanitation, and LSP permission metadata parity.

Adaptation value:

- Reduces provider failures from unsupported tool schemas.
- Prevents memory growth in long benchmark runs.
- Protects file fidelity during text edit/read/write cycles.

### 5. Shared Core Runtime, Observability, And Quality Gates

Important upstream commits:

- `1a734adb4 core: consolidate shared infrastructure into core package`
- `705f792e8 core: move Global module to @opencode-ai/core`
- `3d6f90cb5 feat: add oxlint with correctness defaults`
- `80f1f1b5b feat: enable type-aware no-floating-promises rule, fix all 177 violations`
- `8aa0f9fe9 feat: enable type-aware no-base-to-string rule, fix 56 violations`
- `675a46e23 CLI perf: reduce deps`
- `b0600664a feat: add support for fast modes for claude and gpt models`

Local status:

- Local project has shared packages but not upstream's new core package layout.
- Local push hook already enforces typecheck, API route checks, docs checks, overlay i18n, and secret scanning.
- Local root does not yet use upstream's oxlint correctness gates.

Adaptation value:

- Improves correctness around unawaited promises and accidental stringification.
- Makes observability and process metadata consistent across CLI, server, and executor surfaces.
- Should be adopted only after provider and session stabilization to avoid combining runtime migration with protocol fixes.

## Adaptation Rules

1. No wholesale upstream merge. Each upstream improvement must be reduced to a local design decision, local tests, and a single local implementation.
2. No fallback or double-source behavior. Replacing a provider/session/API/tool path means deleting the old path or making the old path unreachable in the same commit.
3. No keyword-based fake acceptance. Provider support must be proven by structured model/provider capability data or request-body snapshots, not brittle string checks.
4. Tests must encode the intended behavior before or with each behavior change.
5. Benchmarks must fail on the real regression class: malformed provider request bodies, invalid compaction messages, API route drift, tool schema rejection, memory growth, or missing terminal events.
6. Dependency upgrades must be isolated from behavior patches unless the behavior cannot be expressed without the upgrade.

## Implementation Phases

### Phase 0: Provider Stability Pack

Status: ready.

Scope:

- Adapt upstream provider option key splitting for dotted provider IDs.
- Add Azure-compatible reasoning defaults and provider option parity without introducing a parallel Azure serializer.
- Complete DeepSeek thinking-mode coverage: empty `reasoning_content`, assistant reasoning part presence, `max`, and variant capability data.
- Validate whether upgrading `@openrouter/ai-sdk-provider` to upstream `2.8.1` is required after local serializer tests are in place.
- Add Bedrock cache-control tests for every configured Amazon Bedrock provider.

Required tests and benchmarks:

- Unit tests for `toParts` and AI SDK-compatible message serialization.
- Request-body snapshot tests for OpenAI-compatible DeepSeek, OpenRouter DeepSeek, Azure reasoning, and Bedrock cache-control.
- A mocked streaming benchmark that verifies the provider body before stream consumption.

Acceptance:

- Provider tests pass.
- Typecheck passes.
- Provider benchmark detects omission of `reasoning_content`, `reasoning_details`, Azure reasoning defaults, and Bedrock cache-control.

### Phase 1: Session Compaction And Retry Reliability

Status: pending Phase 0.

Scope:

- Adapt upstream compaction improvements into the local `SessionCompaction` owner.
- Add structured recent-token preservation with configurable minimum and maximum recent budgets.
- Add protected tool-output pruning rules in one compaction implementation.
- Add fork-tail remap handling if local fork metadata has the same concept.
- Add retry-attempt details to assistant entries.
- Harden shell cancellation and server-5xx retry classification where local behavior matches upstream's failure class.

Required tests and benchmarks:

- Compaction tests for long conversations with tool calls, recent turns, large tool outputs, and provider-specific compaction requests.
- Fork/resume tests that verify compaction tail metadata points at valid local messages.
- Streaming retry tests for 5xx errors without provider `isRetryable` metadata.
- Shell cancellation test that proves terminal cleanup.

Acceptance:

- A long-session benchmark can compact and continue without invalid tool adjacency or context overflow.
- Exactly one terminal LLM event is emitted for failed, aborted, and successful provider calls.

### Phase 2: API And SDK Contract Parity

Status: pending Phase 1.

Scope:

- Add full OpenAPI route inventory tests inspired by upstream.
- Add safe GET parity tests.
- Add optional-field omission tests.
- Add typed error preservation tests for prompt/session handlers.
- Add workspace routing and raw-route authorization tests.
- Add client `User-Agent` header behavior where local clients make outbound HTTP requests.

Non-goal:

- Do not migrate to upstream Effect HttpApi in this phase. The immediate value is contract proof, not a second backend.

Acceptance:

- `api:routes-check` remains the single route contract gate.
- Route inventory tests fail when a server route is added without OpenAPI/SDK coverage.
- Auth middleware tests cover both allowed and rejected raw routes.

### Phase 3: Tool Schema And Output Safety

Status: pending Phase 2.

Scope:

- Add tool parameter snapshot tests for all built-in tools.
- Adapt upstream tool schema sanitation for providers that reject unsupported JSON schema shapes.
- Add byte order mark read/write round-trip tests.
- Add bash syntax-tree release verification or a long-run memory benchmark.
- Add LSP permission metadata parity if the local LSP tool exposes request metadata.

Acceptance:

- Tool schemas are stable under snapshot tests.
- Provider-specific tool sanitation has tests proving the exact removed schema constructs.
- Long benchmark runs do not accumulate bash parser state.

### Phase 4: Dependency And Runtime Modernization

Status: pending explicit spike.

Scope:

- Spike AI SDK v6 in an isolated branch after Phase 0 provider tests are comprehensive.
- Evaluate upstream `packages/core` consolidation only if it removes duplicated local process/global/observability code.
- Add oxlint correctness gates for `no-floating-promises` and `no-base-to-string` after existing violations are fixed.
- Evaluate OpenTelemetry span export once LLM stream hot paths are proven not to regress.

Acceptance:

- No mixed AI SDK v5/v6 runtime path remains.
- No duplicate core runtime package remains.
- Lint gates run in the same quality path as typecheck and route checks.

## Risk And Priority Matrix

| Item | Value | Risk | Decision |
| --- | --- | --- | --- |
| DeepSeek/OpenRouter/Azure provider fixes | High | Low to Medium | Do first in Phase 0 |
| Provider option key splitting | High | Low | Do first in Phase 0 |
| Bedrock cache-control parity | Medium | Low | Include in Phase 0 if provider config supports it |
| Session compaction rewrite | High | Medium | Phase 1 after provider tests |
| Shell cancellation and retry metadata | Medium | Medium | Phase 1 with focused tests |
| OpenAPI route parity tests | High | Low | Phase 2 |
| Effect HttpApi migration | Medium | High | Defer; tests first |
| Tool schema snapshot suite | Medium | Low | Phase 3 |
| Bash parser memory fix | Medium | Medium | Phase 3 with benchmark proof |
| AI SDK v6 | High | High | Isolated spike after Phase 0 |
| Shared core package migration | Medium | High | Defer until duplication is measured |
| Oxlint correctness gates | Medium | Medium | Phase 4 after violations are known |

## Initial Work Queue

- [ ] Phase 0.1: Add provider request-body snapshot harness.
- [ ] Phase 0.2: Adapt provider option key splitting.
- [ ] Phase 0.3: Add Azure reasoning/store/cache default behavior and tests.
- [ ] Phase 0.4: Complete DeepSeek variant/capability tests.
- [ ] Phase 0.5: Validate OpenRouter SDK upgrade need under tests.
- [ ] Phase 0.6: Add Bedrock cache-control tests.
- [ ] Phase 1.1: Port compaction recent-preservation algorithm into local `SessionCompaction`.
- [ ] Phase 1.2: Add fork-tail remap tests if local metadata supports it.
- [ ] Phase 1.3: Add retry-attempt detail and 5xx retry tests.
- [ ] Phase 2.1: Add route inventory and safe GET parity tests.
- [ ] Phase 2.2: Add optional-field and typed-error tests.
- [ ] Phase 3.1: Add tool schema snapshot tests.
- [ ] Phase 3.2: Add BOM and bash memory-safety tests.
- [ ] Phase 4.1: Run isolated AI SDK v6 spike after provider harness is stable.

## Benchmark Matrix

Provider benchmark:

- DeepSeek OpenAI-compatible thinking request includes `reasoning_content` even when empty.
- OpenRouter DeepSeek request preserves `reasoning_details`.
- Azure reasoning request includes the required following item and provider options.
- Bedrock requests include cache-control metadata where the provider supports it.

Session benchmark:

- A long task triggers compaction, preserves recent turns, prunes oversized tool outputs, and continues streaming.
- A forked session after compaction does not reference invalid tail metadata.
- Provider 5xx failures retry or terminate with detailed assistant retry metadata.

API benchmark:

- OpenAPI route inventory matches registered server routes.
- Safe GET routes behave the same through SDK and direct HTTP surfaces.
- Optional fields are omitted rather than serialized as undefined-like values.
- Raw routes enforce authorization.

Tool benchmark:

- Large tool outputs truncate through one configurable truncation owner.
- Text round trips preserve byte order marks.
- Bash parser memory is released across repeated invocations.
- Provider-specific tool sanitation generates accepted schemas.

## Final Recommendation

Start with Phase 0 immediately. It directly addresses the observed provider failure class and is small enough to complete with strong tests. Defer AI SDK v6 and Effect HttpApi until the provider and session behavior is locked by tests; otherwise, dependency churn will obscure protocol regressions. The adaptation should proceed as a sequence of narrow commits, each containing the local implementation, regression tests, benchmark coverage where relevant, and no compatibility path left behind.
