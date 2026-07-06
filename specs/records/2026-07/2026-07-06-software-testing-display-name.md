# Software Testing Display Name

Date: 2026-07-06
Status: Implementation record
Owner: Codex

## Glossary

- ID: Identifier, the stable machine identity of an expert-squad package.
- UI: User Interface.

## Recall

### User Request

Rename the Software Testing expert squad to `WuJiang/OpenTest`.

### Acceptance Criteria

- The user-visible expert-squad name is `WuJiang/OpenTest`.
- The manifest `id`, package directory, package refs, selector skill name, active profile value, and `prompt_profile.active` value remain `software-testing`.
- Catalog display derives `Builtin/WuJiang/OpenTest` from the existing `Builtin` README prefix and the manifest label.
- Selector skill content and README title no longer present the expert squad as `Software Testing`.
- Registry, resolver, payload, and catalog route tests prove the renamed package still loads and projects through the normal expert-squad path.

### Hard Constraints

- Do not use `WuJiang/OpenTest` as the manifest ID because `/` is not legal in expert-squad IDs and labels must not determine identity.
- Do not add aliases, fallback names, compatibility profile IDs, a second active-squad field, hidden UI filtering, or package-name guessing.
- Do not change OpenTest protocol files, package refs, directory names, package tool provider names, or workflow identity.
- Preserve unrelated dirty worktree changes.

### Sources Read

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md`
- `specs/records/2026-07/2026-07-06-expert-squad-readme-display-prefix.md`
- `specs/records/2026-07/2026-07-06-software-testing-expert-squad-integration.md`
- `specs/records/2026-07/2026-07-06-global-virtual-agent-opentest-adaptation.md`
- `specs/records/2026-07/2026-07-06-opentest-contract-engine.md`
- `.opencorvus/expert-squads/software-testing/expert-squad.jsonc`
- `.opencorvus/expert-squads/software-testing/README.md`
- `.opencorvus/expert-squads/software-testing/selector.md`
- `packages/opencorvus/src/expert-squad/catalog-profile.ts`
- `packages/opencorvus/test/expert-squad/registry.test.ts`
- `packages/opencorvus/test/expert-squad/package-manager.test.ts`
- `packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`
- `packages/opencorvus/test/server/expert-squad-routes.test.ts`

### Repository Search Evidence

| Command | Finding |
| --- | --- |
| `rg -n "Software Testing|software-testing|OpenTest|WuJiang|label|display_label|displayPrefix|expert_squad_display_prefix" .opencorvus/expert-squads/software-testing packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/overlay/src packages/overlay/test specs/current specs/records/2026-07` | The package display name is the manifest `label`; catalog `display_label` is derived from README `displayPrefix` plus label; `software-testing` appears as identity and package refs and must remain unchanged. |
| `rg -n "Software Testing|Software testing|software-testing Expert Contract|Software-testing|software testing expert|Software Test|WuJiang" .opencorvus/expert-squads/software-testing packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/overlay/test specs/records/2026-07` | Only package README, selector, manifest label, and a resolver selector-content assertion need display-name updates. Generic "software test" skill titles can remain domain terminology. |
| `rg -n "Builtin/Software|Software Testing|software-testing" packages/overlay/test packages/overlay/src packages/opencorvus/test/server packages/opencorvus/test/agent packages/opencorvus/test/expert-squad -g "*.ts" -g "*.tsx"` | Overlay has no hardcoded `Software Testing` display string; backend tests mostly assert identity refs and one selector heading. |
| `rg -n "ExpertSquadRegistry|ExpertSquadPackageManager|PromptProfileResolver|expert-squads|expert-squad.jsonc|prompt_profile.active|select_expert_squad|active_skill_projection|capability_projection" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs/current specs/records` | Current runtime authority remains registry/manager/resolver/catalog with `prompt_profile.active` as the single active selection source. |
| `rg -n "loadEmbeddedPackage|EmbeddedPackageSource|renderSelectorSkillMarkdown|discover\\(|loadPackage\\(|loadSourcePackage\\(|importDirectory\\(|importArchive\\(|exportArchive\\(|payload|seed|release" packages/opencorvus/src packages/opencorvus/test` | Payload release uses embedded package files from repository source; no separate payload path edit is required when package file content changes. |
| `rg --files .opencorvus/expert-squads packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/overlay/test | sort` | The relevant package source is `.opencorvus/expert-squads/software-testing`; focused tests live under expert-squad and server route suites. |

### Independent Agent Feedback

No independent sub-agent was used. The change is a display-name update bounded by the existing identity/display-prefix architecture and covered by focused tests.

## Implementation Plan

1. Change `.opencorvus/expert-squads/software-testing/expert-squad.jsonc` label and description to `WuJiang/OpenTest`.
2. Change package README title and first sentence to the new display name while keeping README prefix `Builtin`.
3. Change selector heading to `WuJiang/OpenTest Expert Squad Selector`.
4. Add/update tests so registry and route catalog prove `label` and `display_label` are `WuJiang/OpenTest` and `Builtin/WuJiang/OpenTest`, and resolver selector content uses the new heading.
5. Validate with focused registry, resolver, route, payload, docs-link, and diff checks.

## Verification

- `rg -n "Software Testing|software-testing Expert Contract" .opencorvus/expert-squads/software-testing packages/opencorvus/test/expert-squad packages/opencorvus/test/server` returned no matches.
- `bun test packages/opencorvus/test/expert-squad/registry.test.ts -t "repository software-testing"` passed.
- `bun test --timeout 20000 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts -t "projects repository software-testing selector, scheduler tools, and worker tools"` passed.
- `bun test --timeout 20000 packages/opencorvus/test/expert-squad/package-manager.test.ts -t "payload packages carry formal expert contracts|software-testing payload exposes one external OpenTest protocol engine source"` passed.
- `bun test --timeout 20000 packages/opencorvus/test/server/expert-squad-routes.test.ts -t "active software-testing virtual agent projection"` passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` passed.
- `git diff --check` passed.
- `bun run api:routes-check` passed.
- `bun run docs:check` passed.
- `bun run typecheck` passed.
