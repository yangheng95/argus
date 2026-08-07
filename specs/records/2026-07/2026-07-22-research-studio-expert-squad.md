# Research Studio Expert Squad

Date: 2026-07-22
Status: Complete
Owner: Codex

## Recall

### User Request

Build a small expert squad through the existing squad development SDK for information retrieval, analysis, and writing. The squad must not include requirements or architect agents. Its delivered artifacts must be writable to the project and renderable directly in the message panel.

### Acceptance Criteria

- Add one self-contained `research-studio` package under the tracked expert-squad authoring root.
- Keep the runtime team minimal: the scheduler, one evidence researcher, and one analysis writer.
- Do not project requirements, architect, build, visual-review, integrity, or package-specific tool identities.
- Use existing retrieval tools and the existing `publish_interactive_artifact` protocol; do not add a crawler, artifact API, renderer, route, or client-side data source.
- The evidence researcher returns cited source findings without writing the final report.
- The analysis writer consumes the request and research evidence, writes the canonical Markdown report to a project-relative artifact path, rereads it, and publishes the same final content as `document@1`; it may additionally publish `table@1` only when a structured comparison materially improves the result.
- The scheduler may dispatch the writer directly for bounded source material, or follow the immutable `source-backed-delivery` guidance and dispatch research before writing when external retrieval is required. This does not create active/default workflow selection or workflow state.
- Validate SDK round-trip authoring, Registry loading, active-package Resolver projection, artifact-tool visibility, package payload generation, and repository catalog expectations.
- Treat Research Studio as a default bundled installation: the existing project-scoped payload provisioning operation must install it into a fresh project without introducing a package-specific installer or selecting it as the active profile.

### Hard Constraints

- Manifest v1, manifest `id`, `prompt_profile.active`, Registry, Manager, Resolver, generated payload, and interactive-artifact persistence remain their existing single sources.
- No fallback, compatibility alias, keyword router, gate, state machine, hidden message, shadow artifact, or custom package tool.
- Artifact rendering is message-owned through `publish_interactive_artifact`; the project file is the durable deliverable. The prompt must require byte-equivalent report content between the saved Markdown and the published document payload.
- Existing staged Overlay and Chat-scroll work is user-owned and excluded from this delivery.
- No OpenCorvus or Overlay process may be restarted, stopped, refreshed, or otherwise disturbed.

### Sources Read

- `AGENTS.md`
- `specs/records/2026-07/2026-07-16-expert-squad-development-sdk.md`
- `specs/records/2026-07/2026-07-19-inline-interactive-artifact-protocol.md`
- `packages/sdk/js/src/expert-squad-authoring.ts`
- `packages/sdk/js/test/expert-squad-authoring.test.ts`
- `packages/sdk/js/test/mirror-squads-authoring.test.ts`
- `packages/opencorvus/src/agent/{runtime-template-registry,tool-pool-data}.ts`
- `packages/opencorvus/src/tool/publish-interactive-artifact.ts`
- `packages/opencorvus/script/generate-expert-squad-payload.ts`
- `packages/opencorvus/test/expert-squad/{package-manager,payload-generation,repository-dynamic-agent-packages}.test.ts`
- The portable template and current repository expert-squad manifests, selectors, README files, and agent overlays.

### Whole-Repository Search Evidence

- `writeExpertSquadPackage` and `renderExpertSquadPackageFiles` are owned by `@opencorvus-ai/sdk/expert-squad-authoring`; their only production consumers are the portable template generator and Multica import. A package round-trip test is the appropriate proof that this source package conforms to that SDK without adding another writer.
- `discoverExpertSquadPayloadPackages` reads tracked files below `expert-squads/<namespace>/<id>` from the Git index, validates each through `ExpertSquadRegistry`, and generates `packages/opencorvus/generated/expert-squad-payload.ts`. New package files must therefore be staged before payload regeneration.
- `payloadPackageSources` is consumed by the Manager and route/project tests. The only hard-coded repository package lists that require direct updates are the payload-package exact expectations and the repository dynamic-package exact ID expectation; other catalog tests derive from the payload.
- `publish_interactive_artifact` is globally implemented once and projects to the scheduler and `delegated-worker` templates. `document@1` and `table@1` already have one schema, persistence path, message part, route, and Overlay renderer.
- `delegated-worker` already owns `websearch`, `webfetch`, `read`, `write`, and `publish_interactive_artifact`. It is therefore the smallest suitable template for both a retrieval specialist and a final analysis writer without custom tools.
- `deep-research` has a structured advisory finalizer and intentionally does not own the final deliverable. Using it would add an unnecessary research-bundle contract for this requested lightweight squad, so both package agents use specialized overlays on the general delegated-worker runtime seed.

### Independent Agent Feedback

The user did not request independent agents or parallel audit, so no sub-agent was started. The main agent owns implementation and exact-diff review.

## Design

`research-studio` is a package-authored capability projection with two domain identities:

1. `research-studio-researcher` performs read-only retrieval, prefers primary sources, records URLs and retrieval dates for volatile facts, distinguishes facts from inference, and returns evidence to the scheduler.
2. `research-studio-analyst` synthesizes provided material and researcher evidence, writes one canonical Markdown report, rereads it, then publishes the identical Markdown through `publish_interactive_artifact` using `document@1`. A separate table artifact is optional only for genuinely tabular comparisons.
3. The scheduler dispatches only those exact identities. It sends direct bounded writing to the analyst and inserts the researcher only when evidence collection is necessary. Manifest v1's required `virtual_workflows` record carries one immutable source-backed-delivery dependency graph; it is guidance only and has no active/default selection or persisted step state.

The package contains only its manifest, README, selector, scheduler overlay, and two worker overlays. There are no skills, tools, Model Context Protocol providers, assets, configuration fields, or lifecycle extensions.

## Validation Plan

- SDK round-trip test proves the checked-in package can be materialized by `writeExpertSquadPackage` without changing caller-owned files.
- Focused package test proves Registry load, exact two-agent shape, absence of requirements/architect/virtual-workflow/package resources, and prompt-owned file-plus-inline artifact contract.
- Resolver test imports and activates the package through Manager, then proves scheduler and writer receive `publish_interactive_artifact`, the writer receives `write`, and the researcher is constrained by its overlay despite inheriting retrieval tools.
- Regenerate the embedded payload from the staged package and update exact catalog assertions.
- Run focused SDK/package/payload/manager tests, TypeScript checks where affected, historical docs links, document health, `git diff --check`, and an exact delivery-path diff review.

## Validation Findings

1. Registry validation proved manifest v1 requires a non-empty `virtual_workflows` record. The package now declares one immutable source-backed-delivery evidence dependency graph while the scheduler prompt retains direct analyst dispatch for already-bounded source material. No active/default workflow or step state was added.
2. Repository identity isolation rejects package overlays that start with `You are` because the Resolver is the only model-visible identity source. The researcher overlay now starts with its domain action and does not restate runtime identity.
3. Adding the ninth repository package moved the complete provider-schema preparation case from below Bun's five-second default to 5.003 seconds. That real all-package checker now disables Bun's elapsed timeout in the test declaration, matching the repository's long-running integration-test convention; every assertion still executes.

## Validation Evidence

- SDK authoring plus package Registry/Manager/Resolver coverage passed: `3 pass / 0 fail / 21 assertions`.
- Repository dynamic-package coverage passed: `10 pass / 0 fail / 1,210 assertions`.
- Payload generation, package Manager, Research Studio package, and SDK authoring coverage completed with `81 pass / 1 existing isolated skip / 1 transient fixture termination`; the exact terminated cleanup-failure case then passed alone with `1 pass / 0 fail / 5 assertions`, proving its cleanup checker rather than a Research Studio path.
- SDK and OpenCorvus TypeScript checks passed after merging the latest `legacy-remote/v0.0.15beta`.
- Historical-link and document-health coverage passed: `82 pass / 0 fail / 1,362 assertions`.
- Payload regeneration after the remote merge produced no diff, and `git diff --check` passed.

## Delivery

- Implementation commit: `0a35f8bd0` (`dsw-33987 add research studio expert squad`).
- Latest remote `v0.0.15beta` was merged into the delivery line with commit `880ee41b5` (`dsw-33987 merge remote v0.0.15beta`) before the final validation pass.

## Default Installation Follow-up

The user clarified that Research Studio must be installed by default. The package was already part of `payloadPackageSources`, and `ExpertSquadPackageManager.releasePayloadPackages` is the single bundled project-provisioning source that installs every payload package without overwriting an existing same-ID installation. The follow-up therefore adds a focused Research Studio regression proving that a fresh project receives `.opencorvus/expert-squads/builtin/research-studio/` through that existing operation. It deliberately does not add a second default-package list, a package-specific branch, user-global provisioning, or an automatic active-profile selection.
