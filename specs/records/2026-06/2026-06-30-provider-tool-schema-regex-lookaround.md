# 2026-06-30 Provider Tool Schema Regex Lookaround

Status: implemented and validated

## Goal

Fix the Hexin/OpenAI-compatible request failure where the Orchestrator
`select_expert_squad` tool exports a `profile_id` JSON Schema pattern containing
regex lookaround. The provider rejects that schema before the model runs.

## Recall

### User Request

The user reported:

`Provider hexin returned HTTP 400: litellm.BadRequestError: OpenAIException - Invalid JSON schema: regex lookaround is not supported. Found at $.properties.profile_id.pattern.`

The user then asked to fix the problem.

### Acceptance Criteria

- `select_expert_squad.profile_id` must no longer emit a JSON Schema pattern
  containing lookaround syntax.
- Prompt profile IDs must still be validated with the same accepted language:
  lowercase letters and digits separated by single hyphens, starting with a
  lowercase letter, with no empty hyphen segment.
- Unknown prompt profiles must still fail at `PromptProfile.assertKnownProfileID`
  before writing session overlay state.
- The fix must not introduce fallback, compatibility aliases, host-side gates,
  hidden profile selection, or a second expert-squad source.
- Tests must cover both the exported provider-bound schema and local validation.

### Hard Constraints

- No fallback logic and no model-group fallback workaround.
- No double source for prompt profile ID syntax.
- No broad provider schema sanitizer that silently strips validation from all
  tools.
- No git reset or revert of unrelated dirty worktree files.
- No new git worktree.

### Sources Read Before Edits

| Source | Relevant constraint |
| --- | --- |
| `AGENTS.md` | No fallback, no double source, Recall before implementation, tests required, no git reset, do not create worktrees without authorization. |
| `specs/current/architecture/06-provider.md` | Provider tool requests pass through `ProviderTransform` / `ProviderSchema` before the SDK sends them to provider APIs. |
| `specs/current/architecture/17-agent-team-infrastructure.html` | `select_expert_squad` is the single visible expert-squad selection tool and writes only `prompt_profile.active`. |
| `specs/records/2026-06/2026-06-24-orchestrator-expert-squad-skill.md` | Expert-squad selection is Orchestrator-owned visible skill loading plus `select_expert_squad`, not keyword routing or fallback profile selection. |
| `specs/records/2026-06/2026-06-29-frontend-innovate-expert-squad.md` | Runtime tests should execute visible skill plus `select_expert_squad`; no hidden profile selection, synthetic messages, or fake evidence. |
| `packages/opencorvus/src/agent/prompt-profile.ts` | `PROMPT_PROFILE_ID_PATTERN` currently contains `^(?!.*--)`, which becomes the rejected JSON Schema pattern. |
| `packages/opencorvus/src/orchestrator/tools.ts` | `select_expert_squad.profile_id` reuses `PromptProfileIDSchema`, so the regex reaches the model tool schema. |
| `packages/opencorvus/src/provider/schema.ts` | Provider-bound tool schemas use `asSchema(...).jsonSchema` and `ProviderTransform.schema(...)`. |
| `packages/opencorvus/src/session/loop.ts` | Runtime tools are prepared through `providerBoundInputSchema`, so provider-bound schema shape is testable without invoking a model. |

### Whole-Repository Search Evidence

Commands run before this record:

```bash
rg -n "profile_id|profileId|profile-id|pattern.*profile|lookaround|thinking|litellm|model_group|fallback" .
rg -n "profile_id" packages/opencorvus/src packages/opencorvus/test specs/current/architecture specs/records/2026-06 -g "*.ts" -g "*.tsx" -g "*.md" -g "*.html"
rg -n "select_expert_squad|expert_squad|PromptProfile|prompt_profile|prompt profile" packages/opencorvus/src packages/opencorvus/test -g "*.ts" -g "*.tsx"
rg -n "PROMPT_PROFILE_ID_PATTERN|PromptProfileIDSchema" packages/opencorvus/src/agent/prompt-profile.ts
rg -n "ProviderTransform\\.schema|schema\\(model|zodToJsonSchema|jsonSchema|toJsonSchema|inputSchema" packages/opencorvus/src/session packages/opencorvus/src/agent packages/opencorvus/src/orchestrator packages/opencorvus/src/provider -g "*.ts"
```

Findings:

- The only prompt profile ID regex source is
  `PROMPT_PROFILE_ID_PATTERN` in `prompt-profile.ts`.
- `select_expert_squad.profile_id` is the failing tool field and reuses that
  schema directly.
- The provider-bound tool schema path already exists:
  `SessionLoop.providerBoundInputSchema` -> `ProviderSchema.input` ->
  `ProviderTransform.schema`.
- `ProviderTransform.schema` normalizes some provider-specific schema quirks,
  but this fix should not become a broad sanitizer because the profile ID
  language can be expressed without lookaround.

### Independent Agent Feedback

No new sub-agent was spawned for this repair because the currently available
sub-agent tool explicitly prohibits spawning unless the user asks for
sub-agents or delegation. The relevant previously landed independent feedback
from `2026-06-29-frontend-innovate-expert-squad.md` still applies: keep expert
squads as `PromptProfile` plus mounted Orchestrator skill plus
`select_expert_squad`; do not add new routing, hidden selection, or fallback
paths.

## Design

Replace the prompt profile ID regex with an equivalent JSON-Schema-compatible
regular expression:

```ts
/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
```

This still rejects double hyphens because every hyphen must be followed by at
least one lowercase letter or digit. It also rejects leading/trailing hyphens,
uppercase letters, underscores, empty strings, and IDs that do not start with a
letter.

Do not add provider-specific stripping of unsupported regex features. The root
cause is a local schema expression that has a direct equivalent without
lookaround.

## Validation Plan

- Add or extend prompt-profile tests for accepted/rejected profile ID syntax.
- Add provider-bound schema test proving the exported `profile_id.pattern` has
  no lookaround and still carries the profile ID regex.
- Run:

```bash
bun test packages/opencorvus/test/agent/prompt-profile.test.ts packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
git diff --check
```

## Implementation Summary

- Replaced `PROMPT_PROFILE_ID_PATTERN` with a JSON-Schema-compatible equivalent
  that rejects empty hyphen segments without lookaround.
- Extended prompt-profile tests to assert valid IDs still pass and malformed
  IDs including `custom--squad` still fail.
- Added a provider-bound Orchestrator tool schema regression test for
  `select_expert_squad.profile_id`, proving the exported pattern is
  `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$` and contains no lookaround.
- Did not add provider-level pattern stripping, model fallback, compatibility
  aliases, or a second expert-squad selection source.

## Validation Results

Commands passed:

```bash
bun test packages/opencorvus/test/agent/prompt-profile.test.ts packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
bun test packages/opencorvus/test/script/product-docs-single-source.test.ts
bun run --cwd packages/opencorvus typecheck
git diff --check
```

Second review result: source and tests contain no regex lookaround for the
prompt profile ID path. The only remaining `^(?!.*--)` text is this record's
historical error-source note.
