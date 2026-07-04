# Dynamic Expert Squad Loading

Date: 2026-07-03

Status: dynamic expert-squad package loading, active README Orchestrator append, runtime capability projection, scoped MCP tool/prompt/resource projection, built-in `general`-only source boundary, overlay prompt-profile fixture cleanup, API documentation sync, browser-preview fixture contract correction, expert-squad Git ignore completeness repair, and focused validation landed.

Glossary:

- API means Application Programming Interface.
- DB means Database.
- ID means Identifier.
- JSON means JavaScript Object Notation.
- LLM means Large Language Model.
- MCP means Model Context Protocol.
- SDK means Software Development Kit.
- UI means User Interface.
- ZIP means the ZIP archive file format.

## Recall

### User Request

The user is preparing to refactor the expert-squad architecture so OpenCorvus dynamically loads expert squads from `.opencorvus` using a clear-text directory structure.

The requested shape:

- Each expert-squad folder has a README that introduces the agent communication relationship.
- Each agent folder may contain a system prompt, including the `general` agent prompt.
- Each agent folder may contain dedicated skills.
- Each agent folder may contain agent-scoped tool definitions, skill definitions, and MCP definitions.
- These expert-squad-specific exclusive configurations are unioned with the system's currently supported collections.
- Expert squads can be loaded as folders and as compressed files.
- Expert squads can be packed and unpacked.
- Each expert squad has a stable ID so OpenCorvus does not confuse similarly named squads.
- Use several independent agents to investigate current state and impact surface until no new findings emerge.
- Write the total design, send it to independent agents for review, revise it, and repeat until no design issue remains.
- First clarify how tools, skills, and MCP definitions are isolated by expert-squad ID, and how the default collection and specific collection are separated.

### Acceptance Criteria

- A single design explains dynamic `.opencorvus` expert-squad loading, package structure, manifest identity, folder import, ZIP import, packing, and unpacking.
- The design explicitly separates:
  - the default maximum collection supplied by OpenCorvus and current project/global config;
  - the active expert-squad-specific collection loaded from the selected expert squad ID;
  - the effective per-session union that runtime code can expose.
- Tools, skills, MCP servers, role prompt overlays, and agent-scoped definitions are isolated by expert-squad ID.
- Similar display names, folder names, ZIP names, skill names, or MCP names cannot determine identity. The manifest ID is the only expert-squad identity.
- The design preserves one source of truth for active selection. It must not create a second active-squad field that can disagree with `prompt_profile.active`.
- The design does not introduce fallback loading, compatibility aliases, name guessing, local UI filtering, hidden routing, host-side gates, or synthetic messages.
- The design names all affected code surfaces and required tests before implementation.
- Independent agent findings and review feedback are recorded in this file.

### Hard Constraints

- `AGENTS.md` forbids fallback, compatibility paths, double sources, hidden messages, host-side gates, state-machine routing, unreviewed patches, broad git reset, and creating worktrees without explicit user authorization.
- All specs, plans, architecture records, and benchmark records must live under `specs/`.
- New implementation work must update tests with the behavior change.
- Frontend or visual implementation work later requires real page launch, screenshot inspection, and visual iteration. This record is a design-only pass.
- Existing running OpenCorvus or overlay processes must not be restarted, killed, refreshed, or reloaded unless the user explicitly authorizes it.
- `.opencorvus/r`, `.opencorvus/runtime`, `.opencorvus/worktrees`, and other runtime internals must not become expert-squad package inputs or archive contents.
- Test timeouts must be based on real no-activity behavior when a timeout wrapper is used.

### Sources Read

| Source | Finding carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no double source, no gates, Recall before edits, specs under `specs/`, no unauthorized worktree/restart. |
| `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md` | Expert-squad work requires a dated record, callpoint inventory, and tests/docs validation. |
| `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md` | Required surfaces include PromptProfile, built-in expert-squad skills, Orchestrator prompt/tools, skill registry/mount tests, and config routes. |
| `specs/README.md` | Specs and records stay under the repository `specs/` hierarchy. |
| `specs/records/2026-07/README.md` | Monthly index must link this record. |
| `specs/current/architecture/04-extensions.md` | Extension surfaces are explicit; dynamic expert squads must not become a hidden route or implicit plugin replacement. |
| `specs/current/architecture/05-config.md` | Config must remain single-source and explicit. |
| `specs/current/architecture/08-agent-tool-adapter.md` | Static agent tool pools are the maximum declared catalog; effective runtime tools need explicit projection. |
| `specs/current/architecture/11-agent-oop-protocol.md` | Agent role contracts remain protocol boundaries. |
| `specs/current/architecture/13-agent-communication-matrix.md` | Agent communication relationships need a visible model, matching the requested expert-squad README requirement. |
| `specs/current/architecture/14-agent-runtime-mode.md` | Runtime mode and tool installation must stay observable. |
| `specs/current/architecture/18-webpage-replica-agent-workflow.md` | Domain workflows are role/task contracts, not prompt prose alone. |
| `specs/current/architecture/99-principles.md` | Prompt-over-host invariant; host-side gates are rejected. |
| `specs/records/2026-07/2026-07-03-expert-squad-capability-profile.md` | Establishes `PromptProfile = role prompt overlays + capability projection`; pending implementation. |
| `specs/records/2026-07/2026-07-03-expert-squad-building-block-legend.md` | Updates docs/diagram language to building-block capability projection; runtime still pending. |
| `specs/records/2026-06/2026-06-30-thick-expert-squad-prompts.md` | Old invariant was thick prompts but prompt-only runtime; this design supersedes that runtime boundary. |
| `specs/records/2026-06/2026-06-29-frontend-innovate-expert-squad.md` | Domain expert squads already need distinct evidence and dispatch behavior. |
| `packages/opencorvus/src/agent/prompt-profile.ts` | Current active expert-squad model is prompt-only and keyed by profile ID. |
| `packages/opencorvus/src/agent/agent.ts` | Built-in role tools cannot be overridden by config; custom agents receive custom defaults. |
| `packages/opencorvus/src/agent/role-contract.ts` | Known agent roles and Orchestrator workflow tool mapping are the legal dispatch boundary. |
| `packages/opencorvus/src/agent/tool-pool-contract.ts` | `AgentToolPool` and `GLOBAL_TOOL_IDS` define maximum supported tool IDs. |
| `packages/opencorvus/src/config/config.ts` | `.opencorvus` participates in config directory loading; session overlay excludes tools and MCP. |
| `packages/opencorvus/src/config/paths.ts` | Project `.opencorvus` path discovery is already centralized. |
| `packages/opencorvus/src/mcp/index.ts` | MCP currently builds one flat configured tool map and eagerly connects enabled clients. |
| `packages/opencorvus/src/orchestrator/agent.ts` | Orchestrator currently installs all factory tools as an exact runtime contract. |
| `packages/opencorvus/src/orchestrator/tools.ts` | `select_expert_squad` currently writes only `prompt_profile.active`. |
| `packages/opencorvus/src/project/runtime-paths.ts` | Runtime internal paths are explicitly separated and must not be archived as package input. |
| `packages/opencorvus/src/server/routes/skill.ts` | Existing skill import route supports file, directory file list, and ZIP archive using a mature parser. |
| `packages/opencorvus/src/session/loop.ts` | Exact runtime contracts bypass ordinary registry/MCP injection; `includeMcpTools` controls MCP only when exact tools are not replacing the registry. |
| `packages/opencorvus/src/skill/manager.ts` | Existing ZIP import logic has path normalization and traversal rejection that expert-squad import should reuse. |
| `packages/opencorvus/src/skill/mounts.ts` | Skill visibility is currently filtered by static agents/tools, not active expert-squad capability. |
| `packages/opencorvus/src/skill/skill.ts` | Skill discovery is flat across `.opencorvus/skill(s)` and built-ins; no expert-squad scope exists. |
| `packages/opencorvus/src/tool/registry.ts` | Custom tools are loaded flat from config directories; no expert-squad scope exists. |
| `packages/opencorvus/src/tool/skill.ts` | The `skill` tool can consume a provided skill surface and is the right backend boundary for projected skills. |

### Repository Search Evidence

| Command | Finding |
| --- | --- |
| `rg -n "PromptProfile|builtIns|prompt_profile|frontend-replica|frontend-innovate|expert-squad|select_expert_squad|mounted Orchestrator expert-squad|skill tool" packages/opencorvus/src packages/opencorvus/test specs` | Expert-squad behavior spans PromptProfile, Orchestrator selector tool, built-in skills, skill tests, config routes, and architecture records. |
| `rg -n "frontend-replica-expert-squad|frontend-innovate-expert-squad|frontend-automation-debug-expert-squad|builtin-skills|required_tools|mounted_agents" packages/opencorvus/src packages/opencorvus/test` | Built-in selector skills are hardcoded imports today; backend/algorithm profiles do not have equivalent selector skills. |
| `rg -n "requiredBuiltInTargetMatrix|built-in registry pressure|overlay target|prompt-profile" packages/opencorvus/test/agent packages/opencorvus/test/server` | Prompt-profile tests pin built-ins, default, target matrix, and config-route behavior. |
| `rg -n "select_expert_squad|createOrchestratorTools|prompt_profile|PromptProfile|toolGuard|setSessionRuntimeContract|includeMcpTools|withDecisionEffectMetadata|enableMap|requireFrontendInnovateContract" packages/opencorvus/src/orchestrator packages/opencorvus/src/session packages/opencorvus/src/agent -g "*.ts"` | Orchestrator creates the full tool map, wraps metadata, installs exact runtime tools, and has direct profile-specific checks. |
| `rg -n "mcp|MCP|Config.*mcp|MCP\\.tools|includeMcpTools|Model Context Protocol|server" packages/opencorvus/src/mcp packages/opencorvus/src/config packages/opencorvus/src/tool packages/opencorvus/test -g "*.ts"` | MCP tools are globally configured and flattened as `client_tool`; there is no expert-squad ID isolation. |
| `rg -n "Config\\.directories|projectConfigDirectory|opencorvus\\.jsonc|\\.opencorvus" packages/opencorvus/src/config packages/opencorvus/src/project packages/opencorvus/src/server packages/opencorvus/test -g "*.ts"` | `.opencorvus` is already a config directory and project local directory; explicit server directory scope is required. |
| `rg -n "ZipReader|ZipWriter|archiveBase64|archive|tar|gzip|decompress|compress|unpack|pack|extract" packages/opencorvus/src packages/opencorvus/test -g "*.ts"` | Existing production import/export evidence supports ZIP; remote Linux tar/gzip packaging is unrelated to dynamic expert squads. |
| `rg -n "custom|\\.opencorvus.*tool|tools/|tool/|ToolRegistry|GLOBAL_TOOL_IDS|privateRegistryTools" packages/opencorvus/src/tool packages/opencorvus/src/config packages/opencorvus/test/tool packages/opencorvus/test/agent -g "*.ts"` | Project/global custom tools are flat today; expert-squad tools must be scoped and loaded through a separate resolver. |
| `rg -n "orchestratorWorkflowToolName|workflowToolName|AgentRoleContract\\.orchestratorWorkflowToolName|workflow tool" packages/opencorvus/src packages/opencorvus/test -g "*.ts"` | Dispatchable roles should be derived from workflow tool IDs using `AgentRoleContract`, not stored as a second list. |

### Independent Investigation Feedback

Three independent read-only agents investigated distinct surfaces. None modified files, created subagents, or ran git operations.

Kuhn reviewed prompt-profile and expert-squad selection:

- `prompt_profile.active` is the only active expert-squad selection state today.
- `PromptProfile` is prompt-only and hardcoded in TypeScript.
- Built-in expert-squad selector skills are hardcoded separately from profiles.
- Orchestrator prompt still names specific frontend expert squads.
- The largest risk is a three-source system where `.opencorvus` dynamically loads skills, TypeScript still owns PromptProfile, and UI performs separate filtering.
- Runtime projection must alter Orchestrator exact runtime tools, not only prompts or UI.

Feynman reviewed tool, skill, MCP, and runtime merging:

- `Config.Overlay` intentionally excludes tools and MCP, so dynamic expert-squad tools/MCP must not be written into session overlay.
- `AgentToolPool` should remain the maximum system catalog; active visibility should be derived from a profile-owned projection.
- `SkillMount.resolve`, `SkillTool`, and system prompt skill rendering must share one projected surface.
- Current `include_mcp_tools: boolean` is not precise enough for per-squad MCP; the design needs explicit MCP server/tool projection.
- `select_expert_squad` can only affect the next Orchestrator wake and must produce a visible continuation.

Boole reviewed `.opencorvus`, package/import/export, and ID risks:

- Project identity is not `.opencorvus`; `.git/opencorvus` is a project marker and `.opencorvus/r` is runtime storage.
- Existing skill import supports ZIP and normalizes paths; no production dynamic expert-squad tar/gzip path exists.
- Skill ZIP import must not implicitly create prompt profiles.
- Do not infer expert-squad identity from project name, directory name, ZIP file name, package name, or skill name.
- Project-scoped routes must continue to require explicit directory injection.

Consensus:

- The design must introduce one expert-squad package registry and one capability projection resolver.
- Active selection should remain `prompt_profile.active` for now, with its value treated as the canonical expert-squad ID.
- The implementation must not add a new parallel `expert_squad.active_id` unless it atomically replaces `prompt_profile.active` everywhere in the same change.
- Folder/ZIP import should normalize to one canonical directory source. Runtime loading should read the canonical unpacked directory, not both archive and directory as independent sources.
- Custom package agents are out of scope for phase 1 because the current dispatch and worker lifecycle are defined by `AgentRoleContract`.
- MCP scope must cover tools, prompts, resources, server proxy operations, status, auth, connect, disconnect, and call paths, not only `MCP.tools()`.
- Selector metadata must be separated from production skill content so `general` can discover available expert squads without loading inactive package skills.

## Root Findings

1. Current expert squads are not dynamically loaded.
   - Built-in PromptProfiles live in `prompt-profile.ts`.
   - Built-in selector skills live in hardcoded imports in `skill.ts`.
   - `.opencorvus/skill(s)` can load ordinary skills, but that does not register an expert-squad package.

2. Current expert squads are prompt-only by type.
   - `PromptProfileDefinitionSchema` contains `label`, `description`, and role `agents`.
   - It cannot express expert-squad tools, skills, MCP servers, agent-local prompts, or dispatch capability.

3. Current runtime visibility is not profile-aware.
   - Orchestrator exact runtime contracts install the full Orchestrator tool factory output.
   - `SkillMount.resolve()` filters by static tools/agents, not active profile.
   - `MCP.tools()` flattens all enabled configured MCP clients.
   - `ToolRegistry` loads custom tools flat from config directories.

4. Current `.opencorvus` has multiple meanings.
   - It is a config directory.
   - It contains runtime internals under `.opencorvus/r`.
   - It can contain skill directories.
   - Dynamic expert-squad packages need a new canonical subdirectory that does not overlap those meanings.

5. Identity must be manifest-owned.
   - Existing file/folder names are human-maintained and collision-prone.
   - The user explicitly wants stable IDs to avoid confusion between similarly named expert squads.
   - Therefore manifest ID is the only identity; labels and paths are display/transport metadata only.

6. The capability model needs two user-facing categories and one runtime refinement.
   - Base/common capability is the OpenCorvus-owned role-base surface each agent role needs to operate.
   - Claimed or specific capability is either claimed from the default public pool by explicit `default/...` refs or defined inside the active expert-squad package by package refs.
   - The runtime effective surface is `role_base(agent) union explicit default claims union active package refs`, projected by `expert_squad_id`.

## Identity Terms

| Term | Meaning | Must not be inferred from |
| --- | --- | --- |
| `project_id` | DB namespace for one OpenCorvus project/worktree identity. | Expert-squad ID, ZIP filename, package label, skill name. |
| Project directory | Filesystem directory selected by explicit route query/header or runtime context. | Project display name or expert-squad ID. |
| Project display name | Human label for the project. | Directory name, `project_id`, expert-squad ID. |
| Manifest `id` | Required field in `expert-squad.jsonc`; the expert-squad identity. | Package label, README title, source folder name before import, ZIP filename, skill name, MCP server name. |
| `expert_squad_id` | Runtime name for manifest `id`; the value stored in `prompt_profile.active`. | Any display or transport name. |
| Canonical folder | `.opencorvus/expert-squads/<expert_squad_id>/` after import. | Source folder name unless it equals manifest `id` after validation. |
| ZIP filename | Transport filename for import/export. | Manifest `id`; it is ignored for identity. |
| Skill name | Display/search name for a skill. | Expert-squad identity. |
| MCP server name | Default or package MCP server display/config key. | Expert-squad identity. |

## Design Decision

Introduce an `ExpertSquadRegistry` backed by canonical package folders under:

```text
.opencorvus/expert-squads/<expert_squad_id>/
```

`expert_squad_id` is the same canonical identifier used by `prompt_profile.active`. In this phase, OpenCorvus does not add a second active-selection key. The user-facing entity becomes an expert squad, while the existing `PromptProfile` field remains the active selection storage because it is already the single source across session config, Orchestrator selection, prompt composition, and catalog routes.

Rejected alternatives:

| Alternative | Rejection reason |
| --- | --- |
| Add `expert_squad.active_id` while keeping `prompt_profile.active` | Creates two active selection sources that can disagree. |
| Infer ID from folder, ZIP, display name, or selector skill name | Violates the user's ID requirement and creates name-similarity ambiguity. |
| Let skill import create prompt profiles | Makes ordinary skill import a hidden expert-squad registration side effect. |
| Scan every expert-squad folder's tools/skills/MCP into global registries | Inactive squads would leak capabilities into the active runtime. |
| Load archives directly at runtime | Makes archive and unpacked folder parallel sources; import must normalize to one folder source. |
| Put tools/MCP into session overlay during selection | Splits selection state across overlay fields and violates the overlay contract. |
| Keep PromptProfile as TypeScript built-ins while `.opencorvus` owns extra skills | Preserves the current three-source failure mode. |

## Canonical Package Layout

The package directory is clear text and must be human inspectable:

```text
.opencorvus/
  expert-squads/
    frontend-replica/
      expert-squad.jsonc
      README.md
      agents/
        general/
          system.md
        orchestrator/
          system.md
          skills/
            scheduler/SKILL.md
          tools/
            source-evidence.ts
          mcp/
            browser.jsonc
        build/
          system.md
          skills/
            implementation/SKILL.md
          tools/
            build-evidence.ts
      skills/
        shared-domain-guidance/SKILL.md
      tools/
        shared-evidence.ts
      mcp/
        browser.jsonc
```

Required files:

- `expert-squad.jsonc`
- `README.md`

Required directory rules:

- The canonical directory name must equal `expert_squad_id`.
- Agent folder names must be legal `AgentRoleID` values in phase 1.
- Package-defined custom agents are explicitly out of scope in phase 1. Supporting them later requires a separate design for role contract, session kind, tool pool, permissions, dispatch, worker lifecycle, and UI catalog scope.
- `README.md` documents the agent communication relationship and is appended to the active Orchestrator prompt when that expert squad is selected. It is not selector catalog data and must not expose inactive squad production content.
- `agents/<agent_id>/system.md` is a role-scoped expert-squad prompt overlay for built-in roles. It does not replace OpenCorvus core role contracts.
- Agent-local `skills/`, `tools/`, and `mcp/` belong only to that agent inside this expert squad.
- Squad-level `skills/`, `tools/`, and `mcp/` are shared only inside the active expert squad.
- Unknown top-level package directories are errors. They are not ignored.
- Runtime-internal directories such as `.opencorvus/r` are never package roots, package files, or archive entries.

## Manifest Contract

`expert-squad.jsonc` is the machine source of truth:

```jsonc
{
  "schema_version": 1,
  "id": "frontend-replica",
  "label": "Frontend Replica",
  "description": "Expert squad for evidence-backed webpage replica tasks.",
  "version": "2026.07.03",
  "readme": "README.md",
  "selector": {
    "summary": "Use for evidence-backed webpage replica tasks.",
    "selection_guidance": "Call select_expert_squad with profile_id frontend-replica before scheduling replica workflow work."
  },
  "capability_projection": {
    "scheduler": {
      "role_base": true,
      "built_in_tool_ids": ["select_expert_squad", "skill", "build"],
      "default_skill_refs": [],
      "default_tool_refs": [],
      "package_tool_refs": ["frontend-replica/orchestrator/source-evidence"],
      "package_skill_refs": ["frontend-replica/orchestrator/scheduler"],
      "default_mcp_server_refs": [],
      "package_mcp_server_refs": ["frontend-replica/orchestrator/browser"],
      "default_mcp_tool_refs": [],
      "package_mcp_tool_refs": [],
      "default_mcp_prompt_refs": [],
      "package_mcp_prompt_refs": [],
      "default_mcp_resource_refs": [],
      "package_mcp_resource_refs": []
    },
    "agents": {
      "build": {
        "role_base": true,
        "built_in_tool_ids": [],
        "default_skill_refs": [],
        "package_skill_refs": ["frontend-replica/build/implementation"],
        "default_tool_refs": [],
        "package_tool_refs": ["frontend-replica/build/build-evidence"],
        "default_mcp_server_refs": [],
        "package_mcp_server_refs": [],
        "default_mcp_tool_refs": [],
        "package_mcp_tool_refs": [],
        "default_mcp_prompt_refs": [],
        "package_mcp_prompt_refs": [],
        "default_mcp_resource_refs": [],
        "package_mcp_resource_refs": []
      }
    }
  },
  "agents": {
    "general": {
      "prompt": "agents/general/system.md",
      "skill_refs": [],
      "tool_refs": [],
      "mcp_server_refs": []
    },
    "orchestrator": {
      "prompt": "agents/orchestrator/system.md",
      "skill_refs": ["frontend-replica/orchestrator/scheduler"],
      "tool_refs": ["frontend-replica/orchestrator/source-evidence"],
      "mcp_server_refs": ["frontend-replica/orchestrator/browser"]
    },
    "build": {
      "prompt": "agents/build/system.md",
      "skill_refs": ["frontend-replica/build/implementation"],
      "tool_refs": ["frontend-replica/build/build-evidence"],
      "mcp_server_refs": []
    }
  }
}
```

`agents.<agent_id>.prompt` is the only authored prompt-overlay path in the manifest. `PromptProfile.catalog()` derives its role `agents` map from this field. The manifest must not also contain a separate `prompt_profile.agents` map.

`selector` is a registry-owned selection metadata block. It is not a `SKILL.md`, it cannot include arbitrary resource files, and it cannot be loaded through the ordinary `SkillTool` as inactive package production content. The generated selector reference is `selector/<expert_squad_id>`.

`agents.<agent_id>.skill_refs`, `tool_refs`, and `mcp_server_refs` declare ownership and documentation relationships for that agent. They do not grant runtime visibility. Runtime visibility is derived only from `capability_projection` plus the current agent/runtime boundary.

Validation rules:

- `id` must match `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`.
- Manifest `id` must equal the canonical folder name.
- Package ZIP root must contain exactly one package folder or exactly the package files at root. After normalization, the target folder name must equal `id`.
- `README.md` path must exist.
- Every prompt, skill, tool, and MCP path referenced by the manifest must exist.
- Every manifest path must normalize inside `.opencorvus/expert-squads/<id>/` after import. Absolute paths, `..`, Windows drive prefixes, symlink escapes, and path-case tricks that leave the package root are hard errors for both folder import and ZIP import.
- Every referenced built-in tool ID must exist in the maximum system tool catalog.
- Every referenced workflow tool must map to a legal role through `AgentRoleContract`.
- Package-owned refs must be namespaced by this manifest ID.
- Default refs must use the `default/...` namespace.
- Selector refs are generated as `selector/<expert_squad_id>` by `ExpertSquadRegistry`; package manifests do not list selector refs inside `capability_projection`.
- Every package ref in `capability_projection` must point to a package definition declared in `agents.<agent_id>.*_refs` or squad-level shared definitions.
- Every projected workflow tool that dispatches a worker role must have a corresponding `capability_projection.agents[<worker_role>]` entry. Missing worker projections fail validation.
- `default_skill_refs` must reference existing default ordinary skills with `default/skill/<skill_name>` refs. No default ordinary skill is inferred from `mounted_agents`, `required_tools`, or a projected agent set.
- Default project/global custom tools and default project/global MCP servers are referenced only through explicit `default/...` refs in `capability_projection`. They are not automatically exposed because they exist in the default maximum collection.
- Package manifests must not contain `default_for_new_projects` or any equivalent default-selection field. The default expert squad is the single repository/runtime default `general`, verified against a built-in package with `id = "general"`.
- The manifest schema is strict at every object level, not only the top level. Unknown nested fields such as old `capability_projection.scheduler.selector_refs`, `capability_projection.agents.build.selector_refs`, or misspelled MCP typed-ref fields are hard errors.
- A package cannot override built-in default definitions by name. It can only add namespaced expert-squad definitions.
- Duplicate expert-squad IDs across loaded package roots are hard errors.
- Duplicate display labels are allowed only because they are not identity.

## Default Collection And Specific Collection

OpenCorvus must represent three layers explicitly.

### Default Maximum Collection

The default maximum collection is what OpenCorvus supports before applying an active expert-squad projection:

- Built-in OpenCorvus global tools.
- Built-in role tool pools from `AgentToolPool`.
- Built-in and project/global ordinary skills.
- Project/global custom tools from existing config directories.
- Project/global MCP definitions from `Config.Info.mcp`.
- Built-in expert-squad packages shipped by OpenCorvus.

This layer is a catalog and validation source. It is not automatically visible to a model turn.

Default collection refs use explicit namespaces when a package wants to opt in:

| Default ref | Meaning |
| --- | --- |
| `default/skill/<skill_name>` | Project/global ordinary skill from the existing skill catalog. |
| `default/tool/<tool_name>` | Project/global custom tool from existing config directories. |
| `default/mcp/<server_id>` | Project/global MCP server from `Config.Info.mcp`. |
| `default/mcp/<server_id>/tool/<tool_name>` | Project/global MCP tool capability. |
| `default/mcp/<server_id>/prompt/<prompt_name>` | Project/global MCP prompt capability. |
| `default/mcp/<server_id>/resource/<resource_key>` | Project/global MCP resource capability. |

The existence of a default custom tool, ordinary skill, or MCP server never makes it visible by itself. The active package projection must reference it explicitly. `mounted_agents` and `required_tools` validate already-projected skills; they do not pull default skills into the effective set.

### Expert-Squad-Specific Collection

The expert-squad-specific collection is loaded from one package ID:

- `expert-squads/<id>/agents/<agent_id>/system.md`
- `expert-squads/<id>/agents/<agent_id>/skills/**/SKILL.md`
- `expert-squads/<id>/agents/<agent_id>/tools/*.{js,ts}`
- `expert-squads/<id>/agents/<agent_id>/mcp/*.jsonc`
- `expert-squads/<id>/skills/**/SKILL.md`
- `expert-squads/<id>/tools/*.{js,ts}`
- `expert-squads/<id>/mcp/*.jsonc`

This layer is exclusive to the package ID. It is not scanned into global registries and is not visible when another expert squad is active.

### Effective Runtime Collection

For a session, the effective collection is:

```text
effective(session) =
  OpenCorvus role_base for the current agent role
  union explicitly referenced project/global default refs
  union active expert-squad-specific refs for prompt_profile.active
  projected by PromptProfile capability for the current agent/runtime boundary
```

The union happens in the resolver, not in raw registry scanning. Inactive expert-squad definitions never enter the effective set.

`role_base` is the common foundation for an agent role. It is not the default maximum catalog and it is not a fallback. It is the explicit OpenCorvus-owned minimum runtime surface required for that role's lifecycle/reporting contract. The capability projection must still name every additional default/public-pool claim and every package-specific claim.

## ID Isolation Model

Every package-owned definition gets a stable canonical reference:

| Definition | Canonical reference |
| --- | --- |
| Expert squad | `<expert_squad_id>` |
| Agent-local prompt overlay | `<expert_squad_id>/<agent_id>/prompt` |
| Agent-local skill | `<expert_squad_id>/<agent_id>/<skill_name>` |
| Squad-level skill | `<expert_squad_id>/shared/<skill_name>` |
| Agent-local tool | `<expert_squad_id>/<agent_id>/<tool_name>` |
| Squad-level tool | `<expert_squad_id>/shared/<tool_name>` |
| Agent-local MCP server | `<expert_squad_id>/<agent_id>/<mcp_server_id>` |
| Squad-level MCP server | `<expert_squad_id>/shared/<mcp_server_id>` |
| Package MCP tool | `<expert_squad_id>/<agent_id>/<mcp_server_id>/tool/<tool_name>` |
| Package MCP prompt | `<expert_squad_id>/<agent_id>/<mcp_server_id>/prompt/<prompt_name>` |
| Package MCP resource | `<expert_squad_id>/<agent_id>/<mcp_server_id>/resource/<resource_key>` |
| Shared package MCP tool | `<expert_squad_id>/shared/<mcp_server_id>/tool/<tool_name>` |
| Shared package MCP prompt | `<expert_squad_id>/shared/<mcp_server_id>/prompt/<prompt_name>` |
| Shared package MCP resource | `<expert_squad_id>/shared/<mcp_server_id>/resource/<resource_key>` |
| Selector metadata | `selector/<expert_squad_id>` |
| Default ordinary skill | `default/skill/<skill_name>` |
| Default custom tool | `default/tool/<tool_name>` |
| Default MCP server | `default/mcp/<server_id>` |
| Default MCP tool | `default/mcp/<server_id>/tool/<tool_name>` |
| Default MCP prompt | `default/mcp/<server_id>/prompt/<prompt_name>` |
| Default MCP resource | `default/mcp/<server_id>/resource/<resource_key>` |

Display names can be duplicated. Canonical refs cannot.

Resolver rules:

- A session with `prompt_profile.active = "frontend-replica"` can resolve only canonical refs beginning with `frontend-replica/`, plus default collection refs.
- A session with `prompt_profile.active = "general"` resolves only the general role-base, explicitly projected default refs, any active `general` package refs, and the registry-generated selector catalog.
- Selector metadata is not an exception that makes inactive package definitions effective. It exposes only manifest `id`, label, summary, and selection guidance needed to call `select_expert_squad`.
- If a package references `other-squad/orchestrator/foo`, loading fails. Cross-squad references are not allowed.
- If two packages both contain `agents/orchestrator/tools/source-evidence.ts`, their canonical refs differ by package ID and do not collide.
- If a package's `id` is `frontend-replica-v2` and its label is `Frontend Replica`, it remains a separate squad from `frontend-replica`.

## PromptProfile Integration

`PromptProfile` remains the selection and prompt-composition boundary, but its catalog source changes.

New ownership:

- `ExpertSquadRegistry` loads built-in and project `.opencorvus/expert-squads/**` packages.
- `PromptProfile.catalog(config)` is backed by the resolved expert-squad registry.
- `PromptProfile.composeAgentPrompt()` consumes active package role overlays derived from `agents.<agent_id>.prompt`.
- `PromptProfile.effectiveCapability(config)` resolves the active package capability projection.
- `prompt_profile.active` stores the active expert-squad ID.
- `DEFAULT_PROMPT_PROFILE_ID` becomes `general`; package manifests cannot declare their own default.

Do not add an `expert_squad.active_id` field in this phase. A future rename is allowed only as an atomic replacement that removes `prompt_profile.active` everywhere in the same change.

Built-in expert squads:

- Built-in expert squads should be represented as package directories in the repository or generated into a package-shaped registry from embedded files.
- If embedded files are used, their runtime representation must still pass the same manifest parser and validation as `.opencorvus` package folders.
- TypeScript object literals must not remain a second registry that bypasses package validation.

Custom prompt profiles:

- Existing `prompt_profile.profiles` custom definitions are superseded by package manifests.
- Because compatibility fallback is forbidden, old custom profile configs without package manifests must fail with explicit errors during this refactor.
- If implementation needs a staged cleanup for local developer machines, it must be a documented manual migration, not automatic fallback.

## Tool Projection

Tool loading must be separated into default and active expert-squad registries.

Required implementation:

- Keep `AgentToolPool` as the maximum supported built-in tool catalog.
- Keep existing project/global custom tools as default collection entries.
- Expose default custom tools only when `capability_projection.scheduler.default_tool_refs` names them explicitly.
- Add an expert-squad tool loader that reads only the active package's tool refs for the current session.
- Do not scan `.opencorvus/expert-squads/**/tools` through the existing flat `ToolRegistry.state()`.
- Validate package tool refs at package load time.
- Project Orchestrator tools from `capability_projection.scheduler` before `toolGuard`, `enableMap`, and exact runtime contract installation.
- Project worker tools from `capability_projection.agents[<agent_id>]`. Ownership refs under `agents.<agent_id>.tool_refs` are definitions only and do not grant visibility.
- Exact runtime contract must include only projected tool names.
- LLM provider schema generation must receive only projected tool names and projected tool descriptions.
- Domain workflow dispatch tools must be authorized by active capability before worker sessions are created.

For built-in Orchestrator tools:

- `capability_projection.scheduler.built_in_tool_ids` lists built-in tool IDs.
- Unknown built-in IDs fail package validation.
- Workflow tool IDs derive dispatchable agents through `AgentRoleContract.orchestratorWorkflowToolName`.

For package tools:

- Package tool refs are canonical refs, not unscoped exported names.
- At runtime, package tools can be exposed with stable internal names derived from canonical refs.
- The provider-facing name must be deterministic and collision-free.
- Inactive package tools are neither imported nor offered to the model.

## Skill Projection

Skill loading must be profile-aware without creating a UI-only filter.

Required implementation:

- Keep default ordinary skill loading for `.opencorvus/skill(s)` and other existing skill roots.
- Add package skill loading through `ExpertSquadRegistry`, not through the flat ordinary skill catalog.
- `SkillMount.resolve()` receives the active resolved capability and returns only selector metadata, explicitly projected default skills, and active package skills.
- `SkillTool` uses the same projected skill surface.
- System prompt skill rendering uses the same projected skill surface.
- `/skill/mounts` includes active profile ID, capability profile ID, projection hash, projected tool IDs, projected agents, selector refs, projected default skill refs, projected package skill refs, and projected skill refs.
- `/skill/mounts` top-level `skills`, `matrix`, `project_mounts`, `unmounted_count`, and any future count fields must be computed from the same projected skill surface. Inactive package skills must not appear in any response field.
- Overlay must not apply an additional local filter to compensate for stale backend data.

Selector metadata:

- Selector metadata is generated by `ExpertSquadRegistry` from manifest `selector`, `id`, `label`, and `description`.
- It is visible guidance for choosing expert squads, but it is not ordinary production skill content and cannot load package `SKILL.md` files through `SkillTool`.
- `general` may expose selector metadata so the Orchestrator can choose an expert squad.
- Active expert squads expose projected production skills. Switching to another expert squad requires returning to the selector surface or using an explicit selector/catalog action backed by `ExpertSquadRegistry`; inactive package production skills remain hidden.
- A package that should not be Orchestrator-selectable must omit `selector` from the manifest. There is no `selector: false`, `selector.enabled`, or equivalent disable field in phase 1.

## MCP Projection

MCP loading must be explicit and expert-squad scoped.

Required implementation:

- Keep project/global `Config.Info.mcp` as the default MCP collection.
- Add expert-squad MCP definitions under the active package only.
- All MCP entry points must accept the same resolved scope or equivalent input. This includes tools, prompts, resources, server proxy lists, server proxy reads/calls, status, auth, connect, disconnect, and `callTool`.
- `MCP.tools()`, `MCP.prompts()`, `MCP.resources()`, `MCP.serverTools()`, `MCP.serverPrompts()`, and `MCP.serverResources()` must not connect or list inactive package MCP servers.
- Package MCP server refs are canonical and include expert-squad ID.
- MCP connection keys, status keys, auth/cache keys, provider-facing tool keys, server proxy keys, prompt/resource keys, and `callTool` lookup keys must include project ID and the complete canonical MCP server ref, such as `frontend-replica/orchestrator/browser` or `frontend-replica/shared/browser`.
- Expert-squad ID plus bare MCP server ID is insufficient because agent-local and shared servers may share display IDs inside one package.
- Provider-facing MCP names may be sanitized for model compatibility, but their source key must be derived from the complete canonical MCP server ref plus the typed capability segment. The reverse mapping used by proxy and `callTool` must resolve to exactly one active scoped MCP capability.
- `capability_projection.scheduler` and `capability_projection.agents[<agent_id>]` MCP refs control what MCP enters the effective runtime.
- Server refs grant the whole MCP server within that scope. Tool, prompt, and resource refs grant only the named typed capability.
- Package MCP definition files must statically declare the tool, prompt, and resource capability keys that package typed refs may target. Package typed refs are validated against those declarations without connecting inactive MCP servers.
- Default MCP typed refs are validated only when they are part of the active resolved scope. An unknown default MCP capability fails that active resolution visibly; it does not trigger inactive package MCP connections.
- Typed fields are required for both default and package MCP:
  - `default_mcp_tool_refs`
  - `package_mcp_tool_refs`
  - `default_mcp_prompt_refs`
  - `package_mcp_prompt_refs`
  - `default_mcp_resource_refs`
  - `package_mcp_resource_refs`
- `general` must explicitly expose no MCP unless a future design gives it a reason.
- Failed inactive MCP definitions must not break unrelated active squads. Failed active MCP definitions are hard errors for that active capability.
- MCP status/auth/connect/disconnect routes must require an expert-squad scope for package MCP servers and must reject name-only access to inactive package MCP servers.

This replaces the earlier coarse `include_mcp_tools` boolean. A boolean may remain in runtime contracts as a low-level provider switch, but package semantics must be server/tool specific.

## Agent Prompt And Communication README

`README.md` is required for every expert-squad package.

Runtime meaning:

- The root `README.md` is the active expert-squad communication overview for the Orchestrator.
- It is appended only when `prompt_profile.active` equals this package's manifest `id`.
- It is not used to discover/select inactive squads; inactive discovery uses manifest selector metadata and optional top-level `selector.md`.
- `agents/orchestrator/system.md` remains the active Orchestrator behavior overlay, while README explains the squad-wide communication map.
- README content must come from the canonical package root's top-level `README.md`, not from an arbitrary manifest path, agent production file, folder name, or ZIP name.

It must document:

- The squad purpose.
- The agent communication relationship.
- Which agents are selectors, planners, executors, reviewers, or evidence consumers.
- Which tools/skills/MCP definitions are squad-owned.
- Which default OpenCorvus capabilities the squad expects.
- Any profile-selection or continuation behavior the Orchestrator should show visibly.

`system.md` rules:

- For built-in OpenCorvus roles, `system.md` is an expert-squad role overlay. It does not replace core system contracts, lifecycle obligations, or tool-use safety constraints.
- Phase 1 does not support package-defined custom agents. Unknown agent folders fail package validation.
- Overlays must be role-scoped and must not duplicate broad workflow wrappers across every role.
- Abbreviations used in prompts must be expanded when introduced.

## Folder And ZIP Load

The runtime source is always the canonical unpacked folder.

Folder import:

1. Read a selected local folder.
2. Normalize every manifest-declared path and prove it stays inside the selected package root.
3. Validate `expert-squad.jsonc`, `README.md`, paths, IDs, and refs.
4. Copy or materialize it to `.opencorvus/expert-squads/<id>/`.
5. Revalidate from the target folder and prove every resolved path stays inside `.opencorvus/expert-squads/<id>/`.
6. Reload the expert-squad registry.

ZIP import:

1. Read the ZIP with the existing `@zip.js/zip.js` parser.
2. Reject absolute paths, `..`, Windows drive prefixes, symlinks if unsupported, and duplicate normalized paths.
3. Normalize a single package root.
4. Normalize every manifest-declared path and prove it stays inside the normalized package root.
5. Validate `expert-squad.jsonc`, `README.md`, paths, IDs, and refs.
6. Extract to `.opencorvus/expert-squads/<id>/`.
7. Revalidate from the target folder and prove every resolved path stays inside `.opencorvus/expert-squads/<id>/`.
8. Reload the expert-squad registry.

Archive format:

- The canonical compressed format for expert-squad packages is ZIP.
- Tar/gzip is not part of this design because current production import support is ZIP and remote Linux tar/gzip packaging is unrelated.
- Supporting multiple archive formats later would require a separate design and tests; it must not be implemented as extension fallback.

Pack:

- Read `.opencorvus/expert-squads/<id>/`.
- Validate the folder.
- Produce a ZIP containing exactly one package root named `<id>/`.
- Exclude `.opencorvus/r`, runtime outputs, caches, logs, and generated archives.
- Include manifest, README, prompts, skills, tools, MCP definitions, and declared package assets.

Unpack:

- Unpack is the same as ZIP import into the canonical folder.
- If the target ID already exists, import must fail unless the caller explicitly requests replacement and the replacement path is validated first.
- Replacement must be atomic enough that a failed import leaves the old package intact.

## Runtime Flow

Orchestrator wake:

1. Resolve task root session effective config.
2. Read `prompt_profile.active`.
3. Resolve active expert-squad package and capability projection.
4. Build the Orchestrator canonical raw tool map.
5. Project raw tools by active capability.
6. Add active package tools allowed by active capability.
7. Wrap decision metadata.
8. Apply `toolGuard`.
9. Build `enableMap` from projected keys.
10. Install the projected exact runtime contract.
11. Render prompt overlays and skill text from the same active package/capability.

Runtime contract fields:

- Orchestrator and worker session runtime contracts must carry `expertSquadID`, `capabilityHash`, projected built-in tool IDs, projected default tool refs, projected package tool refs, projected skill refs, projected MCP refs, and package version.
- The Orchestrator runtime contract is sourced from `capability_projection.scheduler`.
- Worker runtime contracts are sourced from `capability_projection.agents[<agent_id>]`.
- If the scheduler projection exposes a workflow dispatch tool for a worker role, the manifest must include the corresponding worker projection. The dispatch tool must fail visibly if the projection is missing or stale.
- Non-Orchestrator workers must not receive default `ToolRegistry.tools()` or default `MCP` backfill outside their projected contract. If they need a default custom tool or MCP server, the active package projection must name it explicitly.
- `SessionLoop` must use the runtime contract scope when resolving tools, skills, MCP tools, MCP prompts, and MCP resources.
- A missing scope on a worker session that requires expert-squad projection is an error, not a reason to fall back to global registry behavior.

Selection:

- `select_expert_squad` validates the target ID through `ExpertSquadRegistry`.
- It writes only `{ prompt_profile: { active: "<id>" } }`.
- It records previous ID, next ID, capability hash, and package source in visible task/session evidence.
- It schedules or requests a visible continuation wake because the current LLM call cannot mutate its own tool table.
- It does not write tools, MCP, permissions, model settings, workflow state, or prompt text into session overlay.

Worker dispatch:

- Dispatch tools check active capability before creating worker sessions.
- Worker descriptors and runtime contracts record `expertSquadID`, `capabilityHash`, projected refs, and package version.
- Retries or continuations with stale capability hashes fail visibly instead of being silently reinterpreted under a new active squad.

## API And UI Surfaces

Backend routes to add or update:

- `GET /config/prompt-profile` or successor: returns expert-squad-backed catalog and active ID.
  - Inactive catalog entries return only selector/display metadata: manifest ID, label, description, selector summary, and selection guidance.
  - Capability refs, package source paths, projection hash, and capability summary are returned only for the active session projection.
- `GET /skill/mounts`: returns the same active ID and projection hash as the prompt-profile catalog.
- `POST /expert-squad/import-folder`: imports a local package folder into the canonical directory.
- `POST /expert-squad/import-file`: imports a ZIP package into the canonical directory.
- `POST /expert-squad/export`: packs a canonical package folder into a ZIP.
- `DELETE /expert-squad/:id`: deletes a package only after confirming no persisted config, session overlay, or live session references it as `prompt_profile.active`; otherwise it fails visibly with the referencing records listed.

Route rules:

- Project-scoped routes continue to require explicit directory query/header injection.
- Routes never infer package ID from ZIP filename or folder display name.
- Routes return precise validation errors. They do not silently skip invalid package parts.
- Route schemas must be reflected in SDK/OpenAPI snapshots.
- New `/expert-squad/*` routes must be added to the shared transport protocol directory-scope contract tests and server app route directory-parameter tests, not only overlay API injection tests.
- Delete must not auto-switch the active profile to `general`. If the package is active anywhere, deletion is rejected.

Overlay changes:

- Prompt Catalog displays expert squads from backend catalog, not hardcoded profile IDs.
- Skill Matrix and Prompt Catalog use the same session scope and projection hash.
- UI cache keys include project directory, session ID, active expert-squad ID, and projection hash.
- Display names are labels only; all actions send manifest ID.
- Import UI shows manifest ID and source path before committing.
- There is no local-only filter that can make unavailable skills look available.

## Implementation Plan

1. Add package schema and registry.
   - Create `packages/opencorvus/src/expert-squad/` or equivalent.
   - Parse `expert-squad.jsonc`.
   - Validate IDs, required README, package paths, refs, role IDs, tool IDs, skill refs, MCP refs, and duplicate IDs.
   - Reject package-defined custom agents in phase 1.
   - Reject manifest paths that normalize outside the package root for folder and ZIP imports.
   - Reject unknown package fields at every manifest object level.

2. Migrate built-in expert squads into package-shaped definitions.
   - Represent `general`, `frontend-replica`, `frontend-innovate`, `frontend-automation-debug`, `backend`, and `algorithm` through the same parser.
   - Completed in phase 4: replace TypeScript-only PromptProfile built-in prompt bodies with clear-text package files.
   - Completed in phase 4: delete hardcoded expert-squad skill imports that duplicate package selectors.

3. Replace custom profile config with package manifests.
   - Remove `prompt_profile.profiles` as a runtime source, or make it fail with a clear migration error.
   - Keep `prompt_profile.active` as the single active ID.

4. Implement capability projection.
   - Resolve prompt overlays, scheduler tools, package tools, skills, MCP servers, projected agents, capability hash, and package version from one active package.
   - Resolve default custom tool refs, default ordinary skill refs, and default MCP refs only when named explicitly.
   - Resolve Orchestrator projection from `capability_projection.scheduler`.
   - Resolve worker projection from `capability_projection.agents[<agent_id>]`.
   - Validate every scheduler workflow dispatch tool has a matching worker projection.
   - Keep selector metadata outside `capability_projection`; the selector catalog is generated by `ExpertSquadRegistry`.
   - Derive dispatchable agents from workflow tools through `AgentRoleContract`.

5. Project Orchestrator exact runtime tools.
   - Filter before decision metadata wrapping and `toolGuard`.
   - Install only projected tools.
   - Update `select_expert_squad` visible continuation behavior.
   - Remove direct profile-specific checks such as frontend-innovate-only metadata peeking.
   - Extend worker runtime contracts with expert-squad scope and prevent default registry/MCP backfill outside the projection.

6. Scope tool registry.
   - Keep flat default custom tools unchanged.
   - Add active package tool loader.
   - Ensure inactive package tools are not imported or exposed.

7. Scope skill registry and skill mounts.
   - Keep ordinary skills unchanged.
   - Load package skills through `ExpertSquadRegistry`.
   - Generate selector metadata from package manifests instead of loading inactive package `SKILL.md` files.
   - Make `SkillMount.resolve`, `SkillTool`, and prompt skill rendering consume one projected skill surface.

8. Scope MCP.
   - Add package MCP parser.
   - Require package MCP definitions to statically declare typed tool, prompt, and resource capability keys.
   - Add active-scope MCP tool resolution.
   - Apply the same scope to MCP prompts, resources, server proxy operations, status, auth, connect, disconnect, and calls.
   - Include the complete canonical MCP server ref in all MCP runtime keys: connection, status, auth/cache, provider-facing tool, proxy, prompt/resource, and `callTool` lookup.
   - Make inactive MCP definitions inert.

9. Add import/export routes.
   - Reuse existing ZIP parser and path validation patterns from skill import.
   - Normalize folder and ZIP imports into `.opencorvus/expert-squads/<id>/`.
   - Add pack/export ZIP route.

10. Update overlay and SDK.
    - Add catalog/matrix fields.
    - Remove hardcoded `frontend-replica` initial state.
    - Use manifest ID for all actions.
    - Update OpenAPI and SDK snapshots.

11. Update current architecture docs.
    - Amend prompt-only records in current architecture.
    - Keep historical records historical.
    - Link this design as the dynamic-loading successor to the 2026-07-03 capability-profile record.

## Test Plan

Focused backend tests:

- `bun test packages/opencorvus/test/expert-squad/registry.test.ts`
  - Loads valid folder package.
  - Loads valid ZIP package.
  - Rejects missing manifest, missing README, ID/folder mismatch, duplicate ID, unknown fields at every manifest object level, unknown role, unknown tool ID, unknown skill ref, unknown MCP ref, and cross-squad ref.
  - Rejects stale or misspelled nested fields including `capability_projection.scheduler.selector_refs`, `capability_projection.agents.build.selector_refs`, and misspelled MCP typed-ref fields.
  - Rejects package-defined custom agents in phase 1.
  - Rejects runtime path entries and manifest-declared paths that escape the package root for both folder import and ZIP import.
  - Confirms display-label duplicates do not affect identity.
  - Confirms ZIP filename, source folder name, project display name, project ID, skill name, and MCP server name do not determine expert-squad identity.
  - Confirms selector metadata is generated from manifest fields and cannot load inactive package `SKILL.md` content.
  - Confirms packages without `selector` do not enter the selector catalog and that `selector: false` / `selector.enabled` are rejected by strict schema.
  - Confirms every scheduler workflow tool has a matching worker projection.
  - Confirms package MCP typed refs validate against static package MCP declarations without connecting inactive MCP servers.
- `bun test packages/opencorvus/test/expert-squad/package-routes.test.ts`
  - Import folder, import ZIP, export ZIP, and delete flows.
  - Explicit directory scoping.
  - Path traversal and duplicate normalized ZIP path rejection.
  - Replacement failure leaves old package intact.
  - Delete rejects packages referenced by persisted config, session overlay, or live session `prompt_profile.active`.
  - Delete does not auto-switch any active reference to `general`.
- `bun test packages/opencorvus/test/agent/prompt-profile.test.ts`
  - Catalog is backed by expert-squad packages.
  - Default active profile is `general`.
  - `prompt_profile.active` equals expert-squad ID.
  - Old `prompt_profile.profiles` runtime source is rejected with explicit error.
  - Prompt overlays remain role-scoped.
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts`
  - General exact runtime contract excludes domain workflow tools.
  - Selecting an expert squad writes only `prompt_profile.active` and creates visible continuation evidence.
  - Next wake installs projected tools.
  - Unknown ID rejects.
- `bun test packages/opencorvus/test/agent/agent.test.ts`
  - Built-in role maximum tool catalog remains stable.
  - Effective Orchestrator runtime differs by active expert squad.
  - Dispatchable agents derive from projected workflow tools.
  - LLM provider tool schema generation receives only projected tool names/descriptions.
  - System prompt skill text excludes inactive package skills and unprojected default skills.
- `bun test packages/opencorvus/test/session/extra-tools.test.ts`
  - Exact runtime contract does not leak default registry or inactive MCP.
  - Worker runtime contracts carry `expertSquadID`, `capabilityHash`, projected tool refs, projected skill refs, and projected MCP refs.
  - Build worker receives only refs from `capability_projection.agents.build`, not ownership-only `agents.build.*_refs`.
  - Non-Orchestrator workers do not receive default registry/MCP backfill outside the projection.
  - Capability hash binds retries and continuations.
- `bun test packages/opencorvus/test/tool/registry.test.ts`
  - Active package tools are visible only under active ID.
  - Inactive package tools are not imported/exposed.
  - Default custom tools are visible only when the active projection names `default/tool/<tool_name>`.
  - Conflicting provider-facing names remain collision-free through canonical refs.
- `bun test packages/opencorvus/test/skill/skill.test.ts`
  - Package skills do not enter the flat ordinary skill catalog.
  - Selector metadata and production skill refs validate against package manifests.
  - Default ordinary skills are visible only when the active projection names `default/skill/<skill_name>`.
- `bun test packages/opencorvus/test/tool/skill.test.ts`
  - `skill` tool searches only projected skills for the current session.
  - General sees selector metadata but cannot load inactive package production `SKILL.md` content.
- `bun test packages/opencorvus/test/server/skill-routes.test.ts`
  - `/skill/mounts` returns active ID, projection hash, projected tools, projected agents, selector refs, projected default skill refs, and projected package skill refs.
  - `/skill/mounts` top-level `skills`, `matrix`, `project_mounts`, `unmounted_count`, and all counts exclude inactive package skills.
- `bun test packages/opencorvus/test/server/config-routes.test.ts`
  - Prompt profile catalog exposes only selector/display metadata for inactive packages.
  - Capability refs, package source paths, projection hash, and capability summary appear only for the active session projection.
- `bun test packages/opencorvus/test/mcp/expert-squad.test.ts`
  - Active package MCP connects only when projected.
  - Inactive package MCP does not connect.
  - Inactive package MCP tools, prompts, resources, server proxy lists, status, auth, connect, disconnect, and `callTool` are unavailable.
  - Default MCP servers and capabilities are visible only when the active projection names `default/mcp/...` refs.
  - Typed MCP refs authorize tools, prompts, and resources independently for default and package MCP servers.
  - Unknown default MCP typed refs fail only active-scope resolution; they do not force inactive package MCP connections.
  - Connection keys, status keys, auth/cache keys, provider-facing tool keys, server proxy keys, prompt/resource keys, and `callTool` lookup keys include project ID plus complete canonical MCP server ref.
  - Agent-local and shared package MCP servers with the same display ID and same tool/prompt/resource names do not collide and resolve to exactly one active scoped capability.
- `bun test packages/transport-protocol/test/contract.test.ts`
  - New `/expert-squad/*` routes follow the shared directory-scope route contract.
- `bun test packages/opencorvus/test/server/app-routes.test.ts`
  - New `/expert-squad/*` routes expose required directory parameters in OpenAPI route metadata.
- `bun test packages/opencorvus/test/acceptance/runtime-path-filter.test.ts`
  - Runtime paths are excluded from package export/import scans.

Focused overlay tests:

- `bun test packages/overlay/test/prompt-profile-config.test.ts`
  - Profile UI uses manifest IDs and package metadata.
- `bun test packages/overlay/test/extensions-service.test.ts`
  - Service types include active ID, projection hash, projected tools, projected agents, and package refs.
- `bun test packages/overlay/test/prompt-profile-task-session-owner.test.ts`
  - Prompt Catalog and Skill Matrix use the same session scope.
- `bun test packages/overlay/test/browser/prompt-profile-panel.test.ts`
  - Activation reloads the skill matrix with the same projection hash.
- `bun test packages/overlay/test/api-directory-injection.test.ts`
  - New routes keep explicit directory injection.

Docs/schema validation:

- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/overlay typecheck`
- `bun run api:routes-check`
- `bun run docs:check`
- `git diff --check`

## Implementation Progress

Phase 1 registry foundation, 2026-07-03:

- Added `ExpertSquadRegistry` as the first parser/validator for canonical folders under `.opencorvus/expert-squads/<expert_squad_id>/`.
- Added strict manifest parsing for nested objects, manifest-ID/folder-ID matching, canonical `README.md`, known `AgentRoleContract` roles, package refs, default refs, typed MCP refs, and scheduler workflow tool to worker projection consistency.
- Added package root validation so runtime-internal entries and unknown top-level package entries are rejected instead of imported.
- Added recursive `skills/**/SKILL.md` package skill discovery while keeping selector metadata manifest-derived rather than skill-content-derived.
- Split canonical package loading from source package validation so folder/ZIP import can validate manifest identity before copying into `.opencorvus/expert-squads/<id>/`.
- Tightened manifest path safety to reject raw `.` / `..` segments, Windows drive prefixes, backslashes, and intermediate symlink escapes.
- Tightened projection validation so agent-local refs must be declared by the same agent, while shared refs remain package-level.
- Tightened default MCP server refs and package MCP typed capability names so canonical refs remain unambiguous.
- Split metadata discovery from active package loading so selector/catalog discovery does not parse inactive package MCP definitions.
- Kept inactive discovery output to display and selector metadata only; package source paths remain active-load data.
- Rejected empty tool and MCP server canonical ref segments such as `.ts`, `.js`, `.json`, and `.jsonc` file names.
- Added whole-package recursive validation for symlinks and runtime-internal entries, including directories not otherwise traversed for capabilities.
- Required `agents.<agent_id>.*_refs` ownership declarations themselves to point only at shared refs or that same agent's local refs.
- Added focused registry tests in `packages/opencorvus/test/expert-squad/registry.test.ts`.

Phase 2 package manager foundation, 2026-07-03:

- Added `ExpertSquadPackageManager` for folder import, ZIP import, and ZIP export at the service layer.
- Folder and ZIP import normalize source packages through `ExpertSquadRegistry.loadSourcePackage()` before installing to `.opencorvus/expert-squads/<manifest id>/`, then validate the installed canonical folder with `loadPackage()`.
- ZIP import uses per-entry validation through `zip.js`, rejects traversal, POSIX absolute paths, Windows drive paths, colon paths, duplicate normalized entries, case collisions, and file/directory collisions.
- Import staging and replacement backup directories live under `.opencorvus/expert-squad-staging/`, outside the `.opencorvus/expert-squads/` discovery catalog.
- Replacement is explicit via `replace`; failed replacement restores the previous package or surfaces a restore failure instead of silently swallowing it.
- Import refuses source directories inside OpenCorvus runtime storage such as `.opencorvus/r`.
- Export validates the requested ID through the registry ID schema, loads the canonical package, rejects symlink/runtime entries, writes stable ZIP paths under the single `<id>/` package root, and names archives from manifest ID only.
- Import/export tests live in `packages/opencorvus/test/expert-squad/package-manager.test.ts`.
- Independent package-manager review found and drove fixes for staging/backup catalog pollution, export path traversal, restore failure swallowing, runtime filter duplication, active-selection mutation risk, concurrent replace serialization, ZIP colon path rejection, and export wrapper contract alignment.

Phase 3 import/export routes, 2026-07-03:

- Added project-scoped `/expert-squad/import-folder`, `/expert-squad/import-file`, and `/expert-squad/export` routes on top of `ExpertSquadPackageManager`.
- Routes use `Instance.directory` as the only project directory source and reject body-level `projectDirectory` overrides through strict request schemas.
- Package validation failures are surfaced as `ExpertSquadPackageError` with HTTP 400 instead of generic 500 responses.
- Route tests cover real `?directory=` project injection, ZIP import/export round trip, invalid archive error mapping, and project-directory override rejection across all three routes in `packages/opencorvus/test/server/expert-squad-routes.test.ts`.
- `routeRequiresProjectDirectory` and OpenAPI directory-query tests now explicitly cover `/expert-squad/*`.
- Independent route review found no route-scope blocker and drove the real `?directory=` plus all-route body override coverage fixes.
- Independent package-security review found first-install cleanup and ZIP resource-limit blockers. The package manager now rejects staging manifest ID changes before moving, removes a newly moved first-install target if final validation fails, and applies explicit archive base64, decoded archive, entry count, per-file, and total unpacked byte limits.
- A second package-security review found and drove fixes for replace rollback after post-move validation failure and for enforcing actual decompressed bytes through a bounded ZIP writer instead of only after full materialization.
- Package-manager tests now cover first-install cleanup after post-move validation failure, replace rollback after post-move validation failure, staging manifest ID changes, and ZIP archive resource-limit rejection.

Phase 4 built-in package source, 2026-07-03:

- Moved built-in expert-squad prompt-profile text out of the inline `PromptProfile.builtIns` TypeScript object into clear-text package directories under `packages/opencorvus/src/expert-squad/builtin/<expert_squad_id>/`.
- Each built-in package now has `expert-squad.jsonc`, `README.md`, and per-agent `agents/<agent_id>/system.md` files where that built-in profile contributes an overlay.
- `PromptProfile.builtIns` now derives synchronously from embedded built-in package sources through `ExpertSquadRegistry.loadEmbeddedPackage()` instead of owning the prompt text directly.
- `ExpertSquadRegistry` exposes the same manifest parser for embedded and filesystem-backed packages, with embedded checks for manifest ID, README presence, known agent roles, safe prompt paths, and prompt file presence.
- Registry tests now materialize every embedded built-in package into a temporary `.opencorvus/expert-squads/<id>/` directory and load it through `ExpertSquadRegistry.loadPackage()` so built-ins must pass the filesystem package parser.
- Moved built-in selector instructions into each selectable package's `selector.md`, declared by `selector.instructions` in `expert-squad.jsonc`.
- Deleted the old `packages/opencorvus/src/skill/builtin/*-expert-squad.md` files; visible Orchestrator selector skills now derive from embedded package manifests through `ExpertSquadRegistry.renderSelectorSkillMarkdown()`.
- Filesystem package loading now accepts manifest-declared top-level `selector.md` and validates `selector.instructions` as a real non-blank file, so embedded and disk packages share the same selector-instruction contract.
- Updated prompt-profile, desktop-only, skill registry, skill tool, Orchestrator, role-contract, and registry tests to consume generated selector skill sources rather than old markdown paths.
- Focused validation passed for registry loading, package manager import/export, expert-squad routes, prompt-profile catalog, built-in skill materialization, skill tool loading, agent tool contracts, role-contract catalog prompts, config routes, core prompt hygiene, Orchestrator selector flow, session exact-tool preservation, and `packages/opencorvus` typecheck.

Phase 5 planned boundary, 2026-07-03:

- Remove `prompt_profile.profiles` as a project custom prompt-profile source before wiring runtime projection.
- Keep `prompt_profile.active` as the only active expert-squad ID field and keep task, mission, session, and `select_expert_squad` writes active-only.
- Do not load project package folders through synchronous `PromptProfile` APIs in this phase; project package-backed catalog/projection remains the next runtime resolver phase.
- Remove overlay custom prompt-profile create, duplicate, save, delete, and JSON import entry points so the UI no longer writes a rejected config shape.
- Update tests to prove `prompt_profile.profiles` is rejected and that the catalog is built-in package-backed only until the project package resolver lands.

Phase 5 implementation, 2026-07-03:

- `PromptProfileConfigSchema` now accepts only `prompt_profile.active`; `prompt_profile.profiles` is rejected by the strict config schema and is no longer exposed in generated OpenAPI or SDK types.
- `PromptProfile.catalog()` now returns only built-in package-backed prompt profiles from `builtInPromptProfiles`; it no longer merges project custom profile definitions.
- Removed the prompt-profile JSON import parser and custom profile validation/write helpers from backend and overlay surfaces.
- Replaced the overlay PromptCatalog editor with a read-only package-backed expert-squad selector that only writes `prompt_profile.active` for project or session scope.
- Updated overlay i18n and source-level tests so create, duplicate, save, delete, import, metadata editing, and textarea editing cannot silently reappear.
- Regenerated SDK OpenAPI/types and public API markdown after the config schema and route description changed.
- Visual verification used the Node-owned browser runner for `packages/overlay/test/browser/prompt-profile-panel.test.ts`, with screenshots at `packages/overlay/.scratch/prompt-profile-settings-readonly.png` and `packages/overlay/.scratch/prompt-profile-list-row-focus.png`; manual review confirmed the read-only profile list, active badges, action strip, and guidance cards render without overlap or blank content.
- Validation passed:
  - `bun test --timeout 60000 packages/opencorvus/test/agent/prompt-profile.test.ts packages/opencorvus/test/server/config-routes.test.ts packages/opencorvus/test/expert-squad/package-manager.test.ts`
  - `bun test --timeout 60000 packages/overlay/test/prompt-profile-config.test.ts packages/overlay/test/prompt-catalog-save.test.ts packages/overlay/test/composer-textarea-unification.test.ts packages/overlay/test/config-panel-sizing.test.ts`
  - `bun run --cwd packages/opencorvus typecheck`
  - `bun run --cwd packages/overlay typecheck`
  - `bun run --cwd packages/sdk/js typecheck`
  - `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts`
  - `bun run --cwd packages/overlay test:browser test/browser/prompt-profile-panel.test.ts`
  - `bun run overlay:i18n-check`
  - `bun run typecheck`
  - `bun run api:routes-check`
  - `bun run docs:check`
  - `git diff --check`

Still pending:

- Wiring project package-backed prompt-profile catalog and prompt-overlay resolution after `prompt_profile.profiles` removal.
- Wiring active projection into Orchestrator runtime tools, worker runtime contracts, skill mounts, custom tools, MCP, routes, SDK, and overlay.
- Implementing delete/reference-audit service support before adding `DELETE /expert-squad/:id`; delete route must not perform its own separate config/session lookup logic.

Phase 6 planned boundary, 2026-07-04:

- Implement project package-backed prompt-profile resolution, not capability projection.
- Make canonical `.opencorvus/expert-squads/<expert_squad_id>` packages appear in `/config/prompt-profile` as read-only package-backed profiles with role prompt overlays loaded from each package's agent prompt files.
- Allow `prompt_profile.active` to reference a validated project package ID in the owning project/session directory.
- Compose project package role prompt overlays in Orchestrator, worker agents, direct session LLM calls, external Build executor prompts, and prompt preview surfaces.
- Keep `prompt_profile.active` as the only active expert-squad state field.
- Keep `Config.Info` responsible only for static shape and ID syntax; known-ID validation must move to async boundaries with project/session context.
- Reject project package IDs that collide with built-in package IDs. Do not choose precedence between built-in and project sources.
- Do not materialize project package selector metadata as mounted skills in this phase.
- Do not scan, register, or expose project package tool refs, skill refs, MCP server/tool/prompt/resource refs, workflow tools, projected agents, projection hashes, source paths, or capability summaries.
- Tests must prove package prompt-profile catalog/active selection works while package tool/skill/MCP capability refs remain inert.

Phase 6 implementation inventory, 2026-07-04:

| Surface | Implemented action |
| --- | --- |
| `packages/opencorvus/src/expert-squad/registry.ts` | Exposes filesystem package prompt-profile loading through the existing manifest/path parser; prompt files are read through manifest-declared safe paths instead of a duplicate parser. |
| `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts` | Adds an async project-aware resolver for catalog, active validation, overlay resolution, and prompt composition. |
| `packages/opencorvus/src/agent/prompt-profile.ts` | Keeps sync built-in-only APIs for static built-in tests; project packages are not loaded through this sync path. |
| `packages/opencorvus/src/config/config.ts` | Removes built-ins-only known-ID validation from `Config.Info`; `prompt_profile.active` keeps syntax-only validation. |
| `/config` and `/config/prompt-profile` routes | Validate active IDs with the project-aware resolver and return built-in plus project package-backed catalog entries. |
| Session, Mission, Task API, and `select_expert_squad` write paths | Replace sync `PromptProfile.assertKnownProfileID` with project/session-aware resolver validation. |
| Orchestrator, Agent runner, Session LLM, Build external executor, PromptCatalog preview | Use project-aware prompt composition for active package overlays. |
| SkillMount, SkillTool, SystemPrompt skills, ToolRegistry, MCP | Preserve current behavior; negative tests prove project package capability refs do not leak before runtime projection lands. |

Phase 6 validation, 2026-07-04:

- `bun test packages/opencorvus/test/server/config-routes.test.ts -t "project package prompt profile|unknown prompt profile"`
- `bun test packages/opencorvus/test/server/session-routes.test.ts -t "prompt profile"`
- `bun test packages/opencorvus/test/mission/wake-route.test.ts -t "prompt profile"`
- `bun test packages/opencorvus/test/server/task-create-route.test.ts -t "prompt profile"`
- `bun test packages/opencorvus/test/server/task-message-routes.test.ts -t "prompt profile"`
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "select_expert_squad"`
- `bun test packages/opencorvus/test/tool/skill.test.ts -t "active project package"`
- `bun test packages/opencorvus/test/session/prompt-final-input.test.ts`
- `bun test packages/opencorvus/test/agent/runner-prompt.test.ts -t "runAgentSession appends"`
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/expert-squad/package-manager.test.ts packages/opencorvus/test/server/expert-squad-routes.test.ts packages/opencorvus/test/agent/prompt-profile.test.ts packages/opencorvus/test/build-agent/external-system.test.ts packages/opencorvus/test/session/prompt-final-input.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`
- `git diff --check`

The route write-path tests were run as individual files to avoid shared fixture reset races masking project/session directory behavior.

Phase 6 independent investigation feedback, 2026-07-04:

- Socrates found that a catalog-only change is unsafe because active writes already flow into prompt composition; accepting a project package ID without prompt overlay resolution would create a broken active state. Socrates recommended a new async project-aware resolver and warned that project packages currently can collide with built-in IDs, which must be rejected instead of resolved by precedence.
- Ptolemy found no current production call site that treats a prompt-profile catalog entry as proof that tool/MCP/skill projection is wired, but identified adjacent leakage risks. Ptolemy required negative tests proving project packages do not appear in mounted skills, `SkillTool`, `SystemPrompt.skills`, `ToolRegistry`, Orchestrator exact runtime tools, MCP status/tools/prompts/resources/proxy/auth/connect/disconnect/call paths, or catalog capability fields.
- Both reviewers agreed that this phase is prompt-profile and prompt-overlay resolution only. Runtime capability projection remains pending and must not be partially implemented through UI filtering, selector skill materialization, or registry scans.

## Open Risks For Review

1. Keeping `prompt_profile.active` as expert-squad ID is the least disruptive single source, but the UI language must make clear that the user-facing entity is now an expert squad package.
2. Replacing `prompt_profile.profiles` with package manifests will break old local custom profiles by design. The implementation needs explicit errors and a manual migration note, not compatibility code.
3. Built-in packages now pass the same parser as project packages. Future built-in changes must keep clear-text package files as the source and must not reintroduce TypeScript-owned prompt or selector bodies.
4. Package tool names need provider-safe names. The mapping from canonical refs to provider names must be deterministic, reversible for logs, and collision-free.
5. Active MCP projection requires changing the current flat MCP shape across tools, prompts, resources, proxy, auth, status, connect, disconnect, and call paths. Partial implementation would leak inactive MCP capabilities.
6. Import replacement needs careful atomicity. A failed package import must not corrupt the current package folder.
7. Worker retries and continuations need capability hash binding or profile changes will silently reinterpret queued work.
8. Current architecture docs still contain older prompt-only assumptions. They must be updated when implementation lands, not left as competing current truth.
9. Package-defined custom agents are intentionally deferred. Adding them later must not reuse this phase's known-role resolver as a hidden custom-agent fallback.
10. Selector metadata must stay a small manifest-derived selection surface. If it grows into ordinary skill content, inactive package isolation is broken.

## Independent Review Iterations

This section must be updated after each review loop.

Initial investigation:

- Kuhn, Feynman, and Boole completed independent read-only investigations.
- Their consensus findings are recorded in the Recall section above.

Review loop 1:

- Kuhn found prompt overlay double-source risk in the manifest, selector ref/layout mismatch, `default_for_new_projects` as a second default source, unsupported custom package agents, and missing tests for system prompt skill leakage plus provider tool schema projection.
- Boole found the selector ref/layout mismatch, missing manifest path containment rules for folder import, incomplete route directory-scope tests, and insufficient terminology separation between project ID, project name, manifest ID, package ID, ZIP filename, and skill name.
- Feynman found MCP scoping too narrow, worker session runtime contracts not bound to projection, `/skill/mounts` top-level fields not explicitly projected, default custom tool/MCP opt-in missing, and package custom agents lacking a runtime resolver.
- Revisions applied:
  - `agents.<agent_id>.prompt` is now the only authored prompt overlay source; `prompt_profile.agents` was removed from the manifest example.
  - The initial selector skill path mismatch was removed by replacing selector skill files with manifest-derived selector metadata.
  - `default_for_new_projects` is forbidden in package manifests; `general` remains the single runtime default.
  - Phase 1 rejects package-defined custom agents.
  - Manifest path containment is required for folder and ZIP imports.
  - Default custom tool, default ordinary skill, and default MCP refs require explicit `default/...` projection refs.
  - MCP scope covers tools, prompts, resources, server proxy, status, auth, connect, disconnect, and call paths.
  - Worker runtime contracts must carry expert-squad scope and cannot receive global registry/MCP backfill outside projection.
  - `/skill/mounts` top-level fields must come from the same projected surface.
  - Tests now include system prompt skill leakage, provider schema projection, route directory contract, OpenAPI route metadata, identity non-inference, and inactive MCP prompt/resource/auth/connect coverage.

Review loop 2:

- Boole found no remaining blocker after the first revision.
- Feynman found remaining conflicts around `general` selector visibility versus inactive package isolation, default ordinary skill inference, and MCP tool/prompt/resource ref precision.
- Kuhn found remaining conflicts around missing worker projection source, selector visibility versus inactive isolation, and deleting packages that are referenced by persisted `prompt_profile.active`.
- Revisions applied:
  - Added registry-generated `selector` metadata and `selector/<expert_squad_id>` refs. Selector metadata is not package `SKILL.md` content and cannot load inactive production skills.
  - Added explicit `default_skill_refs` and removed the remaining default skill derivation path from `mounted_agents` / `required_tools`.
  - Added typed MCP refs for server, tool, prompt, and resource capabilities on both default and package MCP.
  - Added `capability_projection.agents[<agent_id>]` as the single source for worker runtime projection.
  - Required scheduler workflow dispatch tools to have matching worker projections.
  - Required delete routes to reject persisted config, session overlay, and live session references without auto-switching to `general`.

Review loop 3:

- Boole found no remaining blocker.
- Kuhn found that the manifest example still exposed more workflow tools than it had worker projections for, selector visibility still had both projection and registry rules, and package-ref validation still conflicted with legal `default/...` refs.
- Feynman found that inactive prompt-profile catalog entries could leak capability summaries, MCP typed refs lacked an offline validation strategy, and package-ref validation still conflicted with legal `default/...` refs.
- Revisions applied:
  - The manifest example scheduler tool list was reduced to the workflow tool with a matching worker projection.
  - Selector metadata was removed from `capability_projection`; it is generated only by `ExpertSquadRegistry` from manifest selector/display fields.
  - Validation now distinguishes package-owned refs, `default/...` refs, and registry-generated `selector/...` refs.
  - Inactive prompt-profile catalog entries return only selector/display metadata; capability refs, source paths, hashes, and summaries are active-projection-only.
  - Package MCP typed refs validate against static package MCP declarations without connecting inactive servers. Default MCP typed refs validate only during active-scope resolution.

Review loop 4:

- Boole and Feynman found no remaining blocker after the third revision.
- Kuhn found that package MCP auth/cache identity still used a bare server ID that could collide between agent-local and shared MCP servers, and that strict manifest validation needed to reject unknown nested fields, not only unknown top-level fields.
- Revisions applied:
  - Added shared package MCP typed canonical refs for tool, prompt, and resource capabilities.
  - Changed MCP auth/cache identity to project ID plus complete canonical MCP server ref.
  - Required strict manifest schema validation at every object level.
  - Added tests for stale nested `selector_refs`, misspelled MCP typed fields, and agent-local/shared MCP auth/cache key separation.

Review loop 5:

- Boole found no remaining blocker.
- Kuhn found that selector disabling was mentioned but not modeled in the strict manifest schema.
- Feynman found that the complete canonical MCP server ref requirement covered auth/cache keys only, while connection/status/provider/proxy/prompt/resource/call lookup keys could still collide.
- Revisions applied:
  - Removed explicit selector disable support. A non-selectable package omits `selector`; `selector: false` and `selector.enabled` are invalid fields.
  - Extended complete canonical MCP server ref identity to connection keys, status keys, auth/cache keys, provider-facing tool keys, server proxy keys, prompt/resource keys, and `callTool` lookup keys.
  - Added tests for selector omission and same-name agent-local/shared MCP runtime key separation.

Review loop 6:

- Kuhn, Feynman, and Boole all reported no remaining blockers.
- The reviewed final boundaries are:
  - selector omission is the only non-selectable contract;
  - selector metadata is manifest-derived and not package `SKILL.md` content;
  - MCP runtime keys use project ID plus complete canonical MCP server ref across connection, status, auth/cache, provider-facing, proxy, prompt/resource, and `callTool` lookup;
  - strict manifest schema covers nested stale fields;
  - active projection remains the only runtime capability source.

Implementation review loop 7:

- Parfit reviewed route scope and found no blocker, then identified two coverage gaps: route tests needed a real `?directory=` middleware path and body-level `projectDirectory` rejection on all three expert-squad routes.
- Wegener reviewed package security and found two blockers: first-time folder import could leave a bad target after a post-move validation failure, and ZIP import lacked archive-size, entry-count, per-file, and total unpacked byte limits.
- Archimedes reviewed generated API artifacts and found the route/OpenAPI/docs/SDK additions consistent, but flagged that staged boundaries must exclude unrelated dirty Visual QA, model snapshot, and generated `retry_replay_token_limit` output.
- Revisions applied:
  - Route tests now use real `?directory=` injection for folder import and assert body-level `projectDirectory` rejection for import-folder, import-file, and export.
  - `ExpertSquadPackageManager` now checks archive resource limits before and during extraction.
  - Folder import now rejects staging manifest ID changes before moving the staging directory.
  - First-time import cleanup removes a newly moved target if final canonical validation fails.
  - Replace rollback after post-move validation failure restores the previous package and does not delete the restored target during cleanup.
  - ZIP extraction now uses a bounded writer so actual decompressed bytes are checked while chunks are written, not only after full materialization.
  - Staging will include only expert-squad route/package/docs/SDK route artifacts; unrelated dirty files remain outside this phase.

Implementation review loop 8:

- Volta reviewed the synchronous PromptProfile/config/task/session boundary and found that the built-in package-backed catalog slice is safe only while `PromptProfile` remains synchronous and built-ins-only; forcing async project package registry loading into the current sync API would create a runtime split.
- Lagrange reviewed the built-in migration and found a selector double-source blocker if old `src/skill/builtin/*-expert-squad.md` files survived beside package `selector` metadata.
- Both reviewers flagged `prompt_profile.profiles` as a remaining custom-profile source that must be replaced in a later phase before claiming the full package-backed expert-squad refactor complete.
- Revisions applied:
  - Built-in prompt overlays and selector instructions now live in clear-text package folders under `packages/opencorvus/src/expert-squad/builtin/<id>/`.
  - `PromptProfile.builtIns` derives from `builtInPromptProfiles`, which is produced by `ExpertSquadRegistry.loadEmbeddedPackage()`.
  - `Skill` built-ins derive selectable expert-squad skills from `builtInSelectorSkillSources`; the old selector markdown files were deleted.
  - `ExpertSquadRegistry.loadPackage()` validates `selector.instructions` files instead of validating that contract only for embedded packages.
  - Tests were adjusted where they depended on ambient defaults or obsolete attachment field names: `select_expert_squad` now starts from the canonical default `general`, and Frontend Design material refs assert the manifest-derived `label` field.

Implementation review loop 9:

- Zeno reviewed the phase 5 boundary and found the core blocker is still `PromptProfile.catalog()` merging built-ins with `prompt_profile.profiles`.
- Zeno confirmed task creation, task message, Mission wake, session config patch, and `select_expert_squad` already write only `{ prompt_profile: { active } }`; this active-only shape must be preserved.
- Zeno warned that changing only the backend schema while leaving overlay custom profile create/import/edit/delete flows would create a visible dead path and hidden stale writer.
- Zeno also confirmed runtime projection remains a separate unfinished surface: Orchestrator tool creation, exact runtime contracts, SkillMount, SkillTool, SystemPrompt skills, MCP, SDK, and overlay surfaces must later share one active projection resolver.
- Popper reviewed the runtime capability boundary and recommended a single resolver in the PromptProfile/expert-squad domain that takes `prompt_profile.active`, materialized config, and the package registry and returns prompt identity, package identity, projection hash, scheduler projection, and agent projections.
- Popper found built-in package parsing already validates `capability_projection`, but the current built-in PromptProfile output intentionally flattens packages to `{ label, description, agents }`; preserving that prompt-only slice in phase 5 avoids a partial runtime projection that would leak inactive tools or MCP entries.
- Popper also found that Orchestrator exact tools, worker descriptors, SkillMount, SkillTool, SystemPrompt skills, and MCP server proxy paths all need the same future projection identity; changing only one of those surfaces would be another partial implementation.
- Phase 5 therefore removes the old custom profile source and UI writers without pretending the runtime projection work is complete.

Implementation review loop 10:

- Kepler found no backend/runtime blocker, but found stale public config wording that still described `prompt_profile` as allowing optional project-defined overlays even though the schema now rejects `profiles`.
- Halley found the same generated contract wording issue and also found stale overlay prompt-catalog mutation exports (`loadPromptCatalog`, `savePromptEntry`, `promptConfigValueForSave`, and `resetPromptEntry`) that were no longer called by the new read-only `PromptCatalog` UI but remained exported and test-pinned.
- Revisions applied:
  - Updated `Config.Info` schema documentation so generated OpenAPI and SDK types describe `prompt_profile` as active package-backed expert-squad selection, not project custom overlays.
  - Regenerated SDK and API documentation from the corrected schema description.
  - Removed the stale overlay prompt-catalog mutation exports and updated overlay tests so they assert the removed writer API is absent instead of pinning it as required.
  - Kept runtime projection explicitly pending; this loop did not add partial Orchestrator, worker, skill, tool, or MCP projection wiring.

Implementation review loop 11:

- Leibniz reviewed the initial phase 6 implementation and found one blocker plus two coverage gaps.
- Blocker: `expert-squad-routes.test.ts` still reused the built-in `frontend-replica` ID as a project package fixture, which correctly failed after built-in/project collision rejection landed.
- Coverage gap: active write-path validation was only proven through `/config`, not through session config, Mission wake, task creation, task message, and `select_expert_squad`.
- Coverage gap: package capability refs were not yet proven inert across mounted skills, the `skill` tool, system prompt skill rendering, `ToolRegistry`, and MCP.
- Revisions applied:
  - Added a shared project package fixture with manifest ID `project-replica`, prompt overlays, skill refs, tool refs, and MCP refs for package-scope tests.
  - Updated expert-squad route tests to use the non-built-in project package ID so built-in collision rejection remains meaningful.
  - Added project package active-write coverage for `/config`, session config, Mission wake, task creation, task message, and `select_expert_squad`.
  - Added negative capability tests proving active project package skill refs, tool refs, and MCP declarations remain inert until the runtime capability projection phase.
  - Kept project package selector metadata out of mounted skills and did not add partial projection to Orchestrator exact tools, worker contracts, SkillMount, SkillTool, SystemPrompt skills, ToolRegistry, or MCP.

Implementation review loop 12:

- Aristotle reviewed phase 6 route/API and test coverage after loop 11 and found new blockers.
- Blocker: `LLM.composeSystem()` called `EffectiveConfig.directory()` and `EffectiveConfig.effective()` without a session or active `Instance`, breaking contextless direct prompt composition tests with `No context found for instance`.
- Blocker: project package prompt overlays were not proven through real Agent runner or external Build executor prompt composition.
- Blocker: the inert capability test used `Object.keys()` on `ToolRegistry.tools()` array output, so it did not actually inspect tool IDs; it also covered only `MCP.status()` and not MCP tools, prompts, resources, server proxy, connect, disconnect, auth, remove-auth, or call-tool paths.
- Coverage gap: `/config/prompt-profile?sessionID=...` was covered only with built-in profiles, not a project package active profile.
- Docs gap: `specs/current/architecture/17-agent-team-infrastructure.html` still referenced deleted `src/skill/builtin/*-expert-squad.md` selector files and `PromptProfile.composeAgentPrompt` as a current runtime prompt source.
- Harvey independently found no phase 6 production blocker, but confirmed the sync `PromptProfile` helpers remain a maintenance risk and identified the same `ToolRegistry.tools()` array assertion bug.
- Revisions applied:
  - `PromptProfileResolver` now supports an explicit contextless built-in-only scope; `LLM.composeSystem()` uses session scope, current `Instance` scope, or schema-materialized empty config without reading project config state when no project context exists.
  - Added direct LLM, Agent runner, and external Build executor tests proving `project-replica` prompt overlays reach actual runtime prompt composition.
  - Extended the shared project package fixture with MCP tool, prompt, and resource declarations.
  - Fixed the `ToolRegistry.tools()` assertion to inspect tool IDs, and extended negative capability tests across MCP tools, prompts, resources, server proxy lists, `callTool`, `connect`, `disconnect`, `supportsOAuth`, and `removeAuth` while disabling the built-in browser MCP in that test project to avoid sidecar-dependent validation.
  - Added Orchestrator exact runtime tool-table assertions proving package tool refs are not installed in phase 6.
  - Updated the session-specific prompt-profile catalog test to use a project package active profile.
  - Updated the current architecture page to describe built-in selector skills as package-derived and runtime prompt composition as `PromptProfileResolver`-backed.

Implementation review loop 13:

- Laplace reviewed the loop 12 fixes and found no blockers.
- Laplace confirmed:
  - contextless `LLM.composeSystem()` is built-in-only and no longer touches project config state without an `Instance`;
  - project package overlays flow through direct LLM, Agent runner, and external Build prompt composition;
  - `/config/prompt-profile?sessionID=...` resolves project package profiles from the session directory;
  - package capability refs remain inert across SkillMount, SystemPrompt skills, SkillTool, ToolRegistry, MCP, and Orchestrator exact tools;
  - the omitted `projectDirectory` resolver path is not a fallback for failed project loading because project-present calls still surface discovery and collision errors.
- Non-blocking cleanup candidate carried forward: old sync `PromptProfile` helper APIs remain for built-in-only static tests, but production `src` call sites now use `PromptProfileResolver`. Removing or narrowing those helpers should be a later built-in test cleanup, not mixed into phase 6 runtime resolver delivery.

Phase 7A Recall, 2026-07-04:

### User Request

- Continue implementing and testing the dynamic expert-squad architecture.
- Use independent agents for adversarial implementation/review cooperation.
- Preserve the original architecture goal: dynamic clear-text `.opencorvus` expert-squad packages with explicit IDs, package/folder loading, per-agent prompts, skills, tools, MCP definitions, and runtime union of profile-exclusive configuration with the currently supported OpenCorvus collection.

### Acceptance Criteria For This Slice

- Orchestrator exact runtime tools for every wake are projected from the active expert squad's `capability_projection.scheduler`.
- `general` exposes only the scheduler role-base selector/control surface and no domain workflow, shell, browser-preview, goal-edit, or proposal tools.
- Non-general built-in expert squads explicitly author the scheduler workflow tools they need in manifest `built_in_tool_ids`; they do not rely on `AgentToolPool.roleAssignments.orchestrator` as an implicit maximum catalog.
- Project package `capability_projection.scheduler.built_in_tool_ids` is honored for Orchestrator exact runtime tools when `prompt_profile.active` points to that project package ID.
- Projection happens before `toolGuard`, `enableMap`, and `SessionPrompt.setSessionRuntimeContract`.
- Unknown projected built-in tool IDs, missing raw tool implementations, and unknown active profile IDs fail visibly; there is no fallback to the old full Orchestrator tool table.
- SkillMount, SkillTool, SystemPrompt skills, ToolRegistry custom tools, worker runtime contracts, and MCP remain explicitly out of Phase 7A and must not be claimed as projected.

### Hard Constraints

- `role_base` is not `AgentToolPool.roleAssignments.orchestrator`; it is an explicit OpenCorvus-owned scheduler minimum.
- No fallback/compat/double-source/gate behavior.
- Do not restart or refresh running OpenCorvus/overlay processes.
- Do not create a worktree, do not use `git reset`, and do not stage unrelated dirty direct-build/Visual-QA files.
- Code changes require focused tests; docs change must preserve `specs/` as the only plan source.

### Sources Read

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md`
- `specs/records/2026-07/2026-07-03-expert-squad-capability-profile.md`
- `packages/opencorvus/src/expert-squad/registry.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/src/expert-squad/builtin/*/expert-squad.jsonc`
- `packages/opencorvus/src/expert-squad/builtin/index.ts`
- `packages/opencorvus/src/agent/tool-pool-contract.ts`
- `packages/opencorvus/src/agent/role-contract.ts`
- `packages/opencorvus/src/orchestrator/agent.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`
- `packages/opencorvus/test/fixture/expert-squad.ts`
- `packages/opencorvus/test/agent/agent.test.ts`

### Repository Search Evidence

- `rg -n "capability_projection|role_base|built_in_tool_ids|projectedWorkflowTools|PromptProfileResolver|createOrchestratorTools|setSessionRuntimeContract|includeMcpTools|toolGuard|enableMap" packages/opencorvus/src packages/opencorvus/test specs`
- `rg -n "SkillMount\\.resolve|SystemPrompt\\.skills|SkillTool|MCP\\.tools|serverTools|callTool|serverPrompts|serverResources" packages/opencorvus/src packages/opencorvus/test specs`
- `rg -n "const tools =|skill:|question:|wait:|bash:|browser_preview:" packages/opencorvus/src/orchestrator/tools.ts`
- `rg -n "PromptProfile\\.builtIns|builtInPromptProfiles|loadedBuiltInPackages|builtInPackageSources" packages/opencorvus/src packages/opencorvus/test`
- `rg -n "interruptTaskLoop|wake|schedule.*wake|TaskLoop|select_expert_squad" packages/opencorvus/src/orchestrator packages/opencorvus/test/orchestrator packages/opencorvus/test/agent -g "*.ts"`

### Independent Agent Feedback

- Franklin, Dewey, and Beauvoir were started for read-only review of Orchestrator tools, SkillMount/SkillTool/SystemPrompt, and MCP projection surfaces.
- Beauvoir returned MCP review feedback:
  - MCP projection must not be implemented as a partial `MCP.tools()` filter.
  - Every MCP production path must share one identity: project ID plus complete canonical MCP server ref, with typed refs adding `/tool/<name>`, `/prompt/<name>`, or `/resource/<name>`.
  - The affected MCP paths include status, connect, disconnect, auth, token status/removal, tools, prompts, resources, server proxy lists, server proxy calls, `callTool`, `getPrompt`, `readResource`, session MCP injection, HTTP MCP routes, experimental resource routes, command palette prompt reads, and Orchestrator-side Figma MCP materialization.
  - Package MCP definitions must be materialized only inside the active projection scope and must not be copied into `Config.mcp`.
  - Phase 7A therefore must not touch MCP runtime behavior; MCP remains a later all-entry-point slice with active-scope positive tests and inactive-scope negative tests.
- Franklin returned Orchestrator/worker review feedback:
  - `PromptProfileResolver` should be the single active capability entry point.
  - `AgentToolPool` must stay a static maximum declaration and validation catalog, not a dynamic runtime source.
  - Orchestrator projection belongs between raw tool construction and `toolGuard` / `enableMap` / exact runtime contract installation.
  - `select_expert_squad` still needs a later visible continuation wake because one LLM call cannot mutate its own active tool table.
  - Worker dispatch authorization and `WorkerTurnDescriptor` projection identity/hash are required later; Phase 7A must not claim them.
- Dewey returned SkillMount/SkillTool/SystemPrompt review feedback:
  - Package production skills must not be registered into global `Skill.all()`.
  - Skill projection should materialize selector metadata, ordinary default skills, and active package production skills from one resolved capability surface.
  - `SkillMount.resolve()`, `SkillTool`, `SystemPrompt.skills()`, `/skill/mounts`, SDK/OpenAPI, and overlay session scope must be updated together in a later skill-surface slice.
  - Package skill name conflicts must fail fast; do not rename or silently override.
- All three independent reviews agree that Phase 7A must stay limited to Orchestrator scheduler built-in tool projection and must not imply MCP, package skill, custom package tool, worker runtime, or continuation-wake completion.

Phase 7A planned boundary, 2026-07-04:

- Add one active scheduler projection resolver in the expert-squad prompt-profile domain. It resolves:
  - active expert squad ID;
  - whether the active package is built-in or project-backed;
  - the manifest scheduler projection;
  - expanded scheduler built-in tool IDs;
  - a stable projection hash for the scheduler projection.
- Keep `PromptProfile.builtIns` as the synchronous built-in prompt-only API. The new runtime projection path uses embedded `loadedBuiltInPackages` and project `ExpertSquadRegistry.loadPackage()` instead of the flattened prompt-only map.
- Add one scheduler role-base constant/function for the Orchestrator minimum lifecycle and selector surface:
  - `select_expert_squad`
  - `skill`
  - `question`
  - `read_context`
  - `query_failed_goals`
  - `complete_task`
  - `fail_task`
  - `cancel_task`
  - `retry_task`
  - `wait`
  - `inject_operator_message`
  - `respond_agent_coordination`
  - `cancel_subagent`
- `general` keeps only `role_base: true`; tests pin that this expands to the exact list above and excludes `build`, `requirements`, `architect`, `frontend_design`, `frontend_research`, `visual_qa`, `integrity`, `deep_research`, `fact_check`, `workload_analysis`, `analyze_intent`, `explore`, `add_goal`, `modify_goal`, `complete_goal`, `delete_goal`, `refine`, `propose_task`, `browser_preview`, and `bash`.
- Add explicit scheduler `built_in_tool_ids` to built-in non-general manifests:
  - frontend replica/automation: frontend workflow tools plus lifecycle/control tools required by those squads.
  - frontend innovate: design/research workflow tools plus lifecycle/control tools required by that squad.
  - backend/algorithm: backend/algorithm workflow tools without frontend-only workflow tools.
- Use the resolver inside `Orchestrator.processTask()` before `createOrchestratorTools()`, `toolGuard()`, `enableMap`, and `SessionPrompt.setSessionRuntimeContract()`.
- `createOrchestratorTools()` remains the raw canonical built-in Orchestrator tool factory. Phase 7A projects the returned map before `toolGuard()` and exact runtime contract installation. If the projected list names a tool absent from the raw map, the wake fails visibly.
- `SessionRuntimeContract.tools` becomes the proof of the active scheduler capability for this slice. `includeMcpTools` is set to `false` for this exact Orchestrator contract until MCP projection explicitly adds scoped MCP tools to the projected map.
- `select_expert_squad` visible continuation wake remains Phase 7B. Phase 7A only guarantees that any subsequent Orchestrator wake reads `prompt_profile.active` and installs the matching projected exact tool table.
- Worker runtime projection, SkillMount/SkillTool/SystemPrompt skill projection, package custom tool loading, and MCP projection remain pending and must keep the existing negative tests proving project package refs do not leak through those surfaces.

Phase 7A implementation inventory:

| Surface | Planned action |
| --- | --- |
| `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts` | Add active package resolution and scheduler projection expansion/hash. |
| `packages/opencorvus/src/agent/tool-pool-contract.ts` | Add the explicit Orchestrator scheduler role-base tool list; do not reuse the full Orchestrator assignment. |
| Built-in `expert-squad.jsonc` manifests | Add explicit scheduler `built_in_tool_ids` for non-general expert squads. |
| `packages/opencorvus/src/orchestrator/agent.ts` | Resolve active scheduler projection for the task root session, project tools before `toolGuard`, build `enableMap` from projected keys, and install only projected tools into the exact runtime contract. |
| `packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts` | Cover built-in general/frontend/backend/algorithm projection and project package scheduler projection. |
| `packages/opencorvus/test/agent/agent.test.ts` or focused Orchestrator test | Cover exact runtime tool projection expectations without claiming skill/MCP/worker projection. |

Phase 7A review questions for independent agents:

- Does the projection resolver have any alternate active-profile source besides `prompt_profile.active`?
- Does any Orchestrator path still install the unprojected full tool table into an exact runtime contract?
- Do built-in manifest tool lists match the agent roles each squad advertises, without accidentally exposing unrelated domain workflow tools?
- Does any Phase 7A wording imply SkillMount, SkillTool, worker toolkits, custom package tools, or MCP are already projected?

Phase 7A post-implementation independent review feedback, 2026-07-04:

- Hume and Dirac reviewed the first Phase 7A implementation as read-only adversarial reviewers.
- Shared blocker: the first test set only proved resolver helper projection and source-text ordering in `orchestrator/agent.ts`; it did not execute an Orchestrator wake and inspect the installed `SessionRuntimeContract.tools`. The source-order test must be replaced or supplemented by a real `Orchestrator.processTask()` runtime-contract assertion.
- Shared blocker: built-in manifest coverage was incomplete. The tests covered `general`, `frontend-replica`, and `backend`, but did not pin `frontend-automation-debug`, `frontend-innovate`, or `algorithm`.
- Dirac blocker: `frontend-automation-debug` declares `frontend-design` and `frontend-research` agents but omitted `frontend_design` and `frontend_research` from scheduler `built_in_tool_ids`; that conflicts with the Phase 7A planned boundary requiring frontend replica/automation squads to include frontend workflow tools.
- Dirac blocker: the `general` role-base test used `AgentToolPool.orchestratorSchedulerRoleBaseToolIDs()` as its oracle, so it could not detect accidental shrinkage of the explicit 13-tool scheduler minimum.
- Required correction: pin the role-base list as a literal test expectation, cover every built-in scheduler manifest, run `Orchestrator.processTask()` with captured runtime contracts for active built-in and project profiles, and keep package tools/MCP inactive in Phase 7A.

Phase 7A final validation results, 2026-07-04:

- `bun test --timeout 60000 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts`: pass, 10 tests.
- `bun test --timeout 60000 packages/opencorvus/test/orchestrator/tools.test.ts -t "respond_agent_coordination redispatch recovers a pending integrity action after attempt persistence"`: pass, 1 focused test. This validates current dirty working-tree integrity recovery behavior but is not part of the Phase 7A staged diff.
- `bun test --timeout 60000 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/expert-squad/registry.test.ts packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts`: pass, 45 tests.
- `bun test --timeout 60000 packages/opencorvus/test/agent/agent.test.ts -t "orchestrator tool pool covers every self-built orchestrator tool"`: pass, 1 focused test.
- `bun test --timeout 60000 packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts -t "expert-squad tools are scheduler-owned visible skill loading"`: pass, 1 focused test.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: pass, 19 tests.
- `bun test packages/opencorvus/test/script/document-health.test.ts`: pass, 46 tests.
- `bun run --cwd packages/opencorvus typecheck`: pass.
- `git diff --check`: pass.

Phase 7A self-review result:

- Hume and Dirac blockers were resolved by adding the missing `frontend-automation-debug` frontend workflow tools, replacing the source-order proof with `packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts`, pinning literal scheduler role-base expectations, and covering all non-general built-in scheduler manifests.
- The implemented Orchestrator runtime test captures the installed `SessionRuntimeContract.tools` during `Orchestrator.processTask()` for `general`, `frontend-automation-debug`, and project package `project-replica`; it proves MCP/package custom tools remain inactive in Phase 7A.
- Remaining scope is explicit future work: select continuation wake, worker runtime projection, SkillMount/SkillTool/SystemPrompt projection, package custom tools, and MCP projection.

Phase 7B Recall, 2026-07-04:

### User Request

- Continue implementing and testing the dynamic expert-squad architecture.
- Use independent agents for adversarial implementation/review cooperation.
- Preserve the original architecture goal: `select_expert_squad` remains the visible active expert-squad write path, and selection must cause a later Orchestrator wake to reload the active prompt profile and scheduler capability projection.

### Acceptance Criteria For This Slice

- `select_expert_squad` validates the requested profile through `PromptProfileResolver` and writes only `{ prompt_profile: { active: profile_id } }` to the task root session overlay.
- The tool records visible durable evidence with previous profile, next profile, capability profile ID, and projection hash.
- The tool schedules a real task-loop continuation wake through the existing queue/wake mechanism with an explicit wake note telling Orchestrator to reload the active prompt profile and scheduler capability projection.
- The continuation wake must not be a hidden route, keyword classifier, synthetic user message, host-side gate, fallback, or same-turn tool-table mutation.
- Tests must prove the next Orchestrator wake installs the projected tool table from the newly active profile.
- Worker runtime projection, SkillMount/SkillTool/SystemPrompt projection, package custom tools, and MCP projection remain out of this slice and must not be claimed as implemented.

### Hard Constraints

- No fallback/compat/double-source/gate behavior.
- Do not restart or refresh running OpenCorvus/overlay processes.
- Do not create a worktree, do not use `git reset`, and do not stage unrelated dirty direct-build/Visual-QA files.
- This repository currently has unrelated dirty direct-build/Visual-QA/API work, including `orchestrator/tools.ts`; Phase 7B edits must stay in tight hunks and must not absorb unrelated changes into the commit.
- Code changes require focused tests; docs change must preserve `specs/` as the only plan source.

### Sources Read

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/current/architecture/README.md`
- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md`
- `specs/records/2026-07/2026-07-03-expert-squad-capability-profile.md`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/orchestrator/agent.ts`
- `packages/opencorvus/src/orchestrator/loop.ts`
- `packages/opencorvus/src/engine/queue.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/test/orchestrator/tools.test.ts`
- `packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts`

### Repository Search Evidence

- `rg -n "select_expert_squad|prompt_profile|interruptTaskLoop|runTaskLoop|wake|schedule.*wake|TaskLoop|decisionLog|write.*decision|append.*decision|DecisionLog" packages/opencorvus/src/orchestrator packages/opencorvus/src/engine packages/opencorvus/src/decision-log packages/opencorvus/test/orchestrator packages/opencorvus/test/expert-squad -g "*.ts"`
- `rg -n "SessionPrompt\\.setSessionRuntimeContract|setSessionRuntimeContract|SessionRuntimeContract|runtime contract|includeMcpTools|projectOrchestratorTools|resolveSchedulerCapability" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`
- `rg -n "createOrchestratorTools\\(|select_expert_squad|prompt profile|expert squad" packages/opencorvus/test/orchestrator packages/opencorvus/test/expert-squad packages/opencorvus/test/agent -g "*.ts"`
- `rg -n "dispatchTaskLoop|dispatchTaskLoopInBackground|engine/queue" packages/opencorvus/src/orchestrator/tools.ts packages/opencorvus/src/engine/queue.ts packages/opencorvus/test/orchestrator -g "*.ts"`

### Independent Agent Feedback

- Erdos, Kierkegaard, and Schrodinger were started as read-only independent reviewers for Phase 7B selection continuation, test evidence, and boundary protection. They were explicitly instructed not to edit files and not to spawn subagents.
- Feedback was still pending when this Recall block was first written; returned findings must be appended before Phase 7B is considered accepted.
- Schrodinger returned the Phase 7B boundary review:
  - Phase 7B must not touch `SkillMount`, `SkillTool`, `SystemPrompt.skills`, `ToolRegistry`, MCP projection, or worker runtime projection.
  - `WorkerTurnDescriptor` still has no prompt profile / capability profile / projection hash fields; worker projection remains a later slice.
  - Valid Phase 7B claim: `select_expert_squad` schedules a visible later Orchestrator wake, and that later wake uses the existing Phase 7A exact scheduler contract path.
  - Existing negative tests must keep proving package capability refs remain inert through SkillMount/SystemPrompt/SkillTool/ToolRegistry/MCP, and project package scheduler wakes do not activate package tools or MCP.
  - Add tests for visible continuation wake evidence, overlay write shape, no same-turn tool-table mutation, next wake projected contract, and inert package skills/tools/MCP after selecting a project package.
- Kierkegaard returned the Phase 7B test-evidence review:
  - Expand the existing `select_expert_squad` tool test to assert overlay writes only `prompt_profile.active`, result text includes previous/next/capability/hash, decision-log row records the same evidence, and unknown profile leaves overlay/log/dispatch unchanged.
  - Add a scheduler-capability transition test that starts from `general`, calls `select_expert_squad`, captures the scheduled continuation event through `EngineQueue.dispatchTaskLoop`, runs `Orchestrator.processTask(taskID, event)`, and asserts the installed runtime contract is the selected profile's projected tool table.
  - Reuse the existing Phase 7A runtime-contract capture pattern and existing `PROJECT_EXPERT_SQUAD_ID` fixture; do not alter package skill/tool/MCP negative tests.
- Erdos returned the Phase 7B selection/wake review:
  - The current selection path is Orchestrator selector guidance, generated selector skills, SessionLoop SkillTool rebinding, `select_expert_squad`, then the next Orchestrator wake resolving Phase 7A scheduler capability before exact runtime contract installation.
  - `dispatchTaskLoop({ taskID, event: { note } })` is the correct continuation primitive because it handles active, queued, and live-ownership cases; `SessionWake` and delayed cron wake are the wrong primitives for immediate expert-squad continuation.
  - Remaining checks: update Orchestrator core wording so `select_expert_squad` mentions the visible continuation wake, update the pinned tool-description test, and consider whether a real `dispatchTaskLoop` integration proof is needed beyond spy-captured event plus manual next-wake runtime contract proof.
  - Pitfall: if continuation dispatch returns `ignored`, the overlay and decision-log evidence have already persisted; this is acceptable only as a visible failure, not an atomic rollback or fallback.

### Phase 7B Planned Boundary

- Keep `select_expert_squad` as the only active profile write path.
- After a successful overlay write, resolve the next scheduler capability from the same root session effective config and project directory.
- Append a task-scoped `decision_log` row under phase `orchestrator` and key `select_expert_squad`, carrying previous profile, next profile, capability profile ID, projection hash, reason, and the planned continuation note.
- Call `dispatchTaskLoop({ taskID, event: { note } })` with a wake message that explicitly says this is not a user-authored message and that the next wake must reload active prompt profile and scheduler capability projection.
- Return the continuation dispatch result in the visible tool result.
- Update focused tests:
  - existing `select_expert_squad` tool test asserts overlay shape, decision-log evidence, and dispatch call/note;
  - scheduler runtime projection test simulates the next wake after selection and captures `SessionRuntimeContract.tools` to prove the new active profile's projected tools are installed.

### Phase 7B Final Validation

- `bun test --timeout 60000 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts` passed: 11 tests. The transition test used real `dispatchTaskLoop` and observed the next Orchestrator wake installing `frontend-replica` projected tools.
- `bun test --timeout 60000 packages/opencorvus/test/orchestrator/tools.test.ts -t "select_expert_squad"` passed: overlay write shape, decision-log evidence, visible continuation note, and unknown-profile no-dispatch behavior.
- `bun test --timeout 60000 packages/opencorvus/test/tool/skill.test.ts -t "active project package prompt profile does not leak"` passed: project package skill/tool/MCP refs remain inert outside scheduler projection.
- `bun test --timeout 60000 packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts -t "expert-squad tools"` passed.
- `bun test --timeout 60000 packages/opencorvus/test/agent/core-prompt-hygiene.test.ts -t "orchestrator prompt owns request-based expert-squad scheduling"` passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` passed: 19 tests.
- `bun test packages/opencorvus/test/script/document-health.test.ts` passed: 46 tests.
- `bun typecheck` passed.
- `bun run api:routes-check`, `bun run docs:check`, `bun run overlay:i18n-check`, and `git diff --check` passed.
- Corrected command-selection note: `bun test --timeout 60000 packages/opencorvus/test/tool/skill.test.ts -t "project package capability refs"` and `bun test --timeout 60000 packages/opencorvus/test/agent/core-prompt-hygiene.test.ts -t "select_expert_squad"` matched zero tests and were replaced by the valid focused test names above.

Phase 8 Recall, 2026-07-04:

### User Request

- Continue implementing and testing the dynamic expert-squad architecture.
- Preserve the original architecture goal: expert squads loaded from `.opencorvus/expert-squads/<id>` define prompts, skills, tools, and MCP definitions isolated by manifest ID; active runtime exposes the union of default capability and selected expert-squad capability without fallback, aliases, or name guessing.
- This slice focuses on making the visible skill surface profile-projected. `SkillMount`, `SkillTool`, `SystemPrompt.skills`, and `/skill/mounts` must share one backend projection source.

### Acceptance Criteria For This Slice

- Add one backend expert-squad skill projection resolver derived from the same effective config, project directory, and active `prompt_profile.active` source as scheduler tool projection.
- `SkillMount.resolve()` and `SkillMount.matrix()` consume that projected surface instead of exposing every statically mounted selector/skill as active.
- `SkillTool` and `SystemPrompt.skills` continue to receive the same turn-scoped surface from `SessionLoop.finalizeResolvedToolSkillSurface`.
- `/skill/mounts` returns required projection evidence: `active_profile`, `capability_profile_id`, `projection_hash`, `projected_tool_ids`, `projected_agents`, `selector_skill_names`, `production_skill_names`, and `projected_skill_names`.
- Project package production skills are not registered into `Skill.all()` or `/skill/installed`; inactive package production skills remain invisible.
- Package custom tools, MCP projection, and worker runtime projection remain out of this slice and must not be claimed as implemented.

### Hard Constraints

- No fallback, compatibility path, double source, gate, hidden route, route-local UI filter, synthetic message, or same-turn tool-table mutation.
- Do not add `.opencorvus/expert-squads/**/SKILL.md` to the global `Skill.all()` scan.
- Do not restart or refresh running OpenCorvus/overlay processes.
- Do not create a worktree, do not use `git reset`, and do not stage unrelated dirty direct-build/Visual-QA files.
- Existing dirty files include `prompt-profile-resolver.ts` and `registry.ts` WorkflowRegistry migration hunks from previous toolchain repair; Phase 8 must preserve those hunks and add only scoped changes.

### Sources Read

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/current/architecture/README.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-03-expert-squad-capability-profile.md`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/src/expert-squad/registry.ts`
- `packages/opencorvus/src/expert-squad/builtin/index.ts`
- `packages/opencorvus/src/skill/skill.ts`
- `packages/opencorvus/src/skill/mounts.ts`
- `packages/opencorvus/src/tool/skill.ts`
- `packages/opencorvus/src/session/system.ts`
- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/src/server/routes/skill.ts`
- `packages/overlay/src/services/extensions.ts`
- `packages/opencorvus/test/fixture/expert-squad.ts`
- `packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`
- `packages/opencorvus/test/tool/skill.test.ts`
- `packages/opencorvus/test/server/skill-routes.test.ts`

### Repository Search Evidence

- `rg -n "export namespace SkillMount|namespace SkillMount|SkillMount\\.resolve|SkillMount\\.matrix|loadSkillMountMatrix|/skill/mounts|AgentSkillMountMatrix" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test -g "*.ts" -g "*.tsx"`: `SkillMount` owns the backend matrix; `/skill/mounts`, overlay service, many overlay fixtures, and `SkillMount.resolve()` tests consume it.
- `rg -n "finalizeResolvedToolSkillSurface|new SkillTool|SkillTool|SystemPrompt\\.skills|skills\\(" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`: `SessionLoop` already resolves one skill surface, rebinds `SkillTool`, and passes the same surface into `SystemPrompt.skills`.
- `rg -n "resolveSchedulerCapability|capabilityProfileID|projectionHash|builtInToolIDs|agentIDs|selectorSkillNames|productionSkillNames|projected" packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad packages/opencorvus/test/orchestrator packages/opencorvus/src/orchestrator -g "*.ts"`: scheduler capability projection already exists, but it has no agent skill projection output.
- `rg -n "mounted_agents|required_tools|selector_skill_names|production_skill_names|projected_skill_names|frontend-replica-expert-squad|frontend-innovate-expert-squad|frontend-automation-debug-expert-squad" packages/opencorvus/src/skill packages/opencorvus/test/skill packages/opencorvus/test/tool packages/opencorvus/test/server packages/overlay/test -g "*.ts" -g "*.md"`: current selector skills are built-in generated skills mounted to Orchestrator; existing tests expect broad selector visibility.
- `rg -n "capability_projection|default_skill_refs|package_skill_refs|selector|selectorInstructions|selector_skill" packages/opencorvus/src/agent/prompt-profile.ts packages/opencorvus/src/expert-squad packages/opencorvus/src/skill packages/opencorvus/test/expert-squad packages/opencorvus/test/skill packages/opencorvus/test/tool -g "*.ts" -g "*.md"`: package skill refs are manifest/path-derived; selector metadata comes from expert-squad manifests and generated built-in selector markdown.
- `rg -n "PROJECT_EXPERT_SQUAD_ID|write.*Package|expert-squads|package_skill_refs|skill_refs|project package|selector instructions|source-evidence" packages/opencorvus/test/expert-squad packages/opencorvus/test/tool packages/opencorvus/test/server packages/opencorvus/test/session packages/opencorvus/test/agent -g "*.ts"`: project package fixture already has scheduler/build package skills plus package tool and MCP refs; existing negative test must flip only for skill projection and keep tool/MCP negatives.

### Independent Agent Feedback

- Carson reviewed package skill visibility. Main findings: `Skill.all()` must not scan package production skills; selector skills are generated from expert-squad metadata; project selectors currently lack a `Skill.Info` projection path; package skill frontmatter names and collisions need fail-fast handling; active package production skills should be parsed only for the active projected surface.
- Mill reviewed backend call points. Main findings: `SkillTool` and `SystemPrompt.skills` already share the SessionLoop surface; add one expert-squad skill projection resolver beside `PromptProfileResolver.resolveSchedulerCapability`; direct `SkillTool.init({ agent })` cannot prove project package resolution without session/project scope; update `SkillMount.resolve`, `SkillMount.matrix`, `/skill/mounts`, and focused tests.
- Singer reviewed `/skill/mounts` and overlay scope. Main findings: `/skill/mounts` has the old matrix shape; overlay `AgentSkillMountMatrix` lacks projection fields; Skill Market currently refreshes by directory/refresh but not session ID; backend must own the projected matrix and overlay must not locally filter; new fields must be required, not optional compatibility fields.

### Phase 8 Planned Boundary

- Add profile-skill projection helpers to the expert-squad resolver domain. The projection is derived from active package manifest data plus default `Skill.all()` entries for explicit `default/skill/<name>` refs.
- Canonical selector skill names are model-visible skill names: `<expert-squad-id>-expert-squad`. `selector_skill_names` uses those names, not `selector/<id>` refs.
- `general` exposes selector skills for selectable packages and no package production skills. An active non-general profile exposes its own selector skill plus production skill refs for the current agent role.
- Package production skill names are parsed from active package `SKILL.md` files only. Projection rejects duplicate effective names, selector-name collisions, and package/default skill collisions.
- Visibility metadata is projection-derived. Package `SKILL.md` `mounted_agents` and `agents` fields are not the authority for dynamic visibility.
- `SkillMount.resolve()` keeps permission/platform/required-tool checks, but its candidate skills come from the projected surface.
- `SkillMount.matrix()` resolves effective config and project directory for session scope, returns the required projection metadata, and builds rows only for projected agents.
- Overlay service types and focused tests receive required projection fields. Broader browser fixture cleanup may continue in a later UI slice after backend/API projection is landed.

### Phase 8 Implementation Result

- Added `PromptProfileResolver.resolveSkillProjection()` as the backend source for expert-squad skill projection.
- Phase 8C supersedes the earlier default-skill wording in this bullet: the resolver treats the existing default skill collection as the maximum catalog only. Default ordinary skills enter the effective surface only through explicit `default/skill/<name>` refs, while generated selector skills plus active-package production skills are added through the expert-squad projection.
- Project selectors are generated from expert-squad metadata and selector instructions; inactive package production skills, package tools, and package MCP definitions are not loaded through selector discovery.
- Package production `SKILL.md` files cannot declare `agents` or `mounted_agents`; projection owns visibility.
- Projected skill name collisions fail fast across default, selector, and package sources. Ordinary built-in skills are no longer allowed to silently shadow project selector names; only real built-in selector skills are allowed to be replaced by generated selector projection.
- `projection_hash` now includes the scheduler projection hash, projected agent IDs, selector names, production names, complete projected skill names, and projected skill mount/source mapping.
- `SkillMount.resolve()` and `SkillMount.matrix()` consume the same projected surface. `matrix.skills`, `matrix.matrix`, `matrix.project_mounts`, `unmounted_count`, and `projected_skill_names` are derived from `skillProjection.skills`.
- `SkillTool` and `SystemPrompt.skills()` continue to use the turn-scoped surface resolved by `SessionLoop.finalizeResolvedToolSkillSurface()`. Direct `SystemPrompt.skills()` calls can now receive explicit config and project directory.
- `/skill/mounts` returns required projection evidence fields, and the OpenAPI/SDK skill-mount response types include those fields as required.
- Overlay Skill Market refresh now uses the prompt-profile catalog scope and sends `sessionID` for session-scoped active profile resolution.

### Phase 8 Independent Review And Validation

- Turing performed the final read-only Phase 8 review after the implementation was narrowed to the blocking projection questions and returned: `No blocking findings.`
- Local secondary review fixed two non-blocking but real consistency risks before final validation:
  - `projected_skill_names` now reflects the complete projected skill pool rather than only selector/production names.
  - `project_mounts` now comes from `skillProjection.skills`, not the stale installed-skill pool.
  - `projection_hash` now includes projected skill mount/source mapping.
  - Built-in selector collision allowance is restricted to actual built-in selector skills.
- Validation passed with the no-activity timeout wrapper:
  - `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/tool/skill.test.ts packages/opencorvus/test/server/skill-routes.test.ts packages/opencorvus/test/session/extra-tools.test.ts packages/opencorvus/test/agent/agent.test.ts -t "skill projection|active project package|skill routes|exact runtime contract|runtime expert-squad skill|runtime skill under exact stage contracts|skill policy"`: 30 pass, 1 skip.
  - `bun test --timeout=2147483647 packages/overlay/test/extensions-service.test.ts packages/overlay/test/prompt-profile-task-session-owner.test.ts`: 20 pass.
  - `bun run --cwd packages/opencorvus typecheck`: passed.
  - `bun run --cwd packages/overlay typecheck`: passed.
  - `bun run --cwd packages/sdk/js typecheck`: passed.
  - `bun run api:routes-check`: passed.
  - `bun run docs:check`: passed.
  - `bun run overlay:i18n-check`: passed.
  - `bun test --timeout=2147483647 packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`: 65 pass.
  - `git diff --check`: passed; output only contained existing CRLF warnings in unrelated dirty files.
- Browser runner note: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/agent-models-panel.test.ts packages/overlay/test/browser/provider-auth-panel.test.ts packages/overlay/test/browser/skill-mcp-panel-browser.test.ts packages/overlay/test/browser/side-activity-toolbar-browser.test.ts` produced 8 pass and 2 fail. The failing assertions were unrelated to the added skill-mount projection fields: side activity toolbar session selection after abort, and MCP connect call expectation after config patch. They remain outside this backend/API skill-projection slice and must not be represented as Phase 8 visual/browser acceptance.

### Phase 8 Remaining Boundary

- Package custom tool runtime projection remains unimplemented.
- MCP projection remains unimplemented.
- Worker runtime projection/hash binding remains unimplemented.
- Package custom agents remain unimplemented.
- SDK/OpenAPI generated files currently contain unrelated dirty schema drift from other worktree changes; Phase 8 staging must include only the skill-mount projection response hunks.

Phase 8C Corrective Recall, 2026-07-04:

### User Request

- Continue the dynamic `.opencorvus` expert-squad architecture implementation through independent-agent adversarial implementation and review.
- Preserve the original architecture goal: expert-squad package selector metadata must not expose inactive package production skill, tool, MCP, or file surfaces; active runtime surfaces must be evidence-derived from the selected expert-squad package and the current supported system collection without fallback, aliases, or name guessing.

### Acceptance Criteria For This Corrective Slice

- Loading a project-generated expert-squad selector skill through `SkillTool` must return only selector instructions and must not sample `.opencorvus/expert-squads/<id>/agents`, `tools`, `mcp`, package production `SKILL.md`, or other package production files.
- The correction must not implement or claim package custom tool runtime projection, MCP projection, worker runtime projection/hash binding, or package custom agents.
- The correction must preserve the current Phase 8 skill projection single-source path through `PromptProfileResolver.resolveSkillProjection`, `SkillMount.resolve`, `SkillTool`, and `SystemPrompt.skills`.
- Default ordinary skill visibility must follow the root design's explicit-ref contract. The user's original "union with the currently supported collection" is interpreted as a union between role-base capability, explicitly claimed default collection refs, and active package refs; it is not permission to expose every installed ordinary skill automatically.

### Hard Constraints

- No fallback, compatibility branch, UI-only filter, hidden route, synthetic selector message, MCP/tool partial projection, worker-runtime partial projection, or route-local workaround.
- Keep edits scoped because the worktree contains unrelated dirty direct-build, Visual QA, Integrity, SDK/OpenAPI, and orchestrator files.
- Use no-activity timeout validation, focused tests first, and independent-agent review before accepting.

### Sources Read

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/src/tool/skill.ts`
- `packages/opencorvus/src/skill/mounts.ts`
- `packages/opencorvus/src/skill/skill.ts`
- `packages/opencorvus/src/expert-squad/registry.ts`
- `packages/opencorvus/src/expert-squad/builtin/general/expert-squad.jsonc`
- `packages/opencorvus/src/expert-squad/builtin/frontend-replica/expert-squad.jsonc`
- `packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`
- `packages/opencorvus/test/tool/skill.test.ts`
- `packages/opencorvus/test/server/skill-routes.test.ts`

### Repository Search Evidence

- `rg -n "resolveSkillProjection|selectorSkill|defaultSkill|default_skill|location|Skill\\.all|projectedSkill|productionSkill|renderSelector" packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts packages/opencorvus/src/tool/skill.ts packages/opencorvus/src/skill/mounts.ts packages/opencorvus/test/tool/skill.test.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/server/skill-routes.test.ts`
- `rg -n "SkillMount\\.resolve|SkillTool\\.init|SystemPrompt\\.skills|/skill/mounts|research-report|local-review|manual-refresh-skill|visual-acceptance|route-installed-skill" packages/opencorvus/test/server/skill-routes.test.ts packages/opencorvus/test/tool/skill.test.ts packages/opencorvus/test/agent/agent.test.ts packages/opencorvus/test/session/extra-tools.test.ts`
- `rg -n "default_skill_refs|default/skill|package_skill_refs" packages/opencorvus/src/expert-squad/builtin packages/opencorvus/test/fixture/expert-squad.ts packages/opencorvus/test/expert-squad/registry.test.ts packages/opencorvus/test -g "*.jsonc" -g "*.ts"`
- `rg -n "pathToFileURL\\(|<location>|skill\\.location|location\\)" packages/opencorvus/src/tool/skill.ts packages/opencorvus/src/server/routes/skill.ts packages/overlay/src -g "*.ts" -g "*.tsx"`

### Independent Agent Feedback

- Schrodinger's earlier Phase 8 read-only review identified a concrete selector boundary bug: project selector skills use the package manifest as `location`, and `SkillTool` derives the sampled file directory from `path.dirname(skill.location)`, so loading a selector can sample package production directories.
- Schrodinger also flagged default ordinary skill visibility as conflicting with explicit `default/skill/...` refs.
- Descartes independently confirmed the default ordinary skill full-projection bug is real and affects `SkillMount.resolve`, `/skill/mounts`, `SystemPrompt.skills`, and `SkillTool`. Descartes recommended removing the loop that pre-adds all default skills, adding explicit-only negative and positive tests, and keeping MCP, package tools, worker runtime, custom agents, SDK/OpenAPI, and overlay UI out of this corrective slice.
- Curie reviewed the corrective implementation and found one blocking authorization leak: an explicit `default/skill/<name>` ref still preserved the source skill file's original `mounted_agents`, so a stale or misspelled default skill mount could grant visibility outside the manifest role that named the ref. The fix changes projected default skills to `mounted_agents: [role]` and adds route/tool tests proving source `mounted_agents` does not authorize unrelated agents.
- Curie performed the final read-only review after that fix and returned no blocking findings. The review confirmed the full default-skill pre-add loop is removed, explicit default refs project only the manifest role, selector `SkillTool` loads no longer sample package production directories, and the unrelated WorkflowRegistry hunks in `prompt-profile-resolver.ts` must stay out of this commit. Curie's only non-blocking residual risk was that future generated skill surfaces must not use fake locations ending in `SKILL.md`.
- Banach completed a parallel read-only investigation for the next package custom tool runtime projection slice. That feedback is intentionally not implemented in Phase 8C.

### Phase 8C Planned Boundary

- Add a backend distinction in `SkillTool` between real filesystem `SKILL.md` files and generated/non-SKILL selector entries.
- Generated project selector entries must still be searchable/loadable by exact selector skill name, but loading them must omit bundled-file base directory text and sampled file listings.
- Add focused tests that load a project-generated selector under `general` and assert no package production paths or package definition names leak through the loaded selector output.
- Remove `resolveSkillProjection`'s pre-add-all-default-skills loop.
- Prove unreferenced ordinary default skills stay present in `/skill/installed` but absent from `/skill/mounts`, `SystemPrompt.skills`, and `SkillTool` until active `capability_projection` names them with `default/skill/<name>`.

### Phase 8C Implementation Result

- `PromptProfileResolver.resolveSkillProjection()` no longer pre-adds every default ordinary skill to the effective projected surface.
- Default ordinary skills now enter `SkillMount.resolve`, `/skill/mounts`, `SystemPrompt.skills`, and `SkillTool` only when the active expert-squad manifest names `default/skill/<name>` in the scheduler or agent projection. When projected, the manifest role is the authority: projected `mounted_agents` is `[role]`, not the source skill file's `mounted_agents`.
- `/skill/installed` remains the installed/default catalog view; `/skill/mounts` is the active runtime projection view. Existing import/mount routes can still write ordinary skill files and `mounted_agents`, but those fields do not grant runtime visibility without an active manifest ref.
- Generated selector skills are still searchable and loadable, but non-`SKILL.md` selector locations no longer cause bundled-file base directory text or sampled package files to appear in `SkillTool` load output.
- The test project expert-squad fixture now accepts explicit default skill refs per scheduler, build, and arbitrary agent projection without importing the production registry, avoiding a test-only circular import.

### Phase 8C Validation

- After Curie's blocking finding:
  - `bun test --timeout=2147483647 packages/opencorvus/test/tool/skill.test.ts packages/opencorvus/test/server/skill-routes.test.ts -t "mounted_agents outside manifest refs|default skill mounted_agents"` passed: 2 pass.
  - `bun test --timeout=2147483647 packages/opencorvus/test/server/skill-routes.test.ts -t "ignores stale default skill mounted_agents"` passed: 1 pass.
  - `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/tool/skill.test.ts packages/opencorvus/test/server/skill-routes.test.ts` passed without name filtering: 45 pass, 1 skip.
  - `bun test --timeout=2147483647 packages/opencorvus/test/agent/agent.test.ts -t "orchestrator skill policy|skill policy follows|frontend agents expose"` passed: 3 pass.
  - `bun run --cwd packages/opencorvus typecheck` passed.
- Broad `packages/opencorvus/test/agent/agent.test.ts` currently has one failure outside Phase 8C: `native stage agent registry tool surfaces match role boundaries` expects visual-qa to expose `bash`, while unrelated dirty visual-qa static-tool changes in the worktree have removed that tool. This is not staged or claimed as Phase 8C validation.
- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/tool/skill.test.ts packages/opencorvus/test/server/skill-routes.test.ts packages/opencorvus/test/agent/agent.test.ts -t "skill projection|default skill refs|default ordinary|active project package|skill routes|skill policy|frontend agents expose skill loading|project expert-squad selector|visual-qa can load acceptance|integrity can search|execute without name|execute returns skill content|installed skill remains|refresh=true|POST /skill/mount|external installed skills|integrity as mountable|import-and-mount|rejects SKILL.md mounted_agents"` passed: 35 pass, 1 skip.
- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/tool/skill.test.ts packages/opencorvus/test/server/skill-routes.test.ts packages/opencorvus/test/session/extra-tools.test.ts packages/opencorvus/test/agent/agent.test.ts -t "skill projection|default skill refs|default ordinary|active project package|skill routes|exact runtime contract|runtime expert-squad skill|runtime skill under exact stage contracts|skill policy|frontend agents expose skill loading|project expert-squad selector|visual-qa can load acceptance|integrity can search|execute without name|execute returns skill content|installed skill remains|refresh=true|POST /skill/mount|external installed skills|integrity as mountable|import-and-mount|rejects SKILL.md mounted_agents"` passed: 39 pass, 1 skip.
- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/tool/skill.test.ts packages/opencorvus/test/server/skill-routes.test.ts` passed before Curie's follow-up fix without name filtering: 43 pass, 1 skip.
- `bun run --cwd packages/opencorvus typecheck` passed.
- `bun test --timeout=2147483647 packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts` passed: 65 pass.
- `bun run api:routes-check` passed.
- Scoped `git diff --check` over Phase 8C touched files passed.

Phase 9 Recall, 2026-07-04:

### User Request

- Continue implementing and testing the dynamic `.opencorvus` expert-squad architecture through independent-agent adversarial implementation and review.
- Preserve the original architecture goal: selected expert-squad packages can define tool definitions under their clear-text package directory, but runtime exposure must be derived from the active manifest ID and capability projection, not from folder names, global scans, fallback routes, or UI filtering.

### Acceptance Criteria For This Slice

- Active project expert-squad scheduler `package_tool_refs` enter the Orchestrator exact runtime contract.
- Package tool files are loaded only from the active project package and only when `capability_projection.scheduler.package_tool_refs` names the canonical package ref.
- Provider-facing package tool names are deterministic, safe, and distinct from canonical refs, bare file names, built-in tool IDs, global custom tool IDs, and plugin tool IDs.
- Package tools do not enter `ToolRegistry.ids()`, `ToolRegistry.tools()`, `SkillMount`, `SkillTool`, `/skill/mounts`, or worker agent tool surfaces in this slice.
- Inactive packages are not imported for package tool execution during general/built-in profile runtime projection.
- Active package tool import or shape errors fail visibly; they must not be skipped like the flat custom-tool scanner.
- MCP projection, worker runtime package-tool projection/hash binding, package custom agents, and package-tool pack/unpack cache invalidation remain out of this slice and must not be claimed as implemented.

### Hard Constraints

- No fallback, compatibility alias, hidden route, host-side gate, `ToolRegistry` global scan, UI-only filtering, or same-turn synthetic tool table mutation.
- Do not create a new worktree, do not run `git reset`, and do not stage unrelated dirty direct-build, Visual QA, Integrity, SDK/OpenAPI, or import/session files.
- Package tool module code executes at import time; therefore inactive packages must not be imported while resolving another active profile.
- Existing running OpenCorvus/overlay processes must not be restarted or refreshed.

### Sources Read

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/src/expert-squad/registry.ts`
- `packages/opencorvus/src/tool/registry.ts`
- `packages/opencorvus/src/tool/tool.ts`
- `packages/plugin/src/tool.ts`
- `packages/opencorvus/src/orchestrator/agent.ts`
- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/src/agent/tool-pool-contract.ts`
- `packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`
- `packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts`
- `packages/opencorvus/test/expert-squad/registry.test.ts`
- `packages/opencorvus/test/fixture/expert-squad.ts`

### Repository Search Evidence

- `rg -n "package_tool_refs|default_tool_refs|resolveSchedulerCapability|builtInToolIDs|projectTool|ToolRegistry|privateRegistryTools|createOrchestratorTools|setSessionRuntimeContract|SessionRuntimeContract|Tool\\.Info|AgentToolPool|GLOBAL_TOOL_IDS" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`: package tool refs are validated in the registry and fixture but scheduler runtime currently projects only built-in tool IDs.
- `rg -n "projectOrchestratorTools\\(" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`: call sites are limited to Orchestrator runtime setup and focused resolver tests, so converting projection to async is scoped.
- `rg -n "export.*ToolDefinition|interface ToolDefinition|type ToolDefinition|ToolContext" packages/plugin packages/opencorvus/src -g "*.ts"`: `@opencorvus-ai/plugin` already owns a mature `ToolDefinition` ABI with Zod args and execute context.
- `rg -n "package_tool_refs|tools/source-evidence|build-evidence|unsupported tool extension|declared in agents" packages/opencorvus/test/expert-squad packages/opencorvus/test/fixture -g "*.ts"`: package tool files are validated as refs today, but current fixtures export `{}` and do not prove executable tool definitions.

### Independent Agent Feedback

- Godel found the correct runtime path is the existing Orchestrator exact-runtime contract: resolve active scheduler capability, build raw Orchestrator tools, materialize active package scheduler tools, merge before `toolGuard()`, and install the merged table into `SessionRuntimeContract`. Godel warned not to touch `ToolRegistry.state()` because it is flat and forgiving.
- Godel recommended splitting identity into canonical authorization refs (`<expert_squad_id>/<owner>/<tool_id>`) and provider-facing names such as `pkg_tool__<sanitized-ref-hint>__<hash>`, plus hard collision checks.
- Godel recommended tests proving active package tools appear only under the active project profile, general profile remains clean, ownership declarations alone do not grant visibility, inactive broken packages are not imported, and global `ToolRegistry` stays clean.
- Mencius confirmed package tool runtime projection is missing and flagged blockers: flat `ToolRegistry` loading silently skips failures; TypeScript import executes top-level code; provider-name collisions can overwrite exact runtime tool maps; and current runtime contract identity does not yet carry profile/projection identity for worker stale-continuation enforcement.
- Mencius accepted `@opencorvus-ai/plugin` `ToolDefinition` as the package-tool module ABI only, not as the loader/registry contract. Active package imports must fail hard on import or shape errors.
- Mencius recommended additional future tests for worker projection/hash binding and package replacement stale module cache; those remain outside Phase 9 scheduler-only scope.

### Phase 9 Planned Boundary

- Add package-tool projection helpers under the expert-squad resolver domain.
- Expose a deterministic helper for package tool provider names derived from canonical package refs.
- Implement active scheduler package-tool materialization from `capability_projection.scheduler.package_tool_refs` only.
- Convert `PromptProfileResolver.projectOrchestratorTools()` to async so it can merge raw built-in tools with active package tools.
- Reuse the `@opencorvus-ai/plugin` `ToolDefinition` ABI for package tool files, but implement a package-scoped loader that:
  - resolves refs to contained package paths;
  - imports only active projected refs;
  - validates the exported definition shape;
  - wraps execution with the OpenCorvus `Tool.Info` contract and plugin-like context;
  - records canonical ref/package/source metadata in tool result metadata.
- Update focused tests:
  - active project package scheduler runtime includes the deterministic package provider tool name;
  - general profile with a project package does not expose package tools;
  - package tool declaration in `agents.orchestrator.tool_refs` without scheduler projection does not expose the tool;
  - inactive broken package tools are not imported while another profile is active;
  - active invalid package tool shape fails visibly;
  - `ToolRegistry.ids()` / `ToolRegistry.tools()` do not expose canonical, bare, or provider package tool names.

### Phase 9 Remaining Boundary

- MCP projection remains unimplemented.
- Worker package-tool runtime projection and projection-hash continuation validation remain unimplemented.
- Package custom agents remain unimplemented.
- Package replacement stale ESM import cache validation remains unimplemented.

### Phase 9 Implementation Result

- `ResolvedSchedulerCapability` now carries active scheduler `packageToolRefs`, deterministic `packageToolProviderNames`, and the active package root for project packages. Built-in/general profiles keep package tool refs empty.
- `PromptProfileResolver.packageToolProviderName()` derives provider-facing names as `pkg_tool__<sanitized-ref-hint>__<hash>`, while the manifest canonical ref remains the authorization identity.
- `PromptProfileResolver.projectOrchestratorTools()` is async and merges two surfaces only: existing explicit built-in Orchestrator tools and active scheduler package tools. Provider-name collisions with built-ins or raw Orchestrator tools fail visibly.
- Package tool loading stays under the expert-squad resolver instead of `ToolRegistry`. The loader validates the canonical package ref, resolves only contained `.ts`/`.js` files under the active package, rejects symbolic links, and fails when a projected file is missing.
- Active package tool files use the existing `@opencorvus-ai/plugin` `ToolDefinition` application binary interface. The loader compiles the active tool file through `Bun.build()` into a content-addressed temporary ECMAScript module bundle, resolves the runtime `@opencorvus-ai/plugin` package as the single ABI source, imports only that compiled active module, and rejects non-`ToolDefinition` exports.
- Package tool execution requires real session/message identity in the AI SDK execution options, supplies a scheduler-scoped plugin context, refuses permission prompts, truncates output through `Truncate.output()`, and returns metadata for canonical ref, expert-squad ID, provider tool name, source path, and truncation state.
- Orchestrator runtime setup now awaits the projected tool table before `toolGuard()` and installs the merged result into the exact `SessionRuntimeContract`.
- The project expert-squad fixture now writes executable package tool definitions for `source-evidence` and `build-evidence`, with optional scheduler package-tool refs so tests can distinguish declaration from projection.

### Phase 9 Independent Review Result

- Helmholtz performed a final read-only review of the Phase 9 diff. The package-tool projection logic had no blocking findings: active scheduler package tools stay out of `ToolRegistry`, `SkillTool`, and MCP surfaces; inactive package modules are not imported; deterministic provider names are exposed instead of canonical refs; and active invalid exports fail visibly.
- Helmholtz found two commit-boundary blockers in mixed dirty files: unrelated WorkflowRegistry migration hunks in `prompt-profile-resolver.ts`, and unrelated attachment/context-packet hunks in `orchestrator/agent.ts`. The staged Phase 9 snapshot excludes both unrelated hunks; only the package-tool resolver changes and the awaited Orchestrator projection call are staged from those files.

### Phase 9 Validation

- `bun run --cwd packages/opencorvus typecheck` passed.
- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts -t "resolves active project package scheduler package tools|fails visibly when active package tool export"` passed: 2 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts -t "resolves active project package scheduler package tools|fails visibly when active package tool export|inactive package tool|declared package tools|general scheduler projection"` passed: 5 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts packages/opencorvus/test/tool/skill.test.ts packages/opencorvus/test/tool/registry.test.ts` passed: 38 pass, 400 expect calls.
- `bun test --timeout=2147483647 packages/opencorvus/test/script/historical-docs-links.test.ts` passed: 19 pass.
- `git diff --check` passed. It emitted CRLF warnings for unrelated pre-existing dirty files outside the Phase 9 staged set; no whitespace errors were reported.

## Phase 10 Recall, 2026-07-04

### User Request

- Built-in expert squads must contain only the scheduler/default squad.
- All other expert squads must move to `.opencorvus`.
- Continue scanning and resolve residual problems after the move.

### Acceptance Criteria For This Slice

- `packages/opencorvus/src/expert-squad/builtin` embeds only the default scheduler package, currently manifest ID `general`.
- `frontend-replica`, `frontend-innovate`, `frontend-automation-debug`, `backend`, and `algorithm` live as clear-text packages under `.opencorvus/expert-squads/<id>`.
- `.gitignore` versions `.opencorvus/expert-squads/**` while keeping runtime and local entries such as `.opencorvus/r`, `.opencorvus/runtime`, preview logs, local config, and process markers ignored.
- `PromptProfile.builtIns` and built-in package collision checks recognize only the scheduler/default package as built in.
- Project-scoped package discovery remains the only source for non-default expert-squad profiles and selector skills.
- Orchestrator and tool descriptions do not hardcode non-default expert squads as built-in facts; concrete IDs come from the prompt-profile catalog or mounted selector skills.
- Tests prove the default built-in boundary, project package catalog/selector visibility, and absence of built-in domain package imports.

### Hard Constraints

- No fallback loading, compatibility aliases, name guessing, host-side gates, hidden routing, or double-source expert-squad definitions.
- Do not rename the scheduler/default package ID in this slice. `general` remains the default ID because it is already the active config default and changing it would be a separate identity migration.
- Do not create a new worktree, run `git reset`, or disturb unrelated dirty files.
- Do not restart, refresh, or kill running OpenCorvus or overlay processes.
- Any TypeScript or test change in this slice must receive focused tests and typecheck validation.

### Sources Read

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md`
- `.gitignore`
- `packages/opencorvus/src/expert-squad/builtin/index.ts`
- `packages/opencorvus/src/expert-squad/manager.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/src/agent/prompt-profile.ts`
- `packages/opencorvus/src/skill/skill.ts`
- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/test/agent/prompt-profile.test.ts`
- `packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts`
- `packages/opencorvus/test/agent/role-contract.test.ts`
- `packages/opencorvus/test/expert-squad/package-manager.test.ts`

### Repository Search Evidence

- `rg -n "builtInPackageSources|loadedBuiltInPackages|builtInPromptProfiles|builtInSelectorSkillSources" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`: hardcoded built-in source consumption is limited to `builtin/index.ts`, `PromptProfile`, `PromptProfileResolver`, `Skill`, and focused tests.
- `rg -n "src/expert-squad/builtin|expert-squad/builtin|builtin/(frontend-replica|frontend-innovate|frontend-automation-debug|backend|algorithm)|frontend-replica/selector|frontend-innovate/selector|frontend-automation-debug/selector" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-07 -g "*.ts" -g "*.md"`: production domain package imports exist only in `builtin/index.ts`; historical specs mention old locations and should be superseded by this phase record rather than rewritten.
- `rg -n "PromptProfile\\.builtIns|PromptProfile\\.list|prompt_profile\\.active|assertKnownProfileID|frontend-replica|frontend-innovate|frontend-automation-debug|\\bbackend\\b|\\balgorithm\\b" packages/opencorvus/src packages/opencorvus/test -g "*.ts" -g "*.txt"`: residual built-in assumptions live mainly in prompt-profile tests, role-contract prompt catalog tests, Orchestrator prompt/tool copy, skill tests, session extra-tools tests, and Orchestrator tool tests.
- `rg -n "resolveSkillProjection|SystemPrompt\\.skills|skill projection|selectorSkillNames|builtin-skills|expert-squad" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`: selector skills are already projected from project packages by `PromptProfileResolver.resolveSkillProjection`; tests still expect the old built-in selector set.
- `.opencorvus` currently contains local/runtime entries `preview-logs`, `r`, `dev-server.pid`, and `opencorvus.jsonc`, so only `.opencorvus/expert-squads/**` may be unignored.

### Independent Agent Feedback

- Rawls is running a read-only audit of residual code/test assumptions that treat domain expert squads as built-in.
- Hubble is running a read-only audit of `.opencorvus` versioning, registry, package-manager, and selector/catalog consequences.
- Their findings must be reviewed before final validation and recorded in this section.

### Phase 10 Planned Boundary

- Move domain package directories from `packages/opencorvus/src/expert-squad/builtin/<id>` to `.opencorvus/expert-squads/<id>`.
- Keep `packages/opencorvus/src/expert-squad/builtin/general` as the only embedded package source.
- Update `.gitignore` so the repo tracks the moved packages without tracking local `.opencorvus` runtime or config entries.
- Update production copy and tests so built-in means `general` only, while root project packages provide domain catalog and selector behavior.
- Add focused assertions proving no non-default package remains in `builtInPackageSources` or `PromptProfile.builtIns`.

### Phase 10 Implementation Result

- Domain expert-squad packages `frontend-replica`, `frontend-innovate`, `frontend-automation-debug`, `backend`, and `algorithm` now live under `.opencorvus/expert-squads/<id>`.
- `packages/opencorvus/src/expert-squad/builtin` embeds only `general`; built-in prompt profile and selector exports are derived from that one package.
- `.gitignore` tracks `.opencorvus/expert-squads/**` while leaving `.opencorvus` runtime/config entries ignored.
- Orchestrator selection copy and tool schema copy now refer to catalog/loaded selector skills rather than hardcoding non-default squads as built-ins.
- Test fixtures copy repository expert-squad packages into temp project `.opencorvus/expert-squads` when they need domain profiles.

### Phase 10 Residual Scan

- `rg -n "packages/opencorvus/src/expert-squad/builtin/(frontend-replica|frontend-innovate|frontend-automation-debug|backend|algorithm)|expert-squad/builtin/(frontend-replica|frontend-innovate|frontend-automation-debug|backend|algorithm)|builtin/(frontend-replica|frontend-innovate|frontend-automation-debug|backend|algorithm)" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-07 -g "*.ts" -g "*.md" -g "*.txt"`: production/test references to old embedded domain package paths are gone; remaining hits are historical specs that record older work.
- `rg -n "frontend-replica|frontend-innovate|frontend-automation-debug|\\bbackend\\b|\\balgorithm\\b" packages/opencorvus/src/expert-squad packages/opencorvus/src/agent/prompt-profile.ts packages/opencorvus/src/skill/skill.ts packages/opencorvus/src/prompt/core/orchestrator-core.txt packages/opencorvus/src/orchestrator/tools.ts -g "*.ts" -g "*.txt"`: remaining production hits are generic wording or runtime task-domain text, not built-in package loading.

### Phase 10 Validation

- `bun run --cwd packages/opencorvus typecheck` passed.
- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/registry.test.ts packages/opencorvus/test/expert-squad/package-manager.test.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts` passed: 74 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/tool/skill.test.ts packages/opencorvus/test/session/extra-tools.test.ts packages/opencorvus/test/server/config-routes.test.ts packages/opencorvus/test/server/skill-routes.test.ts packages/opencorvus/test/server/task-create-route.test.ts packages/opencorvus/test/server/task-message-routes.test.ts` passed: 123 pass, 1 skip.
- `bun test --timeout=2147483647 packages/opencorvus/test/agent/prompt-profile.test.ts packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts packages/opencorvus/test/agent/core-prompt-hygiene.test.ts packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts` passed: 107 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/orchestrator/tools.test.ts -t "select_expert_squad writes only active profile|frontend innovate expert squad runs visible skill selection"` passed: 2 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts` passed: 65 pass.
- `bun run api:routes-check` passed.
- `git diff --check` passed with CRLF warnings only.

## Phase 20 MCP Prompt/Resource Prompt-Composition Closure, 2026-07-04

### Recall

- Current objective remains the full dynamic expert-squad source refactor: built-in source keeps only `general`; domain squads load from `.opencorvus/expert-squads/<id>` by manifest `id`; active README is the Orchestrator append prompt; dynamic package tools, skills, and MCP definitions are projected from the active expert-squad capability without fallback, inactive leakage, or double-source behavior.
- Continuation audit found a real runtime gap after Phase 14: `PromptProfileResolver.projectSchedulerMcpPrompts()`, `projectWorkerMcpPrompts()`, `projectSchedulerMcpResources()`, and `projectWorkerMcpResources()` had tests, but production prompt composition did not call them. The model could receive projected MCP tools, but projected MCP prompt/resource refs did not enter the final scheduler or worker system prompt.
- Current acceptance for this slice: when an active scheduler or worker capability projects MCP prompts/resources, `PromptProfileResolver.composeAgentPrompt()` must load those scoped MCP prompt/resource payloads and append them to the final composed prompt; inactive package MCP prompts/resources must still stay absent from global `MCP.prompts()`, `MCP.resources()`, `MCP.serverPrompts()`, and `MCP.serverResources()`.
- Hard constraints: no global registration of package MCP prompt/resource definitions, no fallback to inactive packages, no name-only MCP lookup, no UI-only filtering, no prompt-composition opt-out switch, and no hidden compatibility path.

### Search Evidence

- `rg -n "MCP\\.(status|connect|disconnect|serverTools|serverPrompts|serverResources|tools\\(|prompts\\(|resources\\(|callTool)|projectSchedulerMcpPrompts|projectWorkerMcpPrompts|projectSchedulerMcpResources|projectWorkerMcpResources|scopedPromptInfo|scopedResourceInfo|getScopedPrompt|readScopedResource" packages/opencorvus/src packages/opencorvus/test -g "*.ts"` showed production calls for global MCP lists and tests for scoped prompt/resource projection, but no production call from final prompt composition into the projected scoped prompt/resource functions.
- `rg -n "projectSchedulerMcpPrompts|projectSchedulerMcpResources|projectWorkerMcpPrompts|projectWorkerMcpResources|composeAgentPrompt" packages/opencorvus/src/orchestrator/agent.ts packages/opencorvus/src/agent/runner.ts packages/opencorvus/src/session/system.ts packages/opencorvus/src/session/loop.ts packages/opencorvus/test -g "*.ts"` showed `composeAgentPrompt()` was the single prompt-composition boundary used by Orchestrator and worker agents.
- `packages/opencorvus/test/fixture/package-mcp-server.ts` exposes a real `inspect` prompt and `dom` resource fixture, so the regression can prove real scoped MCP prompt/resource payloads enter composed prompt text instead of only validating schema metadata.

### Finding

- Phase 14 implemented scoped MCP prompt/resource proxy functions but stopped at resolver-level projection. That was not enough for runtime support because final model context is assembled through `PromptProfileResolver.composeAgentPrompt()`.
- Treating the resolver tests as runtime evidence would have left a false-green gap: a manifest could project `package_mcp_prompt_refs` or `package_mcp_resource_refs`, those refs could pass validation and direct resolver tests, yet the scheduler/worker model would never receive the projected prompt/resource content.

### Implementation

- `PromptProfileResolver.composeAgentPrompt()` now resolves the active scheduler capability for `orchestrator`, or the active worker capability for known agent roles, and appends a `## Projected MCP Context` section when that capability projects MCP prompts/resources.
- The MCP context is built only from `projectSchedulerMcpPrompts()`, `projectWorkerMcpPrompts()`, `projectSchedulerMcpResources()`, and `projectWorkerMcpResources()`, preserving active capability as the single runtime source.
- Package MCP prompt/resource definitions still use scoped clients from the active package definition file and remain absent from global MCP prompt/resource/server proxy lists.
- No-argument MCP prompts are invoked with explicit `{}`. Prompts with required arguments still fail through the MCP server's real validation rather than being skipped.
- Custom agent names that are not `AgentRoleContract` roles are not pulled into expert-squad capability projection. Known role agents remain fail-fast if the active package does not define the required worker capability.

### Validation

- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts` initially failed when no-argument prompt invocation sent `undefined`; this exposed the real MCP SDK argument contract.
- After changing no-argument projected prompt reads to pass `{}`, `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts` passed: 31 pass.
- `bun run --cwd packages/opencorvus typecheck` passed.
- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/registry.test.ts packages/opencorvus/test/expert-squad/package-manager.test.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts` passed: 93 pass.
- A combined `bun test --timeout=2147483647 packages/opencorvus/test/agent/prompt-profile.test.ts packages/opencorvus/test/agent/runner-prompt.test.ts packages/opencorvus/test/skill/skill.test.ts packages/opencorvus/test/tool/skill.test.ts` run timed out at the outer command after 184 seconds while running under parallel validation pressure and produced no failing assertion. The same coverage was split and rerun:
  - `bun test --timeout=2147483647 packages/opencorvus/test/agent/prompt-profile.test.ts packages/opencorvus/test/agent/runner-prompt.test.ts` passed: 30 pass.
  - `bun test --timeout=2147483647 packages/opencorvus/test/skill/skill.test.ts packages/opencorvus/test/tool/skill.test.ts` passed: 38 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts` passed: 66 pass.

## Phase 18 Browser Preview Fixture Contract Closure, 2026-07-04

### Recall

- Current user request remains: only the scheduler/default expert squad is built in, all other expert squads load from `.opencorvus/expert-squads/<id>`, and residual issues after the move must be scanned and fixed rather than waived.
- The expert-squad `README.md` runtime design remains unchanged: the active package root README is appended only to the Orchestrator prompt; inactive discovery uses manifest selector metadata and optional `selector.md`; agent role behavior remains in `agents/<agent_id>/system.md`.
- Sources reread before this correction: `AGENTS.md`, `specs/README.md`, `specs/records/2026-07/README.md`, this record's Phase 11 and Phase 17 Recall sections, and `specs/records/2026-07/2026-07-02-runtime-status-timing-root-repair.md`.

### Search Evidence

- `rg -n "__taskRowSelectDebug|__selectTaskFromTaskListDebug|__selectTaskDebug|__browserPreviewStressClicks|directSolidClickDiagnostics|otherTaskClickDiagnostics|handlerKeys|hasSolidClick|hasInlineClick" packages/overlay/src packages/overlay/test/browser/browser-preview-visual-stress.test.ts` returned no hits after diagnostic cleanup.
- Runtime diagnostics captured during the failing browser test showed `/log` entry `task tsk_browserpreview_visual_stress runtime activity requires a positive task.time.started timestamp`.
- `packages/overlay/src/services/task-runtime-activity.ts` treats missing or invalid active runtime timestamps as a data-contract error.
- `specs/records/2026-07/2026-07-02-runtime-status-timing-root-repair.md` records that runtime timing must use persisted task timestamps and reject invalid data rather than infer a wall-clock fallback.

### Causal Chain

- Observable failure: after selecting stale preview target `art_previewtarget_visual_stale`, clicking the second task row did not reach "No browser preview target is saved for this task."; the Browser panel remained in the old selection-failed state.
- Direct trigger: task switching calls `stopSSE()` for the previously selected active task, and that path restored runtime activity from the selected task.
- Deep cause: the stress-test fixture declared active tasks without positive `time.started` values. That violated the selected-task runtime timing contract and caused the switch handler to throw before the selected task state could change.
- Why this is not a product fallback fix: production code is correct to reject invalid active runtime data. Adding a missing-time fallback would violate the July 2 timing repair and hide corrupted task records.

### Implementation

- Added positive `time.started` values to both active tasks in `packages/overlay/test/browser/browser-preview-visual-stress.test.ts`.
- Kept focused failure diagnostics that report selected source, selected board task ID, active row task ID, settings directory, request log, and `/log` bodies when the cross-task Browser Preview assertion fails.
- Left product code unchanged; temporary click-handler diagnostics were removed.

### Validation

- `node test/browser-runner.mjs test/browser/browser-preview-visual-stress.test.ts` passed: 1 pass.
- Visual review of `packages/overlay/.scratch/browser-preview-visual-stress/05-cross-task-missing-clears-selection.png` confirmed the Browser panel shows the current task's "No browser preview target is saved for this task." empty state and no stale selection-failed panel.
- `bun run --cwd packages/overlay typecheck` passed.
- `bun test --timeout=2147483647 packages/overlay/test/sse-active-elapsed.test.ts packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/prompt-profile-task-session-owner.test.ts` passed: 22 pass.

## Phase 19 Expert-Squad Git Ignore Completeness Repair, 2026-07-04

### Recall

- Current objective remains the full expert-squad source refactor: built-in source keeps only `general`; domain squads are repository packages under `.opencorvus/expert-squads/<id>`; package IDs come from `expert-squad.jsonc`; package README is active Orchestrator append prompt; dynamic package tool, skill, and MCP projections stay scoped to the active expert-squad ID.
- Acceptance for this slice: every manifest-referenced source file in repository `.opencorvus/expert-squads/**` must be visible to Git, including agent folders named `build`; generic build-output ignore rules must not hide expert-squad source definitions.
- Sources reread before implementation: `AGENTS.md`, `specs/README.md`, `specs/records/2026-07/README.md`, this record's Recall and Phase 18, `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`, and its `open-corvus-expert-squad-checklist.md`.

### Search Evidence

- `Get-ChildItem -Recurse -File .opencorvus/expert-squads` showed each migrated domain package contains `agents/build/system.md`.
- `git status --short -- .opencorvus/expert-squads/*/agents/build/system.md` initially returned no entries, while `git check-ignore -v .opencorvus/expert-squads/algorithm/agents/build/system.md` showed `.gitignore:59:build/`.
- The domain manifests reference these files, for example `agents.build.prompt = "agents/build/system.md"` in `algorithm`, `backend`, `frontend-replica`, `frontend-innovate`, and `frontend-automation-debug`.
- `git ls-files --ignored --others --exclude-standard -- .opencorvus/expert-squads` returned no files after the repair.

### Finding

- The top-level `.gitignore` correctly unignored `.opencorvus/expert-squads/**` near the local `.opencorvus/*` rule, but a later generic `build/` output rule re-ignored nested directories named `agents/build/`.
- This would make the checkout miss manifest-referenced Build agent prompt overlays even though local validation passed on the developer machine. The result would be an incomplete repository package source and a false sense that the migration was committed.

### Implementation

- Added explicit `.gitignore` unignore rules after the generic `build/` rule for `.opencorvus/expert-squads/**/agents/build/` and its contents.
- Added a `document-health` regression that enumerates repository expert-squad packages and uses `git check-ignore -v --no-index` to assert no `agents/build/system.md` path is hidden by a positive ignore rule.

### Validation

- `bun test --timeout=2147483647 packages/opencorvus/test/script/document-health.test.ts -t "expert-squad build agent prompts"` passed: 1 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/historical-docs-links.test.ts` passed: 66 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/registry.test.ts packages/opencorvus/test/expert-squad/package-manager.test.ts` passed: 62 pass.
- `git diff --check` passed with CRLF warnings only.

## Phase 17 Overlay Fixture And API Residual Closure, 2026-07-04

### Recall

- Current user request: only the scheduler/general expert squad remains built in; all other expert squads live under `.opencorvus/expert-squads/<id>`; continue scanning and solve residual issues.
- The user also clarified that expert-squad `README.md` is scheduler/Orchestrator append prompt content. Phase 11 remains the accepted design: active package README appends only to the Orchestrator prompt, while `selector.md` remains inactive discovery text.
- Sources reread before this slice: `AGENTS.md`, `specs/README.md`, `specs/records/2026-07/README.md`, this record's Phase 11/12 Recall, and `opencorvus-expert-squad-creator` with its checklist.
- Independent follow-up review inputs:
  - Boyle found no live-code blocker in package source, identity, import, or export; noted package export should reject installed packages containing `.opencorvus/r` runtime internals.
  - Confucius found runtime projection uses active `prompt_profile.active` and no direct projection blocker remained.
  - Tesla found stale overlay browser fixtures still represented domain profiles as `built_in: true`, and API docs did not clearly expose project package-backed prompt profiles.

### Search Evidence

- `Get-ChildItem packages/opencorvus/src/expert-squad/builtin -Force` showed only `general/` and `index.ts`.
- `rg -n 'expert-squad/builtin/(algorithm|backend|frontend-|frontend)|builtin/(algorithm|backend|frontend-)|PromptProfile\.builtIns\["(frontend|backend|algorithm)' packages/opencorvus/src packages/opencorvus/test -g '*.ts' -g '*.md' -g '*.txt'` returned no live hits.
- `rg -n 'id: "(frontend-replica|frontend-innovate|frontend-automation-debug|backend|algorithm)"[\s\S]{0,240}?built_in: true|built_in: true[\s\S]{0,240}?id: "(frontend-replica|frontend-innovate|frontend-automation-debug|backend|algorithm)"' packages/overlay/test/browser -g '*.test.ts'` returned no hits.
- A broader grep still finds historical records that mention old built-in files and current `source_baseline_input` frontend-design data roles. Those are not expert-squad source residuals.

### Implementation

- Added `packages/overlay/test/browser/prompt-profile-fixture.ts` so browser fixtures use the current prompt-profile catalog shape with `project_active`, `session_active`, `capability_profile_id`, `projection_hash`, `projected_agents`, and full capability projection arrays.
- Replaced stale overlay browser prompt-profile fixtures so domain/project profiles such as `frontend-replica`, `frontend-innovate`, `frontend-automation-debug`, `backend`, and `algorithm` are represented as package-backed `built_in: false`; only `general` remains built in.
- Added package-manager regression coverage that an installed expert-squad package containing OpenCorvus runtime internals such as `.opencorvus/r` is rejected before export.
- Updated `/config/prompt-profile` OpenAPI route summary and description to state the single active `prompt_profile.active` value, built-in `general`, and current-project `.opencorvus/expert-squads/<id>` package-backed profiles with capability projections.
- Regenerated `packages/sdk/openapi.json`, SDK generated types, and English/Chinese API reference docs.
- Fixed `workspace-terminal-open.test.ts` fixture SSE handling for `/task/events`; the missing `text/event-stream` response caused browser error collection to throw during `browser.close()` and left Node test children behind.

### Validation

- `bun run --cwd packages/opencorvus typecheck` passed.
- `bun run --cwd packages/overlay typecheck` passed after the overlay fixture edits.
- `bun run --cwd packages/sdk/js build` passed and regenerated SDK sources.
- `bun run typecheck` passed across the workspace, including SDK import and AI runtime checks.
- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/package-manager.test.ts` passed: 19 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/registry.test.ts packages/opencorvus/test/expert-squad/package-manager.test.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts` passed: 93 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts` passed: 65 pass.
- `bun run api:routes-check` passed.
- `bun run docs:check` passed.
- `git diff --check` passed with CRLF warnings only.
- Overlay browser validations using Node runner passed:
  - `node test/browser-runner.mjs test/browser/config-dialog-resizer.test.ts`: 1 pass.
  - `node test/browser-runner.mjs test/browser/command-palette.test.ts`: 1 pass.
  - `node test/browser-runner.mjs test/browser/workspace-terminal-open.test.ts`: 3 pass.
  - `node test/browser-runner.mjs test/browser/prompt-profile-selector-browser.test.ts`: 2 pass.
  - `node test/browser-runner.mjs test/browser/prompt-profile-panel.test.ts`: 1 pass.
  - `node test/browser-runner.mjs test/browser/executor-selector-redesign.test.ts`: 1 pass.
  - `node test/browser-runner.mjs test/browser/screenshot-browser-panel-browser.test.ts`: 1 pass.
  - `node test/browser-runner.mjs test/browser/config-dialog-resizer.test.ts test/browser/command-palette.test.ts`: 2 pass.

### Formerly Unaccepted Evidence, Closed In Phase 18

- `node test/browser-runner.mjs test/browser/browser-preview-visual-stress.test.ts` failed twice at the same cross-task preview-state assertion.
- Observable failure: after selecting stale preview target `art_previewtarget_visual_stale`, clicking the other task row does not reach the expected "No browser preview target is saved for this task." state before the no-activity assertion. The UI remains on `browser-preview-selection-failed` for `tsk_browserpreview_visual_stress`.
- Phase 18 closes this residual as a fixture contract error rather than a product browser-preview state reset bug. The active test tasks lacked positive `time.started` values, so selected-task Server-Sent Events runtime restoration threw before task selection could switch.
- The corrected fixture and visual screenshot are now accepted evidence for this residual closure.

## Phase 16 Static Selector Contract Residual, 2026-07-04

### Recall

- Current user request: continue checking code changes after moving all non-`general` expert squads to `.opencorvus`, and preserve the clarified README design where the active expert-squad README is appended only to the Orchestrator prompt.
- Current acceptance for this slice: static regression tests must protect the catalog-only selector discovery path. General selector discovery and general prompt/config catalog paths must not require full package loading of inactive expert squads.
- Hard constraints: no fallback, no compatibility alias, no second active selection field, no folder-name identity, no inactive production capability leakage, and no stale test that reintroduces full inactive package loading.

### Sources And Search Evidence

- Reread before implementation: this record's Recall and Phase 15 catalog/full-load split, `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`, `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`, `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`, `packages/opencorvus/src/expert-squad/registry.ts`, and `packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts`.
- `rg -n "README|readme|selector|append|prompt-profile|expert-squad" packages/opencorvus/src packages/opencorvus/test specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md` confirmed the README runtime design remains active-Orchestrator-only and selector discovery uses selector metadata.
- `packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts` still asserted `ExpertSquadRegistry.loadPackage(path.join(canonicalBase(projectDirectory), entry.id), options)` inside `selectorCatalog()`, which is the retired full inactive package load path from before Phase 15.

### Finding

- The static homogeneity test was stale. It was protecting the old behavior that general selector discovery must fully load every project package, directly contradicting the Phase 15 fix that inactive broken MCP definitions must not break general selector/catalog behavior.

### Planned Implementation

- Update the static test to assert `selectorCatalog()` discovers package metadata and does not call `ExpertSquadRegistry.loadPackage()` in that function.
- Keep full `loadPackage()` assertions out of selector discovery; active project selection still uses `loadProjectPackageByID()` and fails visibly on broken production definitions.
- Run the focused homogeneity test and the expert-squad resolver tests after the change.

### Independent Review Feedback

- Ramanujan found no Axis-A production blocker: built-in expert-squad source imports only `general`; import/export use manifest `id` and canonical folder validation. He flagged `backend` and `algorithm` as package-backed but not selector-skill discoverable, matching the existing intentional boundary pending product decision.
- Kant found a real runtime isolation bug: active non-`general` skill projection still called the all-project `selectorCatalog()` and `loadProjectPackageByID()` still used all-project `discover()`, so inactive selector failures or inactive selector skill-name collisions could break the active package projection. He also flagged global MCP serve and MCP resource attachment paths as broader MCP projection-boundary risks.
- Aristotle found overlay and current-doc residuals: `main.tsx` preserved a local `activePromptProfile` instead of syncing to `catalog.active`; overlay projection types omitted MCP prompt/resource refs; browser fixtures still represented domain squads as built-ins; current architecture HTML still showed stale `tool_ids` / `skill_names` / `include_mcp_tools` wording.

### Validation

- Resolver implementation:
  - `resolveSkillProjection()` now calls `selectorCatalog()` only for the `general` selection surface.
  - Active non-`general` packages project only their own selector metadata, production skills, and capability refs.
  - `loadProjectPackageByID()` now loads `.opencorvus/expert-squads/<profileID>` directly and relies on `loadPackage()` to enforce manifest/folder ID equality, instead of discovering every project package first.
  - Added regression tests proving active project package skill projection ignores inactive blank `selector.md` and ignores selector-name collisions from inactive packages.
- Overlay implementation:
  - `refreshPromptProfiles()` now sets composer active profile from `catalog.active`.
  - Removed the extra `appStore.config.prompt_profile.active` effect that could overwrite the catalog value after the backend selected a different root-session profile.
  - Added MCP prompt/resource ref arrays to the overlay `PromptProfileCapabilityProjectionEntry` type.
  - Updated prompt-profile browser fixtures to return complete catalog profiles and to mark non-`general` squads as package-backed (`built_in: false`).
- Current docs implementation:
  - Updated `specs/current/architecture/17-agent-team-infrastructure.html` to describe explicit `built_in_tool_ids`, skill/tool refs, MCP typed refs, projected agents, and `projection_hash`.
  - Removed the stale `tool_ids`, `skill_names`, and `include_mcp_tools` shorthand from the current architecture HTML.
- Focused validation passed:
  - `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --test-name-pattern "active project package skill projection ignores inactive selector catalog failures|active project package selector collision checks only projected selector skills|rejects ordinary builtin skill collision with a project selector name|resolves general skill projection"`: 4 pass.
  - `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --test-name-pattern "rejects unknown project profile IDs with project context|non-general expert squads resolve only from project packages|general selector projection does not parse inactive package MCP definitions"`: 3 pass.
  - `bun test --timeout=2147483647 packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts`: 33 pass.
  - `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`: 29 pass before the follow-up selector-isolation tests, then focused selector-isolation tests passed after the direct active package load fix.
  - `bun test --timeout=2147483647 packages/opencorvus/test/server/config-routes.test.ts --test-name-pattern "prompt-profile|inactive package MCP"`: 3 pass.
  - `bun test --timeout=2147483647 packages/overlay/test/prompt-profile-task-session-owner.test.ts`: 11 pass.
  - `bun run --cwd packages/overlay typecheck`: passed.
  - `node test/browser-runner.mjs test/browser/prompt-profile-selector-browser.test.ts`: 2 pass.
  - `node test/browser-runner.mjs test/browser/prompt-profile-panel.test.ts`: 1 pass.
  - `bun test --timeout=2147483647 packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts --test-name-pattern "architecture|Expert|doc|current"`: 65 pass.
- Continuation validation after independent review:
  - Kant re-reviewed `resolveSkillProjection()` and found no remaining blocker for active non-`general` projection. He classified global MCP serve and session resource attachment as broader MCP projection boundaries, not direct inactive package projection regressions.
  - Aristotle found one remaining overlay fixture issue: two unit-test catalog responses still used `{ id, label }` profiles. `packages/overlay/test/prompt-profile-task-session-owner.test.ts` now uses a complete `catalogProfile()` helper for both responses and marks `frontend-replica` as `built_in: false`.
  - Aristotle re-reviewed the fixture fix and reported no blocker.
  - `packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts` was corrected to assert the new active package load contract: `loadProjectPackageByID()` parses `profileID`, constructs canonical `packageRoot`, uses `lstat(packageRoot)`, calls `ExpertSquadRegistry.loadPackage(packageRoot, options)`, and does not discover every project package.
  - `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/registry.test.ts packages/opencorvus/test/expert-squad/package-manager.test.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`: 92 pass.
  - `bun run --cwd packages/opencorvus typecheck`: passed.
  - `bun test --timeout=2147483647 packages/opencorvus/test/server/config-routes.test.ts packages/opencorvus/test/server/skill-routes.test.ts packages/opencorvus/test/tool/skill.test.ts`: 45 pass, 1 skip.
  - `bun test --timeout=2147483647 packages/overlay/test/prompt-profile-task-session-owner.test.ts`: 11 pass.
  - `bun run --cwd packages/overlay typecheck`: passed.
  - `node test/browser-runner.mjs test/browser/prompt-profile-selector-browser.test.ts`: 2 pass.
  - `node test/browser-runner.mjs test/browser/prompt-profile-panel.test.ts`: 1 pass.
  - `bun test --timeout=2147483647 packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`: 65 pass.
  - `bun test --timeout=2147483647 packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts`: 33 pass.
  - `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --test-name-pattern "active project package skill projection ignores inactive selector catalog failures|active project package selector collision checks only projected selector skills|general selector projection does not parse inactive package MCP definitions"`: 3 pass.
  - `bun test --timeout=2147483647 packages/opencorvus/test/mcp/serve.test.ts ./packages/opencorvus/test/mcp/prompt-resource-fail-fast.isolated.ts`: 32 pass.
  - `bun test --timeout=2147483647 packages/opencorvus/test/tool/skill.test.ts --test-name-pattern "active project package prompt profile keeps package tools outside skill and registry surfaces|project expert-squad selector load does not sample package production files"`: 2 pass.
  - `git diff --check`: passed with CRLF warnings only.
- Clarified MCP boundary from Kant:
  - `MCP.serverTools()`, `MCP.serverPrompts()`, `MCP.serverResources()`, and `session/prompt/parts.ts` still operate on the global configured MCP collection because those paths do not carry a prompt-profile/session projection input. Treating them as active expert-squad projected without adding an explicit session/profile parameter would create hidden active state or a second active source.
  - Current package-level expert-squad MCP isolation is closed for this phase: package MCP definitions are loaded only through active scheduler/worker projections and remain absent from global `MCP.tools()`, `MCP.prompts()`, `MCP.resources()`, and OpenCorvus-as-MCP-server proxied lists.
  - If product requirements later want OpenCorvus-as-MCP-server or user-attached MCP resources to become expert-squad scoped, that must be a separate explicit contract change that carries session/profile identity through the API rather than sampling global `prompt_profile.active`.

## Phase 15 Inactive Package Runtime Isolation, 2026-07-04

### Recall

- Current user request remains the full dynamic expert-squad refactor: built-in source keeps only the default scheduler package (`general`), domain expert squads live under `.opencorvus/expert-squads/<id>`, active package README is scheduler append prompt content, and active package tools/skills/MCP definitions are projected only from the selected expert-squad ID.
- Current acceptance for this slice: general runtime paths and selector discovery must not load inactive package production definitions. In particular, a project package with invalid MCP JSONC must still be selectable by metadata while `general` is active, but must fail visibly if that broken package is actually selected as active.
- Hard constraints: no fallback, no compatibility alias, no second active field, no hidden route/gate, no folder-name identity, and no global registration of inactive package production skills/tools/MCP definitions.

### Sources And Search Evidence

- Reread before implementation: `AGENTS.md`, `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`, `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`, `specs/README.md`, `specs/records/2026-07/README.md`, this record's Recall, `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`, `packages/opencorvus/src/expert-squad/registry.ts`, `packages/opencorvus/src/tool/skill.ts`, `packages/opencorvus/src/skill/mounts.ts`, and `packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`.
- `rg -n 'PromptProfile\.(catalog|list|assertKnownProfileID|validateConfig|composeAgentPrompt|overlayFor|builtIns|activeID|targets)|from "@/agent/prompt-profile"|from "../../src/agent/prompt-profile"' packages/opencorvus/src packages/opencorvus/test -g '*.ts'` showed production package-aware paths use `PromptProfileResolver`, while the static `PromptProfile` API remains built-in-only.
- `rg -n 'assertKnownProfileID|validateConfig\(|PromptProfile\.list\(|PromptProfile\.catalog\(|PromptProfileResolver\.list|PromptProfileResolver\.assertKnownProfileID' packages/opencorvus/src packages/opencorvus/test -g '*.ts'` showed profile ID validation and session/config routes already call the resolver.
- `rg -n 'discover\(' packages/opencorvus/src/expert-squad/registry.ts packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/opencorvus/test/tool packages/opencorvus/test/skill -g '*.ts'` exposed that `selectorCatalog()` called `discover()` and then `loadPackage()` for every project package.

### Finding

- `resolveSkillProjection()` used `selectorCatalog()` to build selector skills, but `selectorCatalog()` loaded every project package. That parsed inactive package MCP definitions and production refs even when the active profile was `general`.
- `packageForActiveProfile()` also loaded all project packages before checking whether the active profile was built-in. That made general scheduler capability and prompt composition fail on inactive package production errors.
- `overlayFor()` and `assertKnownProfileID()` were still using a full definitions map, which loaded every project package for runtime prompt composition and built-in profile validation.

### Implementation

- Added metadata-only project package discovery helpers in `PromptProfileResolver`.
- Changed active package resolution so built-in active profiles only use `ExpertSquadRegistry.discover()` to detect ID collisions, and project active profiles load only the requested package ID.
- Changed `overlayFor()` to read the active package prompt profile from `packageForActiveProfile()` instead of a full project definitions map.
- Changed `assertKnownProfileID()` so built-in IDs validate through metadata-only collision checks, while project IDs load only the requested package.
- Changed selector projection so project selector skills are rendered from `PackageCatalogEntry` metadata plus the canonical `selector.md` or manifest location, without `loadPackage()` and without production MCP/tool/skill parsing.
- Removed the now-unused internal `definitionsForScope()` helper so runtime code cannot accidentally reintroduce full-package active resolution.
- Poincare review found one remaining Phase 15 hole: `PromptProfileResolver.list()` still used full `loadPackage()` via `projectPackages()`, so `/config/prompt-profile` could fail on inactive package MCP JSONC while `general` was active.
- Added `ExpertSquadRegistry.loadCatalogPackage()` as the catalog-only package surface. It reads manifest, `README.md`, `selector.md`, and agent prompt overlays needed by catalog output, but does not collect or parse package tools, skills, or MCP definitions.
- Switched `PromptProfileResolver.list()` and `definitions()` to project catalog packages instead of full loaded packages. Active package resolution still uses `loadPackage()` and therefore still fails visibly on broken production definitions when that package is selected.

### Validation

- Added `PromptProfileResolver > general selector projection does not parse inactive package MCP definitions`. The fixture writes invalid inactive `mcp/broken.jsonc`, proves `general` profile validation, Orchestrator prompt composition, and selector skill projection still work from metadata only, and proves selecting the broken project package fails with `invalid JSONC`.
- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --test-name-pattern "general selector projection does not parse inactive package MCP definitions"` passed: 1 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts` passed: 29 pass.
- `bun run --cwd packages/opencorvus typecheck` passed.
- `bun test --timeout=2147483647 packages/opencorvus/test/script/historical-docs-links.test.ts` passed: 19 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/registry.test.ts packages/opencorvus/test/expert-squad/package-manager.test.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts` passed: 90 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/tool/skill.test.ts packages/opencorvus/test/skill/skill.test.ts` passed: 38 pass.
- `git diff --check` passed with CRLF warnings only.
- Added direct resolver catalog coverage and HTTP route coverage for Poincare's finding:
  - `PromptProfileResolver.list()` now proves an inactive package with invalid `mcp/broken.jsonc` remains listed while `general` is active.
  - `GET /config/prompt-profile` now proves the route returns 200 and includes the inactive package catalog entry, while `PATCH /config` selecting that package returns 400 with the visible `invalid JSONC` error.
- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --test-name-pattern "general selector projection does not parse inactive package MCP definitions"` passed after catalog-surface coverage: 1 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/server/config-routes.test.ts --test-name-pattern "GET /config/prompt-profile does not parse inactive package MCP definitions"` passed: 1 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts` passed after the catalog fix: 29 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/server/config-routes.test.ts` passed after the catalog fix: 11 pass.
- `bun run --cwd packages/opencorvus typecheck` passed after the catalog fix.
- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/registry.test.ts packages/opencorvus/test/expert-squad/package-manager.test.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts` passed after the catalog fix: 90 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/server/config-routes.test.ts packages/opencorvus/test/server/session-routes.test.ts packages/opencorvus/test/server/skill-routes.test.ts` passed after the catalog fix: 38 pass, 1 skip.
- `bun test --timeout=2147483647 packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts` passed after the catalog fix: 65 pass.
- `git diff --check` passed after the catalog fix with CRLF warnings only.
- Heisenberg follow-up read-only review found no remaining issue in the catalog/full-load split: catalog paths use `loadCatalogPackage()`, active selection still uses `loadPackage()`, tests cover inactive broken MCP catalog behavior and visible active-selection failure.

## Phase 13 MCP Prompt/Resource Projection Correction, 2026-07-04

### Recall

- Current user request remains the full expert-squad source refactor: built-in source keeps only `general`, all domain expert squads live under `.opencorvus/expert-squads/<id>`, package identity comes from manifest `id`, README is active Orchestrator append prompt, and package-specific prompts/skills/tools/MCP definitions are projected without fallback or double-source behavior.
- New residual found during continuation audit: Phase 12 claimed `catalog_projection` included MCP prompt/resource ref arrays, but hard-disk code still accepted and emitted only MCP server/tool refs.
- Current acceptance for this slice: manifest `capability_projection` must accept and validate `default_mcp_prompt_refs`, `package_mcp_prompt_refs`, `default_mcp_resource_refs`, and `package_mcp_resource_refs`; catalog schema and emitted profiles must expose the same arrays; package prompt/resource refs must be declared by the package MCP definition and obey shared-or-agent-owned ref rules; malformed default prompt/resource refs must fail.
- Hard constraints: no fallback MCP source, no global registration of inactive package MCP definitions, no folder-name identity, no UI-only filtering, and no claim that scoped MCP prompt/resource runtime proxy is complete until a dedicated runtime surface wires it.

### Sources And Search Evidence

- Reread sources before this correction: `AGENTS.md`, `specs/README.md`, `specs/records/2026-07/README.md`, this record's Phase 12 Recall, `packages/opencorvus/src/agent/prompt-profile.ts`, `packages/opencorvus/src/expert-squad/registry.ts`, `packages/opencorvus/src/expert-squad/catalog-profile.ts`, `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`, `packages/opencorvus/src/mcp/index.ts`, `packages/opencorvus/src/mcp/serve.ts`, `packages/opencorvus/src/session/loop.ts`, and the expert-squad fixture/tests.
- `rg -n "default_mcp_prompt_refs|package_mcp_prompt_refs|default_mcp_resource_refs|package_mcp_resource_refs|MCP prompt|MCP resource" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md -g "*.ts" -g "*.md" -g "*.html"` showed the spec required prompt/resource refs while code only had server/tool refs.
- `rg -n "export async function (tools|prompts|resources|serverTools|callTool|callScopedTool|scopedTool)|MCP\\.(prompts|resources|tools|serverTools|callTool)" packages/opencorvus/src/mcp packages/opencorvus/src/server packages/opencorvus/src/session packages/opencorvus/src/tool -g "*.ts"` showed global MCP prompt/resource surfaces exist, but package-scoped runtime functions currently exist only for tools.
- `rg -n "SessionRuntimeContract|includeMcpTools|projectedRegistryToolIDs|setSessionRuntimeContract" packages/opencorvus/src/session packages/opencorvus/src/agent packages/opencorvus/src/orchestrator packages/opencorvus/test/session -g "*.ts"` showed session runtime contracts carry tool projection, not MCP prompt/resource proxy projection.

### Independent Review Feedback

- Gauss found this was a real completion gap, not merely stale early-design prose: `PromptProfileCapabilityProjectionEntrySchema`, manifest `Projection`, `catalog-profile.ts`, and resolver capability types lacked prompt/resource arrays even though registry collected MCP prompt/resource capabilities from package MCP definitions.
- Euclid found no current production residual for hardcoded domain expert squads: `builtin/index.ts` imports only `general`, generated selector skills derive from expert-squad package sources, and remaining old built-in mentions are historical records or tests asserting the migration contract.

### Implementation

- Added MCP prompt/resource projection arrays to `ExpertSquadRegistry.Projection`, `PromptProfileCapabilityProjectionEntrySchema`, and `catalogProjectionEntry()`.
- Added registry validation for default MCP prompt/resource ref shapes and package MCP prompt/resource refs.
- Reused the existing package MCP typed-ref ownership model so prompt/resource refs must be declared by the package MCP definition and must be shared or owned by the projected agent.
- Extended the expert-squad test fixture to construct scheduler/build default and package MCP prompt/resource projection refs.
- Added registry tests for valid prompt/resource projection, undeclared package MCP prompt refs, cross-agent package MCP resource ownership, and malformed default MCP prompt/resource refs.
- Added catalog tests proving prompt/resource ref arrays appear in emitted package profile capability projection.

### Runtime Boundary

- This phase closes the manifest/schema/catalog projection gap.
- It does not claim that package MCP prompts/resources are globally registered in `MCP.prompts()`, `MCP.resources()`, `MCP.serverPrompts()`, or `MCP.serverResources()`. Existing tests still require inactive package MCP prompts/resources to stay absent from global MCP lists.
- Scoped package MCP tool runtime projection remains implemented through `PromptProfileResolver.project*Tools()` and `MCP.scopedTool()`. Scoped MCP prompt/resource runtime proxy needs a separate design before it can be called complete.

### Validation

- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/registry.test.ts` passed: 43 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts` passed: 25 pass.
- Follow-up `bun run --cwd packages/opencorvus typecheck` initially exposed unrelated dirty-worktree type errors in `packages/opencorvus/src/panel/capability.ts` and `packages/opencorvus/src/tool/registry.ts`; those were fixed by validating actor capability lists against the canonical panel registry and by reading plugin tool hook `specifier` from `Plugin.toolHooks()` instead of a non-existent plugin hook `name` field.
- `bun run --cwd packages/opencorvus typecheck` passed after the correction.
- `bun run typecheck` passed across the workspace after SDK regeneration.
- `bun test --timeout=2147483647 packages/opencorvus/test/panel/actor-whitelist.test.ts` passed: 24 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/agent/prompt-profile.test.ts` passed: 18 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/server/config-routes.test.ts` passed: 10 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/tool/skill.test.ts` passed: 13 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/registry.test.ts packages/opencorvus/test/expert-squad/package-manager.test.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts` passed: 84 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/tool/registry.test.ts` passed: 8 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts` passed: 65 pass.
- `bun run --cwd packages/sdk/js build` passed and regenerated SDK types so MCP prompt/resource projection fields are present in `packages/sdk/js/src/gen/types.gen.ts`.
- `bun run api:routes-check` passed.
- `bun run docs:check` passed.
- `git diff --check` passed with CRLF warnings only.

## Phase 14 Scoped MCP Prompt/Resource Runtime Proxy, 2026-07-04

### Recall

- Current user request remains the full dynamic expert-squad refactor: built-in source keeps only `general`, all domain expert squads load from `.opencorvus/expert-squads/<id>` by manifest `id`, active README is the Orchestrator append prompt, and package-specific prompts, skills, tools, and MCP definitions are projected as active expert-squad capability without fallback or double-source behavior.
- Phase 13 closed manifest, registry, catalog, SDK, and validation schema support for MCP prompt/resource refs, but explicitly left runtime prompt/resource proxy incomplete.
- Current acceptance for this slice: active scheduler and worker capability objects must carry projected default/package MCP prompt/resource refs; scoped runtime helpers must list/fetch active projected MCP prompts and list/read active projected MCP resources; package MCP prompt/resource access must stay absent from global `MCP.prompts()`, `MCP.resources()`, `MCP.serverPrompts()`, and `MCP.serverResources()`.
- Hard constraints: no global registration of package MCP prompt/resource definitions, no fallback to inactive package definitions, no arbitrary ref loader that bypasses active projection, no folder-name identity, no hidden gate, and no widening of global MCP command/session resource behavior.

### Sources And Search Evidence

- Reread sources before implementation: `AGENTS.md`, `specs/README.md`, `specs/records/2026-07/README.md`, this record's Phase 13 Recall, `packages/opencorvus/src/mcp/index.ts`, `packages/opencorvus/src/mcp/serve.ts`, `packages/opencorvus/src/command/index.ts`, `packages/opencorvus/src/session/prompt/parts.ts`, `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`, `packages/opencorvus/src/expert-squad/catalog-profile.ts`, `packages/opencorvus/src/expert-squad/registry.ts`, `packages/opencorvus/test/fixture/expert-squad.ts`, and `packages/opencorvus/test/fixture/package-mcp-server.ts`.
- `rg -n "MCP\\.(prompts|resources|getPrompt|readResource|serverPrompts|serverResources)|prompts\\(|resources\\(|getPrompt\\(|readResource\\(" packages/opencorvus/src packages/opencorvus/test -g "*.ts"` showed global MCP prompt/resource consumers in CLI command loading, external MCP serve proxy, experimental resource route, and user-attached session resources.
- `rg -n "interface .*Capability|resolveSchedulerCapability|resolveWorkerCapability|defaultMcpToolRefs|packageMcpToolRefs|projectOrchestratorTools|projectWorkerTools|ScopedTool|scopedTool|callScopedTool" packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts packages/opencorvus/src/mcp/index.ts` showed scoped runtime support exists only for MCP tools.
- `rg -n "package_mcp_prompt_refs|package_mcp_resource_refs|default_mcp_prompt_refs|default_mcp_resource_refs" packages/opencorvus/src packages/opencorvus/test -g "*.ts"` showed registry and fixtures already validate projection refs, while resolver capability types still omit runtime prompt/resource refs.
- SDK inspection under `packages/opencorvus/node_modules/@modelcontextprotocol/sdk/dist/esm/**` confirmed the current SDK exposes `registerPrompt`, `registerResource`, `GetPromptResultSchema`, and `ReadResourceResultSchema`.

### Planned Boundary

- Extend `MCP.withScopedClient()` usage from tool-only to a base scoped MCP connection input, then add `scopedPromptInfo`, `getScopedPrompt`, `scopedResourceInfo`, and `readScopedResource`.
- Extend scheduler and worker resolved capability with default/package MCP prompt/resource ref arrays and default MCP server configs derived from all projected default MCP refs, not only tool refs.
- Add resolver functions that operate from an already resolved active capability:
  - list/get scheduler and worker projected MCP prompts;
  - list/read scheduler and worker projected MCP resources.
- Package refs must be resolved through the active package root and validated loaded package sets; default refs must be resolved through the effective config. Resource refs match the declared MCP resource name and then read the actual listed resource URI.
- Tests must prove scoped prompt/resource calls work for both scheduler/package and worker/default paths, and that package prompt/resource entries remain absent from global MCP prompt/resource lists.

### Implementation

- Generalized the MCP scoped connection input so tool, prompt, and resource calls share the same scoped connect/close lifecycle without registering package MCP servers globally.
- Added `MCP.scopedPromptInfo()`, `MCP.getScopedPrompt()`, `MCP.scopedResourceInfo()`, and `MCP.readScopedResource()`. Prompt and resource result payloads are parsed with the MCP SDK result schemas.
- Extended scheduler and worker capability resolution with default/package MCP prompt/resource refs, provider names, and default MCP server configs collected from all default MCP typed refs.
- Added `PromptProfileResolver.projectSchedulerMcpPrompts()`, `projectWorkerMcpPrompts()`, `projectSchedulerMcpResources()`, and `projectWorkerMcpResources()`.
- Package MCP prompt/resource projection reloads only the active package root, verifies the ref is present in the loaded package ref set, reads the package MCP definition file under that package root, and creates a scoped MCP client from that definition.
- Default MCP prompt/resource projection uses only the effective config server referenced by the active projection.
- Scoped resource reads first list resources by declared resource name, then read the returned resource URI. The ref resource segment is not treated as the URI.
- The MCP fixture server now exposes real `inspect` prompt and `dom` resource handlers in addition to the existing `snapshot` tool.

### Validation

- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts` passed: 28 pass.
- `bun run --cwd packages/opencorvus typecheck` passed.
- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/registry.test.ts packages/opencorvus/test/expert-squad/package-manager.test.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts` passed: 88 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/tool/skill.test.ts` passed: 13 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/mcp/serve.test.ts packages/opencorvus/test/mcp/prompt-resource-fail-fast.isolated.ts` only ran `serve.test.ts` because Bun treats the isolated filename as a filter unless the path starts with `./`; `serve.test.ts` passed: 14 pass.
- `bun test --timeout=2147483647 ./packages/opencorvus/test/mcp/prompt-resource-fail-fast.isolated.ts` passed: 18 pass.
- `bun run typecheck` passed across the workspace.
- `bun test --timeout=2147483647 packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts` passed: 65 pass.
- `git diff --check` passed with CRLF warnings only.
- `bun run api:routes-check` passed.
- `bun run docs:check` passed.

## Phase 11 Recall, 2026-07-04

### User Request

- Clarify the current design for expert-squad `README.md`.
- The user confirmed `README.md` is intended for the scheduler/Orchestrator append prompt, not just package documentation.

### Acceptance Criteria For This Slice

- `README.md` has one runtime meaning: active expert-squad communication overview appended to the Orchestrator prompt.
- Inactive expert-squad READMEs do not enter general selector discovery, generated selector skills, ordinary skill loading, or non-Orchestrator agent prompts.
- `selector.md` remains the inactive-discovery selector instruction source.
- `agents/orchestrator/system.md` remains the active Orchestrator behavioral overlay.
- Tests prove the active Orchestrator prompt contains the active README and role overlay, while non-Orchestrator prompts and inactive/general prompts do not receive project READMEs.

### Hard Constraints

- No fallback prompt source, compatibility alias, folder-name identity, UI-only filtering, or hidden routing.
- The manifest already pins `readme` to top-level `README.md`; keep that canonical path rather than allowing arbitrary production files to become scheduler prompt content.

### Sources Read

- `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md`
- `packages/opencorvus/src/expert-squad/registry.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`
- `packages/opencorvus/test/fixture/expert-squad.ts`

### Repository Search Evidence

- `rg -n "README|readme|selectorInstructions|composeAgentPrompt|agents/orchestrator|projectOrchestratorTools|packageForActiveProfile" specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md packages/opencorvus/src/expert-squad/registry.ts packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/expert-squad/registry.test.ts`: README is required and manifest-pinned but currently only exposed as `readmePath`; prompt composition currently appends only `agents.<role>.prompt`.

### Phase 11 Planned Boundary

- Add loaded `readmeContent` to filesystem and embedded expert-squad packages.
- Append the active package README only for `agentID === "orchestrator"` inside `PromptProfileResolver.composeAgentPrompt()`.
- Preserve prompt order as base prompt, active README communication overview, role overlay, then user append.
- Add resolver tests for active README inclusion and inactive/non-Orchestrator exclusion.

### Phase 11 Implementation Result

- `ExpertSquadRegistry.LoadedPackage` and embedded package records now expose trimmed `readmeContent`.
- Blank package READMEs fail validation because README is prompt content.
- `PromptProfileResolver.composeAgentPrompt()` appends the active package README only for the Orchestrator. Worker prompts still receive only base prompt, role overlay, and user append.
- Active project README content is absent from the `general` Orchestrator prompt even when the package exists under the project.
- `selector.md` remains the selector skill body source; README is not used for inactive discovery.
- `selector.instructions` now has one accepted value, top-level `selector.md`, across discover, load, source-load, and import validation paths. Production prompt paths such as `agents/orchestrator/system.md` and README paths are rejected before a package can load.

### Phase 11 Independent Review Result

- Plato found one blocking selector-boundary bug: `discover()` rejected production prompt paths for `selector.instructions`, but `loadPackage()` and `loadSourcePackage()` did not. The fix introduced shared `selector.instructions` validation in `ExpertSquadRegistry`.
- Plato also requested a sharper README leak test. The fixture README now contains `PROJECT_README_ORCHESTRATOR_APPEND_ONLY`; active Orchestrator prompt includes it, while worker/general prompts and selector skill load output reject it.
- Singer found the runtime built-in boundary correct, but noted repository `.opencorvus/expert-squads/**` files must be staged before delivery and `specs/current/architecture/17-agent-team-infrastructure.html` still described domain squads as built-in. The current architecture HTML was updated to say built-in is `general` only and project squads live in `.opencorvus/expert-squads`.
- Singer's non-blocking note that `backend` and `algorithm` have no selector remains intentional for now: those packages are catalog/active-profile loadable, but not selector-skill discoverable until a product decision adds selector metadata and tests.

### Phase 11 Validation

- Focused README tests passed:
  - `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/registry.test.ts -t "README|loads a valid package|built-in expert squad"`: 3 pass.
  - `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts -t "loads project package profiles"`: 1 pass.
- Focused selector-boundary tests passed:
  - `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/registry.test.ts -t "selector instructions|README|production package files"`: 6 pass.
  - `bun test --timeout=2147483647 packages/opencorvus/test/tool/skill.test.ts -t "project expert-squad selector load"`: 1 pass.
- The broader Phase 10 validation suite above also passed after the README runtime change.

## Phase 12 Final Residual Closure, 2026-07-04

### Recall

- Current user request: continue scanning and solve residual issues after moving all non-`general` expert squads to `.opencorvus`, and clarify the runtime design for expert-squad `README.md`.
- Current acceptance: built-in source contains only `general`; migrated squads load only from `.opencorvus/expert-squads/<id>` by manifest ID; active README is appended only to the Orchestrator prompt; `selector.md` is the inactive-discovery text; `agents/orchestrator/system.md` is the active scheduler behavior overlay; no fallback, folder-name identity, or dual prompt source remains.
- Sources reread before final edits: `AGENTS.md`, `specs/README.md`, `specs/records/2026-07/README.md`, this record's Phase 11 Recall, and `opencorvus-expert-squad-creator` checklist as stale-but-useful checklist context.
- Final residual search evidence:
  - `rg -n "PromptProfile\.list|PromptProfile\.catalog|PromptProfile\.composeAgentPrompt|PromptProfile\.overlayFor|PromptProfile\.assertKnownProfileID|PromptProfile\.validateConfig|PromptProfile\.builtIns|PromptProfile\.activeID" packages/opencorvus/src packages/opencorvus/test -g "*.ts"` showed production uses the resolver for package-aware behavior and the static `PromptProfile.list()` path was still a tested exported catalog surface.
  - `rg -n "source_baseline_input|project_mode|visual_handoff" packages/opencorvus/src packages/opencorvus/test specs -g "*.ts" -g "*.md" -g "*.jsonc"` showed Build overlay tests were asserting the retired prose marker while current handoff authority is structured `project_mode=source_baseline`.
  - `rg -n "PromptProfile\.builtIns|内置档：frontend|src/agent/prompt-profile.ts|src/expert-squad/builtin/\*|builtin/.*frontend|built-in.*frontend|source_baseline_input" specs/current/architecture/17-agent-team-infrastructure.html packages/opencorvus/test/agent/core-prompt-hygiene.test.ts packages/opencorvus/src/build/prompt-context.ts` had no remaining live hits.

### Implementation

- Added `packages/opencorvus/src/expert-squad/catalog-profile.ts` as the single helper for prompt-catalog profile projection, projection hashes, and package/default provider names. `PromptProfileResolver` and the static `PromptProfile.list()` now use that same helper instead of keeping separate catalog shapes.
- Restored `PromptProfile.list()` as a built-in-only catalog surface for `general`, with the same capability projection fields as resolver-backed catalogs. It does not load project packages; package-aware production paths remain under `PromptProfileResolver`.
- Fixed the catalog projection shape to include MCP prompt/resource ref arrays, matching `PromptProfileCapabilityProjectionEntrySchema`.
- Broadened resolver `ConfigLike.mcp` to the full `Config.Info["mcp"]` shape so explicit disabled MCP entries remain type-valid; actual MCP use still parses selected servers through `Config.Mcp`.
- Updated Build prompt hygiene tests from old `source_baseline_input` prose marker assertions to structured `project_mode=source_baseline` and the current visual handoff overlay wording.
- Corrected the direct-build scheduler projection test to use the real migrated `frontend-innovate` project package and assert `frontend-innovate` identity, rather than expecting the test fixture package ID.
- Regenerated `packages/sdk/openapi.json` from the current route schema after `/config/prompt*` query schema drift.

### Final Validation

- `bun run --cwd packages/opencorvus typecheck` passed.
- `bun test --timeout=2147483647 packages/opencorvus/test/expert-squad/registry.test.ts packages/opencorvus/test/expert-squad/package-manager.test.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts` passed: 79 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/agent/prompt-profile.test.ts packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts packages/opencorvus/test/agent/core-prompt-hygiene.test.ts packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts` passed: 107 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/tool/skill.test.ts` passed: 13 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/session/extra-tools.test.ts` passed: 45 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/server/config-routes.test.ts packages/opencorvus/test/server/skill-routes.test.ts` passed: 31 pass, 1 skip.
- `bun test --timeout=2147483647 packages/opencorvus/test/server/task-create-route.test.ts` passed: 10 pass.
- `bun test --timeout=2147483647 packages/opencorvus/test/server/task-message-routes.test.ts` passed: 25 pass.
- Combined `task-create-route` plus `task-message-routes` previously hit a 15s per-test timeout on `POST /task accepts omitted queue and starts immediately` under parallel route-server pressure; the same test and the full file passed when rerun alone, so it is recorded as validation scheduling contention rather than a product regression.
- `bun test --timeout=2147483647 packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts` passed: 65 pass.
- `bun run api:routes-check` passed.
- `git diff --check` passed with CRLF warnings only.
