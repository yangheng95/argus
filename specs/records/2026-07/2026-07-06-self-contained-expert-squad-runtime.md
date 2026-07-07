# Self-Contained Expert Squad Runtime

Date: 2026-07-06
Status: Implementation record
Owner: Codex

Supersession note: `2026-07-06-expert-squad-namespaced-source-layout.md` supersedes this record's direct-child package path. Non-`general` expert squads now live under `.opencorvus/expert-squads/<namespace>/<id>/`; the rest of this record remains historical runtime-projection context.

## Glossary

- API: Application Programming Interface, the route or TypeScript contract between modules.
- MCP: Model Context Protocol, the protocol for exposing external tools, prompts, and resources to agents.
- UI: User Interface.
- Runtime projection: The effective tools, skills, MCP providers, prompts, and visible catalog data derived from the active expert squad.
- Active expert squad: The expert squad selected by `prompt_profile.active`.

## Recall

### User Request

The user requested a goal and implementation for the expert-squad runtime refactor with these calibrations:

- Do not overfit the architecture to `software-testing`.
- Treat the OpenTest migration as technical distillation, not a template to copy in detail.
- Check whether the current abstraction stays scalable when adding other expert squads.
- Expert-squad runtime must be self-contained inside the expert-squad package. Package-local MCP configuration must be read and mounted automatically from the active expert squad. Custom mounted tools are out of scope for this phase.
- Protocols in already implemented expert squads must not be migrated into a new external expert-mount directory. Existing functionality must be checked for regressions.

### Acceptance Criteria

- Active expert-squad selection remains `prompt_profile.active`.
- `PromptProfileResolver` remains the only runtime projection surface for active package skills, tools, MCP providers, catalog, and skill-mount surfaces.
- Package-local MCP server refs declared by the active expert squad are read from the expert-squad package and expanded into effective runtime MCP tool, prompt, and resource providers.
- No inactive package scanning, fallback aliases, global `AgentRoleID` expansion, `config.agent` mutation, second workflow, second dispatch engine, synthetic messages, or hidden scheduling state are added.
- `software-testing` remains a package-specific OpenTest implementation example, not a platform template.
- Already implemented expert-squad protocol files are not migrated as part of this change.
- Tests prove registry/resolver/catalog behavior and active/inactive package isolation.

### Hard Constraints

- Non-`general` expert squads are project packages under `.opencorvus/expert-squads/<id>/`.
- Manifest `id` is the only expert-squad identity.
- Package-local runtime files are owned by the expert-squad package.
- Package-local MCP definitions live under `agents/<role>/mcp/*.jsonc` or `mcp/*.jsonc` and are valid registry-parsed MCP definitions.
- `package_mcp_server_refs` are not display-only metadata; for active packages they must become the package-local MCP runtime mount input.
- Declaring the same effective package MCP capability through both a server ref and a typed ref must fail visibly instead of silently deduplicating.
- Existing package-specific protocols stay where they are unless a package-specific redesign explicitly replaces them.

### Sources Read

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/README.md`
- An untracked July planning draft was observed as background user notes only and is not a committed source for this record.
- `specs/records/2026-07/2026-07-06-dynamic-expert-agent-instance-review-plan.md`
- `C:/Users/chuan/Downloads/opencorvus-test-agent-migration.md`

### Repository Search Evidence

- `rg -n "ExpertSquadRegistry|ExpertSquadPackageManager|PromptProfileResolver|expert-squads|expert-squad.jsonc|prompt_profile.active|select_expert_squad|active_skill_projection|capability_projection" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs/current specs/records`
  - Finding: expert-squad runtime paths already converge on `PromptProfileResolver`, catalog routes, registry validation, and overlay projection.
- `rg -n "package_mcp|package_mcp_server|package_mcp_server_refs|mcp_server_refs|MCP|mcpServers|mcp_servers|scoped MCP|scopedMcp|resolveScoped|mcp/.*jsonc|PackageMcp" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test .opencorvus/expert-squads specs/current specs/records`
  - Finding: registry discovers package MCP definitions and typed MCP capabilities. Resolver projects typed refs, but package MCP server refs do not yet form an effective runtime mount source.
- `rg --files .opencorvus/expert-squads packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/overlay/test | sort`
  - Finding: existing expert-squad packages use package-local prompts and, for `software-testing`, a package-local protocol engine. Other packages must not be migrated as part of this runtime change.
- `rg -n "mcp" .opencorvus/expert-squads -g "expert-squad.jsonc" -g "*.jsonc" -C 2`
  - Finding: repository expert-squad packages currently do not rely on package-local MCP definitions, so the runtime change must be proven with focused fixtures rather than by migrating existing packages.

### Independent Feedback

No new independent sub-agent review was requested for this implementation turn. Prior independent review feedback from the dynamic virtual-agent plan remains binding: do not add package-specific global roles, do not generate `config.agent`, keep resolver as the single projection surface, and avoid fallback/alias paths.

## Diagnosis

The current abstraction is mostly scalable: package identity, active selection, virtual agents, package skills, package tools, package MCP refs, catalog, and overlay surfaces are already package/resolver-oriented. The weak point is MCP self-containment. Registry can read package-local MCP definitions, but resolver currently treats `package_mcp_server_refs` mainly as declared/catalog data while effective runtime providers are driven by explicit typed refs such as `package_mcp_tool_refs`.

That forces package authors to duplicate information already present in the package MCP definition. It also makes package-local MCP less self-contained than package-local tools and skills.

## Implementation Decision

Keep the manifest projection shape, but change resolver semantics:

- `package_mcp_server_refs` declares package-local MCP servers to mount from the active expert squad.
- Resolver expands each declared package MCP server ref into the tool, prompt, and resource refs statically declared by that server's package-local `capabilities`.
- Explicit typed refs remain supported for partial capability projection, but they must not duplicate any effective capability already mounted through a server ref.
- Expansion happens only for the active package and only in `PromptProfileResolver`.
- Built-in/default MCP refs remain config-backed and are not converted to package-local behavior.

This keeps the runtime self-contained without introducing a new workflow, config writer, inactive scan, custom role, or package protocol migration.

## Test Plan

- Registry test: loading a package with only `package_mcp_server_refs` proves package-local MCP definitions still declare available tool/prompt/resource refs.
- Resolver tests:
  - Scheduler server ref expands package-local MCP capabilities into effective tool, prompt, and resource providers.
  - Worker server ref expands package-local MCP capabilities into effective tool providers.
  - Duplicate declaration through server ref plus typed ref fails visibly.
  - Active general profile does not expose inactive package MCP providers.
- Route/catalog tests if response semantics change.
- Existing expert-squad tests and typecheck:
  - `bun test packages/opencorvus/test/expert-squad/registry.test.ts`
  - `bun test --timeout 20000 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`
  - `bun test --timeout 20000 packages/opencorvus/test/server/expert-squad-routes.test.ts`
  - `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  - `bun run --cwd packages/opencorvus typecheck`
  - `git diff --check`
