# Prism fresh-18 frontend-design runtime incident

## Recall

- The user requires direct Mission publication against the formal database and
  real end-to-end verification on port `7777`; benchmark wrappers are
  forbidden.
- Mission `3b57f460a6582e27`, Task
  `tsk_f9c1c6566001CbTVc86sCjcFN2`, and run `fresh-18` are terminal failure
  evidence only and must not be reused.
- A reasonable omission remains valid. The defects in this incident are not
  omissions: one adapter failed before its specialist started, and another
  specialist could not read screenshot bytes that the source worker had
  already captured.
- The canonical Artifact Catalog design and call-point inventory remain in
  `2026-07-26-unified-task-artifact-catalog-protocol.md`; this incident record
  does not introduce a second transport design.
- Repository search found one runtime call site for the failing lazy load:
  `packages/opencorvus/src/orchestrator/frontend-design-tool.ts`. The barrel
  `packages/opencorvus/src/frontend-design/index.ts` only re-exported the
  namespace; tests were the remaining references.

## Evidence and cause

- Corrected detail dispatch part `prt_f9c7b63330014fbFUSnFuTNOBj` failed with
  `TypeError: undefined is not an object (evaluating
  'FrontendDesignAgent.analyze')` while the simultaneous catalog dispatch part
  `prt_f9c7b6325001rG4pUVcAqE193B` started successfully.
- A bounded local reproduction ran 100 concurrent imports of both
  `@/frontend-design` and `@/frontend-design/agent`; each produced the observed
  set `["function", "undefined"]`. The adapter destructured a concurrently
  initializing Bun TypeScript module namespace inside every invocation.
  `FrontendDesignAgent` must therefore be statically initialized when the
  adapter module loads.
- Source artifacts `art_f9c4323c2001APNOGgr4KcoQfe` and
  `art_f9c43b96a001ctdgM45dDAmGv2` retained attachment URLs, and fresh-18
  retained real PNG files below
  `.opencorvus/.r/t/1s/bpOfUm/webpage-evidence/screenshots/`. The design worker
  received only logical references such as
  `frontend_research:artifact:ev-live-top`, so it could neither read the
  canonical bytes nor verify their digest. The shared Artifact Catalog must
  carry exact locators and expose real binary reads; prompt excerpts and
  logical screenshot labels are not evidence transport.

## Repair

- `frontend-design-tool.ts` statically imports
  `FrontendDesignAgent` from its defining module. Concurrent adapter
  invocations now share one fully initialized binding.
- The unified Task Artifact Catalog change already in the working tree is the
  single cross-agent transport repair. Its Mirror Design package tool publishes
  an exact snapshot locator and `artifact_read` returns selected PNG bytes with
  their verified digest.

## Acceptance

- `frontend-design-adapter-initialization.test.ts` proves 100 concurrent
  adapter consumers share a defined `analyze` function and prevents runtime
  dynamic import from returning to the call site.
- `mirror-design-visual-reference-tool.test.ts` proves an exact immutable
  screenshot locator resolves to readable PNG bytes and the expected digest.
- A new, never-reused run is published directly on port `7777`. Both catalog
  and detail design dispatches must start, read exact screenshot evidence, and
  produce task-scoped visual output before downstream implementation and real
  visual verification can be accepted.
