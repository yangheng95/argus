# Prompt Profile Extension Import Consensus

Date: 2026-06-18

## Request

The operator wants the expert-squad prompt system to become:

1. A stable code-owned base prompt for each agent.
2. A scenario-specific expert-squad append prompt layered on top.
3. A user-facing editor that shows and edits only the expert-squad extension
   prompts, not the whole base prompt.
4. A custom prompt import path that creates user-defined expert-squad profiles.
5. A refactor based on scanning every scenario agent prompt first, extracting
   shared semantics before changing runtime code.

This is a planning/consensus document. It records the impact investigation from
the main agent and two read-only explorer agents. Runtime and UI code changes
must read this document before implementation.

## Existing Design Recall

Authoritative prior plans:

- `specs/records/2026-06/2026-06-16-prompt-profile-expert-squad-switching.md`
- `specs/records/2026-06/2026-06-17-prompt-profile-schema-pressure-benchmark.md`
- `specs/records/2026-06/2026-06-09-prompt-catalog-append-display.md`
- `specs/records/2026-06/2026-06-07-prompt-contract-single-source.md`
- `deleted pre-June record 2026-05-23-integrity-adversarial-review-team`

The existing direction is already correct: Prompt Profiles are the single
source for expert-squad overlays. They must not change agent routing, workflow,
tools, models, retries, gates, acceptance logic, or executor selection.

## Prompt Semantics Scan

The scanned base prompts cover:

- `packages/opencorvus/src/agent/prompt/coding.txt`
- `packages/opencorvus/src/agent/prompt/general.txt`
- `packages/opencorvus/src/agent/prompt/explore.txt`
- `packages/opencorvus/src/prompt/core/mission-core.txt`
- `packages/opencorvus/src/prompt/core/intent-analysis-core.txt`
- `packages/opencorvus/src/prompt/core/requirements-core.txt`
- `packages/opencorvus/src/prompt/core/architect-core.txt`
- `packages/opencorvus/src/prompt/core/frontend-research-core.txt`
- `packages/opencorvus/src/prompt/core/frontend-design-core.txt`
- `packages/opencorvus/src/prompt/core/build-core.txt`
- `packages/opencorvus/src/prompt/core/visual-qa-core.txt`
- `packages/opencorvus/src/prompt/core/deep-research-core.txt`
- `packages/opencorvus/src/prompt/core/fact-check-core.txt`
- `packages/opencorvus/src/prompt/core/goal-workload-analyst-core.txt`
- `packages/opencorvus/src/prompt/core/integrity-team-core.txt`
- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`

Shared base prompt semantics:

- role identity and ownership boundary;
- tool and structured-output contract;
- evidence discipline and acceptance expectations;
- no fallback, no duplicate source, no workflow bypass;
- repository and workspace discipline;
- final reporting contract.

Role-specific base semantics:

| Agent surface                | Base responsibility                                                               |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `coding`, `coding-assistant` | Direct assistant prompt for interactive coding sessions.                          |
| `general`                    | General autonomous subagent for complex questions and multi-step work.            |
| `explore`                    | Read-only codebase and web investigation; returns findings, not file dumps.       |
| `mission`                    | Long-running goal coordinator; delegates concrete implementation to tasks.        |
| `intent-analysis`            | First read of request intent, complexity, missing slots, and clarification needs. |
| `requirements`               | Extracts REQ rows and foundational decisions.                                     |
| `architect`                  | Produces goal graph, contracts, dependencies, and verification structure.         |
| `frontend-research`          | Produces source-backed webpage investigation packets and frontend research brief. |
| `frontend-design`            | Produces visual HTML skeleton and frontend design/replica contract.               |
| `build`                      | Executes scoped delivery, edits files, verifies, and reports.                     |
| `visual-qa`                  | Audits rendered UI and interaction evidence.                                      |
| `deep-research`              | Gathers durable external/source evidence for unresolved facts.                    |
| `fact-check`                 | Verifies explicit factual claims from upstream worker reports.                    |
| `goal-workload-analyst`      | Reviews whether architect goals are too large or under-specified.                 |
| `integrity`                  | Performs adversarial final review and repair-oriented consensus reporting.        |
| `orchestrator`               | Makes task-level lifecycle and dispatch decisions.                                |

Expert-squad append prompts should therefore contain only scenario emphasis:

- frontend: surfaces, layout, responsive behavior, interaction states, visual
  evidence, accessibility, rendered UI defects;
- backend: API contracts, state ownership, persistence, integration behavior,
  failure semantics, observability;
- algorithm: invariants, edge cases, complexity, numeric behavior, benchmark
  scope, reproducibility.

They must not repeat base prompt role contracts or tool lists.

## Current Runtime State

Prompt profile runtime is already partially implemented.

| Surface                                                                     | Current role                                                                                                         |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/agent/prompt-profile.ts`                           | Single source for built-in profiles, custom profile schema, target metadata, overlay lookup, and prompt composition. |
| `packages/opencorvus/src/config/config.ts`                                  | Persists `config.prompt_profile`; session overlay only allows `prompt_profile.active`.                               |
| `packages/opencorvus/src/config/prompt-catalog.ts`                          | Returns `editable_prompt`, `profile_prompt`, and `effective_prompt`.                                                 |
| `packages/opencorvus/src/server/routes/config.ts`                           | Exposes `GET /config/prompt-profile` and validates `PATCH /config`.                                                  |
| `packages/opencorvus/src/server/routes/session.ts`                          | Validates session-scoped profile switches through `PATCH /session/:id/config`.                                       |
| `packages/opencorvus/src/agent/runner.ts`                                   | Worker agents compose base core + active profile overlay + user append.                                              |
| `packages/opencorvus/src/session/llm.ts`                                    | Direct session prompts apply profiles outside complete-system mode.                                                  |
| `packages/opencorvus/src/orchestrator/agent.ts`                             | Orchestrator manually applies the profile compiler before dynamic DB context.                                        |
| `packages/overlay/src/components/settings/PromptCatalog.tsx`                | Shows prompt-profile management plus the older per-prompt editor cards.                                              |
| `packages/overlay/src/services/config.ts`                                   | Saves custom profiles under `prompt_profile.profiles`; also still saves per-agent prompt fields.                     |
| `packages/overlay/src/ChatComposer.tsx` and `packages/overlay/src/main.tsx` | Expose the prompt-profile selector for task/session-scoped switching.                                                |

Important known mismatch:

- `coding-assistant` is a profile target and a registered agent, but it is not
  in `AgentRoleContract`. That makes it usable as a profile target while keeping
  it absent from ordinary prompt cards. Implementation must decide whether to
  add a role contract entry or keep it intentionally profile-only, then test the
  chosen contract.

## Root Problem

The existing profile compiler is close to the desired architecture, but the
operator-facing settings page still exposes two editing surfaces:

1. expert-squad overlay prompts under `config.prompt_profile.profiles`;
2. ordinary prompt edits under `config.prompt.*` and
   `config.agent.*.prompt(_append)`.

For this request, that second surface is a double source. It lets users edit the
base or append-mode prompt fields while the intended mental model is "base is
owned by OpenCorvus, scenario extension is user-editable."

The right fix is not a second prompt system. The fix is to keep Prompt Profiles
as the one expert-squad source and narrow the visible settings/editing surface
to profile overlays.

## Consensus Decision

Use this composition order everywhere:

1. code-owned base prompt;
2. active prompt-profile overlay for the agent;
3. legacy per-agent user append only while it remains supported by config, but
   do not expose it as the expert-squad editor;
4. runtime dynamic task/session context.

For the expert-squad settings UI:

- show built-in profiles as read-only profile overlay definitions;
- show custom profiles as editable overlay definitions;
- do not show base prompt text as an editable textarea in the expert-squad
  surface;
- if base/effective preview is still useful, expose it as read-only inspection
  only, not as a save target;
- do not write expert-squad edits into `config.agent.*.prompt_append`.

For custom prompt import:

- the only accepted import payload is the prompt-profile config shape;
- imported prompts write only to `config.prompt_profile.profiles`;
- built-in profile ids cannot be overwritten;
- unknown targets are hard errors;
- built-in-only targets (`orchestrator`, `integrity`) are hard errors in custom
  imports;
- there is no fallback import mode, bare prompt guessing, target aliasing, or
  compatibility conversion from older prompt fields.

Recommended import payload:

```json
{
  "prompt_profile": {
    "active": "custom-squad",
    "profiles": {
      "custom-squad": {
        "label": "Custom Squad",
        "description": "Project-defined expert-squad overlays.",
        "agents": {
          "build": "Custom build-scene guidance.",
          "requirements": "Custom requirements-scene guidance."
        }
      }
    }
  }
}
```

Import should be a merge into `prompt_profile.profiles`, not a whole-config
replacement. If an imported custom id already exists, the UI should require an
explicit new id before saving; it must not silently overwrite.

## Required Implementation Batches

### Batch 1 - Contract Hardening

- Update `PromptProfile` schema to centralize import parsing and validation.
- Add an explicit `PromptProfileImportSchema` that accepts only
  `{ prompt_profile: { active?, profiles } }` or decide to accept only the
  inner `{ active?, profiles }` shape. Do not accept both unless both are
  documented in one schema and tested as first-class formats.
- Add helper(s) that merge imported profiles into existing config without
  touching `agent.*` or `prompt.*`.
- Resolve the `coding-assistant` role-contract mismatch with one tested rule.

### Batch 2 - Runtime Coverage

- Keep current compiler use in `runner.ts`, `session/llm.ts`, and
  `orchestrator/agent.ts`.
- Investigate and fix the external build executor path:
  `packages/opencorvus/src/build/agent.ts::composeExternalCodingSystem`.
  Explorer found that external `codex` / `claude-code` build system prompts may
  bypass `PromptProfile.composeAgentPrompt()`. Either route that system prompt
  through the compiler with `agentID: "build"` or explicitly prove external
  executors are outside the expert-squad contract. The preferred decision is to
  compile them as build prompts, because they perform the same build role.

### Batch 3 - Settings UI Narrowing

- Refactor `PromptCatalog.tsx` so the Prompts settings surface presents profile
  overlays as the editable area.
- Move ordinary prompt cards behind a read-only diagnostic section or remove
  them from the standard settings flow. They must not be the default editor for
  this feature.
- Add an import action in the profile panel. Use existing UI primitives and the
  browser file input/FileReader pattern already present in overlay services.
- Import preview must show the target ids and labels before save.
- Save must call the profile config helper and produce a `PATCH /config` body
  containing only `prompt_profile`.

### Batch 4 - Tests And Docs

- Replace stale assertions that still expect wrapper prose such as
  `Active prompt profile: frontend expert squad.`
- Add tests for strict import validation and no write into legacy prompt fields.
- Update API docs/OpenAPI/SDK only if the server route contract changes. If the
  import helper stays overlay-only and uses existing `PATCH /config`, no new
  route is needed.

## Call-Site Inventory

| Call site                                                      | Action                                                                                                                           |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/agent/prompt-profile.ts`              | Add import schema/helper, keep built-ins and target catalog as single source.                                                    |
| `packages/opencorvus/src/config/config.ts`                     | Keep hard validation for active id, unknown targets, and built-in-only custom targets.                                           |
| `packages/opencorvus/src/config/prompt-catalog.ts`             | Keep `profile_prompt` separate from `editable_prompt`; consider returning ordinary prompt entries as read-only diagnostics only. |
| `packages/opencorvus/src/agent/runner.ts`                      | Preserve base + profile + user append order for worker agents.                                                                   |
| `packages/opencorvus/src/session/llm.ts`                       | Preserve no-profile behavior in complete-system mode.                                                                            |
| `packages/opencorvus/src/orchestrator/agent.ts`                | Preserve orchestrator profile compilation before dynamic DB context.                                                             |
| `packages/opencorvus/src/build/agent.ts`                       | Compile external coding system prompts through the build profile overlay.                                                        |
| `packages/opencorvus/src/server/routes/config.ts`              | Reuse `PATCH /config`; add route only if backend-owned import validation is required by implementation.                          |
| `packages/opencorvus/src/server/routes/session.ts`             | Keep session overlay limited to active profile id.                                                                               |
| `packages/overlay/src/components/settings/PromptCatalog.tsx`   | Make profile overlays the only editable prompt surface; add import UI.                                                           |
| `packages/overlay/src/services/config.ts`                      | Add import/merge helper that writes only `prompt_profile`. Remove fail-open prompt catalog handling if touched.                  |
| `packages/overlay/src/i18n/en-US.json` and `zh-CN.json`        | Add import labels/errors if UI changes.                                                                                          |
| `packages/opencorvus/test/agent/prompt-profile.test.ts`        | Add import schema, matrix, compiler ordering, and built-in-only rejection tests.                                                 |
| `packages/opencorvus/test/build-agent/external-system.test.ts` | Add profile overlay coverage for external executors.                                                                             |
| `packages/opencorvus/test/server/config-routes.test.ts`        | Keep `/config/prompt-profile` and `PATCH /config` hard-error coverage.                                                           |
| `packages/overlay/test/prompt-profile-config.test.ts`          | Add import merge and legacy-field non-mutation coverage.                                                                         |
| `packages/overlay/test/browser/prompt-profile-panel.test.ts`   | Add visual/interaction coverage for import and profile-only editing.                                                             |
| `packages/overlay/test/prompt-catalog-save.test.ts`            | Reject profile overlay leakage into `agent.*.prompt_append`.                                                                     |

## Non-Goals

- Do not create a new expert-squad workflow.
- Do not create new agent ids for frontend/backend/algorithm.
- Do not auto-select a profile by keyword matching.
- Do not mutate many `config.agent.*.prompt_append` fields to simulate a
  profile.
- Do not let imported custom profiles configure `orchestrator` or `integrity`.
- Do not merge `.opencorvus/agents/*.md` custom agents into this feature; that
  is a separate full-agent mechanism.
- Do not add fallback parsing for old prompt formats.

## Acceptance

- Built-in and custom expert-squad overlays are visible through one profile
  catalog.
- The standard settings editor can edit custom expert-squad overlay prompts,
  not code-owned base prompts.
- Imported custom prompts write only to `config.prompt_profile.profiles`.
- Unknown profile ids, built-in id overrides, unknown targets, and built-in-only
  targets fail before write.
- Worker, direct session, orchestrator, and external build executor prompts all
  receive the active profile overlay where applicable.
- `general` profile preserves base prompt behavior.
- Tests prove the active profile changes prompt text without changing tools,
  models, workflow, or routing.
- No stale wrapper prose is required by tests or runtime prompts.

## Open Questions Before Implementation

1. Should `/config/prompt` remain as a read-only diagnostics endpoint, or should
   the settings UI stop loading it in normal Prompt Profiles mode?
2. Should custom prompt import be overlay-only in the frontend, or should the
   backend expose a dedicated validated import endpoint? Reusing `PATCH /config`
   is simpler and keeps a single write path, but a backend endpoint can return
   more precise import diagnostics.
3. Should `coding-assistant` be added to `AgentRoleContract` as a prompt
   profile target with non-card editability, or should it remain deliberately
   profile-only?

The implementation should answer these in code and tests rather than by adding
new parallel prompt surfaces.
