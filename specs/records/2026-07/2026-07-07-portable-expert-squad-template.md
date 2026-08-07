# Portable Expert Squad Template

Date: 2026-07-07
Status: Historical plan, superseded on 2026-07-16
Owner: Codex

## Glossary

- API: Application Programming Interface, a callable route or TypeScript contract.
- ID: Identifier.
- JSONC: JSON with Comments, the manifest format used by `expert-squad.jsonc`.
- MCP: Model Context Protocol, the package-scoped tool, prompt, and resource provider surface.
- UI: User Interface.

## Recall

### User Request

The user asked whether the next expert-squad model should:

- union an expert squad's declared agents with all agents already supported by OpenCorvus;
- automatically release that union into external expert squads such as `opentest`;
- put default agents under `agents` and overridden agents under `virtual_agents`;
- create a portable expert-squad template that defaults to all available agents;
- include a human tutorial and an agent skill that teaches how to define a good expert squad.

### Acceptance Criteria

- Answer the design question directly instead of accepting a surface-level directory split.
- Preserve the current expert-squad single source: manifest `id`, namespaced package directory, `prompt_profile.active`, and `PromptProfileResolver`.
- Do not make MirrorTest or other real external packages automatically gain undeclared runtime roles.
- Provide a portable expert-squad template that includes all OpenCorvus prompt-profile target roles by default.
- Separate human tutorial content from the package root `README.md`, because package `README.md` is runtime Orchestrator append prompt content.
- Include a package skill that agents can read when designing or reviewing an expert squad.
- Add tests that keep the template aligned with supported base roles.

### Hard Constraints

- No fallback, compatibility alias, inactive package scan, second active expert-squad field, hidden routing, or package-owned workflow engine.
- Runtime identity and workflow dispatch remain on existing `AgentRoleID` values.
- Virtual agents are package-owned display/prompt/capability metadata only.
- Do not overwrite unrelated dirty worktree changes.
- Specs and records stay under `specs/`.
- Code changes require focused tests.

### Sources Read

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/README.md`
- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md`
- `specs/records/2026-07/2026-07-06-agent-base-runtime-contract-projection.md`
- `specs/records/2026-07/2026-07-06-global-virtual-agent-opentest-adaptation.md`
- `specs/records/2026-07/2026-07-06-expert-squad-namespaced-source-layout.md`
- `specs/records/2026-07/2026-07-07-opentest-lifecycle-virtual-agents.md`
- `specs/records/2026-07/2026-07-07-frontend-tool-portability-boundary.md`
- `specs/records/2026-07/2026-07-07-dispatch-agent-projected-target-schema.md`
- `.opencorvus/expert-squads/wujiang/opentest/expert-squad.jsonc`
- `.opencorvus/expert-squads/builtin/frontend-replica/expert-squad.jsonc`
- `.opencorvus/expert-squads/builtin/backend/expert-squad.jsonc`
- `.opencorvus/expert-squads/builtin/algorithm/expert-squad.jsonc`
- `packages/opencorvus/src/agent/role-contract.ts`
- `packages/opencorvus/src/agent/base-runtime-contract.ts`
- `packages/opencorvus/src/expert-squad/registry.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/script/generate-expert-squad-payload.ts`

### Repository Search Evidence

- `rg -n "ExpertSquadRegistry|ExpertSquadPackageManager|PromptProfileResolver|expert-squads|expert-squad\\.jsonc|prompt_profile\\.active|select_expert_squad|active_skill_projection|capability_projection" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs/current specs/records`
  - Finding: registry, manager, resolver, catalog, routes, overlay, and docs all converge on manifest/package/resolver projection.
- `rg -n "loadEmbeddedPackage|EmbeddedPackageSource|renderSelectorSkillMarkdown|discover\\(|loadPackage\\(|loadSourcePackage\\(|importDirectory\\(|importArchive\\(|exportArchive\\(|payload|seed|release" packages/opencorvus/src packages/opencorvus/test`
  - Finding: payload release is explicit and must not overwrite packages or act as a fallback catalog path.
- `rg --files .opencorvus/expert-squads packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/overlay/test | Sort-Object`
  - Finding: MirrorTest already uses `agents/orchestrator` plus role-scoped `virtual-agents/<role>` for projected lifecycle roles.
- `rg -n "virtual_agents|virtual-agents|AgentRoleContract\\.isRoleID|declared|agents\\.|manifest\\.agents|capability_projection\\.agents|role_base|packageProjection" packages/opencorvus/src/expert-squad/registry.ts packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts packages/opencorvus/test/expert-squad/registry.test.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`
  - Finding: `agents.<role>` and `virtual_agents.<role>` are mutually exclusive; virtual roles must have `capability_projection.agents.<role>`.
- `rg -n "portable|template|scaffold|expert-squad template|create.*expert.*squad|generate.*expert|fixtures.*expert|manifest\\(\\{|example.*expert" packages/opencorvus packages specs .opencorvus -g "*.ts" -g "*.md" -g "*.jsonc"`
  - Finding: there is no existing portable expert-squad template mechanism.

### Independent Agent Feedback

No independent sub-agent was used for this focused template implementation. The relevant architectural boundary had already been reviewed in the recent virtual-agent and portability records listed above.

## Design Answer

The proposed runtime union is not reasonable for real packages such as MirrorTest.

The safe split is:

- `capability_projection.agents` is the explicit package projection source. A real package must declare only roles it actually wants active.
- OpenCorvus base roles are not copied into the package. Absence of `agents.<role>` means the role keeps its base runtime prompt/contract.
- `agents/<role>` is for direct package role overlays, most often `agents/orchestrator/system.md` for scheduler behavior.
- `virtual_agents.<role>` plus `virtual-agents/<role>/system.md` is for package-owned expert identity projected onto an existing base role.
- A template may default to the union of supported prompt-profile target roles, but the generated package must be pruned before installation if the squad does not actually use every role.

Automatically releasing the union into MirrorTest would reintroduce the bug repaired in `2026-07-07-dispatch-agent-projected-target-schema.md`: `dispatch_agent` would again expose workflow targets that MirrorTest does not support, such as `analyze_intent`, because the package would have been silently widened.

## Implementation Plan

1. Add a portable expert-squad template artifact under `specs/artifacts/portable-expert-squad-template/`.
2. Keep the human tutorial at artifact root, outside the valid package root.
3. Put the runnable package sample under `specs/artifacts/portable-expert-squad-template/package/`.
4. Generate the package sample from `AgentRoleContract.promptProfileTargets()` and `AgentBaseRuntimeContract` so the template tracks supported role surfaces.
5. Include all prompt-profile target roles in `capability_projection.agents`.
6. Include virtual agents only for roles whose base runtime projection supports package virtual-agent identity.
7. Include only `agents/orchestrator/system.md` as a direct role overlay in the template.
8. Add a shared package skill `portable-template/shared/expert-squad-authoring` that teaches agents how to define a good expert squad; project it through the scheduler and skill-mountable worker roles.
9. Add a test that loads the sample package through `ExpertSquadRegistry.loadSourcePackage()` and asserts:
   - all supported prompt-profile target roles are present in `capability_projection.agents`;
   - virtual agents match the base-runtime virtual-agent-capable role set;
   - direct `agents` overlays do not duplicate virtual-agent roles;
   - the package skill is projected only through resolver-owned manifest projection.
10. Run focused registry/template/docs tests, typecheck, and `git diff --check`.

## Non-Goals

- Do not change MirrorTest's actual projected agent set.
- Do not add automatic role-union release to package manager or payload release.
- Do not add a second expert-squad template catalog or active selection field.
- Do not make the template a payload package that is automatically released into user projects.

## 2026-07-16 Superseding Correction

This record preserves the rationale of the 2026-07-07 implementation plan, but its runtime identity and authoring-skill placement are no longer authoritative. The current contract is recorded in `2026-07-11-platform-runtime-external-goal-team.md` and in `specs/current/architecture/04-extensions.md`.

- `capability_projection.agents.<agentID>` is the dynamic runtime, dispatch, message, catalog, tool, and skill projection identity. Fixed `AgentRoleID` values and manifest `base_role` values are runtime-template seeds, not worker identities or dispatch aliases.
- Worker prompt overlays contain domain responsibility, evidence requirements, and stop conditions. `PromptProfileResolver.composeResolvedAgentPrompt()` owns the sole model-visible `<projected_agent_identity>` block.
- The portable authoring skill remains part of the human/agent developer artifact, but lives at `authoring-skill/SKILL.md` outside the runnable `package/` root. Installing a business expert squad therefore cannot project package-authoring instructions into scheduler or worker runtime.
- The runnable sample uses manifest v1 `capability_projection.agents` and immutable `virtual_workflows` guidance. The old `virtual_agents` and implicit base-role identity model is removed rather than supported through compatibility logic.

The generator, checked-in artifact, registry/resolver tests, payload checks, and document-health checks enforce the corrected single source.
