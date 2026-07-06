# Expert Squad Payload Generation

Date: 2026-07-06
Status: Implementation record
Owner: Codex

Supersession note: this record describes the payload generator before the later namespaced package-source layout. The current canonical source and install path is `.opencorvus/expert-squads/<namespace>/<id>/`; WuJiang OpenTest now uses manifest ID `opentest` under `.opencorvus/expert-squads/wujiang/opentest/`.

## Glossary

- ID: Identifier, the stable machine identity of an expert-squad package.
- UI: User Interface.

## Recall

### User Request

The user challenged the static `packages/opencorvus/src/expert-squad/payload.ts` expert-squad payload list after the `Software Testing` display name had already been renamed to `WuJiang/OpenTest`, and asked why payload loading is not dynamic.

The user then pointed at `.opencorvus/expert-squads/software-testing` and objected that the name still looked unchanged and that `agents` and `virtual-agents` existed at the same time.

### Acceptance Criteria

- Runtime expert-squad identity remains manifest `id`; `software-testing` stays the package ID even when the user-visible label is `WuJiang/OpenTest`.
- Repository non-`general` expert-squad payload sources are generated from `.opencorvus/expert-squads/<id>/` instead of being hand-maintained as a parallel static list.
- The generated payload still embeds package files for distributable release because packaged binaries cannot scan the source repository after compilation.
- Build/package flow refreshes the generated payload before Bun compile.
- Tests prove the checked-in generated payload is current with `.opencorvus/expert-squads`.
- `software-testing` remains visible only where it is the machine ID, profile ID, package ref namespace, or selector skill name; user-facing label/title content remains `WuJiang/OpenTest`.
- `software-testing/agents` contains only role directories declared by `expert-squad.jsonc` `agents`; empty undeclared role directories are not accepted.
- Virtual-agent prompt and role-scoped package skills for `software-testing` live under `virtual-agents/<role>/`; the package must not keep same-role resource directories under `agents/<role>`.
- No fallback aliases, no runtime built-in expansion beyond `general`, no overwrite of existing project packages, and no second active expert-squad selection source are introduced.

### Hard Constraints

- Do not change manifest IDs, package directories, active profile IDs, package refs, or `prompt_profile.active`.
- Do not make ordinary skills create or select expert squads.
- Do not scan inactive package production resources into active runtime.
- Do not restart, refresh, kill, or otherwise disturb a running OpenCorvus/overlay process.
- Preserve unrelated dirty worktree changes.

### Sources Read

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-05-expert-squad-payload-seeding-and-skill-refresh.md`
- `specs/records/2026-07/2026-07-06-software-testing-display-name.md`
- `packages/opencorvus/src/expert-squad/payload.ts`
- `packages/opencorvus/src/expert-squad/manager.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/src/expert-squad/registry.ts`
- `packages/opencorvus/script/build.ts`
- `script/package-linux-binary.ts`
- `packages/opencorvus/test/expert-squad/package-manager.test.ts`

### Repository Search Evidence

| Command | Finding |
| --- | --- |
| `rg -n "payload\\.ts|payloadPackageSources|dynamic.*payload|generate.*payload|embedded package|releasePayloadPackages|\\.opencorvus/expert-squads|打包|payload" specs/current/architecture/04-extensions.md specs/records/2026-07 packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad packages/opencorvus/script script -g "*.md" -g "*.ts"` | Runtime project packages are dynamically discovered, but distributable payloads are currently a hand-maintained `payload.ts` module imported by `manager.ts`. |
| `rg -n "payloadPackageSources|releasePayloadPackages|from \"\\.\\/payload\"|from \"\\.\\/manager\"|prompt-profile-resolver|ExpertSquadPackageManager" packages/opencorvus/src packages/opencorvus/script -g "*.ts"` | `ExpertSquadPackageManager` is the only release owner; `PromptProfileResolver` calls payload release before project discovery. |
| `rg -n "isRuntimeInternalEntry|parseID|loadPackage|loadSourcePackage|manifestPath|readOptionalDirectoryEntries" packages/opencorvus/src/expert-squad/registry.ts` | The registry already exposes ID parsing, package loading, and runtime-internal rejection helpers that generation can reuse. |
| `tar -tf packages/opencorvus/dist/binary/opencorvus-linux-x64-baseline/opencorvus-bundle.tar.gz | Select-String -Pattern '^\\.\\/\\.opencorvus|\\.opencorvus\\/expert-squads|expert-squads'` | The bundle tar does not contain a raw `.opencorvus/expert-squads` directory; payload content is embedded into the executable and released later. |
| `rg -n "agents/.*/skills|virtual-agents|virtual_agents|packageSkillRefs|skill_refs" packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad .opencorvus/expert-squads/software-testing -g "*.ts" -g "*.jsonc" -g "*.md"` | The old implementation allowed package skills for virtual-agent base roles to live under `agents/<role>/skills`, while prompts lived under `virtual-agents/<role>/system.md`; this was a real directory-level ambiguity. |
| `Get-ChildItem .opencorvus/expert-squads/software-testing/agents -Directory` | The package retained empty undeclared role directories under `agents`, which made the source layout look like a second active agent surface even though only `orchestrator` was declared. |

### Independent Agent Feedback

No independent sub-agent was used. The bug is localized to payload source generation and build wiring; existing package manager/resolver tests already cover release semantics.

## Diagnosis

Runtime package loading is dynamic for project directories: `ExpertSquadRegistry.discover()` reads `.opencorvus/expert-squads/<id>` and `PromptProfileResolver` projects the active package through the registry/manager/resolver path.

The non-dynamic part is distribution payload seeding. `payload.ts` currently enumerates repository expert-squad files as static imports. That works for Bun compile, but as a hand-maintained list it creates a second source that can drift from `.opencorvus/expert-squads`.

The correct boundary is build-time generation: the executable still needs static imports or an equivalent embedded payload, but the checked-in payload module should be generated from `.opencorvus/expert-squads` so package content remains single-source.

The `software-testing` string remains correct for machine identity. It is the manifest ID, directory name, package ref namespace, profile ID, and selector skill namespace. `WuJiang/OpenTest` is the user-facing label. The lingering implementation problem was not that the manifest display name failed to change, but that generated payload code and package refs expose the machine ID and can be mistaken for user-visible naming.

The `agents` plus `virtual-agents` split had a real design smell. Registry validation already rejected `agents.<role>` manifest prompt binding for a role that declares `virtual_agents.<role>`, but it still allowed `agents/<role>/skills/**` directories for that virtual-agent role. That kept package resources for one logical virtual agent in two top-level directories.

`agents/orchestrator` and `virtual-agents/build|integrity` can coexist because they are different declared role classes: `orchestrator` is a normal agent overlay, while `build` and `integrity` are package-owned virtual agents. Empty undeclared `agents/<role>` directories are not a valid third category; they are source drift and must be deleted and rejected by registry validation.

## Implementation Plan

1. Add a generator under `packages/opencorvus/script/` that scans `.opencorvus/expert-squads`, validates packages through `ExpertSquadRegistry`, and renders `packages/opencorvus/src/expert-squad/payload.ts`.
2. Mark `payload.ts` as generated and regenerate it from the current package directories.
3. Call the generator from `packages/opencorvus/script/build.ts` before Bun compile so binary packaging cannot use stale payload sources.
4. Move virtual-agent role package resources to `virtual-agents/<role>/skills|tools|mcp` and reject same-role `agents/<role>` directories when `virtual_agents.<role>` is declared.
5. Reject ordinary `agents/<role>` directories unless `expert-squad.jsonc` declares `agents.<role>`, and assert the repository `software-testing` package only keeps `agents/orchestrator`.
6. Add focused tests that compare checked-in `payload.ts` with the generator output and prove virtual-agent package skills resolve from `virtual-agents/<role>/skills`.
7. Update architecture docs and the monthly index.
8. Validate with focused payload generation/package-manager/registry/resolver tests, docs-link tests, typecheck, routes/docs checks, and diff checks.

## Verification

- `bun packages/opencorvus/script/generate-expert-squad-payload.ts`
- `bun test packages/opencorvus/test/expert-squad/registry.test.ts -t "repository software-testing|virtual agent|undeclared agent role"`
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts -t "projects repository software-testing selector, scheduler tools, and worker tools|active virtual worker projection hash"`
- `bun test packages/opencorvus/test/expert-squad/payload-generation.test.ts`
- `bun test --timeout 20000 packages/opencorvus/test/expert-squad/package-manager.test.ts -t "payload package sources match current repository expert-squad packages|software-testing payload exposes one external OpenTest protocol engine source"`
- `bun test packages/opencorvus/test/server/expert-squad-routes.test.ts -t "active software-testing virtual agent projection"`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run typecheck`
- `bun run api:routes-check`
- `bun run docs:check`
- `git diff --check`
