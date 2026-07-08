# Expert Squad Release Schema Audit

Date: 2026-07-08
Status: Completed
Owner: Codex

## Recall

### User Request

The user asked to verify whether `.opencorvus/expert-squads` is the latest and only true source for expert-squad definitions, because other projects derive from that directory. The user also asked to check payload release and loading, and to judge whether the expert-squad package shape is stable, robust, and scientifically reasonable enough to serve as a long-lived release schema.

### Acceptance Criteria

- Repository package sources under `.opencorvus/expert-squads/<namespace>/<id>/` are the only non-general expert-squad distribution source.
- Generated payload code matches the current repository package sources and is not a hand-maintained second source.
- Project-open and explicit payload release use `ExpertSquadPackageManager.releasePayloadPackages()` and do not overwrite existing project-owned packages.
- Runtime loading uses normal registry discovery and `PromptProfileResolver` projection after release; resolver/catalog/overlay must not independently scan inactive resources into active runtime.
- Manifest identity remains `expert-squad.jsonc.id`; `namespace` remains source/install partition; `prompt_profile.active` remains the only active expert-squad selection source.
- The release schema should fail on malformed or incomplete packages rather than silently accepting unstable distribution metadata.
- Any code change must include focused tests, TypeScript validation where relevant, documentation link validation, and `git diff --check`.

### Hard Constraints

- No fallback, compatibility alias, hidden gate, UI-only filter, duplicate active state, inactive package scan, or direct `PromptProfile.builtIns` expansion for non-general packages.
- Do not overwrite project packages during automatic payload release.
- Do not make ordinary skill import implicitly create, release, select, or override expert squads.
- Keep runtime built-in packages limited to `general` unless a task explicitly reopens that architecture.
- Preserve unrelated user or repository changes; do not use `git reset` or create a new worktree.
- Do not restart, kill, refresh, or interfere with running OpenCorvus or overlay processes.

### Sources Read

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-06-expert-squad-formal-contracts.md`
- `specs/records/2026-07/2026-07-08-expert-squad-project-open-payload-release.md`
- `packages/opencorvus/test/fixture/expert-squad.ts`

### Repository Search Evidence

- `rg -n "ExpertSquadRegistry|ExpertSquadPackageManager|PromptProfileResolver|expert-squads|expert-squad\\.jsonc|prompt_profile\\.active|select_expert_squad|active_skill_projection|capability_projection" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs/current specs/records`
  - Current architecture and code point to namespaced package roots, `prompt_profile.active` selection, `PromptProfileResolver` projection, and project package discovery instead of non-general built-ins.
- `rg -n "loadEmbeddedPackage|EmbeddedPackageSource|renderSelectorSkillMarkdown|discover\\(|loadPackage\\(|loadSourcePackage\\(|importDirectory\\(|importArchive\\(|exportArchive\\(|payload|seed|release" packages/opencorvus/src packages/opencorvus/test`
  - Payload generation, release, import/export, registry loading, and route coverage are concentrated under `src/expert-squad/**`, `src/project/instance.ts`, and focused expert-squad tests.
- `rg --files .opencorvus/expert-squads packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/overlay/test | sort`
  - Current repository packages are `builtin/algorithm`, `builtin/backend`, `builtin/frontend-automation-debug`, `builtin/frontend-innovate`, `builtin/frontend-replica`, and `wujiang/opentest`; runtime built-in source contains only `general`.

### Independent Agent Feedback

Not used. This audit is being performed directly against the package sources, registry, manager, resolver, catalog, project-open release path, and focused tests.

## Audit Plan

1. Load every repository package through `ExpertSquadRegistry` and compare package identity against its namespace/path.
2. Regenerate or verify `packages/opencorvus/src/expert-squad/payload.ts` from `.opencorvus/expert-squads` and run payload drift tests.
3. Trace payload release through project bootstrap, explicit route, manager no-overwrite semantics, registry discovery, resolver projection, catalog, and overlay service contracts.
4. Identify schema fields that are too weak for long-lived release distribution, then fix source and tests if the code accepts unstable packages.
5. Run focused registry, manager, resolver, route, docs-link, typecheck, and diff validation.

## Runtime Screenshot Follow-up

The 2026-07-08 Overlay screenshot reported `source: initApp`, `HTTP (Hypertext Transfer Protocol) 500 config`, and
`project expert squad manifest requires selector metadata` while opening
`C:/Users/chuan/myhexin-local/demos/economy/futures`.

Current evidence gathered in this follow-up:

- `packages/opencorvus/src/server/server.ts` wraps project-scoped routes, including `GET /config`, in `Instance.provide`.
- `packages/opencorvus/src/project/instance.ts` runs `ExpertSquadPackageManager.releasePayloadPackages({ projectDirectory: ctx.directory })` and then `ExpertSquadRegistry.discover(ctx.directory)` during project bootstrap. A project-open package failure therefore surfaces as `/config` 500 during `initApp`.
- `packages/opencorvus/src/expert-squad/manager.ts` validates each embedded payload source with `ExpertSquadRegistry.loadEmbeddedPackage(source)` before checking whether a same-ID project package already exists. Existing test coverage currently locks this behavior with `payload release validates embedded manifest identity before existing-package skip`.
- Current disk package validation for `C:/Users/chuan/myhexin-local/demos/economy/futures` loaded all six project packages successfully through current source: `builtin/algorithm`, `builtin/backend`, `builtin/frontend-automation-debug`, `builtin/frontend-innovate`, `builtin/frontend-replica`, and `wujiang/opentest`; each had selector metadata.
- Current source payload selector contract also passed the focused package-manager selector test.

Diagnosis for the screenshot is therefore not "the current futures project package files lack `selector`".
The likely direct trigger is a running OpenCorvus app build whose embedded payload source is older than the current
repository package contract. Because project bootstrap validates embedded payloads before existing-package skip,
that stale embedded payload can fail `/config` even when the project directory already contains valid selector-backed
packages. This is an intentional hard validation path from the project-open payload release design, not a frontend
toast rendering issue.

## Audit Findings

The long-lived release schema is stable enough to keep `.opencorvus/expert-squads/<namespace>/<id>/` as the only repository source for non-general expert squads, with the following constraints locked in code and tests:

- Repository packages currently resolve to `builtin/algorithm`, `builtin/backend`, `builtin/frontend-automation-debug`, `builtin/frontend-innovate`, `builtin/frontend-replica`, and `wujiang/opentest`; the runtime built-in package tree remains limited to `general`.
- `expert-squad.jsonc.id` remains the sole package identity. Directory names, archive names, selector skill names, package labels, and Model Context Protocol (MCP) server names are not identity sources.
- `namespace` remains an install/source partition. It is not an active identity and it is not used as a compatibility alias.
- `prompt_profile.active` remains the only active expert-squad selection source. Catalog, Overlay User Interface (UI), MCP, package tools, and visible skill projection flow through `PromptProfileResolver` instead of independently scanning inactive package resources.
- `packages/opencorvus/src/expert-squad/payload.ts` is generated from `.opencorvus/expert-squads` and is validated by drift tests. It is a release artifact, not a second authoring source.
- Payload release is provisioning-only: project-open and explicit release both use `ExpertSquadPackageManager.releasePayloadPackages()`, validate embedded payload packages, and do not overwrite existing project-owned packages.
- Manifest `version` is required in registry, catalog, Overlay fixture, and package tests. A package missing release metadata now fails validation instead of entering a long-lived distribution channel with ambiguous provenance.

## Corrections Made

The audit found that package schema ownership was sound, but payload loading and package-local execution needed stronger lifecycle ownership before the schema could be called robust for long-term release:

- Local MCP stdio connections now use the shared `ProcessSupervisor` through a supervised transport, including deterministic close, pending-start disposal, and explicit scoped connection pooling for resolver prompt/resource reads. The scoped pool stores a pending connection entry before awaiting startup, so concurrent prompt/resource reads for the same local MCP server share one connection and close it once.
- Package tool execution now goes through a `ToolHost` command API instead of letting package tools spawn and clean up operating-system processes directly. The OpenTest runner was updated to use that host-owned execution path.
- `ProcessSupervisor` now has a direct command spawn path in addition to shell command spawning, so MCP and package tools pass executable plus arguments as structured process data.
- Windows direct command startup now waits for the pid file as the launch evidence even when the supervised child exits quickly; only explicit helper failure exit codes take the short failure path.
- `Process.run()` now treats natural completion as process exit plus stdout/stderr stream close, so abort and cleanup failures are still observable after the root process exits but before inherited stdio descendants close.
- Resolver prompt/resource descriptor projection no longer starts MCP servers just to list descriptors. MCP starts only when the projected prompt/resource is actually read.
- Real MCP and Instance-backed execution tests were split into isolated Bun processes where the important expert-squad chains assert no `killed ` dangling-process cleanup output.

These changes preserve the single-source package model. They remove process-lifecycle ambiguity around payload-loaded resources without adding fallback paths, hidden gates, alternate active state, or compatibility aliases.

## Remaining Risk

`packages/opencorvus/test/project/instance-cache.test.ts` still passes while printing Bun's global `killed 1 dangling process` cleanup line. The focused expert-squad resolver, package-manager, and route execution wrappers now forbid that output and pass, so the residual signal is broader Instance/MCP lifecycle cleanup rather than release-schema identity or payload release/load behavior. If the acceptance bar becomes "zero dangling-process cleanup in every unrelated Instance suite", that needs a separate root-cause pass. During this audit a parallel validation run also exposed a Windows helper pid-file race; that race was repaired and the standalone project bootstrap suite passed afterward.

## Validation

- `bun packages/opencorvus/script/generate-expert-squad-payload.ts`
- `bun test packages/opencorvus/test/mcp/host-connection-lifecycle.test.ts`
- `bun test packages/opencorvus/test/util/process.test.ts`
- `bun test packages/opencorvus/test/runtime/promise-boundaries.test.ts`
- `bun test packages/opencorvus/test/shell.test.ts -t "windows helper command mode|windows supervised request cleanup uses helper job ownership instead of reported pid kill-tree"`
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver-mcp-execution.test.ts`
- `bun test packages/opencorvus/test/expert-squad/payload-generation.test.ts`
- `bun test packages/opencorvus/test/expert-squad/registry.test.ts`
- `bun test packages/opencorvus/test/expert-squad/package-manager.test.ts`
- `bun test packages/opencorvus/test/server/expert-squad-routes.test.ts`
- `bun test packages/opencorvus/test/project/instance-cache.test.ts`
- `bun run --cwd packages/plugin typecheck`
- `bun run --cwd packages/opencorvus typecheck`
- `cargo fmt --manifest-path packages/opencorvus/native/process-supervisor/Cargo.toml --check`
- `cargo check --manifest-path packages/opencorvus/native/process-supervisor/Cargo.toml`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `git diff --check`
