# Mirror Prism Goal Granularity Repair

Date: 2026-07-25

Status: Root cause repaired in source contracts; runtime fresh-Mission validation pending

## Recall

| Item | Details |
| --- | --- |
| User requirement | Treat the fresh-05 decomposition into more than one hundred Goals as a fatal infrastructure and Expert Squad failure. Stop the polluted execution, actively diagnose the cause, repair the infrastructure and expert contracts, restart, and validate from a fresh Mission rather than continuing a contaminated Session. |
| Acceptance criteria | Mission `34d0d36468f2de43` and Task `tsk_f97b846d8001F808Ab5vSI1mYt` stop while retaining all evidence. Concrete source routes remain identity-complete evidence, but Goal identity is allocated by independently implementable product delivery surface, not by concrete URL instance. A parameterized detail-page family shares its PRD, design, implementation, and verification Goal identities while every concrete route remains enumerated inside those Goal contracts and artifacts. The current TradingView contract therefore projects the catalog and detail-template surfaces instead of 31 separate route branches. Mission handoff, Prism scheduler, Architect, downstream planners/reviewers, package payload, and tests all express this single model. A fresh runtime proves the first Architect graph does not expand `31 × 4 + 3`. |
| Hard constraints | Follow `AGENTS.md`; do not add a Host gate, route cap, keyword grouping rule, fallback, compatibility path, state machine, retry/restart loop, fabricated Goal, second workflow, database migration, new worktree, or destructive Git action. Preserve parallel Overlay changes. Commit subjects start with `dsw-33987`; push normally to `myhexin`. |
| Runtime evidence | At 2026-07-25 14:02 Singapore time, Mission `34d0d36468f2de43` exposed exactly 127 Goals: 31 Product Requirements Document Goals, 31 rendered-design Goals, 31 implementation Goals, 31 route-verification Goals, plus shared-design integration, code-system integration, and final system acceptance. Initial Architect Session `ses_068362affffdUyrn8YZYIIKdP9` visibly registered those rows from `goal-prd-spaces-catalog` onward. Structural-reentry Sessions `ses_0682230ebffdaEYR6FE1VgUSOX` and `ses_0681bbec6ffdHF4369ldPjTd0Z` then spent their Turns repairing the oversized graph rather than executing delivery. The abort route returned `true`; the Mission is `failed`, and its only Task is `cancelled` with all 127 Goals retained. |
| Comparative evidence | Preserved fresh-02 Task `tsk_f97457723001toocqO4G5KhIsQ` produced 11 Goals for two real delivery surfaces: catalog and parameterized detail, each with Product Requirements, design, implementation, and verification outcomes, plus three system integration/acceptance outcomes. Polluted earlier Task `tsk_f952767d9001De82KFTZQ5hino` likewise used a seven-Goal single-surface graph before duplicate structural re-entry. These records are evidence only and are not reused for delivery. |
| Sources read | `AGENTS.md`; current Prism package manifest, README, scheduler prompt, Architect prompt/Skill, researcher contract, Design/Code/MirrorTest planner and reviewer contracts; Mirror Prism Mission Skill and all Goal/handoff/workflow references; generated expert and Mission payloads; package/SDK tests; `specs/records/2026-07/2026-07-24-mirror-prism-goal-native-source-alignment.md`; `specs/records/2026-07/2026-07-25-architect-goal-identity-and-prism-design-contract-repair.md`; Goal model documentation. |
| Whole-repository grep | `rg -n -F "For every accepted route create a PRD Goal" .`; `rg -n -i "every accepted route id|for every accepted route|per[- ]route.*goal|route.*goal|goal.*route|route_evidence_matrix|Goal-class/route matrix" expert-squads/mirror/prism packages/opencorvus/src/mission-skill packages/opencorvus/test packages/sdk/js/test`; `rg -n -i "route family|route-class|parameterized|template family|delivery surface"` over the same surfaces; `git log -S` and `git blame` for the exact Architect instruction. |
| Independent agent feedback | No independent Agent was requested or used. The diagnosis is based on exact runtime tool inputs/results, terminal entity states, package bytes, Git history, and production prompt-projection call paths. |

## Causal chain

### Observable failure

The accepted source ledger contained one catalog URL and thirty independently useful paid-Space detail URLs. Architect persisted four phase Goals for every URL and three system Goals, yielding `31 × 4 + 3 = 127`.

### Direct trigger

The projected `product-requirements-planning` Skill and Architect system prompt explicitly require a Product Requirements, rendered-design, implementation, and route-verification Goal “for every accepted route.” The Mirror Prism Mission Skill repeats the same rule and requires every route-evidence row to carry four distinct Goal IDs. The fresh-05 Task request faithfully copied this incorrect contract, so the model did exactly what the active package and Mission handoff demanded.

### Deeper design error

The source contract already records `route pattern` and `page/template family`, but the later Goal contract erased that distinction:

- a source-route instance is an evidence and acceptance identity;
- a delivery surface is an independently implementable template/behavior/ownership boundary;
- a Goal is a durable independently accepted outcome for one delivery surface or one shared-system outcome.

Treating route instances as delivery surfaces duplicates identical Product Requirements, design, implementation, owned paths, review chains, and verification work. It turns an evidence matrix into an execution graph and makes structural re-entry amplify the cost of the original modeling error.

Commit `1de63e389` introduced the decisive package wording while attempting to converge immutable Agent facts and acceptance closure. The wording fixed phase ownership but incorrectly changed “route-family evidence” into “one Goal branch per concrete accepted route.” The Host persistence and structural-reentry identity repair behaved correctly in fresh-05; they preserved the wrong 127-Goal graph rather than causing it.

### Why prior repairs did not prevent this

The previous repairs addressed duplicate Goal IDs, truncated structural-reentry acceptance specifications, root-Session tool-output recovery, researcher write capability, and runtime tool-switch precedence. None changed Goal granularity. Monitoring then treated stable cardinality as success, even though it only proved that structural re-entry preserved the oversized graph. Identity stability is necessary but does not prove decomposition quality.

## Correct model

The canonical source contract retains every accepted concrete route and adds an evidence-derived `delivery_surfaces` projection. Each surface has a stable surface ID, route pattern/template family, shared behavior and ownership evidence, and the complete member route-ID set.

Architect creates durable outcomes by delivery surface:

1. Product Requirements and evidence convergence;
2. rendered design and visual convergence;
3. production implementation and page-local interaction convergence;
4. executable route-family verification covering every member instance;
5. shared-design integration across surfaces;
6. code-system integration across surfaces;
7. final system acceptance across routes and journeys.

The model has no fixed Goal maximum and no Host-computed grouping. The researcher records material evidence; Requirements preserves it; Architect uses model judgment to select independently implementable surfaces. A unique route with unique structure or behavior may be its own surface. Many concrete routes using one parameterized template and behavior contract share one surface. Route rows may therefore intentionally repeat the same phase Goal IDs while retaining distinct source, content, screenshot, state, and journey evidence.

For the fresh-05 TradingView evidence, `spaces-catalog` and the parameterized `space-detail` family are two delivery surfaces. The expected semantic graph is the prior 11-outcome shape, not a hard-coded count rule.

## Call-point disposition

| Surface | Disposition |
| --- | --- |
| Researcher source-system contract | Require `delivery_surfaces` with evidence-backed membership in addition to the complete accepted-route ledger. Preserve every concrete route and reject arbitrary caps. |
| Requirements analyst | Express falsifiable requirements per delivery surface while requiring complete per-route content, screenshot, state, and journey evidence inside each surface. |
| Product Requirements Architect prompt and Skill | Replace concrete-route multiplication with delivery-surface outcomes. Require one route-instance-to-surface matrix and permit repeated phase Goal IDs across member route rows. Preserve structural-reentry identity rules. |
| Prism scheduler and manifest descriptions | Dispatch Goal-scoped workers against the matching delivery-surface or integration Goal. Never convert a workflow node or source URL into a Goal merely to make matrices one-to-one. |
| Design/Code planners and workers | Produce one parameterized surface implementation where evidence proves shared structure/behavior; enumerate and visually/test every member route instance required by acceptance. |
| Design/Code/MirrorTest fan-in | Validate complete route-instance coverage plus surface Goal identity. Missing a route instance remains a failure; repeated surface Goal IDs are valid and expected. |
| Mission Skill decomposition/handoff | Carry `delivery_surface_matrix` and a route-evidence matrix whose rows name `surface_id`; remove the requirement for four distinct Goal IDs per concrete URL. |
| Package and SDK tests | Prove the exact semantic distinction, including a fixture with 31 accepted routes mapped losslessly onto two delivery surfaces. Reject prompt text that mandates one Goal branch per concrete accepted route. |
| Generated payloads | Regenerate expert-squad and Mission Skill payloads from the repaired canonical sources. |

## Verification plan

1. Update canonical source package and Mission Skill files, bump Prism package version, and regenerate payloads.
2. Extend semantic tests so 31 accepted route instances remain complete while two surface IDs own the Goal graph.
3. Run focused Prism package/source-capability, Mission Skill, SDK collaboration, payload freshness, historical-link, document-health, and package typecheck tests.
4. Review the diff for route caps, Host grouping, fallback, gates, stale per-concrete-route Goal wording, and unrelated files.
5. Commit only task-owned files and push normally to `myhexin`.
6. After the polluted Mission has no live owner, stop the old backend, verify port 7878 is free, and start the repaired backend from the Prism project directory.
7. Create a never-used run directory, Session, and Mission. Verify researcher route and surface evidence, the first Architect Goal graph, structural re-entry identity/cardinality, and later task-scoped visual evidence.

## Validation ledger

| Check | Result |
| --- | --- |
| Focused Prism package, source capability, Mission Skill payload/catalog, generated payload, and SDK collaboration tests | Passed: 36 tests, 0 failures, 2,047 expectations. |
| `packages/opencorvus` TypeScript typecheck | Passed with `tsc --noEmit`. |
| Historical spec-link health | Passed: 21 tests, 0 failures. |
| Diff whitespace validation | Passed with `git diff --check`. |
| Stale concrete-route Goal wording scan | No production hit for the removed per-concrete-route multiplication rules; the sole exact old phrase is a negative regression assertion. |
| Document health | Passed after precise staging: 62 tests, 0 failures, including the monthly-index tracked-file assertion. |
| Runtime fresh-Mission proof | Pending commit, push, project-package release, backend restart, and a never-used Mission/run directory. |
