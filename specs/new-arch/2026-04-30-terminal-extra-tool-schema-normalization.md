# 2026-04-30 Terminal Extra Tool Schema Normalization

## Status

Implemented with review follow-up. This document extends:

- the earlier structured-output-systemic-fix plan (since removed; its core insights were folded into the two docs below)
- `specs/new-arch/2026-04-30-terminal-contract-hard-pin.md`
- `specs/new-arch/2026-04-30-result-schema-hardening.md`

## Terms

- LLM: Large Language Model, the model receiving tool definitions.
- SDK: Software Development Kit, here mainly AI SDK `streamText`.
- JSON: JavaScript Object Notation, the payload format for tool inputs.
- MCP: Model Context Protocol, external tool source merged into the session tool set.
- E2E: End-to-End, live provider-level verification.
- CI: Continuous Integration, automated local or remote checks.
- Zod: TypeScript schema library used to define and validate local payloads.

## Trigger

After the terminal result schema hardening, all collector-style agents became
more likely to miss or misuse their submit schema:

- `requirements`: can register facts but fail to close with
  `submit_requirements({ final: true })`.
- `architect`: can register goals/contracts but fail to close with
  `submit_architect({ summary })`.
- `integrity`: can submit dimensions but miss
  `submit_integrity_review({ final: true })`.
- `build`: can finish work but fail to produce a valid `report_build_result`
  payload; live logs show repeated
  `BuildResultSchema: expected object, received undefined`.

The failure became visible immediately after the 2026-04-30 refactor because
terminal submit tools changed from mostly empty or split schemas into explicit
payload schemas and a single discriminated build result schema.

## Evidence

### Recent commits that changed the contract

- `b2b89b44b unify terminal build result hard pin contract`
  - Replaced `report_build_passed` / `report_build_failed` with one
    `report_build_result` terminal tool.
  - Added readiness-based terminal hard-pin contract to the runner/session loop.
- `5a061e499 harden terminal result schemas and tool scoping`
  - Changed `submit_requirements` and `submit_integrity_review` from empty
    object tools to `{ final: true }`.
  - Reused `BuildResultSchema` as `report_build_result.inputSchema`.
  - Scoped visible tools to only the terminal tool when the collector reports
    ready.

### Current code path evidence

Before this fix, the session loop had four provider-bound tool sources:

1. Registry tools:
   - converted through `normalizeToolSchemaForProvider(model, z.toJSONSchema(...))`
   - wrapped with `jsonSchema(...)`
2. MCP tools:
   - converted through `normalizeToolSchemaForProvider(model, asSchema(...).jsonSchema)`
   - wrapped with `jsonSchema(...)`
3. Ephemeral extra tools from `SessionPrompt.withExtraTools`:
   - merged late through `getExtraTools(session.id)`
   - only passed through `wrapExtraTool`
   - `wrapExtraTool` normalizes `execute` output and attachment stamping
   - `wrapExtraTool` does not normalize or validate `inputSchema`
4. StructuredOutput tool injection:
   - created after `resolveTools`
   - assigned as `tools["StructuredOutput"]`
   - did not pass through the provider schema normalization boundary

All terminal submit tools used by requirements, architect, integrity, build,
and acceptance are stage-scoped extra tools. StructuredOutput uses a different
injection point but had the same class of bypass. Therefore the impacted
surface is every late-injected provider-bound tool source, not only extra
tools.

### Schema shape evidence

Using AI SDK `asSchema` on a Zod discriminated union creates a root `anyOf`
schema for `BuildResultSchema`. The project already has
`ProviderTransform.schema(...)` logic that can flatten this for providers that
require root object tool parameters.

The registry/MCP paths benefit from that transform. Extra tools do not.

## Root Cause

The refactor assumed terminal submit tools behave like normal provider-bound
tools, but they are injected through the ephemeral extra-tool path. That path
does not share the registry/MCP schema normalization boundary.

This created a protocol split:

| Tool source | Provider schema normalization | Current status |
| --- | --- | --- |
| Registry | yes | correct before the fix |
| MCP | yes | correct before the fix |
| Extra tools | no | broken for complex terminal schemas |
| StructuredOutput | no | broken for providers that require normalized root object tool parameters |

The secondary issue is that `isReadyToFinalize` now mixes two different
meanings:

1. "The collector has enough facts that submitting can succeed."
2. "It is safe to hide every non-terminal tool from the model."

These are not equivalent. For example, requirements uses
`requirements.length > 0`, which can make the loop expose only
`submit_requirements` after the first requirement, even though more
requirements or decisions may still need to be registered. Build uses
`Boolean(mergedHead)`, which only covers the passed path and does not express
the failed path where `report_build_result({ status: "failed", ... })` is a
valid terminal action before merge.

## Non-Goals

- Do not add provider-specific fallback logic.
- Do not parse prose into submit payloads.
- Do not add a keyword rule for `submit_*` or `report_*`.
- Do not add hidden synthetic messages to remind the model.
- Do not restore `report_build_passed` / `report_build_failed`.
- Do not keep old and new terminal protocols side by side.
- Do not change models to mask the protocol bug.
- Do not add new source-specific schema preparation branches such as
  `if (source === "...")`; new provider-bound tool sources must enter the
  shared preparation boundary before `streamText`.

## Design Principles

1. Tool schema normalization has one exit boundary.
   Every provider-bound tool, regardless of source, must expose the schema
   shape produced by the same normalization helper.

2. Extra tools are first-class tools.
   Stage-local tools are not a special weaker channel. They must satisfy the
   same schema and execution contracts as registry/MCP tools.

3. Terminal scoping must be semantically safe.
   The loop may hide work tools only when hiding them cannot prevent a valid
   completion.

4. Errors remain explicit.
   If a terminal tool is missing, absent, malformed, or schema-invalid, the
   system should expose that exact contract failure.

## Target Architecture

### Single Provider-Bound Tool Preparation Step

Introduce one helper in `session/loop.ts`:

```ts
prepareProviderTool(input: {
  name: string
  tool: AITool
  model: Provider.Model
  source: "registry" | "mcp" | "extra" | "structured"
  sessionID: string
  messageID: string
}): AITool
```

Responsibilities:

- require every provider-bound tool to have an `inputSchema`;
- unwrap the input schema with `asSchema(tool.inputSchema).jsonSchema`;
- run `normalizeToolSchemaForProvider(model, jsonSchemaPayload)`;
- re-wrap with AI SDK `jsonSchema(normalized)`;
- preserve description and other AI SDK tool metadata;
- preserve or wrap `execute` according to the source-specific output contract;
- throw a typed error if schema unwrapping fails.

Registry and MCP callers stop performing schema normalization inline. They
create raw tools, then call `prepareProviderTool(...)`.

Extra tools stop being directly assigned as:

```ts
tools[name] = wrapExtraTool(extraTool, ctx)
```

and instead become:

```ts
tools[name] = prepareProviderTool({
  name,
  tool: wrapExtraTool(extraTool, ctx),
  model: input.model,
  source: "extra",
  sessionID: input.session.id,
  messageID: input.processor.message.id,
})
```

If this creates accidental double-normalization in registry/MCP, delete the
old inline normalization first. There must be only one schema transform call
site for provider-bound tools.

StructuredOutput must also call `prepareProviderTool(...)` at its injection
point. Its source label is diagnostic only; it must not change schema behavior.

### Terminal Contract Rename

Replace:

```ts
isReadyToFinalize(collector)
```

with:

```ts
shouldExposeOnlyTerminalTool(collector)
```

The new name expresses the real consequence: all other tools are hidden and
`toolChoice` is pinned to the terminal tool.

This is not a state machine. It is a derived predicate over the collector and
tool surface.

### Terminal Tool Choice

Keep the existing three outcomes:

- no contract, satisfied contract, or missing terminal tool: `undefined`
- contract unsatisfied and not safe to scope: `"required"`
- contract unsatisfied and safe to scope: `{ type: "tool", toolName }`

The change is only the predicate source and naming:

```ts
if (contract.shouldExposeOnlyTerminalTool()) {
  return { type: "tool", toolName: contract.toolName }
}
return "required"
```

### Terminal Tool Scoping

`terminalToolScopedTools` should use the same predicate:

```ts
if (!contract.shouldExposeOnlyTerminalTool()) return tools
return { [contract.toolName]: terminalTool }
```

Add a diagnostic log when scoping happens:

- session id
- agent
- terminal tool name
- original tool names
- scoped tool names

Do not use that log as behavior. It is observability only.

## Agent-Specific Readiness Rules

### Requirements

Current rule:

```ts
collector.requirements.length > 0
```

Problem:

This is too early. A requirements session can need multiple explicit and
implicit requirements plus decisions. Hiding `register_requirement` and
`register_decision` after one requirement prevents valid completion.

New rule:

Do not use terminal-only scoping for requirements until there is an explicit
collector-level completeness signal. In the first implementation, requirements
should keep `toolChoice: "required"` until `submit_requirements` satisfies the
contract.

This means:

- `submit_requirements` remains available throughout the run.
- work tools remain available until the model chooses to submit.
- missing submit still becomes `TerminalToolMissingError` on prose stop.
- no early terminal-only narrowing is applied.

If a future requirements collector tracks expected requirement count or a
quality checklist, that derived completeness signal can become
`shouldExposeOnlyTerminalTool`.

### Architect

Current rule:

```ts
architectValidationIssues(collector).length === 0
```

This is closer, but still needs a semantic review.

Keep terminal-only scoping only when:

- validator has no issues;
- at least two goals exist;
- mandatory metric/spec/contract checks are complete;
- any validator issue would still require work tools to fix.

If `submit_architect` itself can return issues after terminal-only scoping,
that is unsafe because the model would have no `register_*` tools left to fix
the issues. Therefore `shouldExposeOnlyTerminalTool` must use the same
validation logic as `submit_architect` before the terminal-only turn.

The invariant is guarded by test: Architect readiness must equal
`architectValidationIssues(collector).length === 0`, which is the
`submit_architect` execution precondition.

2026-04-30 follow-up: live Architect showed
`Model tried to call unavailable tool 'register_traceability'. Available tools:
submit_architect.` The tool was not deleted; terminal-only scoping hid it
because `architectValidationIssues(...)` did not require traceability coverage
for `goal.requirement_ids`. The validator must reject any missing or incomplete
REQ-N to goal traceability row before readiness can become true.

Second follow-up from the same incident: traceability was only one missing
precondition. Architect readiness now treats the full prompt-level finalize
contract as the submit precondition, including:

- exactly one dedicated `kind="verification"` test goal;
- that verification goal depends on every feature goal and owns only
  `tests/integration`, `tests/e2e`, or `tests/regression` paths;
- non-`verification`/`system` goals declare at least one export;
- goals with `depends_on` also declare imports;
- acceptance specs reference their owning goal id;
- challenge seeds and contracts do not reference unknown goals;
- traceability covers every `goal.requirement_ids` mapping.

If any of these is incomplete, `shouldExposeOnlyTerminalTool` must stay false
so `register_goal`, `modify_goal`, `register_contract`,
`register_challenge_seed`, and `register_traceability` remain available.

### Integrity

Current rule:

```ts
INTEGRITY_DIMENSIONS.every((dimension) => collector.dimensions.has(dimension.id))
```

This is safe because every non-terminal integrity tool is per-dimension, and
after all dimensions are present the only valid remaining action is
`submit_integrity_review({ final: true })`.

Keep this rule, renamed to `shouldExposeOnlyTerminalTool`.

### Build

Current rule:

```ts
Boolean(mergedHead)
```

Problem:

This only captures the successful publish path. A failed build may validly
call `report_build_result({ status: "failed", ... })` without `merge_back`.
But the host cannot always know from collector state that the agent is ready
to fail, because the failure reason lives in the model's reasoning and tool
history.

New rule:

Build should terminal-only scope only after `mergedHead` exists. Before that,
it should keep `toolChoice: "required"` in the work phase and rely on the
schema-normalized `report_build_result` tool being available. Once
`mergedHead` exists, it is safe to expose only `report_build_result` for the
passed path.

Failed path remains valid without terminal-only scoping:

- model can call `report_build_result(status="failed")`;
- build core prompt explicitly instructs that failure is also terminal and
  must close with `report_build_result(status="failed")`, not prose;
- if model stops in prose, host emits `TerminalToolMissingError`;
- no fallback converts prose into a failed result.

If build later records a collector-level fatal blocker, e.g.
`collector.fatalBlocker`, that can also make terminal-only scoping safe.

### Acceptance

Acceptance already has a terminal submit tool with a rich payload. It should be
audited under the same extra-tool schema normalization fix. Do not add a
acceptance-specific schema workaround.

## Implementation Plan

### Phase 1: Add Schema Normalization Tests First

Add tests under `packages/opencorvus/test/session/`.

Required cases:

1. Extra tool with `z.object({ final: z.literal(true) })`
   - after provider preparation, schema is JSON schema with required `final`;
   - execute wrapper still returns `{ output, title, metadata }`.

2. Extra tool with `BuildResultSchema`
   - provider-bound schema is a root object for providers that require root
     object parameters;
   - raw root `anyOf` is not sent for the affected provider shape.

3. Registry and MCP tools still pass through the same helper.
   - test with a spy or exported helper result;
   - assert no duplicate provider transform.

4. Tool without `inputSchema`
   - fail with a typed error;
   - do not silently send `{}`.

### Phase 2: Refactor Tool Preparation

Files:

- `packages/opencorvus/src/session/loop.ts`

Steps:

1. Extract `providerBoundInputSchema(...)`:
   - input: raw `AITool.inputSchema`, model, tool name, source;
   - output: AI SDK `jsonSchema(normalized)`;
   - throw typed error on invalid input schema.

2. Extract `prepareProviderTool(...)`:
   - handles schema;
   - delegates execute wrapping to source-specific wrappers.

3. Update registry tool creation:
   - remove inline `normalizeToolSchemaForProvider(...)`;
   - create raw tool;
   - call `prepareProviderTool(...)`.

4. Update MCP tool creation:
   - remove inline mutation of `item.inputSchema`;
   - create or clone raw tool;
   - call `prepareProviderTool(...)`.

5. Update extra tool merge:
   - keep `wrapExtraTool` for execute result shape and attachment stamping;
   - call `prepareProviderTool(...)` afterward.

6. Update `estimateToolPayloadChars(...)`:
   - read already-prepared tool schema;
   - do not run provider transform again.

### Phase 3: Rename Terminal Readiness Contract

Files:

- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/src/agent/runner.ts`
- stage agents using `terminalTool`

Steps:

1. Rename interface field:
   - `isReadyToFinalize` -> `shouldExposeOnlyTerminalTool`

2. Rename helper usages:
   - `terminalToolChoice`
   - `terminalToolScopedTools`

3. Update test names and assertion text.

4. No compatibility alias. This is an unreleased project and dual fields would
   become a protocol fork.

### Phase 4: Fix Agent Predicates

Requirements:

- set `shouldExposeOnlyTerminalTool` to a predicate that currently returns
  `false`;
- keep terminal contract required so prose stop still becomes
  `TerminalToolMissingError`.

Architect:

- keep validation-based predicate only if it fully matches
  `submit_architect` preconditions;
- otherwise make it stricter, not looser.

Integrity:

- keep all-dimensions-present predicate.

Build:

- expose only terminal tool when `mergedHead` exists;
- do not claim this covers failed path;
- document that failed path remains under `"required"` until a collector-level
  fatal blocker exists.

### Phase 5: Observability

Add logs, not behavior:

- prepared tool schema summary:
  - source
  - tool name
  - schema root type
  - schema char count
- terminal scoping summary:
  - terminal tool name
  - original tool count
  - scoped tool count
  - predicate result

Do not log full schema by default; it is too noisy and can contain large
descriptions. Tests can inspect helpers directly.

### Phase 6: Provider Probe Repair

The existing opt-in provider hard-pin probe is currently not reliable because
it can fail before reaching the provider when `Instance` context is missing.

Fix:

- wrap the test body in `Instance.provide(...)`;
- use `tmpdir(...)` fixture for a real project directory;
- keep the probe opt-in behind `OPENCORVUS_PROVIDER_E2E=1`.

Probe assertions:

- pinned tool is called;
- unpinned tool is not called;
- payload is schema-valid object;
- empty, `undefined`, or wrong payload fails the test.

This probe is not a fallback and not a production branch. It is a capability
test for promoting provider/model combinations.

## Hidden Coupling

`shouldExposeOnlyTerminalTool` is allowed to hide every work tool. Therefore it
must be a subset of the corresponding terminal submit tool's success
precondition. If the terminal submit tool could return fixable validation
issues, terminal-only scoping is unsafe because the model would lose the tools
needed to repair those issues.

Architect currently shares `architectValidationIssues(collector)` between
`isArchitectReadyToFinalize` and `submit_architect.execute(...)`. The invariant
test in `packages/opencorvus/test/architect/output-tools.test.ts` asserts that
readiness remains identical to that validation precondition.

Architect traceability is part of that precondition: every requirement id
declared by a goal must have a `register_traceability` row that maps back to
that goal. Otherwise terminal-only scoping would remove the exact tool needed
to complete the Architect contract.

The same rule applies to every Architect work tool. Terminal-only scoping is
permitted only after `submit_architect` would no longer return fixable issues
about goals, metrics, verification-goal shape, exports/imports, challenge
seeds, traceability, or contracts.

## Test Matrix

Run these before implementation is accepted:

```text
bun test packages/opencorvus/test/session/tool-payload-estimator.test.ts
bun test packages/opencorvus/test/session/extra-tools.test.ts
bun test packages/opencorvus/test/session/terminal-tool-recovery.test.ts
bun test packages/opencorvus/test/requirements/agent.test.ts
bun test packages/opencorvus/test/architect/agent.test.ts
bun test packages/opencorvus/test/integrity/agent.test.ts
bun test packages/opencorvus/test/build-agent/types.test.ts
```

Then run:

```text
bun run typecheck
```

Optional provider probe:

```text
OPENCORVUS_PROVIDER_E2E=1 \
OPENCORVUS_E2E_PROVIDER_ID=<provider-id> \
OPENCORVUS_E2E_MODEL_ID=<model-id> \
bun test packages/opencorvus/test/provider/tool-choice-pin-e2e.test.ts
```

On Windows PowerShell:

```text
$env:OPENCORVUS_PROVIDER_E2E="1"
$env:OPENCORVUS_E2E_PROVIDER_ID="<provider-id>"
$env:OPENCORVUS_E2E_MODEL_ID="<model-id>"
bun test packages/opencorvus/test/provider/tool-choice-pin-e2e.test.ts
```

## Acceptance Criteria

Implementation is complete only when all of these are true:

1. There is exactly one provider-bound tool schema normalization path for
   registry, MCP, extra tools, and StructuredOutput.
2. No late-injected provider-bound tool can bypass schema normalization.
3. `report_build_result` reaches the provider with a provider-normalized root
   object schema where required by provider transforms.
4. `submit_requirements` and `submit_integrity_review` reach the provider with
   required `final: true` schema.
5. Terminal-only scoping is not triggered by `requirements.length > 0`.
6. Integrity terminal-only scoping still occurs after all dimension verdicts.
7. Build terminal-only scoping occurs after successful merge, and failed
   result reporting remains possible before merge under `"required"`.
8. Missing terminal submit produces `TerminalToolMissingError`, not a parsed
   prose fallback.
9. Schema-invalid terminal payload does not satisfy the collector.
10. Targeted tests and typecheck pass.

## Risks

### Risk: Hidden double normalization

If registry/MCP still normalize inline and `prepareProviderTool` normalizes
again, schemas can be distorted or bloated.

Mitigation: delete inline normalization before adding the shared helper to
those paths. Add tests that compare final schema payloads.

### Risk: Requirements submits too late

Removing early terminal-only scoping means the model can still choose work
tools after the collector has enough data.

Mitigation: keep `toolChoice: "required"` and terminal recovery. This is a
protocol failure if the model stops in prose; it is not silently accepted.

### Risk: Build failed path still misses terminal submit

Because host cannot always know the model's failure intent before the model
submits, failed path cannot be safely hard-pinned from host state alone.

Mitigation: do not invent a host-side failure detector. Keep
`report_build_result` always available, normalize its schema, and surface
`TerminalToolMissingError` if the model stops in prose. The build core prompt
must also state that failure is terminal and must be reported through
`report_build_result(status="failed")`; this is checked by prompt hygiene
tests.

## Explicitly Rejected Alternatives

### Prompt wording as the only fix

Rejected. Prompt wording does not fix the provider-bound schema mismatch and
would become an agent-by-agent patch. Prompt wording is still required where
the protocol relies on model intent, such as build's failed terminal report
path.

### Special-case submit tool names

Rejected. `submit_*` and `report_*` are not the root concept. The root concept
is provider-bound tool schema normalization for all tool sources.

### Convert model prose to failed terminal results

Rejected. That is fallback parsing and hides the protocol violation.

### Provider-specific branch for DashScope/Kimi

Rejected. The project already has a generic provider transform layer. The bug
is that extra tools bypass it.

### Restore two build terminal tools

Rejected. That reintroduces dual terminal schema sources. The single
`report_build_result` tool is the correct protocol once schema acceptance is
fixed.

### Replace `ProviderToolSource` enum with a single registry

Rejected as scope for this spec. Today four call sites in `resolveTools`
invoke `prepareProviderTool({source: ...})` — registry, MCP, extra, and
StructuredOutput. A future refactor could fold them into one
`ProviderBoundToolRegistry.register(name, rawTool)` and run
`prepareProviderTool` once at the end of `resolveTools`, removing the enum.
Until then §Non-Goals forbids new source-specific schema branches and
§Acceptance Criteria #1#2 keep the four current sources covered. Re-opening
this requires a new spec; do not silently extend the enum.

### Move readiness predicate onto the collector

Rejected as scope for this spec. Today each agent supplies a `terminalTool`
record with `shouldExposeOnlyTerminalTool: (collector) => boolean`. A future
refactor could push that predicate onto the collector itself
(e.g. `collector.describeReadiness()`), so architect's readiness can never
drift from `submit_architect`'s precondition by construction. Until then the
architect-side invariant is enforced by the test in
`packages/opencorvus/test/architect/output-tools.test.ts`. Other agents'
predicates remain per-agent lambdas. Re-opening this requires a new spec.

### Merge `TerminalToolContract` and structured-output guard into one
`TurnExitContract`

Rejected as scope for this spec. Today the session loop carries two parallel
turn-exit mechanisms: `TerminalToolContract`
(`shouldEnterTerminalToolRecovery`, `terminalToolChoice`,
`terminalToolScopedTools`) and the structured-output guard
(`shouldEnterStructuredOutputRecovery`, `structuredOutputToolChoice`). They
share the same shape — "model must close the turn with a specific tool, else
prose-stop is a contract violation" — but each has its own recovery, choice,
and scoping helpers. A future refactor could collapse them into one
`TurnExitContract` abstraction. Until then, do not add a third turn-exit
mechanism without first folding the existing two.

## Implementation Checklist

- [x] Add failing tests for extra-tool schema normalization.
- [x] Extract one provider-bound tool preparation helper.
- [x] Route registry tools through the helper.
- [x] Route MCP tools through the helper.
- [x] Route extra tools through the helper.
- [x] Route StructuredOutput through the helper.
- [x] Keep `wrapExtraTool` focused on execute result shape and attachment
      stamping only.
- [x] Rename terminal readiness to `shouldExposeOnlyTerminalTool`.
- [x] Fix requirements predicate so it does not early-narrow after one
      requirement.
- [x] Guard architect predicate against `submit_architect` validator with an
      invariant test.
- [x] Add Architect traceability coverage to `submit_architect` validation so
      readiness cannot hide `register_traceability` before it is called.
- [x] Fold the rest of Architect's prompt-level finalize contract into
      `submit_architect` validation so readiness cannot hide any Architect
      work tool before it is no longer needed.
- [x] Keep integrity all-dimensions predicate.
- [x] Document build passed-vs-failed scoping behavior in code comments and
      build prompt.
- [x] Add terminal scoping observability log.
- [x] Add build prompt hygiene test for failed `report_build_result`.
- [x] Repair provider E2E probe context.
- [x] Run targeted tests.
- [x] Run typecheck.
- [x] Re-review implementation diff and existing log evidence after
      implementation; optional live provider probe now reaches the provider
      boundary but local `alibaba-cn/qwen3.5-plus` credentials returned 401.
