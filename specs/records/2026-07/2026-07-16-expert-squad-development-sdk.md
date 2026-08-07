# Expert Squad Development SDK

Date: 2026-07-16
Status: Complete; committed and pushed
Owner: Codex

## Recall

### User Request

The continuing platform-runtime Goal requires OpenCorvus to be generic infrastructure whose agent-team runtime is extended through general interfaces and protocols. After that boundary is stable, the user explicitly requires an expert-squad development SDK with concise human-readable documentation. The user also requires each implementation slice to receive independent-agent review, requires E2E and headed GUI work to remain last, and requires continuous commits and pushes to `legacy-remote/v0.0.7beta`.

### Acceptance Criteria

- Keep manifest v1, manifest `id`, `prompt_profile.active`, dynamic `capability_projection.agents.<agentID>` identity and `PromptProfileResolver` as their existing single sources.
- Add an authoring surface to the existing `@opencorvus-ai/sdk`; do not create another SDK, client, manifest schema, package loader, ZIP implementation, active-state field or runtime discovery path.
- Give developers and agents a Node package scaffold writer whose manifest type is generated from the production OpenAPI contract and whose output is validated by the real `ExpertSquadRegistry` path.
- Add a read-only SDK validation operation that checks a source folder without installing, activating or mutating a project package.
- Keep installation, replacement, export and provisioning on the existing `ExpertSquadPackageManager` routes.
- Make the portable template generator consume the SDK scaffold renderer/writer as its concrete example instead of keeping a parallel file-tree materializer.
- Register the complete portable artifact root in the repository generated-artifact authority and regenerate it from the root generation entrypoint.
- Preserve `authoring-skill/SKILL.md` outside the runnable package and prove it is absent from scheduler and worker production projections.
- Add concise English and Chinese development documentation covering scaffold, validate and explicit import without claiming mocked or fixture-only tests are E2E.
- Cover positive scaffold-to-registry-to-manager-to-resolver behavior and negative malformed/legacy schema, unsafe path, implicit overwrite and activation behavior with focused tests.

### Hard Constraints

- No fallback, compatibility alias, name guessing, hidden gate, state machine, prompt keyword router or second source.
- `base_role` remains only a runtime-template seed. It is never an agent identity or dispatch alias.
- `virtual_workflows` remains immutable scheduler guidance. It does not gain active/default workflow selection, step state, auto-advance or dispatch execution.
- The SDK scaffold writer owns file materialization only. Semantic package validity remains owned by `ExpertSquadRegistry`; archive and install behavior remains owned by `ExpertSquadPackageManager`.
- The SDK writer must reject unsafe or duplicate relative paths and an existing destination. It must not silently merge, overwrite or preserve stale files.
- Tests use the inactivity supervisor with Bun elapsed timeout disabled. Real E2E and headed GUI remain the final Goal phase.
- The unrelated unstaged `packages/opencorvus/src/expert-squad/payload.ts` belongs to concurrent work and is excluded from this slice.

### Sources Read

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/README.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-07-portable-expert-squad-template.md`
- `specs/records/2026-07/2026-07-11-platform-runtime-external-goal-team.md`
- `packages/opencorvus/src/expert-squad/{protocol-schema,registry,manager}.ts`
- `packages/opencorvus/src/server/routes/expert-squad.ts`
- `packages/opencorvus/script/generate-portable-expert-squad-template.ts`
- `packages/opencorvus/test/expert-squad/portable-template.test.ts`
- `packages/opencorvus/test/server/expert-squad-routes.test.ts`
- `packages/sdk/js/{package.json,src/index.ts,src/client.ts,script/build.ts}`
- `script/{generate.ts,generated-artifacts.ts}`
- English and Chinese Agents and SDK reference documentation.

### Whole-Repository Search Evidence

- `rg -n "generatePortableExpertSquadTemplate|renderPortableExpertSquadTemplateFiles|generated-artifacts|generate\\.ts" script packages/opencorvus .github`
  - The portable generator and focused freshness test exist, but root `script/generate.ts` does not invoke it and `GENERATED_ARTIFACT_PATHS` does not own the artifact root.
- `rg -n "ExpertSquad|expert squad|expert-squad" packages/sdk packages/opencorvus/src/server`
  - The existing generated SDK exposes catalog, import, export, payload and Multica operations. It has no Node authoring subpath or read-only source validation operation.
- `rg -n "validateFolder|validate-folder|validateDirectory|importFolder|import-folder|ImportFolderInput|ExpertSquadRegistry\\.Manifest" .`
  - No validate-folder sibling exists. Import-folder is represented in the route, Manager, generated SDK, route inventory, transport protocol and tests; each of those call points must be updated for a new project-scoped validation operation.
- `rg -n "const Manifest|Manifest\\.parse|z\\.infer<typeof Manifest>" packages/opencorvus/src/expert-squad`
  - The complete manifest schema is private to `ExpertSquadRegistry`. It must be exported from that same source for OpenAPI rather than copied into the SDK.
- `rg -n "virtual_agents|virtual-agents|Runtime agent identity|base_role" packages/opencorvus/script/generate-portable-expert-squad-template.ts packages/opencorvus/test/expert-squad/portable-template.test.ts specs/artifacts/portable-expert-squad-template`
  - The current generator/artifact already uses manifest v1 dynamic identities, removes runtime authoring-skill projection and leaves identity injection to the resolver.

### Independent Agent Feedback

A one-layer independent read-only review bound to HEAD `23a25b4236b37be388028ec024d756a8370055a7` returned overall `REJECT`. It independently ran the focused portable test at `7 / 7` with 193 assertions and accepted the current dynamic-identity, resolver-owned identity block, manifest v1, virtual-workflow and external authoring-skill corrections. It rejected the broader SDK/template delivery because the artifact is not in the central generation chain and the existing SDK has no typed authoring/scaffold/read-only validation surface or guide. It explicitly required reuse of Registry, Manager and the existing generated client rather than a second schema, loader, ZIP implementation or client.

## Design

The SDK is one composed surface, not a new runtime subsystem:

1. `ExpertSquadRegistry.ManifestSchema` remains the runtime schema and becomes the OpenAPI response schema for `POST /expert-squad/validate-folder`.
2. `ExpertSquadPackageManager.validateDirectory` calls the same source-package loader and built-in collision check used by import, but does not install, activate or mutate package state.
3. The generated `OpenCorvusClient.expertSquad.validateFolder` method is the semantic validation API.
4. `@opencorvus-ai/sdk/expert-squad-authoring` is a Node-only subpath. Its manifest type is an alias of the generated validation response; its renderer serializes that typed manifest, and its writer safely materializes a new source directory. It performs no parallel semantic validation.
5. The portable generator supplies one concrete invoice-ledger definition to that SDK renderer/writer. Root generation owns the complete artifact directory.
6. Existing SDK import/export methods remain the only install/package transport API. Documentation presents scaffold, validate and import as separate explicit actions.

## Validation Plan

- SDK authoring unit tests: canonical rendering, binary/text files, unsafe paths, manifest collision, duplicate normalized paths, existing destination and partial-write cleanup.
- Real route tests: valid folder returns the exact manifest without discovery/install/activation changes; invalid legacy manifest returns `ExpertSquadPackageError` and leaves the project unchanged.
- Portable integration: SDK scaffold output loads through Registry, imports through Manager, resolves scheduler and two same-template dynamic workers by distinct IDs, and remains inactive until explicit config selection.
- Generation freshness: root generator call and generated-artifact registry are bound by tests; the checked-in artifact exactly matches the SDK-backed generator.
- SDK generation/build, route inventory, OpenCorvus/SDK typechecks, portable/registry/manager/resolver/route tests, docs health, historical links, product docs single source, `docs:check`, residue scan and `git diff --check`.
- Fresh exact-tree independent review before commit and push.

## Implementation Evidence

- `ExpertSquadRegistry.ManifestSchema` is the one exported runtime manifest schema. The new
  `POST /expert-squad/validate-folder` response and generated SDK type come directly from it.
- `ExpertSquadPackageManager.validateDirectory` and `importDirectory` share the same source-package
  loader and built-in collision validation. Validation returns the parsed manifest without installing,
  activating, replacing, or writing project package state.
- `@opencorvus-ai/sdk/expert-squad-authoring` materializes a caller definition into a new directory and
  rejects unsafe paths, normalized duplicates, manifest ownership collisions, file/directory collisions,
  existing destinations, and partially written new destinations.
- The portable template generator consumes the SDK renderer and writer. The complete artifact root is
  registered in `GENERATED_ARTIFACT_PATHS` and regenerated by the root `script/generate.ts` entrypoint.
- English and Chinese Agents documentation show the typed write, read-only validate, and explicit import
  lifecycle. Current architecture documentation records the Registry/Manager/SDK responsibility split.

## Problems Found During Validation

1. The existing MirrorTest catalog route test expected only the oldest local skill for test-architect,
   test-implementer, and visual-reviewer even though the checked-in manifest and resolver projection also
   grant the checked-in shared GUI, Figma, implementation, prompt, and run-modifier skills. The production
   manifest, generated payload, and resolver agreed; the stale assertions were updated to the exact manifest
   arrays and the whole isolated route suite passed.
2. The existing MirrorTest payload expert-contract test expected the intent analyst to repeat the retired
   phrase `active MirrorTest protocol engine`. The current checked-in prompt instead states that the parsed
   engine result is the only runtime protocol source. The test now asserts that current single-source
   contract, and the complete package-manager group passed.

## Validation Evidence

- Root generation completed twice. The full binary diff hash before and after the second run remained
  `9f039a23a0ad02aeb0ae3c1b6adeec434e05c1e3`, proving deterministic generation for the current tree.
- SDK package: `16 pass / 0 fail / 39 assertions`.
- Expert-squad Registry, Manager, Resolver, and portable template: `116 pass / 1 existing skip / 0 fail /
  1,259 assertions`.
- Expert-squad routes: all 12 isolated route cases passed through the parent supervisor.
- App OpenAPI and transport contract: `46 pass / 0 fail / 1,321 assertions`.
- Documentation health, historical links, and product single source: `81 pass / 0 fail / 1,260 assertions`.
- OpenCorvus, SDK, and transport TypeScript checks passed. Web Astro check reported zero errors.
- `docs:check` passed with 262 operations and 24 groups; `api:routes-check` passed across 30 route files;
  SDK import policy and `git diff --check` passed.
- SDK/template legacy scan found no runtime `virtual_agents`, `virtual-agents`, schema v2, active/default
  workflow, auto-advance, or persisted-step residue. Its only match is the current architecture statement
  that the retired identity surfaces do not exist.

## Final Independent Review

The one-layer independent read-only reviewer returned `ACCEPT` for HEAD
`8f000003e95621070b30678020eb9552644bf642` and staged patch
`2ced4800e55dd4daf9a64e042772a78c1ba64e97`. It independently confirmed the Registry-to-OpenAPI-to-SDK
schema source, validate/import side-effect boundary, writer path and overwrite behavior, portable generator
ownership, dynamic identity semantics, bilingual documentation, and absence of retired schema/workflow
surfaces. Its independent runs passed SDK plus portable `20 / 20`, route plus App plus transport `47 / 47`,
SDK build, generated TypeScript declarations, Node package subpath import, and diff checks. The unrelated
unstaged `packages/opencorvus/src/expert-squad/payload.ts` was explicitly excluded from the reviewed patch.

## Delivery

- Accepted implementation commit: `76c4b87fdd` (`dsw-33987 add expert squad development sdk`).
- The implementation was merged with concurrent remote work without SDK conflicts and pushed to
  `legacy-remote/v0.0.7beta`; the remote branch resolved to `ff29f5ad968bc13cd07b10a2770ed7a665a0b28f`
  immediately after delivery.
- The final pre-push hook passed SDK import and AI runtime checks, TypeScript checks across all 12 scoped
  packages, API route inventory, API documentation freshness, Overlay internationalization, and the tracked
  source secret scan.
- The parallel `packages/opencorvus/src/expert-squad/payload.ts` working-tree change remained unstaged and
  was neither committed nor pushed by this slice.
