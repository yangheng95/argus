# Prompt Profile Expert-Squad Switching

Date: 2026-06-16

## Request

Make all agent prompt definitions batch-switchable by use case, for example a
frontend task activates a frontend expert squad prompt set, backend and
algorithm work activate different prompt sets, and research/investigation can
be extended later. Overlay UI must be able to set it. The change must switch
prompt context only; it must not change the agent algorithm, workflow, tool
framework, or orchestration flow.

## Current State

Prompt ownership is already split into several real runtime surfaces:

| Surface | Current behavior | Evidence |
| --- | --- | --- |
| Native agent registry | `Agent.buildState()` imports core prompt files and assigns `Agent.Info.prompt` per native agent. Append-mode agents store user additions in `promptAppend`, not by replacing the code-owned core. | `packages/opencorvus/src/agent/agent.ts` |
| Agent role contract | Prompt editability and config mode are per agent: override, append, or none. Workflow agents such as `build`, `requirements`, `architect`, `frontend-design`, `visual-qa`, `mission`, `deep-research`, and `frontend-research` are append-mode. `orchestrator` and `integrity` are not prompt-editable through the catalog. | `packages/opencorvus/src/agent/role-contract.ts` |
| Prompt catalog API | `GET /config/prompt` returns effective system and agent prompts and the current configured override/append text. It is an editor for individual slots, not a profile switcher. | `packages/opencorvus/src/config/prompt-catalog.ts`, `packages/opencorvus/src/server/routes/config.ts` |
| Overlay Prompt UI | The settings prompt panel renders one card per prompt entry and saves to `config.prompt.*` or `config.agent.<id>.prompt(_append)`. | `packages/overlay/src/components/settings/PromptCatalog.tsx`, `packages/overlay/src/services/config.ts` |
| Worker agent runner | Most workflow child agents run through `runAgentSession()`, which composes `core + config.agent.<kind>.prompt_append + live task context`. | `packages/opencorvus/src/agent/runner.ts` |
| Direct session prompt path | Direct `SessionPrompt` calls use `LLM.composeSystem()` with `Agent.resolveSessionAgent()` and the active session overlay. | `packages/opencorvus/src/session/llm.ts`, `packages/opencorvus/src/session/prompt/parts.ts` |
| Orchestrator | Orchestrator does not use `runAgentSession()`. It builds `[ORCHESTRATOR_CORE, dynamic task context]` per wake in `buildSystemParts()`. | `packages/opencorvus/src/orchestrator/agent.ts` |
| Effective config | Runtime config is live project config plus root-session `metadata.configOverlay`. `taskConfigSnapshot` is metadata and permission seed, not runtime prompt/model source. | `packages/opencorvus/src/config/effective.ts`, `packages/opencorvus/src/agent/model.ts`, `specs/new-arch/2026-06-10-task-config-overrides-immediate-effect.md` |
| Session overlay | Session overlay can already override model, system prompts, and per-agent prompt/prompt_append. Child sessions inherit root overlay. | `packages/opencorvus/src/config/config.ts`, `packages/opencorvus/src/agent/model.ts` |

Existing prompt design docs already reject scenario-specific prompt duplication
inside core prompts. `2026-06-01-general-build-agent-prompt-decontamination.md`
requires stable role kernels plus conditional scenario overlays for build. This
proposal generalizes that principle to all agents.

## Root Problem

The user-facing need is not "edit N prompt cards faster". The real need is a
single, durable, inspectable context profile that changes the expert emphasis
of the whole agent team while preserving the same workflow and tool contracts.

Writing a frontend profile by mutating every `config.agent.<id>.prompt_append`
from the UI would create multiple sources:

- the active profile would be implicit in many per-agent fields;
- resetting one agent prompt could silently break the selected squad;
- append-mode code-owned prompts could be accidentally replaced;
- orchestrator would remain outside the batch switch because it is not in the
  editable prompt catalog;
- session-level and project-level switches would diverge.

The fix must introduce one prompt-profile source and one prompt compiler.

## Decision

Add **Prompt Profiles** as a first-class config concept:

```ts
prompt_profile: {
  active: "general" | "frontend" | "backend" | "algorithm" | string
  profiles?: Record<string, PromptProfileDefinition>
}
```

A prompt profile is a named set of per-agent prompt overlays. It never creates,
removes, disables, renames, or reroutes agents. It never changes tools, model
selection, workflow, goal logic, retry logic, or orchestrator tool schemas.

The active profile is resolved by the backend once, then applied through a
single prompt compiler. Invalid profile ids are hard errors. There is no
fallback profile selection and no keyword classifier.

When `prompt_profile` is absent, config materialization should set
`prompt_profile.active = "general"` as the explicit default value. Runtime code
must then read the materialized active id; it must not contain a separate
"if missing, use general" fallback branch.

## Prompt Profile Shape

```ts
interface PromptProfileDefinition {
  label: string
  description?: string
  agents: Partial<Record<PromptProfileTargetID, string>>
}
```

Rules:

- `agents[agentID]` is an overlay appended to that agent's resolved prompt.
- Empty string means no overlay for that agent.
- User-defined profile ids must be unique after merging with built-ins.
- `PromptProfileTargetID` is not all `AgentRoleID`. It is a new explicit
  allowlist owned by `src/agent/prompt-profile.ts`.
  - Allowed user-profile targets: prompt-editable runtime agents whose profile
    overlay is safe as user-visible prompt customization, for example `coding`,
    `coding-assistant`, `build`, `visual-qa`, `general`, `explore`, `mission`,
    `requirements`, `architect`, `frontend-design`, `intent-analysis`,
    `fact-check`, `deep-research`, `frontend-research`, and
    `goal-workload-analyst`.
  - Built-in-only targets: `orchestrator` and `integrity`. They may receive
    built-in profile overlays because they are runtime prompts, but project
    config must reject user-defined profile text for them. This preserves the
    existing `promptConfigMode: "none"` protection.
  - Excluded helper targets: `summary`, `compaction`, `title`,
    `agent_generate`, and system `core_header` are not profile targets unless a
    later spec proves a runtime need. They remain owned by their existing
    prompt/config surfaces.
- Built-ins live in one registry module, for example
  `src/agent/prompt-profile.ts`; prompt text must not be scattered across UI,
  tests, route handlers, and agent modules.
- The initial built-in ids should be:
  - `general`: empty overlays that preserve current behavior exactly.
  - `frontend`: requirements/architect/frontend-design/frontend-research/build/visual-qa/integrity/orchestrator overlays emphasizing GUI, source evidence, layout parity, interaction truth, and visual verification.
  - `backend`: requirements/architect/build/integrity/deep-research/fact-check overlays emphasizing API contracts, data flow, persistence, concurrency, observability, migrations policy, and integration tests.
  - `algorithm`: requirements/architect/build/integrity/deep-research/fact-check overlays emphasizing problem formulation, correctness proof, complexity, numerical precision, benchmark design, adversarial cases, and reproducibility.

Research-only profiles can be added later by adding registry entries and tests;
the schema and compiler do not need a new workflow branch.

## Composition Order

Prompt composition becomes explicit and testable:

1. Existing agent base prompt:
   - append-mode agents: code-owned core;
   - override-mode agents: configured prompt if present, otherwise native default;
   - prompt-mode none agents: code-owned runtime prompt only.
2. Active prompt-profile overlay for that agent.
   - For prompt-mode none agents, this step is allowed only for built-in-only
     targets that the registry owns (`orchestrator`, `integrity`). User-defined
     profiles cannot inject text into prompt-mode none agents.
3. Existing user-config append/override semantics:
   - append-mode: user `prompt_append` remains after profile overlay;
   - override-mode: configured prompt is still the base, profile overlay is appended after it.
4. Existing runtime context:
   - worker agents keep `TaskContext.snapshot()`;
   - orchestrator keeps its dynamic DB-derived `buildSystemParts()` context;
   - session prompt path keeps user/system message semantics.

This preserves current customization while making the active expert squad a
visible, single setting.

## Implementation Plan

1. Add `PromptProfile` schema and registry.
   - Extend `Config.Info` with `prompt_profile`.
   - Extend `Config.Overlay` with `prompt_profile.active` so the overlay UI can switch the current task/session without editing project config.
   - Validate active id against the registry plus project-defined profiles.
   - Reject profile definitions that mention unknown `AgentRoleID`.

2. Add a single prompt compiler.
   - Suggested module: `packages/opencorvus/src/agent/prompt-profile.ts`.
   - API:
     - `PromptProfileCatalog.list(config): PromptProfileCatalogResponse`
     - `PromptProfileCompiler.overlayFor(agentID, scope): string | undefined`
     - `PromptProfileCompiler.composeAgentPrompt({ agentID, base, userAppend, scope })`
   - Worker `runAgentSession.composeSystemPrompt()` must call the compiler.
   - `LLM.composeSystem()` must call the same compiler only for non-complete
     direct session agent prompts. When `runtimeSystemMode === "complete"` or
     user `systemMode === "complete"`, `LLM.composeSystem()` must not add an
     agent prompt or a profile overlay, matching the current complete-system
     contract.
   - `orchestrator/agent.ts::buildSystemParts()` or its caller must append the
     orchestrator profile overlay through the same compiler while preserving
     the existing `[static, dynamic]` cache split.
   - Worker and orchestrator prompts compile before they are sent through
     complete-system mode. They must not be compiled again inside
     `LLM.composeSystem()`.

3. Update prompt catalog display.
   - `GET /config/prompt` must keep editable text separate from preview text.
     Do not put profile-applied text into the field that the textarea saves.
   - Response fields should include:
     - `editable_prompt`: the exact value the editor may save. For append-mode
       entries this is base prompt plus user append only, with no active profile
       overlay. For override-mode entries this is the configured replacement or
       default prompt, with no active profile overlay.
     - `active_profile`
     - `profile_prompt`
     - `effective_prompt`: read-only preview of base/configured prompt +
       profile overlay + user append + any existing catalog-level effective
       composition.
   - Existing individual prompt editing remains, but the UI must show which
     part comes from the active profile and which part is the user append.
   - `PromptCatalog.tsx::draftValue()` must use `editable_prompt`, not
     `effective_prompt`. `savePromptEntry()` and `promptConfigValueForSave()`
     must never persist `profile_prompt` into `config.agent.<id>.prompt_append`
     or `config.agent.<id>.prompt`.

4. Add profile API.
   - `GET /config/prompt-profile`: list built-in and configured profiles,
     active project profile, and active session profile when a session id is supplied.
   - Project-level change uses existing `PATCH /config`.
   - Current-task/session change uses existing `PATCH /session/{sessionID}/config`.
   - OpenAPI and SDK generated files must be updated after route/schema changes.

5. Add Overlay UI.
   - Add a Prompt Profiles area to the existing Prompts settings tab or a
     sibling settings tab; use the same `CONFIG_SECTIONS` single source if a
     new tab is needed.
   - Use mature primitives already present in the UI, e.g. the same select/list
     pattern used by agent model settings.
   - Provide two explicit scopes:
     - Project active profile: writes `PATCH /config`.
     - Selected task/session active profile: writes `PATCH /session/{rootSessionID}/config`.
   - Do not have the UI loop over all agents and write prompt_append fields.

6. Add tests.
   - Config schema:
     - valid built-in active profile parses;
     - unknown active profile rejects;
     - unknown agent id inside profile rejects;
     - user-defined profiles targeting built-in-only targets
       (`orchestrator`, `integrity`) reject;
     - session overlay accepts only `prompt_profile.active` for profile switching, not inline profile definitions or tool/permission changes.
   - Prompt compiler:
     - `frontend` profile changes worker agent system prompt without changing tool list or model;
     - `backend` and `algorithm` profiles produce different overlays for the same agent;
     - `general` profile preserves current prompt text except for explicit profile marker if used;
     - user `prompt_append` remains after profile overlay.
     - `systemMode="complete"` does not receive profile overlays from
       `LLM.composeSystem()`; worker/orchestrator complete prompts contain only
       the overlay already compiled before the complete-system call.
   - Orchestrator:
     - active profile overlay reaches orchestrator system prompt;
     - dynamic `buildSystemParts()` remains DB-derived and unchanged.
   - API:
     - `GET /config/prompt-profile` returns catalog and active id;
     - `PATCH /config` changes active profile and `GET /config/prompt` reflects it;
     - `PATCH /session/{sessionID}/config` changes only that root session overlay.
   - Overlay:
     - profile selector writes one profile field, not per-agent prompt fields;
     - PromptCatalog displays profile-applied effective prompt and configured append separately;
     - saving an append-mode agent while a profile is active writes only the
       human user append, never the profile overlay.

## Call-Site Inventory

| Call site | Required action |
| --- | --- |
| `packages/opencorvus/src/config/config.ts` | Add schema for `prompt_profile`, overlay subset, semantic validation, and merge handling. |
| `packages/opencorvus/src/agent/agent.ts` | Keep native defaults and role contracts; do not bake scenario profile text into `Agent.Info.prompt`. |
| `packages/opencorvus/src/agent/role-contract.ts` | Add no new role ids for frontend/backend/algorithm. Profiles are not agents. |
| `packages/opencorvus/src/agent/prompt-profile.ts` | New single source for built-in profiles, profile target allowlists, validation helpers, and compiler output. |
| `packages/opencorvus/src/agent/runner.ts` | Replace direct `core + userAppend` composition with the profile compiler. |
| `packages/opencorvus/src/session/llm.ts` | Apply the same profile compiler only to non-complete direct SessionPrompt composition. Preserve complete-system semantics. |
| `packages/opencorvus/src/orchestrator/agent.ts` | Apply the profile overlay explicitly because orchestrator bypasses `runAgentSession()`. Preserve static/dynamic split. |
| `packages/opencorvus/src/config/prompt-catalog.ts` | Report active profile and profile contribution, not only default/configured prompt. |
| `packages/opencorvus/src/server/routes/config.ts` | Add profile catalog route or extend config routes with `GET /config/prompt-profile`. |
| `packages/opencorvus/src/server/routes/session.ts` | Existing session config route should validate profile overlay through `Config.Overlay`. |
| `packages/overlay/src/components/settings/PromptCatalog.tsx` | Add profile selector/preview or delegate to a new Profile panel; keep individual prompt editor explicit. |
| `packages/overlay/src/services/config.ts` | Add load/save helpers for project profile and selected session profile. |
| `packages/overlay/src/store/dialog.ts`, `ConfigDialogHost.tsx`, i18n | Only needed if implemented as a new settings tab. |
| `packages/sdk/openapi.json`, `packages/sdk/js/src/gen/*` | Regenerate after API/schema changes. |
| Docs | Update `docs/product/*/reference/api.md` and configuration docs. |

## Explicit Non-Profile Prompt Surfaces

The following prompts remain outside prompt profiles in this design:

| Surface | Reason |
| --- | --- |
| `core_header` / `SystemPrompt.provider()` | System-wide provider header is already a global config slot. Mixing scene profiles into it would apply text to non-agent helper calls and create a second global prompt source. |
| `agent_generate` | Agent generator prompt creates config snippets; it is not a runtime expert-squad participant. |
| `summary` follow-up prompt | The caller builds its own summary prompt inline for a specific follow-up output; profile text would change summarization semantics rather than task expertise. |
| `compaction` prompt builders | Compaction preserves transcript fidelity and must not inherit scene-specific implementation guidance. |
| `title` | Title generation should remain concise metadata generation, not task-domain reasoning. |

## Non-Goals

- Do not add a frontend/backend/algorithm workflow.
- Do not create new frontend-build or backend-build agents.
- Do not select profiles by keyword matching the user request.
- Do not mutate every agent's prompt config from the UI to simulate a profile.
- Do not change tool surfaces, permissions, model resolution, retries, gates,
  benchmark loops, or orchestrator routing.
- Do not use a fallback profile when the configured active id is missing.

## Acceptance

- A project-level profile switch changes the effective prompts for all mapped
  agents through one config field.
- A selected task/session profile switch changes only that root session through
  `metadata.configOverlay`.
- Existing workflow execution, tool lists, model resolution, and orchestrator
  dispatch surfaces are unchanged.
- `frontend`, `backend`, and `algorithm` profile overlays are visible in the
  backend prompt catalog and Overlay UI.
- Tests prove profile presence, absence, invalid-profile hard errors, and no
  per-agent prompt mutation from the profile selector.

## Codex Review Notes

- The safest implementation path is a compiler layer, not replacing existing
  prompt fields. Existing append-mode protection is intentional and should stay.
- Orchestrator must be handled deliberately because it is not a worker agent.
- The active profile should be explicit. Auto-detect can be considered later
  only if it is an LLM-visible decision artifact, not a host-side keyword gate.
- Independent review feedback on 2026-06-16 required three hardenings before
  implementation: keep PromptCatalog editable text separate from profile
  preview text; introduce an explicit profile target allowlist so prompt-mode
  none agents cannot become user-editable through profiles; preserve
  `systemMode="complete"` semantics by compiling profile overlays before
  complete-system calls and never inside `LLM.composeSystem()` complete mode.
