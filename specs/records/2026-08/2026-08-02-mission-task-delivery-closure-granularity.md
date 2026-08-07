# Mission Task Delivery-Closure Granularity

> Scope-partition ordering is superseded by [2026-08-07-mission-scope-split-and-test-consent.md](2026-08-07-mission-scope-split-and-test-consent.md): Mission first partitions the complete input by positive held-Squad ownership, then applies this delivery-closure granularity only inside each single-Squad partition.

## Recall

| Field | Evidence |
| --- | --- |
| User request | “mission现在疯狂下发任务，这是不对的，每个任务应该是一个工作量很大的闭包，而不是尽量多的拆task”。 |
| Acceptance target | Mission defaults to the smallest number of large, outcome-complete Tasks. One fixed-Squad Task owns all work that the Squad can complete from the same input boundary, including its internal research, planning, implementation, testing, review, correction, and final deliverables. Task count is not a progress or parallelism objective. |
| Hard constraints | Fix the scheduling cause in prompts and package-visible capability guidance. Do not add a Host task-count gate, quota, validator, state machine, fallback, compatibility path, or keyword classifier. Preserve immutable per-Task Expert Squad ownership and exact cross-Task Artifact imports. Do not touch or restart the live OpenCorvus process or mutate its database. Non-User-Interface behavior receives positive contract coverage; no User-Interface automated tests are added, modified, or run. Preserve all parallel worktree changes. |
| Current repository state | Branch `v0.0.28beta`, initial HEAD `ed3c5be65afef0e79209c0597dabc6266d719931`, clean worktree at investigation start. Remote delivery target is `legacy-remote/v0.0.28beta`; new commit subject must start with `dsw-33987`. |
| Read records | `specs/records/2026-08/2026-08-02-mission-squad-authority-and-orchestrator-prompt.md`, `specs/records/2026-08/2026-08-02-mission-selected-squad-stage-ownership-calibration.md`, `specs/records/2026-08/2026-08-02-phase-local-build-closure-orchestration.md`, `specs/current/architecture/01-agents.md`, and `specs/current/architecture/04-extensions.md`. |
| Whole-repository search | Enumerated Mission `panel.create_task` guidance, first-wake/ready-frontier rules, stage graph fields, reconciliation rules, Mission prompt tests, `panel.create_task` Host implementation, Mission state storage, Base selector/manifest/README/Orchestrator/Planner/Developer prompts, embedded package registration, Base package tests, and current architecture references. The Host has one create path and no automatic Mission fan-out loop; cardinality is authored by Mission tool calls. |
| Live read-only evidence | The active sidecar uses `/Users/yangheng/.local/share/opencorvus/opencorvus.db`. Read-only SQLite evidence for five Missions launched with only `@squad("base")` shows 5, 6, 7, 7, and 8 Mission-created Tasks. Their durable `frontier.md` ledgers split one repository and one fixed Squad into data generation, modeling, analysis, reports, audits, repair/retest, and websites. Some wakes dispatched two same-Squad stages simultaneously. This proves authored over-fragmentation rather than duplicate Host submission. |
| Independent Agent feedback | Not requested. The user requested no multi-Agent audit in this turn, so no sub-Agent was started. |

## Causal chain

1. The observable symptom is a high number of Mission-created Tasks, including sequential “Phase” Tasks and same-wake parallel Tasks under the same `base` Squad.
2. `panel.create_task` creates exactly one Task per explicit Mission tool call. The live rows have different requests and stage titles, so the Host is not replaying one request.
3. `mission-core.txt` says to plan backward from every numbered acceptance claim, permits splitting for vague “manageable size” and “independent acceptance verdict” reasons, asks Mission to create every ready stage, and describes each Task as one terminal result. Together these rules make each acceptance cluster look like a separate Task candidate.
4. The Base recommendation catalog describes the package as “bounded” and “compact”. Mission sees that catalog surface and repeatedly treats a large same-Squad outcome as multiple bounded repository deliveries even though Base already owns a complete Task-local Researcher → Planner → Developer → Tester → reviewer workflow.
5. The recent same-Task repair prompt closes only phase-local correction after a Task already exists. It does not repair the earlier Task-boundary decision, so live Missions still create many first-class phases and later repair/retest Tasks.

## Root design

Mission stages are Task-sized delivery closures, not acceptance-item projections. The default is one large fixed-Squad Task for the complete requested outcome. A Task may satisfy many or all `Done when` claims and may produce many files, services, reports, datasets, and validation results. Large workload is evidence that the Task needs its package-owned internal workflow and Agent coordination; it is not a split reason.

Mission creates another Task only when one complete closure cannot own both sides:

- a different fixed Expert Squad must own a dependent delivery;
- an event or operator-authority decision outside the current Task and its Squad must produce terminal evidence before responsible work can begin;
- the operator explicitly requested separate Tasks with separate lifecycles.

A predecessor Artifact generated by the same Squad in the same repository is normally a same-Task internal handoff. Different deliverable types, directories, Agent roles, workflow nodes, acceptance bullets, reports, audits, tests, or opportunities for parallel work do not create Task boundaries. Cross-Task Artifact imports remain mandatory only after a real Task boundary exists.

## Call-point disposition

| Surface | Disposition |
| --- | --- |
| `packages/opencorvus/src/prompt/core/mission-core.txt` | Replace acceptance-item/stage-count bias with delivery-closure-first planning; remove manageable size as a split reason; make first-wake default one complete Task; require a positive unavoidable boundary for every additional Task; keep cross-Squad and Artifact-import contracts. |
| `packages/opencorvus/test/mission-prompt-work-ledger.test.ts` | Strengthen the positive Mission contract around one large Task closure that may satisfy multiple acceptance claims and absorbs same-Squad internal dependencies. Do not add negative UI or retired-path assertions. |
| `packages/opencorvus/src/expert-squad/builtin/base/expert-squad.jsonc` | Update visible recommendation and workflow wording so Base owns the complete Task outcome rather than a “bounded” subtask; bump the embedded package version. |
| `packages/opencorvus/src/expert-squad/builtin/base/selector.md` | State that workload size and deliverable count do not split a selected Base Task; Base’s internal graph owns the complete closure. |
| `packages/opencorvus/src/expert-squad/builtin/base/README.md` | Document complete-closure semantics and same-Task internal Artifact handoffs. |
| `packages/opencorvus/src/expert-squad/builtin/base/agents/orchestrator/system.md` | Select one Base workflow for the complete Task outcome, not ordinary “bounded work”. |
| `packages/opencorvus/src/expert-squad/builtin/base/agents/base-planner/system.md` | Plan the complete Task acceptance surface rather than a convenient workload fragment. |
| `packages/opencorvus/src/expert-squad/builtin/base/agents/base-developer/system.md` | Implement the complete Task plan; remove wording that narrows it to a bounded fragment. |
| `packages/opencorvus/src/expert-squad/builtin/base/agents/base-tester/system.md` | Verify the complete Task acceptance surface rather than approving a subset. |
| `packages/opencorvus/test/expert-squad/base-package.test.ts` | Assert the bumped Base version and complete-delivery workflow description. |
| `packages/opencorvus/src/mission-skill/builtin/general/SKILL.md` and generated payload | Preserve the same smallest-number-of-large-closures rule when the operator explicitly loads the General Mission Skill. |
| `packages/opencorvus/test/agent/primary-assistant-registry.test.ts` | Calibrate the touched positive Mission registry assertion from the already-stale “long-running delivery” wording to the current “durable delivery” contract. |
| `specs/current/architecture/01-agents.md` | Make Task-sized closure the canonical Mission granularity and keep same-Squad work inside one Task. |
| `specs/current/architecture/04-extensions.md` | Clarify that fixed profile is a closure boundary, not a reason to split one Squad’s complete product into phases. |
| `packages/opencorvus/src/tool/panel.ts` | Keep unchanged. It is the single explicit Task creation implementation and is not the source of cardinality. |
| `packages/opencorvus/src/tool/mission-state.ts` | Keep unchanged. The four-file ledger persists decisions but does not dispatch Tasks. |

## Validation

1. Run the focused Mission prompt and Base package positive contract suites.
2. Run package typecheck.
3. Run historical-doc links and document-health checks after indexing this record.
4. Inspect the final diff for duplicate/fallback scheduling semantics and touched prohibited tests.
5. Perform a second read-only review against the live evidence pattern: a one-Squad, one-repository request containing data, implementation, reports, audit, and a website must map to one large Base Task unless one of the explicit closure boundaries exists.
6. Commit only task-owned paths with a `dsw-33987` subject, push to `legacy-remote/v0.0.28beta`, and verify remote containment.

## Implementation

- Mission priority now keeps the complete deliverable under one Task owner and treats Task count as lifecycle cost.
- First wake defaults to one complete Task. The stage graph begins from the whole outcome and groups all acceptance claims one Squad can own from the same input boundary.
- Workload size, duration, files, output formats, directories, reports, audits, tests, correction, review, and same-Squad Artifact dependencies are explicitly Task-internal.
- Every later Task must cite one unavoidable closure boundary: different fixed Squad, terminal evidence or authority outside the current Task and Squad, or an explicit operator request for separate Task lifecycles.
- The terminal reconciliation section no longer accepts any consumed Artifact dependency as a new-Task reason; same-Squad evidence for the same delivery stays in the current Task.
- Base `2026.08.02.4` exposes one complete-Task catalog contract. Its Orchestrator, Planner, Developer, and Tester all preserve the complete acceptance surface through the package workflow.
- The explicit General Mission Skill carries the same smallest-number-of-large-closures rule; its tracked payload was regenerated from the canonical Skill source.
- `panel.create_task`, Mission storage, database schema, and live process state remain unchanged. No Host gate or duplicate lifecycle was introduced.

## Validation results

- Expanded Mission, Base, generated Mission Skill, core-prompt hygiene, and Primary Assistant Registry contracts: 34 tests passed, 367 expectations.
- Focused Mission, Base, and generated Mission Skill contracts before the registry review: 19 tests passed, 134 expectations.
- Initial Mission/Base contracts before the General Mission Skill audit: 15 tests passed, 124 expectations.
- `bun run --cwd packages/opencorvus typecheck`: passed.
- Historical links, product-doc single source, and document health in a current-HEAD temporary index: 70 tests passed, 1,188 expectations.
- The first document-health run had 69 passes and one expected index-membership failure because this new record was untracked; the temporary-index run proved the exact submitted state and did not alter the real index.
- `git diff --check`: passed.

## Second review

The read-only live cases all selected only `base` and used one repository/input boundary. Under the repaired contract:

| Live pattern | Repaired Task boundary |
| --- | --- |
| Deterministic data → warehouse/model → business analysis → forecasts → office files → audit → website | One Base Task. These are deliverables and internal evidence handoffs, not Task boundaries. |
| Event API/ledger/worker → generated events → reconciliation → risk analysis → audit drills → console | One Base Task. The same Base workflow and repository own the complete result. |
| Procurement dataset → matching → Total Cost of Ownership analysis → investment model → five file formats → audit → strategy | One Base Task. File formats and independent audit implementation remain inside the closure. |
| Product pipeline → analysis → audit → portfolio → reports → Web application → incremental rerun | One Base Task. Parallel opportunity and versioned intermediate evidence do not create Tasks. |
| Same-Squad correction, continuation, retest, or final review | Re-enter the same Task and exact package-owned closure; never create repair phases. |

A later Task remains correct when a different held Squad owns a genuinely dependent complete phase, the current Task must wait for evidence or authority it cannot itself produce, or the operator explicitly requests separate Task lifecycles. The repair therefore preserves typed Squad ownership without returning to Task fan-out.

The currently running packaged sidecar was inspected read-only and was not restarted or replaced. Source, tests, and the eventual remote commit prove the repaired next-build contract; the already running binary will retain its packaged prompt until an explicitly authorized rebuild/relaunch.
