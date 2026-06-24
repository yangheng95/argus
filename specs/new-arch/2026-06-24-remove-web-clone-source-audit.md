# Remove Web Clone Source Audit Tool

Date: 2026-06-24

## Objective

Delete the `web_clone_source_audit` tool and the source-skeleton consumption
audit code path. The repository must not expose the tool, instruct agents to run
it, generate host-prepared audit summaries, or require
`web-clone-source-skeleton-consumption-audit.json` as acceptance evidence.

## Recalled Constraints

- `AGENTS.md` forbids fallback, dual-source behavior, and hidden compatibility
  paths. Deleting the public tool while keeping direct audit enforcement would
  leave an impossible second source.
- `specs/new-arch/2026-05-30-source-skeleton-webpage-generation.md` originally
  made source audit part of source-skeleton acceptance.
- `specs/new-arch/2026-06-01-clone-first-handoff-fix.md` later split visual
  baseline adoption from maintainable replacement, but still retained source
  audit for maintainable replacement.
- `specs/new-arch/2026-06-02-generic-source-component-extraction.md` extended
  audit coverage to source region replacement.
- `specs/new-arch/2026-06-17-document-health-audit.md` last touched the tool by
  making `sourcePackageDir` explicit.

## Full Reference Sweep

`rg -n "web_clone_source_audit|WebCloneSourceAuditTool|source-skeleton-consumption-audit|web-clone-source-skeleton-consumption-audit|summarizeHostPreparedSourceAudit|inspectWebCloneSourceSkeletonConsumptionEvidence"` found these live surfaces:

| Surface | Decision |
| --- | --- |
| `packages/opencorvus/src/tool/web-clone-source-audit.ts` | Delete tool file. |
| `packages/opencorvus/src/web-clone/source-skeleton-consumption-audit.ts` | Delete audit implementation and evidence inspector. |
| `packages/opencorvus/src/web-clone/index.ts` | Remove deleted audit export. |
| `packages/opencorvus/src/agent/tool-pool-contract.ts` | Remove tool from coding, build, general, frontend-design private tool pools and private registry loader. |
| `packages/opencorvus/src/frontend-design/static-tools.ts` | Remove tool from static/session/implementation tool identifiers. |
| `packages/opencorvus/src/frontend-design/agent.ts` | Remove import, implementation-tool creation, host-prepared audit generation, and test hook export. |
| `packages/opencorvus/src/frontend-design/host-prepared-source-project.ts` | Remove direct audit import, `sourceAuditEvidence`, and source-audit summary section. |
| `packages/opencorvus/src/orchestrator/tools.ts` | Remove host-prepared audit summary from evidence snapshot construction. |
| `packages/opencorvus/src/web-clone/context.ts` | Remove source audit tool from generated context, contract, readme, and blueprint instructions. |
| `packages/opencorvus/src/web-clone/source-project-generator.ts` | Remove generated project readme and iteration-state instructions requiring the deleted tool. |
| `packages/opencorvus/src/tool/web-clone-generate-source-project.ts` | Remove next-step instruction to run the deleted audit tool. |
| `packages/opencorvus/src/frontend-design/handoff.ts`, `schema.ts`, `prompt/core/frontend-design-core.txt`, `prompt/core/integrity-team-core.txt`, `integrity/team-agent.ts` | Reword source audit references to source evidence, structured review, and visual evidence. |
| `packages/opencorvus/src/web-clone/evidence-integrity.ts` | Remove contamination rule specific to the deleted audit JSON artifact. |
| Tests under `packages/opencorvus/test/**` | Replace exposure assertions with non-exposure assertions, delete audit-specific tests, and keep source generation tests focused on generated files, source evidence, and visual-evidence instructions. |
| Historical specs | Leave historical notes intact except this new superseding plan records the deletion. |

## Replacement Acceptance Shape

- Source package generation remains the input/evidence path.
- Build and frontend-design instructions should require source evidence review,
  generated source project structure, and runtime screenshot/visual comparison.
- There is no host-side audit JSON requirement, no replacement tool name, and no
  compatibility shim.

## Verification

- Run targeted tests for agent tool exposure, frontend-design prompt/tool
  surfaces, web-clone context, source project generation, build prompt context,
  provider schema stress, document health, and orchestrator integrity evidence.
- Run `rg` sweeps after edits to ensure `web_clone_source_audit`,
  `WebCloneSourceAuditTool`, and `source-skeleton-consumption-audit` are absent
  from live source/tests.
- Run typecheck after targeted tests.
