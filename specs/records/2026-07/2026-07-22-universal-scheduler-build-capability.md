# Universal Scheduler-Only Build Capability

## Recall

| Item | Recorded requirement or evidence |
| --- | --- |
| User request | “build作为通用能力，默认加入专家团，只对调度器可见”。 |
| Acceptance criteria | Every active Expert Squad receives one platform-owned `universal-build` dispatch capability through `PromptProfileResolver`; only the scheduler dispatch surface sees it. It is absent from `capability_projection.agents`, every `virtual_workflows` graph, package membership/catalog projection, and worker-visible surfaces. SDK authoring, the portable authoring Skill, and Multica import teach the same boundary. Manifest versions use `YYYY.MM.DD.N`, where `N` is the positive ordinal of that Squad revision on that calendar date. |
| Hard constraints | Preserve the manifest as the single source for package-owned worker identities while keeping the platform capability in one Resolver-owned declaration. Do not merge General into domain packages, synthesize UI members, add route gates/state machines, infer repair from names, or turn `build` base-role metadata into runtime identity. Preserve package resources and active/inactive isolation. Do not restart OpenCorvus/Overlay. |
| Baseline | Branch `v0.0.14beta`; the worktree also contains unrelated OpenClaw/channel packaging edits and Finder `.DS_Store` files that this change must preserve and exclude from its commit. |
| Read architecture | `specs/current/architecture/01-agents.md`, `04-extensions.md`, `08-agent-tool-adapter.md`, `11-agent-oop-protocol.md`, `13-agent-communication-matrix.md`, `14-agent-runtime-mode.md`, and `99-principles.md`. The current text makes package agents exclusive and therefore conflicts with the new universal Build requirement. |
| Runtime evidence | The 2026-07-22 SQLite evidence shows repeated `visual-reviewer` redispatches for one Goal when preview/tool protocol failed, while a later concrete implementation defect correctly caused `modify_goal` followed by `implementation-engineer` through the build adapter. This proves the defect is capability availability/visibility plus repair guidance, not a total build-adapter outage. |
| Full-repository grep | `PromptProfileResolver.resolvePackageCapabilitySet`, `resolveSchedulerTurnProjection`, `resolveWorkerTurnProjection`, `resolveSkillProjectionForContext`, and `activeAgentProjection` are the projection choke points. Production Orchestrator construction consumes `skillProjection.projectedAgents` in `orchestrator/agent.ts`; runtime identity validation consumes the same list in `session/runtime-contract.ts`; catalog and Overlay consume manifest agents, `active_agent_projection`, and public `projected_agent_ids`. Tests under `orchestrator/scheduler-capability-projection`, `session/runtime-contract*`, `expert-squad/*`, and server catalog routes assert these surfaces. |
| Existing package inventory | General, Frontend Innovate, Frontend Replica, Mirror Code, MirrorTest, and the portable template already contain domain implementation identities using the Build runtime template. Commit `d5aec0139` incorrectly treated those as the universal capability and added package repair-builder identities to Mirror PRD, Mirror Design, and Mirror Watch. |
| Multica and SDK evidence | `multica-import.ts` currently copies `snapshot.squad.updated_at` directly into manifest `version`; the Registry accepts any non-empty version string; SDK examples still use arbitrary SemVer. The built-in Multica Skill and portable authoring Skill do not explain the platform Build boundary or `YYYY.MM.DD.N`. |
| Independent agent feedback | The user explicitly requested an independent agent. The read-only audit required Resolver-owned scheduler-only capability inventory, platform ownership that ignores package runtime overrides, reserved manifest identity, removal of repair-only package Builders, Multica authoring through `writeExpertSquadPackage`, and Registry-owned calendar version validation. |

## Root cause and decision

The dynamic Expert Squad migration removed the old native `build` identity and made the active package manifest the exclusive scheduler dispatch inventory. That correctly separated runtime identity from the `build` base-role template, but accidentally removed the platform repair capability. Commit `d5aec0139` then repaired the symptom at the wrong ownership layer: it made every package declare or nominate a package-owned Builder.

Build is restored as one platform-owned scheduler-only capability with exact runtime identity `universal-build`, `base_role: "build"`, and the existing Build adapter/runtime/finalizer. `PromptProfileResolver` is the single projection owner. Package manifests remain authoritative only for package-owned workers; package agents and workflows never declare the universal capability. Domain implementation identities remain valid when their actual domain contract calls for implementation, but they do not substitute for the platform capability.

The scheduler prompt teaches evidence-based use of `universal-build`; host code only projects the capability and performs ordinary identity/data validation. The portable template, SDK example, and Multica import teach that the capability is implicit and must not be copied into package membership or workflow guidance. Manifest version parsing becomes strict `YYYY.MM.DD.N`; Multica converts its source update date into the first OpenCorvus package revision for that source day rather than leaking an arbitrary timestamp into the version field.

## Exhaustive call-point disposition

| Call point | Disposition |
| --- | --- |
| Repository preset manifests | Remove repair-only package identities introduced solely to simulate universal Build. Preserve genuine domain implementation identities and remove any claim that they are the platform fallback. |
| Core Orchestrator prompt | Describe `universal-build` as the sole platform scheduler-only target for concrete repository repair that no narrower package producer owns. Preserve natural LLM selection; add no host routing rule. |
| Portable template generator/artifact | State that universal Build is runtime-provided and forbidden from package agents/workflows. Keep genuine example-domain implementation nodes only when they perform declared domain work. Regenerate tracked artifacts. |
| `PromptProfileResolver` | Own one immutable universal projection, merge it only into the scheduler dispatch set, resolve its worker runtime exactly, and keep it out of package agent/catalog/skill-mount membership. |
| Runtime contract and dispatch re-resolution | Accept the scheduler-only projection through the same exact identity/hash/runtime checks used for package workers; never accept `target=build` as an alias. |
| Catalog and settings | Continue exposing only manifest-authored package members. Do not synthesize `universal-build` into `active_agent_projection` or public `projected_agent_ids`. |
| Virtual workflows | Remain package-authored guidance and never contain `universal-build`. Scheduler dispatch is independent natural orchestration, not workflow state. |
| Version schema | Registry is the semantic authority for `YYYY.MM.DD.N`; update repository manifests, fixtures, generated OpenAPI/SDK examples, and negative tests. |
| Multica import | Convert source `updated_at` date to `YYYY.MM.DD.1`, keep source digest as the immutable freshness authority, and document that imported packages inherit universal Build from runtime rather than mapping a source agent. |
| Authoring Skill | Explain the implicit universal capability, prohibit declaring it in agents/workflows, require explicit positive daily revision, and retain validation through `client.expertSquad.validateFolder`. |

## Verification plan

1. Prove a package with zero Build-template agents still gives its scheduler exactly one `universal-build` target while its package projection, catalog and workflow graphs omit it.
2. Prove package workers cannot resolve or see the scheduler dispatch inventory, while the universal worker passes exact runtime-contract, continuation and Build-adapter checks.
3. Prove a genuine package Build-template identity can coexist with `universal-build` without aliasing or collision.
4. Prove Registry accepts valid calendar versions and rejects arbitrary SemVer, timestamps, invalid dates, zero/leading-zero ordinals, and missing ordinals.
5. Prove Multica preview/import emits `YYYY.MM.DD.1`, preserves source digest drift detection, and never inserts Build into imported agents or workflows.
6. Regenerate the portable template, built-in Skill payload, OpenAPI/SDK artifacts and bundled expert-squad payload through official generators.
7. Run focused Resolver, dispatch, runtime-contract, Registry, SDK authoring, Multica, portable template, payload, catalog, documentation-health, typecheck, route and docs checks; then perform independent review against the final diff.

## Verification ledger

- Resolver, General, scheduler projection, Registry, runtime override, worker runtime-contract, repository package, Mirror, Mirror Watch, MirrorTest, skill-mount, Multica, package-manager, SDK authoring, version, and prompt-profile focused suites passed. The broad Expert Squad run's MirrorTest and package-manager concurrency failures both passed when rerun alone; its remaining payload-build failure is caused by the unrelated dirty `opencorvus:channel-runtime-bridge` OpenClaw edit outside this change.
- Independent review found that reconstructed session/model callers could omit optional `capabilityOwner`; ownership is now derived from the reserved `universal-build` ID inside the runtime/model override choke point, and a regression proves package-scoped model configuration cannot override it when the caller omits owner metadata.
- `bun packages/opencorvus/script/generate-builtin-skill-payload.ts`, `bun packages/opencorvus/script/generate-expert-squad-payload.ts`, and `bun packages/opencorvus/script/generate-portable-expert-squad-template.ts` completed.
- Skill Creator `quick_validate.py` passed for `specs/artifacts/portable-expert-squad-template/authoring-skill` after providing PyYAML in an isolated temporary Python dependency directory.
- `bun run typecheck` — 9 package tasks passed.
- `bun run api:routes-check` — 6 rules and 31 route files passed.
- `bun run docs:check` — 287 operations across 23 groups matched generated documentation.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` — 21 passed.
