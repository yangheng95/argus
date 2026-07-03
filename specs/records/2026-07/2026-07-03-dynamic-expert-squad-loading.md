# Dynamic Expert Squad Loading

Date: 2026-07-03

Status: reviewed design; phase 1 registry implementation in progress.

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
- `README.md` documents the agent communication relationship. It is human-facing architecture documentation, not executable routing data.
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
   - Delete or replace TypeScript-only PromptProfile built-ins.
   - Delete hardcoded expert-squad skill imports that duplicate package selectors.

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

Still pending:

- Migrating built-in expert squads into package-shaped definitions.
- Replacing `PromptProfile` TypeScript built-ins with registry-backed catalog/projection.
- Wiring active projection into Orchestrator runtime tools, worker runtime contracts, skill mounts, custom tools, MCP, routes, SDK, and overlay.
- Implementing folder/ZIP import and export routes.

## Open Risks For Review

1. Keeping `prompt_profile.active` as expert-squad ID is the least disruptive single source, but the UI language must make clear that the user-facing entity is now an expert squad package.
2. Replacing `prompt_profile.profiles` with package manifests will break old local custom profiles by design. The implementation needs explicit errors and a manual migration note, not compatibility code.
3. Built-in packages must pass the same parser as project packages. If they remain TypeScript-only, this design fails the single-source requirement.
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
