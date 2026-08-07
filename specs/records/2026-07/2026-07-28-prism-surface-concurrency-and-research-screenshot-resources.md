# Prism surface concurrency and research screenshot resources

## Recall

### User request

- Diagnose whether Task `tsk_fa7bae21b001r9cm73S5qMRWlz` had an execution fault, explain why Goal G2 took so long, optimize the chain, then implement the repair.
- The supplied debug snapshot shows G1 terminal success at `2026-07-28T09:13:12Z` and G2 terminal success at `2026-07-28T10:44:49Z`.

### Acceptance

- A completed `FrontendResearchBrief` owns immutable Task Artifact resources for its research bundle and every Browser screenshot observed by that research Session.
- Screenshot resources remain readable by exact Artifact/resource locators after the child Session finishes; the catalog reports their real count and media types.
- Persistence failure discards the just-published Engine resource snapshot instead of leaving an orphan.
- One Prism UI researcher still owns the complete observation packet for one surface. Independent surface Goals may run that agent, authors, and Goal-local reviewers concurrently when their persisted owned paths are disjoint.
- The Task-wide Architect emits only canonical scoped research evidence refs derived from exact selected Artifact locators; raw brief-local evidence IDs are not valid Contract Graph refs.
- No Host concurrency gate, retry loop, route bypass, state machine, fallback source, per-surface browser fan-out, or running OpenCorvus/Overlay restart is introduced.

### Hard constraints

- Preserve all unrelated dirty-worktree changes. Do not reset, stash, restore, or create another worktree.
- Keep one source of screenshot bytes: the existing `AttachmentStore` blob is copied into the current Task runtime and published once as an immutable Engine resource snapshot.
- Keep workflow ordering in the Prism manifest. Parallelism is only across semantically applicable disjoint Goals; within a surface, declared dependencies remain unchanged.
- Playwright must use Node, not Bun, if browser acceptance becomes necessary.
- Every source change requires focused regression coverage, then the normal repository checks, a second review, a `dsw-33987` commit, and a normal-hook push to `legacy-remote`.

### Records read

- `specs/records/2026-07/2026-07-26-prism-surface-evidence-fanout-resource-stability.md`: one UI researcher per surface owns UI, UX, accessibility, screenshot, and asset-candidate observation; do not restore browser-agent fan-out.
- `specs/records/2026-07/2026-07-26-prism-fresh-18-frontend-design-runtime-incident.md`: screenshot attachment URLs without durable Artifact resources already caused downstream byte-read failures.
- `specs/records/2026-07/2026-07-26-unified-task-artifact-catalog-protocol.md`: immutable Task Artifact refs and exact Artifact reads are the canonical cross-Agent handoff.
- `specs/records/2026-07/2026-07-25-virtual-workflow-goal-applicability-repair.md`: workflow applicability and concurrency are prompt/manifest contracts, not Host gates.
- `specs/records/2026-07/2026-07-27-projected-worker-task-artifact-publication.md`: Host-verified Task Artifact publication is the supported durable resource protocol.
- `specs/records/2026-07/2026-07-23-mirror-prd-author-review-blocker-repair.md`: Goal-local author/reviewer convergence must use exact Artifact selection and visible evidence.

### Full-repository call-point inventory

| Surface | Call points found | Disposition |
| --- | --- | --- |
| Frontend research execution | `research/agent.ts`, `frontend-research/agent.ts`, `orchestrator/frontend-research-stage.ts` | Publish the complete typed resource set after the research bundle is written; require that publication at the frontend persistence boundary. |
| Research persistence | `engine/persist.ts`, `engine/store.ts`, `research/evidence-ref-projection.ts` | Store `frontend_research_brief` as one canonical Engine Artifact envelope and unwrap only that typed payload for domain readers. Keep ordinary `research_brief` unchanged. |
| Artifact metadata/recovery/import | `engine/artifact-catalog-metadata.ts`, `task-artifact/recovery.ts`, `engine/cross-task-artifact-import.ts` | Reuse the existing strict envelope path so catalog media counts, recovery ownership, and cross-Task resource import need no parallel implementation. |
| Engine resource publication | `task-artifact/store.ts`, existing callers in `visual-qa/annotated-screenshot.ts` and `browser-preview/persist.ts` | Reuse `publishEngineArtifactResources` and `discardEngineArtifactResources`; do not add another snapshot store. |
| Browser screenshot transport | `mcp/materialize.ts`, `session/message.ts`, `storage/attachment-store.ts` | Read exact completed-tool `metadata.browser.screenshot.attachmentUrl`, validate project ownership through `AttachmentStore`, and materialize inside the Task runtime before snapshot publication. |
| Prism concurrency declarations | all `goal_concurrency` entries in `expert-squads/mirror/prism/expert-squad.jsonc`; scheduler projection in `prompt-profile-resolver.ts`; dispatch description in `dispatch-agent-tool.ts` | Change only surface-local Prism workers/reviewers from `single` to `disjoint_goals`; keep Task-wide planners/integrators single. Require the scheduler to dispatch the full ready disjoint frontier before waiting. |
| Prism workflow nodes | all `virtual_workflows` nodes in the Prism manifest | Preserve the existing per-surface dependency chain. No node removal, substitution, or reordering. |
| Architect evidence | Prism Architect `system.md`, `product-requirements-planning/SKILL.md`, Core `research/evidence-ref-projection.ts` | Require exact scoped refs shaped from selected Artifact locators and forbid raw local `evidence_index[].id` values. |
| Tests | research persistence/catalog/recovery tests; orchestrator dispatch tests; Prism package/source-capability/virtual-workflow tests | Add positive resource-read and cleanup coverage, update typed envelope expectations, and replace the repository-wide “all reviewers single” assertion with explicit safe reviewer classifications. |

No independent Agent was started because the user did not request delegation or parallel Agent work in this repair.

## Evidence and cause chain

1. G1 incurred real upstream provider faults (`502 overloaded`, `503 authentication unavailable`, then a rate-limit fallback), so part of the elapsed time was external.
2. G2 then followed a serial seven-step surface workflow with 353 Tool calls.
3. The first G2 review correctly failed because the UI research brief retained screenshot URLs but its catalog metadata reported `resource_count=0`; the reviewer could not read S001-S003 PNG bytes through the canonical Artifact protocol.
4. Author convergence republished the downstream PRD with four resources and repeated the review. This avoidable repair loop added roughly 26 minutes.
5. G2, G3, and G4 were dependency-ready after G1 and owned disjoint directories, but the Prism UI researcher and PRD reviewer declared `goal_concurrency: "single"`. The scheduler therefore serialized otherwise independent surface pipelines.
6. The first Architect graph also used brief-local evidence IDs as if they were globally resolvable Artifact refs. Re-entry corrected the graph only after another long model turn.

The visible delay is therefore not one stuck process: it is external model failure plus a durable-evidence ownership defect, an explicit cross-Goal serialization contract, and an Architect evidence-identity defect.

## Design

### FrontendResearchBrief envelope

`frontend_research_brief` becomes a strict Host-owned `EngineArtifactEnvelope`:

- `artifact_type`: `opencorvus/core/frontend-research-brief`
- `producer`: Core `frontend-research/persist-research-brief`
- `payload.brief`: the validated `ResearchBrief`
- `payload.goal_id`: the exact Goal identity or `null`
- `payload.resource_roles`: indices for the three bundle files
- `payload.visual_evidence`: screenshot route, viewport, dimensions, diagnostics, exact attachment URL, evidence IDs that cite that URL, and resource index
- `resources`: immutable Task Artifact refs from one Engine resource snapshot
- normal observed/source Artifact provenance fields

Core readers unwrap this one typed envelope. Catalog indexing, recovery, exact reads, and cross-Task import continue through the existing generic envelope contract.

### Surface concurrency

Prism remains one browser observer per surface, but declares `disjoint_goals` for surface-local UI research, production, and Goal-local review identities. Task-wide Requirements/Architect, shared integration, and final release judgment remain single-owner. The scheduler prompt explicitly requires saturating the ready disjoint frontier before waiting for a completed surface, while preserving every workflow dependency.

### Architect refs

The Architect may cite only scoped refs projected from exact selected Research Artifact locators, such as `frontend_research:<artifact-id>@<payload-sha256>:<evidence-id>`. A raw `E-*` or `evidence_index[].id` is local to one brief and is not a Contract Graph identity.

## Verification

- Focused research envelope/resource publication, exact-read, persistence-failure cleanup, catalog metadata, recovery, and evidence-ref projection tests.
- Prism manifest/package/source-capability/virtual-workflow projection tests.
- Relevant orchestrator dispatch tests.
- Typecheck and repository document-health checks.
- Re-read the final diff and rerun focused tests after the second review.

## Implemented result

- Frontend Research now publishes the three bundle files plus every completed Browser screenshot in its Session through one `engine_resource` snapshot and persists one strict `opencorvus/core/frontend-research-brief` envelope.
- Resource roles are one-to-one. Bundle media types, screenshot media type, screenshot digest, and evidence-to-attachment binding are checked before the Engine Artifact is inserted.
- Catalog metadata reports the real resource count and media types. Startup recovery retains the referenced snapshot, exact reads survive deletion of the research child Session, and failed brief persistence removes the newly published snapshot.
- Prism package version `2026.07.28.1` declares `disjoint_goals` for the surface-local PRD UI researcher, PRD reviewer, Design visual reviewer, Code visual reviewer, and MirrorTest Goal-local reviewers. Task-wide planning, integration, and final fan-in ownership remain single.
- The Prism scheduler must dispatch the full ready disjoint-Goal frontier before waiting. UI research still uses one observer per surface and the original manifest dependencies remain unchanged.
- UI research now distinguishes candidate product assets from Browser screenshot evidence, and binds each screenshot observation to the exact returned attachment URL for Host publication.
- The PRD Architect prompt and Skill reject raw brief-local evidence IDs and require canonical refs derived from exact selected Research Artifact locators.
- The generated Expert Squad payload was regenerated from the modified tracked package and a second generation produced identical bytes.

## Verification evidence

- `bun run typecheck`: 8 workspace typecheck tasks passed.
- Focused research, catalog, runtime-root, Frontend Research, Prism package, source-capability, workflow protocol, and dispatch-scope suite: 53 tests passed with 2,401 assertions.
- Orchestrator persistence cleanup and Frontend Innovate flow: 2 tests passed with 91 assertions.
- MCP image materialization plus Engine resource recovery: 2 tests passed with 13 assertions.
- `bun run api:routes-check`: 6 rules and 33-file route inventory passed.
- `bun run docs:check`: 307 operations across 24 groups passed.
- Historical-document links and build-artifact checks passed. The pre-stage document-health run reported only the expected untracked-record index failure; it must be rerun after this record is staged.
- `git diff --check` passed.

## Second review

- Replaced duplicated Frontend Research producer declarations with one canonical Core constant shared by publication, persistence, envelope validation, and Catalog metadata.
- Tightened the persistence input to require resources for `frontend_research_brief` while making them impossible for ordinary `research_brief`.
- Added cross-field validation so a corrupt or mismatched screenshot cannot be published as readable evidence.
- Confirmed the fetched `legacy-remote/v0.0.22beta` tip and local `HEAD` were identical before commit.
