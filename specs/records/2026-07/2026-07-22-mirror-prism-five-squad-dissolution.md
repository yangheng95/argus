# Mirror Prism Five-Squad Dissolution

> Cross-squad runtime ownership was superseded on 2026-07-22 by `2026-07-22-mission-squad-stage-task-orchestration.md`: Mission now creates one fixed-profile dependent Task per squad stage. Package dissolution and capability ownership in this record remain historical evidence.

## Recall

### User requirements

- Dissolve Mirror Prism into five independent external Expert Squads whose scheduling is owned by OpenCorvus infrastructure.
- Reuse the already integrated MirrorTest and Mirror Watch squads.
- Reproduce the remaining three source agents one-to-one without losing their Product Requirements Document (PRD), design, or code capabilities.
- Remove the existing `expert-squads/hermes/mirror-prism` package because it is not an acceptable implementation.
- Place the three new packages under the `mirror` authoring namespace.
- Add a configuration button to Expert Squad settings so package-declared entries such as keys can be edited.
- Use `/Users/yangheng/Documents/output` as the source export.

### Acceptance criteria

1. The tracked authoring inventory contains exactly the existing `tanzeqi/mirror-watch`, existing `wujiang/opentest`, and new `mirror/mirror-prd`, `mirror/mirror-design`, and `mirror/mirror-code` capabilities for this five-squad system; `hermes/mirror-prism` and its generated payload entry are absent.
2. The three new packages preserve every current non-fallback source role, Skill closure, artifact contract, page-disjoint concurrency rule, independent review responsibility, and source-to-downstream handoff owned by the corresponding PRD, design, or code agent.
3. Cross-squad flow is documentation and immutable virtual-workflow guidance only: Mirror Watch evidence can feed Mirror PRD, PRD artifacts feed Mirror Design, design plus PRD feed Mirror Code, and MirrorTest validates the result. There is no host workflow engine, state machine, automatic activation, compatibility alias, or second active-squad field.
4. Package authoring, Registry, Manager, Resolver, route, inactive-isolation, generated-payload, and SDK round-trip tests cover all three new packages and the retirement of `mirror-prism`.
5. Manifest-declared configuration fields are validated by the Expert Squad SDK contract. Values are user-global extension configuration, secrets are stored in a mode-0600 data file, catalog/routes never return secret bytes, and only a trusted tool owned by the exact active package receives its declared values through the Resolver-owned package-tool context.
6. Expert Squad settings shows a configuration action only for packages that declare fields, supports text/boolean/secret entries, displays secret configured state without revealing its value, and has browser-tested save/clear/error interactions in Chinese and English.
7. The Overlay is launched through an isolated test process. Node-driven Playwright screenshots are inspected at the task-scoped Expert Squad configuration surface; no running OpenCorvus or Overlay process is restarted, stopped, refreshed, or reused as a test target.

### Hard constraints

- `prompt_profile.active` remains the only active Expert Squad source and `PromptProfileResolver` remains the only runtime projection owner.
- Existing MirrorTest and Mirror Watch identities remain unchanged; no duplicate `mirror/opentest` or `mirror/mirror-watch` package is introduced.
- The inactive packages cannot project prompts, Skills, tools, Model Context Protocol (MCP) capabilities, or package-tool configuration values.
- Configuration is not a package asset, prompt, hidden message, environment fallback, or project-committed secret.
- Source fallback agents, old agents, OpenCode/Claude/MirrorTest wrappers, Mirror Kanban, cron/watchdog scripts, cached state, absolute machine paths, `.env`, and embedded credentials are excluded.
- Existing untracked `.DS_Store` files are user-owned and remain untouched.
- No worktree is created and no current application process is interrupted.

### Materials read

- `/Users/yangheng/Documents/output/mirror-prism-pipeline/SKILL.md` v2.21.4 and `SKILL.md_sol` v3.2.1.
- All current `prism-team/*.md` source agents, including the active PRD, design and code primaries plus their supporting agents; fallback and old PRD variants were inventoried but are excluded.
- Source `skills/**`, `agent-bins/**`, pipeline templates/scripts/references, and environment-variable names without reading credential values into repository output.
- Current `tanzeqi/mirror-watch` and `wujiang/opentest` manifests, README contracts, prompts, Skills, tools and focused tests.
- `specs/current/architecture/04-extensions.md`, `05-config.md`, `06-provider.md`, and `99-principles.md`.
- The superseded single-package record `2026-07-21-mirror-prism-external-expert-squad-sdk-port.md` and current Expert Squad runtime-loading record.
- Registry, protocol schema, catalog projection, package Manager, PromptProfileResolver, package-tool bundle, SDK authoring, generated payload, routes, Config, Bash environment projection, Expert Squad settings service/panel, and browser test fixtures.

### Whole-repository grep results

| Search surface                        | Complete finding                                                                                                                                                                                                                                 | Action                                                                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mirror-prism`, `hermes/mirror-prism` | Authoring package, generated payload, two dedicated runtime tests, one SDK authoring test, benchmark fixture, package-manager inventory, repository dynamic-package matrix, virtual-workflow test, architecture docs and historical records.     | Delete the authoring tree and dedicated tests; replace live inventory/benchmark assertions with the three exact new identities; retain historical records as history and add supersession notes where needed.                               |
| Mirror Watch and MirrorTest             | Canonical authoring roots are `tanzeqi/mirror-watch` and `wujiang/opentest`; each already has Registry/Manager/Resolver/tool-chain coverage.                                                                                                     | Reuse unchanged as two members of the five-squad system; do not copy or rename them.                                                                                                                                                        |
| Source primary agents                 | `mirror-prism-prd.md`, `mirror-prism-design.md`, and `mirror-prism-code.md` are the three current non-fallback primary agents.                                                                                                                   | Create `mirror-prd`, `mirror-design`, and `mirror-code` packages.                                                                                                                                                                           |
| Source PRD supporting agents          | General/page-family research, competitor scouting, asset collection, UI research, UX research, AInvest feature mapping, and independent PRD review.                                                                                              | Preserve as exact PRD-package projected agents with source-equivalent artifact ownership and concurrency.                                                                                                                                   |
| Source design topology                | The design primary maps all PRDs, dispatches one `designer` per page in one parallel wave, validates every HTML with browser evidence, and owns cross-page integration.                                                                          | Put coordination in the package scheduler overlay and project one page designer plus independent visual reviewer; use disjoint goal scope per page.                                                                                         |
| Source code topology                  | The code primary creates exact 1:1 PRD/design pairs, dispatches one implementation worker per pair in parallel, runs the project code-quality checker, and summarizes integration. The export does not contain the referenced `prd2code` prompt. | Map page implementation to OpenCorvus `build`, preserve pairing and page-disjoint ownership in prompts/workflow, add an independent integration/integrity owner, and explicitly avoid claiming unavailable source prompt bytes were copied. |
| Source configuration                  | `AUTH`, `USER_API_KEY`, `LITELLM_KEY`, `DEFAULT_LLM_BASE_URL`, S3 fields and local service endpoints appear in scripts; the export also contains `.env` and hard-coded S3 defaults.                                                              | Do not import secrets or source wrappers. Add generic manifest-declared fields and secure user configuration; new packages declare only the fields required by retained portable capabilities.                                              |
| Manifest/schema/SDK                   | `ExpertSquadRegistry.ManifestSchema` is the sole manifest parser; generated OpenAPI types drive `@opencorvus-ai/sdk/expert-squad-authoring`; catalog hashes and route responses derive from the same manifest.                                   | Extend this single contract with optional strict `configuration.fields`, regenerate OpenAPI/SDK artifacts, and include declarations in the catalog hash.                                                                                    |
| Package-tool runtime                  | Package tools are already projected only by `PromptProfileResolver`; generic Bash and terminal processes are model-accessible and therefore cannot safely receive secrets.                                                                       | Add configuration only to the trusted package-tool `ToolContext`. Do not inject it into process environment, prompts, messages, Bash, or terminal sessions.                                                                                 |
| Settings UI                           | `ExpertSquadPanel` is the sole install/details surface; `services/expert-squad.ts` owns API calls; browser tests already cover lifecycle actions.                                                                                                | Add a declared-fields configuration dialog/action to this panel and extend the existing browser fixture, styles and translations.                                                                                                           |

## Source capability decomposition

The five independent external capabilities are:

1. `mirror-watch`: source/product observation and research evidence, already integrated.
2. `mirror-prd`: page-family evidence synthesis, three-layer PRDs, assets, UI/UX evidence, AInvest mapping and independent PRD review.
3. `mirror-design`: one renderable HTML design per PRD, local assets, browser verification, page-parallel execution and cross-page consistency.
4. `mirror-code`: exact PRD-to-design pairing, page-parallel production implementation, project quality commands, browser evidence and integration review.
5. `opentest`: independent functional, visual, performance and security acceptance, already integrated.

This is a capability chain, not a combined package or persisted workflow. A user can select any one squad for its bounded stage. A Mission that needs all five changes active squad only through the existing explicit selection protocol and passes real artifacts/messages between tasks.

### Source-to-package parity matrix

| Source owner/behavior                           | New owner                                                        | Preserved contract                                                                                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mirror-prism-prd.md` primary coordination      | `mirror-prd` scheduler overlay                                   | One evidence-backed Product Requirements Document (PRD) stage, concurrent independent research, explicit artifact handoff and separate review.            |
| `general-researcher.md`                         | `mirror-prd-general-researcher`                                  | General product/page-family evidence and citations.                                                                                                       |
| `competitor-scout.md`                           | `mirror-prd-competitor-scout`                                    | Competitor feature and interaction evidence.                                                                                                              |
| `asset-collection.md`                           | `mirror-prd-asset-curator` plus `materialize-asset`              | Provenance-preserving local asset inventory/materialization without source credentials or fallback paths.                                                 |
| `design-ui-researcher.md`                       | `mirror-prd-ui-researcher`                                       | UI pattern, hierarchy, component and visual evidence.                                                                                                     |
| `design-ux-researcher.md`                       | `mirror-prd-ux-researcher`                                       | User flow, interaction, accessibility and edge-state evidence.                                                                                            |
| `ainvest-feature-mapper.md`                     | `mirror-prd-ainvest-feature-mapper`                              | Existing-product feature mapping and gap evidence.                                                                                                        |
| `mirror-prism-prd.md` authoring responsibility  | `mirror-prd-author`                                              | Three-layer PRD assembly and `.mirror/prd/**` artifact ownership.                                                                                         |
| `thirdparty-reviewer-prd.md`                    | `mirror-prd-reviewer`                                            | Independent completeness, contradiction and evidence review.                                                                                              |
| `mirror-prism-design.md` page map/dispatch      | `mirror-design` scheduler overlay                                | Exact PRD page inventory, one disjoint goal per page and one parallel dispatch wave.                                                                      |
| source `designer` role                          | `mirror-design-page-designer`                                    | One renderable HTML design per PRD with local assets and explicit page ownership.                                                                         |
| browser verification and integration            | `mirror-design-visual-reviewer` + `mirror-design-integrator`     | Real render/screenshot review separated from cross-page consistency and artifact integration.                                                             |
| `mirror-prism-code.md` exact PRD/design pairing | `mirror-code` scheduler overlay                                  | One-to-one pair inventory, disjoint page goals and a parallel implementation wave.                                                                        |
| referenced but unexported `prd2code` worker     | `mirror-code-implementer` seeded from OpenCorvus `build`         | Every behavior stated by the available primary prompt: production implementation, project-native commands, browser evidence and no invented source bytes. |
| code quality and integration summary            | `mirror-code-visual-reviewer` + `mirror-code-integrity-reviewer` | Independent rendered review plus repository integrity/quality ownership.                                                                                  |

## Implementation plan

- [x] Extend the strict Expert Squad manifest, catalog and generated SDK types with configuration field declarations.
- [x] Add a mode-0600 Expert Squad configuration store, exact routes and Resolver-owned package-tool context with redacted secret responses.
- [x] Add the Expert Squad settings configuration button/dialog using existing UI primitives and tests.
- [x] Author `mirror/mirror-prd`, `mirror/mirror-design`, and `mirror/mirror-code` from the source contracts and complete supporting assets.
- [x] Remove `hermes/mirror-prism`, replace live tests/inventory/docs, and regenerate the single payload/OpenAPI/document sources.
- [x] Run focused, repository structural, SDK, route, type, documentation, secret-scan and visual browser validation; inspect screenshots and repair deviations.
- [x] Perform a second evidence review and update this record with results; commit and push remain the final delivery operations.

## Validation plan

- SDK authoring round-trip for all three new package trees.
- Registry/Manager/Resolver/route tests for declaration validation, installation, exact active projection, inactive isolation and package configuration environment isolation.
- Negative tests for duplicate/unsafe fields, undeclared keys, missing required values, secret redaction, clear semantics, wrong active package and session override.
- Source-parity tests that enumerate every current non-fallback source role and required artifact contract.
- Generated payload freshness and repository dynamic-agent package tests.
- Expert Squad settings unit/browser tests, Node Playwright screenshots and manual visual inspection.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` and document-health tests.
- SDK/OpenCorvus/Overlay typechecks, OpenAPI generation, API route check, docs check, Overlay i18n check, secret scan and `git diff --check`.

## Validation evidence

- The three authoring packages, generated payload closure, source-parity references, SDK round trips and real projected `visual-research` tool configuration boundary pass focused Bun tests: 11 cases and 533 assertions across the final focused runs.
- Registry, Manager, Resolver, repository dynamic-package projection, virtual-workflow, benchmark, server route and project-context suites pass when run in their isolated test groups. The two broad aggregate files can intermittently terminate a cleanup/OpenClaw child under concurrent load; each exact affected test passes independently, so this is recorded as runner aggregation behavior rather than hidden as an all-green broad run.
- Root package typecheck, Overlay typecheck, API route generation check, documentation generation/health checks and Overlay internationalization checks pass. Generated payload, OpenAPI, SDK and API documentation were regenerated from their single sources.
- The compiled standalone executable integration test imports the TypeScript package tool through its file-backed module closure. This directly verifies that the prior `blob:` package-resolution failure is absent from the current runtime model.
- A production Overlay build was served by an isolated Node fixture and controlled with the in-app browser. Four browser cases pass: the configuration action opens, the wide dialog contains every control, a secret is submitted without being revealed on reopen, explicit clear persists, and a forced load failure is visible. The inspected screenshot exposed the initial 380px-dialog clipping and the second screenshot verified the repaired wide layout.
- Secret review confirms configuration is stored outside package/project assets with mode `0600`, route/catalog inspection exposes only configured state, and values enter only the exact active package tool through `ToolContext.configuration`; no prompt, message, Bash, terminal or process-environment injection exists.

## Known source boundary

The export references a `prd2code` sub-agent and several deployment-side Skills that are not present in `/Users/yangheng/Documents/output`. Byte-for-byte reproduction of files that do not exist cannot be claimed. OpenCorvus's production `build` runtime and current project toolchain are the implementation execution surface; parity acceptance covers every behavior and handoff stated by the available `mirror-prism-code.md`, not unexported prompt text. Any later supplied source must be compared explicitly rather than accepted through a compatibility path.

## Codex review feedback

- Security review rejected the first environment-projection concept: a model can inspect Bash/terminal environment, so secret configuration must never enter generic child processes. The implementation now has one path only: a trusted package tool receives its package's declared values through `ToolContext.configuration`; routes and UI receive redacted field state.
- Visual review found the configuration body wider than the default 380px Dialog, clipping descriptions and every clear action. The surface now uses the existing wide Dialog primitive; a second real-page screenshot confirmed an approximately 786px content region with all actions inside its bounds.
- The installed-source export does not include `prd2code`. The implementation and acceptance language now distinguish complete available-source behavioral parity from unavailable byte parity instead of inventing or silently replacing missing prompt text.
- Post-implementation source comparison found that role-count parity alone had over-compressed the available 2,858-line PRD/design/code contract. Each new package now owns a required `skills/workflow/references/source-parity.md`: PRD preserves subpage rules, all source-role report shapes, both 15-dimension audits and P1–P14; Design preserves pre-flight/five-step dispatch and rendered integration; Code preserves exact pair mapping, parallel delegation, repository quality acceptance and MirrorTest handoff. Structural tests enumerate these contracts so identity names cannot substitute for capability parity.
