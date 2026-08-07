# Expert Squad Skill Projection Completeness

Supersession note: Package-layout statements in this record that use `.opencorvus/expert-squads/<id>` are superseded by `2026-07-06-expert-squad-namespaced-source-layout.md`; current project package roots are `.opencorvus/expert-squads/<namespace>/<id>/`.

## Recall

User correction:

- "skills 根本没有加载全."

Retained requirements:

- Expert squads are loaded from `.opencorvus/expert-squads/<id>` by manifest `id`.
- Each agent folder may contain dedicated `skills/`.
- Expert-squad exclusive skills/tools/MCP are unioned with the system's currently supported collections.
- Inactive package production skills must not leak into `general` selector discovery or other inactive squads.
- `SkillMount.resolve`, `SkillTool`, system prompt skill rendering, `/skill/mounts`, and `/expert-squad/catalog.active_skill_projection` must share one backend projection surface.
- No fallback, compatibility alias, UI-only filtering, second active field, or hidden gate.

Sources reread before implementation:

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md`
- `specs/records/2026-07/2026-07-05-overlay-expert-squad-settings-redesign.md`
- `packages/opencorvus/src/expert-squad/registry.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/src/skill/mounts.ts`
- `packages/opencorvus/src/tool/skill.ts`
- `packages/opencorvus/src/session/system.ts`
- `packages/overlay/src/components/settings/ExpertSquadPanel.tsx`
- `packages/overlay/src/components/settings/SkillMarketPanel.tsx`

Repository search evidence:

- `rg -n "resolveSkillProjection|package_skill_refs|default_skill_refs|selector_skill|production_skill|projected_skill|Skill\\.parse|skill_refs|skills" packages/opencorvus/src/expert-squad packages/opencorvus/src/agent packages/opencorvus/src/skill`
- `rg --files packages/opencorvus/src/expert-squad/builtin .opencorvus/expert-squads`
- `rg -n "unreferenced-default|project-guidance|without unreferenced|SkillMount\\.matrix|active_skill_projection|project_mounts" packages/opencorvus/test packages/overlay/test -g "*.ts"`
- `rg -n "active_skill_projection|production_skill_names|selector_skill_names|projected_skill_names|skills\\.map" packages/overlay/src -g "*.ts" -g "*.tsx"`

Findings:

- `ExpertSquadRegistry.collectPackageRefs()` already discovers every `agents/<agent>/skills/**/SKILL.md` and `skills/**/SKILL.md`.
- `PromptProfileResolver.resolveSkillProjection()` only loads default skills listed in `default_skill_refs` and package skills listed in `package_skill_refs`.
- This makes `capability_projection` a narrowing whitelist for ordinary `.opencorvus/skill(s)` skills, contradicting the required union with the system collection.
- Existing tests pin the narrowing behavior by expecting `unreferenced-default` to be absent from `/skill/mounts` and `SkillTool`.
- Current repository packages under `.opencorvus/expert-squads/*` contain prompts and manifests but no package `SKILL.md` files; therefore the immediate visible loss is mainly ordinary installed skills being removed from the projection.
- The overlay Expert Squad page reads `active_skill_projection` from the backend and does not have an independent way to recover omitted skills.

## Repair Plan

The authoritative skill projection is:

- all ordinary default skills returned by the existing skill loader, preserving each skill's own `mounted_agents`;
- selector skills generated for selector-capable packages according to the active profile;
- all active package agent-local skills discovered by `ExpertSquadRegistry`, mounted to their owning agent;
- package shared skills only when explicitly projected by `package_skill_refs`, because shared package ownership has no single agent implied by directory position.

`default_skill_refs` and `package_skill_refs` remain additive projection refs. They may add role mounts to skills already present in the union, but they must not be required for a normal installed skill or agent-local package skill to appear.

Validation must prove:

- ordinary installed skills remain visible in active expert-squad skill projection without manifest refs;
- package agent-local skills discovered from directory structure appear even when omitted from `package_skill_refs`;
- inactive package production skills remain hidden;
- `general` still exposes selector skills without loading inactive package production files;
- `/skill/mounts`, `SkillTool`, and catalog `active_skill_projection.skills` use the same completed surface.

## Independent Agent Review

Plato review found one real remaining inconsistency: `/skill/mounts` expanded the visible agent surface locally from projected skill mounts, while `/expert-squad/catalog.active_skill_projection` still reported only capability-projected agents. The implementation was revised so `PromptProfileResolver.resolveSkillProjection()` owns the full projected agent surface for non-`general` profiles and both routes consume the same value.

Hypatia review found no blocking design issue after the union change, but required stronger route/tool/system-prompt evidence for active package agent-local skills and an explicit visible failure when package `SKILL.md` frontmatter tries to declare `agents` or `mounted_agents`. Those cases were added to the focused tests.

## Implementation

- `PromptProfileResolver.resolveSkillProjection()` now starts from every default skill returned by the default skill loader, preserving each skill's own `mounted_agents`.
- Active non-builtin expert-squad packages auto-project every directory-discovered `agents/<agent>/skills/**/SKILL.md` and mount it to the owning agent.
- Top-level package `skills/**/SKILL.md` remains shared and projects only through explicit `package_skill_refs`, because the directory path has no implied agent owner.
- Manifest `default_skill_refs` and `package_skill_refs` are additive role mounts, not whitelists.
- Package skill frontmatter that declares `agents` or `mounted_agents` fails visibly instead of creating a second ownership source.
- Catalog `active_skill_projection`, `/skill/mounts`, `SkillMount.resolve`, `SkillTool`, and `SystemPrompt.skills` now share the resolver's completed projection surface.

## Validation Results

- `bun test --timeout=2147483647 packages/opencorvus/test/tool/skill.test.ts` passed: 13 pass, 0 fail, 150 `expect()` calls.
- `bun test --timeout=2147483647 packages/opencorvus/test/agent/agent.test.ts packages/opencorvus/test/server/config-routes.test.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/server/skill-routes.test.ts packages/opencorvus/test/tool/skill.test.ts` passed: 180 pass, 1 skip, 0 fail, 1515 `expect()` calls.
- `bun test --timeout=2147483647 packages/opencorvus/test/script/historical-docs-links.test.ts` passed: 19 pass, 0 fail, 66 `expect()` calls.
- `bun run --cwd packages/opencorvus typecheck` passed.
- `git diff --check -- packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/server/skill-routes.test.ts packages/opencorvus/test/tool/skill.test.ts packages/opencorvus/test/agent/agent.test.ts packages/opencorvus/test/server/config-routes.test.ts specs/records/2026-07/README.md` passed for tracked relevant diffs.
- `Select-String -Path specs/records/2026-07/2026-07-05-expert-squad-skill-projection-completeness.md -Pattern '[ \t]+$'` returned no trailing whitespace for the new untracked spec file.
