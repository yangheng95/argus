# All Expert-Squad Runtime Audit

Status: complete

## Recall

### User request

- 检查所有的专家团。
- The preceding failure involved a projected Mirror Watch package tool, so the audit must cover the real projection and provider-schema preparation chain for every repository package tool instead of stopping at manifest parsing.

### Acceptance criteria

- Inventory the built-in `general` identity and every repository package discovered below `.opencorvus/expert-squads/**`.
- Verify Registry loading, manifest/resource ownership, scheduler capability, every dynamic worker capability, selector/skill/MCP isolation, payload release, and current frontend desktop-only package constraints.
- Materialize every package tool projected to a scheduler or worker and pass it through `SessionLoop.prepareProviderTool` with a representative provider model.
- Assert that materialized package-tool provider names exactly match each capability's declared package-tool projection; packages with no package tools must still traverse scheduler and worker resolution.
- Run the complete expert-squad suite, focused projection regression, relevant product/document health checks, and typecheck.
- Do not activate another squad, mutate the runtime database, or restart/stop the running OpenCorvus process.
- Preserve the unrelated existing edit in `packages/overlay/src/components/App.tsx`.

### Hard constraints

- `prompt_profile.active` remains the only active-squad source; the audit must not add aliases, fallback, host gates, or parallel package discovery.
- `PromptProfileResolver` remains the only runtime projection surface.
- Provider schema validation must exercise the real projected tool object, not a reconstructed schema or fixture-only surrogate.
- All new behavior evidence must be a regression test.

### Read material

- `AGENTS.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/2026-07-17-task-message-retry-package-tool-schema.md`
- `packages/opencorvus/test/expert-squad/repository-dynamic-agent-packages.test.ts`
- `packages/opencorvus/test/fixture/projected-package-tool.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/src/session/loop.ts`

### Repository inventory and grep

The repository-wide grep for `expert-squad`, `packageTools`, `package_tool_refs`, projection entry points, and provider preparation found 1,141 matching lines. The relevant production ownership and call sites are:

| Surface | Call sites | Audit action |
| --- | --- | --- |
| Package discovery/load | `ExpertSquadRegistry.discover`, `loadPackage`, `loadSourcePackage` | Keep; enumerate every manifest ID and strict package resource closure. |
| Active scheduler resolution | `PromptProfileResolver.resolveSchedulerTurnProjection`, `resolveSchedulerCapability` | Keep; resolve every identity without changing persisted config. |
| Active worker resolution | `PromptProfileResolver.resolveWorkerCapability` | Keep; resolve every declared dynamic Agent ID and reject sibling identities through existing tests. |
| Scheduler tool projection | `PromptProfileResolver.projectOrchestratorTools` | Keep; materialize every scheduler package tool and compare exact provider names. |
| Worker tool projection | `PromptProfileResolver.projectWorkerTools` | Keep; materialize every worker package tool and compare exact provider names. |
| Provider schema preparation | `SessionLoop.prepareProviderTool` | Keep; invoke for every materialized repository package tool. |
| Package bundle ABI | `PackageToolBundle.importPrepared` through Resolver `packageToolFromDefinition` | Keep; the audit reaches this path through the public projection APIs. |
| Payload distribution | `ExpertSquadPackageManager.releasePayloadPackages` | Keep; existing repository test must continue proving source/payload identity parity. |

### Initial evidence

- Repository identities: built-in `general`; project packages `frontend-innovate`, `frontend-replica`, `mirror-watch`, and `opentest`.
- No additional user-global manifest was found under the configured user roots.
- Repository package declarations: 34 dynamic Agents; 5 package tools; 31 package skills; 5 virtual workflows; no package MCP server declaration.
- `bun test packages/opencorvus/test/expert-squad --timeout 30000`: 300 pass, 1 existing skip, 0 fail, 3,953 expects across 27 files.
- `bun test packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts --timeout 30000`: 7 pass, 0 fail.
- Missing evidence before this audit: a single repository-wide test that provider-prepares all five projected package tools across their actual scheduler/worker owners.

### Independent agent feedback

- None. The user did not request independent Agents, and the current collaboration policy does not authorize delegation for this audit.

## Plan

1. Add one repository-wide runtime projection regression beside the existing source-package audit.
2. For all five identities, resolve scheduler and all workers; materialize package tools and provider-prepare every materialized instance.
3. Assert exact package-tool reference/provider-name parity and collect an aggregate set proving all five declared tool refs were reached.
4. Run focused and complete expert-squad suites, typecheck, and documentation health tests.
5. Record final evidence, commit with the required `dsw-33987` prefix, and push the current main delivery branch to `legacy-remote`.

## Final evidence

- Inventory resolved exactly five identities: built-in `general` plus repository packages `frontend-innovate`, `frontend-replica`, `mirror-watch`, and `opentest`. No additional user-global package manifest was present.
- The new repository-wide regression resolved every scheduler and all 46 dynamic workers (12 General plus 34 repository-package workers).
- The same regression materialized and provider-prepared every declared package tool: three Mirror Watch tools and two MirrorTest tools. Every resulting JSON Schema root was an object, and the exact observed tool-ref set matched the Registry declaration set.
- Focused runtime regression: 9 pass, 0 fail, 835 expectations.
- Complete expert-squad suite: 301 pass, 1 existing skipped source-folder import case, 0 fail, 4,105 expectations across 27 files.
- Frontend desktop-only and product-doc single-source pre-audit: 7 pass, 0 fail.
- `packages/opencorvus` TypeScript typecheck: pass.
- Historical links, product-doc single-source, and document-health checks: 81 pass, 0 fail, 1,282 expectations.
- No production runtime behavior changed. The only code change is durable audit coverage; no active squad, runtime database, or OpenCorvus process was mutated.
