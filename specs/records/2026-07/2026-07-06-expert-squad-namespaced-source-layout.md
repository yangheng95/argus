# Expert Squad Namespaced Source Layout

Date: 2026-07-06
Status: Implementation record
Owner: Codex
Supersession note: this record supersedes earlier direct-child expert-squad package layout claims and the `software-testing` current package identity.

## Glossary

- JSONC: JavaScript Object Notation with Comments, the manifest format used by `expert-squad.jsonc`.
- MCP: Model Context Protocol, package-local tool server configuration projected by `PromptProfileResolver`.
- Namespace: The expert-squad source and install partition under `.opencorvus/expert-squads/<namespace>/<id>/`.
- Runtime projection: The effective scheduler, worker, skill, tool, MCP, catalog, and overlay surface derived by `PromptProfileResolver`.

## Recall

### User Request

The user requested a new expert-squad directory layer with `builtin` and `wujiang` partitions. Existing built-in distributed expert squads must move under `builtin`, and `software-testing` must be renamed to `opentest` under `wujiang`. The user also requested a global check for name loading and display issues, plus refactoring existing builtin expert squads against the new external expert-squad loading architecture while cleaning useless content.

### Acceptance Criteria

- Repository source packages and project-installed payload packages use `.opencorvus/expert-squads/<namespace>/<id>/`.
- Builtin distributed packages live under `.opencorvus/expert-squads/builtin/<id>/`.
- WuJiang MirrorTest lives under `.opencorvus/expert-squads/wujiang/opentest/` with manifest `id = "opentest"`.
- `prompt_profile.active` remains the only active selection source and continues to use the manifest `id`, not the namespace.
- Manifest identity remains `expert-squad.jsonc.id`; namespace is a validated source/install partition and must not become an alias or display-derived identity.
- No fallback scanning of old `.opencorvus/expert-squads/<id>/` direct-child packages.
- No alias from `software-testing` to `opentest`.
- No inactive package scan, no `config.agent` generation, and no second workflow, dispatch engine, context packet, hidden message, or scheduling state machine.
- Payload generation, package release, import, export, discovery, resolver loading, catalog, routes, and tests use the same namespaced canonical path.
- Builtin package manifests do not project role entries that have no prompt overlay, virtual agent, package skill, package tool, package MCP, or other actual projection need.
- Existing MirrorTest protocol remains external and project runtime artifacts stay under `.opencorvus/opentest/`, not `.opentest/`.

### Hard Constraints

- `PromptProfileResolver` remains the single runtime projection surface for catalog, scheduler capability, worker capability, selector skills, skills, package tools, scoped MCP providers, and skill mounts.
- Package refs continue to use manifest IDs such as `opentest/shared/opentest-protocol-engine`; namespace is not part of package refs.
- Display labels and README display prefixes are display-only and must not determine package identity.
- Source upload folder names and archive wrapper names must not determine identity.
- Project package auto-release must not overwrite an existing namespaced package.
- Tests must prove old direct-child layout is not accepted by discovery as a compatibility path.

### Sources Read

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/README.md`
- An untracked July planning draft was observed as background user notes only and is not a committed source for this record.
- `specs/records/2026-07/2026-07-06-opentest-contract-engine.md`
- `packages/opencorvus/src/expert-squad/registry.ts`
- `packages/opencorvus/src/expert-squad/manager.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/script/generate-expert-squad-payload.ts`
- `packages/opencorvus/test/fixture/expert-squad.ts`

### Repository Search Evidence

- `rg -n "repositoryExpertSquadRoot|payloadPackageSources|EmbeddedPackageSource|loadEmbeddedPackage|generate-expert-squad-payload|ExpertSquadPackageManager|discover\\(|loadPackage\\(|loadSourcePackage\\(|importDirectory\\(|importArchive\\(|exportArchive\\(|releasePayload|expert-squads" packages/opencorvus/src/expert-squad packages/opencorvus/script packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/opencorvus/test/script -g "*.ts"`
  - Finding: discovery, resolver package lookup, package manager install/release/export, payload generation, route tests, and fixtures all assume `.opencorvus/expert-squads/<id>`.
- `rg --files .opencorvus/expert-squads | Sort-Object`
  - Finding: six source packages are direct children: `algorithm`, `backend`, `frontend-automation-debug`, `frontend-innovate`, `frontend-replica`, and `software-testing`.
- `rg -n "software-testing|opentest|MirrorTest|WuJiang|Builtin|expert_squad_display_prefix|display_label|selector" .opencorvus/expert-squads packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/overlay/src packages/overlay/test specs/current specs/records/2026-07 -g "*.ts" -g "*.tsx" -g "*.md" -g "*.json" -g "*.jsonc"`
  - Finding: `software-testing` appears in manifest ID, package refs, selector skill names, resolver tests, server route tests, payload, prompts, and historical records. It must be replaced in runtime sources and tests with `opentest`; historical text can remain historical unless it describes current behavior.
- `rg -n "software-testing|\\.opencorvus/expert-squads/<id>|\\.opencorvus/expert-squads/\\$\\{id\\}|\\.opencorvus/expert-squads/\\$\\{entry.name\\}|\\.opencorvus/expert-squads/[a-z]" specs/README.md specs/current/architecture/04-extensions.md specs/records/2026-07/README.md packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/expert-squad packages/opencorvus/test/server packages/opencorvus/src/expert-squad -g "*.ts" -g "*.md"`
  - Finding: architecture docs, July index, document-health tests, payload, registry tests, package-manager tests, resolver tests, server route tests, and skill-route tests contain current direct-child or `software-testing` assumptions.
- PowerShell manifest analysis of `capability_projection.agents` found unbound pure role-base entries:
  - `algorithm`: `compaction`, `title`, `summary`, `control`
  - `backend`: `compaction`, `title`, `summary`, `control`, `goal-workload-analyst`
  - `frontend-automation-debug`: `compaction`, `title`, `summary`, `control`
  - `frontend-innovate`: `compaction`, `title`, `summary`, `control`
  - `frontend-replica`: `compaction`, `title`, `summary`, `control`, `goal-workload-analyst`
  - `software-testing`: none

## Design

### Canonical Package Path

The canonical installed path is:

```text
.opencorvus/expert-squads/<namespace>/<id>/
```

`namespace` is validated package metadata. The supported namespaces for this change are:

```text
builtin
wujiang
```

The active profile ID remains the manifest `id`. For example, WuJiang MirrorTest is selected by:

```jsonc
{
  "prompt_profile": {
    "active": "opentest"
  }
}
```

not by `wujiang/opentest` and not by the old `software-testing` name.

### Manifest Shape

Add a required manifest field:

```jsonc
{
  "namespace": "builtin"
}
```

or:

```jsonc
{
  "namespace": "wujiang"
}
```

Validation rules:

- `loadPackage` requires the canonical parent folder name to match `manifest.namespace`.
- `loadPackage` requires the canonical package folder name to match `manifest.id`.
- `loadSourcePackage` validates manifest shape but does not derive identity from the upload folder name.
- `discover` scans only namespace directories and then package directories. It does not load direct-child package roots as a fallback.
- Duplicate manifest IDs across namespaces are rejected because `prompt_profile.active` uses manifest ID as the sole active key.

### Package Refs And Display

Package refs stay manifest-ID based:

```text
opentest/shared/opentest-protocol-engine
```

The namespace is not part of package refs. README `expert_squad_display_prefix` remains the display source. Builtin packages keep `Builtin`; MirrorTest uses `WuJiang`.

### Cleanup Rule

Builtin distributed packages should remove `capability_projection.agents.<role>` entries when all are true:

- the projection only contains `role_base: true`;
- the role has no `agents.<role>` prompt overlay;
- the role has no `virtual_agents.<role>`;
- the role has no package skill/tool/MCP/default refs or other actual projection fields.

This removes catalog/projection inflation without deleting real overlay prompts or package capabilities.

## Implementation Plan

1. Update registry manifest schema and package metadata to include validated namespace.
2. Update package discovery to scan `.opencorvus/expert-squads/<namespace>/<id>/` only.
3. Update package manager install, payload release, and export to use `namespace/id` canonical paths.
4. Update resolver package lookups and selector locations to use package catalog `root`.
5. Update payload generator and payload source shape to include namespace and scan source namespaces.
6. Move repository packages into `builtin` and `wujiang`; rename `software-testing` to `opentest`.
7. Replace runtime/test refs from `software-testing` to `opentest` and keep historical-only records as history where appropriate.
8. Remove unbound pure role-base projection entries from builtin package manifests.
9. Update docs and tests for namespaced package layout and display naming.
10. Regenerate payload and run focused validation.

## Validation Plan

- `bun test packages/opencorvus/test/expert-squad/registry.test.ts`
- `bun test --timeout 20000 packages/opencorvus/test/expert-squad/package-manager.test.ts`
- `bun test --timeout 20000 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`
- `bun test packages/opencorvus/test/expert-squad/payload-generation.test.ts`
- `bun test packages/opencorvus/test/server/expert-squad-routes.test.ts`
- `bun test packages/opencorvus/test/server/skill-routes.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`

## Implementation Summary

- Moved repository package sources from direct children to `.opencorvus/expert-squads/builtin/<id>/` and `.opencorvus/expert-squads/wujiang/opentest/`.
- Added required manifest `namespace` validation and rejected direct-child package roots during discovery.
- Kept expert-squad identity manifest-ID based. MirrorTest is selected as `opentest`, not `wujiang/opentest`; `software-testing` has no runtime alias.
- Updated package manager import, ZIP import, ZIP export, payload release, payload generation, registry discovery, resolver loading, catalog projection, routes, SDK, and overlay service types to carry namespace metadata.
- Removed implicit payload release from resolver/catalog read paths. Payload release is now the explicit `POST /expert-squad/release-payload` provisioning route.
- Regenerated `packages/opencorvus/src/expert-squad/payload.ts` and SDK/OpenAPI output from the current source of truth.
- Cleaned builtin package projection inflation by rejecting unbacked pure role-base projections in tests while retaining workflow-dispatch-backed roles such as `goal-workload-analyst`.
- Updated current architecture and July records so stale direct-child layout and `software-testing` current-identity claims are marked as superseded.

## Independent Review Notes

- A previous read-only reviewer found that implicit payload release inside resolver/catalog paths would mutate project package state from read routes. Resolution: resolver no longer calls `releasePayloadPackages`; explicit provisioning lives behind `POST /expert-squad/release-payload`.
- The same review found overlay fixtures still modelled old direct-child package roots. Resolution: browser fixtures now include `namespace` and return roots under `.opencorvus/expert-squads/<namespace>/<id>`.
- Arendt completed the final read-only review during validation and found no blockers. Evidence cited by the reviewer: direct-child old layout is rejected in registry discovery, canonical folder validation checks `namespace/id`, package manager install/export paths use `<namespace>/<id>`, resolver active package loading is selected by `prompt_profile.active` manifest ID, payload release is available only through the explicit route, payload sources are `builtin/*` and `wujiang/opentest`, overlay writes only `prompt_profile.active`, and SDK/OpenAPI expose `namespace` plus `release-payload`. Historical `software-testing` text remains only in superseded records.
- Sagan completed an additional read-only review and flagged that import routes still support explicit `replace`. Resolution: this is not treated as an overwrite blocker because the no-overwrite requirement applies to automatic payload release and inactive/read-path behavior. Explicit import replacement is an existing package-management operation requested through `replace`, covered by route and manager tests, and is not a fallback, alias, or implicit provisioning path. Payload release still skips any existing manifest ID across namespaces.

## Validation Results

Passed:

- `bun packages/opencorvus/script/generate-expert-squad-payload.ts`
- `bun run --cwd packages/sdk/js build`
- `bun test packages/opencorvus/test/expert-squad/registry.test.ts`
- `bun test --timeout 20000 packages/opencorvus/test/expert-squad/package-manager.test.ts`
- `bun test --timeout 20000 packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`
- `bun test packages/opencorvus/test/expert-squad/payload-generation.test.ts`
- `bun test --timeout 20000 packages/opencorvus/test/server/expert-squad-routes.test.ts`
- `bun test --timeout 20000 packages/opencorvus/test/server/skill-routes.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun run api:routes-check`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/overlay typecheck`
- `bun run overlay:i18n-check`
- `bun test --timeout 20000 packages/overlay/test/expert-squad-lifecycle-service.test.ts packages/overlay/test/expert-squad-settings-surface.test.ts`
- `bun run --cwd packages/overlay test:browser test/browser/expert-squad-panel.test.ts`

Rejected validation command:

- `bun test --timeout 20000 packages/overlay/test/browser/expert-squad-panel.test.ts` fails intentionally because browser tests require the Node runner and `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1`. The accepted command is the `packages/overlay` `test:browser` script above.
