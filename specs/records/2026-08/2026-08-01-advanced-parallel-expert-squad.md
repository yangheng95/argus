# Advanced parallel Expert Squad replacement

Status: implemented and verified on 2026-08-01.

## Recall

### Operator request

- Replace the built-in expert-squad identity `general` with `advanced`.
- Preserve the Requirements → Architect evidence contract.
- Outside the Requirements → Architect dependency, maximize safe parallel execution.
- Apply the preceding parallelization analysis in the same change: expose SDK topology analysis, return it from Expert Squad authoring, prove Runtime multi-frontier behavior, and review every repository Expert Squad for removable false dependencies.
- Implement the change rather than stopping at analysis.

### Acceptance

- `advanced` is the only full built-in expert-squad identity; no `general` expert-squad alias, fallback, duplicate package, selector, or active-profile compatibility path remains.
- `base` remains the default and describes itself as Advanced's convenient composite non-Goal version.
- Every Advanced delivery workflow retains an exact `requirement-engineer` → `solution-architect` dependency.
- Independent intent, source investigation, workload review, implementation, testing, visual review, and integrity work shares a frontier whenever no real Artifact dependency requires serialization.
- SDK/Registry/Resolver, routes, Overlay catalog, Mission bootstrap/import prompts, tests, public docs, and current architecture agree on the exact `advanced` identity.
- The SDK exposes a read-only, deterministic topology report for every workflow; the authoring receipt returns that report without changing manifest v1 or rejecting a valid topology for being narrow.
- Runtime contract coverage proves a completed predecessor can expose multiple ready nodes in one frontier and that their join waits for both terminal-success evidences.
- Every repository Expert Squad manifest is analyzed from its actual `depends_on` graph. Dependencies are removed only where the downstream Agent does not consume predecessor evidence; typed handoffs remain serialized, and no synthetic roles or fake fan-out are added.
- The generic Mission Skill named `general`, Settings' `general` tab, generic prose, model descriptions, and CSS class names are not expert-squad identities and remain unchanged.
- Non-UI contracts pass. Overlay acceptance uses a real page and manually inspected screenshots; no UI automation test is added, modified, or run.

### Hard constraints

- Preserve all unrelated dirty-worktree changes; no stash, reset, broad restore, broad formatting, or broad staging.
- Preserve manifest v1 and the existing `depends_on` DAG semantics. Do not add `parallel`, phase, optional-node, active-workflow, step-state, auto-advance, fallback, or Host scheduling gates.
- Keep `prompt_profile.active` as the only active expert-squad selection source.
- Increment the renamed package version using the canonical daily revision format.
- Commit subject starts with `dsw-33987` and push the current main delivery branch to `legacy-remote`.

### Read material and full-repository search

- Read `AGENTS.md`, the built-in Base and General manifests/prompts, the built-in loader, SDK manifest/authoring validators, Runtime workflow frontier projection, Core parallel-first prompt, General/Base/Registry tests, product docs, and current architecture chapters.
- Full-repository searches covered `GENERAL_EXPERT_SQUAD_ID`, `GENERAL_ID`, exact `"general"` active/prompt-profile values, `selector/general`, `general-expert-squad`, Base/General relationship prose, `planned-delivery`, `greenfield-interface-delivery`, every General Agent prompt, and every path named `general`.
- Expert-squad identity call sites requiring replacement are grouped below. The generic Mission Skill `general`, Settings general tab, `.general-panel`, generic English prose, and model descriptions are explicitly retained.

| Surface | Exact disposition |
| --- | --- |
| `packages/opencorvus/src/expert-squad/builtin/general/**` | Rename the self-contained package directory to `advanced`, change manifest ID/label/selector/prompt prose, retain Requirements and Architect identities, add a package-owned Build implementation identity plus a Delegated Worker testing identity, and flatten delivery DAGs. |
| `packages/opencorvus/src/expert-squad/builtin/index.ts` | Replace General imports/constants/source entry with Advanced; do not load both identities. |
| `packages/opencorvus/src/prompt/core/{mission-core,orchestrator-core}.txt` and Multica launcher copy | Replace expert-squad bootstrap/repair/import references with Advanced while leaving the Mission Skill `general` untouched. |
| `packages/opencorvus/src/panel/capability.ts`, task/config/session/tool/server fixtures | Replace exact expert-squad active/profile fixtures where they mean the built-in full team; preserve unrelated literal uses. |
| `packages/opencorvus/test/expert-squad/{general-package,base-package,registry,prompt-profile-resolver,...}.test.ts` | Rename the package contract test, assert the exact Advanced roster/DAG/frontiers, and update full built-in catalog identity. |
| `packages/overlay/src/i18n/{en-US,zh-CN}.json` | Route Multica import Tasks to `advanced`; no UI test changes. |
| `packages/web/src/content/docs/**`, `specs/current/architecture/**`, `AGENTS.md` | Replace current built-in General terminology with Advanced and document retained REQ→Architect plus parallel frontiers. |
| `specs/records/2026-08/2026-08-01-base-default-expert-squad.md` and indexes | Supersede the former General relationship with Advanced without rewriting unrelated history. |
| `packages/sdk/js/src/expert-squad-authoring.ts` and public SDK docs | Add deterministic read-only workflow waves, initial frontier, join nodes, critical-path length, and maximum width; keep validation and scheduling semantics unchanged. |
| `packages/opencorvus/src/expert-squad/conversation-authoring.ts` and authoring Skill/tool copy | Return the exact SDK topology analysis in the successful installation receipt so authors can inspect accidental serialization. |
| Runtime workflow projection and focused contract test | Preserve the existing Runtime derivation and prove a two-node ready frontier plus a later join using positive observable outputs. |
| `expert-squads/**/expert-squad.jsonc` | Review every current package. Flatten only evidence-independent edges demonstrated by its prompts/contracts; retain genuine Artifact consumption dependencies and record packages requiring no graph change. |

### Current topology evidence

- Base `composite-delivery`: four nodes, critical path four, maximum width one.
- General `planned-delivery`: five nodes, critical path five, maximum width one.
- General `greenfield-interface-delivery`: seven nodes, critical path seven, maximum width one.
- General `evidence-investigation`: three nodes, critical path two, maximum width two.
- Runtime already derives every dependency-ready undispatched node in `frontier_node_ids`; Core already requires one `dispatch_agent` call per ready node in the same response up to Task capacity. The package graph, not a missing engine, is the bottleneck.

## Target Advanced topology

All delivery workflows preserve `requirement-engineer` → `solution-architect`. Request interpretation, Requirements, repository investigation, and supplied-interface investigation start together when applicable. Architect joins their durable evidence. After Architect:

- workload review and implementation start together when their inputs exist;
- implementation owns repository changes through a package `build` identity;
- testing, visual review, and independent integrity roles start together after implementation when they do not consume each other's verdicts;
- a reviewer that genuinely consumes workload evidence declares that additional dependency;
- evidence investigation keeps source and external research parallel before claim verification.

The graph remains a static package-owned evidence contract. Dynamic code-surface fan-out still belongs to independent Mission Tasks, not dynamically created workflow nodes.

## Repository squad topology review

The SDK analyzer was run against every current manifest. The review compared each edge with the downstream Agent prompt and its required Artifact reads; width alone was not treated as a defect.

| Package | Observed topology and disposition |
| --- | --- |
| Base | The four-node research → plan → development → test chain is the package's intentionally simplified handoff contract; every downstream Agent consumes the predecessor Artifact, so no edge is removed. |
| Advanced | Replaced the former serial General graphs with parallel intent/requirements/source roots, a retained Requirements → Architect join, parallel post-architecture workload/delivery branches, and parallel post-implementation test/review branches. |
| Frontend Innovate | Already begins with four independent evidence owners and uses typed joins; keep the genuine design/implementation/review handoffs. |
| Frontend Replica | Already exposes two independent roots and later review branches; Requirements, modeling, implementation, and acceptance consume typed predecessors, so no false edge was found. |
| Research Studio | Planner, researcher, analyst, fact checker, and writer each consume the prior authored research Artifact. Direct-writing and evidence-synthesis variants already avoid unnecessary roles; keep their chains. |
| Review & Debug | Code, root-cause, and visual investigation already fan out after reproduction, then integrity and visual review fan out after repair. Keep the repair join. |
| Mirror Watch | Expert and persona surveys already run together; requirements, architecture, research, and aggregate-report joins consume predecessor contracts. Keep those edges. |
| OpenTest | Intent → test requirements → test architecture → test implementation is the typed test-authoring contract. Integrity and live visual review already share the post-implementation frontier where applicable. |
| Mirror Prism | Removed one false serialization edge in both workflows: after code integration, code-integrity review and non-UI test implementation now share a frontier because both consume the integration matrix. Test integrity and live visual review continue to fan out after test implementation. Other PRD/design/code edges consume explicit predecessor Artifacts and remain. |

## Verification

- Positive Advanced package, Base relationship, built-in Registry, Resolver, and route/catalog tests.
- SDK/Runtime DAG tests proving multiple ready frontier nodes and join behavior without workflow state.
- Typecheck, API route check, docs check, i18n check, secret scan, and `git diff --check`.
- Real Overlay settings/catalog inspection showing Base default, Advanced selectable, the Advanced roster, and the parallel workflow contract; manually inspect screenshots.
- Second review of the exact staged diff before commit and remote equality after push.

### Recorded results

- Focused Advanced, Base, Registry/Resolver, conversation-authoring, Runtime frontier, Prism, and SDK topology contracts passed. The combined focused run reported 16 passing tests, 0 failures, and 443 assertions.
- Repository typecheck passed across all 10 packages; the SDK package typecheck and build passed independently.
- `api:routes-check`, `docs:check`, the historical-document link contract, the Overlay production build, and `git diff --check` passed.
- Runtime frontier evidence showed `[integrity, test]` becoming ready together after `prepare`, followed by `[accept]` only after both terminal-success evidences.
- Real Overlay acceptance ran against an isolated server at port 18888. Manual inspection confirmed Base remained effective active, Advanced was the only full built-in alternative, Advanced projected 14 Agents including Implementation Engineer and Test Engineer, and the browser console contained no warnings or errors. No UI test was created, modified, or run for this acceptance.
