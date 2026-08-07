# Renderable HTML Evidence and Visual QA Scheduling Repair

## Recall

### Original request

- Investigate why task `tsk_f85705aa7001CN01d2RIxfqZRD` completed with very poor visual fidelity.
- Establish whether screenshot comparison and Visual QA were invoked.
- Correct the false assumption that HTML is not evidence.
- Investigate the full impact surface and repair the root causes.

### Acceptance indicators

- A reference-parity `frontend_design` call treats explicitly declared renderable HTML design sources as source authority.
- The same canonical manifest projects a real browser-rendered raster reference derived from each HTML source; downstream Frontend Design, Build, and Visual QA consumers can cite the immutable HTML/ref relationship.
- Missing or failed reference projection is visible as an evidence/toolchain blocker. It must never be converted into `greenfield_original` work.
- Generic Visual QA is scheduled for user-requested rendered UI acceptance after a visible implementation exists, independent of whether the request uses replica/clone wording.
- `no_project_diff`, implementation-agent prose, or an uninspected screenshot cannot satisfy a visual implementation or final verification goal.
- A completed task cannot still derive terminal reason `interrupted`, and terminal dispatch ownership reconciles a missing child-session terminal status instead of leaving a perpetual streaming card.
- Unit, contract, message-flow, real browser-render, typecheck, documentation-health, and secondary review evidence all pass.

### Hard constraints

- Repair prompt/data projection and the actual lifecycle facts; do not add a host completion gate, fallback route, compatibility alias, or parallel source of truth.
- Keep the Design Resource Manifest as the single semantic resource index and AttachmentStore as the byte store.
- Use the existing Node/Playwright browser sidecar for HTML rendering; Playwright must not be launched with Bun.
- Do not restart, refresh, or terminate the running OpenCorvus/overlay process.
- Preserve unrelated user changes already present in the worktree.

### Durable evidence read

- `specs/current/architecture/02-data.md`
- `specs/current/architecture/09-verification-evidence.md`
- `specs/records/2026-07/2026-07-02-frontend-replica-workflow-goal-discipline.md`
- `specs/records/2026-07/2026-07-04-direct-build-outcome-and-visual-qa-contract.md`
- Task row, artifacts, sessions, goal attempts, and protocol facts for `tsk_f85705aa7001CN01d2RIxfqZRD` in `/Users/yangheng/.local/share/opencorvus/opencorvus.db`.
- Frontend Design handoff at `/Users/yangheng/Documents/OpenCorvus-Demos/world-economy-design-v3/.opencorvus/.r/t/F6/94F7AF/fd/frontend-template.md`.

### Observed incident facts

1. The task carried 17 HTML files as `system_artifacts` with explicit `design_source` or `interaction_reference` intent, plus JSON design data. The request explicitly called those renderable files the only design source of truth.
2. Both persisted Design Resource Manifests indexed those files correctly as `kind=html`, but `FrontendDesignAgent.isTextOnlyNoVisualSource`, `hasDeclaredVisualAuthority`, and the prompt text recognized only `visual_reference`, image, PDF, or browser-preview rows. The prompt explicitly told the worker that the HTML rows were not visual authority.
3. The first `frontend-replica-interface-modeler` correctly reported missing reference evidence. The scheduler cancelled it and redispatched the same work as `greenfield_original`, changing task semantics instead of repairing the missing projection.
4. The resulting handoff recorded `visual_quality_status=evidence_missing`. No Visual QA or Integrity session was created. The final verification goal was sent to `frontend-replica-implementer`, whose result had `no_project_diff`.
5. All nine goals were marked passed despite all active requirement rows remaining pending, `engine_metric_result=0`, and `engine_iteration=0`.
6. The task row was completed while `metadata.interrupted=true`, so the UI derived terminal reason `interrupted`. A detached frontend-design child had terminal tool ownership but no persisted terminal `session.status`, leaving its card streaming.

### Full-repository call-point search

| Surface                          | Call points / contracts                                                                                | Disposition                                                                                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design resource schema/index     | `frontend-design/design-resource-manifest.ts`, manifest tests, Frontend Design adapter materialization | Extend the one manifest with an explicit rendered-source origin and bidirectional source/projection relationship.                                                                                                |
| HTML material input              | `orchestrator/frontend-design-tool.ts`, `frontend_design.materials`, task `system_artifacts`           | Render explicit HTML `design_source`/`interaction_reference` rows during reference-parity input projection; do not introduce a second research adapter or hidden discovery path.                                 |
| Browser renderer                 | `frontend-design/output-tools.ts`, browser runtime Node sidecar                                        | Reuse the existing static-file Playwright renderer and default webpage-evidence viewport.                                                                                                                        |
| Frontend Design authority prompt | `frontend-design/agent.ts`, prompt tests                                                               | Treat HTML source rows plus their linked rendered projections as declared parity authority and remove the false “not visual authority” statement.                                                                |
| Build parity refs                | `orchestrator/build-feedback.ts`, context tests                                                        | Keep its existing `visual_reference` raster filter; it will consume the derived rows from the same manifest.                                                                                                     |
| Visual QA reference context      | `visual-qa/reference-parity-context.ts`, `visual-qa/context.ts`, Visual QA output schema               | Preserve formal reference-comparison rules; feed it source refs from the Frontend Design handoff rather than weakening evidence requirements.                                                                    |
| Scheduler policy                 | core Orchestrator prompt, frontend-replica package selector/agent overlays, prompt/package tests       | State that Visual QA is generic, must be selected for requested rendered acceptance, and cannot be replaced by Build screenshots or implementation prose. Keep this as LLM scheduling guidance, not a host gate. |
| Goal completion                  | `goal-lifecycle-tools.ts`, core prompt, frontend-replica selector                                      | Preserve host freedom; make `no_project_diff` and missing requested review evidence explicit non-completion evidence in the prompt.                                                                              |
| Task terminal facts              | `engine/state.ts`, `engine/task-status.ts`, terminal lifecycle tests                                   | Terminal/queued/active intents own and normalize `cancelled`/`interrupted` metadata so completed cannot still project interrupted.                                                                               |
| Detached child terminal status   | `orchestrator/tools.ts`, `SessionStatus`, coordination message-flow tests                              | Map terminal ownership outcome to the missing persisted child `session.status` and await publication.                                                                                                            |
| Documents/index                  | this record, `specs/README.md`, `specs/records/2026-07/README.md`, current architecture docs           | Record the repaired contract and verify documentation links/health.                                                                                                                                              |

No independent sub-agent feedback exists because the user did not request delegation and current collaboration policy forbids unsolicited spawning.

## Causal chain

`HTML design_source exists` → manifest preserves bytes and intent → Frontend Design authority classifier ignores renderable HTML → worker sees no visual authority → scheduler changes `reference_parity` to `greenfield_original` instead of repairing evidence → implementation proceeds without source-to-target reference images → generic Visual QA is never dispatched → `no_project_diff` verification is manually completed → task completion retains stale interrupted/session-streaming facts.

The terminal symptoms are not the root cause. The root is the missing renderable-source projection plus scheduler guidance that allowed semantic mode switching and reviewer omission.

## Implementation plan

1. Add a manifest-owned rendered HTML projection that writes source screenshots to the task Frontend Design artifact root and AttachmentStore, preserving SHA-256 identity and source linkage.
2. Invoke that projection for explicit `reference_parity` HTML `design_source`/`interaction_reference` inputs before the Frontend Design worker starts.
3. Update Frontend Design authority classification and prompt text to describe HTML and its rendered projection truthfully.
4. Update generic Orchestrator and frontend-replica scheduling guidance so requested visual acceptance dispatches the projected Visual QA reviewer and missing evidence cannot trigger greenfield substitution.
5. Normalize terminal task metadata and reconcile terminal ownership with missing child-session status.
6. Add unit, browser-render integration, prompt/package, terminal lifecycle, and coordination message-flow regression tests.
7. Run focused tests, typecheck, documentation checks, a real browser render/inspection, and a second source review before commit/push.

## Verification matrix

| Requirement                | Evidence                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| HTML is evidence           | Manifest test proves HTML source → linked raster reference; prompt test proves it is parity authority.                          |
| Real visual acquisition    | Node/Playwright integration renders a deterministic HTML fixture and decodes/inspects the produced PNG.                         |
| Build/Visual QA continuity | Context tests prove the derived `visual_reference` row is projected downstream without changing the formal comparison contract. |
| Visual QA is generic       | Core prompt and package tests require it from requested UI acceptance, not replica naming.                                      |
| No semantic bypass         | Prompt/package test rejects switching missing reference evidence to greenfield.                                                 |
| Terminal consistency       | Task lifecycle test proves completed/failed/cancelled facts clear incompatible metadata.                                        |
| No stale streaming child   | Coordination message-flow test proves terminal ownership publishes exactly one matching terminal session status.                |
| Repository health          | Focused tests, typecheck, docs single-source/document-health tests, and Git pre-push hook pass.                                 |

## Secondary review

- The implementation keeps one semantic source of truth: the existing Design Resource Manifest records both the canonical HTML source and its task-scoped Node/Playwright raster projection through explicit bidirectional relations. AttachmentStore remains byte storage rather than a competing authority.
- The repaired orchestration contract dispatches Visual QA from requested rendered-product acceptance, not from replica/clone naming. It also treats `no_project_diff`, missing requested surfaces, and missing review evidence as non-completion evidence.
- Terminal ownership now emits the matching visible session lifecycle fact and task terminal/reactivation writes remove contradictory `cancelled` / `interrupted` metadata.
- Focused and broader regression suites, package/root typechecks, API route checks, documentation health checks, generated-source checks, and a real 1440-pixel-wide full-page render were executed. The rendered source was visually inspected; no unresolved implementation blocker was found.
