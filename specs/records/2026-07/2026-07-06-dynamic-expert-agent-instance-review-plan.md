# Dynamic Expert Agent Instance Review Plan

Date: 2026-07-06
Status: Draft for independent agent review
Owner: Codex

## Glossary

- Agent ID: Agent Identifier, the runtime name used to address an agent or an agent-like worker.
- API: Application Programming Interface, the route or TypeScript contract exposed between modules or processes.
- DB: Database, the persistent storage layer. This plan does not introduce a DB migration.
- E2E: End-to-End, a test that exercises the observable runtime chain instead of only a local function.
- LLM: Large Language Model, the model responsible for reasoning and scheduling.
- MCP: Model Context Protocol, the package-scoped tool server surface exposed by expert squads.
- UI: User Interface, including overlay panels and visible agent/session cards.
- Virtual agent instance: A project package owned expert agent identity that runs on top of an existing OpenCorvus base role.
- Base role: A stable `AgentRoleID` from `AgentRoleContract` that provides runtime protocol, tool ownership, session kind, and workflow binding.

## Recall

### User Request

The user reported that current OpenCorvus expert-squad agent management is unreasonable because it cannot dynamically generate new expert agents. The desired direction is to preset a template/base agent and then let the active expert squad materialize that agent dynamically, instead of only selecting from existing global agents. The latest instruction is to create a plan for independent agent review.

### Acceptance Criteria

- The plan must preserve `prompt_profile.active` as the only active expert-squad selection source.
- The plan must model package-owned dynamic expert agents without adding package-defined global `AgentRoleID` values.
- The plan must keep `PromptProfileResolver` as the only runtime projection surface for catalog, scheduler capability, worker capability, visible selector skills, skills, package tools, scoped MCP providers, and skill mounts.
- The plan must not generate or mutate `config.agent` from an expert-squad package.
- The plan must not create fallback behavior, alias loading, name guessing, inactive package scanning, UI-only filtering, or a second active expert-squad field.
- The plan must not add a second workflow, dispatch engine, context packet, task manipulation tool, or scheduling state machine.
- The plan must include independent-agent review prompts that challenge problem depth, impact surface, and validation coverage before implementation.

### Hard Constraints

- Expert squads are OpenCorvus internal scenario/capability packages, not global core prompt aliases, ordinary Codex skills, plugins, UI filters, or old `PromptProfile.builtIns` aliases.
- Non-`general` expert squads must exist as `.opencorvus/expert-squads/<id>/` project packages and flow through normal discovery, catalog, resolver, and projection paths.
- `expert-squad.jsonc` manifest `id` is the only expert-squad identity.
- `prompt_profile.active` is the only active expert-squad selection source.
- Domain-specific expert-squad rules belong in package README files, selector skills, agent overlays, package skills/tools, or package MCP servers, not in global core prompts.
- Runtime implementation must use natural visible messages and real participants. It must not create synthetic, hidden, or model-only message branches.
- Specs and records must live under `specs/`. This record is under `specs/records/2026-07/`.
- This record is a plan and review packet only. It does not implement runtime code.

### Documents Read

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md`
- `specs/records/2026-07/2026-07-03-expert-squad-capability-profile.md`
- `specs/records/2026-07/2026-07-06-software-testing-expert-squad-integration.md`

### Repository Search Evidence

- `AgentRoleID`, `AgentRoleContract`, `isRoleID`, `taskWorkerIDs`, `agentOwnedTaskWorkerIDs`, `promptProfileTarget`, and `skillMountable` were searched in `packages/opencorvus/src/agent/role-contract.ts` and related tests. Finding: OpenCorvus has a static role contract that maps roles to runtime/session/tool capabilities.
- `AgentDefinition`, `CapabilityProjection`, `assertRoleID`, `capability_projection.agents`, `unknown agent role`, `collectDeclaredRefs`, and package loading functions were searched in `packages/opencorvus/src/expert-squad/registry.ts` and registry tests. Finding: package `agents` and projected agent capabilities currently reject unknown roles.
- `resolveSchedulerCapability`, `resolveWorkerCapability`, `resolveSkillProjection`, `composeAgentPrompt`, and `overlayFor` were searched in `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts` and resolver tests. Finding: `PromptProfileResolver` already acts as the single runtime projection point, but it projects known base roles only.
- `roleIDForAgentRun`, `resolveWorkerCapability`, `composeAgentPrompt`, `sessionKind`, and `AgentRoleContract` were searched in `packages/opencorvus/src/agent/runner.ts`. Finding: agent sessions are typed by static role and throw when the session kind is not in `AgentRoleContract`.
- `OrchestratorWorkflowToolName`, `agentRole?: AgentRoleID`, `WorkflowRegistry`, and `agentRole` were searched in `packages/opencorvus/src/engine/workflow.ts`. Finding: workflow tools bind to static roles; dynamic expert agents cannot currently be direct workflow targets without changing the workflow contract.
- Overlay and skill-mount surfaces were inspected in prior investigation. Finding: expert-squad UI currently selects and displays active packages, README, selector, capability projection, and agent overlays, but it does not expose package-owned runtime agent instances.

### Independent Investigation Feedback Already Collected

Four read-only investigation agents reviewed the current implementation on 2026-07-06:

- Runtime/session review: dynamic agents cannot be solved by accepting arbitrary role names because runner, session kind, terminal protocol, and tool ownership are all role-contract based.
- Registry/resolver review: current package manifests can overlay known roles, but custom package agent folders are rejected because registry validates against `AgentRoleID`.
- Workflow review: current workflow registry dispatches by fixed workflow tool and base role. Adding package-specific workflow targets would be a larger scheduler redesign.
- UI/API review: the overlay panel and catalog surfaces currently describe package selection and static role overlays. They need resolver-backed active instance projection if dynamic expert agents become real runtime entities.

Consensus: do not add every expert agent to global `AgentRoleID`; do not generate `config.agent` from packages; do not add fallback aliases. The viable direction is package-owned virtual agent instances with explicit base roles and resolver-owned projection.

## Current Diagnosis

OpenCorvus currently has static worker roles plus active expert-squad package projection. It does not have an agent-instance factory.

The practical chain today is:

1. `AgentRoleContract` defines the global base roles.
2. `WorkflowRegistry` maps scheduler workflow tools to those roles.
3. `runAgentSession` accepts only session kinds that are valid roles.
4. `PromptProfileResolver` overlays the active expert-squad package onto a known role.
5. Registry validation rejects package-defined custom agent IDs.

That design makes expert squads useful for prompt, skill, tool, MCP, and capability projection, but it cannot materialize a new expert such as `frontend-automation-debugger` unless that identity is first added as a global role. Adding more global roles for each package would make expert squads a global role alias list, which violates the package boundary and would accumulate static core surface area.

The root issue is not only manifest validation. Runtime identity, workflow dispatch, session protocol, model configuration, skill mounts, package tools, MCP providers, catalog, and overlay UI all currently converge on static role IDs. A manifest-only relaxation would create a partially visible agent that cannot safely run.

## Target Architecture

### Core Model

Introduce package-owned virtual agent instances that run on existing base roles.

The base role remains the OpenCorvus runtime contract:

- session kind
- terminal protocol
- tool ownership
- scheduler workflow binding
- model configuration source
- base system prompt and core role contract

The virtual agent instance is derived package-local metadata for a base role. It is not the expert-squad identity, not an active selector, and not a resolver input. The expert-squad identity remains manifest `id`; the active selection remains `prompt_profile.active`.

- package-local agent ID
- display label and description
- package prompt overlay
- package README append context
- catalog and overlay projection

The active package maps base roles to virtual instances through a single source: `virtual_agents.<baseRole>`. Workflow dispatch remains role-based in the first implementation phase, while the visible and prompt-level expert identity becomes package-owned metadata derived by the resolver.

### Manifest Shape

Recommended package manifest additions:

```jsonc
{
  "virtual_agents": {
    "build": {
      "id": "frontend-automation-debugger",
      "label": "Frontend Automation Debugger",
      "description": "Repairs browser automation, preview evidence, and task-scoped frontend debug loops.",
      "prompt": "virtual-agents/build/system.md"
    }
  },
  "capability_projection": {
    "agents": {
      "build": {
        "package_skill_refs": ["frontend-automation-debug/build/frontend-automation-debug-selector"],
        "package_tool_refs": ["frontend-automation-debug/build/frontend-automation-evidence"],
        "package_mcp_server_refs": ["frontend-automation-debug/build/frontend-automation-debug"]
      }
    }
  }
}
```

The `virtual_agents` key and `capability_projection.agents` key are both the base role in phase 1. The virtual-agent binding has only one source: the presence of `virtual_agents.<baseRole>`. `capability_projection.agents.<baseRole>` remains the capability source for that role and must not repeat `virtual_agent` or any alias of the binding.

Virtual-agent owned package refs use the same base-role ownership namespace that resolver validation already understands: `<expertSquadID>/<baseRole>/<ref>`. Package-shared refs are allowed only inside the same package namespace as `<expertSquadID>/shared/<ref>`. Cross-package shared refs are out of scope for phase 1.

The prompt file lives outside the current `agents/` directory so custom folder names cannot be confused with role overlays. `virtual-agents/<baseRole>/system.md` is the phase-1 canonical prompt path.

### Existing `agents` Field

The current manifest `agents` field means known-role overlays. It can remain only as a role-overlay source for roles that are not bound to virtual instances.

Rules:

- If `virtual_agents.<role>` exists, prompt text for that role comes from `virtual_agents.<role>.prompt`.
- If `virtual_agents.<role>` exists, `agents.<role>` must be absent in the same package.
- Package skills, tools, and MCP refs for that role come from `capability_projection.agents.<role>` only.
- A custom folder under `agents/<custom-id>/` must not be accepted as an implicit virtual agent. Custom identities must be declared in `virtual_agents`.
- Existing packages that want dynamic expert agents must be migrated atomically to the new explicit shape. There is no hidden compatibility path.

This avoids a double source for worker prompt composition and role-to-virtual-agent binding.

## Runtime Projection

`PromptProfileResolver` remains the only runtime projection surface.

For a worker role, resolver output should include:

- `baseRole`: the static `AgentRoleID`
- `virtualAgentID`: `virtual_agents.<baseRole>.id`, when the active package declares that role
- `expertSquadID`: the active manifest ID
- `promptProfileID`: the prompt profile selected by `prompt_profile.active`
- `projectionHash`: a deterministic hash of the active manifest, virtual prompt file digest, README append digest, selected package skill file digests, package tool file digests, MCP definition digests, and projection refs
- `promptParts`: base role prompt, package README append, virtual agent prompt, selected skill context, package tool context, and scoped MCP context
- `visibleCapabilities`: tools, skills, MCP providers, and catalog metadata visible to that worker under the active package

If the active package declares an invalid virtual agent, package validation must fail. Runtime must not silently fall back to the base role prompt.

## Runner And Session Contract

Phase 1 should keep the session kind as the base role. The runner should attach virtual identity metadata to the visible session descriptor and to worker capability resolution.

Required properties:

- `kind` remains a valid `AgentRoleID`.
- `baseRole` equals `kind`.
- `virtualAgentID` is present only when active resolver projection binds that role.
- Existing runtime identity fields remain base-role owned: `agentName`, message `agent`, `SessionRuntimeContract.identity.agentKind`, `WorkerTurnDescriptor.payload.agent`, `WorkerTurnDescriptor.payload.roleContractID`, and coordination request `payload.agent` must not be replaced with `virtualAgentID`.
- `virtualAgentID`, virtual label, and virtual description are additive metadata for display and diagnostics.
- Terminal tool ownership remains derived from `AgentRoleContract`.
- Prompt composition goes through `PromptProfileResolver.composeAgentPrompt`.
- Stale or mismatched projection metadata fails visibly before the worker starts.
- UI-visible session cards show the virtual expert label when present, with base role available as technical metadata.

This preserves runtime invariants without pretending that the scheduler can dispatch arbitrary package IDs. Passing the virtual ID as `agentName` is explicitly rejected because model resolution, prompt composition, continuation validation, redispatch checks, and terminal protocol all currently depend on base-role identity.

## Workflow Boundary

Phase 1 should not make virtual agent IDs direct workflow targets.

The workflow tool remains the scheduler-visible action, and its target remains a base role. The active expert squad decides which virtual instance represents that role.

This satisfies the expert-squad boundary:

- no second workflow registry
- no package-defined dispatch engine
- no task manipulation tool owned by the package
- no scheduler state machine
- no synthetic context packet

Future work may consider direct virtual-agent dispatch, but that is a separate design because it touches workflow definition, routing, model configuration, permissions, and visible message semantics.

## Registry Validation

Registry must validate these constraints before a package can be used:

- `virtual_agents` keys are valid `AgentRoleID` base roles.
- Every virtual agent declares a package-local `id` that is a valid canonical ref segment and unique within the package.
- Every prompt path is inside the package and exists.
- Every virtual-agent prompt path uses `virtual-agents/<baseRole>/system.md`.
- Every skill, tool, and MCP ref exists in the same package namespace. Same-package shared refs may use `<expertSquadID>/shared/<ref>`; cross-package refs are out of scope.
- A role cannot define both `agents.<role>` and `virtual_agents.<role>`.
- `capability_projection.agents.<role>` must not contain a `virtual_agent` field or any role-to-virtual-agent alias field.
- Package refs in `capability_projection.agents.<role>` must be either same-package shared refs or owned by `<expertSquadID>/<role>/...`.
- Bare custom agent folders under `agents/` remain invalid.
- Package import or payload release must not write `config.agent`.

## UI And API Surface

The overlay should show resolver-backed active agent projection, not raw package folders.

Required visible surfaces:

- `/expert-squad/catalog` is the canonical active agent projection API. It returns active package metadata plus an explicit `active_agent_projection` field.
- `/agent` remains a static base-role and model-configuration catalog. It must not claim active expert-squad availability.
- Skill mounts persist and mutate mount keys by `baseRole`; they expose `virtualAgentID`, label, and source expert squad only as metadata.
- The expert-squad panel shows virtual agents, base roles, projected skills, tools, and MCP providers for the active package.
- The composer still selects the expert squad through `prompt_profile.active`; it does not create a second active agent selector.

Canonical response shape for `active_agent_projection`:

```jsonc
{
  "source_expert_squad_id": "frontend-automation-debug",
  "prompt_profile_active": "frontend-automation-debug",
  "agents": [
    {
      "base_role": "build",
      "virtual_agent_id": "frontend-automation-debugger",
      "label": "Frontend Automation Debugger",
      "description": "Repairs browser automation, preview evidence, and task-scoped frontend debug loops.",
      "projection_hash": "sha256:...",
      "package_skill_refs": ["frontend-automation-debug/build/frontend-automation-debug-selector"],
      "package_tool_refs": ["frontend-automation-debug/build/frontend-automation-evidence"],
      "package_mcp_server_refs": ["frontend-automation-debug/build/frontend-automation-debug"]
    }
  ]
}
```

Display labels are never identity. API callers must use `base_role` for runtime/mount mutations and `virtual_agent_id` only for display, diagnostics, and package-local metadata.

If UI changes are implemented later, visual verification must include real overlay screenshots for the expert-squad panel and any agent/session card affected by virtual identity display.

## Model Configuration

Phase 1 should keep model assignment on the base role. A virtual agent inherits the base role model contract.

Reasoning:

- Existing model configuration is role based.
- Virtual agent model overrides would introduce a second configuration dimension and need a separate review.
- Expert-squad behavior should first be solved through resolver-owned prompt, skill, tool, and MCP projection.

If model overrides are required later, they must be modeled as explicit package capability metadata and validated as part of resolver projection, not generated into `config.agent`.

## Anti-Patterns Rejected

- Do not add `frontend-automation-debugger`, `tester`, or other package-specific experts to global `AgentRoleID`.
- Do not relax `assertRoleID` to accept arbitrary strings.
- Do not load `agents/<custom-name>/system.md` as a best-effort custom agent.
- Do not create package aliases based on directory name, ZIP name, display label, selector name, MCP name, or similar names.
- Do not generate `config.agent` entries from expert-squad packages.
- Do not scan inactive packages to populate worker skills, tools, catalog entries, or MCP providers.
- Do not make UI filtering the source of truth for active agents.
- Do not add a second active expert-squad or active-agent field.
- Do not add scheduler gates, route bypasses, or preflight host rules that teach the LLM which path to take.
- Do not claim E2E completion with only mocked contract tests.

## Implementation Plan After Review

1. Settle this review plan with independent agents.
2. Update registry schema and package validation for `virtual_agents` keyed by base role.
3. Update resolver worker capability projection to return base role plus virtual instance metadata.
4. Update prompt composition so bound virtual instances replace same-role package overlays.
5. Update skill, package tool, and MCP projection to use the active virtual instance.
6. Update runner visible session metadata while keeping session kind on the base role.
7. Update catalog, skill-mount, and overlay APIs to expose resolver-backed active virtual agents.
8. Update package docs and example expert squads atomically.
9. Add tests for registry, resolver, runner, workflow dispatch, routes, skill mounts, and overlay behavior.
10. Run required tests and visual verification for any frontend change.

## Test Plan

Registry tests:

- Accept a package with `virtual_agents.build.id = "frontend-automation-debugger"` and `virtual_agents.build.prompt = "virtual-agents/build/system.md"`.
- Reject unknown `virtual_agents` key.
- Reject duplicate virtual-agent `id` values under different base roles.
- Reject missing virtual agent prompt file.
- Reject virtual-agent prompt paths outside `virtual-agents/<baseRole>/system.md`.
- Reject custom `agents/<custom-id>/` without a `virtual_agents` declaration.
- Reject `agents.build` and `virtual_agents.build` in the same package.
- Reject `capability_projection.agents.build.virtual_agent` or any equivalent duplicate binding field.
- Reject cross-package package refs in virtual-agent projections.
- Assert package import and payload release do not write `config.agent`.

Resolver tests:

- Active package maps `build` to the virtual instance and includes virtual prompt text.
- Inactive packages do not appear in worker capability, skill projection, tool projection, MCP provider projection, or catalog.
- Projection hash changes when virtual agent prompt content, README append content, package tool files, skill files, MCP definitions, or projection refs change.
- Invalid active package fails loudly and does not fall back to base role prompt.

Runner and workflow tests:

- Scheduler workflow dispatch to `build` creates a worker session with `kind = "build"` and virtual identity metadata when the active package binds `build`.
- Existing runtime identity fields remain base-role values: `agentName`, message `agent`, `SessionRuntimeContract.identity.agentKind`, `WorkerTurnDescriptor.payload.agent`, `WorkerTurnDescriptor.payload.roleContractID`, and coordination request `payload.agent`.
- Passing a virtual ID as `agentName` is rejected and never resolves model config or worker capability.
- Terminal tools remain derived from the base role.
- Worker prompt is composed by `PromptProfileResolver`.
- Stale projection metadata prevents worker startup with a visible error result.

API and UI tests:

- Expert-squad catalog exposes `active_agent_projection` as the canonical active virtual-agent API.
- `/agent` remains a static base-role/model-config catalog and is not used to infer active expert-squad availability.
- Skill-mount route persists mutations by base role and returns virtual identity only as metadata.
- Cross-surface test uses nonempty `/agent` static base roles plus active virtual projection to prove the UI does not confuse static base agents with active virtual agents.
- Overlay expert-squad panel displays virtual agent ID, label, base role, skills, tools, and MCP providers.
- Session card displays virtual expert label when present.
- Browser screenshot verifies expert-squad panel changes if UI is modified.

Package manager and payload tests:

- `ExpertSquadPackageManager.importDirectory` accepts valid virtual-agent packages and rejects duplicate binding sources.
- `ExpertSquadPackageManager.importArchive` preserves virtual-agent schema and rejects unsafe embedded keys.
- `ExpertSquadPackageManager.exportArchive` round-trips virtual-agent packages without rewriting identity.
- Payload release seeds missing virtual-agent packages into empty projects.
- Payload release does not overwrite existing project packages.
- Payload freshness checks include virtual-agent prompt and package ref files.

Documentation tests:

- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun run api:routes-check` for route schema changes.
- SDK contract tests for updated expert-squad catalog and skill-mount response shapes.
- Product docs and document-health checks for any public API or architecture doc updates.

## Independent Agent Review Packet

## Independent Review Round 1 Resolution

Four read-only reviewers completed the first plan review on 2026-07-06. Their blocking feedback has been applied to this record:

- Registry/resolver review found that `virtual_agents.*.base_role`, `role_instance_bindings`, and `capability_projection.agents.*.virtual_agent` repeated the same binding. Resolution: `virtual_agents` is now keyed by base role; `role_instance_bindings` and projection-level virtual-agent binding fields are removed.
- Registry/resolver review found competing ownership for prompt refs and capability refs. Resolution: virtual-agent prompt identity lives under `virtual_agents.<baseRole>`; package skills, tools, and MCP refs remain under `capability_projection.agents.<baseRole>`.
- Runtime review found that existing `agent` fields are runtime identity. Resolution: the plan now reserves `agentName`, message `agent`, runtime contract identity, worker descriptors, and coordination request `payload.agent` for base-role identity; `virtualAgentID` is additive metadata only.
- UI/API review found `/agent` was unresolved and could confuse active virtual availability with static base roles. Resolution: `/expert-squad/catalog.active_agent_projection` is the canonical active projection API; `/agent` remains a static base-role/model-config catalog.
- UI/API review found skill mounts were underspecified. Resolution: skill mounts persist and mutate by base role, with virtual identity exposed only as metadata.
- Historical constraints review found wording that risked redefining expert-squad identity. Resolution: virtual agents are explicitly package-local derived metadata; manifest `id` and `prompt_profile.active` remain the only expert-squad identity and active selection source.
- Historical constraints review found an undefined shared package surface. Resolution: phase 1 allows only same-package shared refs under `<expertSquadID>/shared/*`; cross-package shared refs are out of scope.
- Historical constraints review found package manager, payload, route, SDK, and docs validation gaps. Resolution: the test plan now includes import/export/archive/payload coverage, API route checks, SDK contract tests, and document-health checks for interface changes.

### Reviewer A: Runtime Identity And Session Contract

Scope:

- `packages/opencorvus/src/agent/role-contract.ts`
- `packages/opencorvus/src/agent/runner.ts`
- session descriptors and visible agent messages

Questions:

- Does keeping session kind as the base role preserve all runtime invariants?
- What breaks if `virtualAgentID` is added only as metadata?
- Which runner or terminal-tool tests prove there is no arbitrary-string agent fallback?
- Is there any hidden dependency that assumes display agent ID equals `AgentRoleID`?

### Reviewer B: Registry And Resolver Single Source

Scope:

- `packages/opencorvus/src/expert-squad/registry.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- package validation and capability projection

Questions:

- Does `virtual_agents` keyed by base role eliminate duplicate binding authority?
- Should `capability_projection.agents` remain keyed by base role in phase 1?
- What exact validation prevents fallback to old role overlays?
- Which resolver outputs must include `projectionHash` to make stale projection detectable?

### Reviewer C: UI, API, And Skill Mount Impact

Scope:

- expert-squad catalog routes
- skill mount projection
- overlay expert-squad panel
- agent/session card display

Questions:

- Which API should become the canonical active agent projection?
- Should the raw `/agent` list remain a static technical model surface, or should it become resolver-backed?
- What UI evidence is required to prove active and inactive packages are isolated?
- Where can display labels accidentally become identity?

### Reviewer D: Historical Constraints And Anti-Pattern Review

Scope:

- `AGENTS.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/99-principles.md`
- July 2026 expert-squad records

Questions:

- Does the plan violate the expert-squad boundary in rule 15.1?
- Does it add a gate, fallback, hidden active state, or second workflow path?
- Which existing records must be updated after implementation?
- Are there dead or obsolete role-overlay paths that should be deleted after migration, and do they require user confirmation before deletion?

## Open Decisions Before Implementation

- Decide whether phase 1 must update existing expert-squad packages to use virtual agents, or only introduce the capability for new packages.
- Decide whether implementation should delete now-obsolete role-overlay files after migration. Deletion requires explicit user confirmation if those files are found to be dead or obsolete.
