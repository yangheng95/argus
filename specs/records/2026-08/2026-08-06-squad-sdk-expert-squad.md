# Generate Agent Squads expert squad

## Recall

| Item | Record |
| --- | --- |
| User request | Turn heterogeneous-algorithm import and Squad Software Development Kit (SDK) generation into a dedicated Expert Squad instead of exposing them as pure Skills; give Expert Squads an optional human-readable `name`; show that name in the User Interface (UI); replace the Composer's final live-authoring Action with the ordinary `squad-sdk` Expert Squad entry; rename its visible identity to `Generate Agent Squads`; and make every successfully generated Squad user-global so it is available from every project catalog. |
| Acceptance criteria | A self-contained `squad-sdk` package, visibly named `Generate Agent Squads`, owns heterogeneous import and SDK authoring; a clean application catalog exposes it without an explicit payload release; selection chooses an explicit binding workflow; only its scheduler receives the import/authoring Host tools; authoring has one global installation outcome rather than a model-selected project/global branch; the successful receipt and a second project catalog both expose the generated global package; Advanced no longer exposes the retired Skills or tools; manifest `name` may be omitted while catalog/UI receive a stable resolved name; the Composer exposes `squad-sdk` through the same `@squad` selection path as every other squad and has no dedicated authoring Action; focused positive non-UI contracts, typecheck, generated-artifact checks, documentation health, and real-page visual review pass. |
| Hard constraints | One active-squad source through `prompt_profile.active`; one SDK writer and existing Registry/Manager import path; no compatibility aliases, fallback, workflow engine, Host routing gate, hidden messages, or UI automation tests; package resources must be self-contained; no unrelated dirty-worktree edits may be overwritten or committed. |
| Sources read | `AGENTS.md`; `specs/current/architecture/04-extensions.md`; the July authoring, Multica import, automatic production, SDK stability, and live authoring records found by repository search; Advanced and repository Expert Squad manifests/selectors; built-in Skill sources; SDK authoring implementation; Multica adapter; payload generators; Resolver/Registry/Manager and focused tests. |
| Whole-repository search | `expert-squad-authoring` and `multica-import` were projected only by Advanced; `expert_squad_author` plus `multica_catalog`, `multica_preview`, and `multica_import` were likewise Advanced scheduler tools. Registry and Resolver already merge user-global packages into every exact project catalog. The clean-run screenshot later proved a second root defect: `builtInPackageSources` contained only `base`, `advanced`, and `research-studio`, while `squad-sdk` existed only in the explicit project payload. The earlier visual check manually called `/expert-squad/release-payload`, so it did not exercise clean startup. The correct source is the built-in catalog itself; startup copying, implicit payload release, fallback, and a second catalog are rejected. |
| Independent agent feedback | None. The user did not request sub-agents or parallel audit, so no delegation was started. |

## Design

`builtin/squad-sdk` remains the sole logical package identity and is displayed as `Generate Agent Squads`. It is the fourth embedded system package, so a clean project catalog contains it without provisioning. Its scheduler owns the existing Host tools and selects one exact workflow before dispatch:

- `sdk-authoring`: analyze the requested domain and source algorithm, design the smallest self-contained package contract, then independently validate the complete blueprint before the scheduler calls `expert_squad_author` once.
- `heterogeneous-import`: inspect the selected external Squad and portability evidence, then independently validate the preview and mapping before the scheduler calls `multica_import` once with the exact preview digest.

The package contains its own authoring and import method Skills. They are package-local instructions, not global selectable capability identities. The old global `expert-squad-authoring` and `multica-import` Skill sources are deleted, Advanced loses their Skill/tool projections, and the portable reference generator reads the package-local authoring method. The SDK writer, Registry, Manager, and Multica adapter remain the sole implementation sources.

The Composer has no authoring-only Action. `squad-sdk` is emitted by the ordinary Expert Squad catalog as `Generate Agent Squads` and selected through the same `@squad("squad-sdk")` directive path as every other package. The ID remains the sole logical identity; the new display name is not an alias.

The authoring tool no longer asks the model to choose an installation scope. A successful generation always passes explicit `global` scope to the existing Manager transaction and returns that global installation receipt. Registry remains the single discovery source: every project catalog sees the installed package from the canonical user-global root, while an exact project package with the same manifest ID retains the existing documented override semantics. Generation does not select or activate the new Squad.

## Verification

- Load and resolve the package through Registry and `PromptProfileResolver`; assert exact scheduler tools, package Skills, agents, and workflows.
- Assert Advanced resolves without author/import Skills or tools and `squad-sdk` is present in the repository payload/market catalog.
- Regenerate Expert Squad and built-in Skill payloads plus the portable authoring artifact.
- Run focused Expert Squad, authoring, Multica, payload, package-manager, Skill inventory, architecture/document-health, generated-artifact, and TypeScript checks.
- Review the final diff independently against this Recall before commit and push to `git-cc`.
