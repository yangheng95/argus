# Mirror Prism External Expert Squad SDK Port

Date: 2026-07-21
Status: Implemented; live performance benchmark pending explicit target and model inputs
Owner: Codex

## Recall

### User request

Investigate `C:\Users\10132\Downloads\prism\output` and start porting the Mirror Prism agent algorithm into OpenCorvus through the external Expert Squad SDK, preserving its capability and performance as far as the OpenCorvus runtime contract permits. Surface any test-environment configuration blocker to the user as soon as it is proven.

### Acceptance criteria

- Add one self-contained external Expert Squad package with manifest ID `mirror-prism`; do not add a built-in prompt profile, second active-state field, runtime alias, compatibility path, or host-side workflow engine.
- Preserve the source algorithm's useful capability sequence: intent/team resolution; source, competitor, user-experience, user-interface and asset evidence; page-family PRDs; independent PRD review; page-scoped design; page-scoped implementation; real browser visual review; final integrity review.
- Preserve parallelism by projecting evidence roles independently and by allowing page-disjoint design, implementation and review goals, while leaving actual dispatch decisions to the Orchestrator.
- Preserve the source AInvest three-layer extension contract when the request resolves to AInvest: target structure approximately 50%, relevant competitor ideas approximately 25%, and AInvest capabilities approximately 25%, with every module traceable to L1/L2/L3 evidence. An explicitly named non-AInvest team must use only that team's supplied context.
- Keep strict source-parity work distinct: the existing `frontend-replica` squad remains the correct package for unmodified source parity; Mirror Prism is selected for its evidence-led, PRD-led extended replica workflow.
- Default ordinary replica delivery to desktop only. Tablet, mobile and responsive delivery are separate only when explicitly requested.
- Use OpenCorvus Browser MCP (Model Context Protocol) and existing webpage/visual-region tools instead of the source Hermes/OpenCode/Claude/MirrorTest wrappers.
- Author and validate the package through the existing `@opencorvus-ai/sdk/expert-squad-authoring`, `POST /expert-squad/validate-folder`, `ExpertSquadPackageManager`, `ExpertSquadRegistry`, and `PromptProfileResolver` paths.
- Prove inactive-package isolation, exact dynamic-agent identities, Skill mounts, default tool and Browser MCP projection, project-scoped import, and explicit activation with focused tests.
- Regenerate the checked-in expert-squad payload from the tracked package source and update the specs indexes.
- Run focused tests, SDK typecheck, OpenCorvus typecheck, payload freshness, docs health, historical links and `git diff --check`; then perform a second code/data review before commit and legacy remote push.

### Hard constraints

- No fallback agent, old prompt, state machine, step-status persistence, retry router, keyword gate, hidden message, synthetic message, duplicate package identity, or package-path guessing.
- Do not import `.env`, credentials, databases, caches, `node_modules`, compiled files, external absolute paths, external Kanban bindings, cron/watchdog scripts or external CLI wrappers from the source export.
- Do not modify the live OpenCorvus/overlay process or refresh its UI.
- Do not create a worktree or use Git reset. Preserve the existing dirty worktree and stage only files owned by this port.
- Do not modify Registry, Manager, Resolver, server routes, generated SDK contracts or Overlay behavior unless a real package integration test proves an existing root defect. The current design needs no such core change.
- Do not copy source fallback/legacy files `mirror-prism-prd-fallback.md`, `mirror-prism-prd-old.md` or environment-recovery references into the runnable package.
- Every abbreviation introduced in authored package prose is expanded on first use.

### Sources read

- `AGENTS.md` and `packages/opencorvus/test/AGENTS.md`.
- Source export inventory under `C:\Users\10132\Downloads\prism\output`, including `mirror-prism-pipeline/SKILL.md`, the current `prism-team/*.md` agents, all source Skill names, selected pipeline references, templates, script inventory and excluded runtime/cache files.
- `specs/current/architecture/04-extensions.md` and `specs/current/architecture/99-principles.md`.
- `specs/records/2026-07/2026-07-07-portable-expert-squad-template.md`.
- `specs/records/2026-07/2026-07-09-external-expert-squad-schema-base-role.md`.
- `specs/records/2026-07/2026-07-16-expert-squad-development-sdk.md`.
- `specs/records/2026-07/2026-07-16-expert-squad-package-tool-runtime-dependencies.md`.
- `packages/sdk/js/src/expert-squad-authoring.ts` and its tests.
- `packages/opencorvus/src/expert-squad/{protocol-schema,registry,manager,prompt-profile-resolver}.ts`.
- `packages/opencorvus/src/server/routes/expert-squad.ts`.
- `packages/opencorvus/script/generate-expert-squad-payload.ts` and payload tests.
- The real `frontend-replica`, `mirror-watch`, `opentest`, General and portable-template manifests, prompts, Skills and integration tests.

### Whole-repository search evidence and call-point disposition

| Search / call point | Evidence | Disposition |
| --- | --- | --- |
| `rg "mirror-prism\|Mirror Prism\|mirror prism"` | No existing runtime package or ID; only an unrelated historical macOS proxy record cites a source script path. | Add exactly one new manifest identity and no alias. |
| `rg "validateFolder\|validate-folder\|validateDirectory\|importFolder\|import-folder"` | SDK generated client, OpenAPI, project route context, server route, Manager and focused route tests already own validation/import. | Reuse unchanged; add package-focused SDK/Manager integration coverage. |
| `rg "writeExpertSquadPackage\|renderExpertSquadPackageFiles\|ExpertSquadManifestV1"` | `packages/sdk/js/src/expert-squad-authoring.ts` is the only authoring writer/renderer and its type comes from generated OpenAPI. | Reuse unchanged; prove the real Mirror Prism source tree round-trips through it. |
| `rg "loadPackage\|package_skill_refs\|package_tool_refs\|virtual_workflows" packages/opencorvus/src/expert-squad packages/opencorvus/test/expert-squad` | Registry owns package/schema closure, Manager owns install, Resolver owns active projection, and existing package tests exercise the real path. | Add one focused package test; do not add another loader or workflow executor. |
| `rg "expert-squad.jsonc\|payloadPackageSources\|discoverExpertSquadPayloadPackages"` | Every tracked `expert-squads/<namespace>/<id>` package is automatically discovered by the payload generator. | Add `expert-squads/hermes/mirror-prism`, regenerate the single payload module, and keep General outside it. |
| Source export search for `fallback\|old\|opencode\|claude\|opentest\|kanban\|/home/youshyee\|cron\|watchdog\|.env\|node_modules` | The export mixes domain prompts with obsolete/alternate agents, credentials, local binaries, a second dispatcher, a stateful numbered pipeline and runtime debris. | Port domain contracts and role responsibilities only; exclude all listed environment/runtime material. |
| Source role inventory | Current primary roles are PRD, design and code; supporting roles cover source/page-family research, UI/UX research, competitors, assets, AInvest mapping, per-page design and PRD audit. | Map these responsibilities to exact dynamic agent IDs and shared package Skills. |
| Existing `frontend-replica` manifest | It already exposes webpage evidence tools, visual-region tools and the complete Browser MCP tool set. | Reuse those default refs from the external manifest instead of shipping external browser wrappers. |

### Independent agent feedback

The user explicitly requested an independent agent review after the first package implementation. The read-only reviewer compared the active source `mirror-prism-pipeline/SKILL.md` v2.21.4, every current non-fallback `prism-team` role, the ported package, OpenCorvus runtime-template tool pools, dispatch-adapter contracts, and the current tests. It rejected the first implementation as a completeness/performance claim for these proven reasons:

- `mirror-prism-asset-curator` used the read-oriented `explore` runtime even though its prompt required Skill loading, asset-byte creation, digest calculation, and `MANIFEST.md` writes. `explore` has neither Skill mounting nor mutation tools.
- `mirror-prism-prd-author` used the exact structured `requirements` runtime even though its overlay required writing page PRD Markdown. The adapter owns `REQ-N` and decision registration and explicitly does not write document artifacts.
- `mirror-prism-source-researcher` and `mirror-prism-competitor-researcher` required `.mirror/prd/tmp/**` writes even though their exact research adapters persist structured evidence through their own finalizers rather than project files.
- The competitor role had no `websearch` discovery surface and therefore could not reproduce source `competitor-scout` behavior when candidate URLs were not already known.
- The source PRD algorithm runs competitor, asset, UI, UX, and AInvest feature-mapping specialists independently in the same research wave. Combining UI/UX into source research and AInvest mapping into PRD authoring reduced both specialist depth and available concurrency.
- The AInvest mapper's source contract includes two-to-four features, High/Medium/Low fit, L2/L3 conflict handling, mount points, mock datasets, interaction flows, and compliance anchors. The first port retained only the aggregate L1/L2/L3 ratio and generic feature map.
- The active source has independent design critique/recheck and a separate acceptance-test/fix loop. The first graph had post-implementation visual review but no independent pre-implementation design reviewer and no explicit acceptance-test owner/repair handback contract.
- Package projection tests proved schema and capability resolution, not worker executability. They never asserted that an artifact-producing role actually received `skill`, `read`, `write`, `bash`, and browser tools consistent with its prompt.
- Manifest v1 does not own model selection. The source pins different models by role, while the port inherits `expert_squads.<id>.agents.<agent-id>.runtime.model`, `runtime_templates.<base-role>.model`, or the project model. Without explicit model configuration and a live benchmark, no performance-equivalence claim is evidence-backed.

The export also contains `mirror-prism-pipeline/SKILL.md_sol`, a v3.2.1 refactor candidate with stage/range/composed routing. It is not the active Skill, references absent sibling packages, and is not executable from this export. It is recorded as future reference and is not part of the v2.21.4 migration acceptance surface.

## Investigation findings

The source export contains four materially different layers:

1. Domain algorithm: target/team resolution, evidence acquisition, page-family analysis, three-layer feature mapping, PRD contracts, design contracts, implementation contracts and independent review.
2. Agent topology: three primary dispatchers plus eight supporting agents, including page-disjoint design and code work.
3. Team knowledge: AInvest product/compliance references and a broad website-design reference library.
4. Source-runtime coupling: Hermes background jobs, OpenCode/Claude/MirrorTest binaries, absolute Linux paths, Mirror Kanban, cron/watchdogs, retry/fallback agents and cached/generated data.

Only layers 1-3 are capability inputs. Layer 4 is not the algorithm and would reduce reliability inside OpenCorvus by creating a second scheduler and multiple runtime authorities.

The corrected OpenCorvus-native topology uses exact dynamic identities for intent, page-family evidence, independent UI evidence, independent UX evidence, competitor evidence, asset evidence, AInvest feature mapping, native requirement registration, page PRD authoring, PRD integrity, solution architecture, workload review, interface design, independent design review, implementation, visual review, independent acceptance testing and final integrity. The Orchestrator receives an immutable evidence dependency graph; it decides real dispatches and evidence-owned repair redispatches from task facts. Page-specific PRD, design, implementation and review agents declare `disjoint_goals` to retain the original parallel throughput without persisted pipeline state.

## Design

### Package identity and installation

- Authoring root: `expert-squads/hermes/mirror-prism/`.
- Runtime identity: manifest `id: mirror-prism`; namespace `hermes` records source provenance only.
- Installation remains explicit through the existing project/global SDK import API. The repository payload is a release source that provisions the same plaintext external package into a project; it does not make the package active.
- `prompt_profile.active` remains the only selection source.

### Runtime resources

- Package README: coordination contract and source-to-OpenCorvus adaptation boundary.
- `selector.md`: positive and negative selection cases, especially Mirror Prism extension versus strict frontend replica parity.
- One Orchestrator overlay and exact worker overlays under `agents/<agent-id>/system.md`.
- Shared Skills for workflow/evidence, source capture, PRD contract, interface contract, verification, AInvest domain knowledge and curated website-design references.
- Existing default webpage, visual-region and Browser MCP refs are projected only to the workers that need them.
- One package tool, `mirror-prism/shared/materialize-asset`, owns the exact external-byte download, no-overwrite project write, byte-length check, SHA-256 (Secure Hash Algorithm 256-bit) digest and provenance record required by the source asset algorithm. Other writable roles use the existing `read`/`write`/`bash`/Skill surface; exact research adapters own structured source evidence, frontend-design owns its canonical task-scoped design artifacts, Build owns implementation and repairs, and Visual QA plus Integrity own browser-backed review and acceptance evidence. No source shell wrapper or second execution harness is retained.

### Capability/performance mapping

| Source capability                                       | OpenCorvus owner                      | Throughput model                                                                                                                                                         |
| ------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Team/intent and fresh-versus-existing target resolution | `mirror-prism-intent-analyst`         | task-scoped, parallel with source reconnaissance where evidence permits                                                                                                  |
| Page-family structure and state evidence                | `mirror-prism-source-researcher`      | task-scoped structured frontend research                                                                                                                                 |
| Measured UI evidence                                    | `mirror-prism-ui-researcher`          | independent task-scoped frontend research at the accepted desktop viewport                                                                                               |
| Observable UX-flow evidence                             | `mirror-prism-ux-researcher`          | independent task-scoped frontend research over required interactions                                                                                                     |
| Competitor discovery and evidence                       | `mirror-prism-competitor-researcher`  | writable delegated research with web search and Browser MCP, independent of asset harvesting                                                                             |
| Asset bytes, inventory and provenance                   | `mirror-prism-asset-curator`          | writable delegated worker with Browser MCP and projected `materialize-asset` package tool; real bytes, no-overwrite write, size, digest and provenance are one operation |
| AInvest feature fit and L2/L3 conflict mapping          | `mirror-prism-ainvest-feature-mapper` | independent delegated evidence owner, used only after AInvest intent is proven                                                                                           |
| Three-layer page PRDs                                   | `mirror-prism-prd-author`             | writable page-disjoint delegated goals after shared evidence                                                                                                             |
| Skeptical PRD review                                    | `mirror-prism-prd-integrity-reviewer` | page-disjoint review before implementation                                                                                                                               |
| Page-family goal sizing                                 | `mirror-prism-workload-analyst`       | one task-scoped decomposition artifact                                                                                                                                   |
| Rendered design target                                  | `mirror-prism-interface-designer`     | page-disjoint goals using visual-region tools                                                                                                                            |
| Independent design critique/recheck                     | `mirror-prism-design-reviewer`        | browser-backed page design review before implementation                                                                                                                  |
| Production implementation                               | `mirror-prism-implementer`            | page-disjoint goals with Browser MCP screenshot loop                                                                                                                     |
| Functional and rendered acceptance                      | `mirror-prism-acceptance-tester`      | independent page-disjoint browser cases; defects return to the implementation owner                                                                                      |
| Final requirement/evidence audit                        | `mirror-prism-integrity-reviewer`     | disjoint goal review against PRD, design, implementation and screenshots                                                                                                 |

## Implementation plan

- [x] Read source export, runtime architecture, SDK, package examples and tests.
- [x] Exhaustively search runtime identity, SDK validation/import, loader, resolver, payload and source-environment call points.
- [x] Author the self-contained `hermes/mirror-prism` package and its exact manifest projection.
- [x] Add SDK round-trip and real Registry/Manager/Resolver/Skill/MCP isolation tests.
- [x] Regenerate the expert-squad payload and update documentation indexes.
- [x] Correct runtime roles, restore the five-specialist evidence wave and AInvest feature algorithm, add design review plus acceptance/repair ownership, and remove impossible file-output claims from exact structured adapters.
- [x] Extend tests from projection shape to executable tool/prompt contracts and prove asset-byte/digest behavior with a real local HTTP fixture.
- [x] Run focused and structural validation; repair every in-scope failure. Mirror Prism focused tests, payload freshness, virtual-workflow residue, SDK authoring, Browser MCP fixture and both typechecks pass. The unrelated Windows payload-release `EPERM` remains explicitly classified below.
- [x] Perform post-correction independent review and record its final verdict in `Codex review feedback`.
- [x] Commit the post-review test/spec delta with a `dsw-33987` subject and push the main delivery branch to `legacy-remote/v0.0.13beta` without bypassing hooks.

## Validation plan

- `bun test packages/sdk/js/test/mirror-prism-authoring.test.ts`
- `bun test packages/opencorvus/test/expert-squad/mirror-prism-package.test.ts`
- `bun test packages/opencorvus/test/expert-squad/payload-generation.test.ts`
- `bun test packages/opencorvus/test/expert-squad/virtual-workflow-protocol.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun run --cwd packages/sdk/js typecheck`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run generate`
- `bun run docs:check`
- `git diff --check`

Static package acceptance does not require an external provider or public webpage. A real end-to-end benchmark does: an installed provider and explicit model configuration, provider credentials/quota, a representative source URL and target project, source/competitor network access, an authenticated Browser MCP storage state when pages are private, Node plus an available Chromium/Edge browser, the target project's dependency/build/test/preview commands, an available task-scoped preview port, and authorization for any copied source assets. The workspace `.opencorvus/opencorvus.jsonc` currently declares terminal profiles only and no project model, so a live run must prove an applicable user-global model or add an explicit model in the benchmark project before dispatch.

The independent Windows `EPERM` failure is not one of those end-to-end inputs. It occurs while atomically renaming a validated `frontend-replica` staging directory under a unique temporary project during the repository-wide payload-release test. The exact lock holder remains unproven; it is tracked as a filesystem/concurrent-run test-environment issue, not a Mirror Prism provider, browser, or webpage configuration requirement.

This task changes an agent package and test artifacts, not a user-facing frontend surface. A screenshot of OpenCorvus would not prove static package behavior. The complete live benchmark, however, must use the real active package, exact projected workers, a real source page, the real target preview, browser screenshots and interactions, and visible acceptance/repair redispatch evidence. No live Overlay process will be restarted or refreshed without explicit user approval.

## Implementation and validation evidence

- Added the plaintext package at `expert-squads/hermes/mirror-prism/` with 18 exact dynamic agents, one immutable virtual workflow, seven projected package Skills, one executable package tool, the source AInvest knowledge closure, and the source popular-web-design reference closure. The package contains 105 files and no external runtime wrapper.
- Registry source loading succeeds with manifest ID `mirror-prism`, namespace `hermes`, all 18 agents, seven exact package Skills, and package tool ref `mirror-prism/shared/materialize-asset`.
- `packages/sdk/js/test/mirror-prism-authoring.test.ts` proves all 105 files round-trip through `writeExpertSquadPackage`; every caller-owned file is byte-identical and the generated manifest is semantically identical.
- `packages/opencorvus/test/expert-squad/mirror-prism-package.test.ts` proves Manager folder validation and project import, explicit activation, exact agent and virtual-workflow projection, writable delegated-worker tool surfaces, competitor discovery, package asset-tool projection, default webpage and visual-region tools, complete Browser MCP tool refs, real SkillMount output, inactive isolation, structured-adapter output discipline, and exclusion of source runtime wrappers/fallback identities/machine paths.
- `packages/opencorvus/test/expert-squad/mirror-prism-asset-tool.test.ts` executes the projected package tool against a real local HTTP fixture and proves exact bytes, stable `A###` path, media type, byte length, SHA-256 digest, provenance output and no-overwrite behavior.
- The focused Mirror Prism package and asset run passed 5 tests; together with SDK authoring, virtual-workflow and payload freshness, the final focused run passed 17 tests with 329 assertions. The real Browser MCP local fixture passed navigation, observation, screenshot and destroy with 37 assertions; SDK and OpenCorvus TypeScript typechecks passed.
- Repository-wide dynamic-package validation now observes the Mirror Prism package tool through provider schema preparation and verifies every Mirror Prism Browser MCP owner. Nine of ten tests and 1,199 assertions pass. The remaining test consistently fails on Windows with `EPERM` while atomically renaming the already-validated `frontend-replica` staging directory in a temporary project. An isolated Registry load plus rename succeeds, as does sequential Manager import of `frontend-innovate` and `frontend-replica`; the failing process therefore remains environment/concurrency-sensitive rather than a Mirror Prism manifest or projection failure.
- Concurrent workspace diagnostics showed another Bun test process, Turbo/TypeScript processes, and an Overlay browser test/build process already operating in the same repository. They were not stopped because their ownership is external to this task and the running-process boundary forbids intervention.
- Independent review rejected this evidence as proof of algorithm completeness because it asserted package projection but not role executability, the original five-way research topology, independent design critique, acceptance/repair ownership, or live-model performance. The implementation evidence above is retained as the first-port baseline, not the final acceptance statement.

## Codex review feedback

- User correction, 2026-07-21: the initial lexical match between `Mirror Prism` and the unrelated OpenMirror product caused an invalid OpenMirror Skill load. That Skill is not an input to this port. The implementation and validation path is exclusively the repository-owned Expert Squad SDK, Registry, Manager and Resolver. The source list and execution guidance were corrected before package implementation.
- Independent agent review, 2026-07-21: first-port completeness is rejected for the concrete runtime/tool, specialist-concurrency, AInvest mapping, design-review, acceptance-loop, model and benchmark gaps recorded above. These are mandatory correction items, not accepted variances.
- Independent agent second review, 2026-07-21: the corrected package projected all 18 roles, but `mirror-prism-ainvest-feature-mapper` was absent from the immutable virtual-workflow graph and therefore absent from the requirements/PRD evidence dependency. Prompt prose alone did not prove the conditional fifth specialist in the topology. The graph and regression test must include that exact owner before structural parity can be accepted.
- Independent agent third review, 2026-07-21: after the graph correction, the AInvest mapper overlay still required competitor, UI, UX and asset evidence even though those owners are peers in the same research wave. That hidden peer dependency would serialize the fifth specialist in a real dispatch. Source evidence must be its only required input; peer evidence is optional when already available, and requirements/PRD own the post-wave L2/L3 reconciliation.
- Independent agent final review, 2026-07-21: **ACCEPTED for static algorithm migration** after confirming the 18-node closure, source-only required mapper input, non-blocking same-wave peer policy, post-wave L2/L3 reconciliation and focused 17-test pass. Model-performance equivalence remains explicitly unproven until a fixed-model, fixed-sample live benchmark is executed.
