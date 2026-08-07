# Expert Squad project-over-global resolution

Status: Implementation, independent code review, visual acceptance, and delivery verification are complete.

## Recall

### Original request

The user rejected global uniqueness of an Expert Squad manifest `id`, established the product rule that a project installation may override a user-global installation with the same `id` while emitting a warning, and then asked for the solution to be redesigned and reviewed by independent Agents.

### Acceptance criteria

1. A valid project package with logical ID `X` overrides a valid user-global package `X` only inside that exact project; another project without a local `X` continues to use global `X`.
2. The override is a typed warning and never causes project bootstrap, Expert Squad catalog, Mission Skill catalog, or Chat capability to return HTTP 500.
3. `prompt_profile.active` remains the only persisted logical selection. No `active_scope`, hidden selection, alias, synthetic message, or second active source is added.
4. Registry owns one deterministic effective-catalog operation. Resolver and all consumers receive at most one effective package per logical ID and do not implement their own project/global lookup.
5. A present but malformed project package reserves its logical ID and reports its project error; it never falls through to or executes the global package with the same ID.
6. Same-scope duplicate IDs across namespaces and external collisions with platform built-ins remain errors.
7. Settings exposes both physical installations so the shadowed global package remains configurable, exportable, updateable, and uninstallable through exact installation actions.
8. Configuration values, update, export, uninstall, payload status, and reference replacement are keyed by exact installation identity rather than logical ID alone.
9. Each resolved scheduler/worker Turn and produced Artifact records the exact package revision used, while explicit later install/update/uninstall actions may affect later Turns without introducing a second Task selection source.
10. Existing unrelated Expert Squads and unrelated malformed packages remain isolated according to the current partial-catalog contract.
11. Non-UI contracts use positive tests. UI acceptance uses the real Overlay, interaction, screenshots, and manual review without adding, changing, or running UI automation tests.
12. The exact implementation tree passes focused runtime contracts, generation freshness, typechecks, route/docs health, and a fresh independent review before a `dsw-33987` commit and `myhexin` push.

### Hard constraints

- `manifest.id` remains the logical user-facing selection ID, but is no longer globally unique across project and global installation scopes.
- Installed identity is explicit and scope-aware; runtime resolution is not allowed to depend on filesystem iteration order or `Array.find()` order.
- `PromptProfileResolver` remains the only runtime projection owner. Registry owns inventory and effective resolution; Manager owns physical lifecycle changes.
- Project-over-global is a declared overlay operation, not exception recovery. Only absence of a project identity selects global. Invalid project content never selects global.
- Built-in Expert Squad IDs remain reserved and cannot be overridden.
- No compatibility fields, legacy aliases, dual schema readers, automatic package copies, or database migration are introduced. The project is unpublished; old negative contracts are deleted rather than retained.
- No live Overlay restart, refresh, process termination, package deletion, or configuration reset is authorized by this planning task.
- The current developer configuration file `Global.Path.data/expert-squad-configuration.json` was read-only checked and is absent. If it exists when implementation begins, replacing its ID-only schema is a destructive configuration reset and requires a fresh backup/authorization decision before mutation.
- Preserve all parallel worktree changes. The planning task started on branch `v0.0.27beta` at `ea8ba625b247ace24ac8f32f5d0e692011f33f17` with a clean status snapshot.

### Sources read

- `AGENTS.md`
- `specs/README.md`, `specs/records/2026-07/README.md`
- `specs/current/architecture/01-agents.md`, `04-extensions.md`, and `99-principles.md`
- `specs/records/2026-07/2026-07-17-multica-global-expert-squad-storage.md`
- `specs/records/2026-07/2026-07-17-global-model-squad-lifecycle-and-composer-stop.md`
- `packages/opencorvus/src/expert-squad/{locations,registry,manager,prompt-profile-resolver,catalog,configuration,projection-hash}.ts`
- `packages/opencorvus/src/agent/prompt-profile.ts`
- `packages/opencorvus/src/session/{runtime-contract,runtime-contract-validation}.ts`
- `packages/opencorvus/src/server/routes/expert-squad.ts`
- Current production and test callers identified by the repository searches below.

### Whole-repository search evidence

The primary Agent ran repository-wide searches before writing this proposal:

```bash
rg -n "ExpertSquadRegistry\.(discover|discoverAvailable|discoverInstalledPackageIdentities|discoverGlobalAvailable|findInstalledPackageIdentitiesForProjects|loadPackage)|PromptProfileResolver\.|ExpertSquadPackageManager\.|prompt_profile\.active|installationScope|installation_scope|expertSquadID|expert_squad_id" packages/opencorvus/src packages/overlay/src packages/sdk/js/src packages/opencorvus/test packages/overlay/test --glob '!**/gen/**' --glob '!**/generated/**'
rg -n "duplicate expert squad|identity\.duplicate|manifest id is unique|global.*project|project.*global|packageDigest|package_digest|projection_hash" packages/opencorvus/src packages/overlay/src packages/opencorvus/test packages/overlay/test --glob '!**/generated/**'
rg -l "PromptProfileResolver\.|ExpertSquadRegistry\.|ExpertSquadPackageManager\.|prompt_profile\.active|expertSquadID|expert_squad_id|installationScope|installation_scope" packages/opencorvus/src packages/overlay/src packages/sdk/js/src --glob '!**/generated/**' --glob '!**/gen/**'
```

The first search produced 1,389 matches across source and tests. The production call points are grouped below; every listed group must be audited during implementation rather than assuming that a Registry edit propagates safely.

| Production surface | Current dependency | Required disposition |
| --- | --- | --- |
| `expert-squad/locations.ts`, `registry.ts` | Global and project locations are scanned together; same ID is quarantined or rejected. | Add raw per-location inventory and one effective overlay result. Keep same-scope uniqueness and built-in reservation. |
| `expert-squad/manager.ts`, `install-lock.ts`, `cleanup.ts` | Import scans cross-scope conflicts; release/market collapse packages into `Map<id>`; export accepts only ID. | Permit cross-scope coexistence, retain deterministic manifest-ID serialization, index lifecycle state by installation identity, require exact scope for export, and make cleanup exact-target. |
| `expert-squad/prompt-profile-resolver.ts`, `catalog-profile.ts`, `catalog.ts` | Active, selector, recommendation, settings, and skill projection assume one globally unique ID. | Consume only Registry's effective result; carry exact selected revision and structured warnings; expose effective rows separately from installation inventory. |
| `agent/prompt-profile.ts`, `config/candidate-validation.ts`, `config/model-reference-validation.ts` | `prompt_profile.active` is a logical string validated against the strict combined catalog. | Retain the string; validate it against the effective catalog for the exact context. Do not persist scope. |
| `expert-squad/configuration.ts`, configuration routes | Values are stored globally under `id` only and package configuration is found by effective ID. | Replace with exact installation keys, including project identity for project packages; configuration requests select an exact installation. |
| `project/instance.ts` | Project bootstrap treats global/project same-ID as a configuration failure. | Accept valid shadowing and surface warning diagnostics; keep malformed effective project packages strict. |
| `session/index.ts`, `session/loop.ts`, `session/runtime-contract*.ts`, `session/prompt/parts.ts`, `session/shell-exec.ts` | Runtime evidence carries logical ID and projection hash. | Carry the resolved package revision for each installed Turn contract and validate it across scheduler/worker/skill/tool surfaces. |
| `agent/runner.ts`, `projected-worker-binding.ts`, `worker-turn-descriptor.ts`, `runtime-override.ts` | Worker identity and descriptors know ID/projection but not installation revision. | Add the resolved revision to Turn-owned descriptors without changing the logical agent identity. |
| `orchestrator/**`, `tool/task-tool-execution-scope.ts`, `tool/send-mailbox-message.ts`, `tool/request-orchestrator-decision.ts` | Dispatch and tools forward logical Expert Squad identity. | Preserve logical ID routing and propagate the exact Turn revision only as provenance/validation. |
| `artifact-catalog/index.ts`, `task-artifact/store.ts`, `engine/artifact-catalog-metadata.ts`, `engine/mailbox.ts`, plugin Artifact producer schemas | Artifact producer identity has `expert_squad_id` plus projection hash. | Add strict package-revision provenance so same-ID installations remain attributable; include it in publication identity and cross-Task lineage validation. |
| `server/routes/expert-squad.ts` | Catalog/settings/configuration/export/update/uninstall use ID-centric contracts; uninstall rewrites all same-ID references. | Add structured warning/inventory DTOs and exact installation inputs; replace references only where removal leaves no effective package. |
| `server/routes/{global,mission,session,skill}.ts`, `capability/catalog.ts`, `mission/session.ts`, `task-api/index.ts` | Catalog, recommendation, Session selection, Task creation/follow-up, and skill mounts consume logical IDs. | Retain logical selection, resolve through the same effective catalog, and attach the resolved revision to each Turn. No sibling precedence code. |
| `expert-squad/multica-import.ts`, `conversation-authoring.ts`, `tool/expert-squad-author.ts` | Global import currently rejects a registered project's same ID. | Allow global publication; the initiating project keeps its local effective package while other projects gain the global package. |
| `skill/mounts.ts`, built-in authoring/Multica Skills and prompts | Package-owned references use logical Expert Squad ID. | Keep logical ownership; resolve mounted resources from the effective/revision-bound package only. |
| `overlay/services/expert-squad.ts`, `composer-expert-squad-catalog.ts`, `extensions.ts`, `mission.ts` | Transport and local state assume one row and sometimes one scalar installation scope per ID. | Derive the new generated types, select actions by exact installation, and keep Composer selection logical. |
| `overlay/components/settings/ExpertSquadPanel.tsx`, `ComposerReferenceSelector.tsx`, `ChatComposer.tsx`, `main.tsx` | Settings selection keys by ID and Composer shows the effective catalog. | Settings groups physical installations by logical ID and shows the project override warning; Composer shows one effective option. Validate through real-page interaction only. |
| OpenAPI, generated JavaScript SDK, English/Chinese API docs | Generated contracts expose scalar source/scope shapes. | Regenerate from routes; do not hand-edit generated files. |
| Existing Registry/Manager/route/Overlay tests | Several tests assert cross-scope rejection, registered-project collision, scalar market scope, or blanket reference replacement. | Delete negative obsolete assertions and replace valid coverage with positive effective-state and typed-error contracts. UI automation is not updated or run. |

### Independent Agent feedback

Three one-layer, read-only Agents reviewed the direction. They were explicitly prohibited from modifying files or delegating further.

1. **Identity/runtime reviewer — conditional acceptance.** Required distinct logical, installation, and runtime-revision identities; one effective entry per logical ID; invalid-project no-fallback behavior; exact revision provenance in scheduler/worker/Artifact surfaces; and configuration isolation. It proposed permanently binding a Task to one package revision.
2. **Lifecycle/concurrency reviewer — conditional acceptance.** Required Registry-owned overlay resolution, raw inventory for Manager, dual-scope payload/market state, scope-required export, exact update/uninstall behavior, retained manifest-ID cross-process serialization, Multica global publication, and positive global/project concurrency coverage. It rejected any plan that only removes the duplicate error.
3. **HTTP/SDK/Overlay reviewer — conditional acceptance.** Required separate effective and installation DTOs, structured warning severity/code, exact configuration actions, generated API/SDK/docs changes, independent Mission Skill and Chat capability success, and a settings UI that can manage the shadowed global installation.

The reviewers agreed on every externally observable contract except permanent Task revision binding. This proposal does **not** add a persisted Task package-binding authority: current package update already permits later Turns to use a newer package revision, and the user's requested override is an explicit configuration-layer rule. Instead, each Turn resolves once, freezes the exact revision in its runtime contract, and writes that revision into Artifact provenance. An explicit later install, update, or uninstall may change resolution for a later Turn; it cannot change an already installed Turn contract. This keeps `prompt_profile.active` as the sole Task selection and avoids a second lifecycle source. A future requirement for reproducible replay of historical Turns would need an independently designed content-addressed package snapshot, not a path binding.

## Causal analysis

Observable failure: opening a project with project/global `review-debug` produced repeated API 500 responses and made otherwise independent Composer references unavailable.

Direct trigger: Registry treats equal IDs across global and project locations as an invalid duplicate, and project configuration validation propagates that failure through project bootstrap.

Deeper cause: the July global-install design used one string for both logical selection and physical installation identity. Global uniqueness made lifecycle operations simple but prevented normal layered configuration semantics. Merely downgrading the exception would expose two packages to consumers that still use ID-keyed maps, configuration, settings selection, export, and uninstall.

Why the earlier direction cannot be patched: Resolver precedence alone would leave Manager, configuration secrets, payload status, reference replacement, generated contracts, and Artifact provenance ambiguous. The root correction is to model selection, installation, and resolved revision separately while retaining one effective runtime catalog.

## Proposed protocol

### 1. Identities

```text
LogicalSquadID = manifest.id

InstalledSquadKey =
  built_in(id)
  | global(namespace, id)
  | project(projectID, namespace, id)

ResolvedSquadRevision =
  InstalledSquadKey + version + packageDigest
```

Absolute roots and manifest paths remain operational evidence returned by local APIs; they are not persisted identity because they are machine-specific. `namespace` remains provenance/partition information and never replaces logical `id` as the selection key.

### 2. Registry-owned effective resolution

Registry performs one operation for an exact context:

1. Discover and identity-validate global and exact-project inventories separately.
2. Reject duplicate logical IDs within either individual scope, including cross-namespace duplicates.
3. Reserve every project identity before loading its complete catalog package.
4. For each logical ID, select the project identity when present; otherwise select global.
5. Fully validate only the selected effective catalog package according to the existing partial-catalog boundary.
6. If the selected project identity is malformed, emit its typed error and make that ID unavailable; never select global.
7. Return effective items, complete physical installation summaries, typed errors, and typed warnings from the same snapshot.

The override warning is a strict object, not an error string:

```ts
{
  code: "project_overrides_global"
  severity: "warning"
  logical_id: string
  effective: ResolvedSquadRevision
  shadowed: ResolvedSquadRevision
}
```

Global context discovers only global packages and cannot emit a project-override warning. Built-in collision remains an error before overlay resolution.

### 3. Effective catalog versus installation inventory

- Runtime, Composer, selector, recommendation, capability, Mission, and skill-mount consumers receive `effective_squads[]`, exactly one row per logical ID.
- Settings additionally receives `installations[]`, grouped by logical ID and keyed by exact installation identity, plus `warnings[]`.
- A shadowed global installation remains visible and manageable in Settings but never produces a second selector or Composer option.
- Current ambiguous `issues[]` is split into typed `errors[]` and `warnings[]`; project override is never represented as `identity.duplicate` or `isolated`.

### 4. Manager and lifecycle semantics

- Project/global same-ID installation succeeds in either order. Same-scope duplicate ID across namespaces still fails.
- Retain the manifest-ID cross-process lock. It is deliberately broader than the physical target so concurrent global/project operations publish a deterministic inventory and warning snapshot; both legitimate installations may complete.
- Delete registered-project pre-scans and post-publication rollback whose only purpose is cross-scope global uniqueness. Registered projects remain relevant to resolution-aware global uninstall reference analysis.
- Payload release into a project installs the project package even when a global same-ID package exists. Market returns `installations[]`, effective scope, per-installation version, and update availability.
- Update and uninstall continue to require scope and validate the canonical exact target.
- Export adds required scope; ID-only export is deleted.
- Multica remains an ordinary global caller. A local same-ID package keeps precedence in the initiating project; other projects see the new global package.

### 5. Configuration and reference replacement

- Replace the ID-only configuration store with exact installation keys. Project values include stable `projectID`; global values do not. Project/global packages may declare different fields and secrets without collision.
- Configuration HTTP operations require the exact installation scope and resolve namespace/project identity on the backend. Settings derives request types from the generated SDK.
- Removing a project installation while global remains leaves logical `prompt_profile.active` references unchanged; later Turns resolve global.
- Removing a project installation with no global replacement changes only that project's affected Project/Session references to `general`.
- Removing global changes the global config to `general` when it selects that ID. Registered projects/Sessions with a local override keep their logical ID; only contexts with no local effective package are changed.
- Uninstall and update do not rewrite already installed Turn runtime contracts. Later Turns resolve from the post-operation effective inventory and record the new revision.

### 6. Runtime and Artifact provenance

- Resolver returns `ResolvedSquadRevision` with every scheduler, worker, skill, tool, MCP, and active projection result.
- Session runtime contracts, Worker Turn descriptors, projected-worker bindings, tool execution scope, and harness ownership validate the same resolved revision for that Turn.
- Projection hash remains the content-derived runtime projection identity. Package digest independently identifies the complete installed package bytes; byte-identical project/global packages may share a projection hash while retaining different installation identities.
- Engine Artifact and Task Artifact producer provenance adds the strict resolved revision. Publication idempotency and cross-Task lineage include it. Existing `expert_squad_id` remains the logical domain name.
- No absolute installation path is persisted in a Task or Artifact.

### 7. Public and UI behavior

- `GET /expert-squad/catalog` returns effective rows plus typed errors/warnings and resolved active revision.
- `GET /expert-squad/settings` returns grouped physical installations and effective status so both copies have exact configuration/export/update/uninstall actions.
- Market returns all installed scopes, not a scalar `installation_scope`.
- Export requires `installationScope`; configuration requires the exact installation selection; update/uninstall keep exact scope.
- Mission recommendation, Task creation, Session selection, skill mounts, and Composer references retain logical IDs and consume the same Registry effective snapshot.
- Expert Squad warnings cannot be concatenated as failures of successful `/mission-skill/catalog` or `/chat/capability` reads.
- Overlay displays a restrained warning such as “This project’s Review & Debug package overrides the user-global installation.” It shows source, version, and scope for both installations and labels the effective one.

## Implementation order

1. Update `AGENTS.md`, `specs/current/architecture/01-agents.md`, `04-extensions.md`, and `99-principles.md` to replace cross-scope global uniqueness with the reviewed overlay identity protocol. Do not change runtime code while the living architecture still mandates rejection.
2. Introduce strict installed-key, resolved-revision, warning, error, effective-catalog, and installation-inventory schemas in the Registry/catalog layer.
3. Replace Registry duplicate quarantine/strict discovery with per-scope inventory plus one project-over-global effective resolver. Preserve built-in and same-scope collision errors.
4. Refactor Manager import, payload, market, update, uninstall, export, registered-project analysis, and locks around exact installation identities.
5. Replace ID-only configuration ownership and make reference replacement resolution-aware.
6. Project resolved revision through Resolver, Turn runtime contracts, worker descriptors, tool scope, Artifact producer, publication identity, and lineage validation.
7. Update routes and all backend consumers; regenerate OpenAPI, JavaScript SDK, and English/Chinese API docs from the real schemas.
8. Update Overlay services and Settings/Composer consumers. Delete obsolete UI automation encountered in task-owned paths; validate the UI only through a real Overlay page, interaction, screenshots, and manual visual review.
9. Replace obsolete negative/cross-scope rejection tests with the positive matrix below. Run focused non-UI checks, generation freshness, typechecks, docs checks, and an exact-tree independent review.
10. Commit only task-owned files with a `dsw-33987` subject and push the verified main branch to `myhexin` without bypassing hooks.

## Positive verification matrix

### Registry and Resolver

- Global A alone resolves A with no override warning.
- Global A plus project B with the same logical ID resolves B in that project and A elsewhere; the warning contains both exact revisions.
- Byte-identical global/project packages may share projection hash while their installation identities remain distinct.
- Same-scope cross-namespace duplicate returns the typed same-scope identity error.
- Invalid project B reserves the ID, reports B's error, and never loads A; unrelated IDs remain available.
- Catalog, selector, recommendation, skill projection, scheduler, and worker each expose exactly one effective B.

### Manager and configuration

- Global-then-project and project-then-global installs both succeed with two inventory rows and project effective.
- Same-process and two-process concurrent global/project installs both complete, preserve exact roots, and produce project effective state.
- Payload release over global produces a project installation and correct per-installation market state.
- Global/project updates change only the selected installation and report both resulting versions.
- Scope-required exports return each installation's exact archive bytes/digest.
- Project/global packages with different configuration schemas retain isolated field values and secrets.

### Uninstall and references

- Project uninstall with global replacement preserves logical references and reveals global for later Turns.
- Project uninstall without global changes only exact-project references to `general`.
- Global uninstall preserves references in projects with local overrides and changes only global/non-overridden contexts.
- Installed Turn contracts remain frozen through concurrent lifecycle operations; subsequent Turns record the newly resolved revision.

### Runtime, Artifact, routes, and generated contracts

- Scheduler, worker, package tools, MCP, Skill projection, Worker Turn descriptor, and Artifact producer agree on one resolved revision per Turn.
- Artifact catalog and cross-Task import preserve logical ID, scope, namespace, version, package digest, and projection hash.
- Catalog/settings/configuration/market/export/update/uninstall routes expose exact strict schemas and typed warnings.
- `/mission-skill/catalog` and `/chat/capability` remain independently successful during a valid override.
- Generated OpenAPI, SDK client/types, and English/Chinese API docs exactly match route schemas.

### UI acceptance

- Open a real project with same-ID global/project installations.
- Confirm one Composer option, one effective project row, two manageable Settings installation rows, and a visible non-blocking warning.
- Exercise keyboard/focus paths for selecting each installation action and capture current-goal screenshots.
- Remove the project override through the exact action and visually confirm the global installation becomes effective without an API error.
- Do not add, modify, or run UI automation, screenshot baselines, fixture assertions, or pixel comparisons.

## Verification commands for implementation

Focused command selection must be refreshed after code changes, but the minimum non-UI matrix is:

```bash
bun test packages/opencorvus/test/expert-squad/registry.test.ts packages/opencorvus/test/expert-squad/package-manager.test.ts packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/server/expert-squad-routes.test.ts --timeout 90000
bun test packages/opencorvus/test/config packages/opencorvus/test/session packages/opencorvus/test/artifact-catalog --timeout 90000
bun run --cwd packages/sdk/js build
bun run --cwd packages/opencorvus typecheck
bun run --cwd packages/sdk/js typecheck
bun run api:routes-check
bun run docs:check
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
bun test packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

The implementation must not run broad UI suites or any UI automation test discovered by these searches.

## Review verdict

The redesign is approved for implementation only as the complete protocol above. A patch that merely changes `duplicate expert squad id` from error to warning, adds `project ?? global` in Resolver, leaves configuration keyed by ID, keeps scalar market scope, exports by ID, or performs blanket uninstall reference replacement is rejected.

## Implementation outcome

The implementation now models the three identities separately:

- `manifest.id` is the logical selection identity used by `prompt_profile.active`; no product-specific or built-in package ID is fixed into selection logic.
- Physical lifecycle identity is the exact built-in, project, or user-global installation, including namespace and project identity where applicable.
- Runtime provenance is a resolved package revision containing scope, namespace, logical ID, version, and the digest of the complete package bytes.

Registry discovers each scope once, preserves same-scope duplicate errors, selects a valid project installation over a same-ID global installation, and returns a typed `project_overrides_global` warning. A malformed project identity reserves its ID and never falls through to global. Manager, configuration, routes, Market, and Settings operate on exact physical installations. Global uninstall reference analysis uses each registered project's canonical worktree and preserves logical references wherever a project override remains effective.

OpenAPI and the JavaScript Software Development Kit were regenerated from the route schemas. Market exposes only `installations[]`; configuration and lifecycle calls carry exact installation scope. Existing installed Expert Squad packages do not need reinstallation for this scope-resolution change because discovery applies the new semantics to their existing manifests. Reinstallation is needed only when independently changed package contents or manifest contracts must be deployed.

## Agent review revision

The runtime reviewer found that the original plan's resolve-then-digest approach could observe mixed bytes if a package changed during loading. That finding revised the design materially: Registry now captures the complete package tree once, hashes those exact buffers, materializes a content-addressed cache snapshot, and parses/compiles the runtime closure only from that snapshot. Scheduler capability, worker capability, Session runtime contract, Worker Turn descriptor, package-tool binding, and Artifact producer all carry the same normalized revision. Operational catalog paths still identify the installed source; executable resources remain snapshot-derived.

The lifecycle reviewer required the cross-process manifest-ID lock to outlive the former retry window and required global uninstall to inspect only the canonical project worktree rather than unrelated sandboxes. Both findings were implemented with focused positive contracts. The identity/API reviewer required physical Market rows, paired `id` plus `installationScope` Settings selection, generated schema freshness, and effective-only Active filtering; those findings were also implemented.

The final identity review found that scope, namespace, ID, version, and digest alone still collapsed byte-identical project installations from two projects. Runtime revision therefore also carries stable `projectID` for project scope and `null` for built-in/global scope. The field participates in equality, descriptor/runtime validation, TaskTool binding, and Engine/Task Artifact producer provenance. A final cross-chain positive matrix binds same-ID project/global worker Turns, descriptors, tools, both Artifact kinds, and old/new digests to their exact revisions.

## Verification and visual evidence

Completed focused verification includes Registry effective resolution, Resolver projection, exact Manager lifecycle, cross-process installation locking, route override/Market/uninstall behavior, runtime descriptor and contract projection, and Artifact provenance. The real Overlay was opened against a real backend and inspected manually without creating or running UI automation. It showed one effective project package, a non-blocking override warning, and separately manageable project/global Market installations.

Final review also added exact same-ID project/global export archives and independent configuration PUT/GET values, plus a snapshot regression proving an already loaded closure remains frozen while a later load observes changed source bytes. The Active Settings filter now requires both the logical active ID and its effective physical installation.

- `specs/artifacts/expert-squad-project-override-ui.png`
- `specs/artifacts/expert-squad-global-installation-selection-ui.png`
- `specs/artifacts/expert-squad-market-dual-scope-final-ui.png`

The parallel Delivery Slice schema refactor that temporarily overlapped finalization has settled. The final Overlay typecheck, production Vite build, repository documentation checks, and full push hook all pass with the exact-installation UI and protocol in place.
